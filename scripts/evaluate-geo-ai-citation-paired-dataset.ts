/**
 * Paired GEO evaluation: same query row has AI-cited URL vs a chosen non-cited URL.
 * Research / validation only — does not change scoring.
 *
 * Usage:
 *   npm run evaluate:geo-ai-citations-paired -- path/to/paired-dataset.csv
 *
 * CSV columns: query, ai_system, cited_url, non_cited_url, domain, date, notes
 * (non_cited_url required per data row)
 *
 * Env: same as single-URL run (GEO_VALIDATE_APP_ORIGIN, GEO_AI_CITATION_DELAY_MS, GEO_AI_CITATION_OUT_DIR)
 */

import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, resolve } from 'path';
import { runAnalysis } from '../src/lib/runAnalysis';
import { loadActiveScoringConfig } from '../src/lib/scoringConfigLoader';
import type { AnalysisResult, GeoAxisScores, PageType } from '../src/lib/analysisTypes';
import { parseCsv } from './csvParse';

interface SideResult {
  finalScore: number | null;
  axisScores: GeoAxisScores | null;
  pageType: PageType | undefined;
  editorialSubtype: string | null;
  analyzedAt: string | null;
  limitedAnalysis?: boolean;
  error?: string;
}

interface PairedEvalRow {
  query: string;
  ai_system: string;
  cited_url: string;
  non_cited_url: string;
  domain: string;
  date: string;
  notes: string;
  configVersion: string;
  cited: SideResult;
  nonCited: SideResult;
  /** Per-axis cited − non_cited where both numeric */
  axisDelta?: Record<string, number>;
  finalScoreDelta?: number | null;
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function mean(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    num += dx * dy;
    sx += dx * dx;
    sy += dy * dy;
  }
  if (sx === 0 || sy === 0) return null;
  return num / Math.sqrt(sx * sy);
}

function collectAxisKeys(rows: SideResult[]): Set<string> {
  const keys = new Set<string>();
  for (const r of rows) {
    const ax = r.axisScores;
    if (!ax) continue;
    for (const k of Object.keys(ax) as (keyof GeoAxisScores)[]) {
      if (typeof ax[k] === 'number') keys.add(k as string);
    }
  }
  return keys;
}

