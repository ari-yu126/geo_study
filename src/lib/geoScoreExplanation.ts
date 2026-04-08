/**
 * Human-readable GEO score explanation from scores, answerability rule rows, platform, editorial subtype.
 * Does not expose raw debug JSON. Scoring math is unchanged.
 */

import type { AnalysisResult, AnswerabilityRuleDebugRow, GeoScoreExplanation, PlatformType } from './analysisTypes';
import { buildAxisScores } from './geoExplain/axisScores';
import { isHostedBlogPlatform } from './geoExplain/platformIssueWording';

const AXIS_LABEL: Record<string, string> = {
  citation: 'AI 인용·발췌',
  paragraph: '문단 품질',
  answerability: '답변가능성',
  structure: '구조·메타·헤딩',
  trust: '신뢰·권위 신호',
  questionMatch: '검색 질문 적합도',
  questionCoverage: '질문 커버리지',
  density: '정보 밀도',
  videoMetadata: '영상 메타·설명',
};

/** Rule id → short Korean lines (strength when passed, weakness when failed). */
const RULE_KO: Record<string, { strength: string; weakness: string }> = {
  ed_first_para: {
    strength: '도입부 첫 블록이 충분히 길어 주제를 드러냅니다.',
    weakness: '도입부가 짧거나 핵심 요약이 약합니다.',
  },
  ed_definition: {
    strength: '정의·설명형 문장이 있어 맥락 파악이 쉽습니다.',
    weakness: '주제를 한 번에 짚는 정의·설명 문장이 부족합니다.',
  },
  ed_intro_takeaway: {
    strength: '서두에서 결론·요지가 드러나는 편입니다.',
    weakness: '서두에 한눈에 들어오는 요지·결론이 약합니다.',
  },
  ed_reco_conclusion: {
    strength: '추천·결론형 문장이 여럿 있어 판단 근거를 주기 쉽습니다.',
    weakness: '추천·결론을 한 줄로 말해 주는 문장이 부족합니다.',
  },
  ed_pros_cons: {
    strength: '장단점·비교 표현이 있어 선택 근거가 분명합니다.',
    weakness: '장단점·비교가 드러나지 않아 판단 근거가 약합니다.',
  },
  ed_audience: {
    strength: '누구에게 맞는지(또는 안 맞는지) 안내가 있습니다.',
    weakness: '독자·상황에 맞는지 구분하는 안내가 부족합니다.',
  },
  ed_decisive: {
    strength: '단정형·답변형 문장이 있어 인용하기 좋습니다.',
    weakness: '명확히 결론 내리는 문장이 부족합니다.',
  },
  ed_title_intro: {
    strength: '제목과 도입 주제가 대체로 맞물립니다.',
    weakness: '제목과 본문 도입의 주제 정렬이 약합니다.',
  },
  ed_lists: {
    strength: '목록 구조로 정보가 나뉘어 읽기 쉽습니다.',
    weakness: '목록·단계 구조가 부족합니다.',
  },
  ed_list_or_choice: {
    strength: '목록 안내 또는 선택 기준 표현이 있습니다.',
    weakness: '목록·선택 기준 안내가 부족합니다.',
  },
  ed_content_len: {
    strength: '본문 분량이 충분해 주제를 덮기 좋습니다.',
    weakness: '본문 분량이 부족해 정보 깊이가 약해 보일 수 있습니다.',
  },
  ed_questions: {
    strength: '질문형 소제목·FAQ 성격의 헤딩이 있습니다.',
    weakness: '질문형 소제목·FAQ 패턴이 부족합니다.',
  },
  ed_images: {
    strength: '이미지 등 시각 자료가 있어 주제를 보완합니다.',
    weakness: '시각 자료가 없어 설명만으로 읽히는 편입니다.',
  },
  first_para: {
    strength: '첫 문단 품질이 기준을 충족합니다.',
    weakness: '첫 문단이 짧거나 핵심이 드러나지 않습니다.',
  },
  definition: {
    strength: '정의·설명 패턴이 감지됩니다.',
    weakness: '정의·설명 패턴이 약합니다.',
  },
  quotable: {
    strength: '인용하기 좋은 구체적 문장·수치가 있습니다.',
    weakness: '짧고 인용하기 좋은 문장·수치가 부족합니다.',
  },
  content_len: {
    strength: '콘텐츠 분량이 충분합니다.',
    weakness: '콘텐츠 분량이 부족합니다.',
  },
  content_deep: {
    strength: '심층 분량이 있어 정보 이득이 큽니다.',
    weakness: '심층 서술이 부족합니다.',
  },
  tables: {
    strength: '표·비교 블록이 있어 추출이 쉽습니다.',
    weakness: '표·비교 블록이 없습니다.',
  },
  lists: {
    strength: '목록이 충분히 활용됩니다.',
    weakness: '목록 활용이 부족합니다.',
  },
  questions: {
    strength: '질문·답변 패턴이 있습니다.',
    weakness: '질문·답변 패턴이 부족합니다.',
  },
  step: {
    strength: '단계별 안내 구조가 있습니다.',
    weakness: '단계별 안내 구조가 약합니다.',
  },
  images: {
    strength: '이미지가 포함되어 있습니다.',
    weakness: '이미지가 부족합니다.',
  },
  price: {
    strength: '가격·비용 정보가 드러납니다.',
    weakness: '가격·비용 정보가 부족합니다.',
  },
  data_dense: {
    strength: '스펙·수치 블록이 있어 데이터 신뢰가 있습니다.',
    weakness: '스펙·수치 블록이 부족합니다.',
  },
};

