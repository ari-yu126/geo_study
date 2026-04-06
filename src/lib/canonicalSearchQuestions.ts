/**
 * Derive question-like intents from raw search evidence (titles/snippets) for coverage scoring.
 * Raw Tavily titles are often not literal user questions; we normalize to comparable intents.
 */

import type { AnalysisMeta, PageType, SearchQuestion, SearchSource, SeedKeyword } from './analysisTypes';
import type { PrimaryTopic } from './searchQuestions';

const MAX_CANONICAL = 12;

function pickSource(sources: SearchSource[]): SearchSource {
  if (sources.includes('google')) return 'google';
  if (sources.includes('community')) return 'community';
  return 'google';
}

function stripBlogNoise(text: string): string {
  let t = text.replace(/\s+/g, ' ').trim();
  t = t.replace(/\s*[\|｜]\s*.+$/u, '');
  t = t.replace(/\s+[-–—]\s+(reddit|youtube|twitter|facebook|blog|medium|tistory)[^\s]*$/i, '');
  t = t.replace(/\s*\(\s*\d{4}\s*\)\s*$/u, '');
  t = t.replace(/^\d+[\.\)]\s*/, '');
  return t.trim();
}

/**
 * Heuristic: turn a search result title/snippet into a question-shaped intent string.
 */
export function normalizeEvidenceToQuestion(text: string, isEnglish: boolean, primaryPhrase: string): string | null {
  const raw = stripBlogNoise(text);
  if (raw.length < 8) return null;

  const shortened = raw.length > 200 ? `${raw.slice(0, 197)}…` : raw;
  const t = shortened.trim();

  if (isEnglish) {
    const lower = t.toLowerCase();
    if (/^\s*(how|what|which|why|when|where|who|should|can|do|does|is|are)\b/i.test(t) && !t.endsWith('?')) {
      return `${t}?`;
    }
    if (t.endsWith('?')) return t;

    const mBest = lower.match(/^best\s+(.+)/i);
    if (mBest) {
      const rest = mBest[1].replace(/\s+(20\d{2}|review|guide|buying)$/i, '').trim();
      if (rest.length >= 3) return `What are the best ${rest}?`;
    }
    const vs = t.split(/\s+vs\.?\s+/i);
    if (vs.length === 2 && vs[0].length > 2 && vs[1].length > 2) {
      return `What is the difference between ${vs[0].trim()} and ${vs[1].trim()}?`;
    }
    if (/\b(pros|cons|drawbacks|worth it)\b/i.test(t)) {
      return `What are the pros and cons of ${primaryPhrase}?`;
    }
    if (primaryPhrase.length >= 3) {
      return `What should I know about ${primaryPhrase} regarding: ${t.slice(0, 120)}?`;
    }
    return `What should I know about ${t.slice(0, 140)}?`;
  }

  // Korean / mixed
  if (t.includes('?') || t.includes('？')) return t;
  if (/(무엇|어떻게|왜|언제|어디|얼마|누구|가능|추천|장단점|비교|차이|주의|방법|후기|단점|필요)/.test(t)) {
    return t.endsWith('?') || t.endsWith('？') ? t : `${t}?`;
  }
  if (primaryPhrase.length >= 2) {
    return `「${primaryPhrase}」와 관련해 ${t.slice(0, 100)}에 대해 알려주는 정보가 있나요?`;
  }
  return `${t}에 대해 어떤 정보가 있나요?`;
}

function dedupeCanonical(questions: SearchQuestion[]): SearchQuestion[] {
  const out: SearchQuestion[] = [];
  const seenNorm = new Set<string>();
  const tokenize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2);

  for (const q of questions) {
    const norm = q.text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seenNorm.has(norm)) continue;

    let tooSimilar = false;
    const a = new Set(tokenize(q.text));
    for (const existing of out) {
      const b = new Set(tokenize(existing.text));
      let inter = 0;
      for (const x of a) if (b.has(x)) inter++;
      const union = a.size + b.size - inter;
      const j = union > 0 ? inter / union : 0;
      if (j >= 0.72) {
        tooSimilar = true;
        break;
      }
    }
    if (tooSimilar) continue;

    seenNorm.add(norm);
    out.push(q);
    if (out.length >= MAX_CANONICAL) break;
  }
  return out;
}

