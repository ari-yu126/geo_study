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
  const matchBoost = questionMatchScore * 0.2;
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

/** Why editorial citation used rule-based estimate instead of Gemini chunk scores */
export type EditorialCitationFallbackReason =
  | 'quota_skipped'
  | 'cooldown_skipped'
  | 'no_gemini_chunks'
  | 'extraction_incomplete'
  | 'combined';

export type EditorialCitationBand = 'weak' | 'medium' | 'strong';

export interface EditorialCitationFallbackInput {
  /** Page URL — comparison/review path heuristics */
  pageUrl?: string;
  questionCoverageScore: number;
  questionMatchScore: number;
  contentLength: number;
  hasActualAiCitation?: boolean;
  structureScore: number;
  answerabilityScore: number;
  paragraphScore: number;
  trustScore: number;
  maxChunkScore: number;
  extractionIncomplete: boolean;
  /** Paragraph-like nodes in DOM (not limited to top-3 analysis window) */
  paragraphLikeCount: number;
  rawBodyTextLength: number;
  editorialComparisonScore: number;
  reviewLikePage: boolean;
  geminiSkippedQuota: boolean;
}

export interface EditorialCitationFallbackResult {
  score: number;
  band: EditorialCitationBand;
  minBound: number;
  maxBound: number;
  reason: EditorialCitationFallbackReason;
  /** Normalized 0–1 quality used for banding */
  compositeQuality: number;
  inputs: EditorialCitationFallbackInput;
}

/**
 * Editorial citation estimate when Gemini chunk evaluation is unavailable or empty.
 * Strong pages (healthy extraction + comparison/review signals) recover toward high band;
 * thin pages stay low — never a single fixed number for all.
 */
export function estimateEditorialCitationScore(
  input: EditorialCitationFallbackInput
): EditorialCitationFallbackResult {
  const {
    questionCoverageScore: qCov,
    questionMatchScore: qMatch,
    contentLength,
    hasActualAiCitation,
    structureScore: sStr,
    answerabilityScore: aAns,
    paragraphScore: pPar,
    trustScore: tTrust,
    maxChunkScore,
    extractionIncomplete,
    paragraphLikeCount,
    rawBodyTextLength,
    editorialComparisonScore,
    reviewLikePage,
    geminiSkippedQuota,
  } = input;

  let reason: EditorialCitationFallbackReason;
  if (geminiSkippedQuota && extractionIncomplete) reason = 'combined';
  else if (geminiSkippedQuota) reason = 'quota_skipped';
  else if (extractionIncomplete) reason = 'extraction_incomplete';
  else reason = 'no_gemini_chunks';

  // Thin / unreliable extraction — cap band (do not inflate)
  const thinExtraction =
    extractionIncomplete ||
    paragraphLikeCount < 4 ||
    rawBodyTextLength < 3500 ||
    contentLength < 2500;

  const urlPath = input.pageUrl ?? '';
  const reviewSignals =
    editorialComparisonScore >= 4 ||
    reviewLikePage ||
    /\/(reviews?|best|top|ranking|compare|versus|vs)[\/-]/i.test(urlPath);

  // Composite 0–1 from available axes (Gemini maxChunkScore included when present)
  const norm = (x: number) => Math.max(0, Math.min(1, x / 100));
  const lenFactor = Math.max(0, Math.min(1, (Math.min(contentLength, 25000) - 1500) / 18500));
  const bodyFactor = Math.max(0, Math.min(1, (Math.min(rawBodyTextLength, 40000) - 2000) / 38000));
  const paraFactor = Math.max(0, Math.min(1, (paragraphLikeCount - 2) / 40));
  const compFactor = Math.max(0, Math.min(1, editorialComparisonScore / 10));
  const qFactor = (norm(qCov) * 0.55 + norm(qMatch) * 0.45);

  let composite =
    0.18 * norm(sStr) +
    0.14 * norm(aAns) +
    0.1 * norm(pPar) +
    0.08 * norm(tTrust) +
    0.14 * qFactor +
    0.1 * lenFactor +
    0.08 * bodyFactor +
    0.08 * paraFactor +
    0.06 * compFactor +
    (reviewLikePage ? 0.04 : 0) +
    (maxChunkScore > 0 ? 0.06 * norm(maxChunkScore) : 0);

  if (hasActualAiCitation) composite += 0.06;
  composite = Math.max(0, Math.min(1, composite));

  if (thinExtraction) {
    composite *= 0.52;
    if (paragraphLikeCount < 2) composite *= 0.75;
  }

  let band: EditorialCitationBand;
  let minBound: number;
  let maxBound: number;

  const strongEditorial =
    !thinExtraction &&
    qCov >= 55 &&
    qMatch >= 55 &&
    sStr >= 52 &&
    (reviewSignals || editorialComparisonScore >= 5);

  if (thinExtraction || composite < 0.38) {
    band = 'weak';
    minBound = 24;
    maxBound = 52;
  } else if (strongEditorial && composite >= 0.62) {
    band = 'strong';
    minBound = 58;
    maxBound = 84;
  } else if (composite >= 0.48) {
    band = 'medium';
    minBound = 40;
    maxBound = 72;
  } else {
    band = 'weak';
    minBound = 28;
    maxBound = 55;
  }

  // Map composite to score within band; quota recovery nudge only when extraction healthy
  let t = (composite - 0.25) / 0.65;
  t = Math.max(0, Math.min(1, t));
  let score = Math.round(minBound + t * (maxBound - minBound));

  if (geminiSkippedQuota && !thinExtraction && strongEditorial) {
    score = Math.min(maxBound, score + 6);
  }

  score = Math.max(minBound, Math.min(maxBound, score));

  // Hard safety: fallback never exceeds real-Gemini proxy ceiling
  const absoluteMax = thinExtraction ? 58 : 85;
  const absoluteMin = 22;
  score = Math.max(absoluteMin, Math.min(absoluteMax, score));

  return {
    score,
    band,
    minBound,
    maxBound,
    reason,
    compositeQuality: Math.round(composite * 1000) / 1000,
    inputs: input,
  };
}
