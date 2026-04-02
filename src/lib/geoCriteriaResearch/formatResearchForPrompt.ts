import type { ResearchBucket } from './types';
import { GEO_RESEARCH_PROMPT_TAG } from './types';
import type { GeoCriteriaResearchProfileKey } from './pageTypeResearchWeights';
import {
  GEO_CRITERIA_PAGE_TYPE_RESEARCH_WEIGHTS,
  GEO_CRITERIA_WEIGHTED_SECTION_CHAR_BUDGET,
} from './pageTypeResearchWeights';

/**
 * Renders labeled research blocks for the GEO config Gemini prompt (unweighted full dump).
 */
export function formatResearchBucketsForGemini(researchBuckets: ResearchBucket[]): string {
  return researchBuckets
    .map((b) => {
      const tag = GEO_RESEARCH_PROMPT_TAG[b.provider];
      return `## [${tag}]\n${b.items
        .map((i) => {
          const srcLine =
            i.sources.length > 0
              ? `\nLinked sources: ${i.sources.map((s) => `${s.title} (${s.url})`).join('; ')}`
              : '';
          return `### ${i.query.startsWith('http') ? 'URL' : 'Query'}: ${i.query}\n${i.resultsText}${srcLine}`;
        })
        .join('\n\n')}`;
    })
    .join('\n\n---\n\n');
}

function bucketByProvider(
  buckets: ResearchBucket[],
  provider: ResearchBucket['provider']
): ResearchBucket | undefined {
  return buckets.find((b) => b.provider === provider);
}

function formatOneBucket(bucket: ResearchBucket | undefined): string {
  if (!bucket || bucket.items.length === 0) return '';
  const tag = GEO_RESEARCH_PROMPT_TAG[bucket.provider];
  return `## [${tag}]\n${bucket.items
    .map((i) => {
      const srcLine =
        i.sources.length > 0
          ? `\nLinked sources: ${i.sources.map((s) => `${s.title} (${s.url})`).join('; ')}`
          : '';
      return `### ${i.query.startsWith('http') ? 'URL' : 'Query'}: ${i.query}\n${i.resultsText}${srcLine}`;
    })
    .join('\n\n')}`;
}

function truncateText(text: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  const t = text.trim();
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars) + '…';
}

/**
 * Builds one profile's weighted research block: academic-first budget, then official vs industry
 * sharing the officialAuthority budget (proportional to raw formatted length), then trend.
 */
function buildWeightedProfileResearchBlock(
  buckets: ResearchBucket[],
  profileKey: GeoCriteriaResearchProfileKey,
  budget: number
): string {
  const w = GEO_CRITERIA_PAGE_TYPE_RESEARCH_WEIGHTS[profileKey];
  const academicBlock = formatOneBucket(bucketByProvider(buckets, 'academic'));
  const officialBlock = formatOneBucket(bucketByProvider(buckets, 'official'));
  const industryBlock = formatOneBucket(bucketByProvider(buckets, 'industry'));
  const trendBlock = formatOneBucket(bucketByProvider(buckets, 'tavily'));

  const maxAc = Math.floor(budget * w.academic);
  const maxOA = Math.floor(budget * w.officialAuthority);
  const maxTr = Math.floor(budget * w.trend);

  const oaLen = officialBlock.length + industryBlock.length;
  let maxOfficial = 0;
  let maxIndustry = 0;
  if (oaLen > 0 && maxOA > 0) {
    maxOfficial = Math.floor(maxOA * (officialBlock.length / oaLen));
    maxIndustry = maxOA - maxOfficial;
  } else if (maxOA > 0) {
    maxOfficial = Math.floor(maxOA / 2);
    maxIndustry = maxOA - maxOfficial;
  }

  const ac = truncateText(academicBlock, maxAc);
  const of = truncateText(officialBlock, maxOfficial);
  const ind = truncateText(industryBlock, maxIndustry);
  const tr = truncateText(trendBlock, maxTr);

  const pct = (n: number) => `${Math.round(n * 100)}%`;

  return [
    `### [academic] — budget ${pct(w.academic)} of section (${maxAc} chars cap)`,
    ac || '(no academic content)',
    '',
    `### [official] — share of official+authority (${pct(w.officialAuthority)} total; split vs industry by length)`,
    of || '(no official content)',
    '',
    `### [industry] — authority industry (remainder of official+authority budget)`,
    ind || '(no industry content)',
    '',
    `### [trend] — budget ${pct(w.trend)} of section (${maxTr} chars cap)`,
    tr || '(no trend content)',
  ].join('\n');
}

const PROFILE_ORDER: GeoCriteriaResearchProfileKey[] = ['editorial', 'video', 'commerce'];

const PROFILE_LABEL_KO: Record<GeoCriteriaResearchProfileKey, string> = {
  editorial: 'editorial (블로그·뉴스·FAQ 등)',
  video: 'video (유튜브 등)',
  commerce: 'commerce (이커머스·상품)',
  default: 'default',
};

/**
 * Page-type-aware research for GEO config Gemini: three weighted corpora (editorial / video / commerce)
 * plus instructions that **default** follows editorial weighting. Academic-first philosophy is enforced by
 * larger academic budgets and ordering within each section.
 */
export function formatPageTypeWeightedResearchForGemini(
  researchBuckets: ResearchBucket[],
  sectionBudget: number = GEO_CRITERIA_WEIGHTED_SECTION_CHAR_BUDGET
): string {
  const parts: string[] = [];

  for (const key of PROFILE_ORDER) {
    const w = GEO_CRITERIA_PAGE_TYPE_RESEARCH_WEIGHTS[key];
    const header = [
      `## Weighted research corpus — ${PROFILE_LABEL_KO[key]}`,
      `**Target mix:** academic ${Math.round(w.academic * 100)}% · official+authority ${Math.round(w.officialAuthority * 100)}% · trend ${Math.round(w.trend * 100)}%`,
      `When designing the **${key}** scoring profile, prioritize evidence from this section over the other sections below.`,
    ].join('\n');

    parts.push(header);
    parts.push(buildWeightedProfileResearchBlock(researchBuckets, key, sectionBudget));
  }

  const dw = GEO_CRITERIA_PAGE_TYPE_RESEARCH_WEIGHTS.default;
  parts.push(
    [
      `## Weighted research corpus — default profile`,
      `**Target mix (same as editorial):** academic ${Math.round(dw.academic * 100)}% · official+authority ${Math.round(dw.officialAuthority * 100)}% · trend ${Math.round(dw.trend * 100)}%`,
      `Use the **editorial-weighted** corpus above as the primary basis for **default**; adjust only if a neutral blend is more appropriate.`,
    ].join('\n')
  );

  return parts.join('\n\n---\n\n');
}
