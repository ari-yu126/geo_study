import { NextResponse } from 'next/server';
import { fetchHtml, extractMetaAndContent } from '@/lib/htmlAnalyzer';
import { extractSeedKeywords } from '@/lib/keywordExtractor';
import { derivePrimaryTopic } from '@/lib/searchQuestions';
import { buildCanonicalSearchQuestions } from '@/lib/canonicalSearchQuestions';
import { buildCoverageMatchInput } from '@/lib/coverageSurfaces';
import { computeSearchQuestionCoverage } from '@/lib/questionCoverage';
import type { SeedKeyword, SearchQuestion, AnalysisMeta } from '@/lib/analysisTypes';
import { geminiFlash } from '@/lib/geminiClient';
import { withGeminiRetry } from '@/lib/geminiRetry';

interface TavilyFetchResult {
  ok: boolean;
  error?: string | null;
  results: unknown[];
  answer?: string;
}

async function fetchFromTavily(query: string): Promise<TavilyFetchResult> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return { ok: false, error: 'no_tavily_key', results: [] };
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'advanced',
        max_results: 6,
        include_answer: true,
      }),
    });
    if (!res.ok) return { ok: false, error: `http_${res.status}`, results: [] };
    const data = await res.json();
    return { ok: true, results: data.results ?? [], answer: data.answer ?? '' };
  } catch (err) {
    return { ok: false, error: String(err), results: [] };
  }
}

function buildTavilyQueryStrict(primaryPhrase: string, focus: 'faq' | 'cons' | 'community', isEnglish: boolean) {
  const phrase = primaryPhrase.trim();
  if (!phrase) return '';
  if (isEnglish) {
    switch (focus) {
      case 'cons': return `"${phrase}" cons drawbacks review`;
      case 'community': return `"${phrase}" reddit OR site:reddit.com`;
      case 'faq':
      default: return `"${phrase}" FAQ questions`;
    }
  }
  switch (focus) {
    case 'cons': return `"${phrase}" 단점 후기`;
    case 'community': return `"${phrase}" site:dcinside.com OR site:fmkorea.com OR site:theqoo.net OR site:reddit.com`;
    case 'faq':
    default: return `"${phrase}" 자주 묻는 질문`;
  }
}

function extractQuestionCandidatesFromText(text: string, source: 'google' | 'community', url?: string): SearchQuestion[] {
  const sentences = (text || '').split(/[.!?]\s+/).map(s => s.trim());
  const questionKeywords = ['어떻게','언제','왜','무엇','방법','비용','기간','차이','추천','후기','단점','how','what','why','best','compare'];
  const out: SearchQuestion[] = [];
  for (const s of sentences) {
    if (!s || s.length < 6) continue;
    const hasQ = s.includes('?') || questionKeywords.some(kw => s.includes(kw));
    if (hasQ) out.push({ source, text: s, url });
  }
  return out;
}

