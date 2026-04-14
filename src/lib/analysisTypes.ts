export interface AnalysisMeta {
  title: string | null;
  description: string | null;
  keywords: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  canonical: string | null;
}

export interface SeedKeyword {
  value: string;
  score: number;
}

export type SearchSource = 'google' | 'naver' | 'community';

export interface SearchQuestion {
  source: SearchSource;
  text: string;
  url?: string;
}

export interface QuestionCluster {
  topic: string;
  representativeQuestion: string;
  variants: string[];
  coveredByPage: boolean;
  evidence: SearchQuestion[];
}

/** Snapshot when editorial citation used rule-based estimate (Gemini chunks unavailable) */
export interface CitationFallbackDebug {
  applied: boolean;
  reason?: string | null;
  estimate?: number | null;
  band?: string | null;
  compositeQuality?: number | null;
}

/** Normalized weights used inside scoreFromWeights7 (sum ≈ 1). */
export interface BlendAxisWeights7Debug {
  citation: number;
  paragraph: number;
  answerability: number;
  structure: number;
  trust: number;
  questionMatch: number;
  questionCoverage: number;
}

/** Normalized weights used inside scoreFromWeights5 (sum ≈ 1). */
export interface BlendAxisWeights5Debug {
  paragraph: number;
  answerability: number;
  structure: number;
  trust: number;
  questionMatch: number;
}

/** Explainability: monthly vs fixed backbone blend (editorial/web path). */
export interface GeoScoreBlendDebug {
  blendAlpha: number;
  monthlyScore: number;
  fixedScore: number;
  monthlyContribution: number;
  fixedContribution: number;
  finalScoreBeforeCaps: number;
  /** After trust/safety caps (currently trust band 79/70); alias for “post-cap” editorial blend */
  finalScoreAfterCaps: number;
  finalScore: number;
  trustCapBand: 'none' | 'max_79' | 'max_70';
  commerceMonthlyScore?: number;
  commerceFixedScore?: number;
  commerceBlendedScore?: number;
  /**
   * Per-axis weights actually used in fixedScore / monthlyScore (after normalize7/5).
   * Check `paragraph` here — e.g. 0 when FAQ / high question-match branch zeroed paragraph in fixed engine.
   */
  blendAxisWeights?:
    | { variant: '7'; fixed: BlendAxisWeights7Debug; monthly: BlendAxisWeights7Debug }
    | { variant: '5'; fixed: BlendAxisWeights5Debug; monthly: BlendAxisWeights5Debug };
}

/** Answerability audit — per config rule + heuristics (debug only; not a second scorer) */
export interface AnswerabilityRuleDebugRow {
  id: string;
  label?: string;
  check: string;
  threshold?: number;
  maxPoints: number;
  earnedPoints: number;
  passed: boolean;
  skippedForPageType?: boolean;
}

export interface AnswerabilitySignalsDebug {
  firstParagraphLength: number;
  firstParagraphMeetsMinLength: boolean;
  hasDefinitionPattern: boolean;
  quotableSentenceCount: number;
  faqLikeHeadingCount: number;
  recommendationOrConclusionSentenceCount: number;
  introDirectAnswerHeuristic: boolean;
  pageQuestionsExtractedCount: number;
}

export interface AnswerabilityDebug {
  rawEarned: number;
  rawMax: number;
  ruleEnginePercent: number;
  finalPercent: number;
  dataPageFloorApplied: boolean;
  editorialThinDomBoostApplied: boolean;
  /**
   * Editorial-only: gate signal count. Strict: strong verdict signals (max 4), need ≥3.
   * Blog relaxed (`editorialSubtype === 'blog'`): structure/question/clarity buckets (max 3), need ≥2.
   */
  editorialQualityDimensionsMet?: number;
  /** Editorial-only: true when answerability was capped due to the editorial quality gate. */
  editorialQualityGateApplied?: boolean;
  ruleRows: AnswerabilityRuleDebugRow[];
  signals: AnswerabilitySignalsDebug;
}

/** Human-readable why the GEO score is high/low — generated for UI, not scoring. */
export interface GeoScoreExplanation {
  summary: string;
  strengths: string[];
  weaknesses: string[];
}

