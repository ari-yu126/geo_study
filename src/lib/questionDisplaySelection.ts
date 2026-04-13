import type {
  QuestionCoverageDebug,
  QuestionDisplayRules,
  SearchQuestion,
  SearchQuestionKind,
} from './analysisTypes';
import { classifySearchQuestionKind } from './searchQuestionClassification';

const DEFAULT_UNCOVERED_POOL = 6;
const DEFAULT_PREDICTED_CAP = 5;
const DEFAULT_TOP_GAP = 3;

type IndexedRow = {
  q: SearchQuestion;
  covered: boolean;
  idx: number;
  kind: SearchQuestionKind;
};

function scoreRow(row: IndexedRow, rules: QuestionDisplayRules): number {
  let s = 0;
  /** Prefer showing gaps (uncovered) first — not biased toward covered questions. */
  const prioritizeUncovered = rules.prioritizeUncovered !== false;
  if (!row.covered && prioritizeUncovered) s += 10_000;

  const pref = rules.preferredQuestionTypes ?? [];
  for (const p of pref) {
    if (p === row.kind) s += 500;
  }

  const dep = rules.deprioritizedQuestionTypes ?? [];
  for (const d of dep) {
    if (d === row.kind) s -= 400;
  }

  if (rules.prioritizeComparisonQuestions && row.kind === 'comparison') s += 300;

  const minLen = rules.minQuestionLength;
  if (minLen != null && row.q.text.trim().length < minLen) s -= 5_000;

  return s;
}

function sortRowsStable(rows: IndexedRow[], rules: QuestionDisplayRules): IndexedRow[] {
  return [...rows].sort((a, b) => {
    const ds = scoreRow(b, rules) - scoreRow(a, rules);
    if (ds !== 0) return ds;
    return a.idx - b.idx;
  });
}

/**
 * Rank / filter search questions for UI + recommendation gaps using profile `questionRules`.
 * Scoring inputs (`questionCoverage` ratio) must be computed on the full list before calling this.
 */
export function applyQuestionDisplaySelection(params: {
  searchQuestions: SearchQuestion[];
  searchQuestionCovered: boolean[];
  questionRules?: QuestionDisplayRules | null;
}): {
  searchQuestions: SearchQuestion[];
  searchQuestionCovered: boolean[];
  uncoveredOrderedForRecommendations: SearchQuestion[];
  debug?: QuestionCoverageDebug;
} {
  const { searchQuestions, searchQuestionCovered } = params;
  const rules = params.questionRules;

  if (!rules) {
    const uncoveredOrderedForRecommendations = searchQuestions.filter(
      (_, i) => !(searchQuestionCovered[i] ?? false)
    );
    return {
      searchQuestions: [...searchQuestions],
      searchQuestionCovered: [...searchQuestionCovered],
      uncoveredOrderedForRecommendations,
    };
  }

  const n = Math.min(searchQuestions.length, searchQuestionCovered.length);
  const rows: IndexedRow[] = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      q: searchQuestions[i],
      covered: searchQuestionCovered[i] ?? false,
      idx: i,
      kind: classifySearchQuestionKind(searchQuestions[i].text),
    });
  }

  const sorted = sortRowsStable(rows, rules);

  const maxDisplay = rules.maxDisplayQuestions;
  const displayRows =
    maxDisplay != null && maxDisplay >= 0 ? sorted.slice(0, maxDisplay) : sorted;

  const uncoveredSorted = sortRowsStable(
    sorted.filter((r) => !r.covered),
    rules
  );
  const uncoveredOrderedForRecommendations = uncoveredSorted.map((r) => r.q);

  const selectedQuestionTypes = displayRows.map((r) => r.kind);

  const debug: QuestionCoverageDebug = {
    source: 'config',
    selectedQuestionTypes,
    appliedRules: {
      maxDisplayQuestions: rules.maxDisplayQuestions,
      topGapCount: rules.topGapCount,
      preferredQuestionTypes: rules.preferredQuestionTypes,
    },
  };

  return {
    searchQuestions: displayRows.map((r) => r.q),
    searchQuestionCovered: displayRows.map((r) => r.covered),
    uncoveredOrderedForRecommendations,
    debug,
  };
}

export function poolLimitForPredictedQuestions(rules?: QuestionDisplayRules | null): number {
  if (!rules || rules.maxDisplayQuestions == null) return DEFAULT_UNCOVERED_POOL;
  return Math.max(0, rules.maxDisplayQuestions);
}

export function predictedQuestionCap(rules?: QuestionDisplayRules | null): number {
  if (!rules || rules.maxDisplayQuestions == null) return DEFAULT_PREDICTED_CAP;
  return Math.min(DEFAULT_PREDICTED_CAP, Math.max(0, rules.maxDisplayQuestions));
}

export function topGapCountFromRules(rules?: QuestionDisplayRules | null): number {
  if (!rules || rules.topGapCount == null) return DEFAULT_TOP_GAP;
  return Math.max(0, rules.topGapCount);
}
