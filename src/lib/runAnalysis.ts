import { fetchHtml, extractMetaAndContent, normalizeUrl } from './htmlAnalyzer';
import { runGeminiVideoAnalysis, buildYouTubeAnalysisResult, VideoAnalysisQuotaSkipError, type GeminiVideoAnalysisResult } from './geminiVideoAnalysis';
import { estimateVideoCitationScore, estimateEditorialCitationScore } from './videoScoreFallback';
import { extractSeedKeywords } from './keywordExtractor';
import { fetchSearchQuestions, derivePrimaryTopic } from './searchQuestions';
import { filterQuestionsByPageRelevance } from './questionFilter';
import { loadActiveScoringConfig } from './scoringConfigLoader';
import { evaluateCheck } from './checkEvaluator';
import { analyzeParagraphs, paragraphStatsToScore } from './paragraphAnalyzer';
import { extractChunks, evaluateCitations, citationsToScore, CitationQuotaSkipError } from './citationEvaluator';
import { deriveAuditIssues } from './issueDetector';
import { generateGeoRecommendations } from './recommendationEngine';
import { generateTemplateRecommendations } from './recommendationFallback';
import { hasDomainAuthority } from './domainAuthority';
import { checkActualAiCitation, hasActualAiCitationDomain } from './actualAiCitation';
import { fetchYouTubeMetadata, fetchYouTubeOEmbed, isYouTubeUrl, youtubeMetadataToAnalysisMeta } from './youtubeMetadataExtractor';
import {
  computeQuestionMatchScore,
  computeSearchQuestionCoverage,
} from './questionCoverage';
import type {
  AnalysisResult,
  GeoScores,
  PageFeatures,
  AnalysisMeta,
  SearchQuestion,
  ScoringRule,
  PageType,
  LlmCallStatus,
} from './analysisTypes';

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

function findUncoveredQuestions(
  pageQuestions: string[],
  searchQuestions: SearchQuestion[],
  contentText: string
): SearchQuestion[] {
  const covered = computeSearchQuestionCoverage(pageQuestions, searchQuestions, contentText);
  return searchQuestions.filter((_, i) => !covered[i]);
}

export interface RunAnalysisOptions {
  appOrigin?: string;
}

/** 페이지 타입 감지 — profiles[pageType] 선택용 */
function detectPageType(url: string, hasProductSchema: boolean): PageType {
  if (isYouTubeUrl(url)) return 'video';
  const host = (() => {
    try {
      return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return '';
    }
  })();
  const commerceDomains = ['coupang.com', 'amazon.', 'gmarket.co.kr', '11st.co.kr', 'auction.co.kr', 'danawa.com'];
  if (commerceDomains.some((d) => host.includes(d)) || hasProductSchema) return 'commerce';
  return 'editorial';
}