export interface GeoScores {
  structureScore: number;
  answerabilityScore: number;
  trustScore: number;
  paragraphScore: number;
  citationScore: number;
  questionCoverage: number;
  /** 0~100. Top 검색 질문과 본문 매칭률 — finalScore에 5% 반영 */
  questionMatchScore: number;
  finalScore: number;
  /** DOM/텍스트 추출이 불충분할 때 true — 점수에 메타 기반 완화가 적용됐을 수 있음 */
  extractionIncomplete?: boolean;
  /** server = HTTP fetch only; headless = Playwright-rendered HTML was used */
  extractionSource?: 'server' | 'headless';
  citationFallbackDebug?: CitationFallbackDebug;
  /** Optional: monthly vs fixed blend breakdown for calibration / UI */
  scoreBlendDebug?: GeoScoreBlendDebug;
  /** Per-rule + heuristic signals — editorial answerability audit (not used in scoring math) */
  answerabilityDebug?: AnswerabilityDebug;
  /** Editorial-only post-blend quality tuning (penalty/boost); not from monthly GEO config */
  qualityAdjustmentDebug?: {
    penalty: number;
    boost: number;
    finalAdjustment: number;
  };
  /** Naver editorial: extra finalScore cut for weak / promo signal (post-audit) */
  finalWeakBlogPenaltyDebug?: {
    applied: boolean;
    /** Points subtracted from finalScore (0–10) */
    amount: number;
  };
  /** Editorial-only: boost strong paragraph+answerability pages (post-audit) */
  editorialContentBoostDebug?: {
    applied: boolean;
    /** Points added to finalScore (0–10) */
    amount: number;
  };
  /**
   * Final GEO score immediately before issue-severity penalty (after blend, trust caps, commerce override, naver penalty, editorial boost).
   * Set by `applyIssueBasedFinalScorePenalty` on every analysis path; equals pre-penalty `finalScore`.
   * Relation: `finalScore === clamp(preIssuePenaltyFinalScore - issuePenaltyPoints)`.
   */
  preIssuePenaltyFinalScore?: number;
  /** Capped severity sum subtracted from `preIssuePenaltyFinalScore` (0 if no penalty). */
  issuePenaltyPoints?: number;
  /** Present only when `issuePenaltyPoints > 0` — full breakdown for debugging. */
  issuePenaltyDebug?: IssuePenaltyDebug;
}

/** Post-blend adjustment from audit issue severities — not an axis score change. */
export interface IssuePenaltyDebug {
  /** Sum of per-issue penalties before cap */
  rawPenaltyPoints: number;
  /** Points actually subtracted after cap */
  cappedPenaltyPoints: number;
  /** Max total penalty (configurable in code) */
  cap: number;
  /** Per-severity issue counts included in the sum */
  counts: { high: number; medium: number; low: number };
  /** Penalty points per severity tier used in calculation */
  pointsPerTier: { high: number; medium: number; low: number };
}

export interface ParagraphAnalysis {
  index: number;
  text: string;
  definitionRatio: number;
  numberRatio: number;
  properNounRatio: number;
  infoDensity: number;
  communityFitScore: number;
}

export interface ParagraphStats {
  totalParagraphs: number;
  definitionRatio: number;
  goodLengthRatio: number;
  fluffRatio: number;
  duplicateRatio: number;
  questionH2Ratio: number;
  earlySummaryExists: boolean;
  /** 요약형 문단 수(결론적으로/요약하자면/팁을 드리자면 등으로 시작) */
  summaryParagraphCount?: number;
  /** 실용적 키워드(How-to) 밀집 — 방법론/절차/꿀팁 등 */
  hasHighValueContext?: boolean;
  avgScore: number;
  communityFitScore: number;
  infoDensity: number;
  /** 숫자+단위(원, Ah, %, kg 등) 포함 블록 수 - 1개당 +2점 정보 밀도 가산 */
  dataDenseBlockCount?: number;
}

export interface ChunkCitation {
  index: number;
  text: string;
  score: number;
  reason: string;
  communityFitScore?: number;
  infoDensity?: number;
}

export interface GeoPredictedQuestion {
  question: string;
  importanceReason: string;
  coveredByPage: boolean;
  isTopGap?: boolean;
}

