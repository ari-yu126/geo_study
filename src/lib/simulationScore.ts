import type { AnalysisResult, AuditIssue, GeoScores } from "./analysisTypes";
import { paragraphStatsToScore } from "./paragraphAnalyzer";

/**
 * issue.id -> (category, points) 매핑
 * DEFAULT_SCORING_CONFIG 기준. 이슈 해결 시 복구되는 배점
 */
const ISSUE_POINTS: Record<string, { category: "structure" | "answerability" | "trust"; points: number }> = {
  first_para: { category: "answerability", points: 14 },
  quotable: { category: "answerability", points: 14 },
  content_short: { category: "answerability", points: 10 },
  no_tables: { category: "answerability", points: 10 },
  no_lists: { category: "answerability", points: 6 },
  questions: { category: "answerability", points: 6 },
  title: { category: "structure", points: 12 },
  desc: { category: "structure", points: 10 },
  og: { category: "structure", points: 6 },
  canonical: { category: "structure", points: 6 },
  no_schema: { category: "structure", points: 8 },
  h2_few: { category: "structure", points: 8 },
  struct: { category: "structure", points: 8 },
  author: { category: "trust", points: 20 },
  pub_date: { category: "trust", points: 20 },
  contact: { category: "trust", points: 20 },
};

function clamp(v: number) {
  return Math.min(100, Math.max(0, v));
}

/**
 * 시뮬레이션 버튼 클릭 시 적용되는 3가지 가상 시나리오
 * 1. Data Density Boost: 기사 하단에 제원표 추가 가정 → dataDenseBlockCount +15
 * 2. Coverage Boost: 미답변 질문에 대한 요약 답변 섹션 추가 가정 → questionCoverage 100%
 * 3. Structure Repair: H1 중복/메타 설명 보강 완료 가정 → structureScore +20
 */
export function computeSimulatedScores(
  result: AnalysisResult,
  issues: AuditIssue[]
): GeoScores {
  const s = result.scores;

  // 1. Data Density Boost: dataDenseBlockCount +15 (최대치 근접)
  const boostedStats = {
    ...result.paragraphStats,
    dataDenseBlockCount: Math.min(17, (result.paragraphStats.dataDenseBlockCount ?? 0) + 15),
  };
  const paragraphScore = paragraphStatsToScore(boostedStats);

  // 2. Coverage Boost: questionCoverage 100%, answerability 만점 수준(90점)
  const questionCoverage = 100;
  const answerabilityScore = 90;

  // 3. Structure Repair: H1/메타 최적화 완료 +20
  let structureScore = clamp(s.structureScore + 20);
  let trustScore = s.trustScore;

  // trust 이슈 해결 시 가산 (구조/답변은 위 시나리오로 이미 반영)
  for (const issue of issues) {
    const mapping = ISSUE_POINTS[issue.id];
    if (mapping?.category === "trust") {
      trustScore = clamp(trustScore + mapping.points);
    }
  }

  // 인용 점수: 에이스 문단 + 데이터 밀도 갖추면 최상위권(85점) 가정
  const citationScore = s.citationScore ?? -1;
  const simulatedCitation = citationScore >= 0 ? Math.max(citationScore, 85) : citationScore;
  const hasCitation = simulatedCitation >= 0;

  const questionMatchScore = s.questionMatchScore ?? 0;
  let finalScore: number;
  if (hasCitation) {
    finalScore = Math.round(
      simulatedCitation * 0.45 +
        paragraphScore * 0.05 +
        answerabilityScore * 0.15 +
        structureScore * 0.15 +
        trustScore * 0.15 +
        questionMatchScore * 0.05
    );
  } else {
    finalScore = Math.round(
      paragraphScore * 0.30 +
        answerabilityScore * 0.25 +
        structureScore * 0.2 +
        trustScore * 0.20 +
        questionMatchScore * 0.05
    );
  }

  finalScore = clamp(finalScore);

  return {
    structureScore,
    answerabilityScore,
    trustScore,
    paragraphScore,
    citationScore: simulatedCitation,
    questionCoverage,
    questionMatchScore: 100, // Coverage Boost 시나리오: FAQ 추가로 질문 매칭 극대화
    finalScore,
  };
}
