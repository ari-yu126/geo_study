import * as cheerio from 'cheerio';
import type { ParagraphStats } from './analysisTypes';

interface Paragraph {
  text: string;
  wordCount: number;
  isDefinition: boolean;
  isGoodLength: boolean;
  isFluff: boolean;
  isSummary: boolean;
  numberRatio: number;
  properNounRatio: number;
  infoDensity: number;
  score: number;
}

// 꿀팁/요약 감지: 블로그 인용의 결정적 요소 — 문단 내 매칭
const SUMMARY_PATTERNS = [
  /결론적으로/, /요약하자면/, /핵심은/, /정리해\s*보면/, /꿀팁/, /주의사항/, /방법은/, /교체법/,
  /요약하면/, /한마디로/, /정리하면/, /팁을\s*드리자면/, /요점만\s*말하면/,
];

const NUMBER_PATTERNS = [
  /\d+[.,]?\d*\s*%/,           // 12%, 3.5%
  /[\d,]+\s*원|\d+\s*만\s*원/,  // 10,000원, 5만원
  /\$\s*[\d,.]+|₩\s*[\d,]+/,   // $99, ₩50,000
  /\d+\s*(?:kg|g|ml|cm|mm|m|km)/i,
  /\d+\s*(?:개|명|회|편|장)/,
  /\d+[가-힣]/,                 // 3개, 10명
  /\b\d{1,3}(?:,\d{3})+\b/,    // 1,234
  /\b\d+\.?\d*\b/,             // 일반 숫자
];

const PROPER_NOUN_PATTERNS = [
  /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/,  // Dyson Supersonic, Google AI
  /\b[A-Z]{2,}\b/,                         // NASA, FAQ
  /[가-힣]{2,}(?:주식회사|코리아|랩|스튜디오|그룹|센터)?/,
  /[\u3131-\uD79D]{2,}\s*(?:시|도|군|구|동|로|길)/,
];

const DEFINITION_PATTERNS_KO = [
  /은\s+.{3,}(?:이다|입니다|합니다|됩니다)/,
  /는\s+.{3,}(?:이다|입니다|합니다|됩니다)/,
  /이란\s+.{3,}/,
  /이라\s+함은/,
  /를\s+의미한다/,
  /를\s+말한다/,
  /로\s+정의된다/,
  /(?:역할|기능|목적)을\s+한다/,
  /(?:뜻|의미)(?:이다|입니다|합니다)/,
];

const DEFINITION_PATTERNS_EN = [
  /\bis\s+(?:a|an|the)\s+\w/i,
  /\bare\s+(?:a|an|the)?\s*\w/i,
  /\brefers?\s+to\b/i,
  /\bdesigned\s+(?:to|for)\b/i,
  /\bused\s+(?:to|for)\b/i,
  /\bdefined\s+as\b/i,
  /\bmeans?\s+(?:that|the)\b/i,
  /\bconsists?\s+of\b/i,
];

const FLUFF_PATTERNS_KO = [
  /진짜\s*(?:최고|대박|미쳤|좋)/,
  /(?:완전|너무|엄청)\s*(?:좋|대박|최고|강추)/,
  /꼭\s+(?:보세요|해보세요|추천)/,
  /(?:대박|짱|ㄹㅇ|갓|핵)/,
  /강력\s*추천/,
  /놓치면\s+후회/,
  /(?:안보면|안하면)\s+손해/,
  /(?:클릭|구독).*(?:좋아요|알림)/,
];

