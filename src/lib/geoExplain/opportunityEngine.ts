import type {
  AnalysisResult,
  GeoAxis,
  GeoAxisScores,
  GeoIssue,
  GeoOpportunity,
  OpportunityTemplate,
  PageType,
} from '../analysisTypes';
import { getEditorialSubtypeTone, refineOpportunityForEditorialSubtype } from './editorialSubtypeWording';

const WEAK_AXIS = 45;

/** Default issue id → opportunity (stable ids for LLM linking) */
const ISSUE_TO_OPPORTUNITY: Partial<
  Record<
    string,
    { id: string; improvesAxis: GeoAxis; impact: 'high' | 'medium' | 'low'; title: string; rationale: string }
  >
> = {
  first_para: {
    id: 'opp_strong_opening',
    improvesAxis: 'answerability',
    impact: 'high',
    title: '도입부에 요약·가치 명시',
    rationale: '첫 문단에 주제와 핵심 가치를 밝히면 AI가 인용 여부를 빠르게 판단합니다.',
  },
  quotable: {
    id: 'opp_add_quotable_facts',
    improvesAxis: 'citation',
    impact: 'high',
    title: '수치·팩트 문장 추가',
    rationale: '짧고 구체적인 데이터 문장은 AI 직접 인용에 유리합니다.',
  },
  no_tables: {
    id: 'opp_add_comparison_table',
    improvesAxis: 'citation',
    impact: 'high',
    title: '비교표 추가',
    rationale: '구조화된 표는 AI가 근거를 추출하기 쉽습니다.',
  },
  title: {
    id: 'opp_fix_title',
    improvesAxis: 'structure',
    impact: 'high',
    title: 'Title 태그 보강',
    rationale: '명확한 title은 주제 신호로 직결됩니다.',
  },
  desc: {
    id: 'opp_fix_meta_description',
    improvesAxis: 'structure',
    impact: 'high',
    title: 'Meta description 작성',
    rationale: '요약형 description은 AI 스니펫·인용에 활용됩니다.',
  },
  author: {
    id: 'opp_add_author_trust',
    improvesAxis: 'trust',
    impact: 'medium',
    title: '저자·전문성 표시',
    rationale: 'E-E-A-T 신호는 신뢰 축을 직접 올립니다.',
  },
  pub_date: {
    id: 'opp_add_dates',
    improvesAxis: 'trust',
    impact: 'medium',
    title: '발행·수정일 표기',
    rationale: '최신성 신호는 AI 답변 선호에 영향을 줍니다.',
  },
  no_schema: {
    id: 'opp_add_jsonld',
    improvesAxis: 'structure',
    impact: 'medium',
    title: 'JSON-LD 구조화 데이터',
    rationale: '스키마는 엔티티 이해와 인용 후보를 넓힙니다.',
  },
  contact: {
    id: 'opp_add_contact',
    improvesAxis: 'trust',
    impact: 'low',
    title: '연락·상담 링크',
    rationale: '신뢰 신호로 평가되는 경우가 많습니다.',
  },
  no_lists: {
    id: 'opp_add_lists',
    improvesAxis: 'answerability',
    impact: 'low',
    title: '핵심을 목록으로 정리',
    rationale: '불릿·번호 목록은 추출 용이성을 높입니다.',
  },
};

function weakAxisOpportunities(axisScores: GeoAxisScores, pageType: PageType): GeoOpportunity[] {
  const axes: GeoAxis[] = [
    'citation',
    'paragraph',
    'answerability',
    'structure',
    'trust',
    'questionMatch',
    'questionCoverage',
  ];
  const out: GeoOpportunity[] = [];
  for (const ax of axes) {
    const v = axisScores[ax];
    if (typeof v !== 'number' || v >= WEAK_AXIS) continue;
    const impact = v < 25 ? 'high' : v < 35 ? 'medium' : 'low';
    out.push({
      id: `opp_boost_${ax}`,
      improvesAxis: ax,
      impact,
      title: `${ax} 축 강화`,
      rationale: `${ax} 점수가 ${v}입니다. 해당 축에 맞는 콘텐츠·구조·메타를 보강하세요.`,
      sourceRefs: { fromAxis: ax },
    });
  }
  if (pageType === 'video' && typeof axisScores.videoMetadata === 'number' && axisScores.videoMetadata < WEAK_AXIS) {
    out.push({
      id: 'opp_boost_video_metadata',
      improvesAxis: 'videoMetadata',
      impact: axisScores.videoMetadata < 25 ? 'high' : 'medium',
      title: '영상 메타데이터 강화',
      rationale: '제목·설명·챕터·FAQ를 구체화하면 영상 축 점수가 오릅니다.',
      sourceRefs: { fromAxis: 'videoMetadata' },
    });
  }
  return out;
}

function mergeTemplates(
  templates: OpportunityTemplate[] | undefined,
  existingIds: Set<string>
): GeoOpportunity[] {
  if (!templates?.length) return [];
  const out: GeoOpportunity[] = [];
  for (const t of templates) {
    if (existingIds.has(t.id)) continue;
    out.push({
      id: t.id,
      improvesAxis: t.improvesAxis,
      fixesIssueId: t.fixesIssueId,
      impact: t.impact,
      title: t.title,
      rationale: t.rationaleTemplate,
      sourceRefs: { templateId: t.id, fromIssueId: t.fixesIssueId },
    });
    existingIds.add(t.id);
  }
  return out;
}

export function runOpportunityEngine(
  result: AnalysisResult,
  issues: GeoIssue[],
  config: { opportunityTemplates?: OpportunityTemplate[] }
): GeoOpportunity[] {
  const pageType = (result.pageType as PageType) ?? 'editorial';
  const axisScores = result.axisScores ?? {
    citation: result.scores.citationScore,
    paragraph: result.scores.paragraphScore,
    answerability: result.scores.answerabilityScore,
    structure: result.scores.structureScore,
    trust: result.scores.trustScore,
    questionMatch: result.scores.questionMatchScore,
    questionCoverage: result.scores.questionCoverage,
  };

  const out: GeoOpportunity[] = [];
  const seen = new Set<string>();

  for (const issue of issues) {
    const map = ISSUE_TO_OPPORTUNITY[issue.id];
    if (map) {
      const opp: GeoOpportunity = {
        id: map.id,
        improvesAxis: map.improvesAxis,
        fixesIssueId: issue.id,
        impact: map.impact,
        title: map.title,
        rationale: map.rationale,
        sourceRefs: { fromIssueId: issue.id },
      };
      if (!seen.has(opp.id)) {
        out.push(opp);
        seen.add(opp.id);
      }
    }
  }

  for (const w of weakAxisOpportunities(axisScores, pageType)) {
    if (!seen.has(w.id)) {
      out.push(w);
      seen.add(w.id);
    }
  }

  for (const t of mergeTemplates(config.opportunityTemplates, seen)) {
    out.push(t);
  }

  const editorialTone = getEditorialSubtypeTone(result);
  if (editorialTone) {
    return out.map((o) => refineOpportunityForEditorialSubtype(o, editorialTone));
  }
  return out;
}
