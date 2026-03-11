import { geminiFlash } from './geminiClient';
import { isLlmCooldown, getCooldownRemainingSec } from './llmError';
import { withGeminiRetry } from './geminiRetry';
import type {
  SearchQuestion,
  AuditIssue,
  GeoRecommendations,
  GeoPredictedQuestion,
} from './analysisTypes';

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

  const prompt1 = `너는 GEO/AI Overview 관점에서 콘텐츠 전략을 제안하는 컨설턴트다.

입력 데이터:
1) 아직 페이지가 답하지 못한 사용자 질문 목록 (커뮤니티/검색 기반):
${questionsText}

2) 현재 페이지의 이슈 목록:
${issuesText}

위 입력을 바탕으로, GEO 점수와 AI 검색 노출을 높이기 위한 맞춤형 추천을 해줘.

출력은 반드시 아래 JSON 스키마만 지켜서, 마크다운/코드블록/설명 없이 순수 JSON만 반환해.

{
  "trendSummary": "커뮤니티(디시, 펨코 등)에서 어떤 키워드/관심 포인트가 많은지 1~2문장 요약",
  "contentGapSummary": "현재 사이트가 어떤 관점/데이터가 부족한지 1~2문장 요약",
  "actionPlan": {
    "suggestedHeadings": ["추가할 H2/H3 제목 1", "추가할 H2/H3 제목 2"],
    "suggestedBlocks": ["추가할 블록 예: 실제 온도별 시동 성공률 비교 테이블", "추가할 블록 예: 교체 주기별 예상 비용 리스트"],
    "priorityNotes": ["우선순위/주의사항 1", "우선순위/주의사항 2"]
  }
}

JSON:`;

  try {
    console.log('[GEMINI] generateGeoRecommendations call start', {
      uncoveredCount: uncoveredQuestions.length,
    });
    const result1Wrap = await withGeminiRetry(
      () => geminiFlash.generateContent([{ text: prompt1 }]),
      { feature: 'recommendations', maxRetries: 3 }
    );
    if (!result1Wrap.ok) {
      if (result1Wrap.status === 'skipped_quota') {
        return { error: 'quota_exceeded', retryAfterSec: result1Wrap.retryAfterSec, message: result1Wrap.message };
      }
      console.error('generateGeoRecommendations error:', result1Wrap.message);
      return null;
    }
    const result1 = result1Wrap.data;
    const raw1 = result1.response.text().trim();
    const jsonStr1 = raw1
      .replace(/^```json?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();
    const parsed1 = JSON.parse(jsonStr1) as GeoRecommendations;

    if (!parsed1.trendSummary || !parsed1.contentGapSummary || !parsed1.actionPlan) {
      console.error('Gemini response missing required fields');
      return null;
    }

    const recommendations: GeoRecommendations = {
      trendSummary: String(parsed1.trendSummary),
      contentGapSummary: String(parsed1.contentGapSummary),
      actionPlan: {
        suggestedHeadings: Array.isArray(parsed1.actionPlan.suggestedHeadings)
          ? parsed1.actionPlan.suggestedHeadings.map(String)
          : [],
        suggestedBlocks: Array.isArray(parsed1.actionPlan.suggestedBlocks)
          ? parsed1.actionPlan.suggestedBlocks.map(String)
          : [],
        priorityNotes: Array.isArray(parsed1.actionPlan.priorityNotes)
          ? parsed1.actionPlan.priorityNotes.map(String)
          : undefined,
      },
    };

    const prompt2 = `이 URL 주제에 대해 사용자가 실제로 던질 법한 질문 Top 5를 만들고,
각 질문마다 왜 중요한지(중요도/리스크/전환율 관점 등)를 설명해줘.
그리고 현재 페이지 본문과 질문 목록을 기준으로, 본문에 전혀 답이 없는 질문 Top3를 골라줘.

입력:
- 검색/커뮤니티에서 수집한 질문: ${searchQText}
- 페이지 내 질문(H2 등): ${pageQText}
- 아직 미답변 질문: ${questionsText}
- 현재 이슈 요약: ${issuesText}

출력은 반드시 아래 JSON만 반환해. 마크다운/코드블록/설명 없이 순수 JSON만.

{
  "predictedQuestions": [
    {
      "question": "질문 1",
      "importanceReason": "왜 중요한지 (비즈니스/사용자 관점)",
      "coveredByPage": true,
      "isTopGap": false
    }
  ],
  "predictedUncoveredTop3": [
    {
      "question": "본문에 없는 질문 1",
      "importanceReason": "보강 시 기대 효과",
      "coveredByPage": false,
      "isTopGap": true
    }
  ]
}

predictedQuestions: Top 5. coveredByPage는 현재 페이지 본문/질문으로 어느 정도 답이 되는지. true=답함, false=미답.
predictedUncoveredTop3: predictedQuestions 중 coveredByPage가 false인 것 중 Top3. isTopGap은 전부 true.

JSON:`;

    try {
      const result2Wrap = await withGeminiRetry(
        () => geminiFlash.generateContent([{ text: prompt2 }]),
        { feature: 'recommendations', maxRetries: 2 }
      );
      if (!result2Wrap.ok) {
        console.warn('generateGeoRecommendations: prompt2 skipped, using base recommendations');
      } else {
        const result2 = result2Wrap.data;
        const raw2 = result2.response.text().trim();
        const jsonStr2 = raw2
          .replace(/^```json?\s*/i, '')
          .replace(/\s*```\s*$/, '')
          .trim();
        const parsed2 = JSON.parse(jsonStr2) as {
          predictedQuestions?: unknown;
          predictedUncoveredTop3?: unknown;
        };

        const pq = parsePredictedQuestions(parsed2.predictedQuestions);
        const top3 = parsePredictedQuestions(parsed2.predictedUncoveredTop3);

        if (pq && pq.length > 0) {
          recommendations.predictedQuestions = pq.slice(0, 5);
        }
        if (top3 && top3.length > 0) {
          recommendations.predictedUncoveredTop3 = top3.slice(0, 3);
        }
      }
    } catch (parseErr) {
      console.warn('generateGeoRecommendations: predictedQuestions/Top3 parse failed', parseErr);
    }

    return recommendations;
  } catch (err) {
    console.error('generateGeoRecommendations error:', err);
    return null;
  }
}
