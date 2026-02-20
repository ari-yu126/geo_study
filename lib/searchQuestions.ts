import type { SeedKeyword, SearchQuestion, SearchSource } from './analysisTypes';

/**
 * 텍스트 덩어리에서 질문형 문장을 추출합니다.
 */
function extractQuestionCandidatesFromText(
  text: string,
  source: SearchSource,
  url?: string
): SearchQuestion[] {
  // 문장 단위로 분리 (마침표, 물음표, 느낌표 기준)
  const sentences = text.split(/[.!?]\s+/).map(s => s.trim());

  const questionKeywords = [
    '어떻게', '언제', '왜', '무엇', '가능', '방법',
    '비용', '기간', '차이', '추천', '어디', '누가'
  ];

  const questions: SearchQuestion[] = [];

  for (const sentence of sentences) {
    // 너무 짧은 문장은 제외
    if (sentence.length <= 5) continue;

    // 질문 조건: ?가 포함되거나 질문 키워드가 포함
    const hasQuestionMark = sentence.includes('?');
    const hasKeyword = questionKeywords.some(keyword => sentence.includes(keyword));

    if (hasQuestionMark || hasKeyword) {
      questions.push({
        source,
        text: sentence,
        url,
      });
    }
  }

  return questions;
}

/**
 * Tavily API를 통해 검색 결과에서 질문을 가져옵니다.
 * TODO: 실제 Tavily API 연동 예정
 * TODO: process.env.TAVILY_API_KEY를 사용할 예정
 */
async function fetchFromTavily(
  keyword: string,
  source: SearchSource = 'google'
): Promise<SearchQuestion[]> {
  // TODO: 나중에 실제 Tavily API 연동 예정.
  // TODO: const apiKey = process.env.TAVILY_API_KEY;
  // TODO: const response = await fetch('https://api.tavily.com/search', { ... });

  try {
    // 지금은 mock 데이터 반환
    const mockQuestions: SearchQuestion[] = [
      {
        source,
        text: `${keyword}는 얼마나 자주 교체해야 하나요?`,
        url: `https://example.com/search?q=${encodeURIComponent(keyword)}`,
      },
      {
        source,
        text: `${keyword} 비용은 어느 정도인가요?`,
        url: `https://example.com/search?q=${encodeURIComponent(keyword)}`,
      },
      {
        source,
        text: `${keyword}를 선택할 때 고려해야 할 점은 무엇인가요?`,
        url: `https://example.com/search?q=${encodeURIComponent(keyword)}`,
      },
    ];

    return mockQuestions;
  } catch (error) {
    console.error(`Tavily API 호출 실패 (keyword: ${keyword}):`, error);
    return [];
  }
}

/**
 * SearchQuestion 배열에서 중복을 제거합니다.
 * text를 기준으로 중복을 판단합니다.
 */
function dedupeQuestions(questions: SearchQuestion[]): SearchQuestion[] {
  const seen = new Set<string>();
  const dedupedQuestions: SearchQuestion[] = [];

  for (const question of questions) {
    // 대소문자 구분 없이, 공백 정규화해서 중복 체크
    const normalizedText = question.text.toLowerCase().replace(/\s+/g, ' ').trim();

    if (!seen.has(normalizedText)) {
      seen.add(normalizedText);
      dedupedQuestions.push(question);
    }
  }

  return dedupedQuestions;
}

/**
 * seed 키워드 목록을 받아서 외부 검색/커뮤니티에서 질문형 문장을 수집합니다.
 * 
 * @param seedKeywords - 추출된 seed 키워드 배열
 * @param maxPerKeyword - 각 키워드당 최대 질문 수 (기본값: 5)
 * @returns 수집된 질문 배열
 */
export async function fetchSearchQuestions(
  seedKeywords: SeedKeyword[],
  maxPerKeyword: number = 5
): Promise<SearchQuestion[]> {
  try {
    // 엣지 케이스: 키워드가 없으면 빈 배열 반환
    if (!seedKeywords || seedKeywords.length === 0) {
      return [];
    }

    // score 기준으로 내림차순 정렬
    const sortedKeywords = [...seedKeywords].sort((a, b) => b.score - a.score);

    // 상위 5개 키워드만 사용
    const topKeywords = sortedKeywords.slice(0, 5);

    // 각 키워드에 대해 질문 수집
    const allQuestions: SearchQuestion[] = [];

    for (const keyword of topKeywords) {
      try {
        const questions = await fetchFromTavily(keyword.value, 'google');
        allQuestions.push(...questions);
      } catch (error) {
        console.error(`키워드 "${keyword.value}" 처리 중 오류:`, error);
        // 해당 키워드는 건너뛰고 계속 진행
        continue;
      }
    }

    // 중복 제거
    const dedupedQuestions = dedupeQuestions(allQuestions);

    // 너무 짧거나 의미없는 문장 필터링
    const filteredQuestions = dedupedQuestions.filter(q => q.text.length > 5);

    return filteredQuestions;

  } catch (error) {
    console.error('fetchSearchQuestions 전체 오류:', error);
    return [];
  }
}
