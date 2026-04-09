import type {
  GeoRecommendationTraceEntry,
  GeoRecommendations,
  GuideGenerationDebug,
  GuideRule,
  PageType,
} from '../analysisTypes';
import { MAX_PRIORITY_ACTIONS } from './rules/axisRules';

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** Total cap after prepending config guides + engine fallback lines. */
const MAX_PRIORITY_NOTES_MERGED = Math.max(8, MAX_PRIORITY_ACTIONS + 5);
/** Match caps in buildGeoRecommendationsFromSignals */
const MAX_HEADINGS_MERGED = 14;
const MAX_BLOCKS_MERGED = 12;

type GuideAppliedFields = NonNullable<GuideGenerationDebug['appliedFields']>;

const EMPTY_APPLIED: GuideAppliedFields = {
  priorityNotes: false,
  suggestedHeadings: false,
  suggestedBlocks: false,
};

function sortMatchedGuides(rules: GuideRule[]): GuideRule[] {
  return [...rules].sort((a, b) => {
    const ra = PRIORITY_RANK[a.priority ?? 'medium'] ?? 1;
    const rb = PRIORITY_RANK[b.priority ?? 'medium'] ?? 1;
    return ra - rb;
  });
}

function uniqMergePriorityNotes(configLines: string[], engineLines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of [...configLines, ...engineLines]) {
    const k = x.trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(x.trim());
    if (out.length >= MAX_PRIORITY_NOTES_MERGED) break;
  }
  return out;
}

function resolveGuideSource(configLines: string[], engineLines: string[]): GuideGenerationDebug['source'] {
  if (configLines.length === 0) return 'fallback';
  const configSet = new Set(configLines);
  const engineHasExtra = engineLines.some((e) => !configSet.has(e.trim()));
  if (engineHasExtra) return 'mixed';
  return 'config';
}

/** Config strings first (deduped), then engine strings not already present, up to max. */
function mergePrimaryConfigThenEngine(configPrimary: string[], engineFallback: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of configPrimary) {
    const k = x.trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(x.trim());
    if (out.length >= max) return out;
  }
  for (const x of engineFallback) {
    const k = x.trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(x.trim());
    if (out.length >= max) break;
  }
  return out;
}

