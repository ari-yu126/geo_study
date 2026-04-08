const MIN_USEFUL_CHARS = 120;
const MAX_SNIPPET = 4500;
const FETCH_TIMEOUT_MS = 14_000;

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetches a URL and returns plain text suitable for Gemini context.
 * Returns empty string if the response is not usable HTML/text.
 */
export async function fetchUrlPlainText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': 'GEO-CriteriaResearch/1.0 (+https://github.com/)',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    if (!res.ok) return '';
    const ct = res.headers.get('content-type') ?? '';
    const raw = await res.text();
    if (ct.includes('application/json')) {
      return raw.length <= MAX_SNIPPET ? raw : raw.slice(0, MAX_SNIPPET);
    }
    const text = htmlToPlainText(raw);
    if (text.length < MIN_USEFUL_CHARS) return '';
    return text.length > MAX_SNIPPET ? text.slice(0, MAX_SNIPPET) + '…' : text;
  } catch {
    return '';
  }
}
