import type { AnalysisResult, GeoAxisScores, PageType } from '../analysisTypes';

/**
 * Build canonical axis scores from existing GeoScores + paragraph stats.
 * Same numeric source as scoring — downstream explain engines only read this.
 */
export function buildAxisScores(result: AnalysisResult): GeoAxisScores {
  const s = result.scores;
  const ps = result.paragraphStats;
  const densityRaw =
    typeof ps?.infoDensity === 'number'
      ? Math.round(Math.min(100, Math.max(0, ps.infoDensity * 100)))
      : typeof ps?.avgScore === 'number'
        ? Math.round(Math.min(100, Math.max(0, ps.avgScore)))
        : undefined;

  const pageType = (result.pageType as PageType | undefined) ?? 'editorial';
  const axis: GeoAxisScores = {
    citation: s.citationScore,
    paragraph: s.paragraphScore,
    answerability: s.answerabilityScore,
    structure: s.structureScore,
    trust: s.trustScore,
    questionMatch: s.questionMatchScore,
    questionCoverage: s.questionCoverage,
  };

  if (densityRaw !== undefined) {
    axis.density = densityRaw;
  }

  if (pageType === 'video') {
    axis.videoMetadata = Math.round(
      (s.paragraphScore + s.answerabilityScore + s.citationScore) / 3
    );
  }

  return axis;
}
