import type {
  AnalysisMeta,
  PageType,
  QuestionSourceStatus,
  SearchQuestion,
  SearchSource,
  SeedKeyword,
} from './analysisTypes';
import { normalizeUrl } from './normalizeUrl';
import {
  buildQuestionResearchCacheKey,
  getCachedQuestionResearch,
  saveQuestionResearchCache,
} from './questionResearchCache';
import { logQuestionPipelineStage, shouldLogQuestionPipelineTrace } from './questionPipelineTrace';

const DEBUG_SEARCH_QUESTIONS = process.env.DEBUG_SEARCH_QUESTIONS === '1';

// Developer/framework tokens to avoid when page is commerce
const WEB_DEV_BLACKLIST = [
  'next.js', 'nextjs', 'next', 'react', 'vercel', 'static site generation', 'static site', 'ssg', 'gatsby', 'nuxt', 'jekyll', 'hugo', 'cms'
];

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
  seedKeywords: SeedKeyword[],
  pageType?: PageType
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

  /** URL path segments that look like a topic but are not (CMS routes, listing shells). */
  const GENERIC_PATH_SLUGS = new Set([
    'info', 'index', 'page', 'pages', 'detail', 'details', 'view', 'article', 'articles',
    'post', 'posts', 'list', 'listing', 'category', 'categories', 'search', 'home', 'main',
    'default', 'content', 'item', 'items', 'board', 'bbs', 'news', 'event', 'events',
    'cart', 'checkout',
  ]);

  const isGeneric = (t: string) => {
    const lower = t.toLowerCase();
    return GENERIC_STOPWORDS.has(lower) || GENERIC_PATH_SLUGS.has(lower) || t.length < 3;
  };

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

  // Commerce-specific: avoid single-brand/domain tokens as primary.
  // If we only detected a brand token (e.g., "ssg"), try to pair it with a product token from seed/title/slug.
  if (pageType === 'commerce') {
    try {
      const hostRoot = new URL(url).hostname.toLowerCase().replace(/^www\./, '').split('.')[0];
      // remove web-dev tokens from essentials
      let fe = filteredEssential.filter((t) => !WEB_DEV_BLACKLIST.includes(t.toLowerCase()));
      if (fe.length === 1 && hostRoot && fe[0] === hostRoot) {
        // prefer seed keyword candidates, then title, then slug
        const productCandidate =
          kwTokens.find((t) => t !== hostRoot && !isGeneric(t) && t.length >= 3) ||
          titleTokens.find((t) => t !== hostRoot && !isGeneric(t) && t.length >= 3) ||
          slugTokens.find((t) => t !== hostRoot && !isGeneric(t) && t.length >= 3);
        if (productCandidate) {
          fe = [hostRoot, productCandidate];
        }
      }
      // ensure at least one token remains
      if (fe.length > 0) {
        // limit to 5 tokens
        while (fe.length > 5) fe.pop();
      }
      // assign back
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      // (preserve variable name expected by rest of function)
      // @ts-ignore
      filteredEssential.length = 0;
      // copy
      for (const t of fe) filteredEssential.push(t);
    } catch {
      // ignore
    }
  }

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

const QUESTION_KEYWORD_HINTS_KO = [
  '어떻게', '언제', '왜', '무엇', '가능', '방법',
  '비용', '기간', '차이', '추천', '어디', '누가',
  '추천좀', '써본사람', '어떰', '살만함', '후기', '단점', '실제',
];

/** Explicit question shape (legacy fast path). */
function looksLikeExplicitQuestion(sentence: string, isEnglish: boolean): boolean {
  if (sentence.includes('?') || sentence.includes('？')) return true;
  if (isEnglish) {
    return /^(what|which|how|why|when|where|who|is |are |do |does |can |should |would )/i.test(sentence.trim());
  }
  return QUESTION_KEYWORD_HINTS_KO.some((kw) => sentence.includes(kw) || sentence.trim().endsWith(kw));
}

/** Product / comparison / shopping search signals (not only interrogatives). */
const SEARCH_INTENT_RE_KO =
  /비교|추천|후기|단점|장점|구매|가격|성능|리뷰|순위|랭킹|베스트|차이|총정리|정리|vs|VS|어떤|무엇|추천템|사용법|선택|입문|가이드/;

const SEARCH_INTENT_RE_EN =
  /\b(vs\.?|versus|review|reviews|compare|comparison|comparing|best|buy|price|worth|guide|ranking|rankings|pros|cons|alternative|alternatives|worth it|should i)\b/i;

function hasSearchIntentSignals(text: string, isEnglish: boolean): boolean {
  const t = text.trim();
  if (isEnglish) return SEARCH_INTENT_RE_EN.test(t);
  return SEARCH_INTENT_RE_KO.test(t);
}