function seedTemplateQuestions(
  seedKeywords: SeedKeyword[],
  primaryPhrase: string,
  isEnglish: boolean,
  pageType?: PageType
): SearchQuestion[] {
  const top = [...seedKeywords].sort((a, b) => b.score - a.score).slice(0, 4);
  const out: SearchQuestion[] = [];
  const phrase = primaryPhrase.trim() || top[0]?.value || 'this topic';

  if (isEnglish) {
    out.push({ source: 'google', text: `What are the most important things to know about ${phrase}?` });
    out.push({ source: 'google', text: `What factors should I consider when choosing ${phrase}?` });
    if (pageType === 'commerce') {
      out.push({ source: 'google', text: `What are common pros and cons of ${phrase}?` });
    }
  } else {
    out.push({ source: 'google', text: `${phrase}를 고를 때 무엇을 기준으로 삼아야 하나요?` });
    out.push({ source: 'google', text: `${phrase} 관련해 알아두면 좋은 정보는 무엇인가요?` });
    if (pageType === 'commerce') {
      out.push({ source: 'google', text: `${phrase}의 장단점은 무엇인가요?` });
    }
  }

  for (const sk of top) {
    const v = sk.value.trim();
    if (v.length < 2) continue;
    if (isEnglish) {
      out.push({ source: 'google', text: `How does ${v} compare to alternatives?` });
    } else {
      out.push({ source: 'google', text: `${v}는 다른 선택지와 어떻게 다른가요?` });
    }
    if (out.length >= 6) break;
  }

  return out;
}

export interface BuildCanonicalSearchQuestionsParams {
  evidence: SearchQuestion[];
  seedKeywords: SeedKeyword[];
  meta: Pick<AnalysisMeta, 'title' | 'ogTitle'>;
  topic: PrimaryTopic;
  pageType?: PageType;
}

/**
 * Build deduplicated canonical question intents for scoring (not raw SERP strings).
 */
export function buildCanonicalSearchQuestions(params: BuildCanonicalSearchQuestionsParams): SearchQuestion[] {
  const { evidence, seedKeywords, meta, topic, pageType } = params;
  const { primaryPhrase, isEnglishPage: isEnglish } = topic;
  const titleHint = (meta.title ?? meta.ogTitle ?? '').trim();

  const fromEvidence: SearchQuestion[] = [];
  const sources: SearchSource[] = [];

  for (const ev of evidence) {
    const canonical = normalizeEvidenceToQuestion(ev.text, isEnglish, primaryPhrase);
    if (!canonical) continue;
    fromEvidence.push({
      source: ev.source,
      text: canonical,
      url: ev.url,
    });
    sources.push(ev.source);
  }

  const fromSeeds = seedTemplateQuestions(seedKeywords, primaryPhrase, isEnglish, pageType);

  const fromTitle =
    titleHint.length >= 12
      ? [
          {
            source: pickSource(sources) as SearchSource,
            text:
              normalizeEvidenceToQuestion(titleHint, isEnglish, primaryPhrase) ??
              (isEnglish
                ? `What does this page explain about ${primaryPhrase}?`
                : `이 글이 ${primaryPhrase}에 대해 무엇을 설명하나요?`),
          },
        ]
      : [];

  const merged = dedupeCanonical([...fromEvidence, ...fromTitle, ...fromSeeds]);
  if (merged.length > 0) return merged;

  const phrase = primaryPhrase.trim() || 'this topic';
  return [
    {
      source: 'google' as const,
      text: isEnglish
        ? `What should I know about ${phrase}?`
        : `${phrase}에 대해 알아야 할 핵심은 무엇인가요?`,
    },
  ];
}
