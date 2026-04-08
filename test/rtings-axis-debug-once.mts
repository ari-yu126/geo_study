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

process.env.GEO_SCORE_AXIS_DEBUG = '1';
process.env.GEO_SCORE_AXIS_URL = 'rtings';

const { runAnalysis } = await import('../src/lib/runAnalysis');

const url =
  process.argv[2] ??
  'https://www.rtings.com/headphones/reviews/samsung/galaxy-buds4-pro';

console.error('[rtings-axis-debug] analyzing', url);
await runAnalysis(url);
console.error('[rtings-axis-debug] done — see [GEO_SCORE_AXIS] above');
