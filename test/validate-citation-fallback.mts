/**
 * Validates editorial citation fallback calibration across page groups.
 * Run: npx tsx test/validate-citation-fallback.mts
 * Loads .env.local for API keys; temporarily sets GEO_HEADLESS_FETCH per case.
 */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

const { runAnalysis } = await import('../src/lib/runAnalysis');

type Row = {
  group: string;
  url: string;
  finalScore: number;
  citationScore: number;
  citationFallbackApplied: boolean;
  citationFallbackReason: string | null;
  citationFallbackEstimate: number | null;
  citationFallbackBand: string | null;
  extractionIncomplete: boolean;
  pageType?: string;
  extractionSource?: string;
};

const cases: { group: string; url: string; headless: 'default' | 'off' }[] = [
  {
    group: '1_strong_comparison_review (RTINGS-style)',
    url: 'https://www.rtings.com/headphones/reviews/samsung/galaxy-buds4-pro',
    headless: 'default',
  },
  {
    group: '2_normal_editorial (long doc / non-review)',
    url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Overview',
    headless: 'default',
  },
  {
    group: '3_thin_minimal_page (example.com)',
    url: 'https://www.example.com/',
    headless: 'default',
  },
  {
    group: '4_extraction_incomplete (RTINGS server-only, headless off)',
    url: 'https://www.rtings.com/headphones/reviews/samsung/galaxy-buds4-pro',
    headless: 'off',
  },
];

const rows: Row[] = [];

for (const c of cases) {
  const prevHeadless = process.env.GEO_HEADLESS_FETCH;
  if (c.headless === 'off') {
    process.env.GEO_HEADLESS_FETCH = '0';
  } else {
    delete process.env.GEO_HEADLESS_FETCH;
  }

  console.error(`\n--- Running: ${c.group} ---\n`);
  const result = await runAnalysis(c.url);
  const dbg = result.scores.citationFallbackDebug;
  rows.push({
    group: c.group,
    url: c.url,
    finalScore: result.scores.finalScore,
    citationScore: result.scores.citationScore,
    citationFallbackApplied: dbg?.applied ?? false,
    citationFallbackReason: dbg?.reason ?? null,
    citationFallbackEstimate: dbg?.estimate ?? null,
    citationFallbackBand: dbg?.band ?? null,
    extractionIncomplete: result.scores.extractionIncomplete ?? false,
    pageType: result.pageType,
    extractionSource: result.extractionSource,
  });

  if (prevHeadless !== undefined) process.env.GEO_HEADLESS_FETCH = prevHeadless;
  else delete process.env.GEO_HEADLESS_FETCH;
}

console.log('\n========== CITATION FALLBACK VALIDATION ==========\n');
console.table(
  rows.map((r) => ({
    group: r.group.replace(/\s+\(.+\)$/, ''),
    finalScore: r.finalScore,
    citationScore: r.citationScore,
    fallback: r.citationFallbackApplied,
    reason: r.citationFallbackReason ?? '—',
    estimate: r.citationFallbackEstimate ?? '—',
    band: r.citationFallbackBand ?? '—',
    extInc: r.extractionIncomplete,
    pageType: r.pageType ?? '—',
    src: r.extractionSource ?? '—',
  }))
);

console.log('\n--- Full rows (JSON) ---\n');
console.log(JSON.stringify(rows, null, 2));

console.log(`
Expected checks (manual):
- Group 1: strong review → mid/high citationScore when fallback applies (quota); band often strong/medium; extractionIncomplete false.
- Group 2: normal editorial → moderate fallback if quota; not inflated like RTINGS.
- Group 3: thin page → low citation estimate/band (weak); extractionIncomplete may be true.
- Group 4: server-only RTINGS → extractionIncomplete true; conservative band/estimate vs group 1.
`);