function hasTopicOverlap(
  text: string,
  essentialTokens: string[],
  primaryPhrase: string
): boolean {
  const lower = text.toLowerCase();
  const phrase = primaryPhrase.trim().toLowerCase();
  if (phrase.length >= 4 && lower.includes(phrase)) return true;
  for (const raw of essentialTokens) {
    const tok = raw.toLowerCase().trim();
    if (tok.length >= 2 && lower.includes(tok)) return true;
  }
  return false;
}

const BOILERPLATE_RE = /쿠키|이용약관|개인정보|로그인|회원가입|copyright|©|all rights reserved|javascript:\s*void|subscribe to|뉴스레터/i;

function isBoilerplateLine(text: string): boolean {
  return BOILERPLATE_RE.test(text) || /^\s*\|.*\|\s*$/.test(text);
}

/**
 * NSFW·유해 콘텐츠 블랙리스트 (성인, 도박, 불법 광고 등).
 * isValidQuestion에서 해당 키워드 감지 시 즉시 false 반환.
 */
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

/**
 * Optional: light question-shaped ending for Korean listicle titles (no generic FAQ templates).
 */
function lightIntentToQuestionForm(raw: string, isEnglish: boolean): string {
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!t) return t;
  if (/[?？]/.test(t)) return t;
  if (isEnglish) {
    if (/[.!…]$/.test(t) || t.length > 120) return t;
    return `${t}?`;
  }
  let u = t.replace(/\s*(TOP\s*\d+|top\s*\d+|BEST\s*\d+|베스트\s*\d+)\s*$/i, '').trim();
  if (u.length < 4) u = t;
  if (/추천$/u.test(u)) return u.replace(/추천$/u, '추천은?');
  return u;
}

export type QuestionExtractionDebugCollector = {
  rawTavilyItems: Array<{ kind: string; text: string; url?: string }>;
  accepted: Array<{ text: string; via: string }>;
  rejected: Array<{ text: string; reason: string }>;
};

function shouldLogQuestionExtractionDebug(): boolean {
  return process.env.QUESTION_EXTRACTION_DEBUG === '1';
}

function splitIntoIntentSegments(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const chunks = normalized.includes('\n')
    ? normalized.split(/\n+/).map((x) => x.trim()).filter(Boolean)
    : normalized.split(/[.!?]\s+/u).map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length >= 6 && chunk.length <= 220) {
      out.push(chunk);
    } else if (chunk.length > 220) {
      const subs = chunk.split(/[.!?]\s+/u).map((x) => x.trim()).filter(Boolean);
      for (const sub of subs) {
        if (sub.length >= 6 && sub.length <= 220) out.push(sub);
      }
    }
  }
  return out;
}

type IntentEval = { accept: true; via: string } | { accept: false; reason: string };

function evaluateIntentSegment(
  segment: string,
  essentialTokens: string[],
  primaryPhrase: string,
  isEnglish: boolean
): IntentEval {
  const seg = segment.replace(/\s+/g, ' ').trim();
  if (seg.length < 6) return { accept: false, reason: 'too_short' };
  if (seg.length > 220) return { accept: false, reason: 'too_long' };
  if (isBoilerplateLine(seg)) return { accept: false, reason: 'boilerplate' };
  if (!isValidQuestion(seg)) return { accept: false, reason: 'nsfw_or_blocked' };

  if (looksLikeExplicitQuestion(seg, isEnglish)) return { accept: true, via: 'explicit_question' };
  if (hasTopicOverlap(seg, essentialTokens, primaryPhrase)) return { accept: true, via: 'topic_keyword' };
  if (hasSearchIntentSignals(seg, isEnglish)) return { accept: true, via: 'search_intent_signal' };
  return { accept: false, reason: 'no_topic_no_intent' };
}

function extractIntentCandidatesFromText(
  text: string,
  source: SearchSource,
  url: string | undefined,
  essentialTokens: string[],
  primaryPhrase: string,
  isEnglish: boolean,
  debug: QuestionExtractionDebugCollector | undefined,
  sourceLabel: string
): SearchQuestion[] {
  const segments = splitIntoIntentSegments(text);
  const questions: SearchQuestion[] = [];
  const seen = new Set<string>();

  for (const seg of segments) {
    const ev = evaluateIntentSegment(seg, essentialTokens, primaryPhrase, isEnglish);
    if (ev.accept) {
      const finalText = lightIntentToQuestionForm(seg, isEnglish);
      const key = finalText.toLowerCase().replace(/\s+/g, ' ').trim();
      if (seen.has(key)) continue;
      seen.add(key);
      questions.push({ source, text: finalText, url });
      debug?.accepted.push({ text: finalText, via: `${sourceLabel}:${ev.via}` });
    } else {
      debug?.rejected.push({ text: seg.slice(0, 200), reason: ev.reason });
    }
  }
  return questions;
}

/**
 * Evaluate a single title or short line (no sentence split).
 */
