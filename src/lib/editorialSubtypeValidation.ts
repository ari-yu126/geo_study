/**
 * Validation-only helpers: export editorialSubtype rows for manual review (no scoring changes).
 */

import type { AnalysisMeta } from './analysisTypes';
import { extractMetaAndContent, fetchHtml } from './htmlAnalyzer';
import { loadActiveScoringConfig } from './scoringConfigLoader';
import { detectPageType } from './pageTypeDetection';
import { detectEditorialSubtype } from './editorialSubtype';

export interface EditorialSubtypeValidationRow {
  url: string;
  pageType: string;
  /** Only set when pageType === 'editorial' */
  editorialSubtype: string | null;
  confidence: number | null;
  blogScore: number | null;
  siteInfoScore: number | null;
  /** Machine reasons (same as editorialSubtypeDebug.reasons) */
  reasons: string[];
  /** Fetch / parse error message when row is incomplete */
  error?: string;
}

function escapeCsvField(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** One row per line, header first. Good for Sheets/Excel review. */
export function validationRowsToCsv(rows: EditorialSubtypeValidationRow[]): string {
  const header = [
    'url',
    'pageType',
    'editorialSubtype',
    'confidence',
    'blogScore',
    'siteInfoScore',
    'reasons',
    'manual_expected',
    'manual_note',
    'fp_or_fn',
    'error',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    const reasonsJoined = r.reasons.join(' | ');
    lines.push(
      [
        escapeCsvField(r.url),
        escapeCsvField(r.pageType),
        r.editorialSubtype ?? '',
        r.confidence != null ? String(r.confidence) : '',
        r.blogScore != null ? String(r.blogScore) : '',
        r.siteInfoScore != null ? String(r.siteInfoScore) : '',
        escapeCsvField(reasonsJoined),
        '', // manual_expected
        '', // manual_note
        '', // fp_or_fn
        escapeCsvField(r.error ?? ''),
      ].join(',')
    );
  }
  return lines.join('\n') + '\n';
}

export function validationRowsToJsonl(rows: EditorialSubtypeValidationRow[]): string {
  return rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
}

export interface ValidateEditorialSubtypeForUrlOptions {
  /** If set, HTML is fetched via `${appOrigin}/api/proxy?url=` (same as in-app analysis). */
  appOrigin?: string;
}

/**
 * Lightweight pipeline: fetch HTML → extract → pageType → editorialSubtype (editorial only).
 * Does not run Gemini or full GEO scoring.
 */
export async function validateEditorialSubtypeForUrl(
  url: string,
  options?: ValidateEditorialSubtypeForUrlOptions
): Promise<EditorialSubtypeValidationRow> {
  const trimmed = url.trim();
  if (!trimmed) {
    return {
      url: trimmed,
      pageType: 'error',
      editorialSubtype: null,
      confidence: null,
      blogScore: null,
      siteInfoScore: null,
      reasons: [],
      error: 'empty_url',
    };
  }

  try {
    const html = await fetchHtml(trimmed, options?.appOrigin);
    const extracted = extractMetaAndContent(html);
    const {
      meta,
      headings,
      contentQuality,
      trustSignals,
      hasProductSchema,
    } = extracted;

    const config = await loadActiveScoringConfig();
    const pageType = detectPageType(trimmed, config, {
      meta,
      headings,
      contentSnippet: extracted.contentText.slice(0, 20000),
      contentQuality,
      hasProductSchemaLegacy: hasProductSchema ?? false,
    });

    if (pageType !== 'editorial') {
      return {
        url: trimmed,
        pageType,
        editorialSubtype: null,
        confidence: null,
        blogScore: null,
        siteInfoScore: null,
        reasons: ['skipped: not editorial pageType'],
      };
    }

    const det = detectEditorialSubtype({
      url: trimmed,
      meta: meta as AnalysisMeta,
      headings,
      trustSignals,
      jsonLdTypesFound: contentQuality.jsonLdProductTypesFound ?? [],
    });

    return {
      url: trimmed,
      pageType,
      editorialSubtype: det.editorialSubtype,
      confidence: det.editorialSubtypeDebug.confidence,
      blogScore: det.editorialSubtypeDebug.blogScore,
      siteInfoScore: det.editorialSubtypeDebug.siteInfoScore,
      reasons: det.editorialSubtypeDebug.reasons,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      url: trimmed,
      pageType: 'error',
      editorialSubtype: null,
      confidence: null,
      blogScore: null,
      siteInfoScore: null,
      reasons: [],
      error: msg,
    };
  }
}
