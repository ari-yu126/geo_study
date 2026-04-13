import {
  analysisLlmGenerateText,
  analysisLlmIsConfigured,
  getAnalysisLlmPreCallDelayMs,
} from './analysisLlm';
import { isQuotaError, isLlmCooldown } from './llmError';
import type { SearchQuestion } from './analysisTypes';
import { filterSearchQuestionsByTopicAlignment } from './searchQuestionTopicUtils';

export interface FilterQuestionsOptions {
  pageType?: 'video' | 'editorial';
  /** 주제 구문 (있으면 STRICT RELEVANCE 프롬프트 사용) */
  primaryPhrase?: string;
  /** Page topic tokens — used for non-LLM alignment when LLM is skipped or fails */
  essentialTokens?: string[];
  isEnglishPage?: boolean;
}

/** How question filtering ran — for score-axis / quota debugging */
export type FilterQuestionsRunMeta = {
  status:
    | 'ok_llm'
    | 'ok_llm_aligned'
    | 'bypass_empty_questions'
    | 'bypass_no_llm'
    | 'bypass_no_llm_heuristic'
    | 'bypass_cooldown'
    | 'bypass_cooldown_heuristic'
    | 'bypass_quota'
    | 'bypass_quota_heuristic'
    | 'bypass_error'
    | 'bypass_error_heuristic'
    /** Question Coverage: skip LLM/heuristic page relevance; use fetch output as-is */
    | 'bypass_coverage_preserve_tavily';
};

/**
 * 수집된 질문 중 페이지 주제와 맞는 것만 Gemini로 필터링합니다.
 * pageType 'video'일 때: snippet 길이 확대, 관대한 판단 유도, 필터 결과 부족 시 상위 topK 유지
 */
function applyTopicHeuristic(
  questions: SearchQuestion[],
  primaryPhrase: string,
  essentialTokens: string[] | undefined,
  _isEnglish: boolean
): SearchQuestion[] {
  const phrase = primaryPhrase.trim();
  const tokens = essentialTokens?.filter(Boolean) ?? [];
  if (phrase && tokens.length > 0) {
    const aligned = filterSearchQuestionsByTopicAlignment(questions, phrase, tokens);
    if (aligned.length > 0) return aligned;
    /** No synthetic “intent” questions — keep Tavily-sourced lines only (best-effort slice). */
    return questions.slice(0, 12);
  }
  if (phrase) {
    return questions.slice(0, 12);
  }
  return questions.slice(0, 12);
}

export async function filterQuestionsByPageRelevance(
  questions: SearchQuestion[],
  pageTitle: string | null,
  pageContentSnippet: string,
  options?: FilterQuestionsOptions
): Promise<{ questions: SearchQuestion[]; meta: FilterQuestionsRunMeta }> {
  if (!questions.length) {
    return { questions, meta: { status: 'bypass_empty_questions' } };
  }

  const isVideo = options?.pageType === 'video';
  const primaryPhrase = options?.primaryPhrase ?? '';
  const essentialTokens = options?.essentialTokens;
  const isEnglish = options?.isEnglishPage ?? false;
  const title = pageTitle ?? '제목 없음';
  const snippetLen = isVideo ? 2000 : 1200;
  const snippet = pageContentSnippet.slice(0, snippetLen);
  const list = questions.slice(0, 20).map((q, i) => `${i + 1}. ${q.text}`).join('\n');

  const strictHint = primaryPhrase
    ? `\n**TOPIC RELEVANCE ONLY (NOT “already answered on this page”):** Primary topic is [${primaryPhrase}]. Essential terms: [${(essentialTokens ?? []).join(', ')}].\nInclude a question if a real user searching about this topic could ask it — **even when this page’s title/snippet does NOT contain the answer.** Do NOT discard a question just because the excerpt does not show an answer; downstream logic measures coverage separately.\nDiscard only what is clearly off-topic (unrelated product/domain/subject, generic sustainability/ESG noise when irrelevant, software/DB/education rabbit holes unrelated to the topic). Be strict on **topic**, not on **page coverage**.\n`
    : '';
  const videoHint = isVideo && !primaryPhrase
    ? '\n**영상 콘텐츠:** 제목·설명 기반으로 판단해줘. 관련 있으면 관대하게 포함해줘.\n'
    : '';
  if (!analysisLlmIsConfigured()) {
    const h = applyTopicHeuristic(questions, primaryPhrase, essentialTokens, isEnglish);
    return { questions: h, meta: { status: 'bypass_no_llm_heuristic' } };
  }
  if (isLlmCooldown()) {
    const h = applyTopicHeuristic(questions, primaryPhrase, essentialTokens, isEnglish);
    return { questions: h, meta: { status: 'bypass_cooldown_heuristic' } };
  }

  const prompt = `다음은 검색·커뮤니티에서 수집한 질문 목록이다.
아래 페이지 제목과 본문 요약은 **주제(seed 주제)를 파악하는 참고용**이다. 질문을 고를 때 **“이 페이지 본문에 답이 이미 있는가?”는 판단하지 마라.** (그건 다른 단계에서 처리한다.)
**같은 주제·같은 검색 의도**로 물을 법한 질문이면 포함한다. 요약에 답이 안 보여도, 사용자가 그 주제로 검색할 때 물을 법한 질문이면 포함한다.${strictHint}${videoHint}

**커뮤니티 컨텍스트:** 톤이 비격식이어도 괜찮다. **핵심 사용자 검색 의도**에 집중해줘.

**ZERO TOLERANCE (예외 없이 즉시 제외):** 성인(NSFW)·선정적·도박·불법 광고·스팸 관련 질문. 조금이라도 의심되거나 유해한 맥락이 있으면 반드시 제거해줘.

## 페이지 제목 (참고)
${title}

## 본문 요약 앞부분 (참고 — 답 포함 여부로 걸러내지 말 것)
${snippet}

## 수집된 질문
${list}

출력 형식: 번호만 쉼표로 구분. 예: 1,3,5,7
**주제와 무관한** 질문(완전히 다른 상품/도메인/주제)만 제외해줘. 주제와 맞는데 본문에 답이 없어 보여도 **포함**해줘.`;

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
    if (filtered.length > 0) {
      /** Keep full LLM selection — do not subset with token alignment here (that drops topic-relevant but “uncovered” questions). Coverage is decided later. */
      return { questions: filtered, meta: { status: 'ok_llm' } };
    }
    if (isVideo && questions.length >= 10) {
      return { questions: questions.slice(0, 10), meta: { status: 'ok_llm' } };
    }
    return { questions, meta: { status: 'ok_llm' } };
  } catch (err) {
    if (isQuotaError(err)) {
      console.warn('[GEMINI] quota exceeded - filterQuestionsByPageRelevance, applying topic heuristic');
    } else {
      console.warn('filterQuestionsByPageRelevance failed, applying topic heuristic', err);
    }
    const h = applyTopicHeuristic(questions, primaryPhrase, essentialTokens, isEnglish);
    return {
      questions: h,
      meta: { status: isQuotaError(err) ? 'bypass_quota_heuristic' : 'bypass_error_heuristic' },
    };
  }
}
