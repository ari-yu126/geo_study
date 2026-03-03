import type { SeedKeyword, SearchQuestion, SearchSource } from './analysisTypes';

/**
 * 텍스트 덩어리에서 질문형 문장을 추출합니다.
 */
function extractQuestionCandidatesFromText(
  text: string,
  source: SearchSource,
  url?: string
): SearchQuestion[] {
  // 문장 단위로 분리 (마침표, 물음표, 느낌표 기준)
  const sentences = text.split(/[.!?]\s+/).map(s => s.trim());

    const questionKeywords = [
    '어떻게', '언제', '왜', '무엇', '가능', '방법',
    '비용', '기간', '차이', '추천', '어디', '누가',
    '추천좀', '써본사람', '어떰', '살만함', '후기', '단점', '실제',
  ];

  const questions: SearchQuestion[] = [];

  for (const sentence of sentences) {
    // 너무 짧은 문장은 제외
    if (sentence.length <= 5) continue;

    // 질문 조건: ?가 포함되거나 질문 키워드가 포함/끝남
    const hasQuestionMark = sentence.includes('?');
    const hasKeyword = questionKeywords.some(
      kw => sentence.includes(kw) || sentence.trim().endsWith(kw)
    );

    if (hasQuestionMark || hasKeyword) {
      questions.push({
        source,
        text: sentence,
        url,
      });
    }
  }

  return questions;
}

const COMMUNITY_DOMAINS = ['dcinside.com', 'fmkorea.com', 'theqoo.net', 'ruliweb.com'];

function resolveSource(url: string | undefined, fallback: SearchSource): SearchSource {
  if (!url) return fallback;
  const lower = url.toLowerCase();
  return COMMUNITY_DOMAINS.some(d => lower.includes(d)) ? 'community' : fallback;
}

/** 단점·비교·구매 팁 위주 쿼리 타입 */
type QueryFocus = 'faq' | 'cons' | 'compare' | 'tips' | 'community';

function buildTavilyQuery(keyword: string, focus: QueryFocus): string {
  switch (focus) {
    case 'cons': return `${keyword} 단점 후기`;
    case 'compare': return `${keyword} 비교 추천`;
    case 'tips': return `${keyword} 구매 팁 구매가이드`;
    case 'community': return `"${keyword}" 단점 OR 비교 site:dcinside.com OR site:fmkorea.com OR site:theqoo.net OR site:ruliweb.com`;
    default: return `${keyword} 관련 자주 묻는 질문`;
  }
}

async function fetchFromTavily(
  keyword: string,
  source: SearchSource = 'google',
  queryFocus: QueryFocus = 'faq'
): Promise<SearchQuestion[]> {
  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    return generateFallbackQuestions(keyword, source);
  }

  const isCommunity = source === 'community' || queryFocus === 'community';
  const query = isCommunity ? buildTavilyQuery(keyword, 'community') : buildTavilyQuery(keyword, queryFocus);

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: isCommunity ? 'advanced' : 'basic',
        max_results: 5,
        include_answer: true,
      }),
    });

    if (!res.ok) {
      return generateFallbackQuestions(keyword, source);
    }

    const data = await res.json();
    const questions: SearchQuestion[] = [];

    if (data.answer) {
      const answerQuestions = extractQuestionCandidatesFromText(data.answer, source);
      questions.push(...answerQuestions);
    }

    for (const result of data.results ?? []) {
      const title = result.title ?? '';
      const content = result.content ?? '';
      const url = result.url ?? '';
      const resolvedSource = resolveSource(url, source);

      const titleQuestionPattern = /\?|어떻게|무엇|왜|언제|방법|비용|추천좀|써본사람|어떰|후기|단점/;
      if (titleQuestionPattern.test(title)) {
        questions.push({ source: resolvedSource, text: title, url });
      }

      const contentQuestions = extractQuestionCandidatesFromText(content, resolvedSource, url);
      questions.push(...contentQuestions);
    }

    return questions.length > 0 ? questions : generateFallbackQuestions(keyword, source);
  } catch {
    return generateFallbackQuestions(keyword, source);
  }
}

