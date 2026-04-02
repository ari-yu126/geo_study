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
export type LlmFeature = 'recommendations' | 'citations' | 'videoAnalysis' | 'geoConfigUpdate' | 'coverageVerify';
export interface LlmCallStatus {
  feature: LlmFeature;
  status: 'ok' | 'skipped_quota' | 'error';
  retryAfterSec?: number;
  /** 사용자 노출 메시지: rate-limit / quota-disabled 구분 */
  message?: string;
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
}

export interface AnalysisResult {
  url: string;
  normalizedUrl: string;
  analyzedAt: string;
  /** 페이지 타입 (editorial/video/commerce) — profiles[pageType] 선택용 */
  pageType?: PageType;
  /**
   * Editorial-only: article vs corporate/help-site context for explainability / recommendations tone.
   * Does not change scoring or top-level pageType.
   */
  editorialSubtype?: EditorialSubtype;
  editorialSubtypeDebug?: EditorialSubtypeDebug;
  meta: AnalysisMeta;
  seedKeywords: SeedKeyword[];
  pageQuestions: string[];
  searchQuestions: SearchQuestion[];
  searchQuestionCovered?: boolean[];
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
  check: string;
  threshold?: number;
  label: string;
  description: string;
  priority: AuditPriority;
  targetSelector: string;
  targetIndex: number;
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
}

export interface ContentQuality {
  contentLength: number;
  tableCount: number;
  listCount: number;
  h2Count: number;
  h3Count: number;
  imageCount: number;
  hasStepStructure: boolean;
  quotableSentenceCount: number;
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
  descriptionLength: number;
  contentQuality: ContentQuality;
  trustSignals: TrustSignals;
}
