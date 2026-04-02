import type { ChunkCitation } from './analysisTypes';
import { computeChunkInfoDensity } from './paragraphAnalyzer';
import { geminiFlash, traceGeminiGenerateContent } from './geminiClient';
import { isLlmCooldown, getCooldownRemainingSec } from './llmError';
import { withGeminiRetry, GEMINI_BATCH_SIZE, GEMINI_RETRY_DELAY } from './geminiRetry';

export { extractChunks } from './articleExtraction';

let degradedMode = false;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Evaluate only top N chunks by infoDensity + length to reduce Gemini calls and avoid 429 */
const TOP_CHUNKS_FOR_CITATIONS = 5;

export interface EvaluateCitationsParams {
  chunks: { index: number; text: string }[];
  searchQuestions: { text: string }[];
  isFaqLikePage?: boolean;
  hasActualAiCitation?: boolean;
}

export interface EvaluateCitationsResult {
  citations: ChunkCitation[];
  skippedQuota?: { retryAfterSec?: number; message?: string };
}

export async function evaluateCitations(params: EvaluateCitationsParams): Promise<EvaluateCitationsResult> {
  const { chunks, searchQuestions, isFaqLikePage = false, hasActualAiCitation = false } = params;

  if (!geminiFlash || chunks.length === 0) return { citations: [] };

  if (isLlmCooldown()) {
    const sec = getCooldownRemainingSec();
    console.warn('[GEMINI] cooldown active - skip citations', { retryAfterSec: sec });
    return {
      citations: [],
      skippedQuota: { retryAfterSec: sec ?? undefined, message: '요청이 많아 잠시 후 다시 시도해주세요.' },
    };
  }

  const chunksToUse =
    chunks.length > TOP_CHUNKS_FOR_CITATIONS
      ? [...chunks]
          .map((c) => ({ chunk: c, density: computeChunkInfoDensity(c.text), len: c.text.length }))
          .sort(
            (a, b) =>
              b.density * 100 + Math.min(b.len / 10, 50) - (a.density * 100 + Math.min(a.len / 10, 50))
          )
          .slice(0, TOP_CHUNKS_FOR_CITATIONS)
          .map((x) => x.chunk)
      : chunks;

  const questionList =
    searchQuestions.length > 0
      ? searchQuestions.map(q => q.text).join('\n')
      : '(커뮤니티 질문 데이터 없음)';

  const batchSize = GEMINI_BATCH_SIZE;
  const delayMs = degradedMode ? GEMINI_RETRY_DELAY * 1.5 : GEMINI_RETRY_DELAY;
  const batches: { index: number; text: string }[][] = [];
  for (let i = 0; i < chunksToUse.length; i += batchSize) {
    batches.push(chunksToUse.slice(i, i + batchSize));
  }

  const allResults: ChunkCitation[] = [];

  for (let b = 0; b < batches.length; b++) {
    if (b > 0) await sleep(delayMs);

    const batch = batches[b];
    const chunkList = batch.map(c => `[${c.index}] ${c.text}`).join('\n---\n');

    let systemHint = `You are an AI search citation evaluator. Evaluate each text chunk by SEMANTIC value, not keyword matching.

Key question: "Would this paragraph be a REAL SOLUTION that an AI (Google AI Overview, ChatGPT, Perplexity) would cite to answer user questions?"`;

    if (hasActualAiCitation || isFaqLikePage) {
      systemHint += `

ADDITIONAL CONTEXT:
- This page is already an actual FAQ source that AI (e.g., ChatGPT, AI Overview) selects as a citation.
- Prioritize "answer clarity" and "direct answer to the user's question" when scoring.
- Give higher citation scores to chunks that clearly answer the question, even if they are short.
- Prioritize question-answer matching over length or rhetorical flair.`;
    }

    const prompt = `${systemHint}

For each chunk, evaluate:

1) **citation_score (0-10)**: Would AI cite this as a source?
   - 0: Never (ad, filler, fluff)
   - 1-3: Unlikely (vague, opinion-only, no concrete info)
   - 4-6: Possible (some useful info, but not a complete answer)
   - 7-8: Likely (clear fact, definition, actionable advice)
   - 9-10: Highly citable (standalone answer with specific data, numbers, or step-by-step solution)

2) **community_fit (0-10)**: Does this chunk DIRECTLY answer the community questions below?
   - 0: Not relevant
   - 5: Partially related
   - 10: Direct, complete answer to at least one question

COMMUNITY QUESTIONS (from search/community data):
${questionList}

CHUNKS TO EVALUATE:
${chunkList}

Return ONLY a JSON array. No markdown.
Format: [{"index":0,"score":7,"community_fit":6,"reason":"..."}]

JSON:`;

    const result = await withGeminiRetry(
      () =>
        traceGeminiGenerateContent('citationEvaluator', () =>
          geminiFlash.generateContent([{ text: prompt }])
        ),
      { feature: 'citations', maxRetries: 3 }
    );

    if (!result.ok) {
      degradedMode = true;
      if (result.status === 'skipped_quota') {
        return {
          citations: [],
          skippedQuota: { retryAfterSec: result.retryAfterSec, message: result.message ?? '요청이 많아 잠시 후 다시 시도해주세요.' },
        };
      }
      console.error('[citationEvaluator] Gemini error', result.message);
      return { citations: [] };
    }

    try {
      const raw = result.data.response.text().trim();
      const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
      const parsed: { index: number; score: number; community_fit?: number; communityFit?: number; reason: string }[] =
        JSON.parse(jsonStr);

      for (const item of parsed) {
        const chunk = batch.find(c => c.index === item.index);
        const text = chunk?.text ?? '';
        const cf = item.community_fit ?? item.communityFit;
        allResults.push({
          index: item.index,
          text: text.substring(0, 200),
          score: Math.max(0, Math.min(10, item.score)),
          reason: item.reason ?? '',
          communityFitScore: cf != null ? Math.round(cf * 10) : undefined,
          infoDensity: Math.round(computeChunkInfoDensity(text) * 100) / 100,
        });
      }
    } catch (parseErr) {
      console.warn('[citationEvaluator] JSON parse error', parseErr);
    }
  }

  return { citations: allResults.sort((a, b) => a.index - b.index) };
}

export class CitationQuotaSkipError extends Error {
  retryAfterSec?: number;
  userMessage?: string;
  constructor(retryAfterSec?: number) {
    super('Quota exceeded - citations skipped');
    this.name = 'CitationQuotaSkipError';
    this.retryAfterSec = retryAfterSec;
  }
}

export function citationsToScore(citations: ChunkCitation[]): number {
  if (citations.length === 0) return -1;
  const avg = citations.reduce((s, c) => s + c.score, 0) / citations.length;
  return Math.round(avg * 10);
}
