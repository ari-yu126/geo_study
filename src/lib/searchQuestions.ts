import type { AnalysisMeta, SeedKeyword, SearchQuestion, SearchSource, PageType } from './analysisTypes';

const DEBUG_SEARCH_QUESTIONS = process.env.DEBUG_SEARCH_QUESTIONS === '1';

/** primaryPhrase + essentialTokens: 모든 Tavily 쿼리와 필터에 사용 */
export interface PrimaryTopic {
  primaryPhrase: string;
  essentialTokens: string[];
  isEnglishPage: boolean;
}

/** meta + url + seedKeywords로 primary topic 파생 */
export function derivePrimaryTopic(
  meta: { title: string | null; ogTitle?: string | null },
  url: string,
  seedKeywords: SeedKeyword[]
): PrimaryTopic {
  const tokenize = (s: string) =>
    s.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .split(/[\s-]+/)
      .filter((t) => t.length >= 2);

  const GENERIC_STOPWORDS = new Set([
    'best', 'top', 'review', 'guide', 'faq', 'tips', 'how', 'vs', 'comparison', 'overview', 'ultimate',
    'the', 'and', 'for', 'with', 'from', 'this', 'that',
    '추천', '후기', '모음', '공지사항', '수강후기', 'zip', '장점', '단점', '관련', '질문', '답변',
  ]);

  const isGeneric = (t: string) => GENERIC_STOPWORDS.has(t.toLowerCase()) || t.length < 3;

  // 1) URL path slug
  let slugTokens: string[] = [];
  try {
    const path = new URL(url).pathname;
    const slug = path.split('/').filter(Boolean).pop() ?? '';
    slugTokens = tokenize(slug.replace(/[-_]/g, ' '));
  } catch {
    /* ignore */
  }

  // 2) meta.title
  const title = (meta.title ?? meta.ogTitle ?? '').trim();
  const titleTokens = tokenize(title);

  // 3) seedKeywords top 5 (non-generic)
  const sortedKw = [...seedKeywords].sort((a, b) => b.score - a.score);
  const kwTokens = sortedKw
    .slice(0, 5)
    .flatMap((k) => tokenize(k.value))
    .filter((t) => !isGeneric(t));

  // 언어: 라틴 비율로 영어 페이지 여부
  const sample = (title + slugTokens.join(' ') + kwTokens.slice(0, 3).join(' ')).toLowerCase();
  const latin = (sample.match(/[a-z]/g) ?? []).length;
  const hangul = (sample.match(/[가-힣]/g) ?? []).length;
  const isEnglishPage = latin > hangul;

  // essentialTokens: title 우선, 그다음 slug, 그다음 kw (generic 제외)
  const seen = new Set<string>();
  const essentialTokens: string[] = [];
  for (const t of [...titleTokens, ...slugTokens, ...kwTokens]) {
    const lower = t.toLowerCase();
    if (!isGeneric(t) && !seen.has(lower) && essentialTokens.length < 5) {
      seen.add(lower);
      essentialTokens.push(lower);
    }
  }

  // 영어 페이지면 한글 키워드 제거
  const filteredEssential = isEnglishPage
    ? essentialTokens.filter((t) => !/[가-힣]/.test(t))
    : essentialTokens;

  // primaryPhrase: essential 2~4개 조합
  const phraseTokens = filteredEssential.slice(0, 4);
  const primaryPhrase = phraseTokens.length >= 2
    ? phraseTokens.join(' ')
    : filteredEssential[0] ?? '';

  if (DEBUG_SEARCH_QUESTIONS) {
    console.debug('[searchQuestions] primaryTopic:', {
      primaryPhrase,
      essentialTokens: filteredEssential,
      isEnglishPage,
      titleTokens,
      slugTokens,
      kwTokens,
    });
  }

  return { primaryPhrase, essentialTokens: filteredEssential, isEnglishPage };
}

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

/** 검색 제외 도메인 — 링크 단축 서비스, 성인 전용 사이트 (디시·펨코 등 커뮤니티는 허용) */
const EXCLUDE_DOMAINS = [
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'me2.kr', 'han.gl', 'shorturl.at', 'shorte.st',
  'tgr.me', 't.me',
];

function resolveSource(url: string | undefined, fallback: SearchSource): SearchSource {
  if (!url) return fallback;
  const lower = url.toLowerCase();
  return COMMUNITY_DOMAINS.some(d => lower.includes(d)) ? 'community' : fallback;
}

