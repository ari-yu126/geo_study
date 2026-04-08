/**
 * Post-review summary for editorialSubtype validation CSVs (evidence only — no rule changes).
 *
 * Usage:
 *   npx tsx scripts/summarize-editorial-subtype-validation.ts <path/to/reviewed.csv>
 *
 * Env:
 *   GEO_VALIDATE_SUMMARY_OUT_DIR — output directory (default tmp/editorial-subtype-validation)
 */

import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, resolve } from 'path';

/** RFC4180-style rows; handles quoted fields with commas */
function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  const len = content.length;

  const pushRow = () => {
    row.push(field);
    if (row.length > 1 || row[0] !== '' || field !== '') {
      rows.push(row);
    }
    row = [];
    field = '';
  };

  while (i < len) {
    const c = content[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < len && content[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\n') {
      pushRow();
      i++;
      continue;
    }
    if (c === '\r') {
      if (i + 1 < len && content[i + 1] === '\n') {
        pushRow();
        i += 2;
        continue;
      }
      pushRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '' || field !== '') {
    rows.push(row);
  }
  return rows;
}

const SUBTYPES = new Set(['blog', 'site_info', 'mixed']);

function normSubtype(s: string | undefined | null): string | null {
  if (s == null) return null;
  const t = s.trim().toLowerCase();
  if (!t) return null;
  if (SUBTYPES.has(t)) return t;
  return t;
}

interface RowObj {
  url: string;
  pageType: string;
  editorialSubtype: string | null;
  confidence: number | null;
  blogScore: number | null;
  siteInfoScore: number | null;
  reasons: string;
  manual_expected: string | null;
  manual_note: string;
  fp_or_fn: string;
  error: string;
}

function rowsToObjects(header: string[], cells: string[]): RowObj | null {
  const idx = (name: string) => header.indexOf(name);
  const get = (name: string) => {
    const i = idx(name);
    return i >= 0 && i < cells.length ? cells[i] ?? '' : '';
  };
  const conf = parseFloat(get('confidence'));
  const bs = parseInt(get('blogScore'), 10);
  const ss = parseInt(get('siteInfoScore'), 10);
  return {
    url: get('url').trim(),
    pageType: get('pageType').trim() || 'unknown',
    editorialSubtype: normSubtype(get('editorialSubtype')),
    confidence: Number.isFinite(conf) ? conf : null,
    blogScore: Number.isFinite(bs) ? bs : null,
    siteInfoScore: Number.isFinite(ss) ? ss : null,
    reasons: get('reasons'),
    manual_expected: normSubtype(get('manual_expected')),
    manual_note: get('manual_note'),
    fp_or_fn: get('fp_or_fn').trim().toLowerCase(),
    error: get('error'),
  };
}

function countMap<T extends string>(items: (T | null | undefined)[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const x of items) {
    const k = x ?? '(empty)';
    m[k] = (m[k] ?? 0) + 1;
  }
  return m;
}

function reasonTokens(reasons: string): string[] {
  if (!reasons.trim()) return [];
  return reasons
    .split(/\s*\|\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: npx tsx scripts/summarize-editorial-subtype-validation.ts <reviewed.csv>');
    process.exit(1);
  }

  const resolved = resolve(csvPath);
  const raw = readFileSync(resolved, 'utf8').replace(/^\uFEFF/, '');
  const table = parseCsv(raw);
  if (table.length < 2) {
    console.error('CSV has no data rows:', resolved);
    process.exit(1);
  }

  const header = table[0]!.map((h) => h.trim());
  const dataRows = table.slice(1);
  const objects: RowObj[] = [];
  for (const cells of dataRows) {
    const o = rowsToObjects(header, cells);
    if (o && o.url) objects.push(o);
  }

  const outDir = process.env.GEO_VALIDATE_SUMMARY_OUT_DIR
    ? resolve(process.env.GEO_VALIDATE_SUMMARY_OUT_DIR)
    : resolve(process.cwd(), 'tmp/editorial-subtype-validation');
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `summary-${basename(csvPath, '.csv')}-${stamp}`;

  const editorialOnly = objects.filter((o) => o.pageType === 'editorial');
  const labeled = objects.filter((o) => o.manual_expected != null);
  const labeledEditorial = editorialOnly.filter((o) => o.manual_expected != null);

  const predictedCounts = countMap(editorialOnly.map((o) => o.editorialSubtype as string));
  const manualCounts = countMap(labeledEditorial.map((o) => o.manual_expected as string));

  let match = 0;
  let mismatch = 0;
  const mismatches: RowObj[] = [];
  for (const o of labeledEditorial) {
    const p = o.editorialSubtype;
    const m = o.manual_expected;
    if (p === m) match++;
    else {
      mismatch++;
      mismatches.push(o);
    }
  }

  let fpCount = 0;
  let fnCount = 0;
  for (const o of objects) {
    const tags = o.fp_or_fn.split(/[\s,;]+/).filter(Boolean);
    if (tags.includes('fp')) fpCount++;
    if (tags.includes('fn')) fnCount++;
  }

  const reasonFreq: Record<string, number> = {};
  for (const o of mismatches) {
    for (const t of reasonTokens(o.reasons)) {
      reasonFreq[t] = (reasonFreq[t] ?? 0) + 1;
    }
  }
  const topReasons = Object.entries(reasonFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  const LOW_CONF = 0.45;
  const HIGH_CONF = 0.65;

  const lowConfidenceMixed = editorialOnly.filter(
    (o) => o.editorialSubtype === 'mixed' && o.confidence != null && o.confidence < LOW_CONF
  );

  const highConfMismatch = mismatches.filter(
    (o) => o.confidence != null && o.confidence >= HIGH_CONF
  );

  const lowConfCorrect = editorialOnly.filter(
    (o) =>
      o.manual_expected != null &&
      o.editorialSubtype === o.manual_expected &&
      o.confidence != null &&
      o.confidence < LOW_CONF
  );

  const blogToSite = mismatches.filter((o) => o.editorialSubtype === 'blog' && o.manual_expected === 'site_info');
  const siteToBlog = mismatches.filter((o) => o.editorialSubtype === 'site_info' && o.manual_expected === 'blog');

  const mixedPredicted = editorialOnly.filter((o) => o.editorialSubtype === 'mixed');

  const worthReview: (RowObj & { _why: string })[] = [];
  const seenUrl = new Set<string>();
  const hi = [...highConfMismatch].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  const loMix = [...lowConfidenceMixed].sort((a, b) => (a.confidence ?? 0) - (b.confidence ?? 0));
  for (const o of hi) {
    if (seenUrl.has(o.url)) continue;
    seenUrl.add(o.url);
    worthReview.push({ ...o, _why: 'high-confidence mismatch' });
    if (worthReview.length >= 15) break;
  }
  if (worthReview.length < 15) {
    for (const o of loMix) {
      if (o.manual_expected && o.editorialSubtype === o.manual_expected) continue;
      if (seenUrl.has(o.url)) continue;
      seenUrl.add(o.url);
      worthReview.push({ ...o, _why: 'low-confidence mixed prediction' });
      if (worthReview.length >= 15) break;
    }
  }

  const reportJson = {
    generatedAt: new Date().toISOString(),
    sourceCsv: resolved,
    totals: {
      rowsInFile: objects.length,
      editorialRows: editorialOnly.length,
      labeledRows: labeled.length,
      labeledEditorialRows: labeledEditorial.length,
    },
    predictedSubtypeCounts: predictedCounts,
    manualExpectedCounts: manualCounts,
    agreement: {
      match,
      mismatch,
      matchRate:
        labeledEditorial.length > 0 ? Math.round((match / labeledEditorial.length) * 1000) / 1000 : null,
    },
    fpFnColumn: { fp: fpCount, fn: fnCount },
    confusionPairs: {
      predicted_blog_manual_site_info: blogToSite.length,
      predicted_site_info_manual_blog: siteToBlog.length,
    },
    mixedPredictedCount: mixedPredicted.length,
    lowConfidenceMixedCount: lowConfidenceMixed.length,
    highConfidenceMismatchCount: highConfMismatch.length,
    lowConfidenceCorrectCount: lowConfCorrect.length,
    topReasonTokensOnMismatches: topReasons.map(([token, count]) => ({ token, count })),
    urlsWorthManualReview: worthReview.map((o) => ({
      url: o.url,
      predicted: o.editorialSubtype,
      manual: o.manual_expected,
      confidence: o.confidence,
      note: o._why,
    })),
    lists: {
      blogVsSiteInfoMismatches: {
        blogPredictedSiteInfoManual: blogToSite.map((o) => ({
          url: o.url,
          confidence: o.confidence,
          reasons: o.reasons,
        })),
        siteInfoPredictedBlogManual: siteToBlog.map((o) => ({
          url: o.url,
          confidence: o.confidence,
          reasons: o.reasons,
        })),
      },
      highConfidenceMismatches: highConfMismatch.map((o) => ({
        url: o.url,
        predicted: o.editorialSubtype,
        manual: o.manual_expected,
        confidence: o.confidence,
        fp_or_fn: o.fp_or_fn,
        reasons: o.reasons,
      })),
      lowConfidenceCorrect: lowConfCorrect.map((o) => ({
        url: o.url,
        subtype: o.editorialSubtype,
        confidence: o.confidence,
      })),
    },
  };

  const md: string[] = [];
  md.push(`# Editorial subtype validation summary`);
  md.push('');
  md.push(`- **Source:** \`${resolved}\``);
  md.push(`- **Generated:** ${reportJson.generatedAt}`);
  md.push('');
  md.push(`## Totals`);
  md.push('');
  md.push(`| Metric | Value |`);
  md.push(`|--------|-------|`);
  md.push(`| Rows in file | ${reportJson.totals.rowsInFile} |`);
  md.push(`| Editorial (predictable subtype) | ${reportJson.totals.editorialRows} |`);
  md.push(`| Rows with manual_expected filled | ${reportJson.totals.labeledRows} |`);
  md.push(`| Labeled editorial (for agreement) | ${reportJson.totals.labeledEditorialRows} |`);
  md.push('');
  md.push(`## Counts by predicted subtype (editorial rows)`);
  md.push('');
  md.push(`| Subtype | Count |`);
  md.push(`|---------|-------|`);
  for (const [k, v] of Object.entries(predictedCounts).sort((a, b) => b[1] - a[1])) {
    md.push(`| ${k} | ${v} |`);
  }
  md.push('');
  md.push(`## Counts by manual_expected (labeled editorial)`);
  md.push('');
  md.push(`| Subtype | Count |`);
  md.push(`|---------|-------|`);
  for (const [k, v] of Object.entries(manualCounts).sort((a, b) => b[1] - a[1])) {
    md.push(`| ${k} | ${v} |`);
  }
  md.push('');
  md.push(`## Agreement (labeled editorial only)`);
  md.push('');
  md.push(`- **Match:** ${match}`);
  md.push(`- **Mismatch:** ${mismatch}`);
  md.push(
    `- **Match rate:** ${reportJson.agreement.matchRate != null ? `${(reportJson.agreement.matchRate * 100).toFixed(1)}%` : 'n/a (no labeled editorial rows)'}`
  );
  md.push('');
  md.push(`## fp_or_fn column (optional labels)`);
  md.push('');
  md.push(`- **Rows tagged fp:** ${fpCount}`);
  md.push(`- **Rows tagged fn:** ${fnCount}`);
  md.push('');
  md.push(`## Confusion pairs (mismatches)`);
  md.push('');
  md.push(`- **Predicted blog · manual site_info:** ${blogToSite.length}`);
  md.push(`- **Predicted site_info · manual blog:** ${siteToBlog.length}`);
  md.push(`- **Predicted mixed (all editorial):** ${mixedPredicted.length}`);
  md.push('');
  md.push(`## Slices for tuning`);
  md.push('');
  md.push(`- **High-confidence mismatches** (confidence ≥ ${HIGH_CONF}): ${highConfMismatch.length}`);
  md.push(`- **Low-confidence mixed** (predicted mixed & confidence < ${LOW_CONF}): ${lowConfidenceMixed.length}`);
  md.push(`- **Low-confidence but agreed with manual** (correct & confidence < ${LOW_CONF}): ${lowConfCorrect.length}`);
  md.push('');
  md.push(`### Common reason tokens (mismatch rows only)`);
  md.push('');
  if (topReasons.length === 0) {
    md.push(`*(none — no mismatches or empty reasons)*`);
  } else {
    md.push(`| Token | Count |`);
    md.push(`|-------|-------|`);
    for (const [t, c] of topReasons) {
      md.push(`| ${t.replace(/\|/g, '\\|')} | ${c} |`);
    }
  }
  md.push('');
  md.push(`### URLs worth another look (priority)`);
  md.push('');
  md.push(`Blend of high-confidence mismatches and low-confidence mixed; capped at 15.`);
  md.push('');
  if (worthReview.length === 0) {
    md.push(`*(empty)*`);
  } else {
    md.push(`| URL | Predicted | Manual | Conf | Note |`);
    md.push(`|-----|-----------|--------|------|------|`);
    for (const o of worthReview) {
      md.push(
        `| ${o.url.replace(/\|/g, ' ')} | ${o.editorialSubtype ?? ''} | ${o.manual_expected ?? ''} | ${o.confidence ?? ''} | ${o._why} |`
      );
    }
  }
  md.push('');
  md.push(`---`);
  md.push(`*Evidence-only report — use to adjust heuristics in a follow-up change, not in this pipeline.*`);

  const jsonPath = resolve(outDir, `${base}.json`);
  const mdPath = resolve(outDir, `${base}.md`);
  writeFileSync(jsonPath, JSON.stringify(reportJson, null, 2), 'utf8');
  writeFileSync(mdPath, md.join('\n'), 'utf8');

  console.log('Written:', mdPath);
  console.log('Written:', jsonPath);
  console.log(
    `Labeled editorial: ${labeledEditorial.length} | match ${match} | mismatch ${mismatch} | high-conf mismatch ${highConfMismatch.length}`
  );
}

main();
