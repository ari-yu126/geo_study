import { geminiFlash } from './geminiClient';
import type { AnalysisMeta, AnalysisResult, AuditIssue, GeoScores, SeedKeyword, TrustSignals } from './analysisTypes';
import { normalizeUrl } from './htmlAnalyzer';
import { computeChunkInfoDensity } from './paragraphAnalyzer';

/** URL t= 값을 초 단위로 파싱. 120, 1m30s, 1h2m30s 등 */
function parseTimestampParam(url: string): number | null {
  try {
    const t = new URL(url).searchParams.get('t')?.trim();
    if (!t) return null;
    const s = t.toLowerCase().replace(/\s/g, '');
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    let total = 0;
    const hMatch = s.match(/(\d+)h/);
    const mMatch = s.match(/(\d+)m/);
    const secMatch = s.match(/(\d+)s?$/);
    if (hMatch) total += parseInt(hMatch[1], 10) * 3600;
    if (mMatch) total += parseInt(mMatch[1], 10) * 60;
    if (secMatch) total += parseInt(secMatch[1], 10);
    return total > 0 ? total : null;
  } catch {
    return null;
  }
}

/** 설명란에서 0:00 형태 타임스탬프와 그 뒤 텍스트를 파싱. [{seconds, text}] */
function parseTimestampedDescription(desc: string): { seconds: number; text: string }[] {
  const lines = desc.split(/\n/);
  const result: { seconds: number; text: string }[] = [];
  const tsRe = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*[-–—:]\s*(.+)/;
  const tsRe2 = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(.+)/;
  for (const line of lines) {
    const m = line.match(tsRe) || line.match(tsRe2);
    if (m) {
      const h = parseInt(m[1], 10);
      const min = parseInt(m[2], 10);
      const sec = m[3] ? parseInt(m[3], 10) : 0;
      const seconds = h * 3600 + min * 60 + sec;
      const text = (m[4] ?? '').trim();
      if (text) result.push({ seconds, text });
    }
  }
  return result.sort((a, b) => a.seconds - b.seconds);
}

/** t= 시점의 텍스트가 시드 키워드와 의미적으로 겹치는지 (토큰 매칭) */
function timestampSectionMatchesSeedKeywords(
  tSeconds: number,
  desc: string,
  seedKeywords: string[]
): boolean {
  const segments = parseTimestampedDescription(desc);
  if (segments.length === 0) return false;
  const kwTokens = new Set(
    seedKeywords
      .flatMap((k) => k.toLowerCase().split(/\s+/))
      .filter((t) => t.length >= 2)
  );
  if (kwTokens.size === 0) return false;
  let segmentText = '';
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].seconds <= tSeconds) {
      segmentText = segments[i].text;
    } else break;
  }
  const textLower = segmentText.toLowerCase();
  let matchCount = 0;
  for (const tok of kwTokens) {
    if (textLower.includes(tok)) matchCount++;
  }
  return matchCount >= Math.min(2, Math.ceil(kwTokens.size * 0.4));
}

export interface GeminiVideoAnalysisResult {
  citationScore: number;
  paragraphScore: number;
  scarcityScore: number;
  expertiseScore: number;
  substantiveDataScore: number;
  citationKeywords: string[];
  coreTopic: string;
  youtubeIssues: string[];
  /** 영상의 정보 전달력·전문성 등 긍정적 성공 요인 (한 문장) */
  successFactor: string;
}

/**
 * 유튜브 전용 Gemini-Only 파이프라인.
 * 제목·설명(및 가능 시 영상 URL)을 Gemini에 넘겨 내용·가치·인용 키워드를 평가받고,
 * citationScore, paragraphScore를 해당 점수로 덮어씌움.
 */