/** LLM(Gemini) 기능별 호출 상태 추적 */
export type LlmFeature =
  | 'recommendations'
  | 'citations'
  | 'videoAnalysis'
  | 'geoConfigUpdate'
  | 'coverageVerify'
  /** User-triggered AI Writing Assistant (not part of Recommendation engine) */
  | 'aiWritingExamples';
export interface LlmCallStatus {
  feature: LlmFeature;
  status: 'ok' | 'skipped_quota' | 'error';
  retryAfterSec?: number;
  /** 사용자 노출 메시지: rate-limit / quota-disabled 구분 */
  message?: string;
}

/** Internal trace for deterministic recommendations (explainability / debugging). */
export interface GeoRecommendationTraceEntry {
  target:
    | 'trendSummary'
    | 'contentGapSummary'
    | 'heading'
    | 'block'
    | 'priorityNote'
    | 'predictedQuestions'
    | 'guideRule';
  /** Stable refs: issue:<id>, opportunity:<id>, axis:<name>, rule:<id>, signal:<name> */
  sources: string[];
  index?: number;
}

export interface GeoRecommendationTrace {
  locale: 'ko' | 'en';
  reviewCategory: 'none' | 'electronics' | 'physical_goods' | 'unknown';
  reviewCategoryConfidence: 'low' | 'high';
  entries: GeoRecommendationTraceEntry[];
}

export interface GeoRecommendations {
  trendSummary: string;
  contentGapSummary: string;
  actionPlan: {
    suggestedHeadings: string[];
    suggestedBlocks: string[];
    priorityNotes?: string[];
  };
  /** 전체 예상 질문 목록 (5~8개) */
  predictedQuestions?: GeoPredictedQuestion[];
  /** 그 중에서 본문에 없는 Top3 */
  predictedUncoveredTop3?: GeoPredictedQuestion[];
  /** 규칙 기반 템플릿 추천(쿼터 제한 시 대체) */
  isTemplateFallback?: boolean;
  /** Deterministic engine: why headings/blocks/summaries were emitted */
  trace?: GeoRecommendationTrace;
  /** Optional: config-driven guideRules merge (deterministic; no LLM). */
  guideGenerationDebug?: GuideGenerationDebug;
}

/** Monthly GEO profile: content improvement guide lines triggered by issue/strength ids. */
export interface GuideRule {
  id: string;
  /** Issue ids and/or strength (passed) ids that activate this guide when present in the current run. */
  basedOn?: string[];
  /** Same as `basedOn` — present when config JSON uses snake_case only. */
  based_on?: string[];
  message: string;
  priority?: 'high' | 'medium' | 'low';
  /** Optional extra priority lines (editorial: merged after `message`, config-first). */
  priorityNotes?: string[];
  /** Optional H2/H3 suggestions (editorial: primary; engine fills gaps). */
  suggestedHeadings?: string[];
  /** Optional block hints (editorial: primary; engine fills gaps). */
  suggestedBlocks?: string[];
}

/** Snapshot of matched config guide rules (for client / AI Writing Assistant context). */
export interface MatchedGuideRuleSnapshot {
  id: string;
  message: string;
  priority?: 'high' | 'medium' | 'low';
}

export interface GuideGenerationDebug {
  source: 'config' | 'fallback' | 'mixed';
  matchedRuleIds: string[];
  /** Full rule text for matched ids — used when sending guide-first AI example requests. */
  matchedGuideRules?: MatchedGuideRuleSnapshot[];
  /** Which actionPlan fields received non-empty config-driven content (editorial rich merge). */
  appliedFields?: {
    priorityNotes: boolean;
    suggestedHeadings: boolean;
    suggestedBlocks: boolean;
  };
}

/** Classifier labels for search-question display priority (heuristic; no LLM). */
export type SearchQuestionKind =
  | 'faq'
  | 'comparison'
  | 'definition'
  | 'price'
  | 'spec'
  | 'buyer_fit'
  | 'how_to'
  | 'summary'
  | 'timestamp'
  | 'transactional'
  | 'unknown';

/**
 * Profile-driven display / ranking for collected search questions (optional; all fields optional).
 * Lives under `config_json.profiles[pageType].questionRules`.
 */