// minimal versions of filters copied from searchQuestions.ts for debug
function isValidQuestion(text: string) {
  const NSFW = ['성인','porn','xxx','카지노','도박'];
  const t = (text||'').toLowerCase();
  for (const k of NSFW) if (t.includes(k)) return false;
  return true;
}
function isJunkQuestion(text: string) {
  const t = (text||'').trim();
  if (t.length < 10) return true;
  if (/https?:\/\//i.test(t)) return true;
  if (t.length > 150 && !/\?|있나요|인가요|어떻게|왜|언제/.test(t)) return true;
  return false;
}
function isRelevantToKeywords(questionText: string, essentialTokens: string[], coreKeywordCount = 2) {
  const text = questionText.toLowerCase();
  if (!essentialTokens || essentialTokens.length === 0) return true;
  const core = essentialTokens.slice(0, coreKeywordCount).map(t => t.toLowerCase());
  for (const kw of core) {
    if (kw.length >= 2 && text.includes(kw)) return true;
  }
  // token intersection fallback
  const qTokens = new Set(text.replace(/[^\p{L}\p{N}]/gu,' ').split(/\s+/).filter(Boolean));
  for (const kw of core) {
    const parts = kw.split(/\s+/).filter(Boolean);
    for (const p of parts) {
      if (p.length >= 3 && qTokens.has(p)) return true;
    }
  }
  return false;
}
function dedupeQuestions(questions: SearchQuestion[]) {
  const seen = new Set<string>(); const out: SearchQuestion[] = [];
  for (const q of questions) {
    const n = q.text.toLowerCase().replace(/\s+/g,' ').trim();
    if (!seen.has(n)) { seen.add(n); out.push(q); }
  }
  return out;
}

type SemanticMatchResult = { available: boolean; canAnswer: boolean | null; explanation: string; confidence?: number };

async function semanticVerifyQuestionWithGemini(questionText: string, pageText: string): Promise<SemanticMatchResult> {
  const model = geminiFlash;
  if (!model) return { available: false, canAnswer: null, explanation: 'gemini_not_available' };
  const prompt = `You are an evaluator. Given the following webpage text (EXTRACT) and a user question (QUESTION), answer whether the page can meaningfully answer the question.

Return ONLY JSON with keys:
{
  "canAnswer": true|false,
  "confidence": 0.0-1.0,
  "explanation": "one-sentence reason"
}

EXTRACT:
${pageText.substring(0, 3000)}

QUESTION:
${questionText}

Answer now in JSON only.`;

  const wrap = await withGeminiRetry(
    () => model.generateContent([{ text: prompt }]),
    { feature: 'coverageVerify', maxRetries: 1 }
  );
  if (!wrap.ok) {
    return { available: false, canAnswer: null, explanation: `gemini_error:${wrap.status}` };
  }
  try {
    const raw = wrap.data.response.text().trim();
    const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const parsed = JSON.parse(jsonStr);
    return { available: true, canAnswer: Boolean(parsed.canAnswer), confidence: Number(parsed.confidence ?? 0), explanation: String(parsed.explanation ?? '') };
  } catch {
    return { available: false, canAnswer: null, explanation: 'gemini_parse_error' };
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.url !== 'string') return NextResponse.json({ error: 'url required' }, { status: 400 });
    const url: string = body.url;

    // 1) HTML + meta + headings + seed keywords
    const html = await fetchHtml(url);
    const { meta, headings, contentText, pageQuestions, hasFaqSchema } = extractMetaAndContent(html);
    const seedKeywords: SeedKeyword[] = extractSeedKeywords(meta as AnalysisMeta, headings, contentText);
    const primary = derivePrimaryTopic(meta as AnalysisMeta, url, seedKeywords);

    // 2) build tavily queries and call
    const focuses: ('faq'|'cons'|'community')[] = ['faq','cons','community'];
    interface QuestionCandidate { source: SearchQuestion['source']; text: string; url?: string; snippet?: string }
    const tavilyResults: Array<{ focus: string; query: string; rawFetch?: TavilyFetchResult; candidates: QuestionCandidate[] }> = [];
    for (const f of focuses) {
      const q = buildTavilyQueryStrict(primary.primaryPhrase, f, primary.isEnglishPage);
      if (!q) { tavilyResults.push({ focus: f, query: q, rawFetch: { ok: false, error: 'no_query', results: [] }, candidates: [] }); continue; }
      const raw = await fetchFromTavily(q);
      // extract candidate questions/snippets from raw
      const candidates: QuestionCandidate[] = [];
      if (raw.ok) {
        if (raw.answer) {
          const qs = extractQuestionCandidatesFromText(raw.answer, f==='community' ? 'community' : 'google', undefined);
          const sanitize = (s?: string, max = 200) => {
            if (!s) return undefined;
            let t = String(s);
            t = t.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
            t = t.replace(/<code[\s\S]*?>[\s\S]*?<\/code>/gi, ' ');
            t = t.replace(/https?:\/\/\S+/gi, ' ');
            t = t.replace(/[\w-]+=[^&\s]+/g, ' ');
            t = t.replace(/[_\-\|]{2,}/g, ' ').replace(/[\t\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
            if (t.length > max) t = t.slice(0, max - 1).trim() + '…';
            return t || undefined;
          };
          const short = sanitize(raw.answer, 200);
          for (const s of qs) candidates.push({ text: s.text, source: s.source, snippet: short, url: undefined });
        }
        for (const r of raw.results as Record<string, unknown>[]) {
          const title = String((r as Record<string, unknown>)['title'] ?? '');
          const content = String((r as Record<string, unknown>)['content'] ?? '');
          const pageUrl = String((r as Record<string, unknown>)['url'] ?? '');
          const titleQs = extractQuestionCandidatesFromText(title, f==='community' ? 'community' : 'google', pageUrl);
          const sanitize = (s?: string, max = 200) => {
            if (!s) return undefined;
            let t = String(s);
            t = t.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
            t = t.replace(/<code[\s\S]*?>[\s\S]*?<\/code>/gi, ' ');
            t = t.replace(/https?:\/\/\S+/gi, ' ');
            t = t.replace(/[\w-]+=[^&\s]+/g, ' ');
            t = t.replace(/[_\-\|]{2,}/g, ' ').replace(/[\t\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
            if (t.length > max) t = t.slice(0, max - 1).trim() + '…';
            return t || undefined;
          };
          const shortContent = sanitize(content, 200);
          for (const s of titleQs) candidates.push({ text: s.text, source: s.source, snippet: shortContent, url: pageUrl });
          const contentQs = extractQuestionCandidatesFromText(content, f==='community' ? 'community' : 'google', pageUrl);
          for (const s of contentQs) candidates.push({ text: s.text, source: s.source, snippet: shortContent, url: pageUrl });
        }
      }
      tavilyResults.push({ focus: f, query: q, rawFetch: raw, candidates });
    }

    // aggregate raw candidates
    let allCandidates: SearchQuestion[] = tavilyResults.flatMap(t => t.candidates.map((c) => ({ source: c.source, text: c.text, url: c.url })));

    // 3) filtering stages
    const beforeDedupeCount = allCandidates.length;
    allCandidates = dedupeQuestions(allCandidates as SearchQuestion[]);
    const dedupedCount = allCandidates.length;

    const topicFiltered = allCandidates.filter(c => isRelevantToKeywords(c.text, primary.essentialTokens));
    const validFiltered = topicFiltered.filter(c => isValidQuestion(c.text));
    const nonJunk = validFiltered.filter(c => !isJunkQuestion(c.text));
    const finalQuestions = nonJunk.map(q => ({ source: q.source, text: q.text, url: q.url })) as SearchQuestion[];

    const canonicalQuestions = buildCanonicalSearchQuestions({
      evidence: finalQuestions,
      seedKeywords,
      meta: { title: meta.title, ogTitle: meta.ogTitle },
      topic: primary,
      pageType: undefined,
    });
    const coverageInput = buildCoverageMatchInput({
      meta,
      headings,
      html,
      contentText,
      pageQuestions,
      hasFaqSchema,
      topicTokens: primary.essentialTokens,
    });

    // 4) coverage calculation (canonical intents × structured surfaces)
    const coverageBooleans = computeSearchQuestionCoverage(canonicalQuestions, coverageInput);

    // prepare coverage detail per question
    const coverageDetails: Array<Record<string, unknown>> = [];
    for (let i = 0; i < canonicalQuestions.length; i++) {
      const q = canonicalQuestions[i];
      const tokens = q.text.toLowerCase().split(/\s+/).filter(t => t.length>=2);
      const fullText = contentText.toLowerCase();
      const fullTextMatches = tokens.filter(t => fullText.includes(t)).length;
      const minMatch = Math.max(1, Math.ceil(tokens.length * 0.5));
      const matchedPageQs: string[] = [];
      for (const pq of pageQuestions) {
        const pageTokens = pq.toLowerCase().split(/\s+/).filter(t=>t.length>=2);
        const intersection = tokens.filter(t => pageTokens.includes(t));
        if (intersection.length >= (tokens.length <= 4 ? 2 : 3)) matchedPageQs.push(pq);
      }
      const tokenCovered = coverageBooleans[i] ?? false;

      // Semantic verification (prioritized). If Gemini unavailable, fallback to token result.
      const sem = await semanticVerifyQuestionWithGemini(q.text, contentText);
      const semantic_match_result: SemanticMatchResult = { available: sem.available ?? false, canAnswer: sem.canAnswer ?? null, explanation: sem.explanation ?? '', confidence: sem.confidence };
      let finalCovered = tokenCovered;
      let short_reason = tokenCovered ? 'token match' : 'token mismatch';
      if (semantic_match_result.available) {
        if (semantic_match_result.canAnswer) {
          finalCovered = true;
          short_reason = `semantic=yes (${Number(semantic_match_result.confidence ?? 0).toFixed(2)})`;
        } else {
          finalCovered = false;
          short_reason = `semantic=no (${semantic_match_result.explanation ?? ''})`;
        }
      } else {
        short_reason = tokenCovered ? 'token match (semantic unavailable)' : 'token mismatch (semantic unavailable)';
      }

      coverageDetails.push({
        question: q.text,
        tokens,
        token_match_result: { fullTextMatches, minMatch, matchedPageQs, tokenCovered },
        semantic_match_result,
        final_covered: finalCovered,
        short_reason,
      });
    }

    return NextResponse.json({
      url,
      primary,
      seedKeywords,
      tavilyResults: tavilyResults.map(t => ({ focus: t.focus, query: t.query, fetchedCount: t.rawFetch?.results?.length ?? 0, error: t.rawFetch?.error ?? null })),
      counts: { beforeDedupe: beforeDedupeCount, deduped: dedupedCount, afterFilters: finalQuestions.length, canonical: canonicalQuestions.length },
      filters: {
        topicFilteredCount: topicFiltered.length,
        validFilteredCount: validFiltered.length,
        nonJunkCount: nonJunk.length,
      },
      finalQuestions,
      canonicalQuestions,
      coverageDetails,
    }, { status: 200 });
  } catch (err) {
    console.error('pipeline-debug error', err);
    return NextResponse.json({ error: String((err as Error)?.message ?? String(err)) }, { status: 500 });
  }
}