export async function runGeminiVideoAnalysis(
  url: string,
  meta: AnalysisMeta
): Promise<GeminiVideoAnalysisResult | null> {
  if (!geminiFlash) return null;

  const title = meta.title ?? meta.ogTitle ?? '(제목 없음)';
  const description = meta.description ?? meta.ogDescription ?? '';

  const prompt = `당신은 AI 검색(Google AI Overview, Perplexity, ChatGPT)이 영상 콘텐츠를 인용할 때의 가치를 평가하는 전문가입니다.

## 유튜브 영상 정보
- URL: ${url}
- 제목: ${title}
- 설명: ${description || '(설명 없음)'}

다음 작업을 수행해주세요.

1. **핵심 주제**: 이 영상의 핵심 주제를 1~2문장으로 요약해주세요.

2. **희소성 점수 (0~100)**: 이 영상이 제공하는 정보의 희소성(다른 곳에서 쉽게 찾기 어려운 정도)을 0~100점으로 채점해주세요.

3. **전문성 점수 (0~100)**: 이 영상이 전달하는 정보의 전문성·신뢰도를 0~100점으로 채점해주세요.

4. **AI 인용 키워드**: AI가 이 영상을 출처로 인용할 때, 어떤 검색 질문/키워드로 인용할지 5~10개 도출해주세요.

5. **AI 인용 보강 포인트 (youtubeIssues)**: AI(Google AI Overview, Perplexity 등)가 이 영상을 출처로 인용하기 위해 **보강해야 할 텍스트 포인트**를 구체적으로 나열해주세요.
   - 영상 제목·설명을 읽고, "이 부분이 부족하면 AI가 인용하기 어렵다"는 관점에서 3~6개 이슈 문장 생성.
   - 예: "영상 설명란에 타임라인(00:00 형태)이 없어 AI가 특정 구간을 인용하기 어렵습니다.", "제목에 핵심 검색 키워드가 누락되어 AI가 이 영상을 추천하기 어렵습니다.", "설명란이 200자 미만으로 짧아 AI가 콘텐츠 요약을 제대로 추출할 수 없습니다."
   - 해당 없으면 빈 배열.

6. **성공 요인 (successFactor)**: 이 영상의 정보 전달력·전문성 등 **잘된 점**을 한 문장으로 요약해주세요.
   - 예: "영상의 정보 전달력이 명확해 AI가 핵심 답변을 추출하기 쉽습니다.", "전문가 시각의 비교 분석으로 신뢰도가 높습니다."

7. **실질 데이터 제공도 (substantiveDataScore, 0~100)**: 이 영상이 **낚시성(클릭 유도용)**인지, **실질적인 데이터·정보를 제공**하는지 판정해주세요.
   - 0~30: 낚시성, 제목·썸네일 위주, 실제 정보 부재
   - 31~60: 일부 정보 있으나 과장·광고 비중 높음
   - 61~100: 모델명, 스펙, 가격, 비교표 등 구체적 데이터 제공, 인용 가치 높음

출력 형식 (JSON만, 마크다운 없이):
{
  "coreTopic": "핵심 주제 요약",
  "scarcityScore": 85,
  "expertiseScore": 78,
  "substantiveDataScore": 75,
  "citationKeywords": ["키워드1", "키워드2", ...],
  "youtubeIssues": ["이슈1", "이슈2"],
  "successFactor": "영상의 정보 전달력이 명확함."
}

JSON:`;

  try {
    const result = await geminiFlash.generateContent([{ text: prompt }]);
    const raw = result.response.text().trim();
    const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const parsed = JSON.parse(jsonStr) as {
      coreTopic?: string;
      scarcityScore?: number;
      expertiseScore?: number;
      substantiveDataScore?: number;
      citationKeywords?: string[];
      youtubeIssues?: string[];
      successFactor?: string;
    };

    const scarcityScore = Math.min(100, Math.max(0, Number(parsed.scarcityScore) ?? 70));
    const expertiseScore = Math.min(100, Math.max(0, Number(parsed.expertiseScore) ?? 70));
    const substantiveDataScore = Math.min(100, Math.max(0, Number(parsed.substantiveDataScore) ?? 60));
    const citationScore = Math.round((scarcityScore + expertiseScore + substantiveDataScore) / 3);
    const paragraphScore = Math.round((scarcityScore * 0.4 + expertiseScore * 0.4 + substantiveDataScore * 0.2));

    return {
      citationScore,
      paragraphScore,
      scarcityScore,
      expertiseScore,
      substantiveDataScore,
      citationKeywords: Array.isArray(parsed.citationKeywords) ? parsed.citationKeywords : [],
      coreTopic: String(parsed.coreTopic ?? ''),
      youtubeIssues: Array.isArray(parsed.youtubeIssues) ? parsed.youtubeIssues : [],
      successFactor: String(parsed.successFactor ?? '영상의 정보 전달력이 양호합니다.'),
    };
  } catch (err) {
    console.warn('runGeminiVideoAnalysis failed', err);
    return null;
  }
}

