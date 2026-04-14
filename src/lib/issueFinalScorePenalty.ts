/**
 * Post-blend finalScore adjustment from geoExplain issue severities.
 * Does not modify axis scores (citation, paragraph, …) — only the headline finalScore for UX alignment.
 */
import type { GeoIssue, GeoScores, IssuePenaltyDebug } from './analysisTypes';

/** Matches user-facing "critical/high" intent — codebase only has high | medium | low. */
const PENALTY_HIGH = 4;
const PENALTY_MEDIUM = 2;
const PENALTY_LOW = 1;
const PENALTY_CAP = 15;

export function computeIssueFinalScorePenalty(geoIssues: GeoIssue[]): {
  penaltyPoints: number;
  debug: IssuePenaltyDebug;
} {
  const counts = { high: 0, medium: 0, low: 0 };
  for (const g of geoIssues) {
    if (g.severity === 'high') counts.high += 1;
    else if (g.severity === 'medium') counts.medium += 1;
    else counts.low += 1;
  }
  const rawPenaltyPoints =
    counts.high * PENALTY_HIGH + counts.medium * PENALTY_MEDIUM + counts.low * PENALTY_LOW;
  const cappedPenaltyPoints = Math.min(PENALTY_CAP, rawPenaltyPoints);
  return {
    penaltyPoints: cappedPenaltyPoints,
    debug: {
      rawPenaltyPoints,
      cappedPenaltyPoints,
      cap: PENALTY_CAP,
      counts,
      pointsPerTier: {
        high: PENALTY_HIGH,
        medium: PENALTY_MEDIUM,
        low: PENALTY_LOW,
      },
    },
  };
}

/**
 * Mutates `scores.finalScore` only. Preserves axis scores and blend debug structure; updates `scoreBlendDebug.finalScore` when penalty is positive.
 * Always sets `preIssuePenaltyFinalScore` and `issuePenaltyPoints` so
 * `finalScore === clamp(preIssuePenaltyFinalScore - issuePenaltyPoints)` holds on all paths (web / video / commerce).
 */
export function applyIssueBasedFinalScorePenalty(scores: GeoScores, geoIssues: GeoIssue[]): void {
  const { penaltyPoints, debug } = computeIssueFinalScorePenalty(geoIssues);
  const pre = scores.finalScore;
  scores.preIssuePenaltyFinalScore = pre;
  scores.issuePenaltyPoints = penaltyPoints;
  scores.finalScore = Math.max(0, Math.min(100, pre - penaltyPoints));

  if (penaltyPoints > 0) {
    scores.issuePenaltyDebug = debug;
    if (scores.scoreBlendDebug) {
      scores.scoreBlendDebug = { ...scores.scoreBlendDebug, finalScore: scores.finalScore };
    }
  } else {
    delete scores.issuePenaltyDebug;
  }
}

/** Dev / script check: post-apply scores satisfy the clamp relation. */
export function verifyIssuePenaltyScoresInvariant(scores: GeoScores): boolean {
  const pre = scores.preIssuePenaltyFinalScore;
  const pts = scores.issuePenaltyPoints;
  if (pre === undefined || pts === undefined) return false;
  const expected = Math.max(0, Math.min(100, pre - pts));
  return scores.finalScore === expected;
}