export interface QuestionDisplayRules {
  maxDisplayQuestions?: number;
  topGapCount?: number;
  preferredQuestionTypes?: SearchQuestionKind[];
  deprioritizedQuestionTypes?: SearchQuestionKind[];
  /** Default true when omitted */
  prioritizeUncovered?: boolean;
  prioritizeComparisonQuestions?: boolean;
  minQuestionLength?: number;
}

/** Optional debug for question coverage display selection (non-breaking). */
export interface QuestionCoverageDebug {
  source: 'config' | 'fallback';
  selectedQuestionTypes: string[];
  appliedRules?: {
    maxDisplayQuestions?: number;
    topGapCount?: number;
    preferredQuestionTypes?: string[];
  };
}

/**
 * Hosting / CMS surface — independent of pageType (editorial/commerce/video) and editorialSubtype.
 * Used for issue guidance and publish-date handling; scoring does not branch on this yet.
 */
export type PlatformType =
  | 'self_hosted'
  | 'naver_blog'
  | 'tistory'
  | 'brunch'
  | 'wordpress'
  | 'youtube'
  | 'commerce_platform'
  | 'unknown';

/** Whether user-facing question lines came from Tavily/cache vs quota failure vs local fallback examples */
export type QuestionSourceStatus = 'tavily_success' | 'tavily_failed' | 'fallback_only';

export interface AnalysisResult {
  /**
   * User-facing / openable page URL. Prefer post-redirect fetch URL when available
   * (`finalFetchedUrl` ?? `analysisFetchTargetUrl` ?? sanitized input). Never use `normalizedUrl`
   * alone as the primary display link when a fetch target or final URL differs (e.g. apex vs www).
   */
  url: string;
  /** Canonical URL for cache keys, dedupe, and internal identity (e.g. Naver m.blog, YouTube watch?v=). */
  normalizedUrl: string;
  analyzedAt: string;
  /** Active `geo_scoring_config.version` at analysis time — used for cache invalidation when config changes */
  geoConfigVersion?: string | null;
  /** 페이지 타입 (editorial/video/commerce) — profiles[pageType] 선택용 */
  pageType?: PageType;
  /** Hosting platform from URL/path heuristics (e.g. naver_blog, tistory). Not a scoring input yet. */
  platform?: PlatformType;
  /**
   * Editorial-only: article vs corporate/help-site context for explainability / recommendations tone.
   * `blog` also selects the relaxed editorial answerability quality gate (2 informational buckets vs 3 verdict signals).
   * Does not change top-level pageType.
   */
  editorialSubtype?: EditorialSubtype;
  editorialSubtypeDebug?: EditorialSubtypeDebug;
  meta: AnalysisMeta;
  seedKeywords: SeedKeyword[];
  pageQuestions: string[];
  /** Raw search/community titles & snippets (evidence); scoring uses canonicalSearchQuestions */
  searchEvidence?: SearchQuestion[];
  /** Question-like intents derived for questionCoverage / questionMatch (not raw SERP strings) */
  canonicalSearchQuestions?: SearchQuestion[];
  /** Tavily/cache vs fallback — controls question-coverage UI (no fake “Google” labels on fallback) */
  questionSourceStatus?: QuestionSourceStatus;
  searchQuestions: SearchQuestion[];
  searchQuestionCovered?: boolean[];
  /** When profile `questionRules` applied — how questions were ranked/filtered for display */
  questionCoverageDebug?: QuestionCoverageDebug;
  questionClusters: QuestionCluster[];
  scores: GeoScores;
  /** Canonical axis snapshot for explainability (same source as scores.* where applicable) */
  axisScores?: GeoAxisScores;
  contentQuality: ContentQuality;
  trustSignals: TrustSignals;
  paragraphStats: ParagraphStats;
  chunkCitations?: ChunkCitation[];
  recommendations?: GeoRecommendations;
  /** Structured explainability: axis → issues → passed → opportunities (legacy fields remain) */
  geoExplain?: GeoExplain;
  headings: string[];
  h1Count: number;
  hasFaqSchema: boolean;
  hasStructuredData: boolean;
  hasReviewSchema?: boolean;
  /** 내부 신호: editorial 내에서 리뷰/비교성향을 감지하면 true */
  reviewLike?: boolean;
  /** Passed checks — 긍정 신호 목록 (UI에 표시되는 잘된 점) */
  passedChecks?: PassedCheck[];
  /** 유튜브 등 전용 파이프라인에서 미리 계산된 이슈 (있으면 deriveAuditIssues에서 규칙 기반 대신 사용) */
  auditIssues?: AuditIssue[];
  /** 유튜브 전용: Gemini가 생성한 '잘된 점' 정성 문장 (영상 정보 전달력 등) */
  youtubeSuccessFactor?: string;
  /** LLM(Gemini) 기능별 호출 상태 — 429 스킵 등 UI 표시용 */
  llmStatuses?: LlmCallStatus[];
  /** Analysis was limited due to bot protection / short HTML / interstitial; UI should present a limited-analysis message */
  limitedAnalysis?: boolean;
  /** Short reason code for limited analysis: 'short_html' | 'site_protection' | 'interstitial' | 'upstream_error' */
  limitedReason?: string | null;
  /** True when article body text/chunks were too thin for reliable paragraph scoring */
  extractionIncomplete?: boolean;
  extractionSource?: 'server' | 'headless';
  /**
   * URL after the last HTTP redirect for the successful HTML fetch when known (Response.url or
   * proxy `X-GEO-Upstream-Final-Url`). Prefer this for display over `analysisFetchTargetUrl`.
   */
  finalFetchedUrl?: string;
  /**
   * First successful server HTML fetch URL (web path). May differ from normalizedUrl when Naver
   * mobile fetch fails and PC/PostView fallback succeeds, or when a non-Naver host uses a
   * network-preferred hostname (e.g. www) while normalizedUrl stays apex for cache identity.
   * Undefined for YouTube-only pipeline.
   */
  analysisFetchTargetUrl?: string;
  /** Naver blog: HTML came from blog.naver.com / PostView after mobile+headless mobile could not yield usable body */
  naverFetchUsedPcFallback?: boolean;
  /** Shown when Naver analysis used PC fallback — scores may differ from m.blog-only analysis */
  analysisFetchWarning?: string | null;
  /** Naver blog: Playwright was used to load m.blog before accepting fallback */
  naverMobileFetchUsedHeadless?: boolean;
  /** Set when naver_blog + editorial injects `blog_low_info_density` fallback issue */
  weakBlogFallbackApplied?: boolean;
  /**
   * Hosting limitations surfaced instead of technical SEO audit items (e.g. Naver Blog).
   * Populated by deriveAuditIssues; does not affect scoring.
   */
  platformConstraints?: PlatformConstraint[];
}

