/**
 * Batch-evaluate GEO Analyzer on a CSV of real AI-cited URLs (validation / evidence only).
 *
 * Usage:
 *   npm run evaluate:geo-ai-citations -- path/to/dataset.csv
 *
 * Loads `.env.local` from the project root via npm script (tsx alone does not).
 *
 * Env:
 *   GEO_VALIDATE_APP_ORIGIN — proxy base (e.g. http://localhost:3232)
 *   GEO_AI_CITATION_DELAY_MS — pause between URLs (default 800)
 *   GEO_AI_CITATION_LOW_SCORE — flag low-score mismatches (default 45)
 *   GEO_AI_CITATION_OUT_DIR — output dir (default tmp/geo-ai-citation-validation)
 */

import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, resolve } from 'path';
import { runAnalysis } from '../src/lib/runAnalysis';
import { loadActiveScoringConfig } from '../src/lib/scoringConfigLoader';
import type { AnalysisResult, GeoAxisScores, PageType } from '../src/lib/analysisTypes';
import { parseCsv } from './csvParse';

interface InputRow {
  query: string;
  ai_system: string;
  cited_url: string;
  domain: string;
  date: string;
  notes: string;
}

interface EvalRow extends InputRow {
  finalScore: number | null;
  axisScores: GeoAxisScores | null;
  pageType: PageType | undefined;
  editorialSubtype: string | null;
  configVersion: string;
  analyzedAt: string | null;
  limitedAnalysis?: boolean;
  error?: string;
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

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: npm run evaluate:geo-ai-citations -- <dataset.csv>');
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
  const need = ['query', 'ai_system', 'cited_url', 'domain', 'date', 'notes'];
  for (const n of need) {
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
  const lowScore = parseFloat(process.env.GEO_AI_CITATION_LOW_SCORE ?? '45');
  const lowThreshold = Number.isFinite(lowScore) ? lowScore : 45;
  const outDir = process.env.GEO_AI_CITATION_OUT_DIR
    ? resolve(process.env.GEO_AI_CITATION_OUT_DIR)
    : resolve(process.cwd(), 'tmp/geo-ai-citation-validation');
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const appOrigin = process.env.GEO_VALIDATE_APP_ORIGIN?.trim() || undefined;

  const config = await loadActiveScoringConfig();
  const configVersion = config.version ?? 'unknown';

  const results: EvalRow[] = [];

  for (let i = 0; i < dataLines.length; i++) {
    const cells = dataLines[i]!;
    const get = (name: string) => {
      const j = idx(name);
      return j >= 0 && j < cells.length ? String(cells[j] ?? '').trim() : '';
    };
    const cited_url = get('cited_url');
    const domain = get('domain') || hostFromUrl(cited_url);
    const input: InputRow = {
      query: get('query'),
      ai_system: get('ai_system'),
      cited_url,
      domain,
      date: get('date'),
      notes: get('notes'),
    };

    process.stdout.write(`[${i + 1}/${dataLines.length}] ${cited_url.slice(0, 80)}...\n`);

    if (!cited_url) {
      results.push({
        ...input,
        finalScore: null,
        axisScores: null,
        pageType: undefined,
        editorialSubtype: null,
        configVersion,
        analyzedAt: null,
        error: 'empty cited_url',
      });
      continue;
    }

    try {
      const result: AnalysisResult = await runAnalysis(cited_url, { appOrigin });
      results.push({
        ...input,
        finalScore: result.scores.finalScore,
        axisScores: result.axisScores ?? null,
        pageType: result.pageType,
        editorialSubtype: result.editorialSubtype ?? null,
        configVersion,
        analyzedAt: result.analyzedAt,
        limitedAnalysis: result.limitedAnalysis,
      });
    } catch (e) {
      results.push({
        ...input,
        finalScore: null,
        axisScores: null,
        pageType: undefined,
        editorialSubtype: null,
        configVersion,
        analyzedAt: null,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    if (i < dataLines.length - 1 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  const jsonlPath = resolve(outDir, `results-${basename(csvPath, '.csv')}-${stamp}.jsonl`);
  writeFileSync(jsonlPath, results.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

  const ok = results.filter((r) => r.error == null && r.finalScore != null);
  const scores = ok.map((r) => r.finalScore!);
  const avgScore = mean(scores);
  const med = median(scores);

  const byPageType: Record<string, { count: number; scores: number[] }> = {};
  for (const r of ok) {
    const pt = r.pageType ?? 'unknown';
    if (!byPageType[pt]) byPageType[pt] = { count: 0, scores: [] };
    byPageType[pt]!.count++;
    byPageType[pt]!.scores.push(r.finalScore!);
  }

  const axisKeys = new Set<string>();
  for (const r of ok) {
    const ax = r.axisScores;
    if (!ax) continue;
    for (const k of Object.keys(ax) as (keyof GeoAxisScores)[]) {
      const v = ax[k];
      if (typeof v === 'number') axisKeys.add(k as string);
    }
  }
  const axisMeans: Record<string, number> = {};
  const axisWeakCount: Record<string, number> = {};
  const axisStrongCount: Record<string, number> = {};
  for (const k of axisKeys) {
    axisMeans[k] = 0;
    axisWeakCount[k] = 0;
    axisStrongCount[k] = 0;
  }
  for (const r of ok) {
    const ax = r.axisScores;
    if (!ax) continue;
    for (const k of axisKeys) {
      const v = ax[k as keyof GeoAxisScores];
      if (typeof v !== 'number') continue;
      axisMeans[k] += v;
      if (v < 40) axisWeakCount[k]++;
      if (v >= 70) axisStrongCount[k]++;
    }
  }
  const nAx = ok.length;
  for (const k of axisKeys) {
    axisMeans[k] = nAx ? axisMeans[k] / nAx : 0;
  }

  const lowMismatch = ok.filter((r) => r.finalScore! < lowThreshold);
  const sortedWeakAxes = Object.entries(axisWeakCount)
    .sort((a, b) => b[1] - a[1])
    .filter(([, c]) => c > 0);
  const sortedStrongAxes = Object.entries(axisStrongCount)
    .sort((a, b) => b[1] - a[1])
    .filter(([, c]) => c > 0);
  const sortedAxisMeans = Object.entries(axisMeans).sort((a, b) => a[1] - b[1]);

  const md: string[] = [];
  md.push(`# GEO AI-citation validation summary`);
  md.push('');
  md.push(`- **Dataset:** \`${resolved}\``);
  md.push(`- **Config version:** ${configVersion}`);
  md.push(`- **Rows analyzed:** ${ok.length} / ${results.length} (errors: ${results.length - ok.length})`);
  md.push(`- **Low-score threshold:** ${lowThreshold} (finalScore)`);
  md.push('');
  md.push(`## Overall GEO score (finalScore)`);
  md.push('');
  md.push(`- **Mean:** ${avgScore.toFixed(2)}`);
  md.push(`- **Median:** ${med != null ? med.toFixed(2) : 'n/a'}`);
  md.push('');
  md.push(`## By pageType`);
  md.push('');
  md.push(`| pageType | n | avg finalScore |`);
  md.push(`|----------|---|----------------|`);
  for (const [pt, { count, scores: sc }] of Object.entries(byPageType).sort((a, b) => a[0].localeCompare(b[0]))) {
    md.push(`| ${pt} | ${count} | ${mean(sc).toFixed(2)} |`);
  }
  md.push('');
  md.push(`## Axis means (across successful runs)`);
  md.push('');
  md.push(`| Axis | Mean |`);
  md.push(`|------|------|`);
  for (const [k, v] of sortedAxisMeans) {
    md.push(`| ${k} | ${v.toFixed(1)} |`);
  }
  md.push('');
  md.push(`## Often weak (axis < 40) — count of pages`);
  md.push('');
  if (sortedWeakAxes.length === 0) md.push(`*(none)*`);
  else {
    md.push(`| Axis | Count |`);
    md.push(`|------|-------|`);
    for (const [k, c] of sortedWeakAxes) {
      md.push(`| ${k} | ${c} |`);
    }
  }
  md.push('');
  md.push(`## Often strong (axis ≥ 70) — count of pages`);
  md.push('');
  if (sortedStrongAxes.length === 0) md.push(`*(none)*`);
  else {
    md.push(`| Axis | Count |`);
    md.push(`|------|-------|`);
    for (const [k, c] of sortedStrongAxes) {
      md.push(`| ${k} | ${c} |`);
    }
  }
  md.push('');
  md.push(`## Mismatch: AI-cited but low GEO score (finalScore < ${lowThreshold})`);
  md.push('');
  if (lowMismatch.length === 0) {
    md.push(`*(none in this run)*`);
  } else {
    md.push(`| cited_url | finalScore | pageType | editorialSubtype | query |`);
    md.push(`|-----------|------------|----------|------------------|-------|`);
    for (const r of lowMismatch.sort((a, b) => (a.finalScore ?? 0) - (b.finalScore ?? 0))) {
      md.push(
        `| ${r.cited_url.replace(/\|/g, ' ')} | ${r.finalScore} | ${r.pageType ?? ''} | ${r.editorialSubtype ?? ''} | ${(r.query || '').slice(0, 40).replace(/\|/g, ' ')} |`
      );
    }
  }
  md.push('');
  md.push(`## Raw results`);
  md.push('');
  md.push(`JSONL: \`${jsonlPath}\``);

  const mdPath = resolve(outDir, `summary-${basename(csvPath, '.csv')}-${stamp}.md`);
  writeFileSync(mdPath, md.join('\n'), 'utf8');

  console.log('Written:', jsonlPath);
  console.log('Written:', mdPath);
  console.log(`Mean finalScore: ${avgScore.toFixed(2)} | Low-score rows (<${lowThreshold}): ${lowMismatch.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
