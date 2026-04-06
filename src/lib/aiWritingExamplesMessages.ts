/** User-facing copy for quota / degraded paths (shared by API + optional client fallback). */

export const AI_WRITING_QUOTA_NOTICE: Record<'ko' | 'en', string> = {
  ko: 'AI 작성 예시는 현재 API 사용 한도로 일시적으로 생성할 수 없습니다. 아래는 기본 템플릿 예시입니다. 잠시 후 다시 시도해 주세요.',
  en: 'AI writing examples are temporarily unavailable due to API usage limits. Showing template examples below. Please try again later.',
};
