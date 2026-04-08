/** English: short, plain writing guidance (no internal metric names in user strings). */

export const en = {
  trend: {
    limited: 'We only captured part of the page. Guidance improves when the full text is available.',
    uncovered:
      'Add direct answers, FAQ blocks, and clearer headings. Many common questions are still missing from the page.',
    opportunities: (n: number) =>
      `Fill in summary, structure, and blocks in the order below. About ${n} clear improvements stand out.`,
    issues: (n: number) => `Start with the biggest wins. There are ${n} areas to improve.`,
    neutral:
      'No hard blockers. Tighten summaries, headings, answers to common questions, and sources.',
  },
  gap: {
    paragraph: 'The opening summary is weak and the body reads long.',
    structure: 'Headings and a short outline are hard to see.',
    questionCoverage: 'The page does not answer common reader questions directly.',
    questionMatch: 'Search question phrases do not show clearly in titles or body text.',
    citation: 'There are few short lines with numbers, sources, or clear facts.',
    trust: 'Author, dates, sources, or contact details are missing or hard to find.',
    videoMetadata: 'The description needs chapters, a short summary, or FAQ lines.',
    issuesFooter: (n: number) => `${n} related items also appear in the detailed list.`,
  },
  headings: {
    faq: 'FAQ',
    summary: 'Executive summary / at-a-glance',
    answerFirst: 'Answer-first summary',
    compare: 'Comparison / differences',
    howTo: 'How to use / steps',
    caveats: 'Caveats',
    prosCons: 'Pros & cons',
    verdict: 'Verdict (one line)',
    compareCriteria: 'Comparison criteria',
    commercePolicy: 'Shipping / returns / support',
    commerceSpec: 'Spec summary',
    videoChapters: 'Chapters / timestamps',
    videoPinned: 'Pinned comment / top summary',
    videoFaq: 'Description FAQ',
  },
  blocks: {
    faqGeneric: 'FAQ: write 5–6 questions and short answers.',
    faqUncovered: (n: number) =>
      `FAQ: pick ${Math.min(6, n)} unanswered questions and add one line per answer.`,
    topSummary: 'Top summary: 3–4 lines on scope, audience, and takeaway.',
    citationParagraph: 'Evidence: one short paragraph with numbers, units, or sources.',
    summaryBullets: 'Bullets: takeaway, reason, then caveats.',
    trustChecklist: 'Trust block: author, updated date, links, and contact in one place.',
    prosCons: 'Pros/cons: pros, cons, and who it is for.',
    verdict: 'Verdict: one-line conclusion plus one reason.',
    commerceSpecTable: 'Spec table: attribute and value only; skip unknown fields.',
    commercePolicy: 'Policy: shipping, returns, warranty in short bullets.',
    videoChapters: 'Chapters: one line per segment.',
    videoFaq: 'Description FAQ: one Q and one A per line.',
  },
  priority: {
    paragraph: 'Add a 3–4 line summary at the top.',
    structure: 'Add H2/H3 titles and a one-line outline.',
    answerability: 'Put the conclusion and scope in the first paragraph.',
    questionCoverage: 'Add an FAQ that answers common questions.',
    questionMatch: 'Use search question phrases as section headings.',
    citation: 'Add numbers, sources, or facts in short lines.',
    trust: 'Put author, updated date, sources, and contact in one block.',
    videoMetadata: 'Add chapters, a short summary, and FAQ to the description.',
  },
  predictedReason: 'Common question from search or community discussions',
};
