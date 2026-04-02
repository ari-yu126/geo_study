/**
 * Batch export editorialSubtype for manual validation (no scoring / rule changes).
 *
 * Usage:
 *   npx tsx scripts/validate-editorial-subtype.ts [path/to/urls.txt]
 *
 * Env:
 *   GEO_VALIDATE_APP_ORIGIN — e.g. http://localhost:3232 to fetch via /api/proxy (optional)
 *   GEO_VALIDATE_DELAY_MS — delay between URLs (default 400)
 *   GEO_VALIDATE_OUT_DIR — output directory (default tmp/editorial-subtype-validation)
 *
 * urls.txt: one URL per line; lines starting with # are ignored.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  validateEditorialSubtypeForUrl,
  validationRowsToCsv,
  validationRowsToJsonl,
  type EditorialSubtypeValidationRow,
} from '../src/lib/editorialSubtypeValidation';

const scriptDir = dirname(fileURLToPath(import.meta.url));

async function main() {
  const urlsPath = resolve(
    process.argv[2] ?? join(scriptDir, 'sample-urls-validation.txt')
  );
  const outDir = process.env.GEO_VALIDATE_OUT_DIR
    ? resolve(process.env.GEO_VALIDATE_OUT_DIR)
    : resolve(process.cwd(), 'tmp/editorial-subtype-validation');
  const delayMs = Math.max(0, parseInt(process.env.GEO_VALIDATE_DELAY_MS ?? '400', 10) || 400);
  const appOrigin = process.env.GEO_VALIDATE_APP_ORIGIN?.trim() || undefined;

  const raw = readFileSync(urlsPath, 'utf8');
  const urls = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  if (urls.length === 0) {
    console.error('No URLs in file:', urlsPath);
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `validation-${stamp}`;

  console.log('URLs:', urls.length);
  console.log('Source:', urlsPath);
  console.log('Out dir:', outDir);
  if (appOrigin) console.log('Proxy:', appOrigin);
  console.log('---');

  const rows: EditorialSubtypeValidationRow[] = [];
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    process.stdout.write(`[${i + 1}/${urls.length}] ${u.slice(0, 72)}...\n`);
    const row = await validateEditorialSubtypeForUrl(u, { appOrigin });
    rows.push(row);
    if (row.error) console.warn('  error:', row.error);
    if (i < urls.length - 1 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  const csvPath = join(outDir, `${base}.csv`);
  const jsonlPath = join(outDir, `${base}.jsonl`);
  writeFileSync(csvPath, validationRowsToCsv(rows), 'utf8');
  writeFileSync(jsonlPath, validationRowsToJsonl(rows), 'utf8');

  const errors = rows.filter((r) => r.error);
  const editorial = rows.filter((r) => r.pageType === 'editorial');
  console.log('---');
  console.log('Written:', csvPath);
  console.log('Written:', jsonlPath);
  console.log('Stats: editorial rows', editorial.length, '/', rows.length, '| fetch errors', errors.length);
  console.log('Next: fill manual_expected / manual_note / fp_or_fn in CSV, then summarize patterns.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
