import { NextResponse } from 'next/server';
import { fetchHtml, extractMetaAndContent } from '@/lib/htmlAnalyzer';
import { extractSeedKeywords } from '@/lib/keywordExtractor';
import { fetchSearchQuestions } from '@/lib/searchQuestions';
import type { AnalysisMeta, SeedKeyword, SearchQuestion } from '@/lib/analysisTypes';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    if (!body || typeof body.url !== 'string') {
      return NextResponse.json(
        { error: 'url 필드가 포함된 JSON body가 필요합니다.' },
        { status: 400 }
      );
    }

    const url = body.url as string;

    // 1) HTML 가져오기
    const html = await fetchHtml(url);

    // 2) 메타/헤딩/본문/질문 추출
    const { meta, headings, contentText, pageQuestions } = extractMetaAndContent(html);

    // 3) seed 키워드 추출
    const seedKeywords: SeedKeyword[] = extractSeedKeywords(
      meta as AnalysisMeta,
      headings,
      contentText
    );

    // 4) 외부 질문(mock) 추출
    const searchQuestions: SearchQuestion[] = await fetchSearchQuestions(seedKeywords);

    return NextResponse.json(
      {
        url,
        meta,
        headings,
        contentPreview: contentText.slice(0, 300),
        pageQuestions,
        seedKeywords,
        searchQuestions,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error('analyze error:', err);
    return NextResponse.json(
      { error: '분석 중 오류가 발생했습니다.', detail: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