function generateFallbackQuestions(
  keyword: string,
  source: SearchSource
): SearchQuestion[] {
  return [
    { source, text: `${keyword}는 어떻게 사용하나요?`, url: undefined },
    { source, text: `${keyword} 비용은 얼마인가요?`, url: undefined },
    { source, text: `${keyword} 선택 시 주의할 점은 무엇인가요?`, url: undefined },
    { source, text: `${keyword}의 장단점은 무엇인가요?`, url: undefined },
    { source, text: `${keyword} 관련 자주 묻는 질문은 무엇인가요?`, url: undefined },
  ];
}

/**
 * 스팸/잡문/junk 여부 검사.
 * URL, 테이블 행, 마크다운, 위키 경로, 공지 구조 등 실제 질문이 아닌 텍스트 제외.
 */
function isJunkQuestion(text: string): boolean {
  const t = text.trim();
  if (t.length < 10) return true;

  // URL 포함
  if (/https?:\/\//i.test(t)) return true;
  if (/\]\([^)]*\)/.test(t)) return true; // markdown [text](url)
  if (/\/edit\/|%[0-9a-f]{2}|section=/i.test(t)) return true; // wiki edit, url-encoded, ?section=

  // 테이블 행 패턴 (| 로 구분된 여러 열)
  const pipeCount = (t.match(/\|/g) ?? []).length;
  if (pipeCount >= 2) return true;

  // 위키/테이블 구조: 연속 파이프, 구분선
  if (/\|\s*\|/.test(t) || /---\s*\|/.test(t)) return true;

  // 펼치기/접기 등 UI 텍스트
  if (/펼치기\s*·\s*접기/i.test(t)) return true;

  // 위키 목록/카테고리 (중점 · 5회 이상 = 항목 나열)
  const dotCount = (t.match(/ · /g) ?? []).length;
  if (dotCount >= 5) return true;

  // ## 1, ## 2 같은 헤딩 번호
  if (/^#+\s*\d+\s*$/.test(t) || /^\d+\s*$/.test(t)) return true;

  // 공지/카테고리/날짜 형식
  if (/^\|\s*공지\s*\|/i.test(t) || (/\|\s*공지\s*\|/i.test(t) && pipeCount >= 1)) return true;
  if (/^\d{2}\.\d{2}\.\d{2}\s*\|/.test(t) || /\|\s*\d{2}\.\d{2}\.\d{2}\s*\|/.test(t)) return true;

  // 문장이 ? 로 끝나지 않고, 질문형 종결어미도 없으면 의미 있는 질문일 가능성 낮음
  const hasQuestionEnd = /\?|있나요|되나요|인가요|할까|뭔가|뭐야|어떻게\s|왜\s|언제\s|무엇/.test(t);
  // 길이가 150자 넘고 질문 끝도 없으면 본문 조각/테이블 가능성
  if (t.length > 150 && !hasQuestionEnd) return true;

  // 법률·보이스피싱·형사 등 완전히 다른 도메인 질문 제거
  if (/보이스피싱|전기통신사업법|처벌받을|벌금형|선고유예|명의\s*휴대전화/.test(t)) return true;

  return false;
}

// 2글자 이하이거나 여러 도메인에서 흔히 쓰이는 토큰 → 관련성 판단에 사용 안 함
const WEAK_TOKENS = new Set([
  '사례', '방법', '변경', '관련', '질문', '답변', '사용', '이용', '경우', '부분',
  '문제', '원인', '해결', '정리', '추천', '가이드', '비교', '선택', '개선',
]);

function isWeakToken(t: string): boolean {
  return t.length <= 2 || WEAK_TOKENS.has(t);
}

/**
 * 질문이 seed 키워드와 관련 있는지 검사합니다.
 * - 핵심 키워드(상위 2개) 중 하나는 반드시 포함되어야 함
 * - 나머지 키워드만으로는 짧고 흔한 토큰(사례·방법 등) 일치만으로 통과 불가
 */
