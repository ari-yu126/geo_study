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
  questionCoverage: number;
  finalScore: number;
}

export interface AnalysisResult {
  url: string;
  normalizedUrl: string;
  meta: AnalysisMeta;
  seedKeywords: SeedKeyword[];
  pageQuestions: string[];
  searchQuestions: SearchQuestion[];
  questionClusters: QuestionCluster[];
  scores: GeoScores;
}
