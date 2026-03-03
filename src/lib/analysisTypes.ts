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

export interface GeoScores {
  structureScore: number;
  answerabilityScore: number;
  trustScore: number;
  paragraphScore: number;
  citationScore: number;
  questionCoverage: number;
  finalScore: number;
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
}

export interface AnalysisResult {
  url: string;
  normalizedUrl: string;
  analyzedAt: string;
  meta: AnalysisMeta;
  seedKeywords: SeedKeyword[];
  pageQuestions: string[];
  searchQuestions: SearchQuestion[];
  searchQuestionCovered?: boolean[];
  questionClusters: QuestionCluster[];
  scores: GeoScores;
  contentQuality: ContentQuality;
  trustSignals: TrustSignals;
  paragraphStats: ParagraphStats;
  chunkCitations?: ChunkCitation[];
  recommendations?: GeoRecommendations;
  headings: string[];
  h1Count: number;
  hasFaqSchema: boolean;
  hasStructuredData: boolean;
  /** 유튜브 등 전용 파이프라인에서 미리 계산된 이슈 (있으면 deriveAuditIssues에서 규칙 기반 대신 사용) */
  auditIssues?: AuditIssue[];
  /** 유튜브 전용: Gemini가 생성한 '잘된 점' 정성 문장 (영상 정보 전달력 등) */
  youtubeSuccessFactor?: string;
}

export type AuditPriority = 'high' | 'medium' | 'low';

export interface FixExample {
  language: string;
  code: string;
}

export interface PassedCheck {
  id: string;
  label: string;
  reason: string;
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

  structureBaseScore: number;
  structureRules: ScoringRule[];

  weights: {
    structure: number;
    coverage: number;
  };

  answerabilityRules?: ScoringRule[];
  trustRules?: ScoringRule[];

  issueRules: IssueRule[];
  /** 유튜브 비디오 전용 PassedCheck 기준 — 월별 업데이트 대상 */
  youtubePassedCheckRules?: YouTubePassedCheckRule[];
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
  /** 쇼핑/상품 관련 JSON-LD (Product, ItemList, Offer) 존재 */
  hasProductSchema?: boolean;
  descriptionLength: number;
  contentQuality: ContentQuality;
  trustSignals: TrustSignals;
}