export type AuditPriority = 'high' | 'medium' | 'low';

/** GEO explainability — axis keys aligned with GeoScores + optional extensions */
export type GeoAxis =
  | 'citation'
  | 'paragraph'
  | 'answerability'
  | 'structure'
  | 'trust'
  | 'questionMatch'
  | 'questionCoverage'
  | 'density'
  | 'videoMetadata';

export type GeoIssueCategory =
  | 'missing_signals'
  | 'weak_signals'
  | 'structural'
  | 'trust'
  | 'opportunities';

export interface GeoAxisScores {
  citation: number;
  paragraph: number;
  answerability: number;
  structure: number;
  trust: number;
  questionMatch: number;
  questionCoverage: number;
  /** Paragraph / extractable density (0–100) when derivable */
  density?: number;
  /** Video metadata pipeline (YouTube) composite when applicable */
  videoMetadata?: number;
}

export interface GeoIssueSourceRefs {
  ruleId?: string;
  axisScoreAtEmit?: Partial<Record<GeoAxis, number>>;
  checkExpression?: string;
}

export interface GeoIssue {
  id: string;
  category: GeoIssueCategory;
  axis: GeoAxis;
  severity: AuditPriority;
  label: string;
  description: string;
  fix: string;
  sourceRefs: GeoIssueSourceRefs;
}

export interface GeoPassedSourceRefs {
  ruleId?: string;
  axisScoreAtEmit?: Partial<Record<GeoAxis, number>>;
}

export interface GeoPassedItem {
  id: string;
  axis: GeoAxis;
  label: string;
  description: string;
  reason: string;
  sourceRefs: GeoPassedSourceRefs;
}

export interface GeoOpportunitySourceRefs {
  fromIssueId?: string;
  fromAxis?: GeoAxis;
  templateId?: string;
}

