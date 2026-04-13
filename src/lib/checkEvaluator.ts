import type { PageFeatures } from './analysisTypes';

/**
 * Monthly Supabase config may use `check` names that differ from switch cases below.
 * Aliases map external names → implemented checks (same thresholds apply when passed through).
 *
 * | Config name                 | Canonical evaluateCheck id           |
 * |----------------------------|--------------------------------------|
 * | author_bio_exists          | has_author                           |
 * | h_hierarchy_clear          | headings_min                         |
 * | citation_velocity_min      | quotable_sentences_min               |
 * | answer_island_size_min     | editorial_questions_or_faq_min       |
 */
const ISSUE_CHECK_ALIASES: Record<string, string> = {
  author_bio_exists: 'has_author',
  author_bio: 'has_author',
  h_hierarchy_clear: 'headings_min',
  heading_hierarchy_clear: 'headings_min',
  headings_structure_clear: 'headings_min',
  citation_velocity_min: 'quotable_sentences_min',
  citation_density_min: 'quotable_sentences_min',
  answer_island_size_min: 'editorial_questions_or_faq_min',
  answer_islands_min: 'editorial_questions_or_faq_min',
};

function normalizeIssueCheck(check: string): string {
  const key = check.trim();
  const lower = key.toLowerCase();
  return ISSUE_CHECK_ALIASES[key] ?? ISSUE_CHECK_ALIASES[lower] ?? key;
}

/** Meta + headings + chunks (lowercased) for supplemental editorial heuristics */
function editorialHeuristicCorpus(features: PageFeatures): string {
  return (features.editorialHeuristicCorpus ?? '').trim();
}

export type CheckEvaluationDetail = {
  /** Original check string from config */
  rawCheck: string;
  /** After alias resolution */
  resolvedCheck: string;
  effectiveThreshold: number | undefined;
  passed: boolean;
  /** Observed value or signal summary for debugging thresholds */
  measured: string | number | boolean | null;
};

/**
 * Same logic as evaluateCheck but returns observed `measured` for logging/diagnostics.
 */