// 숫자+단위 패턴: "1개당 +2점" 정보 밀도 가산용 (리포트 설명 가능)
const DATA_UNIT_PATTERNS = [
  /\d+[.,]?\d*\s*%/,                    // 12%, 3.5%
  /[\d,]+\s*원|\d+\s*만\s*원/,           // 10,000원, 5만원
  /\b\d+[Aa][hH]\b|\b\d+[Vv]\b/,        // 40Ah, 12V
  /\d+\s*(?:kg|g|ml|cm|mm|m|km|l)/i,    // 500g, 1.5L
  /\d+\s*(?:개|명|회|편|장)/,            // 3개, 10명
  /\$\s*[\d,.]+|₩\s*[\d,]+/,            // $99, ₩50,000
  // 자동차 리뷰/전문 기사
  /\d+\s*cc\b/i,                        // 2000cc, 1.6cc
  /\d+\s*hp\b/i,                        // 150hp, 200hp
  /\d+[.,]?\d*\s*kg\.?m\b/i,            // 25kg.m, 35.7kg·m
  /\d+[.,]?\d*\s*km\s*\/\s*l\b/i,       // 12.5km/l, 15km/ℓ
  /\d+[.,]?\d*\s*km\/l\b/i,             // 12.5km/l (공백 없음)
];

function hasNumberAndUnit(text: string): boolean {
  return text.length >= 15 && DATA_UNIT_PATTERNS.some((p) => p.test(text));
}

// 제품 스펙 블록: 모델명+수치 밀집 패턴 (다나와·쇼핑형·자동차 리뷰 페이지)
const PRODUCT_SPEC_PATTERNS = [
  // 모델명 + 용량/전압/가격: "델코 DF40AL 40Ah 12V 38,400원"
  /\b[A-Za-z0-9가-힣\-]{2,20}\s+(?:\d+[Aa][hH]|\d+[Vv])\b/,
  /\b\d+[Aa][hH]\s*(?:\/\s*)?\d+[Vv]\b/,
  /[\d,]+\s*원\s*\/\s*[\d,]+\s*원/,  // 정가/할인가
  // 스펙 열거: "용량:40Ah / 12V / RC:55분 / 저온시동능력:350A"
  /(?:용량|RC|저온시동능력|정격출력|순간최대)[:\s]*[\d.,~]+(?:[AaHhVvWw분]|원)?/,
  // 영문 모델 + 숫자: "AGM LN5(AGM95)", "DF40AL"
  /\b[A-Z]{2,}\d+[A-Za-z]*\s*\([^)]+\)\s*[\d,]+/,
  // 자동차 리뷰: 배기량, 마력, 토크, 연비
  /\d+\s*cc\s+[\d\s]*hp/i,
  /\d+[.,]?\d*\s*kg\.?m\b/i,
  /\d+[.,]?\d*\s*km\s*\/\s*l\b/i,
];

function countProductSpecBlocksInText(text: string): number {
  if (!text || text.length < 20) return 0;
  let count = 0;
  // 80자 단위 슬라이딩 윈도우에서 스펙 패턴 2개 이상 매칭 시 1블록
  const windowSize = 120;
  for (let i = 0; i < text.length - 40; i += 40) {
    const chunk = text.substring(i, i + windowSize);
    const matches = PRODUCT_SPEC_PATTERNS.filter(p => p.test(chunk)).length;
    if (matches >= 2) count++;
  }
  return Math.min(count, 10);
}

/** HTML 본문에서 제품 스펙 블록 수 추출 (quotable 데이터 보조) */
export function countProductSpecBlocks(html: string): number {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  const texts: string[] = [];
  $('table td, table th, ul li, ol li, .product, .item, [class*="product"], [class*="spec"], [class*="card"], [class*="list"], [class*="plan"], [class*="goods"], [class*="info"]').each((_, el) => {
    const t = $(el).text().trim();
    if (t.length >= 30) texts.push(t);
  });
  if (texts.length === 0) {
    const body = $('body').text().replace(/\s+/g, ' ');
    if (body.length >= 100) texts.push(body);
  }
  return texts.reduce((sum, t) => sum + countProductSpecBlocksInText(t), 0);
}

