import { fetchHtml, extractMetaAndContent } from './htmlAnalyzer';
import { fetchHtmlWithNaverFallback, type HtmlFetchTransport } from './fetchHtmlForAnalysis';
import { normalizeUrl, sanitizeIncomingAnalyzeUrl } from './normalizeUrl';
import { runGeminiVideoAnalysis, buildYouTubeAnalysisResult, VideoAnalysisQuotaSkipError, type GeminiVideoAnalysisResult } from './geminiVideoAnalysis';
import {
  estimateVideoCitationScore,
  estimateEditorialCitationScore,
  type EditorialCitationFallbackResult,
} from './videoScoreFallback';
import { extractSeedKeywords } from './keywordExtractor';
import {
  fetchSearchQuestions,
  derivePrimaryTopic,
  deriveQuestionSourceStatus,
  logQuestionSourceStatus,
} from './searchQuestions';
import { buildCanonicalSearchQuestions } from './canonicalSearchQuestions';
import { buildCoverageMatchInput, buildCoverageMatchInputPlain } from './coverageSurfaces';
import type { FilterQuestionsRunMeta } from './questionFilter';
import {
  getProfileForPageType,
  loadActiveScoringConfig,
  logGuideConfigBoundary,
} from './scoringConfigLoader';
import { evaluateCheck } from './checkEvaluator';
import { analyzeParagraphs, computeBlogRelaxedParagraphScore, paragraphStatsToScore } from './paragraphAnalyzer';
import { extractChunks, evaluateCitations, citationsToScore } from './citationEvaluator';
import { deriveAuditIssues } from './issueDetector';
import { buildAxisScores, logGeoExplainDebug } from './geoExplain';
import { generateGeoRecommendations } from './recommendationEngine';
import { DEFAULT_SCORING_CONFIG } from './defaultScoringConfig';
import { detectEditorialSubtype } from './editorialSubtype';
import { hasDomainAuthority } from './domainAuthority';
import { checkActualAiCitation, hasActualAiCitationDomain, type CheckActualAiCitationMeta } from './actualAiCitation';
import { fetchYouTubeMetadata, fetchYouTubeOEmbed, isYouTubeUrl, youtubeMetadataToAnalysisMeta } from './youtubeMetadataExtractor';
import {
  computeQuestionMatchScore,
  computeSearchQuestionCoverage,
  computeSearchQuestionCoverageDetails,
  softenQuestionMatchForEditorialBlog,
} from './questionCoverage';
import { logQuestionCoverageTrace, shouldLogQuestionCoverageTrace } from './questionCoverageTrace';
import { logQuestionCoverageStagesDebug, logQuestionPipelineStage } from './questionPipelineTrace';
import {
  applySearchQuestionsFallbackIfEmpty,
  whenDisplayEmptyUseCanonical,
} from './questionCoverageFallback';
import { applyQuestionDisplaySelection } from './questionDisplaySelection';
import type {
  AnalysisResult,
  AnalysisMeta,
  ChunkCitation,
  GeoScoreBlendDebug,
  GeoScores,
  PageFeatures,
  SearchQuestion,
  ScoringRule,
  PageType,
  LlmCallStatus,
  AnswerabilityDebug,
} from './analysisTypes';
import { buildAnswerabilityDebug } from './answerabilityDebug';
import {
  DEFAULT_EDITORIAL_ANSWERABILITY_RULES,
  usesDataHeavyAnswerability,
} from './editorialBlogAnswerability';
import {
  countEditorialBlogRelaxedQualityBuckets,
  countEditorialStrongAnswerSignals,
  EDITORIAL_ANSWERABILITY_QUALITY_CAP_PERCENT,
  shouldCapEditorialBlogRelaxedGate,
  shouldCapEditorialAnswerabilityForWeakQuality,
} from './editorialAnswerabilityQualityGate';
import {
  blendMonthlyAndFixed,
  buildBlendDebug,
  computeCommerceFixedFinal,
  computeCommerceMonthlyFinal,
  computeEngineFixedWeights5,
  computeEngineFixedWeights7,
  computeMonthlyWeights5,
  computeMonthlyWeights7,
  normalizeAxisWeights5,
  normalizeAxisWeights7,
  profileForScoreBlend,
  resolveBlendAlpha,
  scoreFromWeights5,
  scoreFromWeights7,
  type AxisScores5,
  type AxisScores7,
  type FinalBlendContext,
} from './geoScoreBlend';
import { detectPageType, computeEditorialComparisonScore } from './pageTypeDetection';
import { classifyDataPageAndHosting } from './dataPageClassification';
import {
  computeExtractionMetrics,
  shouldAttemptHeadlessFetch,
  headlessImprovesExtraction,
} from './articleExtraction';
import { fetchHtmlViaHeadless } from './headlessHtmlFetch';
import { runWithGeminiTrace } from './geminiTraceContext';
import { computeQualityAdjustment } from './qualityAdjuster';
import { applyIssueBasedFinalScorePenalty } from './issueFinalScorePenalty';

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

/** YouTube Tavily path: set VIDEO_TAVILY_TRACE=1 or TAVILY_EXECUTION_DEBUG=1 */
function logVideoTavilyCheckpoint(payload: Record<string, unknown>): void {
  if (process.env.VIDEO_TAVILY_TRACE !== '1' && process.env.TAVILY_EXECUTION_DEBUG !== '1') return;
  console.log(
    '[VIDEO_TAVILY]',
    JSON.stringify({ ts: new Date().toISOString(), ...payload })
  );
}

export interface RunAnalysisOptions {
  appOrigin?: string;
  /** When true, bypass question-research cache read (align with /api/analyze forceRefresh). */
  forceRefresh?: boolean;
}

export async function runAnalysis(url: string, options?: RunAnalysisOptions): Promise<AnalysisResult> {
  const cleaned = sanitizeIncomingAnalyzeUrl(url);
  const normalizedUrl = normalizeUrl(cleaned);
  const inputUrlRaw = typeof cleaned === 'string' ? cleaned : String(cleaned ?? '');
  const inputUrl = inputUrlRaw.trim() || normalizedUrl;
  return runWithGeminiTrace({ normalizedUrl }, () =>
    runAnalysisImpl({ inputUrl, normalizedUrl }, options)
  );
}