function axisEntries(result: AnalysisResult): { key: string; label: string; score: number }[] {
  const ax = result.axisScores ?? buildAxisScores(result);
  const s = result.scores;
  const out: { key: string; label: string; score: number }[] = [];
  if ((s.citationScore ?? -1) >= 0) {
    out.push({ key: 'citation', label: AXIS_LABEL.citation, score: ax.citation });
  }
  out.push(
    { key: 'paragraph', label: AXIS_LABEL.paragraph, score: ax.paragraph },
    { key: 'answerability', label: AXIS_LABEL.answerability, score: ax.answerability },
    { key: 'structure', label: AXIS_LABEL.structure, score: ax.structure },
    { key: 'trust', label: AXIS_LABEL.trust, score: ax.trust },
    { key: 'questionMatch', label: AXIS_LABEL.questionMatch, score: ax.questionMatch },
    { key: 'questionCoverage', label: AXIS_LABEL.questionCoverage, score: ax.questionCoverage }
  );
  if (typeof ax.density === 'number') {
    out.push({ key: 'density', label: AXIS_LABEL.density, score: ax.density });
  }
  if (result.pageType === 'video' && typeof ax.videoMetadata === 'number') {
    out.push({ key: 'videoMetadata', label: AXIS_LABEL.videoMetadata, score: ax.videoMetadata });
  }
  return out;
}

function axisStrengthLine(label: string, score: number): string {
  return `${label}이(가) ${score}점으로 상대적으로 양호합니다.`;
}

function axisWeaknessLine(label: string, score: number): string {
  return `${label}이(가) ${score}점으로 상대적으로 낮아 개선 여지가 있습니다.`;
}

function editorialSubtypePhrase(subtype: AnalysisResult['editorialSubtype']): string | null {
  switch (subtype) {
    case 'site_info':
      return '기업·소개형 페이지는 서술형 정보와 구조화가 점수에 크게 반영됩니다.';
    case 'blog':
      return '블로그형 글은 도입 요약·질문형 소제목이 점수에 크게 반영됩니다.';
    case 'mixed':
      return '콘텐츠 성격이 혼합되어 있어 구조·요약 신호가 중요합니다.';
    default:
      return null;
  }
}

function platformPhrase(platform: PlatformType | undefined): string | null {
  if (!isHostedBlogPlatform(platform)) return null;
  return '호스팅 블로그는 HTML 메타·스키마를 직접 넣기 어려울 수 있어, 제목·도입 요약·본문 구조로 보완하는 것이 현실적입니다.';
}

function trustCapPhrase(result: AnalysisResult): string | null {
  const band = result.scores.scoreBlendDebug?.trustCapBand;
  if (!band || band === 'none') return null;
  if (band === 'max_79') {
    return '검색 노출만 있고 도메인·인용 증거가 제한적이면 점수 상한이 적용될 수 있습니다.';
  }
  return '검색 노출·도메인 권위·인용 증거가 제한적이면 점수 상한이 적용될 수 있습니다.';
}

function ruleLine(row: AnswerabilityRuleDebugRow, passed: boolean): string | null {
  const m = RULE_KO[row.id];
  if (m) return passed ? m.strength : m.weakness;
  const label = row.label?.trim();
  if (!label) return null;
  return passed ? `${label} 기준을 충족합니다.` : `${label} 기준을 충족하지 못했습니다.`;
}

/**
 * Build a concise score explanation. Safe for UI; no internal IDs in output except plain language.
 */
