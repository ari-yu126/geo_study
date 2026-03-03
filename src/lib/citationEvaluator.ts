import * as cheerio from 'cheerio';
import type { ChunkCitation } from './analysisTypes';
import { computeChunkInfoDensity } from './paragraphAnalyzer';
import { geminiFlash } from './geminiClient';

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

export async function evaluateCitations(
  chunks: TextChunk[],
  searchQuestions: { text: string }[] = []
): Promise<ChunkCitation[]> {
  if (!geminiFlash || chunks.length === 0) {
    return [];
  }

  const chunkList = chunks.map(c => `[${c.index}] ${c.text}`).join('\n---\n');
  const questionList =
    searchQuestions.length > 0
      ? searchQuestions.map(q => q.text).join('\n')
      : '(커뮤니티 질문 데이터 없음)';

  const prompt = `You are an AI search citation evaluator. Evaluate each text chunk by SEMANTIC value, not keyword matching.

Key question: "Would this paragraph be a REAL SOLUTION that an AI (Google AI Overview, ChatGPT, Perplexity) would cite to answer user questions?"

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

  try {
    const result = await geminiFlash.generateContent([{ text: prompt }]);
    const raw = result.response.text().trim();
    const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
    const parsed: { index: number; score: number; community_fit?: number; communityFit?: number; reason: string }[] =
      JSON.parse(jsonStr);

    return parsed.map(item => {
      const chunk = chunks.find(c => c.index === item.index);
      const text = chunk?.text ?? '';
      const cf = item.community_fit ?? item.communityFit;
      return {
        index: item.index,
        text: text.substring(0, 200),
        score: Math.max(0, Math.min(10, item.score)),
        reason: item.reason ?? '',
        communityFitScore: cf != null ? Math.round(cf * 10) : undefined,
        infoDensity: Math.round(computeChunkInfoDensity(text) * 100) / 100,
      };
    });
  } catch (err) {
    console.error('citationEvaluator error:', err);
    return [];
  }
}

export function citationsToScore(citations: ChunkCitation[]): number {
  if (citations.length === 0) return -1;
  const avg = citations.reduce((s, c) => s + c.score, 0) / citations.length;
  return Math.round(avg * 10);
}