const FLUFF_PATTERNS_EN = [
  /\b(?:absolutely|totally|literally)\s+(?:amazing|incredible|insane|best)\b/i,
  /\byou\s+won'?t\s+believe\b/i,
  /\b(?:game[\s-]?changer|mind[\s-]?blowing|life[\s-]?changing)\b/i,
  /\b(?:hands?\s+down|without\s+a\s+doubt)\b/i,
  /\b(?:must[\s-]?have|must[\s-]?read|must[\s-]?see)\b/i,
  /\b(?:click|subscribe|share).*(?:below|now|today)\b/i,
];

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
}

function computeNumberRatio(text: string): number {
  const words = text.split(/\s+/);
  if (words.length === 0) return 0;
  let matched = 0;
  for (const w of words) {
    if (NUMBER_PATTERNS.some(p => p.test(w)) || /\d/.test(w)) matched++;
  }
  return matched / words.length;
}

function computeProperNounRatio(text: string): number {
  const words = text.split(/\s+/);
  if (words.length === 0) return 0;
  let matched = 0;
  for (const w of words) {
    if (PROPER_NOUN_PATTERNS.some(p => p.test(w))) matched++;
  }
  return Math.min(1, matched / Math.max(1, words.length * 0.3));
}

function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  return intersection / (setA.size + setB.size - intersection);
}

function scoreParagraph(p: Paragraph): number {
  let score = 5;

  if (p.isDefinition) score += 2;
  if (p.isGoodLength) score += 1.5;
  if (p.isFluff) score -= 3;

  if (p.wordCount < 5) {
    if (p.infoDensity >= 0.5) {
      score += 2;
    } else if (p.infoDensity >= 0.3) {
      score += 0.5;
    } else {
      score -= 2;
    }
  } else if (p.wordCount > 200) {
    score -= 1;
  }

  if (/\d/.test(p.text)) score += 0.5;
  if (p.infoDensity >= 0.6) score += 1.5;

  return Math.max(0, Math.min(10, score));
}

