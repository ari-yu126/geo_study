import { fetchHtml, extractMetaAndContent, normalizeUrl } from './htmlAnalyzer';
import { runGeminiVideoAnalysis, buildYouTubeAnalysisResult } from './geminiVideoAnalysis';
import { extractSeedKeywords } from './keywordExtractor';
import { fetchSearchQuestions } from './searchQuestions';
import { filterQuestionsByPageRelevance } from './questionFilter';
import { loadActiveScoringConfig } from './scoringConfigLoader';
import { evaluateCheck } from './checkEvaluator';
import { analyzeParagraphs, paragraphStatsToScore } from './paragraphAnalyzer';
import { extractChunks, evaluateCitations, citationsToScore } from './citationEvaluator';
import { deriveAuditIssues } from './issueDetector';
import { generateGeoRecommendations } from './recommendationEngine';
import { hasDomainAuthority } from './domainAuthority';
import { checkActualAiCitation, hasActualAiCitationDomain } from './actualAiCitation';
import { fetchYouTubeMetadata, youtubeMetadataToAnalysisMeta } from './youtubeMetadataExtractor';
import type {
  AnalysisResult,
  GeoScores,
  PageFeatures,
  AnalysisMeta,
  SearchQuestion,
  ContentQuality,
  TrustSignals,
  ParagraphStats,
  ScoringRule,
} from './analysisTypes';

/** 본문/질문 토큰 매칭 비율 — 50%: 질문의 과반 핵심어가 문서에 등장해야 답변 완료 인정 */
const TOKEN_MATCH_RATIO = 0.5;
/** H2 등과 교집합 최소 토큰 수 (짧은 질문(4토큰 이하)은 2토큰 허용) */
const MIN_INTERSECTION = 3;
const MIN_INTERSECTION_SHORT = 2;
const SHORT_QUESTION_TOKEN_THRESHOLD = 4;

/** FAQ 성격 페이지 감지: JSON-LD FAQPage 또는 질문형 헤딩 30% 이상 */
function detectFaqLikePage(params: {
  hasFaqSchema: boolean;
  headings: string[];
}): boolean {
  if (params.hasFaqSchema) return true;
  const questionPatterns = [/\?|Q[.:)]|\bFAQ\b|\b무엇\b|\b어떻게\b|\b왜\b|\b언제\b/i];
  const questionHeadings = params.headings.filter((h) =>
    questionPatterns.some((p) => p.test(h))
  );
  return questionHeadings.length / Math.max(1, params.headings.length) >= 0.3;
}

/** Top 8 검색 질문과 본문 토큰 매칭률 — 0~100. 질문 토큰의 50% 이상 포함 시 hit */
function computeQuestionMatchScore(questions: SearchQuestion[], contentText: string): number {
  if (!questions?.length || !contentText) return 0;
  const text = contentText.toLowerCase();
  const top = questions.slice(0, 8);
  let hit = 0;
  for (const q of top) {
    const tokens = q.text.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
    const tokenHit =
      tokens.length ? tokens.filter((t) => text.includes(t)).length / tokens.length : 0;
    if (tokenHit >= 0.5) hit += 1;
  }
  return Math.round((hit / top.length) * 100);
}

function computeSearchQuestionCoverage(
  pageQuestions: string[],
  searchQuestions: SearchQuestion[],
  contentText: string
): boolean[] {
  if (!searchQuestions || searchQuestions.length === 0) return [];

  const questionText = pageQuestions.join(' ').toLowerCase();
  const fullText = contentText.toLowerCase();
  const covered: boolean[] = [];

  for (const searchQ of searchQuestions) {
    const searchTokens = searchQ.text.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
    if (searchTokens.length === 0) {
      covered.push(false);
      continue;
    }

    const minMatch = Math.max(1, Math.ceil(searchTokens.length * TOKEN_MATCH_RATIO));

    let fullTextMatches = 0;
    for (const token of searchTokens) {
      if (fullText.includes(token)) fullTextMatches++;
    }
    if (fullTextMatches >= minMatch) {
      covered.push(true);
      continue;
    }

    let questionMatches = 0;
    for (const token of searchTokens) {
      if (questionText.includes(token)) questionMatches++;
    }
    if (questionMatches >= minMatch) {
      covered.push(true);
      continue;
    }

    const minIntersection =
      searchTokens.length <= SHORT_QUESTION_TOKEN_THRESHOLD ? MIN_INTERSECTION_SHORT : MIN_INTERSECTION;
    let coveredByPageQ = false;
    for (const pageQ of pageQuestions) {
      const pageTokens = pageQ.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
      const intersection = searchTokens.filter((t) => pageTokens.includes(t));
      if (intersection.length >= minIntersection) {
        coveredByPageQ = true;
        break;
      }
    }
    covered.push(coveredByPageQ);
  }

  return covered;
}

