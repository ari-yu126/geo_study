import { geminiFlash } from './geminiClient';
import type { SearchQuestion } from './analysisTypes';

/**
 * 수집된 질문 중 페이지 주제와 맞는 것만 Gemini로 필터링합니다.
 */
export async function filterQuestionsByPageRelevance(
  questions: SearchQuestion[],
  pageTitle: string | null,
  pageContentSnippet: string
): Promise<SearchQuestion[]> {
  if (!geminiFlash || !questions.length) return questions;

  const title = pageTitle ?? '제목 없음';
  const snippet = pageContentSnippet.slice(0, 1200);
  const list = questions.map((q, i) => `${i + 1}. ${q.text}`).join('\n');

  const prompt = `다음은 검색/커뮤니티에서 수집한 질문 목록이다.
아래 페이지 제목과 본문 요약을 보고, 이 페이지 주제와 **직접 관련 있는** 질문 번호만 골라줘.

## 페이지 제목
${title}

## 본문 요약 (앞부분)
${snippet}

## 수집된 질문
${list}

출력 형식: 번호만 쉼표로 구분. 예: 1,3,5,7
페이지 주제와 무관한 질문(다른 상품, 다른 도메인, 완전히 다른 주제)은 제외해줘.`;

  try {
    const result = await geminiFlash.generateContent([{ text: prompt }]);
    const raw = result.response.text().trim();
    const indices = raw
      .replace(/[^\d,]/g, '')
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= questions.length);
    const seen = new Set<number>();
    const filtered: SearchQuestion[] = [];
    for (const idx of indices) {
      if (!seen.has(idx)) {
        seen.add(idx);
        filtered.push(questions[idx - 1]);
      }
    }
    return filtered.length > 0 ? filtered : questions;
  } catch (err) {
    console.warn('filterQuestionsByPageRelevance failed, using original list', err);
    return questions;
  }
}