export interface GeoOpportunity {
  id: string;
  improvesAxis: GeoAxis;
  fixesIssueId?: string;
  impact: AuditPriority;
  title: string;
  rationale: string;
  sourceRefs: GeoOpportunitySourceRefs;
}

/**
 * Optional editorial-only strength lines in `profiles.editorial` (monthly GEO config).
 * Evaluated via `evaluateCheck` using the same DSL as `passedRules`.
 */
export interface StrengthRule {
  id: string;
  label: string;
  description: string;
  reason: string;
  axis: GeoAxis;
  /** evaluateCheck identifier. JSON may use `condition` as an alias. */
  check?: string;
  condition?: string;
  threshold?: number;
  priority?: string;
}

/** Debug: how editorial strengths were assembled (non-breaking, optional on GeoExplain). */
export interface StrengthGenerationDebug {
  source: 'config' | 'fallback' | 'mixed';
  matchedRuleIds: string[];
}

/** Debug: issue rule resolution (optional on GeoExplain). */
export interface IssueGenerationDebug {
  source: 'profile' | 'root' | 'fallback' | 'mixed';
  /** Geo issue ids from non–axis_weak rules (rule-layer + custom profile rules) */
  matchedRuleIds: string[];
  pageType: string;
}

/** Monthly config: declarative passed signals (optional) */
export interface PassedRule {
  id: string;
  axis: GeoAxis;
  label: string;
  description: string;
  reasonTemplate: string;
  check: string;
  threshold?: number;
  pageTypes?: PageType[];
}

/** Monthly config: opportunity seeds (optional) */
export interface OpportunityTemplate {
  id: string;
  improvesAxis: GeoAxis;
  fixesIssueId?: string;
  impact: AuditPriority;
  title: string;
  rationaleTemplate: string;
}

export interface GeoExplain {
  axisScores: GeoAxisScores;
  issues: GeoIssue[];
  passed: GeoPassedItem[];
  opportunities: GeoOpportunity[];
  /** Optional: editorial strength generation diagnostics */
  strengthGenerationDebug?: StrengthGenerationDebug;
  /** Optional: issue rule resolution diagnostics */
  issueGenerationDebug?: IssueGenerationDebug;
}

export interface FixExample {
  language: string;
  code: string;
}

export interface PassedCheck {
  id: string;
  label: string;
  reason: string;
  /** Present when adapted from GeoPassedItem (GEO explain / engine). */
  description?: string;
  position?: { top: number; left: number; width: number; height: number };
}

/** Non-actionable platform limits (e.g. Naver Blog: no editable meta / JSON-LD). Audit UI only; does not change scores. */
export interface PlatformConstraint {
  id: string;
  label: string;
  description: string;
  /** Actionable substitute for the writer (plain language). */
  alternative: string;
}

export interface AuditIssue {
  id: string;
  number: number;
  label: string;
  description: string;
  priority: AuditPriority;
  targetSelector: string;
  targetIndex: number;
  position?: { top: number; left: number; width: number; height: number };
  fixExamples?: FixExample[];
}

export interface ElementPosition {
  selector: string;
  index: number;
  text: string;
  rect: { top: number; left: number; width: number; height: number };
}

export interface IframePositionData {
  type: 'GEO_ELEMENT_POSITIONS';
  elements: ElementPosition[];
  hasTitle: boolean;
  hasDescription: boolean;
  hasCanonical: boolean;
  hasOgTitle: boolean;
  hasOgDescription: boolean;
  scrollHeight: number;
}

// --------------- GEO Scoring Config ---------------

export interface ScoringRule {
  id: string;
  label: string;
  check: string;
  points: number;
  threshold?: number;
}

export interface IssueRule {
  id: string;
  /** evaluateCheck DSL; JSON may use `condition` as an alias */
  check?: string;
  condition?: string;
  threshold?: number;
  label: string;
  description: string;
  priority: AuditPriority;
  targetSelector: string;
  targetIndex: number;
  /** When id is not in built-in meta maps, set explicitly */
  axis?: GeoAxis;
  category?: GeoIssueCategory;
}

/** 유튜브 전용 잘된 점(PassedCheck) 기준 — 월별 GEO 업데이트에 포함 */
export interface YouTubePassedCheckRule {
  id: string;
  label: string;
  reason: string;
  check: 'yt_title_opt' | 'yt_info_density' | 'yt_chapter' | 'yt_authority' | 'yt_gemini_factor';
  /** yt_info_density의 경우 설명란 최소 글자수 (기본 300) */
  threshold?: number;
}

