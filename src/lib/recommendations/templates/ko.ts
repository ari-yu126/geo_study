/** Korean: short, plain writing guidance (no internal metric names in user strings). */

export const ko = {
  trend: {
    limited: '본문을 일부만 가져와 분석이 제한되었습니다. 전체가 수집되면 안내가 더 정확해집니다.',
    uncovered:
      '자주 묻는 질문에 직접 답하는 문장과 FAQ·소제목이 부족합니다. 검색·커뮤니티 질문을 글에 더 녹여 보세요.',
    opportunities: (n: number) =>
      `아래 순서로 요약·구조·블록을 채우면 됩니다. 눈에 띄는 포인트는 약 ${n}가지입니다.`,
    issues: (n: number) => `우선 손볼 곳이 ${n}가지 있습니다. 위에서부터 적용해 보세요.`,
    neutral:
      '막히는 부분은 없어 보입니다. 요약·목차·질문 답·출처를 다듬으면 읽기 좋아집니다.',
  },
  /** Gap = 실행 가능한 보완 한 줄 (문제 진술형/추상 표현 지양) */
  gap: {
    paragraph:
      '맨 앞에 3~4줄 요약을 두고, 길어지는 본문은 H2/H3로 끊어 읽기 쉽게 구성합니다.',
    structure: '상단에 한 줄 개요를 두고, 소제목(H2/H3)으로 흐름을 잡습니다.',
    questionCoverage: 'FAQ 또는 Q/A 형식으로 질문과 답을 쌍으로 추가합니다.',
    questionMatch: '자주 검색되는 질문 문구를 소제목(H2/H3)에 그대로 반영합니다.',
    citation: '숫자·단위·출처가 드러나는 짧은 문장을 늘립니다.',
    trust: '작성자·날짜·참고 링크·문의처를 한 블록에 모읍니다.',
    videoMetadata: '설명란에 챕터·짧은 요약·FAQ(질문·답)을 추가합니다.',
    /** When axis/issue signals give no concrete gap line */
    none: '현재 기준에서는 추가적인 콘텐츠 보완 포인트가 없습니다.',
  },
  headings: {
    faq: '자주 묻는 질문(FAQ)',
    summary: '요약 / 한눈에 보기',
    answerFirst: '결론 우선 요약',
    compare: '비교 / 차이',
    howTo: '사용 방법 / 절차',
    caveats: '주의사항',
    prosCons: '장점 / 단점',
    verdict: '총평 / 한 줄 결론',
    compareCriteria: '비교 기준',
    commercePolicy: '배송 / 반품 / AS',
    commerceSpec: '스펙 요약',
    videoChapters: '챕터(Chapters)',
    videoPinned: '고정 댓글 / 상단 요약',
    videoFaq: '설명란 FAQ',
  },
  blocks: {
    faqGeneric: 'FAQ: 질문 5~6개를 Q/A로 적습니다.',
    faqUncovered: (n: number) =>
      `FAQ: 글에 없는 질문 ${Math.min(6, n)}개를 골라 각각 한 줄 답을 붙입니다.`,
    topSummary: '상단 요약: 전체를 3~4줄로 정리합니다. 결론·대상 독자를 넣습니다.',
    citationParagraph: '근거 문단: 숫자·단위·출처가 보이는 짧은 문단을 둡니다.',
    summaryBullets: '불릿 요약: 결론 → 이유 → 주의 순으로 적습니다.',
    trustChecklist: '신뢰 블록: 작성자·수정일·참고 링크·문의를 한곳에 모읍니다.',
    prosCons: '장단점: 장점·단점·추천 대상으로 나눕니다.',
    verdict: '총평: 한 줄 결론과 이유를 한 문장으로 적습니다.',
    commerceSpecTable: '스펙 표: 항목과 값만 적습니다. 모르면 빈칸으로 둡니다.',
    commercePolicy: '정책: 배송·반품·AS·보증을 짧게 나열합니다.',
    videoChapters: '챕터: 구간마다 한 줄 설명을 붙입니다.',
    videoFaq: '설명란 FAQ: 질문 한 줄·답 한 줄로 적습니다.',
  },
  priority: {
    paragraph: '맨 위에 3~4줄 요약을 넣으세요.',
    structure: 'H2/H3와 한 줄 개요로 흐름을 보이게 하세요.',
    answerability: '첫 문단에 결론과 범위를 먼저 쓰세요.',
    questionCoverage: 'FAQ나 Q/A로 자주 묻는 질문에 답하세요.',
    questionMatch: '검색 질문 문장을 소제목에 그대로 쓰세요.',
    citation: '숫자·출처가 보이는 문장을 늘리세요.',
    trust: '작성자·날짜·출처·문의처를 한 블록에 모으세요.',
    videoMetadata: '설명란에 챕터·짧은 요약·FAQ를 넣으세요.',
  },
  predictedReason: '검색·커뮤니티에서 자주 나오는 질문',
};