function isRelevantToKeywords(
  questionText: string,
  keywords: string[],
  coreKeywordCount: number = 2
): boolean {
  const text = questionText.toLowerCase().replace(/\s+/g, ' ');
  if (keywords.length === 0) return true;

  const core = keywords.slice(0, coreKeywordCount);

  // 핵심 키워드: 직접 포함 또는 3글자 이상 공통 토큰
  for (const kw of core) {
    const k = kw.toLowerCase().trim();
    if (k.length < 2) continue;
    if (text.includes(k)) return true;
  }

  const tokenize = (s: string) =>
    s.replace(/[^\p{L}\p{N}]/gu, ' ').split(/\s+/).filter(t => t.length >= 2);
  const qTokens = new Set(tokenize(text));

  // 핵심 키워드의 토큰 중 약하지 않은 것이 질문에 있으면 통과
  for (const kw of core) {
    const kTokens = tokenize(kw.toLowerCase());
    for (const t of kTokens) {
      if (!isWeakToken(t) && qTokens.has(t)) return true;
    }
  }

  // 나머지 키워드만으로는 통과 불가 (핵심 키워드가 매칭되어야 함)
  return false;
}

/**
 * SearchQuestion 배열에서 중복을 제거합니다.
 * text를 기준으로 중복을 판단합니다.
 */
function dedupeQuestions(questions: SearchQuestion[]): SearchQuestion[] {
  const seen = new Set<string>();
  const dedupedQuestions: SearchQuestion[] = [];

  for (const question of questions) {
    // 대소문자 구분 없이, 공백 정규화해서 중복 체크
    const normalizedText = question.text.toLowerCase().replace(/\s+/g, ' ').trim();

    if (!seen.has(normalizedText)) {
      seen.add(normalizedText);
      dedupedQuestions.push(question);
    }
  }

  return dedupedQuestions;
}

/**
 * seed 키워드 목록을 받아서 외부 검색/커뮤니티에서 질문형 문장을 수집합니다.
 * 
 * @param seedKeywords - 추출된 seed 키워드 배열
 * @param maxPerKeyword - 각 키워드당 최대 질문 수 (기본값: 5)
 * @returns 수집된 질문 배열
 */
export async function fetchSearchQuestions(
  seedKeywords: SeedKeyword[],
  maxPerKeyword: number = 5
): Promise<SearchQuestion[]> {
  try {
    // 엣지 케이스: 키워드가 없으면 빈 배열 반환
    if (!seedKeywords || seedKeywords.length === 0) {
      return [];
    }

    // score 기준으로 내림차순 정렬
    const sortedKeywords = [...seedKeywords].sort((a, b) => b.score - a.score);

    // 상위 3개 키워드만 사용 (Tavily 호출 절약)
    const topKeywords = sortedKeywords.slice(0, 3);

    // 1순위 키워드: faq + cons + community (총 3회)
    const primary = topKeywords[0];
    const primaryTasks = [
      fetchFromTavily(primary.value, 'google', 'faq'),
      fetchFromTavily(primary.value, 'google', 'cons'),
      fetchFromTavily(primary.value, 'community', 'community'),
    ];

    // 2순위 키워드: faq만 1회 (추가 1회)
    const otherTasks = topKeywords.length > 1
      ? [fetchFromTavily(topKeywords[1].value, 'google', 'faq')]
      : [];

    const tasks = [...primaryTasks, ...otherTasks];

    const resultsArrays = await Promise.all(tasks);
    const allQuestions: SearchQuestion[] = resultsArrays.flat();

    // 중복 제거
    const dedupedQuestions = dedupeQuestions(allQuestions);

    // junk 필터: URL, 테이블, 공지, 마크다운 등 실제 질문이 아닌 텍스트 제거
    const nonJunkQuestions = dedupedQuestions.filter(q => !isJunkQuestion(q.text));

    // 관련성 필터: seed 키워드와 무관한 질문 제거
    const keywordValues = topKeywords.map(k => k.value);
    const relevantQuestions = nonJunkQuestions.filter(q =>
      isRelevantToKeywords(q.text, keywordValues)
    );

    // 너무 짧거나 의미없는 문장 필터링
    const filteredQuestions = relevantQuestions.filter(q => q.text.length > 5);

    return filteredQuestions;

  } catch (error) {
    console.error('fetchSearchQuestions 전체 오류:', error);
    return [];
  }
}