/** 단점·비교·구매 팁 위주 쿼리 타입 */
type QueryFocus = 'faq' | 'cons' | 'compare' | 'tips' | 'community';

/** primaryPhrase 없으면 기존 방식 (호환) */
function buildTavilyQuery(keyword: string, focus: QueryFocus): string {
  switch (focus) {
    case 'cons': return `${keyword} 단점 후기`;
    case 'compare': return `${keyword} 비교 추천`;
    case 'tips': return `${keyword} 구매 팁 구매가이드`;
    case 'community': return `"${keyword}" 단점 OR 비교 site:dcinside.com OR site:fmkorea.com OR site:theqoo.net OR site:ruliweb.com`;
    default: return `${keyword} 관련 자주 묻는 질문`;
  }
}

/** 엄격: primaryPhrase 필수. generic 단어만으로는 쿼리 금지 */
function buildTavilyQueryStrict(primaryPhrase: string, focus: QueryFocus, isEnglish: boolean): string {
  const phrase = primaryPhrase.trim();
  if (!phrase) return '';

  if (isEnglish) {
    switch (focus) {
      case 'cons': return `"${phrase}" cons drawbacks review`;
      case 'compare': return `"${phrase}" comparison best`;
      case 'tips': return `"${phrase}" buying guide tips`;
      case 'community': return `"${phrase}" reddit OR site:reddit.com`;
      default: return `"${phrase}" FAQ questions`;
    }
  }
  switch (focus) {
    case 'cons': return `"${phrase}" 단점 후기`;
    case 'compare': return `"${phrase}" 비교 추천`;
    case 'tips': return `"${phrase}" 구매 팁`;
    case 'community': return `"${phrase}" site:dcinside.com OR site:fmkorea.com OR site:theqoo.net OR site:reddit.com`;
    default: return `"${phrase}" 자주 묻는 질문`;
  }
}

/** Tavily 결과에서 추출한 질문 + 스니펫 (topic 필터용) */
interface QuestionWithSnippet {
  q: SearchQuestion;
  snippet?: string;
}