export interface BuildYouTubeOptions {
  hasActualAiCitation: boolean;
}

/**
 * Gemini-Only 결과를 AnalysisResult 형식으로 조립합니다.
 */
export function buildYouTubeAnalysisResult(
  url: string,
  meta: AnalysisMeta,
  geminiResult: GeminiVideoAnalysisResult,
  options: BuildYouTubeOptions
): Omit<AnalysisResult, 'recommendations'> & { recommendations?: AnalysisResult['recommendations'] } {
  const seedKeywords: SeedKeyword[] = geminiResult.citationKeywords.slice(0, 10).map((v, i) => ({
    value: v,
    score: 1 - i * 0.1,
  }));

  const { hasActualAiCitation } = options;
  const trustSignals: TrustSignals = {
    hasAuthor: false,
    hasPublishDate: false,
    hasModifiedDate: false,
    hasContactLink: false,
    hasAboutLink: false,
    hasDomainAuthority: true,
    hasSearchExposure: false,
    hasActualAiCitation,
  };

  // 정보성 키워드 비중: 전체 단어 대비 모델명·수치 등 비중 → 0~100점
  const descText = meta.description ?? meta.ogDescription ?? '';
  const infoDensityRatio = computeChunkInfoDensity(descText);
  const infoDensityScore = Math.round(infoDensityRatio * 100);
  const answerabilityScore = Math.round(0.5 * 82 + 0.5 * Math.min(100, infoDensityScore + 40));
  const paragraphScore = Math.round(0.6 * geminiResult.paragraphScore + 0.4 * infoDensityScore);

  let citationScore = geminiResult.citationScore;

  // t= 정밀 답변 가산점: 시점 파라미터가 가리키는 내용이 시드 키워드와 일치할 때만
  const tSeconds = parseTimestampParam(url);
  if (tSeconds != null && tSeconds >= 0) {
    const seedKw = geminiResult.citationKeywords.slice(0, 8).map((k) => k.trim()).filter(Boolean);
    if (timestampSectionMatchesSeedKeywords(tSeconds, descText, seedKw)) {
      citationScore = Math.min(100, citationScore + 8);
    }
  }

  // hasActualAiCitation일 때만 웹 표준(H1~H3) 감점 무효화 → structureScore 상향
  const structureScore = hasActualAiCitation ? 85 : 75;

  const scores: GeoScores = {
    structureScore,
    answerabilityScore,
    trustScore: hasActualAiCitation ? 88 : 75,
    paragraphScore,
    citationScore,
    questionCoverage: 75,
    finalScore: 0,
  };

  const finalScore = Math.round(
    citationScore * 0.35 +
    paragraphScore * 0.20 +
    answerabilityScore * 0.20 +
    structureScore * 0.12 +
    scores.trustScore * 0.13
  );
  scores.finalScore = Math.min(100, Math.max(0, finalScore));

  const baseIssues: AuditIssue[] = geminiResult.youtubeIssues.map((desc, i) => ({
    id: `yt_issue_${i}`,
    number: i + 1,
    label: '유튜브 콘텐츠 개선',
    description: desc,
    priority: 'medium' as const,
    targetSelector: '_top',
    targetIndex: i,
  }));

  // 유튜브 전용 규칙 기반 이슈 추가
  let num = baseIssues.length + 1;
  const descLen = descText.length;
  const hasTimestamp = /\d{1,2}:\d{2}/.test(descText);
  const titleLower = (meta.title ?? meta.ogTitle ?? '').toLowerCase();
  const hasSeedInTitle = geminiResult.citationKeywords.some(
    (kw) => kw.length >= 2 && titleLower.includes(kw.toLowerCase())
  );

  // 설명란 짧음 감점: 절대 글자수만 보지 않고, 핵심 키워드 밀도(모델명·수치 등)가 높으면 점수 보존
  const descKeywordDensity = computeChunkInfoDensity(descText);
  const descTooShort = descLen > 0 && descLen < 200;
  const lowDensity = descKeywordDensity < 0.35;
  if (descTooShort && lowDensity) {
    baseIssues.push({
      id: 'yt_desc_short',
      number: num++,
      label: '설명란 요약 부재',
      description: '설명란이 200자 미만으로 짧아 AI가 영상 내용을 파악하기 어렵습니다. 핵심 내용 요약을 200자 이상으로 보강하세요.',
      priority: 'high' as const,
      targetSelector: '_top',
      targetIndex: 0,
    });
  }
  if (!hasTimestamp && descLen > 0) {
    baseIssues.push({
      id: 'yt_no_timestamp',
      number: num++,
      label: '타임스탬프 미등록',
      description: '설명란에 0:00 형태의 타임라인이 없어 AI가 특정 구간을 인용하기 어렵습니다.',
      priority: 'medium' as const,
      targetSelector: '_top',
      targetIndex: 1,
    });
  }
  if (!hasSeedInTitle && geminiResult.citationKeywords.length > 0) {
    baseIssues.push({
      id: 'yt_keyword_opt',
      number: num++,
      label: '태그/키워드 최적화',
      description: `제목에 시드 키워드(${geminiResult.citationKeywords.slice(0, 3).join(', ')})가 포함되지 않아 검색·AI 인용 노출에 불리합니다.`,
      priority: 'high' as const,
      targetSelector: '_top',
      targetIndex: 2,
    });
  }

  // 번호 재정렬
  baseIssues.forEach((issue, i) => { issue.number = i + 1; });

  return {
    url,
    normalizedUrl: normalizeUrl(url),
    analyzedAt: new Date().toISOString(),
    meta,
    seedKeywords,
    pageQuestions: meta.title ? [meta.title] : [],
    searchQuestions: [],
    searchQuestionCovered: [],
    questionClusters: [],
    scores,
    contentQuality: {
      contentLength: meta.description?.length ?? 0,
      tableCount: 0,
      listCount: 0,
      h2Count: 0,
      h3Count: 0,
      imageCount: 0,
      hasStepStructure: false,
      quotableSentenceCount: 0,
      firstParagraphLength: meta.description?.length ?? 0,
      hasDefinitionPattern: false,
      hasPriceInfo: false,
    },
    trustSignals,
    paragraphStats: {
      totalParagraphs: 0,
      definitionRatio: 0,
      goodLengthRatio: 0,
      fluffRatio: 0,
      duplicateRatio: 0,
      questionH2Ratio: 0,
      earlySummaryExists: false,
      avgScore: paragraphScore,
      communityFitScore: 0,
      infoDensity: infoDensityRatio,
    },
    headings: meta.title ? [meta.title] : [],
    h1Count: meta.title ? 1 : 0,
    hasFaqSchema: false,
    hasStructuredData: false,
    auditIssues: baseIssues,
    youtubeSuccessFactor: geminiResult.successFactor,
  };
}
