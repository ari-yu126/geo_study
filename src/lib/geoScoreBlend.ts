/**
 * Explicit monthly vs fixed backbone blend for editorial/web finalScore.
 * Monthly weights come from geo_scoring_config profiles; fixed weights mirror legacy engine logic.
 */
import type {
  GeoScoreBlendDebug,
  GeoScoringConfig,
  GeoScoringProfile,
  PageType,
} from './analysisTypes';
import { getProfileForPageType } from './scoringConfigLoader';

export const DEFAULT_SCORE_BLEND_ALPHA = 0.65;

export interface AxisScores7 {
  citation: number;
  paragraph: number;
  answerability: number;
  structure: number;
  trust: number;
  questionMatch: number;
  questionCoverage: number;
}

export interface AxisScores5 {
  paragraph: number;
  answerability: number;
  structure: number;
  trust: number;
  questionMatch: number;
}

export interface FinalBlendContext {
  pageType: PageType;
  hasCitationPath: boolean;
  maxChunkScore: number;
  isFaqLikePage: boolean;
  hasActualAiCitation: boolean;
  questionMatchScore: number;
}

/** Legacy engine weights (maxChunk, commerce branch, FAQ / question-match tweaks). */
export function computeEngineFixedWeights7(ctx: FinalBlendContext): AxisScores7 {
  let citationWeight = 0.45 + 0.2 * (ctx.maxChunkScore / 100);
  let structureWeight = 0.15 - 0.1 * (ctx.maxChunkScore / 100);
  let trustWeight = 0.15 - 0.1 * (ctx.maxChunkScore / 100);
  let paragraphWeight = 0.05;
  let questionMatchWeight = 0.05;
  let answerabilityWeight = 0.15;
  let questionCoverageWeight = 0.1;

  if (ctx.pageType === 'commerce') {
    citationWeight = 0.3 + 0.15 * (ctx.maxChunkScore / 100);
    structureWeight = 0.3;
    trustWeight = 0.2;
    paragraphWeight = 0.03;
    answerabilityWeight = 0.1;
    questionMatchWeight = 0.04;
    questionCoverageWeight = 0.03;
  }

  if (ctx.hasActualAiCitation && ctx.isFaqLikePage) {
    citationWeight = 0.4;
    paragraphWeight = 0.1;
    answerabilityWeight = 0.15;
    structureWeight = 0.05;
    trustWeight = 0.1;
    questionMatchWeight = 0.15;
    questionCoverageWeight = 0.1;
  } else if (ctx.isFaqLikePage || ctx.questionMatchScore >= 70) {
    questionMatchWeight = ctx.questionMatchScore >= 80 ? 0.2 : 0.15;
    structureWeight = Math.max(0.05, structureWeight - 0.05);
    trustWeight = Math.max(0.05, trustWeight - 0.05);
    if (questionMatchWeight >= 0.2) paragraphWeight = 0;
  }

  return {
    citation: citationWeight,
    paragraph: paragraphWeight,
    answerability: answerabilityWeight,
    structure: structureWeight,
    trust: trustWeight,
    questionMatch: questionMatchWeight,
    questionCoverage: questionCoverageWeight,
  };
}

/** Legacy engine weights when citation path is off (no citation score usable). */
export function computeEngineFixedWeights5(ctx: FinalBlendContext): AxisScores5 {
  let wP = 0.3;
  let wA = 0.25;
  let wS = 0.2;
  let wT = 0.2;
  let wQ = 0.05;

  if (ctx.pageType === 'commerce') {
    wP = 0.15;
    wA = 0.15;
    wS = 0.35;
    wT = 0.25;
    wQ = 0.05;
  }
  if (ctx.hasActualAiCitation && ctx.isFaqLikePage) {
    wP = 0.25;
    wA = 0.3;
    wS = 0.05;
    wT = 0.1;
    wQ = 0.3;
  } else if (ctx.isFaqLikePage || ctx.questionMatchScore >= 70) {
    wQ = ctx.questionMatchScore >= 80 ? 0.2 : 0.15;
    wP = 0.2;
    wS = 0.15;
    wT = 0.15;
  }

  return {
    paragraph: wP,
    answerability: wA,
    structure: wS,
    trust: wT,
    questionMatch: wQ,
  };
}

function normalize7(w: AxisScores7): AxisScores7 {
  const t =
    w.citation +
    w.paragraph +
    w.answerability +
    w.structure +
    w.trust +
    w.questionMatch +
    w.questionCoverage;
  if (t <= 0) return w;
  return {
    citation: w.citation / t,
    paragraph: w.paragraph / t,
    answerability: w.answerability / t,
    structure: w.structure / t,
    trust: w.trust / t,
    questionMatch: w.questionMatch / t,
    questionCoverage: w.questionCoverage / t,
  };
}

function normalize5(w: AxisScores5): AxisScores5 {
  const t = w.paragraph + w.answerability + w.structure + w.trust + w.questionMatch;
  if (t <= 0) return w;
  return {
    paragraph: w.paragraph / t,
    answerability: w.answerability / t,
    structure: w.structure / t,
    trust: w.trust / t,
    questionMatch: w.questionMatch / t,
  };
}

/**
 * Monthly weights from profile (static emphasis). Falls back to fixed weights if profile missing or sum ~0.
 */
