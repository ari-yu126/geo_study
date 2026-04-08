import type { PageFeatures } from './analysisTypes';

/**
 * check 문자열과 PageFeatures를 기반으로 조건 충족 여부를 평가합니다.
 * 반환값: true = 조건 충족(문제 없음), false = 조건 미충족(이슈 발생)
 */
export function evaluateCheck(
  check: string,
  features: PageFeatures,
  threshold?: number
): boolean {
  switch (check) {
    case 'title_exists':
      return !!(features.meta.title && features.meta.title.trim());

    case 'desc_exists':
      // Legacy / strict: standard meta tag only (monthly configs may still reference this)
      return !!features.hasMetaDescription;

    case 'meta_description_present':
      return !!features.hasMetaDescription;

    /** Partial structure credit: og:description present but no meta name=description */
    case 'og_only_description_partial_credit':
      return (
        !features.hasMetaDescription &&
        !!features.hasOgDescription
      );

    /** Any descriptive signal for issue "completely missing" */
    case 'description_any_signal':
      return !!(features.hasMetaDescription || features.hasOgDescription);

    /**
     * Pass = no "og-only" issue: either meta exists, or OG is absent (so not og-only case).
     * Fails only when og present without meta.
     */
    case 'meta_description_or_no_og':
      return !features.hasOgDescription || !!features.hasMetaDescription;

    case 'desc_length_min': {
      const len = features.effectiveDescriptionLength ?? features.descriptionLength;
      return len >= (threshold ?? 50);
    }

    case 'og_title_exists':
      return !!(features.meta.ogTitle && features.meta.ogTitle.trim());

    case 'og_desc_exists':
      return !!(features.meta.ogDescription && features.meta.ogDescription.trim());

    case 'og_tags_exist':
      return !!(
        features.meta.ogTitle &&
        features.meta.ogTitle.trim() &&
        features.meta.ogDescription &&
        features.meta.ogDescription.trim()
      );

    case 'canonical_exists':
      return !!(features.meta.canonical && features.meta.canonical.trim());

    case 'headings_min':
      return features.headings.length >= (threshold ?? 2);

    case 'questions_min':
      return features.pageQuestions.length >= (threshold ?? 3);

    case 'keywords_min':
      return features.seedKeywords.length >= (threshold ?? 5);

    case 'h1_single':
      return features.h1Count === 1;

    case 'schema_faq_exists':
      return features.hasFaqSchema;

    case 'structured_data_exists':
      return features.hasStructuredData;

    case 'schema_product_exists':
      return !!features.hasProductSchema;

    case 'data_dense_blocks_min':
      return (features.contentQuality.productSpecBlockCount ?? 0) >= (threshold ?? 2);

    case 'has_domain_authority':
      return !!features.trustSignals.hasDomainAuthority;

    case 'has_search_exposure':
      return !!features.trustSignals.hasSearchExposure;

    case 'question_coverage_min':
      return features.questionCoverage >= (threshold ?? 40);

    case 'structure_score_min':
      return features.structureScore >= (threshold ?? 60);

    case 'content_length_min':
      return features.contentQuality.contentLength >= (threshold ?? 3000);

    case 'tables_min':
      return features.contentQuality.tableCount >= (threshold ?? 1);

    case 'lists_min':
      return features.contentQuality.listCount >= (threshold ?? 2);

    case 'h2_count_min':
      return features.contentQuality.h2Count >= (threshold ?? 3);

    case 'h3_count_min':
      return features.contentQuality.h3Count >= (threshold ?? 2);

    case 'images_min':
      return features.contentQuality.imageCount >= (threshold ?? 1);

    case 'has_step_structure':
      return features.contentQuality.hasStepStructure;

    case 'content_depth':
      return features.contentQuality.contentLength >= (threshold ?? 5000);

    case 'desc_length_range': {
      const len = features.effectiveDescriptionLength ?? features.descriptionLength;
      return len >= 50 && len <= 160;
    }

    // AI Citeability checks
    case 'quotable_sentences_min':
      return features.contentQuality.quotableSentenceCount >= (threshold ?? 3);

    case 'first_paragraph_quality':
      return features.contentQuality.firstParagraphLength >= (threshold ?? 30);

    case 'has_definition':
      return features.contentQuality.hasDefinitionPattern;

    case 'has_price_info':
      return features.contentQuality.hasPriceInfo;

    // Trust checks
    case 'has_author':
      return features.trustSignals.hasAuthor;

    case 'has_publish_date':
      return features.trustSignals.hasPublishDate;

    case 'has_modified_date':
      return features.trustSignals.hasModifiedDate;

    case 'has_contact_link':
      return features.trustSignals.hasContactLink;

    case 'has_about_link':
      return features.trustSignals.hasAboutLink;

    // Blog/editorial answerability profile (requires contentQuality.editorialBlogSignals)
    case 'editorial_intro_takeaway':
      return !!features.contentQuality.editorialBlogSignals?.introTakeaway;

    case 'editorial_reco_conclusion_min': {
      const n = features.contentQuality.editorialBlogSignals?.recoConclusionCount ?? 0;
      return n >= (threshold ?? 3);
    }

    case 'editorial_pros_cons_comparison':
      return !!features.contentQuality.editorialBlogSignals?.prosConsOrComparison;

    case 'editorial_audience_guidance':
      return !!features.contentQuality.editorialBlogSignals?.audienceGuidance;

    case 'editorial_decisive_sentences_min': {
      const n = features.contentQuality.editorialBlogSignals?.decisiveNonNumericCount ?? 0;
      return n >= (threshold ?? 6);
    }

    case 'editorial_title_intro_alignment':
      return !!features.contentQuality.editorialBlogSignals?.titleIntroAligned;

    case 'editorial_lists_min': {
      const n = features.contentQuality.editorialBlogSignals?.listCount ?? 0;
      return n >= (threshold ?? 1);
    }

    case 'editorial_list_or_choice_guidance': {
      const s = features.contentQuality.editorialBlogSignals;
      if (!s) return false;
      return s.listWithGuidance || s.choiceLanguage;
    }

    case 'editorial_content_substantial':
      return features.contentQuality.contentLength >= (threshold ?? 2000);

    case 'editorial_questions_or_faq_min': {
      const s = features.contentQuality.editorialBlogSignals;
      if (!s) return false;
      const th = threshold ?? 2;
      return s.pageQuestionCount >= th || s.faqLikeHeadingCount >= th;
    }

    default:
      console.warn(`Unknown check: ${check}`);
      return true;
  }
}
