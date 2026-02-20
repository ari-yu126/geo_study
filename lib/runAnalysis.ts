import { fetchHtml, extractMetaAndContent, normalizeUrl } from './htmlAnalyzer';
import { extractSeedKeywords } from './keywordExtractor';
import { fetchSearchQuestions } from './searchQuestions';
import type {
  AnalysisResult,
  GeoScores,
  QuestionCluster,
  AnalysisMeta,
  SearchQuestion,
} from './analysisTypes';

// TODO: 향후 Gemini 1.5 Flash를 연동하여 questionClusters 생성, 개선 H2/FAQ 추천, 자연어 요약 로직 추가 예정

/**
 * 전체 분석 엔진 - URL을 받아서 완전한 AnalysisResult를 반환합니다.
 * 
 * @param url - 분석할 URL
 * @returns 완전한 분석 결과
 */
export async function runAnalysis(url: string): Promise<AnalysisResult> {
  try {
    // 1) HTML 가져오기
    const html = await fetchHtml(url);

    // 2) 메타/헤딩/본문/질문 추출
    const { meta, headings, contentText, pageQuestions } = extractMetaAndContent(html);

    // 3) seed 키워드 추출
    const seedKeywords = extractSeedKeywords(meta as AnalysisMeta, headings, contentText);

    // 4) 외부 검색 질문 수집
    const searchQuestions = await fetchSearchQuestions(seedKeywords);

    // 5) 점수 계산
    const structureScore = calculateStructureScore(meta, headings, pageQuestions);
    const { questionCoverage } = calculateQuestionCoverage(pageQuestions, searchQuestions);
    const questionCoverageScore = questionCoverage * 100;
    const finalScore = Math.round(structureScore * 0.4 + questionCoverageScore * 0.6);

    const scores: GeoScores = {
      structureScore,
      questionCoverage: questionCoverageScore,
      finalScore,
    };

    // 6) 정규화된 URL 생성
    const normalizedUrl = normalizeUrl(url);

    // 7) 최종 결과 조립
    const result: AnalysisResult = {
      url,
      normalizedUrl,
      meta,
      seedKeywords,
      pageQuestions,
      searchQuestions,
      questionClusters: [], // TODO: Gemini 연동 후 구현 예정
      scores,
    };

    return result;

  } catch (error) {
    console.error('runAnalysis 오류:', error);
    throw new Error(`분석 실행 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 페이지 질문이 검색 질문들을 얼마나 커버하는지 계산합니다.
 * 
 * @param pageQuestions - 페이지에서 추출한 질문들
 * @param searchQuestions - 검색/커뮤니티에서 수집한 질문들
 * @returns 질문 커버리지 점수 (0~1)
 */
function calculateQuestionCoverage(
  pageQuestions: string[],
  searchQuestions: Pick<SearchQuestion, 'text'>[]
): { questionCoverage: number } {
  // searchQuestions가 없으면 coverage는 0
  if (!searchQuestions || searchQuestions.length === 0) {
    return { questionCoverage: 0 };
  }

  const totalSearchQuestions = searchQuestions.length;
  let coveredCount = 0;

  // 각 search 질문에 대해
  for (const searchQ of searchQuestions) {
    // search 질문 토큰화: 공백으로 split, 소문자 변환, 길이 2 이상만 필터링
    const searchTokens = searchQ.text
      .toLowerCase()
      .split(/\s+/)
      .filter(token => token.length >= 2);

    // page 질문들과 비교
    let isCovered = false;

    for (const pageQ of pageQuestions) {
      // page 질문 토큰화: 동일한 방식
      const pageTokens = pageQ
        .toLowerCase()
        .split(/\s+/)
        .filter(token => token.length >= 2);

      // 교집합 계산
      const intersection = searchTokens.filter(token => pageTokens.includes(token));

      // 교집합이 1개 이상이면 "커버됨"으로 간주
      if (intersection.length >= 1) {
        isCovered = true;
        break;
      }
    }

    if (isCovered) {
      coveredCount++;
    }
  }

  // 최종 커버리지 비율 (0~1)
  const questionCoverage = coveredCount / totalSearchQuestions;

  return { questionCoverage };
}

/**
 * 페이지 구조 점수를 계산합니다.
 * 메타 정보, 제목 구조, 질문 포함 여부 등을 평가합니다.
 * 
 * @param meta - 페이지 메타 정보
 * @param headings - 페이지 제목 태그들 (h1, h2, h3)
 * @param pageQuestions - 페이지에서 추출한 질문들
 * @returns 구조 점수 (0~100)
 */
function calculateStructureScore(
  meta: AnalysisMeta,
  headings: string[],
  pageQuestions: string[]
): number {
  // 기본 점수 40점
  let score = 40;

  // meta.title 존재하면 +10점
  if (meta.title && meta.title.trim().length > 0) {
    score += 10;
  }

  // meta.description 존재하면 +10점
  if (meta.description && meta.description.trim().length > 0) {
    score += 10;
  }

  // headings가 2개 이상이면 +10점
  if (headings.length >= 2) {
    score += 10;
  }

  // pageQuestions가 3개 이상이면 +10점
  if (pageQuestions.length >= 3) {
    score += 10;
  }

  // 점수 범위를 0~100으로 Clamp
  score = Math.min(100, Math.max(0, score));

  return score;
}
