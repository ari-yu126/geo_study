/**
 * 비디오 페이지에서 Gemini 미사용 시 citationScore 규칙 기반 추정.
 * 429/quota exceeded 시 video 점수 collapse 방지.
 */

export interface EstimateVideoCitationParams {
  questionCoverageScore: number;
  questionMatchScore: number;
  enhancedContentTextLength: number;
  hasActualAiCitation: boolean;
  hasSearchExposure: boolean;
}

function lengthBoost(len: number): number {
  if (len >= 800) return 10;
  if (len >= 400) return 6;
  if (len >= 200) return 3;
  return 0;
}

export function estimateVideoCitationScore(params: EstimateVideoCitationParams): number {
  const {
    questionCoverageScore,
    questionMatchScore,
    enhancedContentTextLength,
    hasActualAiCitation,
    hasSearchExposure,
  } = params;

  const base = 45;
  const coverageBoost = questionCoverageScore * 0.25;
  const matchBoost = questionMatchScore * 0.20;
  const lenBoost = lengthBoost(enhancedContentTextLength);
  const trustBoost = (hasSearchExposure ? 5 : 0) + (hasActualAiCitation ? 10 : 0);

  const raw = base + coverageBoost + matchBoost + lenBoost + trustBoost;
  const score = Math.round(Math.min(90, Math.max(0, raw)));

  console.log('[VIDEO FALLBACK]', {
    coverage: questionCoverageScore,
    match: questionMatchScore,
    len: enhancedContentTextLength,
    estimatedCitationScore: score,
  });

  return score;
}

/** Editorial 페이지용 규칙 기반 citationScore 추정 (coverage/match/text length) */
export function estimateEditorialCitationScore(params: {
  questionCoverageScore: number;
  questionMatchScore: number;
  contentLength: number;
  hasActualAiCitation?: boolean;
}): number {
  const { questionCoverageScore, questionMatchScore, contentLength, hasActualAiCitation } = params;
  const base = 40;
  const coverageBoost = questionCoverageScore * 0.2;
  const matchBoost = questionMatchScore * 0.25;
  const lenBoost = lengthBoost(contentLength);
  const trustBoost = hasActualAiCitation ? 15 : 0;
  const raw = base + coverageBoost + matchBoost + lenBoost + trustBoost;
  return Math.round(Math.min(90, Math.max(0, raw)));
}
