/**
 * Lightweight primary locale for recommendation copy (ko vs en).
 * Uses Hangul density vs Latin letters on title + meta + snippet.
 */
export type PageLocale = 'ko' | 'en';

export function detectPageLocale(text: string): PageLocale {
  const sample = text.slice(0, 4000);
  let hangul = 0;
  let latin = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c >= 0xac00 && c <= 0xd7a3) hangul++;
    else if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) latin++;
  }
  if (hangul >= 8 && hangul >= latin * 0.25) return 'ko';
  if (hangul >= 3 && hangul > latin) return 'ko';
  return 'en';
}

export function buildLocaleSample(meta: {
  title: string | null;
  description: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
}, bodySnippet: string): string {
  return [
    meta.title ?? '',
    meta.ogTitle ?? '',
    meta.description ?? '',
    meta.ogDescription ?? '',
    bodySnippet ?? '',
  ]
    .join('\n')
    .trim();
}