/** Ordered dedupe: per matched rule, message then priorityNotes. */
function buildEditorialConfigNotes(sorted: GuideRule[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of sorted) {
    const msg = g.message?.trim();
    if (msg && !seen.has(msg)) {
      seen.add(msg);
      out.push(msg);
    }
    for (const line of g.priorityNotes ?? []) {
      const t = line.trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

function collectEditorialConfigHeadings(sorted: GuideRule[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of sorted) {
    for (const h of g.suggestedHeadings ?? []) {
      const t = h.trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
      if (out.length >= MAX_HEADINGS_MERGED) return out;
    }
  }
  return out;
}

function collectEditorialConfigBlocks(sorted: GuideRule[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of sorted) {
    for (const b of g.suggestedBlocks ?? []) {
      const t = b.trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
      if (out.length >= MAX_BLOCKS_MERGED) return out;
    }
  }
  return out;
}

function editorialHasRenderableGuideContent(sorted: GuideRule[]): boolean {
  for (const g of sorted) {
    if (g.message?.trim()) return true;
    if (g.priorityNotes?.some((s) => s.trim())) return true;
    if (g.suggestedHeadings?.some((s) => s.trim())) return true;
    if (g.suggestedBlocks?.some((s) => s.trim())) return true;
  }
  return false;
}

function matchedSnapshots(sorted: GuideRule[]) {
  return sorted.map((g) => ({
    id: g.id,
    message: g.message?.trim() ?? '',
    priority: g.priority,
  }));
}

function appendGuideTrace(
  base: GeoRecommendations,
  sorted: GuideRule[]
): GeoRecommendations['trace'] {
  const extraTrace: GeoRecommendationTraceEntry[] = sorted.map((g) => ({
    target: 'guideRule' as const,
    sources: [`guide:${g.id}`, ...g.basedOn.map((b) => `ref:${b}`)],
  }));
  return base.trace
    ? { ...base.trace, entries: [...base.trace.entries, ...extraTrace] }
    : base.trace;
}

/**
 * Merge monthly `guideRules` when `basedOn` hits issue or passed ids.
 * Editorial: config supplies priorityNotes (message + optional arrays), suggestedHeadings, suggestedBlocks first; engine fills gaps.
 * Commerce / video: legacy — config `message` lines prepend priorityNotes only.
 */
export function mergeGuideRulesIntoRecommendations(
  base: GeoRecommendations,
  params: {
    guideRules?: GuideRule[] | null;
    issueIdSet: Set<string>;
    passedIdSet: Set<string>;
    pageType: PageType;
  }
): GeoRecommendations {
  const rules = params.guideRules;
  const pageType = params.pageType;
  /** Rich merge (config-primary headings/blocks/notes): editorial only (commerce/video/default unchanged). */
  const useEditorialRichMerge = pageType === 'editorial';
  const engineNotes = base.actionPlan.priorityNotes ?? [];
  const engineHeadings = base.actionPlan.suggestedHeadings ?? [];
  const engineBlocks = base.actionPlan.suggestedBlocks ?? [];

  if (!rules?.length) {
    return {
      ...base,
      guideGenerationDebug: { source: 'fallback', matchedRuleIds: [], appliedFields: { ...EMPTY_APPLIED } },
    };
  }

  const matched: GuideRule[] = [];
  for (const gr of rules) {
    if (!gr.basedOn?.length) continue;
    const hit = gr.basedOn.some(
      (id) => params.issueIdSet.has(id) || params.passedIdSet.has(id)
    );
    if (hit) matched.push(gr);
  }

  if (matched.length === 0) {
    return {
      ...base,
      guideGenerationDebug: { source: 'fallback', matchedRuleIds: [], appliedFields: { ...EMPTY_APPLIED } },
    };
  }

  const sorted = sortMatchedGuides(matched);
  const snapshots = matchedSnapshots(sorted);
  const trace = appendGuideTrace(base, sorted);

  if (!useEditorialRichMerge) {
    const configLines = sorted.map((g) => g.message.trim()).filter(Boolean);
    if (configLines.length === 0) {
      return {
        ...base,
        trace,
        guideGenerationDebug: {
          source: 'fallback',
          matchedRuleIds: sorted.map((g) => g.id),
          matchedGuideRules: snapshots,
          appliedFields: { ...EMPTY_APPLIED },
        },
      };
    }
    const mergedNotes = uniqMergePriorityNotes(configLines, engineNotes);
    const source = resolveGuideSource(configLines, engineNotes);
    return {
      ...base,
      actionPlan: {
        ...base.actionPlan,
        priorityNotes: mergedNotes.length > 0 ? mergedNotes : base.actionPlan.priorityNotes,
      },
      trace,
      guideGenerationDebug: {
        source,
        matchedRuleIds: sorted.map((g) => g.id),
        matchedGuideRules: snapshots,
        appliedFields: {
          priorityNotes: true,
          suggestedHeadings: false,
          suggestedBlocks: false,
        },
      },
    };
  }

  // Editorial: config-primary merge for notes, headings, blocks
  if (!editorialHasRenderableGuideContent(sorted)) {
    return {
      ...base,
      trace,
      guideGenerationDebug: {
        source: 'fallback',
        matchedRuleIds: sorted.map((g) => g.id),
        matchedGuideRules: snapshots,
        appliedFields: { ...EMPTY_APPLIED },
      },
    };
  }

  const configNotes = buildEditorialConfigNotes(sorted);
  const configHeadings = collectEditorialConfigHeadings(sorted);
  const configBlocks = collectEditorialConfigBlocks(sorted);

  const mergedNotes = uniqMergePriorityNotes(configNotes, engineNotes);
  const mergedHeadings = mergePrimaryConfigThenEngine(configHeadings, engineHeadings, MAX_HEADINGS_MERGED);
  const mergedBlocks = mergePrimaryConfigThenEngine(configBlocks, engineBlocks, MAX_BLOCKS_MERGED);

  const appliedFields: GuideAppliedFields = {
    priorityNotes: configNotes.length > 0,
    suggestedHeadings: configHeadings.length > 0,
    suggestedBlocks: configBlocks.length > 0,
  };

  const configNoteSet = new Set(configNotes);
  const configHeadingSet = new Set(configHeadings.map((s) => s.trim()));
  const configBlockSet = new Set(configBlocks.map((s) => s.trim()));

  const engineAppendedNotes = engineNotes.some((n) => !configNoteSet.has(n.trim()));
  const engineAppendedHeadings = engineHeadings.some((h) => !configHeadingSet.has(h.trim()));
  const engineAppendedBlocks = engineBlocks.some((b) => !configBlockSet.has(b.trim()));

  let source: GuideGenerationDebug['source'] = 'config';
  if (engineAppendedNotes || engineAppendedHeadings || engineAppendedBlocks) {
    source = 'mixed';
  }

  return {
    ...base,
    actionPlan: {
      ...base.actionPlan,
      suggestedHeadings: mergedHeadings,
      suggestedBlocks: mergedBlocks,
      priorityNotes: mergedNotes.length > 0 ? mergedNotes : undefined,
    },
    trace,
    guideGenerationDebug: {
      source,
      matchedRuleIds: sorted.map((g) => g.id),
      matchedGuideRules: snapshots,
      appliedFields,
    },
  };
}