function evaluateTitleOrLine(
  line: string,
  resolvedSource: SearchSource,
  url: string | undefined,
  essentialTokens: string[],
  primaryPhrase: string,
  isEnglish: boolean,
  debug: QuestionExtractionDebugCollector | undefined,
  sourceLabel: string
): SearchQuestion | null {
  const ev = evaluateIntentSegment(line, essentialTokens, primaryPhrase, isEnglish);
  if (!ev.accept) {
    debug?.rejected.push({ text: line.slice(0, 200), reason: ev.reason });
    return null;
  }
  const finalText = lightIntentToQuestionForm(line, isEnglish);
  debug?.accepted.push({ text: finalText, via: `${sourceLabel}:${ev.via}` });
  return { source: resolvedSource, text: finalText, url };
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

/** 엄격: primaryPhrase 필수. generic 단어만으로는 쿼리 금지 */
function buildTavilyQueryStrict(primaryPhrase: string, focus: QueryFocus, isEnglish: boolean, pageType?: PageType): string {
  const phrase = primaryPhrase.trim();
  if (!phrase) return '';

  const WEB_DEV_NEGATIVE = [
    'Next.js', 'Nextjs', 'next.js', 'nextjs', 'React', 'Vercel', 'Static Site Generation', 'SSG', 'Gatsby', 'Nuxt', 'Jekyll', 'Hugo', 'CMS'
  ];
  const negativeSuffix = pageType === 'commerce' ? ' ' + WEB_DEV_NEGATIVE.map((t) => `-${t}`).join(' ') : '';

  if (isEnglish) {
    switch (focus) {
      case 'cons': return `"${phrase}" cons drawbacks review` + negativeSuffix;
      case 'compare': return `"${phrase}" comparison best` + negativeSuffix;
      case 'tips': return `"${phrase}" buying guide tips` + negativeSuffix;
      case 'community': return `"${phrase}" reddit OR site:reddit.com` + negativeSuffix;
      default: return `"${phrase}" FAQ questions` + negativeSuffix;
    }
  }
  switch (focus) {
    case 'cons': return `"${phrase}" 단점 후기` + negativeSuffix;
    case 'compare': return `"${phrase}" 비교 추천` + negativeSuffix;
    case 'tips': return `"${phrase}" 구매 팁` + negativeSuffix;
    case 'community': return `"${phrase}" site:dcinside.com OR site:fmkorea.com OR site:theqoo.net OR site:reddit.com` + negativeSuffix;
    default: return `"${phrase}" 자주 묻는 질문` + negativeSuffix;
  }
}

/** Tavily 결과에서 추출한 질문 + 스니펫 (topic 필터용) */
interface QuestionWithSnippet {
  q: SearchQuestion;
  snippet?: string;
}

const TAVILY_SEARCH_ENDPOINT = 'https://api.tavily.com/search';

/** Tavily request/response/summary + video branch checkpoints when either flag is set. */
function shouldLogTavilyExecution(): boolean {
  return process.env.TAVILY_EXECUTION_DEBUG === '1' || process.env.VIDEO_TAVILY_TRACE === '1';
}

/** Compare with the key shown in Tavily dashboard (never log full secret). */
function tavilyApiKeyFingerprint(apiKey: string | undefined): {
  present: boolean;
  fingerprint: string;
  length: number;
} {
  if (!apiKey || apiKey.trim().length === 0) {
    return { present: false, fingerprint: 'none', length: 0 };
  }
  const k = apiKey.trim();
  if (k.length <= 8) {
    return { present: true, fingerprint: `short_key_len_${k.length}`, length: k.length };
  }
  return { present: true, fingerprint: `${k.slice(0, 4)}…${k.slice(-4)}`, length: k.length };
}

/** Always returned with fetchSearchQuestions — used to derive questionSourceStatus (quota / fallback UI). */
export type TavilyFetchMeta = {
  cacheHit: boolean;
  /** True when three parallel Tavily calls ran after cache miss */
  tavilyNetworkScheduled: boolean;
  httpOkCalls: number;
  mergedRawRowsBeforePostFilters: number;
  /** Entire fetchSearchQuestions threw — treat as no Tavily rows */
  internalFetchError?: boolean;
};

const EMPTY_TAVILY_META: TavilyFetchMeta = {
  cacheHit: false,
  tavilyNetworkScheduled: false,
  httpOkCalls: 0,
  mergedRawRowsBeforePostFilters: 0,
};

export type FetchSearchQuestionsResult = {
  questions: SearchQuestion[];
  tavilyMeta: TavilyFetchMeta;
};

export function deriveQuestionSourceStatus(
  meta: TavilyFetchMeta,
  fallbackUsed: boolean
): QuestionSourceStatus {
  if (fallbackUsed) return 'fallback_only';
  if (meta.cacheHit) return 'tavily_success';
  if (!meta.tavilyNetworkScheduled) return 'tavily_failed';
  if (meta.httpOkCalls === 0 || meta.mergedRawRowsBeforePostFilters === 0) return 'tavily_failed';
  return 'tavily_success';
}

export function logQuestionSourceStatus(payload: {
  normalizedUrl: string;
  questionSourceStatus: QuestionSourceStatus;
  tavilyMeta: TavilyFetchMeta;
  fallbackUsed: boolean;
}): void {
  const { tavilyMeta } = payload;
  const tavilyAttempted = tavilyMeta.tavilyNetworkScheduled;
  const tavilySuccess =
    tavilyMeta.cacheHit ||
    (tavilyMeta.tavilyNetworkScheduled &&
      tavilyMeta.httpOkCalls > 0 &&
      tavilyMeta.mergedRawRowsBeforePostFilters > 0);
  console.log(
    '[QUESTION_SOURCE_STATUS]',
    JSON.stringify({
      ts: new Date().toISOString(),
      normalizedUrl: payload.normalizedUrl,
      questionSourceStatus: payload.questionSourceStatus,
      tavilyAttempted,
      tavilySuccess,
      fallbackUsed: payload.fallbackUsed,
      cacheHit: tavilyMeta.cacheHit,
      httpOkCalls: tavilyMeta.httpOkCalls,
      mergedRawRowsBeforePostFilters: tavilyMeta.mergedRawRowsBeforePostFilters,
      internalFetchError: tavilyMeta.internalFetchError ?? false,
    })
  );
}

export type TavilyExecutionLedger = {
  apiKeyFingerprint: string;
  apiKeyPresent: boolean;
  apiKeyLength: number;
  calls: Array<{
    queryFocus: QueryFocus;
    source: SearchSource;
    outcome: 'skipped' | 'http_ok' | 'http_error' | 'network_error';
    skippedReason?: string;
    status?: number;
    ok?: boolean;
    tavilyResultsCount?: number;
    hasAnswerField?: boolean;
    extractedRows?: number;
    errorBodyPreview?: string;
    networkError?: string;
  }>;
};

function logTavily(msg: string, payload: Record<string, unknown>): void {
  if (!shouldLogTavilyExecution()) return;
  try {
    console.log(msg, JSON.stringify({ ts: new Date().toISOString(), ...payload }));
  } catch {
    console.log(msg, { error: 'serialize_failed' });
  }
}

async function fetchFromTavilyStrict(
  primaryPhrase: string,
  source: SearchSource,
  queryFocus: QueryFocus,
  isEnglish: boolean,
  pageType: PageType | undefined,
  intentOpts: {
    essentialTokens: string[];
    extractionDebug?: QuestionExtractionDebugCollector;
    tavilyLedger?: TavilyExecutionLedger;
    /** Extra one-line logs per invocation (YouTube diagnosis). */
    videoTrace?: boolean;
  }
): Promise<QuestionWithSnippet[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  const query = buildTavilyQueryStrict(primaryPhrase, queryFocus, isEnglish, pageType);
  const ledger = intentOpts.tavilyLedger;
  const fp = tavilyApiKeyFingerprint(apiKey);

  const pushLedger = (partial: TavilyExecutionLedger['calls'][0]) => {
    ledger?.calls.push(partial);
  };

  if (intentOpts.videoTrace) {
    console.log(
      '[VIDEO_TAVILY]',
      JSON.stringify({
        ts: new Date().toISOString(),
        step: 'fetchFromTavilyStrict_invocation',
        queryFocus,
        source,
        hasPrimaryQuery: !!query,
        hasApiKeyEnv: fp.present,
        endpoint: TAVILY_SEARCH_ENDPOINT,
      })
    );
  }

  if (!query) {
    logTavily('[TAVILY_SKIPPED]', {
      reason: 'empty_query_after_buildTavilyQueryStrict',
      queryFocus,
      source,
      primaryPhrasePreview: primaryPhrase.slice(0, 80),
    });
    pushLedger({
      queryFocus,
      source,
      outcome: 'skipped',
      skippedReason: 'empty_query',
    });
    return [];
  }

  if (!apiKey) {
    logTavily('[TAVILY_SKIPPED]', {
      reason: 'missing_env_TAVILY_API_KEY',
      queryFocus,
      source,
      apiKeyPresent: false,
    });
    pushLedger({
      queryFocus,
      source,
      outcome: 'skipped',
      skippedReason: 'no_api_key',
    });
    return [];
  }

  const { essentialTokens, extractionDebug } = intentOpts;
  const dbg = extractionDebug;
  const isCommunity = source === 'community' || queryFocus === 'community';
  if (DEBUG_SEARCH_QUESTIONS) {
    console.debug('[searchQuestions] Tavily query:', query);
  }

  const requestBodySummary = {
    query,
    search_depth: isCommunity ? 'advanced' : 'basic',
    max_results: 5,
    include_answer: true,
    exclude_domains_count: EXCLUDE_DOMAINS.length,
  };

  logTavily('[TAVILY_REQUEST]', {
    endpoint: TAVILY_SEARCH_ENDPOINT,
    queryFocus,
    source,
    query,
    apiKeyPresent: fp.present,
    apiKeyFingerprint: fp.fingerprint,
    apiKeyLength: fp.length,
    envVar: 'TAVILY_API_KEY',
    requestBodySummary,
  });

  try {
    const res = await fetch(TAVILY_SEARCH_ENDPOINT, {
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

    const status = res.status;
    const okHttp = res.ok;

    if (!res.ok) {
      let errorBodyPreview: string | undefined;
      try {
        const errText = await res.text();
        errorBodyPreview = errText.slice(0, 800);
      } catch {
        errorBodyPreview = 'could_not_read_body';
      }
      logTavily('[TAVILY_RESPONSE]', {
        queryFocus,
        source,
        status,
        ok: false,
        resultCount: 0,
        hasAnswerField: false,
        errorBodyPreview,
      });
      pushLedger({
        queryFocus,
        source,
        outcome: 'http_error',
        status,
        ok: false,
        errorBodyPreview,
      });
      return [];
    }

    const data = await res.json();
    const sanitizeSnippet = (s?: string, maxLen = 200) => {
      if (!s) return undefined;
      let t = String(s);
      t = t.replace(/```[\s\S]*?```/g, ' ');
      t = t.replace(/`[^`]*`/g, ' ');
      t = t.replace(/<code[\s\S]*?>[\s\S]*?<\/code>/gi, ' ');
      t = t.replace(/https?:\/\/\S+/gi, ' ');
      t = t.replace(/[\w-]+=[^&\s]+/g, ' ');
      t = t.replace(/[_\-\|]{2,}/g, ' ').replace(/[\t\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
      if (t.length > maxLen) t = t.slice(0, maxLen - 1).trim() + '…';
      return t || undefined;
    };
    const out: QuestionWithSnippet[] = [];

    if (data.answer) {
      const a = String(data.answer);
      dbg?.rawTavilyItems.push({
        kind: `answer:${queryFocus}`,
        text: a.slice(0, 500),
      });
      const answerQs = extractIntentCandidatesFromText(
        a,
        source,
        undefined,
        essentialTokens,
        primaryPhrase,
        isEnglish,
        dbg,
        `answer:${queryFocus}`
      );
      const short = sanitizeSnippet(a, 200);
      for (const q of answerQs) {
        out.push({ q, snippet: short });
      }
    }

    for (const result of data.results ?? []) {
      const title = result.title ?? '';
      const content = result.content ?? '';
      const url = result.url ?? '';
      const resolvedSource = resolveSource(url, source);

      dbg?.rawTavilyItems.push({
        kind: `title:${queryFocus}`,
        text: title.slice(0, 300),
        url,
      });
      dbg?.rawTavilyItems.push({
        kind: `content:${queryFocus}`,
        text: content.slice(0, 400),
        url,
      });

      if (title.trim().length >= 6) {
        const titleQ = evaluateTitleOrLine(
          title.trim(),
          resolvedSource,
          url,
          essentialTokens,
          primaryPhrase,
          isEnglish,
          dbg,
          `title:${queryFocus}`
        );
        if (titleQ) {
          out.push({ q: titleQ, snippet: sanitizeSnippet(content, 200) });
        }
      }

      const contentQs = extractIntentCandidatesFromText(
        content,
        resolvedSource,
        url,
        essentialTokens,
        primaryPhrase,
        isEnglish,
        dbg,
        `content:${queryFocus}`
      );
      const short = sanitizeSnippet(content, 200);
      for (const q of contentQs) {
        out.push({ q, snippet: short });
      }
    }

    const resultsArr = Array.isArray(data.results) ? data.results : [];
    const hasAnswer = Boolean(data.answer);
    logTavily('[TAVILY_RESPONSE]', {
      queryFocus,
      source,
      status: res.status,
      ok: true,
      resultCount: resultsArr.length,
      hasAnswerField: hasAnswer,
      extractedQuestionRowsAfterIntent: out.length,
    });
    pushLedger({
      queryFocus,
      source,
      outcome: 'http_ok',
      status: res.status,
      ok: true,
      tavilyResultsCount: resultsArr.length,
      hasAnswerField: hasAnswer,
      extractedRows: out.length,
    });

    return out;
  } catch (e) {
    const networkError = e instanceof Error ? e.message : String(e);
    logTavily('[TAVILY_RESPONSE]', {
      queryFocus,
      source,
      ok: false,
      resultCount: 0,
      networkError,
      errorBodyPreview: undefined,
    });
    pushLedger({
      queryFocus,
      source,
      outcome: 'network_error',
      networkError,
    });
    return [];
  }
}

/** At least one essential token appears in the question line or SERP snippet (case-insensitive). */
function hasEssentialKeywordInCombined(
  q: SearchQuestion,
  snippet: string | undefined,
  essentialTokens: string[]
): boolean {
  const combined = `${q.text ?? ''} ${snippet ?? ''}`.toLowerCase();
  for (const raw of essentialTokens) {
    const t = raw.toLowerCase().trim();
    if (t.length >= 2 && combined.includes(t)) return true;
  }
  return false;
}

const MAX_FETCH_SEARCH_QUESTIONS = 12;

function logQuestionSourceMode(payload: {
  normalizedUrl: string;
  rawCount: number;
  finalCount: number;
  filteringApplied: boolean;
}): void {
  if (process.env.QUESTION_SOURCE_MODE_DEBUG !== '1' && process.env.QUESTION_COVERAGE_STAGE_DEBUG !== '1') {
    return;
  }
  try {
    console.log(
      '[QUESTION_SOURCE_MODE]',
      JSON.stringify({ ts: new Date().toISOString(), ...payload })
    );
  } catch {
    // ignore
  }
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
  /** When true (e.g. analyze forceRefresh), skip question-research cache read; fresh Tavily + re-save. */
  skipQuestionResearchCache?: boolean;
}

/**
 * Tavily에서 질문형 라인을 수집합니다. 필터는 최소한만: NSFW 차단, 주제 토큰 1개 이상(질문·스니펫),
 * 중복 제거, 상한 12. junk/정렬/키워드 정렬 필터는 적용하지 않습니다.
 *
 * @param seedKeywords - 추출된 seed 키워드 배열
 * @param options - pageType, meta, url
 * @returns 수집된 질문 배열 + Tavily 파이프라인 메타(쿼터/폴백 UI용)
 */
export async function fetchSearchQuestions(
  seedKeywords: SeedKeyword[],
  options?: FetchSearchQuestionsOptions
): Promise<FetchSearchQuestionsResult> {
  const videoTrace =
    options?.pageType === 'video' &&
    (process.env.VIDEO_TAVILY_TRACE === '1' || process.env.TAVILY_EXECUTION_DEBUG === '1');

  try {
    if (!seedKeywords || seedKeywords.length === 0) {
      if (videoTrace) {
        console.log(
          '[VIDEO_TAVILY]',
          JSON.stringify({
            ts: new Date().toISOString(),
            phase: 'fetchSearchQuestions_early_exit',
            reason: 'no_seed_keywords',
            pageType: options?.pageType,
            url: options?.url ?? '',
          })
        );
      }
      logTavily('[TAVILY_SKIPPED]', { reason: 'no_seed_keywords', fetchSearchQuestions: true });
      return { questions: [], tavilyMeta: EMPTY_TAVILY_META };
    }

    const meta = options?.meta ?? { title: null, ogTitle: null };
    const url = options?.url ?? '';

    const topic = derivePrimaryTopic(meta, url, seedKeywords, options?.pageType);
    const { primaryPhrase, essentialTokens, isEnglishPage } = topic;

    if (!primaryPhrase || essentialTokens.length === 0) {
      if (DEBUG_SEARCH_QUESTIONS) console.debug('[searchQuestions] primaryPhrase/essentialTokens empty, skip');
      if (videoTrace) {
        console.log(
          '[VIDEO_TAVILY]',
          JSON.stringify({
            ts: new Date().toISOString(),
            phase: 'fetchSearchQuestions_early_exit',
            reason: 'empty_primary_topic',
            primaryPhraseEmpty: !primaryPhrase,
            essentialTokensCount: essentialTokens.length,
            url,
          })
        );
      }
      logTavily('[TAVILY_SKIPPED]', {
        reason: 'empty_primary_topic',
        primaryPhraseEmpty: !primaryPhrase,
        essentialTokensCount: essentialTokens.length,
      });
      return { questions: [], tavilyMeta: EMPTY_TAVILY_META };
    }

    const normalizedUrl = url ? normalizeUrl(url) : '';
    const cacheKey = buildQuestionResearchCacheKey({
      normalizedUrl,
      primaryPhrase,
      essentialTokens,
      pageType: options?.pageType,
      isEnglishPage,
    });

    const skipQrCache = options?.skipQuestionResearchCache === true;
    if (skipQrCache && shouldLogTavilyExecution()) {
      logTavily('[TAVILY_CACHE_PATH]', {
        path: 'bypass_read',
        reason: 'skipQuestionResearchCache_true_force_refresh',
        normalizedUrl,
        cacheKeyPrefix: cacheKey.slice(0, 32),
      });
    }
    if (skipQrCache && process.env.QUESTION_COVERAGE_TRACE === '1') {
      console.log(
        '[QUESTION_COVERAGE_TRACE]',
        JSON.stringify({
          stage: 'question_research_cache',
          action: 'bypass_read',
          normalizedUrl,
          cacheKeyPrefix: cacheKey.slice(0, 32),
          primaryPhrase,
        })
      );
    }

    const cached = skipQrCache ? null : await getCachedQuestionResearch(cacheKey);
    if (cached?.questions?.length) {
      if (shouldLogQuestionPipelineTrace()) {
        logQuestionPipelineStage(
          'cache_hit_skipped_tavily_stages_1_to_3',
          cached.questions,
          {
            normalizedUrl,
            note: 'Returning cached question list; raw Tavily / dedupe / topic+quality steps were not re-run. Use analyze forceRefresh (skipQuestionResearchCache) to rebuild and log full pipeline.',
          }
        );
      }
      if (DEBUG_SEARCH_QUESTIONS) {
        console.debug('[searchQuestions] cache hit', { cacheKey: cacheKey.slice(0, 16), updatedAt: cached.updatedAt });
      }
      if (process.env.QUESTION_COVERAGE_TRACE === '1') {
        console.log(
          '[QUESTION_COVERAGE_TRACE]',
          JSON.stringify({
            stage: 'question_research_cache',
            action: 'hit_return',
            normalizedUrl,
            questionCount: cached.questions.length,
            cacheKeyPrefix: cacheKey.slice(0, 32),
            updatedAt: cached.updatedAt,
          })
        );
      }
      if (shouldLogTavilyExecution()) {
        const kfp = tavilyApiKeyFingerprint(process.env.TAVILY_API_KEY);
        logTavily('[TAVILY_CACHE_PATH]', {
          path: 'hit',
          reason: 'question_research_cache_has_questions',
          normalizedUrl,
          questionCount: cached.questions.length,
          cacheKeyPrefix: cacheKey.slice(0, 32),
          note: 'Tavily API not called; usage will not change on dashboard.',
          apiKeyFingerprint: kfp.fingerprint,
          apiKeyPresent: kfp.present,
        });
        logTavily('[TAVILY_EXECUTION_SUMMARY]', {
          normalizedUrl,
          tavilyNetworkCalls: 0,
          reason: 'cache_short_circuit',
          fetchFromTavilyStrictInvocations: 0,
        });
      }
      if (videoTrace) {
        console.log(
          '[VIDEO_TAVILY]',
          JSON.stringify({
            ts: new Date().toISOString(),
            phase: 'question_research_cache_hit_return',
            normalizedUrl,
            questionCount: cached.questions.length,
            note: 'No Tavily HTTP; fetchFromTavilyStrict not run.',
          })
        );
      }
      return {
        questions: cached.questions,
        tavilyMeta: {
          cacheHit: true,
          tavilyNetworkScheduled: false,
          httpOkCalls: 0,
          mergedRawRowsBeforePostFilters: 0,
        },
      };
    }

    if (shouldLogTavilyExecution()) {
      logTavily('[TAVILY_CACHE_PATH]', {
        path: 'miss',
        reason: 'no_cache_or_empty_cache',
        normalizedUrl,
        willCallTavily: true,
        skipQuestionResearchCache: skipQrCache,
      });
    }
    if (videoTrace) {
      console.log(
        '[VIDEO_TAVILY]',
        JSON.stringify({
          ts: new Date().toISOString(),
          phase: 'before_parallel_fetchFromTavilyStrict_x3',
          normalizedUrl,
          primaryPhrase: primaryPhrase.slice(0, 120),
          skipQuestionResearchCache: skipQrCache,
          seedKeywordCount: seedKeywords.length,
        })
      );
    }

    const extractionDebug: QuestionExtractionDebugCollector | undefined = shouldLogQuestionExtractionDebug()
      ? { rawTavilyItems: [], accepted: [], rejected: [] }
      : undefined;

    const keyFp = tavilyApiKeyFingerprint(process.env.TAVILY_API_KEY);
    const tavilyLedger: TavilyExecutionLedger = {
      apiKeyFingerprint: keyFp.fingerprint,
      apiKeyPresent: keyFp.present,
      apiKeyLength: keyFp.length,
      calls: [],
    };

    const intentOpts = {
      essentialTokens,
      extractionDebug,
      tavilyLedger,
      videoTrace,
    };
    const primaryTasks = [
      fetchFromTavilyStrict(primaryPhrase, 'google', 'faq', isEnglishPage, options?.pageType, intentOpts),
      fetchFromTavilyStrict(primaryPhrase, 'google', 'cons', isEnglishPage, options?.pageType, intentOpts),
      fetchFromTavilyStrict(primaryPhrase, 'community', 'community', isEnglishPage, options?.pageType, intentOpts),
    ];

    const resultsArrays = await Promise.all(primaryTasks);
    const mergedRaw: QuestionWithSnippet[] = resultsArrays.flat();

    if (videoTrace) {
      console.log(
        '[VIDEO_TAVILY]',
        JSON.stringify({
          ts: new Date().toISOString(),
          phase: 'after_parallel_fetchFromTavilyStrict_x3',
          normalizedUrl,
          mergedRawRows: mergedRaw.length,
          ledgerCalls: tavilyLedger?.calls.length ?? 0,
        })
      );
    }

    if (extractionDebug && shouldLogQuestionExtractionDebug()) {
      try {
        console.log(
          '[QUESTION_EXTRACTION_DEBUG]',
          JSON.stringify({
            ts: new Date().toISOString(),
            normalizedUrl,
            primaryPhrase,
            essentialTokens,
            counts: {
              rawTavilyItems: extractionDebug.rawTavilyItems.length,
              accepted: extractionDebug.accepted.length,
              rejected: extractionDebug.rejected.length,
            },
            rawTavilyItems: extractionDebug.rawTavilyItems.slice(0, 35),
            accepted: extractionDebug.accepted.slice(0, 45),
            rejected: extractionDebug.rejected.slice(0, 45),
          })
        );
      } catch {
        console.log('[QUESTION_EXTRACTION_DEBUG]', { normalizedUrl, error: 'serialize_failed' });
      }
    }

    const rawCount = mergedRaw.length;
    const passedMinimal: SearchQuestion[] = [];
    for (const { q, snippet } of mergedRaw) {
      if (!isValidQuestion(q.text)) continue;
      if (!hasEssentialKeywordInCombined(q, snippet, essentialTokens)) continue;
      passedMinimal.push(q);
    }

    let filteredQuestions = dedupeQuestions(passedMinimal);
    filteredQuestions = filteredQuestions.slice(0, MAX_FETCH_SEARCH_QUESTIONS);

    const filteringApplied =
      rawCount !== filteredQuestions.length || mergedRaw.length !== passedMinimal.length;

    logQuestionSourceMode({
      normalizedUrl,
      rawCount,
      finalCount: filteredQuestions.length,
      filteringApplied,
    });

    if (shouldLogQuestionPipelineTrace()) {
      const rawQs = mergedRaw.map((x) => x.q);
      logQuestionPipelineStage('1_raw_tavily', rawQs, {
        normalizedUrl,
        note: 'Merged FAQ + cons + community before minimal filters.',
      });
      logQuestionPipelineStage('2_after_minimal_fetch_filters', filteredQuestions, {
        normalizedUrl,
        note:
          'NSFW block + ≥1 essential token in question/snippet + dedupe + cap 12. No junk/topicMatch/alignment/LLM.',
      });
    }

    if (DEBUG_SEARCH_QUESTIONS) {
      console.debug('[searchQuestions] seedKeywords top10:', seedKeywords.slice(0, 10).map((k) => k.value));
      console.debug('[searchQuestions] raw -> final:', rawCount, '->', filteredQuestions.length);
      console.debug('[searchQuestions] final sample top10:', filteredQuestions.slice(0, 10).map((q) => q.text.slice(0, 60)));
    }

    if (filteredQuestions.length > 0) {
      await saveQuestionResearchCache({
        cacheKey,
        normalizedUrl,
        primaryPhrase,
        pageType: options?.pageType,
        questions: filteredQuestions,
      });
      if (shouldLogTavilyExecution()) {
        logTavily('[TAVILY_CACHE_PATH]', {
          path: 'saved',
          normalizedUrl,
          questionCount: filteredQuestions.length,
          cacheKeyPrefix: cacheKey.slice(0, 32),
        });
      }
      if (skipQrCache && process.env.QUESTION_COVERAGE_TRACE === '1') {
        console.log(
          '[QUESTION_COVERAGE_TRACE]',
          JSON.stringify({
            stage: 'question_research_cache',
            action: 'rebuilt_and_saved',
            normalizedUrl,
            questionCount: filteredQuestions.length,
            cacheKeyPrefix: cacheKey.slice(0, 32),
          })
        );
      }
    }

    if (shouldLogTavilyExecution()) {
      const httpOk = tavilyLedger.calls.filter((c) => c.outcome === 'http_ok').length;
      const httpErr = tavilyLedger.calls.filter((c) => c.outcome === 'http_error').length;
      const netErr = tavilyLedger.calls.filter((c) => c.outcome === 'network_error').length;
      const skipped = tavilyLedger.calls.filter((c) => c.outcome === 'skipped').length;
      logTavily('[TAVILY_EXECUTION_SUMMARY]', {
        normalizedUrl,
        apiKeyPresent: tavilyLedger.apiKeyPresent,
        apiKeyFingerprint: tavilyLedger.apiKeyFingerprint,
        apiKeyLength: tavilyLedger.apiKeyLength,
        compareKeyNote:
          'Fingerprint = first4…last4 of TAVILY_API_KEY (match to the key in Tavily dashboard; full key is never logged).',
        fetchFromTavilyStrictScheduledParallelCalls: 3,
        ledgerEntries: tavilyLedger.calls.length,
        httpOkCalls: httpOk,
        skippedCalls: skipped,
        httpErrorCalls: httpErr,
        networkErrorCalls: netErr,
        anyTavilyHttpSucceeded: httpOk > 0,
        mergedRawRowsBeforePostFilters: mergedRaw.length,
        finalQuestionCountAfterFilters: filteredQuestions.length,
        mergedRawWasZero: mergedRaw.length === 0,
        perCall: tavilyLedger.calls,
      });
    }

    const httpOkCalls = tavilyLedger.calls.filter((c) => c.outcome === 'http_ok').length;
    return {
      questions: filteredQuestions,
      tavilyMeta: {
        cacheHit: false,
        tavilyNetworkScheduled: true,
        httpOkCalls,
        mergedRawRowsBeforePostFilters: mergedRaw.length,
      },
    };
  } catch (error) {
    console.error('fetchSearchQuestions 전체 오류:', error);
    return {
      questions: [],
      tavilyMeta: { ...EMPTY_TAVILY_META, internalFetchError: true },
    };
  }
}