async function fetchFromTavilyStrict(
  primaryPhrase: string,
  source: SearchSource,
  queryFocus: QueryFocus,
  isEnglish: boolean
): Promise<QuestionWithSnippet[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  const query = buildTavilyQueryStrict(primaryPhrase, queryFocus, isEnglish);
  if (!query) return [];

  if (!apiKey) {
    return generateFallbackQuestions(primaryPhrase, source).map((q) => ({ q, snippet: undefined }));
  }

  const isCommunity = source === 'community' || queryFocus === 'community';
  if (DEBUG_SEARCH_QUESTIONS) {
    console.debug('[searchQuestions] Tavily query:', query);
  }

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
        exclude_domains: EXCLUDE_DOMAINS,
      }),
    });

    if (!res.ok) {
      return generateFallbackQuestions(primaryPhrase, source).map((q) => ({ q, snippet: undefined }));
    }

    const data = await res.json();
    const out: QuestionWithSnippet[] = [];

    if (data.answer) {
      const answerQuestions = extractQuestionCandidatesFromText(data.answer, source);
      for (const q of answerQuestions) {
        out.push({ q, snippet: data.answer });
      }
    }

    for (const result of data.results ?? []) {
      const title = result.title ?? '';
      const content = result.content ?? '';
      const url = result.url ?? '';
      const resolvedSource = resolveSource(url, source);

      const titleQuestionPattern = /\?|어떻게|무엇|왜|언제|방법|비용|추천|후기|단점|how|what|why|best|compare/i;
      if (titleQuestionPattern.test(title)) {
        out.push({ q: { source: resolvedSource, text: title, url }, snippet: content });
      }

      const contentQuestions = extractQuestionCandidatesFromText(content, resolvedSource, url);
      for (const q of contentQuestions) {
        out.push({ q, snippet: content });
      }
    }

    if (out.length === 0) {
      return generateFallbackQuestions(primaryPhrase, source).map((q) => ({ q, snippet: undefined }));
    }
    return out;
  } catch {
    return generateFallbackQuestions(primaryPhrase, source).map((q) => ({ q, snippet: undefined }));
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
 * NSFW·유해 콘텐츠 블랙리스트 (성인, 도박, 불법 광고 등).
 * isValidQuestion에서 해당 키워드 감지 시 즉시 false 반환.
 */
/** 테마 이탈 차단: DB/교육/언어학습 등 관련 없는 도메인 */
const NEGATIVE_TOPIC_KEYWORDS = [
  'database', 'backup', 'restore', 'sql', 'coding', 'grammar', 'translation',
  'language learning', 'education', 'course', '수강', '강의', '공무원', '교재',
  'italki', 'learn korean', 'korean grammar', '한국어 문법',
];

const EXCLUDE_TOPIC_DOMAINS = ['italki.com'];

/** topicMatchFilter: essentialTokens 1개 이상 필수, negative 키워드/도메인 즉시 제외 */
function topicMatchFilter(
  items: QuestionWithSnippet[],
  essentialTokens: string[],
  primaryPhrase: string
): QuestionWithSnippet[] {
  const negSet = new Set(NEGATIVE_TOPIC_KEYWORDS.map((k) => k.toLowerCase()));
  const exclDomains = new Set(EXCLUDE_TOPIC_DOMAINS.map((d) => d.toLowerCase()));
  const essentialSet = new Set(essentialTokens.map((t) => t.toLowerCase()));

  const hasEssential = (text: string, snippet?: string) => {
    const combined = ((text ?? '') + ' ' + (snippet ?? '')).toLowerCase();
    for (const t of essentialSet) {
      if (t.length >= 2 && combined.includes(t)) return true;
    }
    return false;
  };

  const hasNegative = (text: string, snippet?: string, urlStr?: string) => {
    const combined = ((text ?? '') + ' ' + (snippet ?? '') + ' ' + (urlStr ?? '')).toLowerCase();
    for (const n of negSet) {
      if (combined.includes(n)) return true;
    }
    return false;
  };

  return items.filter(({ q, snippet }) => {
    const url = q.url ?? '';
    const domain = url ? (() => {
      try {
        return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      } catch {
        return '';
      }
    })() : '';
    if (exclDomains.has(domain) || exclDomains.some((d) => domain.includes(d))) return false;
    if (hasNegative(q.text, snippet, url)) return false;
    if (essentialTokens.length > 0 && !hasEssential(q.text, snippet)) return false;
    if (domain.includes('reddit.com') && url.includes('/r/Korean') && essentialTokens.length > 0) {
      if (!hasEssential(q.text, snippet)) return false;
    }
    return true;
  });
}

/** 커뮤니티 비속어·과도한 욕설 등 — 자연스러운 질문(예: "XX 실사용 후기 어때요?")은 유지 */
const NSFW_BLACKLIST = [
  '성인', '성인용', '성인영상', '야동', '야한', '에로', '포르노', 'porn', 'xxx', 'nsfw',
  '출장', '출장안마', '출장마사지', '업소', '풀싸롱', '풀샵', '노콘', '와콘',
  '안마', '마사지텔', '오피', '립카페', '키스방', '건마',
  '조건', '조건만남', '캐쉬', '캐시만남', '번개',
  '카지노', '바카라', '슬롯', '토토', '사설토토', '배팅', '해외배팅', '스포츠토토',
  '대출', '빌보드', '무직', '신용불량', '개인돈', '개인대출', '사업자대출',
  '원정', '원정녀', '원정남', '아웃콜', 'outcall',
  '위텔', '텔레그램',
  '호빠', '룸싸롱', '노래방', '셔츠룸', '립', '키스',
  '야설', '무료야동', 'av배우', 'av ', '유출',
];

/**
 * 유해(NSFW·도박·불법) 키워드가 포함된 질문인지 검사.
 * 포함 시 false 반환 (즉시 제외).
 */
function isValidQuestion(text: string): boolean {
  const t = text.toLowerCase().replace(/\s+/g, ' ');
  for (const kw of NSFW_BLACKLIST) {
    if (t.includes(kw.toLowerCase())) return false;
  }
  return true;
}

/** 스팸 링크, 전화번호, 텔레그램/카카오 ID 등 — 커뮤니티 댓글 스팸 패턴 */
function hasSpamOrSuspiciousPattern(text: string): boolean {
  const t = text.trim();
  // URL/링크 단축키
  if (/https?:\/\/\S*(bit\.ly|t\.co|tinyurl|goo\.gl|shorturl|me2\.kr)/i.test(t)) return true;
  // 카카오톡 오픈채팅 링크 (광고/아웃콜 스팸에 자주 사용)
  if (/open\.kakao\.com|pf\.kakao\.com|kakao\.com\/o\//i.test(t)) return true;
  // 전화번호 (010-1234-5678, 01012345678 등)
  if (/0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}/.test(t)) return true;
  if (/\d{10,11}/.test(t) && /연락|문의|연락처|전화|카톡|톡|dm|쪽지/i.test(t)) return true;
  // 텔레그램 ID (@xxxx, t.me/xxxx)
  if (/@[a-zA-Z0-9_]{4,}/.test(t)) return true;
  if (/t\.me\/[a-zA-Z0-9_]+|텔레\s*@|tg\s*@|위텔\s*@/i.test(t)) return true;
  // 아웃콜/출장 광고 패턴 (숫자+문의, 연락 등)
  if (/아웃콜|출장.*연락|문의.*\d{3,}/i.test(t) && /\d{10,}|@|카톡|톡/i.test(t)) return true;
  return false;
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

  // 스팸 링크, 전화번호, 텔레그램 ID 등
  if (hasSpamOrSuspiciousPattern(t)) return true;

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

export interface FetchSearchQuestionsOptions {
  pageType?: PageType;
  meta?: Pick<AnalysisMeta, 'title' | 'ogTitle'>;
  url?: string;
}

/**
 * seed 키워드 목록을 받아서 외부 검색/커뮤니티에서 질문형 문장을 수집합니다.
 * meta + url이 있으면 primary topic 기반 엄격 쿼리/필터 적용.
 *
 * @param seedKeywords - 추출된 seed 키워드 배열
 * @param options - pageType, meta, url
 * @returns 수집된 질문 배열
 */
export async function fetchSearchQuestions(
  seedKeywords: SeedKeyword[],
  options?: FetchSearchQuestionsOptions
): Promise<SearchQuestion[]> {
  try {
    if (!seedKeywords || seedKeywords.length === 0) return [];

    const meta = options?.meta ?? { title: null, ogTitle: null };
    const url = options?.url ?? '';

    const topic = derivePrimaryTopic(meta, url, seedKeywords);
    const { primaryPhrase, essentialTokens, isEnglishPage } = topic;

    if (!primaryPhrase || essentialTokens.length === 0) {
      if (DEBUG_SEARCH_QUESTIONS) console.debug('[searchQuestions] primaryPhrase/essentialTokens empty, skip');
      return [];
    }

    const primaryTasks = [
      fetchFromTavilyStrict(primaryPhrase, 'google', 'faq', isEnglishPage),
      fetchFromTavilyStrict(primaryPhrase, 'google', 'cons', isEnglishPage),
      fetchFromTavilyStrict(primaryPhrase, 'community', 'community', isEnglishPage),
    ];

    const resultsArrays = await Promise.all(primaryTasks);
    let allWithSnippet: QuestionWithSnippet[] = resultsArrays.flat();

    const beforeTopic = allWithSnippet.length;
    allWithSnippet = topicMatchFilter(allWithSnippet, essentialTokens, primaryPhrase);
    const afterTopic = allWithSnippet.length;

    const allQuestions = allWithSnippet.map(({ q }) => q);

    if (DEBUG_SEARCH_QUESTIONS) {
      console.debug('[searchQuestions] seedKeywords top10:', seedKeywords.slice(0, 10).map((k) => k.value));
      console.debug('[searchQuestions] before/after topic filter:', beforeTopic, '->', afterTopic);
      console.debug('[searchQuestions] final sample top10:', allQuestions.slice(0, 10).map((q) => q.text.slice(0, 60)));
    }

    const dedupedQuestions = dedupeQuestions(allQuestions);
    const safeQuestions = dedupedQuestions.filter((q) => isValidQuestion(q.text));
    const nonJunkQuestions = safeQuestions.filter((q) => !isJunkQuestion(q.text));
    const relevantQuestions = nonJunkQuestions.filter((q) =>
      isRelevantToKeywords(q.text, essentialTokens, Math.min(2, essentialTokens.length))
    );
    const filteredQuestions = relevantQuestions.filter((q) => q.text.length > 5);

    return filteredQuestions;
  } catch (error) {
    console.error('fetchSearchQuestions 전체 오류:', error);
    return [];
  }
}
