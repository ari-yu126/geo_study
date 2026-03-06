import { geminiFlash } from './geminiClient';
import type { SearchQuestion } from './analysisTypes';

/** 실제 AI 인용이 확인된 도메인 화이트리스트 — Gemini/Perplexity 검증 실패 시에도 사용 */
const ACTUAL_AI_DOMAINS = ['lgesy.com'];

export function hasActualAiCitationDomain(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^www\./, '');
  return ACTUAL_AI_DOMAINS.some(
    (d) => normalized === d || normalized.endsWith('.' + d)
  );
}

/**
 * 실제 AI 인용 검증(Grounding): Perplexity/Google AI Overview가 해당 주제에 대해
 * 주로 인용하는 도메인 TOP 5~10을 조회하고, 분석 대상 사이트가 포함되는지 확인합니다.
 *
 * - PERPLEXITY_API_KEY 있으면 Perplexity API로 실제 인용 도메인 추출 (향후 구현)
 * - 없으면 Gemini로 "AI가 이 주제에서 흔히 인용하는 도메인" 예측
 */
export async function checkActualAiCitation(
  analysisHost: string,
  searchQuestions: SearchQuestion[],
  pageTitle: string | null
): Promise<boolean> {
  if (!analysisHost) return false;

  // Perplexity API가 있으면 우선 사용 (실제 인용 데이터)
  const perplexityKey = process.env.PERPLEXITY_API_KEY;
  if (perplexityKey && searchQuestions.length > 0) {
    const fromPerplexity = await fetchActualCitationDomainsFromPerplexity(
      perplexityKey,
      searchQuestions
    );
    if (fromPerplexity.length > 0) {
      return domainMatches(analysisHost, fromPerplexity);
    }
  }

  // Fallback: Gemini로 AI 인용 도메인 예측
  if (!geminiFlash) return false;

  const sampleQuestions = searchQuestions.slice(0, 5).map((q) => q.text).join('\n- ');
  const title = pageTitle ?? '제목 없음';

  const prompt = `당신은 Perplexity, Google AI Overview가 실제로 인용하는 웹사이트 패턴을 알고 있는 평가자입니다.

다음 사용자 질문들에 대해, AI 검색(Perplexity, Google AI Overview)이 답변 시 **실제로 인용하는 도메인 TOP 5~10**을 나열해주세요.
위키백과, 네이버, 다나와, 쿠팡, 아마존, 제조사 공식사이트, 공공기관 등 AI가 신뢰해서 인용하는 도메인을 구체적으로 적어주세요.

페이지 제목: ${title}

사용자 질문 예시:
- ${sampleQuestions || '(질문 없음)'}

출력 형식: 도메인만 한 줄에 하나씩. 예:
naver.com
danawa.com
wikipedia.org
coupang.com
samsung.com

(최대 10개, 소문자, www 제외)

도메인 목록:`;

  try {
    const result = await geminiFlash.generateContent([{ text: prompt }]);
    const raw = result.response.text().trim();
    const domains = raw
      .split(/\n/)
      .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim().toLowerCase())
      .filter((d) => d.length >= 4 && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d));
    return domainMatches(analysisHost, domains);
  } catch (err) {
    console.warn('checkActualAiCitation failed', err);
    return false;
  }
}

async function fetchActualCitationDomainsFromPerplexity(
  apiKey: string,
  searchQuestions: SearchQuestion[]
): Promise<string[]> {
  const query = searchQuestions.slice(0, 2).map((q) => q.text).join(' ') || 'product recommendation';
  try {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [{ role: 'user', content: query }],
        max_tokens: 1024,
        return_citations: true,
      }),
    });
    if (!res.ok) return [];

    const data = (await res.json()) as {
      citations?: string[];
      search_results?: Array<{ url?: string }>;
    };
    const urls: string[] = data.citations ?? [];
    if (urls.length === 0 && data.search_results) {
      for (const r of data.search_results) {
        if (r.url) urls.push(r.url);
      }
    }
    const domains: string[] = [];
    for (const u of urls) {
      try {
        const host = new URL(u).hostname.toLowerCase().replace(/^www\./, '');
        if (host && !domains.includes(host)) domains.push(host);
      } catch {
        /* skip */
      }
    }
    return domains.slice(0, 10);
  } catch {
    return [];
  }
}

function domainMatches(analysisHost: string, citationDomains: string[]): boolean {
  const h = analysisHost.toLowerCase();
  for (const d of citationDomains) {
    const dLower = d.toLowerCase().replace(/^www\./, '');
    if (h === dLower || h.endsWith('.' + dLower) || dLower.endsWith('.' + h)) return true;
  }
  return false;
}
