import * as cheerio from 'cheerio';
import { AnalysisMeta } from './analysisTypes';

/**
 * 주어진 URL에서 HTML을 가져옵니다.
 */
export async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return await response.text();
}

/**
 * HTML에서 메타 정보, 제목, 본문 텍스트, 질문 등을 추출합니다.
 */
export function extractMetaAndContent(html: string): {
  meta: AnalysisMeta;
  headings: string[];
  contentText: string;
  pageQuestions: string[];
} {
  const $ = cheerio.load(html);

  // 메타 정보 추출
  const meta: AnalysisMeta = {
    title: $('title').text().trim() || null,
    description: $('meta[name="description"]').attr('content')?.trim() || null,
    keywords: $('meta[name="keywords"]').attr('content')?.trim() || null,
    ogTitle: $('meta[property="og:title"]').attr('content')?.trim() || null,
    ogDescription: $('meta[property="og:description"]').attr('content')?.trim() || null,
    canonical: $('link[rel="canonical"]').attr('href')?.trim() || null,
  };

  // 제목 태그 추출 (h1, h2, h3)
  const headings: string[] = [];
  $('h1, h2, h3').each((_, elem) => {
    const text = $(elem).text().trim();
    if (text) {
      headings.push(text);
    }
  });

  // 본문 텍스트 추출 (앞부분 5000자)
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const contentText = bodyText.substring(0, 5000);

  // 질문 추출
  const pageQuestions = extractQuestions(contentText);

  return {
    meta,
    headings,
    contentText,
    pageQuestions,
  };
}

/**
 * 텍스트에서 질문으로 보이는 문장들을 추출합니다.
 */
function extractQuestions(text: string): string[] {
  // 문장 단위로 분리 (., !, ? 기준)
  const sentences = text.split(/[.!?]\s+/).map(s => s.trim()).filter(s => s.length > 10);

  const questionKeywords = [
    '어떻게', '언제', '왜', '무엇', '가능', '방법', 
    '비용', '기간', '차이', '추천', '어디', '누가'
  ];

  const questions: string[] = [];

  for (const sentence of sentences) {
    // ?가 포함되어 있거나
    const hasQuestionMark = sentence.includes('?');
    
    // 질문 키워드가 포함되어 있으면
    const hasKeyword = questionKeywords.some(keyword => sentence.includes(keyword));

    if (hasQuestionMark || hasKeyword) {
      questions.push(sentence);
    }
  }

  return questions;
}

/**
 * URL을 정규화합니다 (캐시 키로 사용).
 * - 프로토콜은 https://로 통일
 * - www. 제거
 * - trailing slash 제거
 * - utm_ 파라미터 제거
 */
export function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url);

    // 프로토콜을 https로 통일
    urlObj.protocol = 'https:';

    // www. 제거
    urlObj.hostname = urlObj.hostname.replace(/^www\./, '');

    // utm_ 파라미터 제거
    const params = new URLSearchParams(urlObj.search);
    const keysToDelete: string[] = [];
    
    params.forEach((_, key) => {
      if (key.startsWith('utm_')) {
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach(key => params.delete(key));
    urlObj.search = params.toString();

    // trailing slash 제거
    let normalized = urlObj.toString();
    if (normalized.endsWith('/') && urlObj.pathname !== '/') {
      normalized = normalized.slice(0, -1);
    }

    return normalized;
  } catch (error) {
    // URL 파싱 실패 시 원본 반환
    return url;
  }
}

export { fetchHtml, extractMetaAndContent, normalizeUrl };
