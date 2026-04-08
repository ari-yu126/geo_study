import { evaluateCheck } from '../checkEvaluator';
import { DEFAULT_SCORING_CONFIG } from '../defaultScoringConfig';
import { loadActiveScoringConfig } from '../scoringConfigLoader';
import { isYouTubeUrl } from '../youtubeMetadataExtractor';
import type {
  AnalysisResult,
  GeoAxis,
  GeoAxisScores,
  GeoPassedItem,
  PageType,
  PassedRule,
} from '../analysisTypes';
import { buildAxisScores } from './axisScores';
import { buildPageFeaturesFromResult } from './buildPageFeatures';
import type { GeoRuleLayerResult } from './ruleEvaluation';
import { getEditorialSubtypeTone, refinePassedItemForEditorialSubtype } from './editorialSubtypeWording';

function isYouTubeResult(result: AnalysisResult): boolean {
  try {
    return isYouTubeUrl(result.url);
  } catch {
    return false;
  }
}

const HIGH_AXIS = 70;

function axisHighlights(axisScores: GeoAxisScores): GeoPassedItem[] {
  const out: GeoPassedItem[] = [];
  const pairs: [GeoAxis, number][] = [
    ['citation', axisScores.citation],
    ['answerability', axisScores.answerability],
    ['structure', axisScores.structure],
    ['trust', axisScores.trust],
    ['questionCoverage', axisScores.questionCoverage],
    ['questionMatch', axisScores.questionMatch],
  ];
  for (const [axis, v] of pairs) {
    if (v >= HIGH_AXIS) {
      out.push({
        id: `axis_strong_${axis}`,
        axis,
        label: `${axis} 축 우수`,
        description: `${axis} 축 점수가 ${v}로 높습니다.`,
        reason: '해당 축에서 AI 인용·요약에 유리한 신호가 강합니다.',
        sourceRefs: { axisScoreAtEmit: axisScores },
      });
    }
  }
  return out;
}

/** YouTube branch: config youtubePassedCheckRules + geo vid signals */
export async function runYoutubePassedEngine(result: AnalysisResult): Promise<GeoPassedItem[]> {
  const config = await loadActiveScoringConfig();
  const ytRules =
    config.youtubePassedCheckRules ?? DEFAULT_SCORING_CONFIG.youtubePassedCheckRules ?? [];
  const axisScores = result.axisScores;
  const out: GeoPassedItem[] = [];

  const title = result.meta.title ?? result.meta.ogTitle ?? '';
  const desc = result.meta.description ?? result.meta.ogDescription ?? '';
  const descLen = desc.length;
  const hasTimestamp = /\d{1,2}:\d{2}/.test(desc);
  const titleLower = title.toLowerCase();
  const hasSeedInTitle = result.seedKeywords.some(
    (kw) => kw.value.length >= 2 && titleLower.includes(kw.value.toLowerCase())
  );
  const infoDensityThreshold =
    ytRules.find((r) => r.check === 'yt_info_density')?.threshold ?? 300;

  for (const rule of ytRules) {
    let passed = false;
    if (rule.check === 'yt_title_opt') passed = hasSeedInTitle;
    else if (rule.check === 'yt_info_density') passed = descLen >= infoDensityThreshold;
    else if (rule.check === 'yt_chapter') passed = hasTimestamp;
    else if (rule.check === 'yt_authority') passed = result.trustSignals?.hasActualAiCitation === true;
    else if (rule.check === 'yt_gemini_factor') passed = Boolean(result.youtubeSuccessFactor);

    if (passed) {
      const reason =
        rule.check === 'yt_gemini_factor' && result.youtubeSuccessFactor
          ? result.youtubeSuccessFactor
          : rule.reason;
      out.push({
        id: rule.id,
        axis: 'videoMetadata',
        label: rule.label,
        description: rule.label,
        reason,
        sourceRefs: { ruleId: rule.id, axisScoreAtEmit: axisScores },
      });
    }
  }

  const geoVid: GeoPassedItem[] = [];
  if (descLen >= 300) {
    geoVid.push({
      id: 'geo_vid_structure',
      axis: 'videoMetadata',
      label: '설명란 구조/밀도 우수',
      description: '설명란에 충분한 정보가 있습니다.',
      reason: '설명란에 챕터나 충분한 정보가 있어 AI가 구간별로 인용하기 적합합니다.',
      sourceRefs: { axisScoreAtEmit: axisScores },
    });
  }
  if (hasTimestamp) {
    geoVid.push({
      id: 'geo_vid_timestamps',
      axis: 'videoMetadata',
      label: '타임스탬프(챕터) 존재',
      description: '타임스탬프가 있습니다.',
      reason: '타임스탬프가 있어 AI가 특정 구간을 인용하기 쉽습니다.',
      sourceRefs: { axisScoreAtEmit: axisScores },
    });
  }
  if (result.trustSignals?.hasDomainAuthority || result.trustSignals?.hasActualAiCitation) {
    geoVid.push({
      id: 'geo_vid_authority',
      axis: 'trust',
      label: '채널 권위 신호 존재',
      description: '권위 신호가 있습니다.',
      reason: '채널/도메인 권위 또는 실제 AI 인용 증거가 있어 인용 가능성이 높습니다.',
      sourceRefs: { axisScoreAtEmit: axisScores },
    });
  }
  if (
    (result.seedKeywords ?? []).some(
      (k) =>
        k.value.length >= 3 &&
        (title.toLowerCase().includes(k.value.toLowerCase()) ||
          desc.toLowerCase().includes(k.value.toLowerCase()))
    )
  ) {
    geoVid.push({
      id: 'geo_vid_topic_focus',
      axis: 'videoMetadata',
      label: '주제 초점이 명확',
      description: '제목·설명에 핵심 토큰이 포함됩니다.',
      reason: '제목·설명에 핵심 토큰이 포함되어 AI가 주제 중심으로 인용하기 쉽습니다.',
      sourceRefs: { axisScoreAtEmit: axisScores },
    });
  }
  if (desc.length > 0 && desc.split(/\n/).slice(0, 2).join(' ').length >= 120) {
    geoVid.push({
      id: 'geo_vid_context',
      axis: 'videoMetadata',
      label: '풍부한 설명(컨텍스트) 존재',
      description: '설명 앞부분에 컨텍스트가 있습니다.',
      reason: '설명란 앞부분에 요약/컨텍스트가 있어 AI가 해당 내용을 쉽게 인용합니다.',
      sourceRefs: { axisScoreAtEmit: axisScores },
    });
  }

  for (const pc of geoVid.reverse()) {
    if (!out.find((p) => p.id === pc.id)) out.unshift(pc);
  }

  const ax = axisScores ?? buildAxisScores(result);
  for (const h of axisHighlights(ax)) {
    if (!out.find((p) => p.id === h.id)) out.unshift(h);
  }

  return out;
}

