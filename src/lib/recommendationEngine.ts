import { geminiFlash, traceGeminiGenerateContent } from './geminiClient';
import { isLlmCooldown, getCooldownRemainingSec } from './llmError';
import { withGeminiRetry } from './geminiRetry';
import type {
  SearchQuestion,
  AuditIssue,
  EditorialSubtype,
  GeoAxisScores,
  GeoIssue,
  GeoOpportunity,
  GeoRecommendations,
  GeoPredictedQuestion,
  PageType,
} from './analysisTypes';
import { refineGeminiEditorialTrendSummary } from './geoExplain/editorialSubtypeWording';

export type GeoRecommendationsResult = GeoRecommendations | null | { error: 'quota_exceeded'; retryAfterSec?: number; message?: string };

function parsePredictedQuestions(raw: unknown): GeoPredictedQuestion[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const result: GeoPredictedQuestion[] = [];
  for (const item of raw) {
    if (item && typeof item === 'object' && typeof (item as { question?: unknown }).question === 'string') {
      const o = item as { question: string; importanceReason?: string; coveredByPage?: boolean; isTopGap?: boolean };
      result.push({
        question: String(o.question),
        importanceReason: typeof o.importanceReason === 'string' ? o.importanceReason : '',
        coveredByPage: typeof o.coveredByPage === 'boolean' ? o.coveredByPage : false,
        isTopGap: typeof o.isTopGap === 'boolean' ? o.isTopGap : undefined,
      });
    }
  }
  return result.length > 0 ? result : undefined;
}