async function analyzeSide(url: string, appOrigin: string | undefined): Promise<SideResult> {
  if (!url.trim()) {
    return {
      finalScore: null,
      axisScores: null,
      pageType: undefined,
      editorialSubtype: null,
      analyzedAt: null,
      error: 'empty url',
    };
  }
  try {
    const result: AnalysisResult = await runAnalysis(url, { appOrigin });
    return {
      finalScore: result.scores.finalScore,
      axisScores: result.axisScores ?? null,
      pageType: result.pageType,
      editorialSubtype: result.editorialSubtype ?? null,
      analyzedAt: result.analyzedAt,
      limitedAnalysis: result.limitedAnalysis,
    };
  } catch (e) {
    return {
      finalScore: null,
      axisScores: null,
      pageType: undefined,
      editorialSubtype: null,
      analyzedAt: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: npm run evaluate:geo-ai-citations-paired -- <paired-dataset.csv>');
    process.exit(1);
  }
  const resolved = resolve(csvPath);
  const raw = readFileSync(resolved, 'utf8').replace(/^\uFEFF/, '');
  const table = parseCsv(raw);
  if (table.length < 1) {
    console.error('Empty CSV');
    process.exit(1);
  }
  const header = table[0]!.map((h) => h.trim().replace(/^\uFEFF/, ''));
  const idx = (name: string) => header.indexOf(name);
  const required = ['query', 'ai_system', 'cited_url', 'non_cited_url', 'domain', 'date', 'notes'];
  for (const n of required) {
    if (idx(n) < 0) {
      console.error(`Missing column: ${n}`);
      process.exit(1);
    }
  }

  const dataLines = table
    .slice(1)
    .filter((cells) => {
      const first = (cells[0] ?? '').trim();
      return first && !first.startsWith('#');
    });

  if (dataLines.length === 0) {
    console.error('No data rows (add rows or remove # from lines)');
    process.exit(1);
  }

  const delayMs = Math.max(0, parseInt(process.env.GEO_AI_CITATION_DELAY_MS ?? '800', 10) || 800);
  const outDir = process.env.GEO_AI_CITATION_OUT_DIR
    ? resolve(process.env.GEO_AI_CITATION_OUT_DIR)
    : resolve(process.cwd(), 'tmp/geo-ai-citation-paired-validation');
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const appOrigin = process.env.GEO_VALIDATE_APP_ORIGIN?.trim() || undefined;

  const config = await loadActiveScoringConfig();
  const configVersion = config.version ?? 'unknown';

  const results: PairedEvalRow[] = [];

  for (let i = 0; i < dataLines.length; i++) {
    const cells = dataLines[i]!;
    const get = (name: string) => {
      const j = idx(name);
      return j >= 0 && j < cells.length ? String(cells[j] ?? '').trim() : '';
    };
    const cited_url = get('cited_url');
    const non_cited_url = get('non_cited_url');
    const domain = get('domain') || hostFromUrl(cited_url) || hostFromUrl(non_cited_url);

    const base = {
      query: get('query'),
      ai_system: get('ai_system'),
      cited_url,
      non_cited_url,
      domain,
      date: get('date'),
      notes: get('notes'),
      configVersion,
    };

    process.stdout.write(`[${i + 1}/${dataLines.length}] cited …\n`);

    if (!cited_url || !non_cited_url) {
      results.push({
        ...base,
        cited: {
          finalScore: null,
          axisScores: null,
          pageType: undefined,
          editorialSubtype: null,
          analyzedAt: null,
          error: !cited_url ? 'empty cited_url' : 'empty non_cited_url',
        },
        nonCited: {
          finalScore: null,
          axisScores: null,
          pageType: undefined,
          editorialSubtype: null,
          analyzedAt: null,
        },
      });
      if (i < dataLines.length - 1 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }

    const cited = await analyzeSide(cited_url, appOrigin);
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    process.stdout.write(`[${i + 1}/${dataLines.length}] non-cited …\n`);
    const nonCited = await analyzeSide(non_cited_url, appOrigin);

    const axisDelta: Record<string, number> = {};
    const keys = new Set([
      ...collectAxisKeys([cited, nonCited]),
    ]);
    for (const k of keys) {
      const a = cited.axisScores?.[k as keyof GeoAxisScores];
      const b = nonCited.axisScores?.[k as keyof GeoAxisScores];
      if (typeof a === 'number' && typeof b === 'number') {
        axisDelta[k] = a - b;
      }
    }
    let finalScoreDelta: number | null = null;
    if (cited.finalScore != null && nonCited.finalScore != null) {
      finalScoreDelta = cited.finalScore - nonCited.finalScore;
    }

    results.push({
      ...base,
      cited,
      nonCited,
      axisDelta,
      finalScoreDelta,
    });

    if (i < dataLines.length - 1 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  const jsonlPath = resolve(outDir, `paired-results-${basename(csvPath, '.csv')}-${stamp}.jsonl`);
  writeFileSync(jsonlPath, results.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

  const okPair = results.filter(
    (r) =>
      r.cited.error == null &&
      r.nonCited.error == null &&
      r.cited.finalScore != null &&
      r.nonCited.finalScore != null
  );

  const axisKeys = new Set([
    ...collectAxisKeys(okPair.map((r) => r.cited)),
    ...collectAxisKeys(okPair.map((r) => r.nonCited)),
  ]);

  const meanCited: Record<string, number> = {};
  const meanNon: Record<string, number> = {};
  const meanDelta: Record<string, number> = {};
  const stackedForCorr: Record<string, { x: number[]; y: number[] }> = {};

  for (const k of axisKeys) {
    meanCited[k] = 0;
    meanNon[k] = 0;
    meanDelta[k] = 0;
    stackedForCorr[k] = { x: [], y: [] };
  }

  for (const r of okPair) {
    const ca = r.cited.axisScores;
    const na = r.nonCited.axisScores;
    for (const k of axisKeys) {
      const cv = ca?.[k as keyof GeoAxisScores];
      const nv = na?.[k as keyof GeoAxisScores];
      if (typeof cv === 'number') {
        meanCited[k] += cv;
        stackedForCorr[k]!.x.push(cv);
        stackedForCorr[k]!.y.push(1);
      }
      if (typeof nv === 'number') {
        meanNon[k] += nv;
        stackedForCorr[k]!.x.push(nv);
        stackedForCorr[k]!.y.push(0);
      }
      if (typeof cv === 'number' && typeof nv === 'number') {
        meanDelta[k] += cv - nv;
      }
    }
  }

  const nPairs = okPair.length;
  for (const k of axisKeys) {
    let cc = 0;
    let nc = 0;
    let dc = 0;
    for (const r of okPair) {
      const ca = r.cited.axisScores;
      const na = r.nonCited.axisScores;
      const cv = ca?.[k as keyof GeoAxisScores];
      const nv = na?.[k as keyof GeoAxisScores];
      if (typeof cv === 'number') cc++;
      if (typeof nv === 'number') nc++;
      if (typeof cv === 'number' && typeof nv === 'number') dc++;
    }
    meanCited[k] = cc ? meanCited[k] / cc : 0;
    meanNon[k] = nc ? meanNon[k] / nc : 0;
    meanDelta[k] = dc ? meanDelta[k] / dc : 0;
  }

  const pearsonByAxis: Record<string, number | null> = {};
  for (const k of axisKeys) {
    const { x, y } = stackedForCorr[k]!;
    pearsonByAxis[k] = pearson(x, y);
  }

  const sortedDelta = Object.entries(meanDelta)
    .filter(([, d]) => Number.isFinite(d))
    .sort((a, b) => b[1] - a[1]);
  const sortedPearson = Object.entries(pearsonByAxis)
    .filter(([, r]) => r != null && Number.isFinite(r))
    .sort((a, b) => Math.abs(b[1]!) - Math.abs(a[1]!));

  const finalCited = okPair.map((r) => r.cited.finalScore!).filter((x) => typeof x === 'number');
  const finalNon = okPair.map((r) => r.nonCited.finalScore!).filter((x) => typeof x === 'number');
  const meanFinalCited = mean(finalCited);
  const meanFinalNon = mean(finalNon);
  const meanFinalDelta = nPairs ? mean(okPair.map((r) => r.finalScoreDelta!).filter((d) => d != null) as number[]) : 0;

  const stackFinalX: number[] = [];
  const stackFinalY: number[] = [];
  for (const r of okPair) {
    stackFinalX.push(r.cited.finalScore!);
    stackFinalY.push(1);
    stackFinalX.push(r.nonCited.finalScore!);
    stackFinalY.push(0);
  }
  const pearsonFinalScore = pearson(stackFinalX, stackFinalY);

  const md: string[] = [];
  md.push(`# GEO paired dataset: cited vs non-cited (same query rows)`);
  md.push('');
  md.push(`- **Dataset:** \`${resolved}\``);
  md.push(`- **Config version:** ${configVersion}`);
  md.push(`- **Complete pairs (both URLs analyzed, both finalScore present):** ${okPair.length} / ${results.length}`);
  md.push('');
  md.push(`## Interpretation`);
  md.push('');
  md.push(
    `- **Mean Δ (cited − non-cited)** summarizes within-row differences (paired design).`
  );
  md.push(
    `- **Pearson r (axis vs label)** uses stacked observations: cited URL = 1, non-cited = 0 (point-biserial-style alignment with “being the cited page” in this sample). Higher positive **r** ⇒ higher axis scores tend to co-occur with the cited side.`
  );
  md.push(`- This is **evidence / exploration**, not causal proof.`);
  md.push('');
  md.push(`## finalScore`);
  md.push('');
  md.push(`| Metric | Value |`);
  md.push(`|--------|-------|`);
  md.push(`| Mean cited | ${meanFinalCited.toFixed(2)} |`);
  md.push(`| Mean non-cited | ${meanFinalNon.toFixed(2)} |`);
  md.push(`| Mean Δ (cited − non-cited) | ${nPairs ? meanFinalDelta.toFixed(2) : 'n/a'} |`);
  md.push(
    `| Pearson r (finalScore ↔ cited=1, stacked) | ${pearsonFinalScore == null ? 'n/a' : pearsonFinalScore.toFixed(3)} |`
  );
  md.push('');
  md.push(`## Axis means`);
  md.push('');
  md.push(`| Axis | Mean cited | Mean non-cited | Mean Δ (cited − non) | Pearson r (axis ↔ cited=1) |`);
  md.push(`|------|------------|----------------|----------------------|----------------------------|`);
  const axisOrder = [...axisKeys].sort((a, b) => a.localeCompare(b));
  for (const k of axisOrder) {
    const r = pearsonByAxis[k];
    md.push(
      `| ${k} | ${meanCited[k]!.toFixed(2)} | ${meanNon[k]!.toFixed(2)} | ${meanDelta[k]!.toFixed(2)} | ${r == null ? 'n/a' : r.toFixed(3)} |`
    );
  }
  md.push('');
  md.push(`## Largest positive mean Δ (cited higher than non-cited)`);
  md.push('');
  md.push(`Sorted by mean Δ descending — axes that **most differentiate** cited vs chosen non-cited in this sample.`);
  md.push('');
  md.push(`| Axis | Mean Δ |`);
  md.push(`|------|--------|`);
  for (const [k, d] of sortedDelta.slice(0, 20)) {
    md.push(`| ${k} | ${d.toFixed(2)} |`);
  }
  md.push('');
  md.push(`## Strongest axis ↔ “cited” association (|Pearson r|)`);
  md.push('');
  md.push(`| Axis | Pearson r |`);
  md.push(`|------|-----------|`);
  for (const [k, r] of sortedPearson.slice(0, 20)) {
    md.push(`| ${k} | ${r!.toFixed(3)} |`);
  }
  md.push('');
  md.push(`## Raw results`);
  md.push('');
  md.push(`JSONL: \`${jsonlPath}\``);

  const mdPath = resolve(outDir, `paired-summary-${basename(csvPath, '.csv')}-${stamp}.md`);
  writeFileSync(mdPath, md.join('\n'), 'utf8');

  console.log('Written:', jsonlPath);
  console.log('Written:', mdPath);
  console.log(`Complete pairs: ${okPair.length} | Mean finalScore Δ: ${nPairs ? meanFinalDelta.toFixed(2) : 'n/a'}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