export async function runAnalysis(url: string, options?: RunAnalysisOptions): Promise<AnalysisResult> {
  try {
    const appOrigin = options?.appOrigin ?? process.env.GEO_ANALYZER_BASE_URL;
    const llmStatuses: LlmCallStatus[] = [];

    // 유튜브 전용: ytInitialData/og → 필요 시 oEmbed fallback → effectiveContentText로 questionCoverage/answerability 0 방지
    if (isYouTubeUrl(url)) {
      console.log('[VIDEO] branch entered', { url });
      const VIDEO_DESC_PLACEHOLDER = 'No description available.';
      let meta: AnalysisMeta;
      const ytMeta = await fetchYouTubeMetadata(url);
      if (ytMeta?.title || ytMeta?.description) {
        meta = youtubeMetadataToAnalysisMeta(ytMeta);
      } else {
        const html = await fetchHtml(url, appOrigin);
        const extracted = extractMetaAndContent(html);
        meta = extracted.meta;
      }

      const contentFromMeta = (meta.description ?? meta.ogDescription ?? '').trim();
      const titleFromMeta = (meta.title ?? meta.ogTitle ?? '').trim();
      const needsOEmbedFallback =
        !titleFromMeta ||
        contentFromMeta.length < 20 ||
        /^[\s\-–—]*YouTube\s*$/i.test(titleFromMeta);

      let oembed: Awaited<ReturnType<typeof fetchYouTubeOEmbed>> | null = null;
      if (needsOEmbedFallback) {
        oembed = await fetchYouTubeOEmbed(url);
        if (oembed) {
          const cleanTitle = oembed.title?.replace(/\s*-\s*YouTube\s*$/, '').trim() || oembed.title;
          meta = { ...meta, title: meta.title || cleanTitle, ogTitle: meta.ogTitle || cleanTitle };
        }
      }
      const usedOEmbed = !!oembed;

      const rawTitle = meta.title ?? meta.ogTitle ?? '';
      const titleForText = (rawTitle && rawTitle.trim() && !/^[\s\-–—]*YouTube\s*$/i.test(rawTitle))
        ? rawTitle.trim()
        : (oembed?.title ?? 'YouTube Video');
      const authorForText = oembed?.author_name ?? '';
      const descriptionForText = (ytMeta?.description ?? meta.description ?? meta.ogDescription ?? '').trim() || VIDEO_DESC_PLACEHOLDER;
      const effectiveContentText = `${descriptionForText}\n${titleForText}\n${authorForText}`.trim();
    
      // 3) Gemini video analysis
      let geminiResult: Awaited<ReturnType<typeof runGeminiVideoAnalysis>> = null;
      try {
        geminiResult = await runGeminiVideoAnalysis(url, meta);
      } catch (e) {
        if (e instanceof VideoAnalysisQuotaSkipError) {
          llmStatuses.push({
            feature: 'videoAnalysis',
            status: 'skipped_quota',
            retryAfterSec: e.retryAfterSec,
            message: e.userMessage ?? '요청이 많아 잠시 후 다시 시도해주세요.',
          });
        } else {
          throw e;
        }
      }
      if (!geminiResult) {
        console.log('[VIDEO] geminiResult is null — Gemini video analysis failed/skipped');
      }

      const effectiveContent = geminiResult
        ? (() => {
            const summaryLines = [geminiResult.coreTopic, geminiResult.successFactor].filter(Boolean);
            return summaryLines.length
              ? `${effectiveContentText}\n\n${summaryLines.join('\n')}`
              : effectiveContentText;
          })()
        : effectiveContentText;

      if (geminiResult) {
        const enhancedContentText = effectiveContent;

        // 4) Tavily 질문 수집 (video profile)
        const seedKeywords = extractSeedKeywords(meta, [], enhancedContentText);

        const rawSearchQuestions = await fetchSearchQuestions(seedKeywords, {
          pageType: 'video',
          meta: { title: meta.title, ogTitle: meta.ogTitle },
          url,
        });
        const topic = derivePrimaryTopic({ title: meta.title, ogTitle: meta.ogTitle }, url, seedKeywords);
        let searchQuestions = await filterQuestionsByPageRelevance(
          rawSearchQuestions,
          meta.title ?? null,
          enhancedContentText.slice(0, 2000),
          { pageType: 'video', primaryPhrase: topic.primaryPhrase }
        );
        if (!searchQuestions.length) searchQuestions = rawSearchQuestions.slice(0, 10);

        const pageQuestions = meta.title ? [meta.title] : [];
        const top10 = searchQuestions.slice(0, 10);
        const uncoveredQuestions = findUncoveredQuestions(pageQuestions, top10, enhancedContentText);

        console.log('[VIDEO Q]', {
          raw: rawSearchQuestions.length,
          filtered: searchQuestions.length,
          sample: searchQuestions.slice(0, 3).map((q) => q.text.slice(0, 60)),
        });
    
        // 5) actual citation 체크
        const syntheticQuestions: SearchQuestion[] = geminiResult.citationKeywords
          .slice(0, 5)
          .map((text) => ({ source: 'google' as const, text }));
    
        const hasActualAiCitation = await checkActualAiCitation(
          'youtube.com',
          syntheticQuestions,
          meta.title
        );
    
        // 6) YouTube 분석 결과 생성 (searchQuestions/enhancedContentText 전달)
        const coreResult = await buildYouTubeAnalysisResult(url, meta, geminiResult, {
          hasActualAiCitation,
          usedOEmbed,
          effectiveContentText: enhancedContentText,
          searchQuestions,
        });
    
        console.log('[VIDEO CHECK]', {
          usedOEmbed: !!oembed,
          enhancedContentTextLength: enhancedContentText.length,
          searchQuestionsLen: coreResult.searchQuestions?.length ?? 0,
          coveredTrue: coreResult.searchQuestionCovered?.filter(Boolean).length ?? 0,
          questionCoverage: coreResult.scores.questionCoverage,
          questionMatchScore: coreResult.scores.questionMatchScore,
          finalScore: coreResult.scores.finalScore,
        });
    
        const { issues } = await deriveAuditIssues(coreResult);
    
        const recResult = await generateGeoRecommendations(
          uncoveredQuestions,
          issues,
          { searchQuestions: coreResult.searchQuestions, pageQuestions: coreResult.pageQuestions }
        );
        let recommendations: AnalysisResult['recommendations'];
        if (recResult && typeof recResult === 'object' && 'error' in recResult && recResult.error === 'quota_exceeded') {
          llmStatuses.push({
            feature: 'recommendations',
            status: 'skipped_quota',
            retryAfterSec: recResult.retryAfterSec,
            message: recResult.message ?? '요청이 많아 잠시 후 다시 시도해주세요.',
          });
          recommendations = generateTemplateRecommendations({
            pageType: 'video',
            uncoveredQuestions,
            issues,
            seedKeywords: coreResult.seedKeywords,
            metaTitle: meta.title ?? null,
          });
        } else if (recResult && !('error' in recResult)) {
          llmStatuses.push({ feature: 'recommendations', status: 'ok' });
          recommendations = recResult;
        } else {
          recommendations = generateTemplateRecommendations({
            pageType: 'video',
            uncoveredQuestions,
            issues,
            seedKeywords: coreResult.seedKeywords,
            metaTitle: meta.title ?? null,
          });
        }
    
        return {
          ...coreResult,
          recommendations,
          llmStatuses: llmStatuses.length > 0 ? llmStatuses : undefined,
        };
      }

      // geminiResult == null: 규칙 기반 fallback citation으로 video 결과 생성
      const seedKeywords = extractSeedKeywords(meta, [], effectiveContent);
      const rawSearchQuestions = await fetchSearchQuestions(seedKeywords, {
        pageType: 'video',
        meta: { title: meta.title, ogTitle: meta.ogTitle },
        url,
      });
      let searchQuestions = await filterQuestionsByPageRelevance(
        rawSearchQuestions,
        meta.title ?? null,
        effectiveContent.slice(0, 2000),
        { pageType: 'video' }
      );
      if (!searchQuestions.length) searchQuestions = rawSearchQuestions.slice(0, 10);
      const pageQuestions = meta.title ? [meta.title] : [];
      const searchQuestionCovered = computeSearchQuestionCoverage(pageQuestions, searchQuestions, effectiveContent);
      const questionCoverageScore = searchQuestions.length > 0
        ? Math.round((searchQuestionCovered.filter(Boolean).length / searchQuestions.length) * 100)
        : 0;
      const questionMatchScore = computeQuestionMatchScore(searchQuestions, effectiveContent);
      const hasSearchExposure = searchQuestions.some((q) => {
        if (!q.url) return false;
        try {
          const h = new URL(q.url).hostname.toLowerCase();
          return h.includes('youtube.com');
        } catch { return false; }
      });
      const fallbackCitationScore = estimateVideoCitationScore({
        questionCoverageScore,
        questionMatchScore,
        enhancedContentTextLength: effectiveContent.length,
        hasActualAiCitation: false,
        hasSearchExposure,
      });
      const syntheticGemini: GeminiVideoAnalysisResult = {
        citationScore: fallbackCitationScore,
        paragraphScore: 50,
        scarcityScore: 50,
        expertiseScore: 50,
        substantiveDataScore: 50,
        citationKeywords: [],
        coreTopic: '',
        youtubeIssues: [],
        successFactor: '',
      };
      const coreResult = await buildYouTubeAnalysisResult(url, meta, syntheticGemini, {
        hasActualAiCitation: false,
        usedOEmbed,
        effectiveContentText: effectiveContent,
        searchQuestions,
        fallbackCitationScore,
      });
      const { issues } = await deriveAuditIssues(coreResult);
      const top10 = searchQuestions.slice(0, 10);
      const uncoveredQuestions = findUncoveredQuestions(pageQuestions, top10, effectiveContent);
      const recResult = await generateGeoRecommendations(
        uncoveredQuestions,
        issues,
        { searchQuestions: coreResult.searchQuestions, pageQuestions: coreResult.pageQuestions }
      );
      let recommendations: AnalysisResult['recommendations'];
      if (recResult && typeof recResult === 'object' && 'error' in recResult && recResult.error === 'quota_exceeded') {
        llmStatuses.push({
          feature: 'recommendations',
          status: 'skipped_quota',
          retryAfterSec: recResult.retryAfterSec,
          message: recResult.message ?? '요청이 많아 잠시 후 다시 시도해주세요.',
        });
        recommendations = generateTemplateRecommendations({
          pageType: 'video',
          uncoveredQuestions,
          issues,
          seedKeywords: coreResult.seedKeywords,
          metaTitle: meta.title ?? null,
        });
      } else if (recResult && !('error' in recResult)) {
        llmStatuses.push({ feature: 'recommendations', status: 'ok' });
        recommendations = recResult;
      } else {
        recommendations = generateTemplateRecommendations({
          pageType: 'video',
          uncoveredQuestions,
          issues,
          seedKeywords: coreResult.seedKeywords,
          metaTitle: meta.title ?? null,
        });
      }
      return {
        ...coreResult,
        recommendations,
        llmStatuses: llmStatuses.length > 0 ? llmStatuses : undefined,
      };
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
    const isYouTube = isYouTubeUrl(url);
    const contentForAnalysis = isYouTube
      ? [meta.title, meta.description].filter(Boolean).join(' ')
      : contentText;

    const seedKeywords = extractSeedKeywords(
      meta as AnalysisMeta,
      headings,
      contentForAnalysis
    );

    let searchQuestions = await fetchSearchQuestions(seedKeywords, {
      meta: { title: meta.title, ogTitle: meta.ogTitle },
      url,
    });
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

    let paragraphStats: Awaited<ReturnType<typeof analyzeParagraphs>>;
    let chunkCitations: Awaited<ReturnType<typeof evaluateCitations>>;
    try {
      const [ps, cc] = await Promise.all([
        analyzeParagraphs(html, headings, searchQuestions),
        evaluateCitations({
          chunks,
          searchQuestions,
          isFaqLikePage,
          hasActualAiCitation: trustSignals.hasActualAiCitation ?? false,
        }),
      ]);
      paragraphStats = ps;
      chunkCitations = cc;
      llmStatuses.push({ feature: 'citations', status: 'ok' });
    } catch (e) {
      if (e instanceof CitationQuotaSkipError) {
        const [ps] = await Promise.all([analyzeParagraphs(html, headings, searchQuestions)]);
        paragraphStats = ps;
        chunkCitations = [];
        llmStatuses.push({
          feature: 'citations',
          status: 'skipped_quota',
          retryAfterSec: e.retryAfterSec,
          message: e.userMessage ?? '요청이 많아 잠시 후 다시 시도해주세요.',
        });
      } else {
        throw e;
      }
    }
    const paragraphScore = paragraphStatsToScore(paragraphStats, { isFaqLikePage });
    let citationScore = citationsToScore(chunkCitations);
    if (citationScore < 0 && chunkCitations.length === 0 && llmStatuses.some((s) => s.feature === 'citations' && s.status === 'skipped_quota')) {
      const covered = computeSearchQuestionCoverage(pageQuestions, searchQuestions, contentForAnalysis);
      const qCoverage = searchQuestions.length > 0
        ? Math.round((covered.filter(Boolean).length / searchQuestions.length) * 100)
        : 0;
      const qMatch = computeQuestionMatchScore(searchQuestions, contentForAnalysis);
      citationScore = estimateEditorialCitationScore({
        questionCoverageScore: qCoverage,
        questionMatchScore: qMatch,
        contentLength: contentForAnalysis.length,
        hasActualAiCitation: trustSignals.hasActualAiCitation ?? false,
      });
    }

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

    const searchQuestionCovered = computeSearchQuestionCoverage(
      pageQuestions, searchQuestions, effectiveContentText
    );
    const questionCoverageScore =
      searchQuestions.length > 0
        ? Math.round((searchQuestionCovered.filter(Boolean).length / searchQuestions.length) * 100)
        : 0;
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

    const pageType = detectPageType(url, hasProductSchema ?? false);

    const coreResult: AnalysisResult = {
      url,
      normalizedUrl: normalizeUrl(url),
      analyzedAt: new Date().toISOString(),
      pageType,
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
    const recResult = await generateGeoRecommendations(uncoveredQuestions, issues, {
      searchQuestions,
      pageQuestions,
    });
    let recommendations: AnalysisResult['recommendations'];
    if (recResult && typeof recResult === 'object' && 'error' in recResult && recResult.error === 'quota_exceeded') {
      llmStatuses.push({
        feature: 'recommendations',
        status: 'skipped_quota',
        retryAfterSec: recResult.retryAfterSec,
        message: recResult.message ?? '요청이 많아 잠시 후 다시 시도해주세요.',
      });
      recommendations = generateTemplateRecommendations({
        pageType,
        uncoveredQuestions,
        issues,
        seedKeywords: coreResult.seedKeywords,
        metaTitle: meta.title ?? null,
      });
    } else if (recResult && !('error' in recResult)) {
      llmStatuses.push({ feature: 'recommendations', status: 'ok' });
      recommendations = recResult;
    } else {
      recommendations = generateTemplateRecommendations({
        pageType,
        uncoveredQuestions,
        issues,
        seedKeywords: coreResult.seedKeywords,
        metaTitle: meta.title ?? null,
      });
    }

    return {
      ...coreResult,
      recommendations,
      llmStatuses: llmStatuses.length > 0 ? llmStatuses : undefined,
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