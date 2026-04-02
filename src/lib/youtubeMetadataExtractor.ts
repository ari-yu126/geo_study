import * as cheerio from 'cheerio';
import type { AnalysisMeta } from './analysisTypes';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface YouTubeMetadata {
  title: string | null;
  description: string | null;
  videoId: string;
}

export interface YouTubeOEmbed {
  title: string;
  author_name: string;
  thumbnail_url?: string;
  html?: string;
}

/**
 * YouTube oEmbed API로 최소 메타(title, author_name 등) 조회.
 * 실패 시 null 반환.
 */
export async function fetchYouTubeOEmbed(url: string): Promise<YouTubeOEmbed | null> {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetch(oembedUrl, {
      headers: { Accept: 'application/json' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const title = typeof data.title === 'string' ? data.title : '';
    const author_name = typeof data.author_name === 'string' ? data.author_name : '';
    if (!title && !author_name) return null;
    return {
      title: title || 'Untitled',
      author_name: author_name || 'Unknown',
      thumbnail_url: typeof data.thumbnail_url === 'string' ? data.thumbnail_url : undefined,
      html: typeof data.html === 'string' ? data.html : undefined,
    };
  } catch (err) {
    console.warn('fetchYouTubeOEmbed failed:', err);
    return null;
  }
}

/** youtube.com, m.youtube.com, youtu.be, youtube-nocookie.com 등 YouTube 호스트 여부 */
export function isYouTubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return (
      host === 'youtube.com' || host.endsWith('.youtube.com') ||
      host === 'youtu.be' ||
      host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com')
    );
  } catch {
    return false;
  }
}

/**
 * YouTube watch URL에서 video ID 추출
 */