export function analyzeParagraphs(
  html: string,
  headings: string[],
  searchQuestions: { text: string }[] = []
): ParagraphStats {
  const $ = cheerio.load(html);
  $('script, style, noscript, nav, header, footer, iframe, svg').remove();

  const paragraphs: Paragraph[] = [];
  const seen = new Set<string>();

  function addIfNew(text: string, minLen = 10) {
    const key = text.slice(0, 80).replace(/\s+/g, ' ');
    if (text.length < minLen || seen.has(key)) return;
    seen.add(key);
    paragraphs.push(buildParagraph(text));
  }

  $('main p, article p, .content p, #content p, [role="main"] p').each((_, el) => {
    addIfNew($(el).text().trim());
  });

  if (paragraphs.length < 5) {
    $('body p').each((_, el) => addIfNew($(el).text().trim()));
  }

  // 쇼핑/데이터형: li, div에서 핵심 정보 수집 (숫자·단위·가격 포함)
  if (paragraphs.length < 5) {
    const dataLike = /[\d,]+\s*원|\d+[Aa][hH]|\d+[Vv]|용량|저온시동|정격출력|할인율|용량/;
    $('ul li, ol li, table td, table th').each((_, el) => {
      if (paragraphs.length >= 25) return false;
      const text = $(el).text().trim();
      if (text.length >= 20 && dataLike.test(text)) addIfNew(text, 15);
    });
  }
  if (paragraphs.length < 5) {
    const dataLike = /[\d,]+\s*원|\d+[Aa][hH]|\d+[Vv]|용량|저온시동|정격출력/;
    $('[class*="product"] div, [class*="item"] div, [class*="plan"] div, [class*="goods"] div, [class*="card"] div, [class*="spec"]').each((_, el) => {
      if (paragraphs.length >= 25) return false;
      const text = $(el).text().trim();
      if (text.length >= 25 && dataLike.test(text)) addIfNew(text, 15);
    });
  }

  if (paragraphs.length === 0) {
    return {
      totalParagraphs: 0,
      definitionRatio: 0,
      goodLengthRatio: 0,
      fluffRatio: 0,
      duplicateRatio: 0,
      questionH2Ratio: 0,
      earlySummaryExists: false,
      summaryParagraphCount: 0,
      hasHighValueContext: false,
      avgScore: 0,
      communityFitScore: 0,
      infoDensity: 0,
      dataDenseBlockCount: 0,
    };
  }

  const dataDenseBlockCount = paragraphs.filter((p) => hasNumberAndUnit(p.text)).length;

  const definitionCount = paragraphs.filter(p => p.isDefinition).length;
  const goodLengthCount = paragraphs.filter(p => p.isGoodLength).length;
  const fluffCount = paragraphs.filter(p => p.isFluff).length;

  let duplicateCount = 0;
  for (let i = 1; i < paragraphs.length; i++) {
    const prevTokens = tokenize(paragraphs[i - 1].text);
    const currTokens = tokenize(paragraphs[i].text);
    if (jaccardSimilarity(prevTokens, currTokens) > 0.5) {
      duplicateCount++;
    }
  }

  const questionH2Patterns = [
    /\?/, /이란/, /무엇/, /어떻게/, /왜\s/, /언제/, /얼마/,
    /\bwhat\b/i, /\bhow\b/i, /\bwhy\b/i, /\bwhen\b/i, /\bwhich\b/i,
  ];
  const questionH2Count = headings.filter(h =>
    questionH2Patterns.some(p => p.test(h))
  ).length;
  const questionH2Ratio = headings.length > 0 ? questionH2Count / headings.length : 0;

  const first300 = paragraphs.slice(0, 3).map(p => p.text).join(' ').substring(0, 500);
  const earlySummaryExists = [...DEFINITION_PATTERNS_KO, ...DEFINITION_PATTERNS_EN]
    .some(p => p.test(first300));

  // 요약형 문단: 꿀팁/요약/방법론 키워드 포함 (문단 내 어디서나)
  const summaryParagraphCount = paragraphs.filter((p) => p.isSummary).length;

  // 실용적 키워드(How-to) 밀도: 방법론·실무 키워드 밀집 시 High Value Context
  const PRACTICAL_KEYWORD_PATTERNS = [
    /교체법|준비물|주의사항|방법|절차|단계|꿀팁|팁\s*(?:을\s*)?드리면|방법론/,
    /how\s+to\b|\b단계별\b|체크리스트|가이드|가이드라인|수칙|포인트/i,
    /하는\s*법|하는\s*방법|알아보기|해결법|예방법|관리법|선택법/,
  ];
  const fullText = paragraphs.map((p) => p.text).join(' ');
  const practicalKeywordMatches = PRACTICAL_KEYWORD_PATTERNS.filter((p) => p.test(fullText)).length;
  const hasHighValueContext = practicalKeywordMatches >= 2 && fullText.length >= 300;

  paragraphs.forEach(p => { p.score = scoreParagraph(p); });
  const avgScore = paragraphs.reduce((sum, p) => sum + p.score, 0) / paragraphs.length;

  const infoDensity =
    paragraphs.reduce((s, p) => s + p.infoDensity, 0) / paragraphs.length;

  const questionTerms = new Set<string>();
  for (const q of searchQuestions) {
    q.text.toLowerCase().split(/\s+/).filter(t => t.length >= 2).forEach(t => questionTerms.add(t));
  }
  let communityFitSum = 0;
  for (const p of paragraphs) {
    const paraTokens = new Set(tokenize(p.text));
    let overlap = 0;
    for (const t of questionTerms) {
      if (paraTokens.has(t)) overlap++;
    }
    communityFitSum += questionTerms.size > 0 ? overlap / questionTerms.size : 0;
  }
  const communityFitScore = Math.round(
    (paragraphs.length > 0 ? communityFitSum / paragraphs.length : 0) * 100
  );

  return {
    totalParagraphs: paragraphs.length,
    definitionRatio: definitionCount / paragraphs.length,
    goodLengthRatio: goodLengthCount / paragraphs.length,
    fluffRatio: fluffCount / paragraphs.length,
    duplicateRatio: paragraphs.length > 1 ? duplicateCount / (paragraphs.length - 1) : 0,
    questionH2Ratio,
    earlySummaryExists,
    summaryParagraphCount,
    hasHighValueContext,
    avgScore: Math.round(avgScore * 10) / 10,
    communityFitScore,
    infoDensity: Math.round(infoDensity * 100) / 100,
    dataDenseBlockCount,
  };
}