export function computeMonthlyWeights7(
  profile: GeoScoringProfile | null,
  fixed7: AxisScores7
): AxisScores7 {
  const w = profile?.weights;
  if (!w) return normalize7({ ...fixed7 });

  const raw: AxisScores7 = {
    citation: w.citation ?? 0,
    paragraph: w.density ?? 0.05,
    answerability: w.answerability ?? 0,
    structure: w.structure ?? 0,
    trust: w.trust ?? 0,
    questionMatch: w.questionMatch ?? 0,
    questionCoverage: w.questionCoverage ?? 0,
  };
  const sum =
    raw.citation +
    raw.paragraph +
    raw.answerability +
    raw.structure +
    raw.trust +
    raw.questionMatch +
    raw.questionCoverage;
  if (sum < 1e-6) return normalize7({ ...fixed7 });
  return normalize7(raw);
}

/** No-citation path: drop citation & questionCoverage from monthly profile, renormalize. */
export function computeMonthlyWeights5(
  profile: GeoScoringProfile | null,
  fixed5: AxisScores5
): AxisScores5 {
  const w = profile?.weights;
  if (!w) return normalize5({ ...fixed5 });

  const raw: AxisScores5 = {
    paragraph: w.density ?? 0.05,
    answerability: w.answerability ?? 0,
    structure: w.structure ?? 0,
    trust: w.trust ?? 0,
    questionMatch: (w.questionMatch ?? 0) + (w.questionCoverage ?? 0) * 0.5,
  };
  const sum =
    raw.paragraph + raw.answerability + raw.structure + raw.trust + raw.questionMatch;
  if (sum < 1e-6) return normalize5({ ...fixed5 });
  return normalize5(raw);
}

export function scoreFromWeights7(axes: AxisScores7, nw: AxisScores7): number {
  const n = normalize7(nw);
  return Math.round(
    axes.citation * n.citation +
      axes.paragraph * n.paragraph +
      axes.answerability * n.answerability +
      axes.structure * n.structure +
      axes.trust * n.trust +
      axes.questionMatch * n.questionMatch +
      axes.questionCoverage * n.questionCoverage
  );
}

export function scoreFromWeights5(axes: AxisScores5, nw: AxisScores5): number {
  const n = normalize5(nw);
  return Math.round(
    axes.paragraph * n.paragraph +
      axes.answerability * n.answerability +
      axes.structure * n.structure +
      axes.trust * n.trust +
      axes.questionMatch * n.questionMatch
  );
}

export function resolveBlendAlpha(config: GeoScoringConfig): number {
  const a = config.scoreBlendAlpha;
  if (typeof a === 'number' && Number.isFinite(a)) {
    return Math.min(0.95, Math.max(0.05, a));
  }
  return DEFAULT_SCORE_BLEND_ALPHA;
}

export function blendMonthlyAndFixed(monthlyScore: number, fixedScore: number, alpha: number): number {
  return Math.round(alpha * monthlyScore + (1 - alpha) * fixedScore);
}

export function buildBlendDebug(params: {
  blendAlpha: number;
  monthlyScore: number;
  fixedScore: number;
  finalScoreBeforeCaps: number;
  finalScoreAfterCaps: number;
  finalScore: number;
  trustCapBand: 'none' | 'max_79' | 'max_70';
  commerceMonthlyScore?: number;
  commerceFixedScore?: number;
  commerceBlendedScore?: number;
}): GeoScoreBlendDebug {
  const a = params.blendAlpha;
  const mc = a * params.monthlyScore;
  const fc = (1 - a) * params.fixedScore;
  return {
    blendAlpha: a,
    monthlyScore: params.monthlyScore,
    fixedScore: params.fixedScore,
    monthlyContribution: Math.round(mc * 1000) / 1000,
    fixedContribution: Math.round(fc * 1000) / 1000,
    finalScoreBeforeCaps: params.finalScoreBeforeCaps,
    finalScoreAfterCaps: params.finalScoreAfterCaps,
    finalScore: params.finalScore,
    trustCapBand: params.trustCapBand,
    commerceMonthlyScore: params.commerceMonthlyScore,
    commerceFixedScore: params.commerceFixedScore,
    commerceBlendedScore: params.commerceBlendedScore,
  };
}

/** Resolve profile for scoring blend (editorial uses editorial, commerce uses commerce, default fallback). */
export function profileForScoreBlend(config: GeoScoringConfig, pageType: PageType): GeoScoringProfile | null {
  return getProfileForPageType(config, pageType) ?? getProfileForPageType(config, 'default');
}

const COMMERCE_FIXED_DD = 0.4;
const COMMERCE_FIXED_ST = 0.3;
const COMMERCE_FIXED_TR = 0.3;

/** Commerce final score: data density + structure + boosted trust (same signals as engine). */
export function computeCommerceFixedFinal(
  dataDensityQuality: number,
  structureScore: number,
  commerceTrust: number
): number {
  return Math.round(
    dataDensityQuality * COMMERCE_FIXED_DD +
      structureScore * COMMERCE_FIXED_ST +
      commerceTrust * COMMERCE_FIXED_TR
  );
}

export function computeCommerceMonthlyFinal(
  dataDensityQuality: number,
  structureScore: number,
  commerceTrust: number,
  commerceProfile: GeoScoringProfile | null
): number {
  const w = commerceProfile?.weights;
  const wd = w?.dataDensity ?? COMMERCE_FIXED_DD;
  const ws = w?.structure ?? COMMERCE_FIXED_ST;
  const wt = w?.trust ?? COMMERCE_FIXED_TR;
  const t = wd + ws + wt;
  if (t <= 1e-6) {
    return computeCommerceFixedFinal(dataDensityQuality, structureScore, commerceTrust);
  }
  return Math.round(
    dataDensityQuality * (wd / t) + structureScore * (ws / t) + commerceTrust * (wt / t)
  );
}