export async function generateGeoRecommendations(
  uncoveredQuestions: SearchQuestion[],
  currentIssues: AuditIssue[],
  options?: {
    searchQuestions?: SearchQuestion[];
    pageQuestions?: string[];
    pageType?: PageType;
    /** Editorial-only: tone/context for narrative — does not affect scoring */
    editorialSubtype?: EditorialSubtype;
    pageSignals?: Record<string, unknown>;
    /** Stable opportunity ids — LLM narrative should align, not contradict */
    geoOpportunities?: GeoOpportunity[];
    geoIssues?: GeoIssue[];
    axisScores?: GeoAxisScores;
  }
): Promise<GeoRecommendationsResult> {
  if (!geminiFlash) {
    console.error('Gemini client not available (GEMINI_API_KEY or GOOGLE_GENAI_API_KEY required)');
    return null;
  }
  if (isLlmCooldown()) {
    const sec = getCooldownRemainingSec();
    console.warn('[GEMINI] cooldown active - skip recommendations', { retryAfterSec: sec });
    return { error: 'quota_exceeded', retryAfterSec: sec ?? undefined };
  }

  const searchQuestions = options?.searchQuestions ?? [];
  const pageQuestions = options?.pageQuestions ?? [];
  const pageType = options?.pageType ?? 'editorial';
  const editorialSubtype = options?.editorialSubtype;
  const pageSignals = options?.pageSignals ?? {};

  const questionsText =
    uncoveredQuestions.length > 0
      ? uncoveredQuestions.map((q) => `- ${q.text}`).join('\n')
      : '(현재 페이지가 대부분의 검색 질문에 답하고 있음)';

  const issuesText =
    currentIssues.length > 0
      ? currentIssues.map((i) => `- [${i.priority}] ${i.label}: ${i.description}`).join('\n')
      : '(심각한 이슈 없음)';

  const searchQText =
    searchQuestions.length > 0
      ? searchQuestions.map((q) => `- [${q.source}] ${q.text}`).join('\n')
      : '(검색 질문 없음)';

  const pageQText =
    pageQuestions.length > 0
      ? pageQuestions.map((q) => `- ${q}`).join('\n')
      : '(페이지 내 질문 없음)';

  const isVideo = pageType === 'video';

  // Detect review vs listicle signals to prefer single-review structures.
  const hasReviewSchema = (pageSignals && typeof (pageSignals as Record<string, any>).hasReviewSchema === 'boolean')
    ? (pageSignals as Record<string, any>).hasReviewSchema
    : false;
  const reviewLikeSignal = (pageSignals && typeof (pageSignals as Record<string, any>).reviewLike === 'boolean')
    ? (pageSignals as Record<string, any>).reviewLike
    : false;
  // repeatedProductCardCount may live on pageSignals.contentQuality or at top-level; normalize defensively.
  const repeatedProductCardCount = (pageSignals && typeof (pageSignals as Record<string, any>).repeatedProductCardCount === 'number')
    ? (pageSignals as Record<string, any>).repeatedProductCardCount
    : (pageSignals && typeof (pageSignals as Record<string, any>).contentQuality === 'object' && typeof (pageSignals as Record<string, any>).contentQuality.repeatedProductCardCount === 'number')
    ? (pageSignals as Record<string, any>).contentQuality.repeatedProductCardCount
    : 0;
  const listCountSignal = (pageSignals && typeof (pageSignals as Record<string, any>).listCount === 'number')
    ? (pageSignals as Record<string, any>).listCount
    : undefined;
  const isListicle = repeatedProductCardCount > 1 || (typeof listCountSignal === 'number' && listCountSignal > 3);
  const isSingleProductReview = pageType === 'editorial' && (hasReviewSchema || reviewLikeSignal) && !isListicle;

  const editorialTonePrefix =
    pageType === 'editorial' && editorialSubtype
      ? editorialSubtype === 'blog'
        ? '[Context: reader-facing article / blog — emphasize byline, quotable excerpts, clear takeaways] '
        : editorialSubtype === 'site_info'
        ? '[Context: corporate / help / policy-style page — emphasize scannable structure, official tone, policy clarity] '
        : '[Context: mixed article + site signals — balance narrative clarity with documentation structure] '
      : '';

  // Build a local recommendation skeleton first to avoid unnecessary Gemini calls.
  const localRecommendations: GeoRecommendations = {
    trendSummary:
      editorialTonePrefix +
      (uncoveredQuestions.length > 0
        ? 'Detected unanswered user questions; prioritize clear answers and FAQs.'
        : 'No major uncovered user questions detected; prioritize structural clarity.'),
    contentGapSummary:
      currentIssues.length > 0
        ? `Detected ${currentIssues.length} issues that reduce content quality; address high-priority issues first.`
        : '(No severe issues detected)',
    actionPlan: {
      suggestedHeadings: pageType === 'video'
        ? ['Pinned summary', 'Chapters / Timestamps', 'FAQ']
        : pageType === 'commerce'
        ? ['Price & Offer', 'Structured Spec Table', 'Shipping / Returns / Warranty']
        : isSingleProductReview
        ? ['Pros / Cons', 'Best for / Not for (user segments)', 'Final verdict — one-paragraph']
        : ['추가할 H2 제목 예시', '요약 섹션', 'FAQ'],
      suggestedBlocks: pageType === 'video'
        ? ['Pinned one-paragraph summary + 2 bullets', 'Chapter example: 0:00 Intro / 02:15 Key / 05:00 Summary', 'FAQ short items']
        : pageType === 'commerce'
        ? ['Spec table template: Model | KeySpec | Value', 'Policy block: shipping / returns / warranty bullets', 'FAQ purchase questions']
        : isSingleProductReview
        ? ['Pros / Cons summary block', 'Best-for segmentation bullets', 'Final verdict (1 paragraph)']
        : ['Data comparison table', 'How-to steps', 'FAQ'],
      priorityNotes:
        uncoveredQuestions.length > 0
          ? ['Answer uncovered questions via FAQ (high priority)', 'Add early summary / key takeaways']
          : ['Improve structure and add clear headings'],
    },
  };

  // Helper to safely read pageSignals (typed)
  const getSignal = <T,>(key: string): T | undefined => {
    if (!pageSignals || typeof pageSignals !== 'object') return undefined;
    const v = (pageSignals as Record<string, unknown>)[key];
    return v as T | undefined;
  };

  // Detect topic from signals (prefer explicit detectedTopic, fall back to meta.title)
  const detectedTopic = getSignal<string>('detectedTopic') ?? getSignal<Record<string, unknown>>('meta')?.title ?? getSignal<string>('topic') ?? getSignal<string>('detectedTitle') ?? null;

  // Helper to inject detectedTopic into text (mandatory when present)
  const injectTopic = (t: string) => (detectedTopic ? `${t} — ${String(detectedTopic)}` : t);

  // If there are no uncoveredQuestions, switch to AI citation optimization mode:
  // - generate intent-based questions and prioritize advanced GEO strategies.
  if (uncoveredQuestions.length === 0) {
    // Intent-based questions examples (intent, not user-sourced)
    const intentQuestions = [
      `How does ${detectedTopic ?? 'this topic'} compare to alternatives?`,
      `When should one choose option A over B for ${detectedTopic ?? 'this topic'}?`,
      `What are common edge cases or pitfalls with ${detectedTopic ?? 'this topic'}?`,
    ];

    // Overwrite suggestedHeadings/Blocks with advanced GEO strategies, injecting topic.
    if (isSingleProductReview) {
      // For single-product reviews, prefer decision-support structures over full comparison tables.
      localRecommendations.actionPlan.suggestedHeadings = [
        injectTopic('Pros / Cons summary'),
        injectTopic('Best for / Not for (user segments)'),
        injectTopic('Final verdict — one-paragraph'),
      ];
      localRecommendations.actionPlan.suggestedBlocks = [
        injectTopic('Pros / Cons bullet block'),
        injectTopic('Best-for segmentation bullets: - Best for X: ... - Not for Y: ...'),
        injectTopic('Final verdict (concise 1-paragraph conclusion)'),
        injectTopic('Pseudo-comparison: vs typical product / category average (no multi-product table)'),
      ];
      localRecommendations.actionPlan.priorityNotes = [
        'Prioritize concise decision-support blocks (pros/cons, best-for, final verdict).',
        'If comparisons are needed, use pseudo-comparisons (vs typical product or category average) rather than full multi-product tables.',
        'Ensure summary blocks are machine-extractable (short bullets / single-paragraph verdict).',
      ];
    } else {
      localRecommendations.actionPlan.suggestedHeadings = [
        injectTopic('Structured comparison summary'),
        injectTopic('Best for: user segments / scenarios'),
        injectTopic('Quick extraction: key specs & takeaways'),
      ];
      localRecommendations.actionPlan.suggestedBlocks = [
        injectTopic('Comparison table template: Feature | Option A | Option B | Recommendation'),
        injectTopic('Best-for categorization bullets: - Best for X: ... - Best for Y: ...'),
        injectTopic('Extraction block (key metrics table / 3-line summary)'),
      ];
      localRecommendations.actionPlan.priorityNotes = [
        'Prioritize structured comparison summaries and extraction blocks (high ROI for AI citation).',
        'Add "best for X" categorizations to improve user intent matching.',
        'Ensure headline/spec blocks are machine-extractable (tables, bullets).',
      ];
    }

    // Expose generated intent-questions as predictedQuestions fallback for UI/LLM usage
    (localRecommendations as unknown as Record<string, unknown>).generatedIntentQuestions = intentQuestions;
  }

  // Decide whether to skip Gemini for low-value cases.
  const structureScore = typeof pageSignals.structureScore === 'number' ? (pageSignals.structureScore as number) : undefined;
  const descriptionLength = typeof pageSignals.descriptionLength === 'number' ? (pageSignals.descriptionLength as number) : undefined;
  const limitedAnalysisFlag = Boolean(pageSignals.limitedAnalysis);

  const shouldSkipGemini =
    isLlmCooldown() ||
    limitedAnalysisFlag ||
    (typeof descriptionLength === 'number' && descriptionLength < 50) ||
    (typeof structureScore === 'number' && structureScore < 30) ||
    (uncoveredQuestions.length === 0 && currentIssues.length === 0);

  if (shouldSkipGemini) {
    // Mark as template fallback if we skipped model phrasing.
    localRecommendations.isTemplateFallback = true;
    return localRecommendations;
  }

  // Build a single structured prompt for Gemini to perform phrasing/prioritization only.
  const stableOpportunities = (options?.geoOpportunities ?? []).slice(0, 24).map((o) => ({
    id: o.id,
    improvesAxis: o.improvesAxis,
    fixesIssueId: o.fixesIssueId ?? null,
    impact: o.impact,
    title: o.title,
    rationale: o.rationale,
  }));

  const internalContext = {
    pageType,
    editorialSubtype: pageType === 'editorial' ? editorialSubtype ?? null : null,
    pageSignals,
    uncoveredQuestions: uncoveredQuestions.map((q) => q.text),
    currentIssues: currentIssues.map((i) => ({ id: i.id, priority: i.priority, label: i.label })),
    geoIssueIds: (options?.geoIssues ?? []).map((i) => i.id),
    axisScores: options?.axisScores ?? null,
    stableOpportunities,
    internalRecommendations: localRecommendations,
  };

  const policyNote =
    'Follow our internal GEO scoring policy v26.03. This policy prioritizes Information Gain, structured spec tables, clear FAQ blocks, and trust-oriented content structure. Do not claim this is an external industry standard.';

  const singlePrompt = `You are a GEO recommendations assistant. Use the provided structured CONTEXT (JSON) to rephrase and prioritize the internal recommendations.
Only use the signals included in CONTEXT to justify reasons. Do NOT invent unsupported signals.

CONTEXT:
${JSON.stringify(internalContext, null, 2)}

INSTRUCTIONS:
- Follow the internal policy note exactly: ${policyNote}
- Narrative enrichment only: align recommendations with CONTEXT.stableOpportunities (use their id/title/rationale/axis). Do NOT invent unrelated priority themes that ignore stableOpportunities or axisScores.
- Be page-type aware:
  - For "commerce": focus on "Conversion via Trust" (price transparency, structured spec tables, FAQ blocks, shipping/returns/warranty clarity).
  - For "video": focus on "Knowledge Base Formation" (chapter markers, pinned summary, FAQ in description, concise key takeaway).
  - For "editorial" with CONTEXT.editorialSubtype "blog": align phrasing with independent publishing (voice, sourcing, dated narrative) without claiming it changes scores.
  - For "editorial" with CONTEXT.editorialSubtype "site_info": align phrasing with official documentation (policies, help, service facts) without claiming it changes scores.
  - For "editorial" with CONTEXT.editorialSubtype "mixed": use neutral language that does not assume only one format.
- If authority signals (e.g., subscriberCount, viewCount, hasDomainAuthority) are high but structure/data density is weak, recommend "Data Enrichment" and tie that to the specific weak signals.
- For each recommendation, explicitly list which signal(s) from CONTEXT justify it.
- You MUST return strict JSON only, matching this schema exactly (no markdown, no extra text):

{
  "strategySummary": "short 1-2 sentence summary",
  "contentGap": "short 1-2 sentence description of primary content gap",
  "recommendedHeadings": ["...","..."],
  "copyPasteTemplates": ["...","..."],
  "recommendations": [
    {
      "title": "...",
      "reason": "... (must reference CONTEXT signals)",
      "impact": "High|Medium|Low",
      "relatedSignals": ["signalName1","signalName2"]
    }
  ]
}

JSON:`;

  try {
    const wrap = await withGeminiRetry(
      () =>
        traceGeminiGenerateContent('recommendationEngine', () =>
          geminiFlash.generateContent([{ text: singlePrompt }])
        ),
      { feature: 'recommendations', maxRetries: 2 }
    );
    if (!wrap.ok) {
      if (wrap.status === 'skipped_quota') {
        // Quota/rate-limit detected — return local fallback and mark cooldown.
        localRecommendations.isTemplateFallback = true;
        return localRecommendations;
      }
      console.error('generateGeoRecommendations error:', wrap.message);
      return localRecommendations;
    }

    const result = wrap.data;
    const raw = result.response.text().trim();
    const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const parsed = JSON.parse(jsonStr) as {
      strategySummary?: string;
      contentGap?: string;
      recommendedHeadings?: unknown;
      copyPasteTemplates?: unknown;
      recommendations?: Array<Record<string, unknown>>;
    };

    if (
      typeof parsed.strategySummary === 'string' &&
      typeof parsed.contentGap === 'string' &&
      Array.isArray(parsed.recommendedHeadings) &&
      Array.isArray(parsed.copyPasteTemplates) &&
      Array.isArray(parsed.recommendations)
    ) {
      const final: GeoRecommendations & { _structuredRecommendations?: unknown } = {
        trendSummary: parsed.strategySummary!,
        contentGapSummary: parsed.contentGap!,
        actionPlan: {
          suggestedHeadings: (parsed.recommendedHeadings as unknown[]).map(String),
          suggestedBlocks: (parsed.copyPasteTemplates as unknown[]).map(String),
          priorityNotes: (Array.isArray(parsed.recommendations)
            ? (parsed.recommendations as Array<Record<string, unknown>>)
                .map((r) => {
                  const title = typeof r.title === 'string' ? r.title : '';
                  const impact = typeof r.impact === 'string' ? r.impact : '';
                  const related = Array.isArray(r.relatedSignals) ? (r.relatedSignals as unknown[]).join(',') : '';
                  return `${title} — ${impact} (${related})`;
                })
                .slice(0, 5)
            : undefined) as string[] | undefined,
        },
        _structuredRecommendations: parsed.recommendations,
      } as GeoRecommendations & { _structuredRecommendations?: unknown };

      if (pageType === 'editorial' && editorialSubtype) {
        final.trendSummary = refineGeminiEditorialTrendSummary(final.trendSummary, editorialSubtype);
      }

      return final;
    } else {
      console.warn('generateGeoRecommendations: gemini returned unexpected shape; using local fallback');
      localRecommendations.isTemplateFallback = true;
      return localRecommendations;
    }
  } catch (err) {
    console.error('generateGeoRecommendations error:', err);
    localRecommendations.isTemplateFallback = true;
    return localRecommendations;
  }
  // primary try/catch above handles errors and returns local fallback on failure.
}