function findUncoveredQuestions(
  pageQuestions: string[],
  searchQuestions: SearchQuestion[],
  contentText: string
): SearchQuestion[] {
  const covered = computeSearchQuestionCoverage(pageQuestions, searchQuestions, contentText);
  return searchQuestions.filter((_, i) => !covered[i]);
}

const DEFAULT_PARAGRAPH_STATS: ParagraphStats = {
  totalParagraphs: 0, definitionRatio: 0, goodLengthRatio: 0,
  fluffRatio: 0, duplicateRatio: 0, questionH2Ratio: 0,
  earlySummaryExists: false, summaryParagraphCount: 0, hasHighValueContext: false,
  avgScore: 0, communityFitScore: 0, infoDensity: 0,
  dataDenseBlockCount: 0,
};

export interface RunAnalysisOptions {
  appOrigin?: string;
}

function isYouTubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return /youtube\.com$/i.test(host);
  } catch {
    return false;
  }
}

export async function runAnalysis(url: string, options?: RunAnalysisOptions): Promise<AnalysisResult> {
  try {
    const appOrigin = options?.appOrigin ?? process.env.GEO_ANALYZER_BASE_URL;

    // 유튜브 전용: CSR로 제목·설명이 안 불러와지므로 전용 메타 추출 사용 (프록시/HTML body 우회)
    if (isYouTubeUrl(url)) {
      let meta: AnalysisMeta;
      const ytMeta = await fetchYouTubeMetadata(url);
      if (ytMeta?.title || ytMeta?.description) {
        meta = youtubeMetadataToAnalysisMeta(ytMeta);
      } else {
        const html = await fetchHtml(url, appOrigin);
        const extracted = extractMetaAndContent(html);
        meta = extracted.meta;
      }

      const geminiResult = await runGeminiVideoAnalysis(url, meta);
      if (geminiResult) {
        const syntheticQuestions: SearchQuestion[] = geminiResult.citationKeywords
          .slice(0, 5)
          .map((text) => ({ source: 'google' as const, text }));
        const hasActualAiCitation = await checkActualAiCitation(
          'youtube.com',
          syntheticQuestions,
          meta.title
        );
        const coreResult = buildYouTubeAnalysisResult(url, meta, geminiResult, {
          hasActualAiCitation,
        });
        const { issues } = await deriveAuditIssues(coreResult);
        const recommendations = await generateGeoRecommendations(
          [],
          issues,
          { searchQuestions: [], pageQuestions: coreResult.pageQuestions }
        );
        return {
          ...coreResult,
          recommendations: recommendations ?? undefined,
        };
      }
    }

    const html = await fetchHtml(url, appOrigin);
    const extracted = extractMetaAndContent(html);
    const config = await loadActiveScoringConfig();
    const {
      meta, headings, h1Count, contentText, pageQuestions,
      hasFaqSchema, hasStructuredData, hasProductSchema, contentQuality, trustSignals: rawTrustSignals,
    } = extracted;

    const analysisHostFromUrl = (() => {
      try {
        return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      } catch {
        return '';
      }
    })();
    const isYouTube = /youtube\.com$/i.test(analysisHostFromUrl);
    const contentForAnalysis = isYouTube
      ? [meta.title, meta.description].filter(Boolean).join(' ')
      : contentText;

    const seedKeywords = extractSeedKeywords(
      meta as AnalysisMeta,
      headings,
      contentForAnalysis
    );

    let searchQuestions = await fetchSearchQuestions(seedKeywords);
    searchQuestions = await filterQuestionsByPageRelevance(
      searchQuestions,
      meta.title,
      contentForAnalysis.slice(0, 1500)
    );

    const analysisHost = analysisHostFromUrl;
    const hasSearchExposure =
      analysisHost.length > 0 &&
      searchQuestions.some((q) => {
        if (!q.url) return false;
        try {
          const h = new URL(q.url).hostname.toLowerCase().replace(/^www\./, '');
          return h === analysisHost || h.endsWith('.' + analysisHost) || analysisHost.endsWith('.' + h);
        } catch {
          return false;
        }
      });

    const hasDomainAuth = hasDomainAuthority(url) || isYouTube;
    const hasActualAiCitationRes = await checkActualAiCitation(
      analysisHost,
      searchQuestions,
      meta.title
    );
    const trustSignals = {
      ...rawTrustSignals,
      hasDomainAuthority: hasDomainAuth,
      hasSearchExposure,
      hasActualAiCitation:
        hasActualAiCitationRes || hasActualAiCitationDomain(analysisHost) || isYouTube,
    };
    const chunks = extractChunks(html);

    const isFaqLikePage = detectFaqLikePage({ hasFaqSchema, headings });

    const [paragraphStats, chunkCitations] = await Promise.all([
      Promise.resolve(analyzeParagraphs(html, headings, searchQuestions)),
      evaluateCitations({
        chunks,
        searchQuestions,
        isFaqLikePage,
        hasActualAiCitation: trustSignals.hasActualAiCitation ?? false,
      }),
    ]);
    const paragraphScore = paragraphStatsToScore(paragraphStats, { isFaqLikePage });
    let citationScore = citationsToScore(chunkCitations);

    const maxChunkScore = chunkCitations.length > 0
      ? Math.max(...chunkCitations.map((c) => c.score * 10))
      : 0;
    // 인용 점수 하한: 에이스 문단이 전체 인용 점수를 자연스럽게 견인
    if (citationScore >= 0 && maxChunkScore > 0) {
      citationScore = Math.max(citationScore, maxChunkScore * 0.9);
    }
    // 비디오 플랫폼(유튜브): AI가 비디오 콘텐츠를 높게 인용하므로 하한 70점
    if (isYouTube) {
      citationScore = Math.max(citationScore, 70);
    }

    // [수정] 페이지 유형 감지 로직 강화
    const isDanawa = url.includes('danawa.com');
    const dataDensity =
      (contentQuality.tableCount > 0 ? 1 : 0) * 0.3 +
      (contentQuality.listCount >= 1 ? 1 : 0) * 0.25 + // 기준 완화 (2 -> 1)
      ((contentQuality.productSpecBlockCount ?? 0) >= 1 ? 1 : 0) * 0.25 +
      (contentQuality.hasPriceInfo ? 1 : 0) * 0.2;

    // URL 기반 강제 판정 추가
    const isDataPage = isDanawa || hasProductSchema || dataDensity >= 0.3;
    const isBlog = /tistory|egloos|blog\.me|medium\.com|wordpress\.com|blog\.daum/i.test(url);

    // [수정] 인용 권위: Top Tier OR 실제 AI 인용 검증. Tavily 검색 노출은 SEO 증거일 뿐, 인용 확정 아님.
    const hasAuthority = trustSignals.hasDomainAuthority || trustSignals.hasActualAiCitation || isDanawa;

    if (citationScore < 0) {
      if (isDataPage) {
        // 데이터 페이지는 존재만으로 인용 가능성이 높다고 판단
        const dataBonus =
          40 + // 기본 베이스 상향
          (hasProductSchema ? 20 : 0) +
          (hasAuthority ? 20 : 0) +
          Math.min((contentQuality.productSpecBlockCount ?? 0) * 5, 20);
        citationScore = Math.min(85, dataBonus);
      } else if (hasAuthority) {
        citationScore = 60; // 권위 있는 사이트 기본점수
      }
    } else if (citationScore >= 0 && citationScore < 70 && (isDataPage || hasAuthority)) {
      // citation이 낮게 나와도(예: 37) 데이터/권위 페이지는 인용 가능성 보정
      citationScore = Math.min(85, Math.round(citationScore * 1.3 + (hasAuthority ? 15 : 0)));
    }
    // isDataPage + hasAuthority: 최소 75점 하한선 (대형 도메인은 AI가 우선 인용)
    if (isDataPage && hasAuthority) {
      citationScore = Math.max(citationScore, 75);
    }
    // 유튜브: 본문 대신 페이지 제목·설명을 핵심 분석 대상으로 사용
    const effectiveContentText = contentForAnalysis;

    const { questionCoverage } = calculateQuestionCoverage(
      pageQuestions, searchQuestions, effectiveContentText
    );
    const questionCoverageScore = questionCoverage * 100;
    let questionMatchScore = computeQuestionMatchScore(searchQuestions, effectiveContentText);
    // searchQuestions 비어 있으면 communityFitScore(0~100)로 폴백
    if (questionMatchScore === 0 && (paragraphStats.communityFitScore ?? 0) > 0) {
      questionMatchScore = Math.min(100, paragraphStats.communityFitScore ?? 0);
    }

    // Step 2: 실제 인용 + FAQ/질문 매칭 시 citationScore Floor (최소 70)
    const hasActualAiCitation = trustSignals.hasActualAiCitation ?? false;
    if (
      (isFaqLikePage || questionMatchScore >= 70) &&
      hasActualAiCitation &&
      citationScore >= 0
    ) {
      const floorByQuestion = questionMatchScore * 0.8;
      const minCitation = 70;
      citationScore = Math.max(citationScore, floorByQuestion, minCitation);
      citationScore = Math.min(100, citationScore);
    }

    const features: PageFeatures = {
      meta, headings, h1Count, pageQuestions, seedKeywords,
      questionCoverage: questionCoverageScore, structureScore: 0,
      hasFaqSchema, hasStructuredData, hasProductSchema,
      descriptionLength: meta.description?.trim().length ?? 0,
      contentQuality, trustSignals,
    };

    const structureScore = calculateStructureScore(features, config.structureRules, config.structureBaseScore, isDataPage);
    let answerabilityScore = calculateRuleScore(features, config.answerabilityRules ?? [], 0);
    // 데이터 페이지: AI는 텍스트 양보다 데이터 정확성을 더 높게 평가 → 최소 65점 베이스
    if (isDataPage && answerabilityScore < 65) {
      answerabilityScore = 65;
    }
    let trustScore = calculateRuleScore(features, config.trustRules ?? [], 0);
    // 신뢰도 가산: Top Tier/실제 AI 인용 = +20, Tavily 검색 노출만 = +5 (SEO 증거, AI 인용 아님)
    if (trustSignals.hasDomainAuthority || trustSignals.hasActualAiCitation) {
      trustScore = Math.min(100, trustScore + 20);
    } else if (trustSignals.hasSearchExposure) {
      trustScore = Math.min(100, trustScore + 5);
    }
    // 비디오 플랫폼(유튜브) 전용 가산점
    if (isYouTube) {
      trustScore = Math.min(100, trustScore + 15);
    }
    // 페널티 완화: 블로그/에이스 문단은 구조 감점 70% 할인 (덜 깎는 방식)
    const hasAceChunk = maxChunkScore > 0;
    const mitigateStructure = (isBlog || hasAceChunk) && structureScore < 50;
    let effectiveStructureScore = mitigateStructure
      ? structureScore + (50 - structureScore) * 0.7  // 감점의 30%만 적용
      : structureScore;

    // Step 3: 실제 인용된 FAQ 페이지는 structureScore 최소 60점 보장
    if (hasActualAiCitation && isFaqLikePage) {
      effectiveStructureScore = Math.max(effectiveStructureScore, 60);
    }
    features.structureScore = effectiveStructureScore;

    // 신뢰도 기반 가변 가중치: maxChunkScore가 높을수록 citation 비중 45%→65% 선형 증가
    const hasCitation = citationScore >= 0;
    let citationWeight = 0.45 + 0.2 * (maxChunkScore / 100);
    let structureWeight = 0.15 - 0.1 * (maxChunkScore / 100);
    let trustWeight = 0.15 - 0.1 * (maxChunkScore / 100);
    let paragraphWeight = 0.05;
    let questionMatchWeight = 0.05;
    let answerabilityWeight = 0.15;
    let questionCoverageWeight = 0.10;

    // Step 3: 실제 인용된 FAQ 페이지 — 구조 비중 감소, 질문/인용 비중 강화
    if (hasActualAiCitation && isFaqLikePage) {
      citationWeight = 0.40;
      paragraphWeight = 0.10;
      answerabilityWeight = 0.15;
      structureWeight = 0.05;
      trustWeight = 0.10;
      questionMatchWeight = 0.15;
      questionCoverageWeight = 0.10;
    } else if (isFaqLikePage || questionMatchScore >= 70) {
      questionMatchWeight = questionMatchScore >= 80 ? 0.20 : 0.15;
      structureWeight = Math.max(0.05, structureWeight - 0.05);
      trustWeight = Math.max(0.05, trustWeight - 0.05);
      if (questionMatchWeight >= 0.20) paragraphWeight = 0;
    }

    let finalScore: number;
    if (hasCitation || citationScore > 0) {
      const total =
        citationWeight + paragraphWeight + answerabilityWeight +
        structureWeight + trustWeight + questionMatchWeight + questionCoverageWeight;
      finalScore = Math.round(
        citationScore * (citationWeight / total) +
        paragraphScore * (paragraphWeight / total) +
        answerabilityScore * (answerabilityWeight / total) +
        effectiveStructureScore * (structureWeight / total) +
        trustScore * (trustWeight / total) +
        questionMatchScore * (questionMatchWeight / total) + 
        questionCoverageScore * (questionCoverageWeight / total)
      );
    } else {
      let wP = 0.30, wA = 0.25, wS = 0.20, wT = 0.20, wQ = 0.05;
      if (hasActualAiCitation && isFaqLikePage) {
        wP = 0.25;
        wA = 0.30;
        wS = 0.05;
        wT = 0.10;
        wQ = 0.30;
      } else if (isFaqLikePage || questionMatchScore >= 70) {
        wQ = questionMatchScore >= 80 ? 0.20 : 0.15;
        wP = 0.20;
        wS = 0.15;
        wT = 0.15;
      }
      const total = wP + wA + wS + wT + wQ;
      finalScore = Math.round(
        paragraphScore * (wP / total) +
        answerabilityScore * (wA / total) +
        effectiveStructureScore * (wS / total) +
        trustScore * (wT / total) +
        questionMatchScore * (wQ / total)
      );
    }

    finalScore = Math.min(100, Math.max(0, finalScore));

    // Hard Cap: 80점 이상은 실제 AI 인용 또는 Top Tier 도메인 있어야 진입
    if (trustSignals.hasDomainAuthority || trustSignals.hasActualAiCitation) {
      // 인용 증거 있음 — 상한 없음
    } else if (trustSignals.hasSearchExposure) {
      // 검색 노출만 있음: 79점 상한 (SEO vs AI 인용 구분)
      finalScore = Math.min(finalScore, 79);
    } else {
      // 검색 노출·도메인 권위 둘 다 없음: 70점 상한
      finalScore = Math.min(finalScore, 70);
    }

    const scores: GeoScores = {
      structureScore: effectiveStructureScore, answerabilityScore, trustScore,
      paragraphScore, citationScore,
      questionCoverage: questionCoverageScore,
      questionMatchScore,
      finalScore,
    };

    if (process.env.GEO_DEBUG === '1') {
      console.log('GEO DEBUG (LGESY)', {
        citationScore,
        structureScore: effectiveStructureScore,
        paragraphScore,
        answerabilityScore,
        trustScore,
        questionMatchScore,
        isFaqLikePage,
        hasActualAiCitation,
        finalScore,
      });
    }

    const searchQuestionCovered = computeSearchQuestionCoverage(
      pageQuestions,
      searchQuestions,
      effectiveContentText
    );

    const coreResult: AnalysisResult = {
      url,
      normalizedUrl: normalizeUrl(url),
      analyzedAt: new Date().toISOString(),
      meta,
      seedKeywords,
      pageQuestions,
      searchQuestions,
      searchQuestionCovered,
      questionClusters: [],
      scores,
      contentQuality,
      trustSignals,
      paragraphStats,
      chunkCitations: chunkCitations.length > 0 ? chunkCitations : undefined,
      headings,
      h1Count,
      hasFaqSchema,
      hasStructuredData,
    };

    const { issues } = await deriveAuditIssues(coreResult);
    const uncoveredQuestions = findUncoveredQuestions(
      pageQuestions,
      searchQuestions,
      effectiveContentText
    );
    const recommendations = await generateGeoRecommendations(uncoveredQuestions, issues, {
      searchQuestions,
      pageQuestions,
    });

    return {
      ...coreResult,
      recommendations: recommendations ?? undefined,
    };
  } catch (error) {
    console.error('runAnalysis 오류:', error);
    throw new Error(
      `분석 실행 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function calculateRuleScore(
  features: PageFeatures, rules: ScoringRule[], baseScore: number
): number {
  let score = baseScore;
  for (const rule of rules) {
    if (evaluateCheck(rule.check, features, rule.threshold)) score += rule.points;
  }
  return Math.min(100, Math.max(0, score));
}

/**
 * isDataPage일 때: H1/헤딩 구조 실패 시 감점 50% 감면, 스키마 가산점 2배
 */
function calculateStructureScore(
  features: PageFeatures,
  rules: ScoringRule[],
  baseScore: number,
  isDataPage: boolean
): number {
  let score = baseScore;
  for (const rule of rules) {
    const passed = evaluateCheck(rule.check, features, rule.threshold);
    if (passed) {
      // 통과 시: isDataPage에서 스키마 관련은 2배
      if (isDataPage && (rule.id === 'schema_product' || rule.id === 'schema')) {
        score += rule.points * 2;
      } else {
        score += rule.points;
      }
    } else if (isDataPage) {
      // 실패 시: H1/헤딩 구조 관련은 50% 감면 (반만 가산)
      if (rule.id === 'h1_single' || rule.id === 'h2_depth') {
        score += rule.points * 0.5;
      }
    }
  }
  return Math.min(100, Math.max(0, score));
}

function calculateQuestionCoverage(
  pageQuestions: string[],
  searchQuestions: Pick<SearchQuestion, 'text'>[],
  contentText: string
): { questionCoverage: number } {
  if (!searchQuestions || searchQuestions.length === 0) return { questionCoverage: 0 };

  const questionText = pageQuestions.join(' ').toLowerCase();
  const fullText = contentText.toLowerCase();
  let coveredCount = 0;

  for (const searchQ of searchQuestions) {
    const searchTokens = searchQ.text.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
    if (searchTokens.length === 0) continue;

    const minMatch = Math.max(1, Math.ceil(searchTokens.length * TOKEN_MATCH_RATIO));

    let fullTextMatches = 0;
    for (const token of searchTokens) {
      if (fullText.includes(token)) fullTextMatches++;
    }
    if (fullTextMatches >= minMatch) {
      coveredCount++;
      continue;
    }

    let questionMatches = 0;
    for (const token of searchTokens) {
      if (questionText.includes(token)) questionMatches++;
    }
    if (questionMatches >= minMatch) {
      coveredCount++;
      continue;
    }

    const minIntersection =
      searchTokens.length <= SHORT_QUESTION_TOKEN_THRESHOLD ? MIN_INTERSECTION_SHORT : MIN_INTERSECTION;
    for (const pageQ of pageQuestions) {
      const pageTokens = pageQ.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
      const intersection = searchTokens.filter((t) => pageTokens.includes(t));
      if (intersection.length >= minIntersection) {
        coveredCount++;
        break;
      }
    }
  }

  return { questionCoverage: coveredCount / searchQuestions.length };
}