export interface GeoScoringConfig {
  version: string;
  updatedAt: string;
  source: 'ai-generated' | 'manual';
  researchSummary: string;
  /** Human-readable explanation for why weights/changes were made (AI-generated) */
  reasoning?: string;
  /** Optional list of summarized source URLs/titles that influenced the config (AI-provided) */
  source_summary?: string[];

  structureBaseScore: number;
  structureRules: ScoringRule[];

  weights: {
    structure: number;
    coverage: number;
  };

  answerabilityRules?: ScoringRule[];
  /** Blog/editorial pages (non-commerce, non–data-heavy). Falls back to engine default when omitted. */
  answerabilityRulesEditorial?: ScoringRule[];
  trustRules?: ScoringRule[];

  issueRules: IssueRule[];
  /** Optional monthly passed rules (evaluateCheck DSL) */
  passedRules?: PassedRule[];
  /** Optional monthly opportunity seeds merged by OpportunityEngine */
  opportunityTemplates?: OpportunityTemplate[];
  /** 유튜브 비디오 전용 PassedCheck 기준 — 월별 업데이트 대상 */
  youtubePassedCheckRules?: YouTubePassedCheckRule[];
  /** When generic pipeline encounters YouTube pages, only these issue IDs are allowed to be evaluated */
  youtubeAllowedIssueIds?: string[];
  /** Known commerce domains used to classify commerce pages */
  commerceDomains?: string[];

  /**
   * Weight on monthly profile blend in finalScore (editorial/web): final ≈ alpha * monthly + (1-alpha) * fixed.
   * Clamped to [0.05, 0.95] when present. Default engine constant used when omitted.
   */
  scoreBlendAlpha?: number;

  /** GEO 2.0: 카테고리별 프로필 (editorial / video / commerce / default). 부분만 정의 가능 — 로더는 default 폴백 */
  profiles?: Partial<Record<PageType, GeoScoringProfile>>;
  /** Optional: shared guide rules at config root (some JSON generators use this instead of profiles.*.guideRules) */
  guideRules?: GuideRule[];
  /** Same as guideRules when stored as snake_case in config_json */
  guide_rules?: GuideRule[];
}

/** 페이지 타입 — runAnalysis에서 pageType 감지 후 profiles[pageType] 선택 */
export type PageType = 'editorial' | 'video' | 'commerce' | 'default';

/** Editorial page form — UI/explainability only; not a top-level PageType */
export type EditorialSubtype = 'blog' | 'site_info' | 'mixed';

export interface EditorialSubtypeDebug {
  confidence: number;
  blogScore: number;
  siteInfoScore: number;
  reasons: string[];
}

/** GEO 2.0 카테고리별 스코어링 프로필 */
export interface GeoScoringProfile {
  weights: {
    citation?: number;
    questionCoverage?: number;
    answerability?: number;
    structure?: number;
    trust?: number;
    questionMatch?: number;
    density?: number;
    /** Commerce-oriented profiles: product/spec data density vs editorial text */
    dataDensity?: number;
  };
  issueRules: IssueRule[];
  /** Tavily 질문 수집용 템플릿. {keyword}를 시드 키워드로 치환 */
  queryTemplates: string[];
  /** Editorial-only: config-driven strengths (optional; falls back to engine defaults) */
  strengthRules?: StrengthRule[];
  /** Optional: config-driven content improvement guide lines (issue/strength id triggers). */
  guideRules?: GuideRule[];
  /** Same as guideRules when profile JSON uses snake_case only. */
  guide_rules?: GuideRule[];
  /** Optional: rank/filter collected search questions for display & recommendation gaps (collection stays in code). */
  questionRules?: QuestionDisplayRules;
}

/** Signals for blog/editorial answerability profile only (see editorialBlogAnswerability.ts) */
export interface EditorialBlogSignals {
  introTakeaway: boolean;
  recoConclusionCount: number;
  prosConsOrComparison: boolean;
  audienceGuidance: boolean;
  listWithGuidance: boolean;
  choiceLanguage: boolean;
  titleIntroAligned: boolean;
  decisiveNonNumericCount: number;
  pageQuestionCount: number;
  listCount: number;
  faqLikeHeadingCount: number;
}

