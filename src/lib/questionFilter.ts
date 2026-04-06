import {
  analysisLlmGenerateText,
  analysisLlmIsConfigured,
  getAnalysisLlmPreCallDelayMs,
} from './analysisLlm';
import { isQuotaError, isLlmCooldown } from './llmError';
import type { SearchQuestion } from './analysisTypes';

export interface FilterQuestionsOptions {
  pageType?: 'video' | 'editorial';
  /** 주제 구문 (있으면 STRICT RELEVANCE 프롬프트 사용) */
  primaryPhrase?: string;
}

/** How question filtering ran — for score-axis / quota debugging */
export type FilterQuestionsRunMeta = {
  status:
    | 'ok_llm'
    | 'bypass_empty_questions'
    | 'bypass_no_llm'
    | 'bypass_cooldown'
    | 'bypass_quota'
    | 'bypass_error';
};

/**
 * 수집된 질문 중 페이지 주제와 맞는 것만 Gemini로 필터링합니다.
 * pageType 'video'일 때: snippet 길이 확대, 관대한 판단 유도, 필터 결과 부족 시 상위 topK 유지
 */
export async function filterQuestionsByPageRelevance(
  questions: SearchQuestion[],
  pageTitle: string | null,
  pageContentSnippet: string,
  options?: FilterQuestionsOptions
): Promise<{ questions: SearchQuestion[]; meta: FilterQuestionsRunMeta }> {
  if (!questions.length) {
    return { questions, meta: { status: 'bypass_empty_questions' } };
  }
  if (!analysisLlmIsConfigured()) {
    return { questions, meta: { status: 'bypass_no_llm' } };
  }
  if (isLlmCooldown()) {
    return { questions, meta: { status: 'bypass_cooldown' } };
  }

  const isVideo = options?.pageType === 'video';
  const primaryPhrase = options?.primaryPhrase ?? '';
  const title = pageTitle ?? '제목 없음';
  const snippetLen = isVideo ? 2000 : 1200;
  const snippet = pageContentSnippet.slice(0, snippetLen);
  const list = questions.slice(0, 20).map((q, i) => `${i + 1}. ${q.text}`).join('\n');

  const strictHint = primaryPhrase
    ? `\n**STRICT RELEVANCE:** Primary topic is [${primaryPhrase}]. Discard anything not directly about this. Software, DB, language learning, education, unrelated certification = 100% reject. Be ruthless.\n`
    : '';
  const videoHint = isVideo && !primaryPhrase
    ? '\n**영상 콘텐츠:** 제목·설명 기반으로 판단해줘. 관련 있으면 관대하게 포함해줘.\n'
    : '';
  const prompt = `다음은 검색·커뮤니티에서 수집한 질문 목록이다.
아래 페이지 제목과 본문 요약을 보고, 이 페이지 주제와 **직접 관련 있는** 질문 번호만 골라줘.${strictHint}${videoHint}

**커뮤니티 컨텍스트:** 톤이 비격식이어도 괜찮다. **핵심 사용자 의도와 사실적 질문**에 집중해줘.
- 유용한 정보가 있지만 표현이 과한 경우 → 전문적인 질문으로 재구성할 수 있으면 포함, 그렇지 않으면 제외
- 예: "XX 드라이기 실사용 후기 어때요?" → 포함

**ZERO TOLERANCE (예외 없이 즉시 제외):** 성인(NSFW)·선정적·도박·불법 광고·스팸 관련 질문. 조금이라도 의심되거나 유해한 맥락이 있으면 반드시 제거해줘.

## 페이지 제목
${title}

## 본문 요약 (앞부분)
${snippet}

## 수집된 질문
${list}

출력 형식: 번호만 쉼표로 구분. 예: 1,3,5,7
페이지 주제와 무관한 질문(다른 상품, 다른 도메인, 완전히 다른 주제)은 제외해줘.`;

  try {
    const preDelay = getAnalysisLlmPreCallDelayMs();
    if (preDelay > 0) {
      await new Promise((res) => setTimeout(res, preDelay));
    }
    const raw = await analysisLlmGenerateText('questionFilter', prompt);
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
    if (filtered.length > 0) return { questions: filtered, meta: { status: 'ok_llm' } };
    if (isVideo && questions.length >= 10) {
      return { questions: questions.slice(0, 10), meta: { status: 'ok_llm' } };
    }
    return { questions, meta: { status: 'ok_llm' } };
  } catch (err) {
    if (isQuotaError(err)) {
      console.warn('[GEMINI] quota exceeded - filterQuestionsByPageRelevance, using original list');
    } else {
      console.warn('filterQuestionsByPageRelevance failed, using original list', err);
    }
    return {
      questions,
      meta: { status: isQuotaError(err) ? 'bypass_quota' : 'bypass_error' },
    };
  }
}