export function evaluateCheckDetailed(
  check: string,
  features: PageFeatures,
  threshold?: number
): CheckEvaluationDetail {
  const rawCheck = check;
  const resolved = normalizeIssueCheck(check);

  const detail = (passed: boolean, measured: string | number | boolean | null, th?: number): CheckEvaluationDetail => ({
    rawCheck,
    resolvedCheck: resolved,
    effectiveThreshold: th,
    passed,
    measured,
  });

  switch (resolved) {
    case 'title_exists': {
      const ok = !!(features.meta.title && features.meta.title.trim());
      return detail(ok, features.meta.title?.trim().length ?? 0);
    }

    case 'desc_exists':
      return detail(!!features.hasMetaDescription, Boolean(features.hasMetaDescription));

    case 'meta_description_present':
      return detail(!!features.hasMetaDescription, Boolean(features.hasMetaDescription));

    case 'og_only_description_partial_credit': {
      const ok = !features.hasMetaDescription && !!features.hasOgDescription;
      return detail(ok, `hasMeta:${features.hasMetaDescription} hasOg:${features.hasOgDescription}`);
    }

    case 'description_any_signal': {
      const ok = !!(features.hasMetaDescription || features.hasOgDescription);
      return detail(ok, Boolean(ok));
    }

    case 'meta_description_or_no_og': {
      const ok = !features.hasOgDescription || !!features.hasMetaDescription;
      return detail(ok, `hasOg:${features.hasOgDescription} hasMeta:${features.hasMetaDescription}`);
    }

    case 'desc_length_min': {
      const len = features.effectiveDescriptionLength ?? features.descriptionLength;
      const th = threshold ?? 50;
      return detail(len >= th, len, th);
    }

    case 'og_title_exists':
      return detail(!!(features.meta.ogTitle && features.meta.ogTitle.trim()), (features.meta.ogTitle ?? '').trim().length);

    case 'og_desc_exists':
      return detail(!!(features.meta.ogDescription && features.meta.ogDescription.trim()), (features.meta.ogDescription ?? '').trim().length);

    case 'og_tags_exist': {
      const ok = !!(
        features.meta.ogTitle &&
        features.meta.ogTitle.trim() &&
        features.meta.ogDescription &&
        features.meta.ogDescription.trim()
      );
      return detail(ok, ok);
    }

    case 'canonical_exists':
      return detail(!!(features.meta.canonical && features.meta.canonical.trim()), !!(features.meta.canonical && features.meta.canonical.trim()));

    case 'headings_min': {
      const th = threshold ?? 2;
      return detail(features.headings.length >= th, features.headings.length, th);
    }

    case 'questions_min': {
      const th = threshold ?? 3;
      return detail(features.pageQuestions.length >= th, features.pageQuestions.length, th);
    }

    case 'keywords_min': {
      const th = threshold ?? 5;
      return detail(features.seedKeywords.length >= th, features.seedKeywords.length, th);
    }

    case 'h1_single':
      return detail(features.h1Count === 1, features.h1Count);

    case 'schema_faq_exists':
      return detail(features.hasFaqSchema, features.hasFaqSchema);

    case 'structured_data_exists':
      return detail(features.hasStructuredData, features.hasStructuredData);

    case 'schema_product_exists':
      return detail(!!features.hasProductSchema, !!features.hasProductSchema);

    case 'data_dense_blocks_min': {
      const th = threshold ?? 2;
      const n = features.contentQuality.productSpecBlockCount ?? 0;
      return detail(n >= th, n, th);
    }

    case 'has_domain_authority':
      return detail(!!features.trustSignals.hasDomainAuthority, !!features.trustSignals.hasDomainAuthority);

    case 'has_search_exposure':
      return detail(!!features.trustSignals.hasSearchExposure, !!features.trustSignals.hasSearchExposure);

    case 'question_coverage_min': {
      const th = threshold ?? 40;
      return detail(features.questionCoverage >= th, features.questionCoverage, th);
    }

    case 'structure_score_min': {
      const th = threshold ?? 60;
      return detail(features.structureScore >= th, features.structureScore, th);
    }

    case 'content_length_min': {
      const th = threshold ?? 3000;
      return detail(features.contentQuality.contentLength >= th, features.contentQuality.contentLength, th);
    }

    case 'tables_min': {
      const th = threshold ?? 1;
      return detail(features.contentQuality.tableCount >= th, features.contentQuality.tableCount, th);
    }

    case 'lists_min': {
      const th = threshold ?? 2;
      return detail(features.contentQuality.listCount >= th, features.contentQuality.listCount, th);
    }

    case 'h2_count_min': {
      const th = threshold ?? 3;
      return detail(features.contentQuality.h2Count >= th, features.contentQuality.h2Count, th);
    }

    case 'h3_count_min': {
      const th = threshold ?? 2;
      return detail(features.contentQuality.h3Count >= th, features.contentQuality.h3Count, th);
    }

    case 'images_min': {
      const th = threshold ?? 1;
      return detail(features.contentQuality.imageCount >= th, features.contentQuality.imageCount, th);
    }

    case 'has_step_structure':
      return detail(features.contentQuality.hasStepStructure, features.contentQuality.hasStepStructure);

    case 'content_depth': {
      const th = threshold ?? 5000;
      return detail(features.contentQuality.contentLength >= th, features.contentQuality.contentLength, th);
    }

    case 'desc_length_range': {
      const len = features.effectiveDescriptionLength ?? features.descriptionLength;
      const ok = len >= 50 && len <= 160;
      return detail(ok, len);
    }

    case 'quotable_sentences_min': {
      const th = threshold ?? 3;
      return detail(
        features.contentQuality.quotableSentenceCount >= th,
        features.contentQuality.quotableSentenceCount,
        th
      );
    }

    case 'first_paragraph_quality': {
      const th = threshold ?? 30;
      return detail(features.contentQuality.firstParagraphLength >= th, features.contentQuality.firstParagraphLength, th);
    }

    case 'has_definition':
      return detail(features.contentQuality.hasDefinitionPattern, features.contentQuality.hasDefinitionPattern);

    case 'has_price_info':
      return detail(features.contentQuality.hasPriceInfo, features.contentQuality.hasPriceInfo);

    case 'has_author':
      return detail(features.trustSignals.hasAuthor, features.trustSignals.hasAuthor);

    case 'has_publish_date':
      return detail(features.trustSignals.hasPublishDate, features.trustSignals.hasPublishDate);

    case 'has_modified_date':
      return detail(features.trustSignals.hasModifiedDate, features.trustSignals.hasModifiedDate);

    case 'has_contact_link':
      return detail(features.trustSignals.hasContactLink, features.trustSignals.hasContactLink);

    case 'has_about_link':
      return detail(features.trustSignals.hasAboutLink, features.trustSignals.hasAboutLink);

    case 'editorial_intro_takeaway':
      return detail(!!features.contentQuality.editorialBlogSignals?.introTakeaway, !!features.contentQuality.editorialBlogSignals?.introTakeaway);

    case 'editorial_reco_conclusion_min': {
      const n = features.contentQuality.editorialBlogSignals?.recoConclusionCount ?? 0;
      const th = threshold ?? 3;
      return detail(n >= th, n, th);
    }

    case 'editorial_pros_cons_comparison':
      return detail(!!features.contentQuality.editorialBlogSignals?.prosConsOrComparison, !!features.contentQuality.editorialBlogSignals?.prosConsOrComparison);

    case 'editorial_audience_guidance':
      return detail(!!features.contentQuality.editorialBlogSignals?.audienceGuidance, !!features.contentQuality.editorialBlogSignals?.audienceGuidance);

    case 'editorial_decisive_sentences_min': {
      const n = features.contentQuality.editorialBlogSignals?.decisiveNonNumericCount ?? 0;
      const th = threshold ?? 6;
      return detail(n >= th, n, th);
    }

    case 'editorial_title_intro_alignment':
      return detail(!!features.contentQuality.editorialBlogSignals?.titleIntroAligned, !!features.contentQuality.editorialBlogSignals?.titleIntroAligned);

    case 'editorial_lists_min': {
      const n = features.contentQuality.editorialBlogSignals?.listCount ?? 0;
      const th = threshold ?? 1;
      return detail(n >= th, n, th);
    }

    case 'editorial_list_or_choice_guidance': {
      const s = features.contentQuality.editorialBlogSignals;
      if (!s) return detail(false, 'no_editorialBlogSignals');
      const ok = s.listWithGuidance || s.choiceLanguage;
      return detail(ok, `listWithGuidance:${s.listWithGuidance} choiceLanguage:${s.choiceLanguage}`);
    }

    case 'editorial_content_substantial': {
      const th = threshold ?? 2000;
      return detail(features.contentQuality.contentLength >= th, features.contentQuality.contentLength, th);
    }

    case 'editorial_questions_or_faq_min': {
      const s = features.contentQuality.editorialBlogSignals;
      if (!s) return detail(false, 'no_editorialBlogSignals');
      const th = threshold ?? 2;
      const ok = s.pageQuestionCount >= th || s.faqLikeHeadingCount >= th;
      return detail(
        ok,
        `pageQuestionCount:${s.pageQuestionCount} faqLikeHeadingCount:${s.faqLikeHeadingCount}`,
        th
      );
    }

    /** Supplemental editorial: clear recommendation / conclusion language */
    case 'clear_verdict_exists': {
      const corpus = editorialHeuristicCorpus(features);
      if (!corpus) return detail(false, 'empty_corpus');
      const verdictRe =
        /(추천|비추천|결론|요약|총평|한줄\s*평|정리하자면|최종|최고의|괜찮은\s*선택|사도\s*될|사지\s*마|별로|아쉽|만족|불만|추천합니다|비추천합니다|recommend(?:s|ation)?|verdict|conclusion|summary|final\s+thought)/i;
      const ok = verdictRe.test(corpus);
      return detail(ok, ok ? 'verdict_language_hit' : 'no_verdict_language');
    }

    /** Supplemental editorial: comparison / selection framing */
    case 'comparison_logic_exists': {
      const corpus = editorialHeuristicCorpus(features);
      if (!corpus) return detail(false, 'empty_corpus');
      const compRe =
        /(비교|대비|vs\.?|장단점|프로앤컨|pros?\s*and\s*cons|차이|선택\s*기준|어떤\s*걸|vs\s|대결|체크리스트|누가\s*더|a\s*vs\s*b|표로\s*정리|한눈에)/i;
      const ebs = features.contentQuality.editorialBlogSignals;
      const prosCons = !!ebs?.prosConsOrComparison;
      const ok = compRe.test(corpus) || prosCons;
      return detail(ok, prosCons ? 'pros_cons_signal' : compRe.test(corpus) ? 'comparison_language_hit' : 'no_comparison_signal');
    }

    /** Supplemental editorial: claims backed by reasons / data / structure */
    case 'claim_with_evidence': {
      const corpus = editorialHeuristicCorpus(features);
      const cq = features.contentQuality;
      const ebs = cq.editorialBlogSignals;
      const structural =
        cq.tableCount + cq.listCount >= 2 ||
        (ebs?.decisiveNonNumericCount ?? 0) >= 5 ||
        cq.quotableSentenceCount >= 10;
      const textOk =
        corpus.length > 0 &&
        (/(\d+[%％]|\d+\s*(만원|원|점|g|kg|ml|hz|mah|시간)|근거|이유|왜냐하면|테스트|측정|실험|데이터|스펙|benchmark|리뷰\s*\()/i.test(corpus) ||
          /(때문에|덕분에|이라서)\s*\S+/i.test(corpus));
      const ok = structural || textOk;
      const measured = structural
        ? `structural:tables+lists=${cq.tableCount + cq.listCount} decisive=${ebs?.decisiveNonNumericCount ?? 0} quotable=${cq.quotableSentenceCount}`
        : textOk
          ? 'text_evidence_signal'
          : 'no_evidence_heuristic';
      return detail(ok, measured);
    }

    /** Supplemental editorial: who the advice is for */
    case 'user_context_exists': {
      const corpus = editorialHeuristicCorpus(features);
      if (!corpus) return detail(false, 'empty_corpus');
      const ctxRe =
        /(누구에게|어떤\s*(분|사람|상황)|이런\s*분|입문(?:자)?|초보|전문가|사무용|게임용|학생|직장인|가정용|상황에\s*맞|추천\s*대상|적합한|어울리|해당\s*되는)/i;
      const aud = !!features.contentQuality.editorialBlogSignals?.audienceGuidance;
      const ok = ctxRe.test(corpus) || aud;
      return detail(ok, aud ? 'audience_guidance_signal' : ctxRe.test(corpus) ? 'user_context_language_hit' : 'no_user_context');
    }

    default:
      console.warn(`Unknown check: ${check}${resolved !== check ? ` (resolved: ${resolved})` : ''}`);
      return {
        rawCheck,
        resolvedCheck: resolved,
        effectiveThreshold: threshold,
        passed: true,
        measured: null,
      };
  }
}

/**
 * check 문자열과 PageFeatures를 기반으로 조건 충족 여부를 평가합니다.
 * 반환값: true = 조건 충족(문제 없음), false = 조건 미충족(이슈 발생)
 */
export function evaluateCheck(
  check: string,
  features: PageFeatures,
  threshold?: number
): boolean {
  return evaluateCheckDetailed(check, features, threshold).passed;
}