export function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    // youtube.com watch?v=...
    if (/^youtube\.com$/i.test(host) || host.endsWith('.youtube.com')) {
      // /watch?v=... (standard)
      const v = u.searchParams.get('v');
      if (v) return v;
      // /shorts/{id}
      const parts = u.pathname.split('/').filter(Boolean);
      const shortsIdx = parts.indexOf('shorts');
      if (shortsIdx >= 0 && parts.length > shortsIdx + 1) {
        return parts[shortsIdx + 1].split(/[?#]/)[0] || null;
      }
      // /embed/{id}
      const embedIdx = parts.indexOf('embed');
      if (embedIdx >= 0 && parts.length > embedIdx + 1) {
        return parts[embedIdx + 1].split(/[?#]/)[0] || null;
      }
      return null;
    }
    if (/youtu\.be$/i.test(u.hostname)) {
      return u.pathname.slice(1).split(/[?/]/)[0] || null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * watch URL → embed URL 변환.
 * youtube-nocookie.com 사용 (오류 153 방지, Referer 요구 충족).
 */
export function toEmbedUrl(url: string): string | null {
  const videoId = extractVideoId(url);
  if (!videoId) return null;
  const u = new URL(url);
  const t = u.searchParams.get('t');
  let embed = `https://www.youtube-nocookie.com/embed/${videoId}`;
  if (t) embed += `?start=${t}`;
  return embed;
}

/**
 * raw HTML에서 ytInitialData JSON 추출 (중괄호 밸런싱, 문자열 스킵)
 */
function extractYtInitialData(html: string): Record<string, unknown> | null {
  const idx = html.indexOf('ytInitialData');
  if (idx < 0) return null;
  const frag = html.slice(idx);
  const eqIdx = frag.indexOf('=');
  if (eqIdx < 0) return null;
  const objStart = frag.indexOf('{', eqIdx);
  if (objStart < 0) return null;

  let depth = 0;
  let i = objStart;
  let inStr: string | null = null;
  let escape = false;

  while (i < frag.length) {
    const c = frag[i];
    if (escape) {
      escape = false;
      i++;
      continue;
    }
    if (inStr) {
      if (c === '\\') escape = true;
      else if (c === inStr) inStr = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(frag.slice(objStart, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
    i++;
  }
  return null;
}

/**
 * ytInitialData에서 title 추출
 */
function getTitleFromYtData(data: Record<string, unknown>): string | null {
  try {
    const contents = (data as any).contents?.twoColumnWatchNextResults?.results?.results?.contents;
    if (Array.isArray(contents)) {
      const primary = contents[0]?.videoPrimaryInfoRenderer;
      const runs = primary?.videoTitle?.runs;
      if (Array.isArray(runs) && runs[0]?.text) return String(runs[0].text).trim();
    }
    const title = (data as any).metadata?.videoMetadataRenderer?.title;
    if (typeof title === 'string') return title.trim();
    return null;
  } catch {
    return null;
  }
}

/**
 * ytInitialData에서 description 추출
 */
function getDescriptionFromYtData(data: Record<string, unknown>): string | null {
  try {
    const contents = (data as any).contents?.twoColumnWatchNextResults?.results?.results?.contents;
    if (Array.isArray(contents)) {
      const secondary = contents.find((c: any) => c.videoSecondaryInfoRenderer);
      const desc = secondary?.videoSecondaryInfoRenderer?.attributedDescription;
      if (desc?.content) return String(desc.content).trim();
      const runs = desc?.runs;
      if (Array.isArray(runs)) {
        return runs.map((r: any) => r.text).filter(Boolean).join('').trim();
      }
    }
    const engagement = (data as any).engagementPanels;
    if (Array.isArray(engagement)) {
      for (const p of engagement) {
        const inner = (p as any).engagementPanelSectionListRenderer?.content?.structuredDescriptionVideoLockupRenderer;
        const runs = inner?.description?.runs;
        if (Array.isArray(runs)) {
          return runs.map((r: any) => r.text).filter(Boolean).join('').trim();
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * YouTube 전용 메타데이터 추출. CSR로 로드되는 제목·설명을 raw HTML/ytInitialData에서 추출.
 * fetchHtml으로는 빈 본문만 오므로, 직접 fetch + meta/ytInitialData 파싱 사용.
 */
export async function fetchYouTubeMetadata(url: string): Promise<YouTubeMetadata | null> {
  const videoId = extractVideoId(url);
  if (!videoId) return null;

  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    const response = await fetch(watchUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': 'https://www.google.com/',
      },
      redirect: 'follow',
    });

    if (!response.ok) return null;
    const html = await response.text();

    let title: string | null = null;
    let description: string | null = null;

    const $ = cheerio.load(html);
    title = $('meta[property="og:title"]').attr('content')?.trim() || null;
    description = $('meta[property="og:description"]').attr('content')?.trim() || null;

    if (title?.endsWith(' - YouTube')) {
      title = title.replace(/\s*-\s*YouTube\s*$/, '').trim();
    }

    const ytData = extractYtInitialData(html);
    if (ytData) {
      const dataTitle = getTitleFromYtData(ytData);
      const dataDesc = getDescriptionFromYtData(ytData);
      if (dataTitle && (!title || dataTitle.length > title.length)) title = dataTitle;
      if (dataDesc && (!description || dataDesc.length > description.length)) description = dataDesc;
    }

    if ((!title || !description) && html.includes('ytInitialPlayerResponse')) {
      const idx = html.indexOf('ytInitialPlayerResponse');
      const objStart = html.indexOf('{', idx);
      if (objStart >= 0) {
        let depth = 0;
        let i = objStart;
        let inStr: string | null = null;
        let escape = false;
        while (i < html.length) {
          const c = html[i];
          if (escape) {
            escape = false;
            i++;
            continue;
          }
          if (inStr) {
            if (c === '\\') escape = true;
            else if (c === inStr) inStr = null;
            i++;
            continue;
          }
          if (c === '"' || c === "'") {
            inStr = c;
            i++;
            continue;
          }
          if (c === '{') depth++;
          else if (c === '}') {
            depth--;
            if (depth === 0) {
              try {
                const player = JSON.parse(html.slice(objStart, i + 1)) as Record<string, unknown>;
                const vd = (player as any)?.videoDetails;
                if (vd?.title && !title) title = String(vd.title).trim();
                if (vd?.shortDescription && !description) description = String(vd.shortDescription).trim();
              } catch {
                /* ignore */
              }
              break;
            }
          }
          i++;
        }
      }
    }

    return {
      title: title || null,
      description: description || null,
      videoId,
    };
  } catch (err) {
    console.warn('fetchYouTubeMetadata failed:', err);
    return null;
  }
}

/**
 * YouTube 메타를 AnalysisMeta 형식으로 변환
 */
export function youtubeMetadataToAnalysisMeta(yt: YouTubeMetadata): AnalysisMeta {
  return {
    title: yt.title,
    description: yt.description,
    keywords: null,
    ogTitle: yt.title,
    ogDescription: yt.description,
    canonical: `https://www.youtube.com/watch?v=${yt.videoId}`,
  };
}