export function buildGeoScoreExplanation(result: AnalysisResult): GeoScoreExplanation {
  const scores = result.scores;
  const final = scores.finalScore;
  const entries = axisEntries(result).filter((e) => Number.isFinite(e.score));

  const sortedDesc = [...entries].sort((a, b) => b.score - a.score);
  const sortedAsc = [...entries].sort((a, b) => a.score - b.score);

  const strongThreshold = 62;
  const weakThreshold = 48;

  const axisStrengths = sortedDesc
    .filter((e) => e.score >= strongThreshold)
    .slice(0, 3)
    .map((e) => axisStrengthLine(e.label, Math.round(e.score)));

  const axisWeaknesses = sortedAsc
    .filter((e) => e.score < weakThreshold)
    .slice(0, 3)
    .map((e) => axisWeaknessLine(e.label, Math.round(e.score)));

  const rows = scores.answerabilityDebug?.ruleRows?.filter((r) => !r.skippedForPageType) ?? [];
  const passedRows = rows.filter((r) => r.passed);
  const failedRows = rows.filter((r) => !r.passed);

  const ruleStrengths = [...passedRows]
    .sort((a, b) => b.earnedPoints - a.earnedPoints)
    .slice(0, 3)
    .map((r) => ruleLine(r, true))
    .filter((s): s is string => Boolean(s));

  const ruleWeaknesses = [...failedRows]
    .sort((a, b) => b.maxPoints - a.maxPoints)
    .slice(0, 3)
    .map((r) => ruleLine(r, false))
    .filter((s): s is string => Boolean(s));

  /** Merge axis + rule bullets, cap 3, de-dupe by prefix */
  function mergeBullets(axis: string[], rules: string[], cap: number): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const line of [...axis, ...rules]) {
      const key = line.slice(0, 24);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(line);
      if (out.length >= cap) break;
    }
    return out;
  }

  let strengths = mergeBullets(axisStrengths, ruleStrengths, 3);
  if (strengths.length === 0) {
    const top = sortedDesc[0];
    if (top) strengths = [axisStrengthLine(top.label, Math.round(top.score))];
  }

  let weaknesses = mergeBullets(axisWeaknesses, ruleWeaknesses, 3);
  if (weaknesses.length === 0) {
    const bottom = sortedAsc[0];
    if (bottom && bottom.score < 60) weaknesses = [axisWeaknessLine(bottom.label, Math.round(bottom.score))];
  }

  const weakest = sortedAsc[0];
  const secondWeak = sortedAsc[1];

  let summary: string;
  if (final >= 78) {
    summary = `종합 점수는 ${final}점으로, AI가 인용·요약하기에 전반적으로 유리한 편입니다.`;
  } else if (final >= 58) {
    summary = `종합 점수는 ${final}점으로, 일부 영역은 양호하나 균형을 맞추면 더 오를 여지가 있습니다.`;
  } else {
    summary = `종합 점수는 ${final}점으로, 답변가능성·구조·신뢰·질문 대응 중 다수가 아직 약해 보일 수 있습니다.`;
  }

  if (weakest && final < 78 && weakest.score < 58) {
    if (secondWeak && secondWeak.score < 58) {
      summary += ` 특히 ${weakest.label}(${Math.round(weakest.score)}점)과 ${secondWeak.label}(${Math.round(secondWeak.score)}점)을 우선 보완하면 체감이 큽니다.`;
    } else {
      summary += ` 특히 ${weakest.label}(${Math.round(weakest.score)}점)을 우선 보완하면 체감이 큽니다.`;
    }
  }

  const spread =
    sortedDesc.length > 0 && sortedAsc.length > 0 ? sortedDesc[0].score - sortedAsc[0].score : 0;
  if (weaknesses.length === 0 && spread > 20 && sortedAsc.length >= 2) {
    weaknesses = sortedAsc
      .slice(0, 2)
      .map((e) => axisWeaknessLine(e.label, Math.round(e.score)));
  }

  const extra: string[] = [];
  if (result.limitedAnalysis || scores.extractionIncomplete) {
    extra.push('일부 본문이 충분히 수집되지 않았을 수 있어 점수가 보수적으로 나올 수 있습니다.');
  }
  const sub = editorialSubtypePhrase(result.editorialSubtype);
  if (sub) extra.push(sub);
  const plat = platformPhrase(result.platform);
  if (plat) extra.push(plat);
  const cap = trustCapPhrase(result);
  if (cap) extra.push(cap);

  if (extra.length > 0) {
    summary += ' ' + extra.join(' ');
  }

  return {
    summary: summary.trim(),
    strengths: strengths.slice(0, 3),
    weaknesses: weaknesses.slice(0, 3),
  };
}