function buildParagraph(text: string): Paragraph {
  const words = text.split(/\s+/);
  const wordCount = words.length;

  const isDefinition =
    DEFINITION_PATTERNS_KO.some(p => p.test(text)) ||
    DEFINITION_PATTERNS_EN.some(p => p.test(text));

  const isGoodLength = wordCount >= 15 && wordCount <= 80;

  const isFluff =
    FLUFF_PATTERNS_KO.some(p => p.test(text)) ||
    FLUFF_PATTERNS_EN.some(p => p.test(text));

  const isSummary = text.length >= 10 && SUMMARY_PATTERNS.some(p => p.test(text));

  const numberRatio = computeNumberRatio(text);
  const properNounRatio = computeProperNounRatio(text);
  const infoDensity = Math.min(1, (numberRatio * 0.5 + properNounRatio * 0.5) * 2);

  return { text, wordCount, isDefinition, isGoodLength, isFluff, isSummary, numberRatio, properNounRatio, infoDensity, score: 0 };
}

export function paragraphStatsToScore(
  stats: ParagraphStats,
  options?: { isFaqLikePage?: boolean }
): number {
  if (stats.totalParagraphs === 0) return 0;
  const isFaqLikePage = options?.isFaqLikePage ?? false;

  let score = 0;

  // 정의형 문장 비율 (0~25점)
  score += Math.min(25, stats.definitionRatio * 100);

  // 적정 길이 문단 비율 (0~20점) — FAQ는 짧은 Q&A가 정상이므로 패널티 완화
  if (isFaqLikePage) {
    score += Math.min(20, 10 + stats.goodLengthRatio * 10); // 최소 10점 + 비율
  } else {
    score += Math.min(20, stats.goodLengthRatio * 30);
  }

  // 과장 표현 감점 (0~-15점) — infoDensity > 0.5면 감점 50% 무효화 (짧아도 정보 응축)
  const penaltyFactor = (stats.infoDensity ?? 0) > 0.5 ? 0.5 : 1;
  score -= Math.min(15, stats.fluffRatio * 50) * penaltyFactor;

  // 중복 감점 (0~-15점) — infoDensity > 0.5면 감점 50% 무효화
  score -= Math.min(15, stats.duplicateRatio * 50) * penaltyFactor;

  // 질문형 H2 (0~15점)
  score += Math.min(15, stats.questionH2Ratio * 50);

  // 초반 요약 (0 or 15점)
  if (stats.earlySummaryExists) score += 15;

  // 요약/팁 블록 가산: 꿀팁·요약·방법론 문단 1개당 +5점, 최대 20점
  score += Math.min(20, (stats.summaryParagraphCount ?? 0) * 5);

  // 실용적 키워드(How-to) 밀도: High Value Context — 최대 10점
  if (stats.hasHighValueContext) score += 10;

  // 커뮤니티 일치도 (0~10점)
  score += Math.min(10, (stats.communityFitScore ?? 0) / 10);

  // 정보 밀도: 숫자+단위 포함 블록 1개당 +3점 (최대 50점) — 다나와 등 데이터 밀집 페이지 보상 강화
  score += Math.min(50, (stats.dataDenseBlockCount ?? 0) * 3);

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function computeChunkInfoDensity(text: string): number {
  const numberRatio = computeNumberRatio(text);
  const properNounRatio = computeProperNounRatio(text);
  return Math.min(1, (numberRatio * 0.5 + properNounRatio * 0.5) * 2);
}
