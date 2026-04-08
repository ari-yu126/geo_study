/**
 * Post-blend quality layer for editorial pages (TEMP tuning).
 * Does not replace GEO config or issue rules — applied after base finalScore.
 */

import type { PlatformType } from './analysisTypes';

export interface QualityAdjustmentInput {
  contentLength: number;
  quotableSentenceCount: number;
  listCount: number;
  /** Main body text for lightweight promotional-language detection */
  contentText: string;
  answerabilityScore: number;
  repetitiveRatio?: number;
  /** When `naver_blog`, skip list+length structure boost (platform lists are noisy). */
  platform?: PlatformType;
}

export interface QualityAdjustmentResult {
  /** Clamped to [-20, 20], added to finalScore before 0–100 clamp */
  adjustment: number;
  /** Sum of penalty steps (≤ 0) */
  penalty: number;
  /** Sum of boost steps (≥ 0) */
  boost: number;
  /** Same as `adjustment` after clamp */
  finalAdjustment: number;
}

const CLAMP_MIN = -20;
const CLAMP_MAX = 20;

const PROMOTIONAL_KEYWORDS = [
  '추천',
  '강추',
  '만족',
  '좋아요',
  '너무 좋',
  '최고',
  '완전 추천',
];

/** Count total regex matches across keywords (case-insensitive). */
export function countKeywordMatches(text: string, keywords: string[]): number {
  if (!text || keywords.length === 0) return 0;
  let count = 0;
  for (const keyword of keywords) {
    if (!keyword) continue;
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'gi');
    const matches = text.match(re);
    if (matches) count += matches.length;
  }
  return count;
}

export function computeQualityAdjustment(input: QualityAdjustmentInput): QualityAdjustmentResult {
  let penalty = 0;
  let boost = 0;

  const {
    contentLength,
    quotableSentenceCount,
    listCount,
    contentText,
    answerabilityScore,
    repetitiveRatio = 0,
    platform,
  } = input;

  // Short + weak content
  if (contentLength < 1200 && answerabilityScore < 60) {
    penalty -= 8;
  }

  // Long but repetitive (thin / padded)
  if (contentLength > 2000 && repetitiveRatio > 0.4) {
    penalty -= 8;
  }

  // No extractable quotable facts at all
  if (quotableSentenceCount === 0) {
    penalty -= 3;
  }

  const promoCount = countKeywordMatches(contentText, PROMOTIONAL_KEYWORDS);
  if (promoCount >= 5 && quotableSentenceCount < 3) {
    penalty -= 10;
  }

  // Structure boost (skip for Naver Blog — list signals are not a reliable quality proxy)
  if (platform !== 'naver_blog' && contentLength >= 1500 && listCount >= 2) {
    boost += 4;
  }

  // Strong answerability + structure (informational-friendly)
  if (listCount >= 2 && answerabilityScore >= 70) {
    boost += 4;
  }

  const raw = penalty + boost;
  const adjustment = Math.max(CLAMP_MIN, Math.min(CLAMP_MAX, raw));

  return {
    adjustment,
    penalty,
    boost,
    finalAdjustment: adjustment,
  };
}
