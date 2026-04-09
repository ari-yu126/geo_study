import type {
  AnalysisResult,
  AuditIssue,
  GeoAxis,
  GeoAxisScores,
  GeoIssue,
  GeoIssueCategory,
  PageType,
} from '../analysisTypes';
import { getEditorialSubtypeTone, refineGeoIssueForEditorialSubtype } from './editorialSubtypeWording';
import { refineGeoIssueForPlatform } from './platformIssueWording';
import { buildAxisScores } from './axisScores';
import type { GeoRuleLayerResult } from './ruleEvaluation';

const YOUTUBE_ISSUE_DESC_BLACKLIST = [
  /글자\s*수/i,
  /테이블\s*(없음|부족)/i,
  /목록\s*(ul|ol|없음|부족)/i,
  /콘텐츠\s*분량/i,
  /본문\s*(길이|분량)/i,
  /(?:content|본문)\s*length/i,
];

const STRUCTURE_ISSUE_PATTERNS = [
  /\bH1\b/i,
  /\bH2\b/i,
  /\bH3\b/i,
  /헤딩\s*구조/i,
  /헤딩\s*태그/i,
  /헤딩\s*(부족|없음)/i,
  /구조\s*화/i,
];

function isYouTubeInappropriateIssueText(label: string, description: string): boolean {
  const text = `${label} ${description}`;
  return YOUTUBE_ISSUE_DESC_BLACKLIST.some((re) => re.test(text));
}

function isStructureRelatedIssueText(label: string, description: string): boolean {
  const text = `${label} ${description}`;
  return STRUCTURE_ISSUE_PATTERNS.some((re) => re.test(text));
}

function mapYoutubeAuditIssueToGeo(issue: AuditIssue, axisScores?: GeoAxisScores): GeoIssue {
  return {
    id: issue.id,
    category: 'opportunities',
    axis: 'videoMetadata',
    severity: issue.priority,
    label: issue.label,
    description: issue.description,
    fix: '영상 설명란에 요약·챕터(타임스탬프)·FAQ를 보강해 AI 인용에 적합한 메타데이터를 갖추세요.',
    sourceRefs: { ruleId: issue.id, axisScoreAtEmit: axisScores },
  };
}

const AXIS_THRESHOLD_WEAK = 40;
const AXIS_KEYS_MAIN: GeoAxis[] = [
  'citation',
  'paragraph',
  'answerability',
  'structure',
  'trust',
  'questionMatch',
  'questionCoverage',
];

function axisThresholdIssues(
  axisScores: GeoAxisScores,
  pageType: PageType,
  axesFromRules: Set<GeoAxis>
): GeoIssue[] {
  const out: GeoIssue[] = [];
  for (const key of AXIS_KEYS_MAIN) {
    const v = axisScores[key];
    if (typeof v !== 'number' || v >= AXIS_THRESHOLD_WEAK) continue;
    if (axesFromRules.has(key)) continue;
    const sev = v < 25 ? 'high' : 'medium';
    const cat: GeoIssueCategory = 'weak_signals';
    out.push({
      id: `axis_weak_${key}`,
      category: cat,
      axis: key,
      severity: sev,
      label: `${key} 축 점수 낮음`,
      description: `${key} 축 점수가 ${v}로 낮아 AI 인용·요약에 불리할 수 있습니다.`,
      fix: `${key}와 관련된 콘텐츠·구조·신호를 보강하세요.`,
      sourceRefs: {
        axisScoreAtEmit: axisScores,
      },
    });
  }
  if (pageType === 'video' && typeof axisScores.videoMetadata === 'number') {
    const v = axisScores.videoMetadata;
    if (v < AXIS_THRESHOLD_WEAK && !axesFromRules.has('videoMetadata')) {
      out.push({
        id: 'axis_weak_videoMetadata',
        category: 'weak_signals',
        axis: 'videoMetadata',
        severity: v < 25 ? 'high' : 'medium',
        label: '영상 메타데이터 품질 낮음',
        description: `영상 메타데이터 종합 점수가 ${v}입니다.`,
        fix: '제목·설명·챕터를 구체화하고 검색 질문과의 정합성을 높이세요.',
        sourceRefs: { axisScoreAtEmit: axisScores },
      });
    }
  }
  return out;
}

/** Keep first occurrence when ids collide (reserved axis_weak_* vs upstream audit ids, duplicate rule rows). */
export function dedupeGeoIssuesById(issues: GeoIssue[]): GeoIssue[] {
  const seen = new Set<string>();
  const out: GeoIssue[] = [];
  for (const issue of issues) {
    if (seen.has(issue.id)) continue;
    seen.add(issue.id);
    out.push(issue);
  }
  return out;
}

/**
 * Video pipeline: Gemini/precomputed audit issues → GeoIssue.
 */
export function runYoutubeIssueEngine(result: AnalysisResult): GeoIssue[] {
  const raw = result.auditIssues ?? [];
  const axisScores = result.axisScores ?? buildAxisScores(result);
  let filtered = raw.filter((issue) => !isYouTubeInappropriateIssueText(issue.label, issue.description));
  if (result.trustSignals?.hasActualAiCitation) {
    filtered = filtered.filter(
      (issue) => !isStructureRelatedIssueText(issue.label, issue.description)
    );
  }
  const mapped = filtered.map((issue) => mapYoutubeAuditIssueToGeo(issue, axisScores));
  const axesFromRules = new Set(mapped.map((i) => i.axis));
  const axisIssues = axisThresholdIssues(axisScores, 'video', axesFromRules);
  return dedupeGeoIssuesById([...mapped, ...axisIssues]);
}

/**
 * Editorial / commerce / generic web: configured rules + axis thresholds.
 */
export async function runEditorialIssueEngine(
  result: AnalysisResult,
  ruleLayer: GeoRuleLayerResult
): Promise<GeoIssue[]> {
  const axisScores = result.axisScores ?? buildAxisScores(result);
  const pageType = (result.pageType as PageType) ?? 'editorial';
  const axesFromRules = new Set(ruleLayer.ruleFailures.map((i) => i.axis));
  const profileOwned = new Set(ruleLayer.profileOwnedRuleIds);
  const axisIssues = axisThresholdIssues(axisScores, pageType, axesFromRules).filter(
    (i) => !profileOwned.has(i.id)
  );

  let failures = [...ruleLayer.ruleFailures, ...axisIssues];

  if (ruleLayer.skipTextOnlyRules) {
    failures = failures.filter((i) => ruleLayer.ytAllowResolved.ids.includes(i.id) || i.id.startsWith('axis_weak'));
  }

  const editorialTone = getEditorialSubtypeTone(result);
  if (editorialTone) {
    failures = failures.map((i) => refineGeoIssueForEditorialSubtype(i, editorialTone));
  }
  failures = failures.map((i) => refineGeoIssueForPlatform(i, result.platform));

  return dedupeGeoIssuesById(failures);
}
