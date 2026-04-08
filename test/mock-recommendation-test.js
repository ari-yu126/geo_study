// Mock recommendation pipeline test
// This script runs two mock test cases (video, commerce) without calling any external API.
// Usage: node test/mock-recommendation-test.js

function mockGeminiRephrase(context) {
  const { pageType, pageSignals, uncoveredQuestions } = context;
  if (pageType === 'video') {
    return JSON.stringify({
      strategySummary:
        'High channel authority but weak description — prioritize forming a concise knowledge base to convert authority into citeable answers.',
      contentGap:
        'Low description density and missing chapter markers; users ask specific how/compare questions not answered in description.',
      recommendedHeadings: ['Pinned summary (one-paragraph)', 'Chapters / Timestamped Guide', 'FAQ (short Q/A)'],
      copyPasteTemplates: [
        'Pinned summary: One-line takeaway + 2 bullets with key specs.',
        'Chapter example: 0:00 Intro / 02:15 Key comparison / 05:00 Summary',
        'FAQ example: Q. [question] A. [one-sentence answer] (2-3 items)',
      ],
      recommendations: [
        {
          title: 'Add pinned summary + chapters',
          reason:
            'High subscriberCount and viewCount indicate authority; descriptionQuality=low and hasTimestamp=false mean low info density — add chapters and pinned summary to surface answers.',
          impact: 'High',
          relatedSignals: ['subscriberCount', 'viewCount', 'descriptionQuality', 'hasTimestamp'],
        },
        {
          title: 'Create FAQ for top uncovered questions',
          reason: 'Uncovered questions present; brief FAQs increase immediate answerability for AI citation.',
          impact: 'Medium',
          relatedSignals: ['uncoveredQuestions'],
        },
      ],
    });
  }

  // commerce
  return JSON.stringify({
    strategySummary:
      'Good data density and price transparency but missing clear AS/shipping/returns policy — reinforce policy sections to improve conversion via trust.',
    contentGap:
      'Absence of explicit after-sales / shipping / warranty policy blocks reduces trust signals despite strong spec data.',
    recommendedHeadings: ['Price & Offer (clear)', 'Shipping / Returns / Warranty', 'Structured Spec Table', 'FAQ (purchase & policy)'],
    copyPasteTemplates: [
      'Spec table template: Model | Weight | Battery | Price',
      'Policy block: Shipping times, costs, return window, warranty length (bullet list)',
      'FAQ sample: Q. Shipping time? A. Typically 2-4 business days; expedited options...',
    ],
    recommendations: [
      {
        title: 'Add explicit Shipping/Returns/Warranty block',
        reason:
          'hasAsPolicy=false and uncoveredQuestions include shipping/returns — policy block will directly address main trust gap.',
        impact: 'High',
        relatedSignals: ['hasAsPolicy', 'uncoveredQuestions'],
      },
      {
        title: 'Keep structured spec tables visible near price',
        reason: 'dataDensityQuality=80 and hasPriceInfo=true support conversion; ensure spec tables are prominent.',
        impact: 'Medium',
        relatedSignals: ['dataDensityQuality', 'hasPriceInfo'],
      },
    ],
  });
}

function mapGeminiToGeo(parsed) {
  return {
    trendSummary: parsed.strategySummary,
    contentGapSummary: parsed.contentGap,
    actionPlan: {
      suggestedHeadings: parsed.recommendedHeadings,
      suggestedBlocks: parsed.copyPasteTemplates,
      priorityNotes: Array.isArray(parsed.recommendations)
        ? parsed.recommendations
            .map((r) => {
              const title = typeof r.title === 'string' ? r.title : '';
              const impact = typeof r.impact === 'string' ? r.impact : '';
              const related = Array.isArray(r.relatedSignals) ? r.relatedSignals.join(',') : '';
              return `${title} — ${impact} (${related})`;
            })
            .slice(0, 5)
        : undefined,
    },
    _structuredRecommendations: parsed.recommendations,
  };
}

function runTestCase(name, payload) {
  console.log('===', name, '===\n');
  console.log('1) INPUT PAYLOAD\n', JSON.stringify(payload, null, 2), '\n');

  const internalContext = {
    pageType: payload.pageType,
    pageSignals: payload.pageSignals,
    uncoveredQuestions: payload.uncoveredQuestions,
    currentIssues: payload.currentIssues || [],
    internalRecommendations: { /* base recommendations placeholder */ },
  };

  // 2) raw Gemini JSON (mock)
  const raw = mockGeminiRephrase(internalContext);
  console.log('2) RAW GEMINI JSON RESPONSE\n', raw, '\n');

  // 3) parsed final structured output
  let parsed;
  let parsedOk = true;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    parsedOk = false;
    parsed = null;
  }

  if (parsedOk) {
    const final = mapGeminiToGeo(parsed);
    console.log('3) PARSED FINAL STRUCTURED OUTPUT\n', JSON.stringify(final, null, 2), '\n');

    // 4) short validation notes
    const firstRec = Array.isArray(parsed.recommendations) ? parsed.recommendations[0] : null;
    const priorityMatch =
      firstRec && typeof firstRec.title === 'string' && firstRec.impact === 'High'
        ? true
        : false;
    // topic reflection: we treat presence of a topic signal as reflected if any recommendedHeadings mention a related word.
    const topicProvided = !!(payload.pageSignals && payload.pageSignals.topic);
    const topicReflected = topicProvided
      ? parsed.recommendedHeadings.some((h) => h.toLowerCase().includes(String(payload.pageSignals.topic).toLowerCase()))
      : 'N/A';

    console.log('4) VALIDATION NOTE');
    console.log('- strict JSON parsing succeeded:', parsedOk);
    console.log('- recommendation priority matched expectations (first rec impact === High):', priorityMatch);
    console.log('- detected topic reflected:', topicProvided ? topicReflected : 'No topic provided (N/A)');
    console.log('\n\n');
  } else {
    console.log('3) PARSE FAILED - cannot produce final structured output\n');
    console.log('4) VALIDATION NOTE');
    console.log('- strict JSON parsing succeeded:', parsedOk);
    console.log('- recommendation priority matched expectations:', 'N/A');
    console.log('- detected topic reflected:', 'N/A');
    console.log('\n\n');
  }
}

const videoPayload = {
  pageType: 'video',
  pageSignals: {
    subscriberCount: 500000,
    viewCount: 1000000,
    descriptionQuality: 'low',
    hasTimestamp: false,
  },
  uncoveredQuestions: ['What is the exact warranty period?', 'How does this compare to X?'],
  currentIssues: [],
};

const commercePayload = {
  pageType: 'commerce',
  pageSignals: {
    commerceScore: 62,
    dataDensityQuality: 80,
    hasPriceInfo: true,
    hasAsPolicy: false,
  },
  uncoveredQuestions: ['Is there expedited shipping?', 'What is return policy for opened items?'],
  currentIssues: [],
};

runTestCase('Test Case 1 — Video (High Authority + Low Density)', videoPayload);
runTestCase('Test Case 2 — Commerce (Strong Structure + Weak Policy)', commercePayload);

