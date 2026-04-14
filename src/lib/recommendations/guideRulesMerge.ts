import type {
  GeoRecommendationTraceEntry,
  GeoRecommendations,
  GuideGenerationDebug,
  GuideRule,
  PageType,
} from '../analysisTypes';
import { MAX_PRIORITY_ACTIONS } from './rules/axisRules';

const GUIDE_MERGE_DEBUG = process.env.GEO_GUIDE_MERGE_DEBUG === '1';

function guideMergeDbg(...args: unknown[]): void {
  if (GUIDE_MERGE_DEBUG) console.log('[guideMerge]', ...args);
}

/** Resolve trigger issue ids for a rule (arrays, single string, alternate JSON keys). */
export function guideRuleBasedOnRefs(gr: GuideRule): string[] {
  const r = gr as GuideRule & Record<string, unknown>;
  const alt = r.triggers ?? r.trigger_issues ?? r.issue_ids ?? r.issueIds;
  const normalizeList = (v: unknown): string[] => {
    if (typeof v === 'string' && v.trim()) return [v.trim()];
    if (!Array.isArray(v) || v.length === 0) return [];
    return v.map((x) => String(x).trim()).filter(Boolean);
  };
  const fromCamel = normalizeList(r.basedOn);
  if (fromCamel.length) return fromCamel;
  const fromSnake = normalizeList(r.based_on);
  if (fromSnake.length) return fromSnake;
  return normalizeList(alt);
}

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

/** Per matched rule: message then priorityNotes (ordered dedupe). */
function buildConfigNotesFromRules(sorted: GuideRule[]): string[] {
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

function collectConfigHeadingsFromRules(sorted: GuideRule[]): string[] {
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

function hasRenderableGuideContent(sorted: GuideRule[]): boolean {
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
    sources: [`guide:${g.id}`, ...guideRuleBasedOnRefs(g).map((b) => `ref:${String(b).trim()}`)],
  }));
  return base.trace
    ? { ...base.trace, entries: [...base.trace.entries, ...extraTrace] }
    : base.trace;
}

/**
 * Merge monthly `guideRules` from `resolveGuideRulesForPageType` (default ∪ page profile) when `basedOn` hits issue or passed ids.
 * All page types: config-first for priorityNotes (message + priorityNotes), suggestedHeadings, suggestedBlocks;
 * engine output fills remaining slots (deduped, capped). Category-specific copy lives in config per profile
 * (editorial / commerce / video / default), not in this merge layer.
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
  const engineNotes = base.actionPlan.priorityNotes ?? [];
  const engineHeadings = base.actionPlan.suggestedHeadings ?? [];
  const engineBlocks = base.actionPlan.suggestedBlocks ?? [];

  guideMergeDbg('merge enter', {
    pageType: params.pageType,
    guideRuleCount: rules?.length ?? 0,
    guideRuleIds: (rules ?? []).map((r) => r.id),
    rulesTriggerDetail: (rules ?? []).map((r) => ({
      id: r.id,
      refsResolved: guideRuleBasedOnRefs(r),
      rawBasedOn: r.basedOn,
      rawBased_on: r.based_on,
    })),
    issueIdSet: [...params.issueIdSet],
    passedIdSet: [...params.passedIdSet],
  });

  if (!rules?.length) {
    guideMergeDbg('merge exit: no guideRules');
    return {
      ...base,
      guideGenerationDebug: { source: 'fallback', matchedRuleIds: [], appliedFields: { ...EMPTY_APPLIED } },
    };
  }

  const matched: GuideRule[] = [];
  for (const gr of rules) {
    const refs = guideRuleBasedOnRefs(gr);
    const normalizedId = String(gr.id ?? '').trim();
    if (!refs.length) {
      guideMergeDbg('rule skip: empty basedOn refs', {
        ruleId: normalizedId,
        refsResolved: refs,
      });
      continue;
    }
    const hits = refs.map((raw) => {
      const id = String(raw).trim();
      const fromIssue = params.issueIdSet.has(id);
      const fromPassed = params.passedIdSet.has(id);
      return { id, fromIssue, fromPassed, hit: fromIssue || fromPassed };
    });
    const hit = hits.some((h) => h.hit);
    guideMergeDbg('rule basedOn', {
      ruleId: normalizedId,
      normalizedBasedOnRefs: refs,
      hitsIssueOrPassed: hits,
      anyHit: hit,
    });
    if (hit) matched.push(gr);
  }

  guideMergeDbg('MATCHED RULES:', matched);

  if (matched.length === 0) {
    guideMergeDbg('merge exit: no basedOn match', {
      finalMatchedGuideRuleIds: [] as string[],
    });
    return {
      ...base,
      guideGenerationDebug: { source: 'fallback', matchedRuleIds: [], appliedFields: { ...EMPTY_APPLIED } },
    };
  }

  const sorted = sortMatchedGuides(matched);
  guideMergeDbg(
    'HAS CONTENT CHECK:',
    sorted.map((g) => ({
      id: g.id,
      hasHeadings: !!g.suggestedHeadings?.length,
      hasBlocks: !!g.suggestedBlocks?.length,
      hasNotes: !!g.priorityNotes?.length,
    }))
  );
  guideMergeDbg('merge matched', {
    finalMatchedGuideRuleIds: sorted.map((g) => g.id),
  });
  const snapshots = matchedSnapshots(sorted);
  const trace = appendGuideTrace(base, sorted);

  if (!hasRenderableGuideContent(sorted)) {
    guideMergeDbg('merge exit: matched but no renderable guide content', {
      finalMatchedGuideRuleIds: sorted.map((g) => g.id),
      guideGenerationDebugSource: 'fallback',
    });
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

  const configNotes = buildConfigNotesFromRules(sorted);
  const configHeadings = collectConfigHeadingsFromRules(sorted);
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

  guideMergeDbg('merge exit: ok', {
    finalMatchedGuideRuleIds: sorted.map((g) => g.id),
    guideGenerationDebugSource: source,
    appliedFields,
  });

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