function monthlyPassedRulesItems(
  result: AnalysisResult,
  features: ReturnType<typeof buildPageFeaturesFromResult>,
  rules: PassedRule[] | undefined,
  axisScores?: GeoAxisScores
): GeoPassedItem[] {
  if (!rules?.length) return [];
  const pageType = (result.pageType as PageType) ?? 'editorial';
  const out: GeoPassedItem[] = [];
  for (const r of rules) {
    if (r.pageTypes?.length && !r.pageTypes.includes(pageType)) continue;
    if (evaluateCheck(r.check, features, r.threshold)) {
      out.push({
        id: r.id,
        axis: r.axis,
        label: r.label,
        description: r.description,
        reason: r.reasonTemplate,
        sourceRefs: { ruleId: r.id, axisScoreAtEmit: axisScores },
      });
    }
  }
  return out;
}

/**
 * Editorial / commerce: rule-layer passes + bonus signals + optional monthly passedRules.
 */
export async function runEditorialPassedEngine(
  result: AnalysisResult,
  ruleLayer: GeoRuleLayerResult
): Promise<GeoPassedItem[]> {
  const config = await loadActiveScoringConfig();
  const features = buildPageFeaturesFromResult(result);
  const axisScores = result.axisScores;
  const pageType = (result.pageType as PageType) ?? 'editorial';

  const passed: GeoPassedItem[] = [...ruleLayer.rulePasses];

  if (result.trustSignals?.hasSearchExposure) {
    passed.push({
      id: 'search_exposure',
      axis: 'trust',
      label: '검색 상위 노출 확인',
      description: '검색 결과 노출 증거가 있습니다.',
      reason: 'Tavily 검색 결과에 해당 도메인이 노출되어 있어 증거 기반 권위 점수를 받았습니다.',
      sourceRefs: { axisScoreAtEmit: axisScores },
    });
  }

  const dataDense = result.paragraphStats?.dataDenseBlockCount ?? 0;
  if (dataDense >= 1) {
    const bonus = Math.min(50, dataDense * 3);
    passed.push({
      id: 'data_density_bonus',
      axis: 'density',
      label: '정보 밀도 가산점',
      description: '숫자·단위 밀집 블록이 있습니다.',
      reason: `핵심 데이터(숫자/단위)가 ${dataDense}개 블록 포함되어 +${bonus}점 가산받았습니다.`,
      sourceRefs: { axisScoreAtEmit: axisScores },
    });
  }

  try {
    const geoPassed: GeoPassedItem[] = [];
    if (pageType === 'editorial') {
      if (evaluateCheck('first_paragraph_quality', features, 40)) {
        geoPassed.push({
          id: 'geo_first_summary',
          axis: 'answerability',
          label: '강력한 요약/결론 존재',
          description: '도입부 요약 신호가 있습니다.',
          reason: '도입부에 요약 또는 결론이 있어 AI가 빠르게 인용할 수 있습니다.',
          sourceRefs: { axisScoreAtEmit: axisScores },
        });
      }
      if (evaluateCheck('quotable_sentences_min', features, 3)) {
        geoPassed.push({
          id: 'geo_quotable',
          axis: 'citation',
          label: '인용 가능한 문장 다수',
          description: '인용 후보 문장이 충분합니다.',
          reason: '수치·팩트 기반의 짧은 문장이 있어 AI 인용 확률이 높습니다.',
          sourceRefs: { axisScoreAtEmit: axisScores },
        });
      }
      if (evaluateCheck('lists_min', features, 1)) {
        geoPassed.push({
          id: 'geo_list_structure',
          axis: 'answerability',
          label: '목록 구조 활용',
          description: '목록 구조가 있습니다.',
          reason: '목록형 구조는 AI가 핵심을 추출하기에 용이합니다.',
          sourceRefs: { axisScoreAtEmit: axisScores },
        });
      }
      if (evaluateCheck('tables_min', features, 1)) {
        geoPassed.push({
          id: 'geo_comparison',
          axis: 'answerability',
          label: '비교 구조(테이블) 존재',
          description: '테이블이 있습니다.',
          reason: '비교 표는 구조화된 근거를 제공하여 AI 인용에 유리합니다.',
          sourceRefs: { axisScoreAtEmit: axisScores },
        });
      }
      if ((features.seedKeywords ?? []).length >= 3) {
        geoPassed.push({
          id: 'geo_topical_focus',
          axis: 'questionMatch',
          label: '명확한 주제 초점',
          description: '시드 키워드가 충분합니다.',
          reason: '핵심 주제 토큰이 명확해 AI가 주제 중심으로 인용하기 쉽습니다.',
          sourceRefs: { axisScoreAtEmit: axisScores },
        });
      }
    }
    if (pageType === 'commerce') {
      if (evaluateCheck('tables_min', features, 1) || evaluateCheck('data_dense_blocks_min', features, 1)) {
        geoPassed.push({
          id: 'geo_product_table',
          axis: 'answerability',
          label: '제품 비교/스펙 표 존재',
          description: '스펙/비교 표 신호가 있습니다.',
          reason: '스펙 표·비교표는 AI가 직접 인용하는 핵심 신호입니다.',
          sourceRefs: { axisScoreAtEmit: axisScores },
        });
      }
      if (evaluateCheck('has_price_info', features)) {
        geoPassed.push({
          id: 'geo_price_info',
          axis: 'answerability',
          label: '가격/옵션 정보 명확',
          description: '가격 정보가 있습니다.',
          reason: '가격·옵션 정보는 구매 관련 질문에 대한 인용 근거가 됩니다.',
          sourceRefs: { axisScoreAtEmit: axisScores },
        });
      }
      if (evaluateCheck('lists_min', features, 1)) {
        geoPassed.push({
          id: 'geo_recommendation_structure',
          axis: 'answerability',
          label: '권장/추천 구조 존재',
          description: '목록형 추천 구조가 있습니다.',
          reason: '추천·장단점 구조가 있어 AI가 추천 문장을 쉽게 생성합니다.',
          sourceRefs: { axisScoreAtEmit: axisScores },
        });
      }
      if ((features.contentQuality.productSpecBlockCount ?? 0) >= 1) {
        geoPassed.push({
          id: 'geo_spec_blocks',
          axis: 'citation',
          label: '제품 스펙 블록 존재',
          description: '스펙 블록이 있습니다.',
          reason: '제품 규격·수치 블록은 AI 인용 증거로 활용됩니다.',
          sourceRefs: { axisScoreAtEmit: axisScores },
        });
      }
    }
    if (pageType === 'video' || isYouTubeResult(result)) {
      const desc = (result.meta.description ?? result.meta.ogDescription ?? '').trim();
      const title = (result.meta.title ?? '').trim();
      const hasTimestamps = /\d{1,2}:\d{2}/.test(desc);
      if (hasTimestamps || desc.length >= 300 || desc.split(/\n/).filter(Boolean).length >= 3) {
        geoPassed.push({
          id: 'geo_vid_structure',
          axis: 'videoMetadata',
          label: '설명란 구조/밀도 우수',
          description: '설명란 구조가 좋습니다.',
          reason: '설명란에 챕터나 충분한 정보가 있어 AI가 구간별로 인용하기 적합합니다.',
          sourceRefs: { axisScoreAtEmit: axisScores },
        });
      }
      if (result.trustSignals?.hasDomainAuthority || result.trustSignals?.hasActualAiCitation) {
        geoPassed.push({
          id: 'geo_vid_authority',
          axis: 'trust',
          label: '채널 권위 신호 존재',
          description: '권위 신호가 있습니다.',
          reason: '채널/도메인 권위 또는 실제 AI 인용 증거가 있어 인용 가능성이 높습니다.',
          sourceRefs: { axisScoreAtEmit: axisScores },
        });
      }
      if (desc.length > 0 && desc.split(/\n/).slice(0, 2).join(' ').length >= 120) {
        geoPassed.push({
          id: 'geo_vid_context',
          axis: 'videoMetadata',
          label: '풍부한 설명(컨텍스트) 존재',
          description: '설명 앞부분에 컨텍스트가 있습니다.',
          reason: '설명란 앞부분에 요약/컨텍스트가 있어 AI가 해당 내용을 쉽게 인용합니다.',
          sourceRefs: { axisScoreAtEmit: axisScores },
        });
      }
      const combined = (title + ' ' + desc).toLowerCase();
      if (
        (result.seedKeywords ?? []).some(
          (k) => k.value.length >= 3 && combined.includes(k.value.toLowerCase())
        )
      ) {
        geoPassed.push({
          id: 'geo_vid_topic_focus',
          axis: 'videoMetadata',
          label: '주제 초점이 명확',
          description: '제목·설명에 토큰이 포함됩니다.',
          reason: '제목·설명에 핵심 토큰이 포함되어 AI가 주제 중심으로 인용하기 쉽습니다.',
          sourceRefs: { axisScoreAtEmit: axisScores },
        });
      }
      if (desc.length >= 300) {
        geoPassed.push({
          id: 'geo_vid_desc_density',
          axis: 'videoMetadata',
          label: '설명란 정보 밀도 충분',
          description: '설명이 충분히 깁니다.',
          reason: '설명란이 충분히 길어 AI가 요약·인용하기에 적합합니다.',
          sourceRefs: { axisScoreAtEmit: axisScores },
        });
      }
      if (hasTimestamps) {
        geoPassed.push({
          id: 'geo_vid_timestamps',
          axis: 'videoMetadata',
          label: '타임스탬프(챕터) 존재',
          description: '타임스탬프가 있습니다.',
          reason: '타임스탬프가 있어 AI가 특정 구간을 인용하기 쉽습니다.',
          sourceRefs: { axisScoreAtEmit: axisScores },
        });
      }
      if (
        (result.seedKeywords ?? []).some(
          (k) => k.value.length >= 3 && title.toLowerCase().includes(k.value.toLowerCase())
        )
      ) {
        geoPassed.push({
          id: 'geo_vid_title_kw',
          axis: 'videoMetadata',
          label: '키워드 풍부한 제목',
          description: '제목에 키워드가 있습니다.',
          reason: '제목에 핵심 키워드가 있어 검색·AI 인용에 유리합니다.',
          sourceRefs: { axisScoreAtEmit: axisScores },
        });
      }
      if (desc.length > 0 && desc.split(/\n/).slice(0, 2).join(' ').length >= 120) {
        geoPassed.push({
          id: 'geo_vid_desc_summary',
          axis: 'videoMetadata',
          label: '설명란 요약 존재',
          description: '설명 앞부분 요약이 있습니다.',
          reason: '설명란의 앞부분에 요약이 있어 AI가 인용하기 쉽습니다.',
          sourceRefs: { axisScoreAtEmit: axisScores },
        });
      }
    }

    for (const pc of geoPassed) {
      if (!passed.find((p) => p.id === pc.id)) passed.unshift(pc);
    }
  } catch {
    // ignore
  }

  const monthly = monthlyPassedRulesItems(result, features, config.passedRules, axisScores);
  for (const m of monthly) {
    if (!passed.find((p) => p.id === m.id)) passed.unshift(m);
  }

  const axScores = axisScores ?? buildAxisScores(result);
  for (const h of axisHighlights(axScores)) {
    if (!passed.find((p) => p.id === h.id)) passed.unshift(h);
  }

  const editorialTone = getEditorialSubtypeTone(result);
  if (editorialTone) {
    for (let i = 0; i < passed.length; i++) {
      passed[i] = refinePassedItemForEditorialSubtype(passed[i]!, editorialTone);
    }
  }

  return passed;
}
