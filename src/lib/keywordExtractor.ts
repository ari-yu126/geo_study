import type { AnalysisMeta, SeedKeyword } from './analysisTypes';

// 불용어 정의
const STOP_WORDS = new Set([
  '그리고', '하지만', '그러나', '그러면서', '또는', '또한',
  '이것', '저것', '그것', '있는', '하는', '되는', '통해', '대한', '위한', '같은', '많은',
  '있습니다', '합니다', '됩니다', '입니다', '습니다', '니다',
  '경우', '사용', '필요', '다른', '모든', '이용', '수행',
  'the', 'is', 'are', 'and', 'or', 'for', 'with', 'this', 'that', 'from', 'into', 'about', 'your', 'our',
  'has', 'have', 'can', 'will', 'been', 'more', 'when', 'they', 'them', 'their', 'what', 'which',
  'var', 'let', 'const', 'function', 'return', 'true', 'false', 'null', 'undefined',
  'document', 'window', 'element', 'href', 'src', 'style', 'class', 'type',
  'location', 'locationhref', 'windowopen', 'innerhtml', 'queryselector',
  'addeventlistener', 'getelementbyid', 'classname', 'parentnode',
  'appendchild', 'createelement', 'setattribute', 'getattribute',
  'foreach', 'indexof', 'substring', 'replace', 'length', 'push',
  'console', 'log', 'error', 'catch', 'try', 'new', 'prototype',
]);

/**
 * 메타 정보, 제목, 본문 텍스트에서 주요 키워드를 추출합니다.
 * 빈도수 기반으로 상위 키워드를 선정하고 0~1 사이의 점수를 부여합니다.
 */
export function extractSeedKeywords(
  meta: AnalysisMeta,
  headings: string[],
  contentText: string
): SeedKeyword[] {
  // (1) 데이터 통합 — 제목/H1에 3배 가중치로 상품 고유 명사 우선 추출
  const parts: string[] = [];
  const h1 = headings[0] ?? '';

  if (meta.title) for (let i = 0; i < 3; i++) parts.push(meta.title);
  if (meta.ogTitle) parts.push(meta.ogTitle);
  if (meta.description) parts.push(meta.description);
  if (meta.ogDescription) parts.push(meta.ogDescription);

  if (h1) for (let i = 0; i < 3; i++) parts.push(h1);
  parts.push(...headings.slice(1));

  if (contentText) {
    parts.push(contentText.substring(0, 800));
  }

  const rawText = parts.join(' ');
  
  // 엣지 케이스: 텍스트가 비어있으면 빈 배열 반환
  if (!rawText.trim()) {
    return [];
  }
  
  // (2) 텍스트 정제 및 토큰화
  // 소문자 변환
  const normalized = rawText.toLowerCase();
  
  // 한글/영문/숫자만 남기고 나머지는 공백으로 치환
  const cleaned = normalized.replace(/[^0-9a-zA-Z가-힣]+/g, ' ');
  
  // 공백 기준으로 split
  let tokens = cleaned.split(/\s+/).filter(token => token.length > 0);
  
  tokens = tokens.filter(token => {
    if (token.length === 1) return false;
    if (/^\d+$/.test(token)) return false;
    if (token.length >= 30) return false;

    // camelCase 합성어 필터 (영문 소문자 연속 15자 이상이면 코드일 가능성 높음)
    if (/^[a-z]{15,}$/.test(token)) return false;

    // 영문 2글자 이하 제거 (of, by, to 등 불용어)
    if (/^[a-z]{1,2}$/.test(token)) return false;

    return true;
  });
  
  // (3) 불용어 제거
  tokens = tokens.filter(token => !STOP_WORDS.has(token));
  
  // 엣지 케이스: 유효한 토큰이 없으면 빈 배열 반환
  if (tokens.length === 0) {
    return [];
  }
  
  // (4) 빈도수 계산
  const frequencyMap = new Map<string, number>();
  
  for (const token of tokens) {
    frequencyMap.set(token, (frequencyMap.get(token) || 0) + 1);
  }
  
  // [단어, 빈도] 쌍의 배열로 변환
  const entries = Array.from(frequencyMap.entries());
  
  // (5) 점수화 및 상위 키워드 선택
  // 빈도 내림차순으로 정렬
  entries.sort((a, b) => b[1] - a[1]);
  
  // 상위 10개 선택
  const topEntries = entries.slice(0, 10);
  
  // 가장 높은 빈도값
  const maxCount = topEntries.length > 0 ? topEntries[0][1] : 1;
  
  // SeedKeyword[] 형태로 반환
  return topEntries.map(([value, count]) => ({
    value,
    score: count / maxCount,
  }));
}
