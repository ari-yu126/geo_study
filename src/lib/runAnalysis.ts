import { fetchHtml, extractMetaAndContent, normalizeUrl } from './htmlAnalyzer';
import { runGeminiVideoAnalysis, buildYouTubeAnalysisResult, VideoAnalysisQuotaSkipError, type GeminiVideoAnalysisResult } from './geminiVideoAnalysis';
import {
  estimateVideoCitationScore,
  estimateEditorialCitationScore,
  type EditorialCitationFallbackResult,
} from './videoScoreFallback';
import { extractSeedKeywords } from './keywordExtractor';
import { fetchSearchQuestions, derivePrimaryTopic } from './searchQuestions';
import { filterQuestionsByPageRelevance, type FilterQuestionsRunMeta } from './questionFilter';
import { getProfileForPageType, loadActiveScoringConfig } from './scoringConfigLoader';
import { evaluateCheck } from './checkEvaluator';
import { analyzeParagraphs, paragraphStatsToScore } from './paragraphAnalyzer';
import { extractChunks, evaluateCitations, citationsToScore } from './citationEvaluator';
import { deriveAuditIssues } from './issueDetector';
import { buildAxisScores, logGeoExplainDebug } from './geoExplain';
import { generateGeoRecommendations } from './recommendationEngine';
import { generateTemplateRecommendations } from './recommendationFallback';
import { detectEditorialSubtype } from './editorialSubtype';
import { hasDomainAuthority } from './domainAuthority';
import { checkActualAiCitation, hasActualAiCitationDomain, type CheckActualAiCitationMeta } from './actualAiCitation';
import { fetchYouTubeMetadata, fetchYouTubeOEmbed, isYouTubeUrl, youtubeMetadataToAnalysisMeta } from './youtubeMetadataExtractor';
import {
  computeQuestionMatchScore,
  computeSearchQuestionCoverage,
} from './questionCoverage';
import type {
  AnalysisResult,
  ChunkCitation,
  GeoScores,
  PageFeatures,
  AnalysisMeta,
  SearchQuestion,
  ScoringRule,
  PageType,
  LlmCallStatus,
} from './analysisTypes';
import {
  blendMonthlyAndFixed,
  buildBlendDebug,
  computeCommerceFixedFinal,
  computeCommerceMonthlyFinal,
  computeEngineFixedWeights5,
  computeEngineFixedWeights7,
  computeMonthlyWeights5,
  computeMonthlyWeights7,
  profileForScoreBlend,
  resolveBlendAlpha,
  scoreFromWeights5,
  scoreFromWeights7,
  type AxisScores5,
  type AxisScores7,
  type FinalBlendContext,
} from './geoScoreBlend';
import { detectPageType, computeEditorialComparisonScore } from './pageTypeDetection';
import {
  computeExtractionMetrics,
  shouldAttemptHeadlessFetch,
  headlessImprovesExtraction,
} from './articleExtraction';
import { fetchHtmlViaHeadless } from './headlessHtmlFetch';
import { runWithGeminiTrace } from './geminiTraceContext';

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

/** Set GEO_SCORE_AXIS_DEBUG=1; optional GEO_SCORE_AXIS_URL=rtings.com to filter by URL substring */
function shouldLogGeoScoreAxis(targetUrl: string): boolean {
  if (process.env.GEO_SCORE_AXIS_DEBUG !== '1') return false;
  const needle = (process.env.GEO_SCORE_AXIS_URL ?? '').trim();
  if (!needle) return true;
  try {
    return targetUrl.toLowerCase().includes(needle.toLowerCase());
  } catch {
    return false;
  }
}

export interface RunAnalysisOptions {
  appOrigin?: string;
}

export async function runAnalysis(url: string, options?: RunAnalysisOptions): Promise<AnalysisResult> {
  const normalizedUrl = normalizeUrl(url);
  return runWithGeminiTrace({ normalizedUrl }, () => runAnalysisImpl(url, options));
}

