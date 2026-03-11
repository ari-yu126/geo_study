import * as cheerio from 'cheerio';
import type { ChunkCitation } from './analysisTypes';
import { computeChunkInfoDensity } from './paragraphAnalyzer';
import { geminiFlash } from './geminiClient';
import { isLlmCooldown, getCooldownRemainingSec } from './llmError';
import { withGeminiRetry, GEMINI_BATCH_SIZE, GEMINI_RETRY_DELAY } from './geminiRetry';

let degradedMode = false;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface TextChunk {
  index: number;
  text: string;
}

export function extractChunks(html: string, maxChunks = 15): TextChunk[] {
  const $ = cheerio.load(html);
  $('script, style, noscript, nav, header, footer, iframe, svg').remove();

  const chunks: TextChunk[] = [];
  let idx = 0;

  const selectors = 'main p, article p, .content p, #content p, [role="main"] p';
  let elements = $(selectors).toArray();
  if (elements.length < 3) {
    elements = $('body p').toArray();
  }

  for (const el of elements) {
    const text = $(el).text().trim();
    if (text.length < 30) continue;
    if (text.length > 800) {
      chunks.push({ index: idx++, text: text.substring(0, 800) });
    } else {
      chunks.push({ index: idx++, text });
    }
    if (idx >= maxChunks) return chunks;
  }

  // 쇼핑/데이터형 페이지: p가 부족하면 li, td, 상품 카드에서 추출
  if (chunks.length < 3) {
    const dataSelectors = 'ul li, ol li, table td, table th, [class*="product"] li, [class*="item"] div, [class*="plan"] li, [class*="goods"]';
    $(dataSelectors).each((_, el) => {
      if (idx >= maxChunks) return false;
      const text = $(el).text().trim();
      if (text.length < 50) return;
      if (/\d+[Aa][hH]|\d+[Vv]|[\d,]+\s*원|용량|저온시동|정격출력/.test(text)) {
        chunks.push({ index: idx++, text: text.length > 600 ? text.substring(0, 600) : text });
      }
    });
  }

  return chunks;
}

export interface EvaluateCitationsParams {
  chunks: TextChunk[];
  searchQuestions: { text: string }[];
  isFaqLikePage?: boolean;
  hasActualAiCitation?: boolean;
}

export async function evaluateCitations(params: EvaluateCitationsParams): Promise<ChunkCitation[]> {
  const { chunks, searchQuestions, isFaqLikePage = false, hasActualAiCitation = false } = params;

  if (!geminiFlash || chunks.length === 0) return [];
  if (isLlmCooldown()) {
    const sec = getCooldownRemainingSec();
    console.warn('[GEMINI] cooldown active - skip citations', { retryAfterSec: sec });
    throw new CitationQuotaSkipError(sec ?? undefined);
  }

  const questionList =
    searchQuestions.length > 0
      ? searchQuestions.map(q => q.text).join('\n')
      : '(커뮤니티 질문 데이터 없음)';

  const batchSize = GEMINI_BATCH_SIZE;
  const delayMs = degradedMode ? GEMINI_RETRY_DELAY * 1.5 : GEMINI_RETRY_DELAY;
  const batches: TextChunk[][] = [];
  for (let i = 0; i < chunks.length; i += batchSize) {
    batches.push(chunks.slice(i, i + batchSize));
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
      () => geminiFlash.generateContent([{ text: prompt }]),
      { feature: 'citations', maxRetries: 3 }
    );

    if (!result.ok) {
      degradedMode = true;
      if (result.status === 'skipped_quota') {
        const err = new CitationQuotaSkipError(result.retryAfterSec);
        err.userMessage = result.message;
        throw err;
      }
      console.error('[citationEvaluator] Gemini error', result.message);
      return [];
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

  return allResults.sort((a, b) => a.index - b.index);
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