async function runAnalysisImpl(
  ctx: { inputUrl: string; normalizedUrl: string },
  options?: RunAnalysisOptions
): Promise<AnalysisResult> {
  const { inputUrl, normalizedUrl } = ctx;
  /** Canonical URL for scoring, result fields, cache keys (Naver → m.blog). Fetch may use a fallback target. */
  const url = normalizedUrl;
  try {
    const appOrigin = options?.appOrigin ?? process.env.GEO_ANALYZER_BASE_URL;
    const llmStatuses: LlmCallStatus[] = [];
    const activeScoringConfig = await loadActiveScoringConfig();
    const geoConfigVersion = activeScoringConfig.version ?? null;

    // 유튜브 전용: ytInitialData/og → 필요 시 oEmbed fallback → effectiveContentText로 questionCoverage/answerability 0 방지
    if (isYouTubeUrl(url)) {
      const VIDEO_DESC_PLACEHOLDER = 'No description available.';
      let meta: AnalysisMeta;
      const ytMeta = await fetchYouTubeMetadata(url);
      if (ytMeta?.title || ytMeta?.description) {
        meta = youtubeMetadataToAnalysisMeta(ytMeta);
      } else {
        const { html } = await fetchHtml(url, appOrigin);
        const extracted = extractMetaAndContent(html, { pageUrl: normalizedUrl });
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
      logVideoTavilyCheckpoint({
        phase: 'youtube_branch_gemini_outcome',
        normalizedUrl,
        geminiResultPresent: !!geminiResult,
        nextPath: geminiResult ? 'fetchSearchQuestions_with_gemini_enhanced_content' : 'fetchSearchQuestions_gemini_null_fallback',
      });

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

        logVideoTavilyCheckpoint({
          phase: 'before_fetchSearchQuestions',
          branch: 'gemini_ok',
          normalizedUrl,
          seedKeywordsCount: seedKeywords.length,
          forceRefresh: options?.forceRefresh === true,
          skipQuestionResearchCache: options?.forceRefresh === true,
        });

        const videoFetchPack = await fetchSearchQuestions(seedKeywords, {
          pageType: 'video',
          meta: { title: meta.title, ogTitle: meta.ogTitle },
          url,
          skipQuestionResearchCache: options?.forceRefresh === true,
        });
        const tavilyMetaVideo = videoFetchPack.tavilyMeta;
        const rawSearchQuestions = videoFetchPack.questions;

        logVideoTavilyCheckpoint({
          phase: 'after_fetchSearchQuestions',
          branch: 'gemini_ok',
          normalizedUrl,
          returnedSearchQuestionCount: rawSearchQuestions.length,
        });
        const topic = derivePrimaryTopic({ title: meta.title, ogTitle: meta.ogTitle }, url, seedKeywords, 'video');
        const searchEvidence = rawSearchQuestions;

        const videoCountAfterFetch = rawSearchQuestions.length;
        let searchQuestions = buildCanonicalSearchQuestions({
          evidence: searchEvidence,
          seedKeywords,
          meta: { title: meta.title, ogTitle: meta.ogTitle },
          topic,
          pageType: 'video',
        });
        const videoCountAfterPage = searchEvidence.length;
        const videoCanonicalCountBeforeFallback = searchQuestions.length;
        const videoFbApplied = applySearchQuestionsFallbackIfEmpty(searchQuestions, {
          normalizedUrl,
          pageType: 'video',
          primaryPhrase: topic.primaryPhrase,
          essentialTokens: topic.essentialTokens,
          seedKeywords,
          isEnglishPage: topic.isEnglishPage,
          debugCounts: {
            afterFetchTopicQuality: videoCountAfterFetch,
            afterPageRelevanceFilter: videoCountAfterPage,
            afterCanonicalBeforeFallback: videoCanonicalCountBeforeFallback,
          },
        });
        searchQuestions = videoFbApplied.searchQuestions;
        const questionSourceStatusVideo = deriveQuestionSourceStatus(
          tavilyMetaVideo,
          videoFbApplied.fallbackUsed
        );
        logQuestionSourceStatus({
          normalizedUrl,
          questionSourceStatus: questionSourceStatusVideo,
          tavilyMeta: tavilyMetaVideo,
          fallbackUsed: videoFbApplied.fallbackUsed,
        });

        const pageQuestions = meta.title ? [meta.title] : [];
        const videoCoverageInput = buildCoverageMatchInputPlain({
          meta,
          contentText: enhancedContentText,
          pageQuestions,
          topicTokens: topic.essentialTokens,
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
          coverageMatchInput: videoCoverageInput,
          originalInputUrl: inputUrl,
        });

        coreResult.axisScores = buildAxisScores(coreResult);
        const auditVideo = await deriveAuditIssues(coreResult);
        const { issues, passedChecks, geoIssues, geoPassedItems, opportunities, platformConstraints } =
          auditVideo;
        applyIssueBasedFinalScorePenalty(coreResult.scores, geoIssues);
        const geoExplainVideo = {
          axisScores: coreResult.axisScores,
          issues: geoIssues,
          passed: geoPassedItems,
          opportunities,
        };
        logGeoExplainDebug(url, coreResult.pageType, geoExplainVideo);

        const videoQuestionRules = getProfileForPageType(activeScoringConfig, 'video')?.questionRules;
        const fullVideoQs = coreResult.searchQuestions ?? [];
        let videoCov = coreResult.searchQuestionCovered ?? [];
        if (videoCov.length !== fullVideoQs.length) {
          videoCov =
            fullVideoQs.length > 0
              ? computeSearchQuestionCoverage(fullVideoQs, videoCoverageInput)
              : [];
        }
        let videoDisplayApplied = applyQuestionDisplaySelection({
          searchQuestions: fullVideoQs,
          searchQuestionCovered: videoCov,
          questionRules: videoQuestionRules,
        });
        videoDisplayApplied = whenDisplayEmptyUseCanonical(videoDisplayApplied, fullVideoQs, videoCov);
        coreResult.canonicalSearchQuestions = [...fullVideoQs];
        coreResult.searchQuestions = videoDisplayApplied.searchQuestions;
        coreResult.searchQuestionCovered = videoDisplayApplied.searchQuestionCovered;
        if (videoDisplayApplied.debug) {
          coreResult.questionCoverageDebug = videoDisplayApplied.debug;
        }
        const uncoveredQuestions = videoDisplayApplied.uncoveredOrderedForRecommendations;

        logGuideConfigBoundary('runAnalysis before generateGeoRecommendations', 'video', activeScoringConfig);
        const recommendations = await generateGeoRecommendations(uncoveredQuestions, issues, {
          searchQuestions: videoDisplayApplied.searchQuestions,
          pageQuestions: coreResult.pageQuestions,
          pageType: 'video',
          geoOpportunities: opportunities,
          geoIssues,
          geoPassedIds: geoPassedItems.map((p) => p.id),
          axisScores: coreResult.axisScores,
          meta: {
            title: meta.title,
            description: meta.description,
            ogTitle: meta.ogTitle,
            ogDescription: meta.ogDescription,
          },
          textSample: enhancedContentText.slice(0, 4000),
          contentQuality: coreResult.contentQuality,
          limitedAnalysis: coreResult.limitedAnalysis,
          seedKeywords: coreResult.seedKeywords,
          questionRules: videoQuestionRules,
          activeScoringConfig,
        });
    
        return {
          ...coreResult,
          geoConfigVersion,
          searchEvidence,
          questionSourceStatus: questionSourceStatusVideo,
          canonicalSearchQuestions: coreResult.canonicalSearchQuestions ?? fullVideoQs,
          recommendations,
          passedChecks,
          platformConstraints,
          geoExplain: geoExplainVideo,
          llmStatuses: llmStatuses.length > 0 ? llmStatuses : undefined,
        };
      }

      // geminiResult == null: 규칙 기반 fallback citation으로 video 결과 생성
      const seedKeywords = extractSeedKeywords(meta, [], effectiveContent);

      logVideoTavilyCheckpoint({
        phase: 'before_fetchSearchQuestions',
        branch: 'gemini_null_fallback',
        normalizedUrl,
        seedKeywordsCount: seedKeywords.length,
        forceRefresh: options?.forceRefresh === true,
        skipQuestionResearchCache: options?.forceRefresh === true,
      });

      const videoFetchPackFb = await fetchSearchQuestions(seedKeywords, {
        pageType: 'video',
        meta: { title: meta.title, ogTitle: meta.ogTitle },
        url,
        skipQuestionResearchCache: options?.forceRefresh === true,
      });
      const tavilyMetaVideoFb = videoFetchPackFb.tavilyMeta;
      const rawSearchQuestions = videoFetchPackFb.questions;

      logVideoTavilyCheckpoint({
        phase: 'after_fetchSearchQuestions',
        branch: 'gemini_null_fallback',
        normalizedUrl,
        returnedSearchQuestionCount: rawSearchQuestions.length,
      });
      const topicFb = derivePrimaryTopic({ title: meta.title, ogTitle: meta.ogTitle }, url, seedKeywords, 'video');
      const searchEvidence = rawSearchQuestions;
      const videoFbCountAfterFetch = rawSearchQuestions.length;
      let searchQuestions = buildCanonicalSearchQuestions({
        evidence: searchEvidence,
        seedKeywords,
        meta: { title: meta.title, ogTitle: meta.ogTitle },
        topic: topicFb,
        pageType: 'video',
      });
      const videoFbCountAfterPage = searchEvidence.length;
      const videoFbCanonicalCountBeforeFallback = searchQuestions.length;
      const videoFbAppliedNull = applySearchQuestionsFallbackIfEmpty(searchQuestions, {
        normalizedUrl,
        pageType: 'video',
        primaryPhrase: topicFb.primaryPhrase,
        essentialTokens: topicFb.essentialTokens,
        seedKeywords,
        isEnglishPage: topicFb.isEnglishPage,
        debugCounts: {
          afterFetchTopicQuality: videoFbCountAfterFetch,
          afterPageRelevanceFilter: videoFbCountAfterPage,
          afterCanonicalBeforeFallback: videoFbCanonicalCountBeforeFallback,
        },
      });
      searchQuestions = videoFbAppliedNull.searchQuestions;
      const questionSourceStatusVideoFb = deriveQuestionSourceStatus(
        tavilyMetaVideoFb,
        videoFbAppliedNull.fallbackUsed
      );
      logQuestionSourceStatus({
        normalizedUrl,
        questionSourceStatus: questionSourceStatusVideoFb,
        tavilyMeta: tavilyMetaVideoFb,
        fallbackUsed: videoFbAppliedNull.fallbackUsed,
      });
      const pageQuestions = meta.title ? [meta.title] : [];
      const videoCoverageInputFb = buildCoverageMatchInputPlain({
        meta,
        contentText: effectiveContent,
        pageQuestions,
        topicTokens: topicFb.essentialTokens,
      });
      const searchQuestionCovered = computeSearchQuestionCoverage(searchQuestions, videoCoverageInputFb);
      const questionCoverageScore = searchQuestions.length > 0
        ? Math.round((searchQuestionCovered.filter(Boolean).length / searchQuestions.length) * 100)
        : 0;
      const questionMatchScore = computeQuestionMatchScore(searchQuestions, effectiveContent, {
        topicTokens: topicFb.essentialTokens,
      });
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
        coverageMatchInput: videoCoverageInputFb,
        fallbackCitationScore,
        originalInputUrl: inputUrl,
      });
      coreResult.axisScores = buildAxisScores(coreResult);
      const auditVideoFb = await deriveAuditIssues(coreResult);
      const {
        issues,
        passedChecks,
        geoIssues: geoIssuesFb,
        geoPassedItems: geoPassedFb,
        opportunities: oppsFb,
        platformConstraints: platformConstraintsFb,
      } = auditVideoFb;
      applyIssueBasedFinalScorePenalty(coreResult.scores, geoIssuesFb);
      const geoExplainVideoFb = {
        axisScores: coreResult.axisScores,
        issues: geoIssuesFb,
        passed: geoPassedFb,
        opportunities: oppsFb,
      };
      logGeoExplainDebug(url, coreResult.pageType, geoExplainVideoFb);
      const videoQuestionRulesFb = getProfileForPageType(activeScoringConfig, 'video')?.questionRules;
      const fullVideoQsFb = coreResult.searchQuestions ?? [];
      let videoCovFb = coreResult.searchQuestionCovered ?? [];
      if (videoCovFb.length !== fullVideoQsFb.length) {
        videoCovFb =
          fullVideoQsFb.length > 0
            ? computeSearchQuestionCoverage(fullVideoQsFb, videoCoverageInputFb)
            : [];
      }
      let videoDisplayFb = applyQuestionDisplaySelection({
        searchQuestions: fullVideoQsFb,
        searchQuestionCovered: videoCovFb,
        questionRules: videoQuestionRulesFb,
      });
      videoDisplayFb = whenDisplayEmptyUseCanonical(videoDisplayFb, fullVideoQsFb, videoCovFb);
      coreResult.canonicalSearchQuestions = [...fullVideoQsFb];
      coreResult.searchQuestions = videoDisplayFb.searchQuestions;
      coreResult.searchQuestionCovered = videoDisplayFb.searchQuestionCovered;
      if (videoDisplayFb.debug) {
        coreResult.questionCoverageDebug = videoDisplayFb.debug;
      }
      const uncoveredQuestions = videoDisplayFb.uncoveredOrderedForRecommendations;
      logGuideConfigBoundary('runAnalysis before generateGeoRecommendations', 'video', activeScoringConfig);
      const recommendations = await generateGeoRecommendations(uncoveredQuestions, issues, {
        searchQuestions: videoDisplayFb.searchQuestions,
        pageQuestions: coreResult.pageQuestions,
        pageType: 'video',
        geoOpportunities: oppsFb,
        geoIssues: geoIssuesFb,
        geoPassedIds: geoPassedFb.map((p) => p.id),
        axisScores: coreResult.axisScores,
        meta: {
          title: meta.title,
          description: meta.description,
          ogTitle: meta.ogTitle,
          ogDescription: meta.ogDescription,
        },
        textSample: effectiveContent.slice(0, 4000),
        contentQuality: coreResult.contentQuality,
        limitedAnalysis: coreResult.limitedAnalysis,
        seedKeywords: coreResult.seedKeywords,
        questionRules: videoQuestionRulesFb,
        activeScoringConfig,
      });
      return {
        ...coreResult,
        geoConfigVersion,
        searchEvidence,
        questionSourceStatus: questionSourceStatusVideoFb,
        canonicalSearchQuestions: coreResult.canonicalSearchQuestions ?? fullVideoQsFb,
        recommendations,
        passedChecks,
        platformConstraints: platformConstraintsFb,
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

    let html: string;
    let serverFetchTargetUrl: string;
    let serverFinalFetchedUrl: string;
    let naverFetchUsedPcFallback = false;
    let naverMobileFetchUsedHeadless = false;
    let nonNaverFetchTransport: HtmlFetchTransport | undefined;
    let extractionSource: 'server' | 'headless' = 'server';
    {
      const fetched = await fetchHtmlWithNaverFallback(inputUrl, normalizedUrl, appOrigin);
      html = fetched.html;
      serverFetchTargetUrl = fetched.usedFetchUrl;
      serverFinalFetchedUrl = fetched.finalFetchedUrl;
      naverFetchUsedPcFallback = fetched.naverUsedPcFallback;
      naverMobileFetchUsedHeadless = fetched.naverMobileUsedHeadless;
      nonNaverFetchTransport = fetched.fetchTransport;
    }
    const displayOpenUrl = serverFinalFetchedUrl ?? serverFetchTargetUrl ?? inputUrl;
    const analysisFetchWarning: string | null = naverFetchUsedPcFallback
      ? '모바일(m.blog)에서 본문을 가져오지 못해 PC/PostView URL로 분석했습니다. m.blog URL로 직접 열 때와 점수·지표가 달라질 수 있습니다.'
      : null;
    const preMetrics = computeExtractionMetrics(html);
    const skipDuplicateNaverHeadless =
      naverMobileFetchUsedHeadless && /(^|\.)m\.blog\.naver\.com$/i.test(analysisHostFromUrl);
    const skipDuplicateRobustHeadless = nonNaverFetchTransport === 'headless';
    if (
      !skipDuplicateNaverHeadless &&
      !skipDuplicateRobustHeadless &&
      shouldAttemptHeadlessFetch(analysisHostFromUrl, preMetrics)
    ) {
      try {
        const htmlH = await fetchHtmlViaHeadless(serverFetchTargetUrl);
        const postMetrics = computeExtractionMetrics(htmlH);
        if (headlessImprovesExtraction(preMetrics, postMetrics)) {
          html = htmlH;
          extractionSource = 'headless';
        }
        if (process.env.GEO_EXTRACTION_DEBUG === '1') {
          console.log('[GEO_EXTRACTION]', {
            normalized_url: normalizedUrl,
            fetch_target_url: serverFetchTargetUrl,
            final_fetched_url: serverFinalFetchedUrl,
            display_open_url: displayOpenUrl,
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

    const extracted = extractMetaAndContent(html, { pageUrl: normalizedUrl });
    const config = activeScoringConfig;
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
    const { isDataPage, platform } = classifyDataPageAndHosting({
      url,
      normalizedUrl,
      pageType,
      contentQuality,
      hasProductSchemaBroad: hasProductSchema,
    });
    const isYouTube = isYouTubeUrl(url);
    const contentForAnalysis = isYouTube
      ? [meta.title, meta.description].filter(Boolean).join(' ')
      : contentText;

    const seedKeywords = extractSeedKeywords(
      meta as AnalysisMeta,
      headings,
      contentForAnalysis
    );

    const primaryTopicForCanonical = derivePrimaryTopic(
      { title: meta.title, ogTitle: meta.ogTitle },
      url,
      seedKeywords,
      pageType
    );

    const editorialQuestionFetch = await fetchSearchQuestions(seedKeywords, {
      meta: { title: meta.title, ogTitle: meta.ogTitle },
      url,
      skipQuestionResearchCache: options?.forceRefresh === true,
    });
    const tavilyMetaEditorial = editorialQuestionFetch.tavilyMeta;
    const searchEvidence = editorialQuestionFetch.questions;
    const questionTextsAfterFetchTopicQuality = searchEvidence.map((q) => q.text);
    const sourceQuestionCount = searchEvidence.length;
    const filterQuestionsMeta: FilterQuestionsRunMeta = { status: 'bypass_coverage_preserve_tavily' };
    const questionTextsAfterPageRelevance = searchEvidence.map((q) => q.text);
    const filteredOutQuestionExamples: string[] = [];
    if (shouldLogQuestionCoverageTrace()) {
      logQuestionCoverageTrace('after_fetch_and_relevance_filter', {
        normalizedUrl,
        pageType,
        sourceQuestionCount,
        filteredQuestionCount: searchEvidence.length,
        filterMetaStatus: filterQuestionsMeta.status,
        filteredOutQuestionExamples,
      });
    }
    logQuestionPipelineStage('4_after_filterQuestionsByPageRelevance', searchEvidence, {
      normalizedUrl,
      pageType,
      filterMetaStatus: filterQuestionsMeta.status,
      note: 'Bypassed: page relevance LLM/heuristic disabled; Tavily lines preserved from fetchSearchQuestions.',
    });
    let searchQuestions = buildCanonicalSearchQuestions({
      evidence: searchEvidence,
      seedKeywords,
      meta: { title: meta.title, ogTitle: meta.ogTitle },
      topic: primaryTopicForCanonical,
      pageType,
    });
    const editorialCanonicalCountBeforeFallback = searchQuestions.length;
    const editorialFbPack = applySearchQuestionsFallbackIfEmpty(searchQuestions, {
      normalizedUrl,
      pageType,
      primaryPhrase: primaryTopicForCanonical.primaryPhrase,
      essentialTokens: primaryTopicForCanonical.essentialTokens,
      seedKeywords,
      isEnglishPage: primaryTopicForCanonical.isEnglishPage,
      debugCounts: {
        afterFetchTopicQuality: questionTextsAfterFetchTopicQuality.length,
        afterPageRelevanceFilter: questionTextsAfterPageRelevance.length,
        afterCanonicalBeforeFallback: editorialCanonicalCountBeforeFallback,
      },
    });
    searchQuestions = editorialFbPack.searchQuestions;
    const questionSourceStatus = deriveQuestionSourceStatus(
      tavilyMetaEditorial,
      editorialFbPack.fallbackUsed
    );
    logQuestionSourceStatus({
      normalizedUrl,
      questionSourceStatus,
      tavilyMeta: tavilyMetaEditorial,
      fallbackUsed: editorialFbPack.fallbackUsed,
    });
    logQuestionPipelineStage('5_after_buildCanonicalSearchQuestions', searchQuestions, {
      normalizedUrl,
      pageType,
      note:
        'Preserve mode: trim + exact dedupe (max 12). No rewrite. See compare_stage3_evidence_to_stage5_canonical when QUESTION_PIPELINE_TRACE=1.',
    });

    const coverageMatchInput = buildCoverageMatchInput({
      meta,
      headings,
      html,
      contentText: contentForAnalysis,
      pageQuestions,
      hasFaqSchema,
      topicTokens: primaryTopicForCanonical.essentialTokens,
    });

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

    const editorialSubtypeForScoring =
      pageType === 'editorial'
        ? detectEditorialSubtype({
            url,
            meta: meta as AnalysisMeta,
            headings,
            trustSignals,
            jsonLdTypesFound: contentQuality.jsonLdProductTypesFound ?? [],
          })
        : null;

    // Ensure analyzeParagraphs and evaluateCitations never run in parallel.
    // Use sequential execution and limit paragraph analysis to top 3.
    const paragraphStats = analyzeParagraphs(html, headings, searchQuestions, 3);
    let paragraphScore = paragraphStatsToScore(paragraphStats, { isFaqLikePage });
    if (pageType === 'editorial' && editorialSubtypeForScoring?.editorialSubtype === 'blog') {
      const blogParagraphScore = computeBlogRelaxedParagraphScore(contentQuality, contentForAnalysis);
      paragraphScore = Math.max(paragraphScore, blogParagraphScore);
    }

    let searchQuestionCovered: boolean[];
    if (shouldLogQuestionCoverageTrace()) {
      const rowDetails = computeSearchQuestionCoverageDetails(searchQuestions, coverageMatchInput);
      searchQuestionCovered = rowDetails.map((d) => d.covered);
      logQuestionCoverageTrace('coverage_per_question', {
        normalizedUrl,
        pageType,
        finalEvaluatedQuestionCount: searchQuestions.length,
        rows: searchQuestions.map((q, i) => ({
          question: q.text,
          covered: rowDetails[i]?.covered ?? false,
          branch: rowDetails[i]?.branch,
          reason: rowDetails[i]?.reason,
          tokenMatch:
            rowDetails[i]?.matchedTokens != null && rowDetails[i]?.minTokensNeeded != null
              ? { matched: rowDetails[i]?.matchedTokens, minNeeded: rowDetails[i]?.minTokensNeeded }
              : undefined,
        })),
      });
    } else {
      searchQuestionCovered = computeSearchQuestionCoverage(searchQuestions, coverageMatchInput);
    }
    const questionCoverageScore =
      searchQuestions.length > 0
        ? Math.round((searchQuestionCovered.filter(Boolean).length / searchQuestions.length) * 100)
        : 0;
    if (shouldLogQuestionCoverageTrace()) {
      logQuestionCoverageTrace('coverage_aggregate_scoring_path', {
        normalizedUrl,
        pageType,
        coveredCount: searchQuestionCovered.filter(Boolean).length,
        uncoveredCount: searchQuestionCovered.filter((c) => !c).length,
        partialCount: null,
        denominator: searchQuestions.length,
        questionCoveragePercentShownInScores: questionCoverageScore,
      });
    }
    let questionMatchScore = computeQuestionMatchScore(searchQuestions, contentForAnalysis, {
      topicTokens: primaryTopicForCanonical.essentialTokens,
    });
    if (questionMatchScore === 0 && (paragraphStats.communityFitScore ?? 0) > 0) {
      questionMatchScore = Math.min(100, paragraphStats.communityFitScore ?? 0);
    }
    if (
      pageType === 'editorial' &&
      editorialSubtypeForScoring?.editorialSubtype === 'blog'
    ) {
      questionMatchScore = softenQuestionMatchForEditorialBlog(
        questionMatchScore,
        questionCoverageScore
      );
      questionMatchScore = Math.min(75, questionMatchScore);
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

    const hasMetaDescription = !!(meta.description?.trim());
    const hasOgDescription = !!(meta.ogDescription?.trim());
    const descriptionLen = meta.description?.trim().length ?? 0;
    const effectiveDescriptionLength = hasMetaDescription
      ? descriptionLen
      : hasOgDescription
        ? meta.ogDescription!.trim().length
        : 0;

    const features: PageFeatures = {
      meta,
      headings,
      h1Count,
      pageQuestions,
      seedKeywords,
      questionCoverage: questionCoverageScore,
      questionMatchScore,
      structureScore: 0,
      hasFaqSchema,
      hasStructuredData,
      hasProductSchema,
      descriptionLength: descriptionLen,
      hasMetaDescription,
      hasOgDescription,
      effectiveDescriptionLength,
      contentQuality,
      trustSignals,
    };
    let structureScore = calculateStructureScore(
      features,
      config.structureRules,
      config.structureBaseScore,
      isDataPage
    );
    const answerabilityRulesActive = usesDataHeavyAnswerability(pageType, isDataPage)
      ? (config.answerabilityRules ?? [])
      : Array.isArray(config.answerabilityRulesEditorial) && config.answerabilityRulesEditorial.length > 0
        ? config.answerabilityRulesEditorial
        : DEFAULT_EDITORIAL_ANSWERABILITY_RULES;

    const answerabilityResult = calculateRuleScore(features, answerabilityRulesActive, 0, pageType);
    let answerabilityScore =
      answerabilityResult.maxScore > 0
        ? Math.round((answerabilityResult.score / answerabilityResult.maxScore) * 100)
        : 0;
    let answerabilityDataPageFloorApplied = false;
    if (isDataPage && answerabilityScore < 65) {
      answerabilityDataPageFloorApplied = true;
      answerabilityScore = 65;
    }
    const trustSignalsForScoring =
      platform === 'naver_blog'
        ? { ...trustSignals, hasSearchExposure: false }
        : trustSignals;
    const featuresForTrust: PageFeatures = { ...features, trustSignals: trustSignalsForScoring };
    const trustResult = calculateRuleScore(featuresForTrust, config.trustRules ?? [], 0, pageType);
    let trustScore =
      trustResult.maxScore > 0
        ? Math.round((trustResult.score / trustResult.maxScore) * 100)
        : 0;
    if (trustSignals.hasDomainAuthority || trustSignals.hasActualAiCitation) {
      trustScore = Math.min(100, trustScore + 20);
    } else if (trustSignals.hasSearchExposure && platform !== 'naver_blog') {
      trustScore = Math.min(100, trustScore + 5);
    }
    if (isYouTube) {
      trustScore = Math.min(100, trustScore + 15);
    }
    if (platform === 'naver_blog' && pageType === 'editorial') {
      trustScore = Math.min(72, trustScore);
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

    let answerabilityThinDomBoostApplied = false;
    // Thin DOM / failed extraction: soften paragraph & answerability collapse using meta signals
    if (extractionIncomplete && pageType === 'editorial' && !isDataPage) {
      const syn = [meta.title, meta.description, meta.ogDescription].filter(Boolean).join('\n');
      if (syn.length > 120) {
        if (paragraphScore < 45) {
          paragraphScore = Math.min(58, 32 + Math.min(24, Math.floor(syn.length / 130)));
        }
        if (answerabilityScore < 45) {
          const prevAns = answerabilityScore;
          answerabilityScore = Math.max(
            answerabilityScore,
            Math.min(55, 30 + Math.min(25, Math.floor(headings.length * 2.5)))
          );
          if (answerabilityScore > prevAns) answerabilityThinDomBoostApplied = true;
        }
      }
    }

    let answerabilityEditorialQualityGateApplied = false;
    let editorialAnswerabilityQualityDimensions: number | undefined;
    if (!usesDataHeavyAnswerability(pageType, isDataPage)) {
      const useBlogRelaxedGate =
        pageType === 'editorial' && editorialSubtypeForScoring?.editorialSubtype === 'blog';

      if (useBlogRelaxedGate) {
        editorialAnswerabilityQualityDimensions = countEditorialBlogRelaxedQualityBuckets(
          features,
          answerabilityRulesActive,
          structureScore
        );
        if (shouldCapEditorialBlogRelaxedGate(editorialAnswerabilityQualityDimensions)) {
          const before = answerabilityScore;
          answerabilityScore = Math.min(answerabilityScore, EDITORIAL_ANSWERABILITY_QUALITY_CAP_PERCENT);
          if (answerabilityScore < before) answerabilityEditorialQualityGateApplied = true;
        }
      } else {
        editorialAnswerabilityQualityDimensions = countEditorialStrongAnswerSignals(
          features,
          answerabilityRulesActive
        );
        if (shouldCapEditorialAnswerabilityForWeakQuality(editorialAnswerabilityQualityDimensions)) {
          const before = answerabilityScore;
          answerabilityScore = Math.min(answerabilityScore, EDITORIAL_ANSWERABILITY_QUALITY_CAP_PERCENT);
          if (answerabilityScore < before) answerabilityEditorialQualityGateApplied = true;
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
    let blendAxisWeights: GeoScoreBlendDebug['blendAxisWeights'];
    if (blendCtx.hasCitationPath) {
      fixedScore = scoreFromWeights7(axes7, fixedW7);
      monthlyScore = scoreFromWeights7(axes7, monthlyW7);
      blendAxisWeights = {
        variant: '7',
        fixed: normalizeAxisWeights7(fixedW7),
        monthly: normalizeAxisWeights7(monthlyW7),
      };
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
      blendAxisWeights = {
        variant: '5',
        fixed: normalizeAxisWeights5(fixedW5),
        monthly: normalizeAxisWeights5(monthlyW5),
      };
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

    let qualityAdjustmentDebug: GeoScores['qualityAdjustmentDebug'];
    if (pageType === 'editorial') {
      const qa = computeQualityAdjustment({
        contentLength: contentQuality.contentLength,
        quotableSentenceCount: contentQuality.quotableSentenceCount,
        listCount: contentQuality.listCount,
        contentText: contentForAnalysis,
        answerabilityScore,
        repetitiveRatio: paragraphStats.duplicateRatio ?? 0,
        platform,
      });
      finalScore = Math.max(0, Math.min(100, finalScore + qa.adjustment));
      qualityAdjustmentDebug = {
        penalty: qa.penalty,
        boost: qa.boost,
        finalAdjustment: qa.finalAdjustment,
      };
    }

    let commerceMonthlyForDebug: number | undefined;
    let commerceFixedForDebug: number | undefined;
    let commerceBlendedForDebug: number | undefined;

    const answerabilityDebug: AnswerabilityDebug = {
      ...buildAnswerabilityDebug(
        features,
        answerabilityRulesActive,
        pageType,
        contentForAnalysis
      ),
      finalPercent: answerabilityScore,
      dataPageFloorApplied: answerabilityDataPageFloorApplied,
      editorialThinDomBoostApplied: answerabilityThinDomBoostApplied,
      ...(editorialAnswerabilityQualityDimensions !== undefined
        ? {
            editorialQualityDimensionsMet: editorialAnswerabilityQualityDimensions,
            editorialQualityGateApplied: answerabilityEditorialQualityGateApplied,
          }
        : {}),
    };

    if (process.env.GEO_ANSWERABILITY_DEBUG === '1') {
      console.log(
        '[ANSWERABILITY_DEBUG]',
        JSON.stringify(
          {
            url,
            ruleEnginePercent: answerabilityDebug.ruleEnginePercent,
            finalPercent: answerabilityDebug.finalPercent,
            dataPageFloorApplied: answerabilityDebug.dataPageFloorApplied,
            editorialThinDomBoostApplied: answerabilityDebug.editorialThinDomBoostApplied,
            editorialQualityDimensionsMet: answerabilityDebug.editorialQualityDimensionsMet,
            editorialQualityGateApplied: answerabilityDebug.editorialQualityGateApplied,
            signals: answerabilityDebug.signals,
            failedRules: answerabilityDebug.ruleRows.filter((r) => !r.passed && !r.skippedForPageType),
          },
          null,
          2
        )
      );
    }

    const scores: GeoScores = {
      structureScore: effectiveStructureScore, answerabilityScore, trustScore,
      paragraphScore, citationScore,
      questionCoverage: questionCoverageScore,
      questionMatchScore,
      finalScore,
      extractionIncomplete,
      extractionSource,
      answerabilityDebug,
      ...(qualityAdjustmentDebug ? { qualityAdjustmentDebug } : {}),
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
      blendAxisWeights,
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

    const editorialSubtypePayload = editorialSubtypeForScoring;

    const questionRulesForDisplay = getProfileForPageType(activeScoringConfig, pageType)?.questionRules;
    let questionDisplayApplied = applyQuestionDisplaySelection({
      searchQuestions,
      searchQuestionCovered,
      questionRules: questionRulesForDisplay,
    });
    questionDisplayApplied = whenDisplayEmptyUseCanonical(
      questionDisplayApplied,
      searchQuestions,
      searchQuestionCovered
    );

    logQuestionPipelineStage('6_after_applyQuestionDisplaySelection', questionDisplayApplied.searchQuestions, {
      normalizedUrl,
      pageType,
      questionRulesActive: !!questionRulesForDisplay,
      note: 'Profile questionRules: reorder + maxDisplayQuestions cap — final strings shown in UI lists.',
    });

    if (shouldLogQuestionCoverageTrace()) {
      const fullTotal = searchQuestions.length;
      const fullCovered = searchQuestionCovered.filter(Boolean).length;
      const disp = questionDisplayApplied.searchQuestions;
      const dispCov = questionDisplayApplied.searchQuestionCovered;
      const uiCovered = dispCov.filter(Boolean).length;
      logQuestionCoverageTrace('after_applyQuestionDisplaySelection', {
        normalizedUrl,
        pageType,
        forceRefresh: options?.forceRefresh === true,
        apiScores_questionCoverage: questionCoverageScore,
        scoringPath: {
          denominator: fullTotal,
          coveredCount: fullCovered,
          uncoveredCount: fullTotal - fullCovered,
        },
        uiPayload: {
          searchQuestionsLength: disp.length,
          coveredCount: uiCovered,
          uncoveredCount: disp.length - uiCovered,
          percentIfUserCountsVisibleRows:
            disp.length > 0 ? Math.round((uiCovered / disp.length) * 100) : null,
        },
        mismatchNote:
          fullTotal !== disp.length || fullCovered !== uiCovered
            ? 'scores.questionCoverage uses full canonical list before display selection; UI lists may be subset/reordered'
            : 'display list same length as canonical (no maxDisplay cap or same size)',
        questionCoverageDebug: questionDisplayApplied.debug ?? null,
      });
    }

    logQuestionCoverageStagesDebug({
      normalizedUrl,
      pageType,
      note:
        'afterFetchTopicQuality = fetchSearchQuestions (internal Tavily + topic/quality). Raw merged Tavily: QUESTION_PIPELINE_TRACE in searchQuestions.ts. Page filter does not use post-LLM token subset.',
      afterFetchTopicQuality: {
        count: questionTextsAfterFetchTopicQuality.length,
        sample: questionTextsAfterFetchTopicQuality.slice(0, 10),
      },
      afterPageRelevanceFilter: {
        count: questionTextsAfterPageRelevance.length,
        sample: questionTextsAfterPageRelevance.slice(0, 10),
      },
      afterCanonical: {
        count: searchQuestions.length,
        sample: searchQuestions.map((q) => q.text).slice(0, 10),
      },
      afterDisplaySelection: {
        count: questionDisplayApplied.searchQuestions.length,
        sample: questionDisplayApplied.searchQuestions.map((q) => q.text).slice(0, 10),
      },
      finalCoveredQuestions: questionDisplayApplied.searchQuestions
        .filter((_, i) => questionDisplayApplied.searchQuestionCovered[i])
        .map((q) => q.text),
      finalUncoveredQuestions: questionDisplayApplied.searchQuestions
        .filter((_, i) => !questionDisplayApplied.searchQuestionCovered[i])
        .map((q) => q.text),
      filterMetaStatus: filterQuestionsMeta.status,
    });

    const coreResult: AnalysisResult = {
      url: displayOpenUrl,
      normalizedUrl,
      analyzedAt: new Date().toISOString(),
      geoConfigVersion,
      pageType,
      platform,
      ...(editorialSubtypePayload
        ? {
            editorialSubtype: editorialSubtypePayload.editorialSubtype,
            editorialSubtypeDebug: editorialSubtypePayload.editorialSubtypeDebug,
          }
        : {}),
      meta,
      seedKeywords,
      pageQuestions,
      searchEvidence,
      questionSourceStatus,
      canonicalSearchQuestions: [...searchQuestions],
      searchQuestions: questionDisplayApplied.searchQuestions,
      searchQuestionCovered: questionDisplayApplied.searchQuestionCovered,
      ...(questionDisplayApplied.debug ? { questionCoverageDebug: questionDisplayApplied.debug } : {}),
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
      finalFetchedUrl: serverFinalFetchedUrl,
      analysisFetchTargetUrl: serverFetchTargetUrl,
      naverFetchUsedPcFallback: naverFetchUsedPcFallback || undefined,
      analysisFetchWarning,
      naverMobileFetchUsedHeadless: naverMobileFetchUsedHeadless || undefined,
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
      platformConstraints,
      weakBlogFallbackApplied,
      strengthGenerationDebug,
      issueGenerationDebug,
    } = auditWeb;

    if (platform === 'naver_blog' && pageType === 'editorial') {
      let weakPenaltyPts = 0;
      if (weakBlogFallbackApplied) weakPenaltyPts += 6;
      if (paragraphScore < 60 && answerabilityScore < 60) weakPenaltyPts += 4;
      weakPenaltyPts = Math.min(10, weakPenaltyPts);
      if (weakPenaltyPts > 0) {
        scores.finalScore = Math.max(0, Math.min(100, scores.finalScore - weakPenaltyPts));
      }
      scores.finalWeakBlogPenaltyDebug = {
        applied: weakPenaltyPts > 0,
        amount: weakPenaltyPts,
      };
      if (scores.scoreBlendDebug) {
        scores.scoreBlendDebug = { ...scores.scoreBlendDebug, finalScore: scores.finalScore };
      }
    }

    if (pageType === 'editorial') {
      let boostPts = 0;
      if (paragraphScore >= 70 && answerabilityScore >= 70) boostPts = 10;
      else if (paragraphScore >= 65 && answerabilityScore >= 65) boostPts = 8;
      if (boostPts > 0) {
        scores.finalScore = Math.max(0, Math.min(100, scores.finalScore + boostPts));
        if (scores.scoreBlendDebug) {
          scores.scoreBlendDebug = { ...scores.scoreBlendDebug, finalScore: scores.finalScore };
        }
      }
      scores.editorialContentBoostDebug = {
        applied: boostPts > 0,
        amount: boostPts,
      };
    }

    applyIssueBasedFinalScorePenalty(scores, geoIssues);

    const geoExplainWeb = {
      axisScores: coreResult.axisScores,
      issues: geoIssues,
      passed: geoPassedItems,
      opportunities,
      ...(strengthGenerationDebug ? { strengthGenerationDebug } : {}),
      ...(issueGenerationDebug ? { issueGenerationDebug } : {}),
    };
    logGeoExplainDebug(url, coreResult.pageType, geoExplainWeb, {
      editorialSubtype: coreResult.editorialSubtype,
      editorialSubtypeDebug: coreResult.editorialSubtypeDebug,
    });

    const uncoveredQuestions = questionDisplayApplied.uncoveredOrderedForRecommendations;
    logGuideConfigBoundary('runAnalysis before generateGeoRecommendations', pageType, activeScoringConfig);
    const recommendations = await generateGeoRecommendations(uncoveredQuestions, issues, {
      searchQuestions: questionDisplayApplied.searchQuestions,
      pageQuestions,
      pageType,
      editorialSubtype: coreResult.editorialSubtype,
      geoOpportunities: opportunities,
      geoIssues,
      geoPassedIds: geoPassedItems.map((p) => p.id),
      axisScores: coreResult.axisScores,
      meta: coreResult.meta,
      textSample: effectiveContentText.slice(0, 4000),
      contentQuality: coreResult.contentQuality,
      reviewLike: Boolean((coreResult as { reviewLike?: boolean }).reviewLike),
      hasReviewSchema,
      limitedAnalysis: coreResult.limitedAnalysis,
      seedKeywords: coreResult.seedKeywords,
      questionRules: questionRulesForDisplay,
      activeScoringConfig,
    });

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
      platformConstraints,
      ...(weakBlogFallbackApplied ? { weakBlogFallbackApplied: true } : {}),
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