async function runAnalysisImpl(url: string, options?: RunAnalysisOptions): Promise<AnalysisResult> {
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
        const fqVideo = await filterQuestionsByPageRelevance(
          rawSearchQuestions,
          meta.title ?? null,
          enhancedContentText.slice(0, 2000),
          { pageType: 'video', primaryPhrase: topic.primaryPhrase }
        );
        let searchQuestions = fqVideo.questions;
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
    
        const aiCitationVideo = await checkActualAiCitation(
          'youtube.com',
          syntheticQuestions,
          meta.title
        );
        const hasActualAiCitation = aiCitationVideo.matched;
    
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
    
        coreResult.axisScores = buildAxisScores(coreResult);
        const auditVideo = await deriveAuditIssues(coreResult);
        const { issues, passedChecks, geoIssues, geoPassedItems, opportunities } = auditVideo;
        const geoExplainVideo = {
          axisScores: coreResult.axisScores,
          issues: geoIssues,
          passed: geoPassedItems,
          opportunities,
        };
        logGeoExplainDebug(url, coreResult.pageType, geoExplainVideo);

        const recResult = await generateGeoRecommendations(
          uncoveredQuestions,
          issues,
          {
            searchQuestions: coreResult.searchQuestions,
            pageQuestions: coreResult.pageQuestions,
            pageType: 'video',
            geoOpportunities: opportunities,
            geoIssues,
            axisScores: coreResult.axisScores,
          }
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
          passedChecks,
          geoExplain: geoExplainVideo,
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
      const fqVideoFb = await filterQuestionsByPageRelevance(
        rawSearchQuestions,
        meta.title ?? null,
        effectiveContent.slice(0, 2000),
        { pageType: 'video' }
      );
      let searchQuestions = fqVideoFb.questions;
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
      coreResult.axisScores = buildAxisScores(coreResult);
      const auditVideoFb = await deriveAuditIssues(coreResult);
      const {
        issues,
        passedChecks,
        geoIssues: geoIssuesFb,
        geoPassedItems: geoPassedFb,
        opportunities: oppsFb,
      } = auditVideoFb;
      const geoExplainVideoFb = {
        axisScores: coreResult.axisScores,
        issues: geoIssuesFb,
        passed: geoPassedFb,
        opportunities: oppsFb,
      };
      logGeoExplainDebug(url, coreResult.pageType, geoExplainVideoFb);
      const top10 = searchQuestions.slice(0, 10);
      const uncoveredQuestions = findUncoveredQuestions(pageQuestions, top10, effectiveContent);
      const recResult = await generateGeoRecommendations(
        uncoveredQuestions,
        issues,
        {
          searchQuestions: coreResult.searchQuestions,
          pageQuestions: coreResult.pageQuestions,
          pageType: 'video',
          geoOpportunities: oppsFb,
          geoIssues: geoIssuesFb,
          axisScores: coreResult.axisScores,
        }
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
        passedChecks,
        geoExplain: geoExplainVideoFb,
        llmStatuses: llmStatuses.length > 0 ? llmStatuses : undefined,
      };
    }

    const analysisHostFromUrl = (() => {
      try {
        return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      } catch {
        return '';
      }
    })();

    let html = await fetchHtml(url, appOrigin);
    let extractionSource: 'server' | 'headless' = 'server';
    const preMetrics = computeExtractionMetrics(html);
    if (shouldAttemptHeadlessFetch(analysisHostFromUrl, preMetrics)) {
      try {
        const htmlH = await fetchHtmlViaHeadless(url);
        const postMetrics = computeExtractionMetrics(htmlH);
        if (headlessImprovesExtraction(preMetrics, postMetrics)) {
          html = htmlH;
          extractionSource = 'headless';
        }
        if (process.env.GEO_EXTRACTION_DEBUG === '1') {
          console.log('[GEO_EXTRACTION]', {
            url,
            host: analysisHostFromUrl,
            server: preMetrics,
            headless: postMetrics,
            usedHeadless: extractionSource === 'headless',
          });
        }
      } catch (e) {
        console.warn('[GEO] headless HTML fetch failed', e);
      }
    }

    const extracted = extractMetaAndContent(html);
    const config = await loadActiveScoringConfig();
    const {
      meta, headings, h1Count, contentText, pageQuestions,
      hasFaqSchema, hasStructuredData, hasProductSchema, hasReviewSchema, contentQuality, trustSignals: rawTrustSignals,
    } = extracted;
    const pageType = detectPageType(url, config, {
      meta,
      headings,
      contentSnippet: contentText.slice(0, 20000),
      contentQuality,
      hasProductSchemaLegacy: hasProductSchema ?? false,
    });
    const isCommerce = pageType === 'commerce';
    const isDanawa = url.includes('danawa.com');
    const dataDensity =
      (contentQuality.tableCount > 0 ? 1 : 0) * 0.3 +
      (contentQuality.listCount >= 1 ? 1 : 0) * 0.25 +
      ((contentQuality.productSpecBlockCount ?? 0) >= 1 ? 1 : 0) * 0.25 +
      (contentQuality.hasPriceInfo ? 1 : 0) * 0.2;
    const isDataPage = isDanawa || hasProductSchema || dataDensity >= 0.3;
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
    const fqEditorial = await filterQuestionsByPageRelevance(
      searchQuestions,
      meta.title,
      contentForAnalysis.slice(0, 1500)
    );
    searchQuestions = fqEditorial.questions;
    const filterQuestionsMeta: FilterQuestionsRunMeta = fqEditorial.meta;

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
    const actualAiCitationCheck = await checkActualAiCitation(
      analysisHost,
      searchQuestions,
      meta.title
    );
    const hasActualAiCitationRes = actualAiCitationCheck.matched;
    const actualAiCitationMeta: CheckActualAiCitationMeta = actualAiCitationCheck.meta;
    const trustSignals = {
      ...rawTrustSignals,
      hasDomainAuthority: hasDomainAuth,
      hasSearchExposure,
      hasActualAiCitation:
        hasActualAiCitationRes || hasActualAiCitationDomain(analysisHost) || isYouTube,
    };
    // Minimal test: only extract top 3 chunks to limit Gemini calls
    const chunks = extractChunks(html, 3);
    const extractionMetricsForFlags = computeExtractionMetrics(html);
    const extractionIncomplete =
      extractionMetricsForFlags.citationExtractedChunkCount < 2 &&
      (extractionMetricsForFlags.rawBodyTextLength < 5200 || contentText.length < 4800);

    const isFaqLikePage = detectFaqLikePage({ hasFaqSchema, headings });

    // Ensure analyzeParagraphs and evaluateCitations never run in parallel.
    // Use sequential execution and limit paragraph analysis to top 3.
    const paragraphStats = analyzeParagraphs(html, headings, searchQuestions, 3);
    let paragraphScore = paragraphStatsToScore(paragraphStats, { isFaqLikePage });

    const searchQuestionCovered = computeSearchQuestionCoverage(
      pageQuestions,
      searchQuestions,
      contentForAnalysis
    );
    const questionCoverageScore =
      searchQuestions.length > 0
        ? Math.round((searchQuestionCovered.filter(Boolean).length / searchQuestions.length) * 100)
        : 0;
    let questionMatchScore = computeQuestionMatchScore(searchQuestions, contentForAnalysis);
    if (questionMatchScore === 0 && (paragraphStats.communityFitScore ?? 0) > 0) {
      questionMatchScore = Math.min(100, paragraphStats.communityFitScore ?? 0);
    }

    const reviewLikePage = (() => {
      try {
        const reviewMarkers = [
          'review', '리뷰', '후기', '비교', '장단점', 'pros', 'cons', 'verdict', 'best', '사용기', '추천',
        ];
        const textToCheck = [
          meta.title ?? '',
          meta.ogTitle ?? '',
          (headings ?? []).slice(0, 5).join(' '),
          seedKeywords.map((s) => s.value).slice(0, 5).join(' '),
        ]
          .join(' ')
          .toLowerCase();
        const hasMarker = reviewMarkers.some((m) => textToCheck.includes(m));
        const hasListOrTable =
          (contentQuality.listCount ?? 0) > 0 || (contentQuality.tableCount ?? 0) > 0;
        return hasMarker || hasListOrTable;
      } catch {
        return false;
      }
    })();
    const editorialComparisonScore = computeEditorialComparisonScore(
      meta as AnalysisMeta,
      headings,
      contentText,
      url
    );

    const features: PageFeatures = {
      meta,
      headings,
      h1Count,
      pageQuestions,
      seedKeywords,
      questionCoverage: questionCoverageScore,
      structureScore: 0,
      hasFaqSchema,
      hasStructuredData,
      hasProductSchema,
      descriptionLength: meta.description?.trim().length ?? 0,
      contentQuality,
      trustSignals,
    };
    let structureScore = calculateStructureScore(
      features,
      config.structureRules,
      config.structureBaseScore,
      isDataPage
    );
    const answerabilityResult = calculateRuleScore(
      features,
      config.answerabilityRules ?? [],
      0,
      pageType
    );
    let answerabilityScore =
      answerabilityResult.maxScore > 0
        ? Math.round((answerabilityResult.score / answerabilityResult.maxScore) * 100)
        : 0;
    if (isDataPage && answerabilityScore < 65) {
      answerabilityScore = 65;
    }
    const trustResult = calculateRuleScore(features, config.trustRules ?? [], 0, pageType);
    let trustScore =
      trustResult.maxScore > 0
        ? Math.round((trustResult.score / trustResult.maxScore) * 100)
        : 0;
    if (trustSignals.hasDomainAuthority || trustSignals.hasActualAiCitation) {
      trustScore = Math.min(100, trustScore + 20);
    } else if (trustSignals.hasSearchExposure) {
      trustScore = Math.min(100, trustScore + 5);
    }
    if (isYouTube) {
      trustScore = Math.min(100, trustScore + 15);
    }

    let citationFallbackMeta: EditorialCitationFallbackResult | null = null;
    const citationResult = await evaluateCitations({
      chunks,
      searchQuestions,
      isFaqLikePage,
      hasActualAiCitation: trustSignals.hasActualAiCitation ?? false,
    });
    const chunkCitations = citationResult.citations;
    if (citationResult.skippedQuota) {
      llmStatuses.push({
        feature: 'citations',
        status: 'skipped_quota',
        retryAfterSec: citationResult.skippedQuota.retryAfterSec,
        message: citationResult.skippedQuota.message ?? '요청이 많아 잠시 후 다시 시도해주세요.',
      });
    } else {
      llmStatuses.push({ feature: 'citations', status: 'ok' });
    }
    let citationScore = citationsToScore(chunkCitations);
    let usedEditorialCitationEstimateFallback = false;
    const geminiCitationSkippedQuota = !!citationResult.skippedQuota;
    let maxChunkScore =
      chunkCitations.length > 0 ? Math.max(...chunkCitations.map((c) => c.score * 10)) : 0;

    const shouldApplyEditorialCitationFallback =
      pageType === 'editorial' && citationScore < 0 && chunkCitations.length === 0;

    if (shouldApplyEditorialCitationFallback) {
      const est = estimateEditorialCitationScore({
        pageUrl: url,
        questionCoverageScore,
        questionMatchScore,
        contentLength: contentForAnalysis.length,
        hasActualAiCitation: trustSignals.hasActualAiCitation ?? false,
        structureScore,
        answerabilityScore,
        paragraphScore,
        trustScore,
        maxChunkScore,
        extractionIncomplete,
        paragraphLikeCount: extractionMetricsForFlags.paragraphLikeCount,
        rawBodyTextLength: extractionMetricsForFlags.rawBodyTextLength,
        editorialComparisonScore,
        reviewLikePage,
        geminiSkippedQuota: geminiCitationSkippedQuota,
      });
      citationScore = est.score;
      usedEditorialCitationEstimateFallback = true;
      citationFallbackMeta = est;
    }

    // 인용 점수 하한: 에이스 문단이 전체 인용 점수를 자연스럽게 견인
    if (citationScore >= 0 && maxChunkScore > 0) {
      citationScore = Math.max(citationScore, maxChunkScore * 0.9);
    }
    // 비디오 플랫폼(유튜브): AI가 비디오 콘텐츠를 높게 인용하므로 하한 70점
    if (isYouTube) {
      citationScore = Math.max(citationScore, 70);
    }

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

    // Thin DOM / failed extraction: soften paragraph & answerability collapse using meta signals
    if (extractionIncomplete && pageType === 'editorial' && !isDataPage) {
      const syn = [meta.title, meta.description, meta.ogDescription].filter(Boolean).join('\n');
      if (syn.length > 120) {
        if (paragraphScore < 45) {
          paragraphScore = Math.min(58, 32 + Math.min(24, Math.floor(syn.length / 130)));
        }
        if (answerabilityScore < 45) {
          answerabilityScore = Math.max(
            answerabilityScore,
            Math.min(55, 30 + Math.min(25, Math.floor(headings.length * 2.5)))
          );
        }
      }
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

    const hasCitation = citationScore >= 0;
    const blendCtx: FinalBlendContext = {
      pageType,
      hasCitationPath: hasCitation || citationScore > 0,
      maxChunkScore,
      isFaqLikePage,
      hasActualAiCitation,
      questionMatchScore,
    };
    const blendAlpha = resolveBlendAlpha(config);
    const profileForBlend = profileForScoreBlend(config, pageType);

    const axes7: AxisScores7 = {
      citation: citationScore,
      paragraph: paragraphScore,
      answerability: answerabilityScore,
      structure: effectiveStructureScore,
      trust: trustScore,
      questionMatch: questionMatchScore,
      questionCoverage: questionCoverageScore,
    };
    const fixedW7 = computeEngineFixedWeights7(blendCtx);
    const monthlyW7 = computeMonthlyWeights7(profileForBlend, fixedW7);

    let fixedScore: number;
    let monthlyScore: number;
    if (blendCtx.hasCitationPath) {
      fixedScore = scoreFromWeights7(axes7, fixedW7);
      monthlyScore = scoreFromWeights7(axes7, monthlyW7);
    } else {
      const fixedW5 = computeEngineFixedWeights5(blendCtx);
      const monthlyW5 = computeMonthlyWeights5(profileForBlend, fixedW5);
      const axes5: AxisScores5 = {
        paragraph: paragraphScore,
        answerability: answerabilityScore,
        structure: effectiveStructureScore,
        trust: trustScore,
        questionMatch: questionMatchScore,
      };
      fixedScore = scoreFromWeights5(axes5, fixedW5);
      monthlyScore = scoreFromWeights5(axes5, monthlyW5);
    }

    let finalScore = blendMonthlyAndFixed(monthlyScore, fixedScore, blendAlpha);
    finalScore = Math.min(100, Math.max(0, finalScore));
    const finalScoreBeforeCaps = finalScore;

    if (process.env.GEO_DEBUG === '1') {
      console.log('[GEO_WEIGHTS]', {
        pageType,
        blendAlpha,
        monthlyScore,
        fixedScore,
        citationPath: blendCtx.hasCitationPath,
      });
    }

    // Hard Cap: 80점 이상은 실제 AI 인용 또는 Top Tier 도메인 있어야 진입
    let trustCapBand: 'none' | 'max_79' | 'max_70' = 'none';
    if (trustSignals.hasDomainAuthority || trustSignals.hasActualAiCitation) {
      // 인용 증거 있음 — 상한 없음
    } else if (trustSignals.hasSearchExposure) {
      // 검색 노출만 있음: 79점 상한 (SEO vs AI 인용 구분)
      trustCapBand = 'max_79';
      finalScore = Math.min(finalScore, 79);
    } else {
      // 검색 노출·도메인 권위 둘 다 없음: 70점 상한
      trustCapBand = 'max_70';
      finalScore = Math.min(finalScore, 70);
    }
    const finalScoreAfterCaps = finalScore;

    let commerceMonthlyForDebug: number | undefined;
    let commerceFixedForDebug: number | undefined;
    let commerceBlendedForDebug: number | undefined;

    const scores: GeoScores = {
      structureScore: effectiveStructureScore, answerabilityScore, trustScore,
      paragraphScore, citationScore,
      questionCoverage: questionCoverageScore,
      questionMatchScore,
      finalScore,
      extractionIncomplete,
      extractionSource,
      citationFallbackDebug: citationFallbackMeta
        ? {
            applied: true,
            reason: citationFallbackMeta.reason,
            estimate: citationFallbackMeta.score,
            band: citationFallbackMeta.band,
            compositeQuality: citationFallbackMeta.compositeQuality,
          }
        : { applied: false, reason: null, estimate: null, band: null, compositeQuality: null },
    };

    // Commerce-specific final score override using v26.03 profile (+ monthly/fixed blend)
    try {
      if (pageType === 'commerce') {
        // Quality-aware Data Density → Citation Quality breakdown
        const pc = contentQuality.priceMatchCount ?? 0;
        const rc = contentQuality.repeatedProductCardCount ?? 0;
        const ps = contentQuality.productSpecBlockCount ?? 0;
        const hasPrice = contentQuality.hasPriceInfo ?? false;

        // a) Price Confidence (0-100)
        // - base from count, bonus if has explicit price info
        let priceConfidence = Math.min(100, Math.round(pc * 2)); // each match ~2 points up to 100
        if (hasPrice) priceConfidence = Math.min(100, priceConfidence + 15);
        if (contentQuality.hasOgProductType) priceConfidence = Math.min(100, priceConfidence + 10);

        // b) Repeated Card Consistency (PLP signal) (0-100)
        // strong boost when many product cards exist (>10)
        let cardConsistency = Math.min(100, Math.round(Math.max(0, rc) * 2));
        if (rc >= 10) cardConsistency = Math.min(100, cardConsistency + 15);

        // c) Spec Enrichment Score (0-100)
        // presence of spec blocks + table/list structures increases score
        let specEnrichment = 0;
        if (ps > 0) specEnrichment += Math.min(60, ps * 25);
        specEnrichment += Math.min(40, contentQuality.tableCount * 15 + contentQuality.listCount * 5);
        specEnrichment = Math.min(100, Math.round(specEnrichment));

        // Weighted aggregation into dataDensityQuality (citation-quality)
        const dataDensityQuality = Math.round(
          priceConfidence * 0.4 + cardConsistency * 0.35 + specEnrichment * 0.25
        );

        // commerce trust boost from schema/og
        let commerceTrust = trustScore;
        if (hasProductSchema) commerceTrust = Math.min(100, commerceTrust + 25);
        if (contentQuality.hasOgProductType) commerceTrust = Math.min(100, commerceTrust + 10);
        if (contentQuality.hasPriceInfo) commerceTrust = Math.min(100, commerceTrust + 5);

        const commerceProfile = getProfileForPageType(config, 'commerce');
        const commerceFixed = computeCommerceFixedFinal(
          dataDensityQuality,
          effectiveStructureScore,
          commerceTrust
        );
        const commerceMonthly = computeCommerceMonthlyFinal(
          dataDensityQuality,
          effectiveStructureScore,
          commerceTrust,
          commerceProfile
        );
        const commerceBlended = blendMonthlyAndFixed(commerceMonthly, commerceFixed, blendAlpha);
        commerceFixedForDebug = commerceFixed;
        commerceMonthlyForDebug = commerceMonthly;
        commerceBlendedForDebug = commerceBlended;
        scores.finalScore = Math.min(100, Math.max(0, commerceBlended));
        // expose breakdown for explainability/UI
        (scores as any).dataDensityScore = dataDensityQuality;
        (scores as any).dataDensityBreakdown = {
          priceConfidence,
          cardConsistency,
          specEnrichment,
        };
      }
    } catch (e) {
      // noop
    }

    scores.scoreBlendDebug = buildBlendDebug({
      blendAlpha,
      monthlyScore,
      fixedScore,
      finalScoreBeforeCaps,
      finalScoreAfterCaps,
      finalScore: scores.finalScore,
      trustCapBand,
      commerceMonthlyScore: commerceMonthlyForDebug,
      commerceFixedScore: commerceFixedForDebug,
      commerceBlendedScore: commerceBlendedForDebug,
    });

    if (shouldLogGeoScoreAxis(url)) {
      console.log(
        '[GEO_SCORE_DEBUG]',
        JSON.stringify({
          monthlyScore,
          fixedScore,
          blendAlpha,
          monthlyContribution: scores.scoreBlendDebug?.monthlyContribution,
          fixedContribution: scores.scoreBlendDebug?.fixedContribution,
          finalScoreBeforeCaps,
          finalScoreAfterCaps,
          finalScore: scores.finalScore,
          trustCapBand,
          commerceMonthlyScore: commerceMonthlyForDebug,
          commerceFixedScore: commerceFixedForDebug,
          commerceBlendedScore: commerceBlendedForDebug,
        })
      );
    }

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
        finalScore: scores.finalScore,
      });
    }

    // pageType already determined earlier for scoring purposes

    const editorialSubtypePayload =
      pageType === 'editorial'
        ? detectEditorialSubtype({
            url,
            meta: meta as AnalysisMeta,
            headings,
            trustSignals,
            jsonLdTypesFound: contentQuality.jsonLdProductTypesFound ?? [],
          })
        : null;

    const coreResult: AnalysisResult = {
      url,
      normalizedUrl: normalizeUrl(url),
      analyzedAt: new Date().toISOString(),
      pageType,
      ...(editorialSubtypePayload
        ? {
            editorialSubtype: editorialSubtypePayload.editorialSubtype,
            editorialSubtypeDebug: editorialSubtypePayload.editorialSubtypeDebug,
          }
        : {}),
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
      extractionIncomplete,
      extractionSource,
    };
    // Lightweight review-like detection (only used for recommendations wording/UI).
    try {
      const reviewMarkers = ['review','리뷰','후기','비교','장단점','pros','cons','verdict','best','사용기','추천'];
      const textToCheck = [
        meta.title ?? '',
        meta.ogTitle ?? '',
        (headings ?? []).slice(0,5).join(' '),
        seedKeywords.map(s => s.value).slice(0,5).join(' '),
      ].join(' ').toLowerCase();
      const hasMarker = reviewMarkers.some(m => textToCheck.includes(m));
      const hasListOrTable = (contentQuality.listCount ?? 0) > 0 || (contentQuality.tableCount ?? 0) > 0;
      (coreResult as any).reviewLike = hasMarker || hasListOrTable;
    } catch (e) {
      // safe no-op
    }

    coreResult.axisScores = buildAxisScores(coreResult);
    const auditWeb = await deriveAuditIssues(coreResult);
    const {
      issues,
      passedChecks,
      geoIssues,
      geoPassedItems,
      opportunities,
    } = auditWeb;
    const geoExplainWeb = {
      axisScores: coreResult.axisScores,
      issues: geoIssues,
      passed: geoPassedItems,
      opportunities,
    };
    logGeoExplainDebug(url, coreResult.pageType, geoExplainWeb, {
      editorialSubtype: coreResult.editorialSubtype,
      editorialSubtypeDebug: coreResult.editorialSubtypeDebug,
    });

    const uncoveredQuestions = findUncoveredQuestions(
      pageQuestions,
      searchQuestions,
      effectiveContentText
    );
    const recResult = await generateGeoRecommendations(uncoveredQuestions, issues, {
      searchQuestions,
      pageQuestions,
      pageType,
      editorialSubtype: coreResult.editorialSubtype,
      geoOpportunities: opportunities,
      geoIssues,
      axisScores: coreResult.axisScores,
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
        editorialSubtype: coreResult.editorialSubtype,
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
        editorialSubtype: coreResult.editorialSubtype,
      });
    }

    // If editorial and review-like, gently augment recommendations with review-specific templates
    try {
      if (pageType === 'editorial' && (coreResult as any).reviewLike && recommendations) {
        recommendations.actionPlan = recommendations.actionPlan || { suggestedHeadings: [], suggestedBlocks: [] , priorityNotes: [] };
        const curHeads = recommendations.actionPlan.suggestedHeadings ?? [];
        const curBlocks = recommendations.actionPlan.suggestedBlocks ?? [];
        const curNotes = recommendations.actionPlan.priorityNotes ?? [];

        const reviewHeads = ['Pros / Cons', 'Verdict (Short Summary)', 'Comparison criteria'];
        const reviewBlocks = [
          'Pros/Cons block example:\n- Pros: \n- Cons: \n- Recommended for: (who should buy/use this)',
          'Verdict example:\nOne-line verdict (recommendation) + 1-sentence rationale.',
          'Comparison criteria example:\n- Performance (W)\n- Weight (g)\n- Battery life (min)\n- Price (KRW)\n- Portability (foldable/compact)'
        ];
        const reviewNote = '리뷰형 권장: Pros/Cons · 간단한 Verdict · 비교 기준을 명확히 기재하세요.';

        recommendations.actionPlan.suggestedHeadings = Array.from(new Set([...curHeads, ...reviewHeads]));
        recommendations.actionPlan.suggestedBlocks = Array.from(new Set([...curBlocks, ...reviewBlocks]));
        recommendations.actionPlan.priorityNotes = Array.from(new Set([...(recommendations.actionPlan.priorityNotes ?? []), reviewNote]));
      }
    } catch (e) {
      // noop
    }

    if (shouldLogGeoScoreAxis(url)) {
      const recLlm = llmStatuses.find((s) => s.feature === 'recommendations');
      const citLlm = llmStatuses.find((s) => s.feature === 'citations');
      console.log(
        '[GEO_SCORE_AXIS]',
        JSON.stringify(
          {
            url,
            pageType,
            finalScore: scores.finalScore,
            finalScoreBeforeCaps,
            trustCapBand,
            commerceOverride: pageType === 'commerce',
            axis: {
              citationScore: scores.citationScore,
              paragraphScore: scores.paragraphScore,
              answerabilityScore: scores.answerabilityScore,
              structureScore: scores.structureScore,
              trustScore: scores.trustScore,
              questionCoverage: scores.questionCoverage,
              questionMatch: scores.questionMatchScore,
            },
            maxChunkScore,
            paragraphChunkCount: paragraphStats.totalParagraphs,
            citationExtractedChunkCount: chunks.length,
            extractedTextLength: contentText.length,
            contentForAnalysisLength: contentForAnalysis.length,
            trustSignals: {
              hasDomainAuthority: trustSignals.hasDomainAuthority,
              hasSearchExposure: trustSignals.hasSearchExposure,
              hasActualAiCitation: trustSignals.hasActualAiCitation,
            },
            citationScoringDegraded: {
              filterQuestions: filterQuestionsMeta,
              actualAiCitationCheck: actualAiCitationMeta,
              geminiCitationsSkippedQuota: !!citationResult.skippedQuota,
              geminiCitationsRetryAfterSec: citationResult.skippedQuota?.retryAfterSec,
              usedEditorialCitationEstimateFallback,
              chunkCitationsReturned: chunkCitations.length,
              citationsLlmStatus: citLlm?.status,
            },
            recommendationsLlm: {
              status: recLlm?.status,
              skippedQuota: recLlm?.status === 'skipped_quota',
              retryAfterSec: recLlm?.retryAfterSec,
            },
            blending: {
              hasCitationAxis: hasCitation,
              usedWeightedBlendWithCitation: hasCitation || citationScore > 0,
            },
            extraction: {
              incomplete: extractionIncomplete,
              source: extractionSource,
              metrics: extractionMetricsForFlags,
            },
            citationFallback: citationFallbackMeta
              ? {
                  citationFallbackApplied: true,
                  citationFallbackReason: citationFallbackMeta.reason,
                  citationFallbackEstimate: citationFallbackMeta.score,
                  citationFallbackBand: citationFallbackMeta.band,
                  citationFallbackComposite: citationFallbackMeta.compositeQuality,
                  citationFallbackBounds: {
                    min: citationFallbackMeta.minBound,
                    max: citationFallbackMeta.maxBound,
                  },
                  citationFallbackInputs: {
                    quotaOrCooldown: geminiCitationSkippedQuota,
                    extractionDriven: extractionIncomplete,
                    noChunks: chunkCitations.length === 0,
                    paragraphLikeCount: extractionMetricsForFlags.paragraphLikeCount,
                    rawBodyTextLength: extractionMetricsForFlags.rawBodyTextLength,
                    editorialComparisonScore,
                    reviewLikePage,
                    structureScore,
                    answerabilityScore,
                    paragraphScore,
                    trustScore,
                    maxChunkScore,
                  },
                }
              : {
                  citationFallbackApplied: usedEditorialCitationEstimateFallback,
                  citationFallbackReason: null,
                  citationFallbackEstimate: null,
                },
          },
          null,
          2
        )
      );
    }

    return {
      ...coreResult,
      auditIssues: issues,
      passedChecks,
      recommendations,
      geoExplain: geoExplainWeb,
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
  features: PageFeatures,
  rules: ScoringRule[],
  baseScore: number,
  pageType?: PageType
): { score: number; maxScore: number } {
  let score = baseScore;
  let maxScore = baseScore;

  // Editorial-heavy rule IDs that are not applicable to commerce pages (treated as N/A)
  const editorialRulesToSkipOnCommerce = new Set([
    'content_short',
    'first_para',
    'quotable',
    'content_len',
    'content_deep',
    'questions',
  ]);

  for (const rule of rules) {
    // If commerce page and this rule is editorial-focused, exclude it from applicability
    const isEditorialOnly = editorialRulesToSkipOnCommerce.has(rule.id);
    if (pageType === 'commerce' && isEditorialOnly) {
      // skip adding to maxScore => rule not applicable
      continue;
    }
    maxScore += rule.points;
    if (evaluateCheck(rule.check, features, rule.threshold)) {
      score += rule.points;
    }
  }

  // clamp score between 0 and maxScore
  score = Math.max(0, Math.min(score, maxScore));
  return { score, maxScore };
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