export interface ContentQuality {
  contentLength: number;
  /** Populated in htmlAnalyzer — used when editorial (non–data-heavy) answerability profile runs */
  editorialBlogSignals?: EditorialBlogSignals;
  tableCount: number;
  listCount: number;
  h2Count: number;
  h3Count: number;
  imageCount: number;
  hasStepStructure: boolean;
  quotableSentenceCount: number;
  /** Debug: strict quotable pass count (htmlAnalyzer editorial path) */
  quotableAcceptedCount?: number;
  /** Debug: strict quotable reject count */
  quotableRejectedCount?: number;
  firstParagraphLength: number;
  hasDefinitionPattern: boolean;
  hasPriceInfo: boolean;
  /** 제품 스펙(모델명+수치) 밀집 블록 수 - 쇼핑/데이터형 페이지용 quotable 보조 */
  productSpecBlockCount?: number;
  /** 추가 쇼핑 감지 신호 */
  priceMatchCount?: number;
  buyButtonCount?: number;
  commerceKeywordCount?: number;
  repeatedProductCardCount?: number;
  hasOgProductType?: boolean;
  hasCommerceKeywords?: boolean;
  /** JSON-LD @type values seen (sorted, deduped) — page-type detection */
  jsonLdProductTypesFound?: string[];
  hasJsonLdProduct?: boolean;
  hasJsonLdItemList?: boolean;
  hasJsonLdOfferOrAggregate?: boolean;
  /** Product in JSON-LD with no ItemList (typical PDP) */
  hasJsonLdStandaloneProduct?: boolean;
  /** ItemList + Product together (ranking / best-of / comparison articles) */
  hasJsonLdProductInListContext?: boolean;
}

export interface TrustSignals {
  hasAuthor: boolean;
  hasPublishDate: boolean;
  /** True if meta tags (e.g. article:published_time) contributed to hasPublishDate */
  publishDateFromMeta?: boolean;
  /** True if JSON-LD or microdata (itemprop datePublished) contributed */
  publishDateFromStructuredData?: boolean;
  /** True if visible on-page / hosted-template date text contributed */
  publishDateFromVisibleUi?: boolean;
  hasModifiedDate: boolean;
  hasContactLink: boolean;
  hasAboutLink: boolean;
  /** Top Tier 화이트리스트 도메인 여부 */
  hasDomainAuthority?: boolean;
  /** Tavily 검색 결과에 해당 도메인 노출 — SEO 증거 (AI 인용과 별개) */
  hasSearchExposure?: boolean;
  /** 실제 AI 인용 검증: Perplexity/Gemini 기준 해당 주제에서 인용되는 도메인 목록에 포함 */
  hasActualAiCitation?: boolean;
}

export interface PageFeatures {
  meta: AnalysisMeta;
  headings: string[];
  h1Count: number;
  pageQuestions: string[];
  seedKeywords: SeedKeyword[];
  questionCoverage: number;
  structureScore: number;
  hasFaqSchema: boolean;
  hasStructuredData: boolean;
  hasReviewSchema?: boolean;
  /** 쇼핑/상품 관련 JSON-LD (Product, ItemList, Offer) 존재 */
  hasProductSchema?: boolean;
  /** `<meta name="description">` content length (0 if missing) */
  descriptionLength: number;
  /** True when standard meta description tag is present */
  hasMetaDescription?: boolean;
  /** True when `<meta property="og:description">` is present */
  hasOgDescription?: boolean;
  /**
   * Length for description-length scoring: meta description if present, else og:description.
   * Used for desc_length_min / desc_length_range when meta is absent but OG exists.
   */
  effectiveDescriptionLength?: number;
  contentQuality: ContentQuality;
  trustSignals: TrustSignals;
  /**
   * Search-question ↔ body match (0–100). Used for editorial answerability quality gate only;
   * not an extraction change. Kept separate from questionCoverage (Tavily coverage %).
   */
  questionMatchScore?: number;
  /**
   * Lowercased text bundle (meta + headings + citation chunks) for editorial-only heuristic checks.
   * Does not affect commerce scoring math.
   */
  editorialHeuristicCorpus?: string;
}
