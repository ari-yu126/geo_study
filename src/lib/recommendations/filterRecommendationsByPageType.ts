/**
 * Post-processing only: adjust user-facing recommendation strings per page surface.
 * Does not modify templates/, axisRules, or scoring.
 */

import type { GeoRecommendations, PageType } from '../analysisTypes';
import { en } from './templates/en';
import { ko } from './templates/ko';

type Surface = 'editorial' | 'commerce' | 'video';

function surfaceFor(pageType: PageType): Surface {
  if (pageType === 'video') return 'video';
  if (pageType === 'commerce') return 'commerce';
  return 'editorial';
}

function localeOf(rec: GeoRecommendations): 'ko' | 'en' {
  return rec.trace?.locale === 'en' ? 'en' : 'ko';
}

function gapFallback(locale: 'ko' | 'en'): string {
  return locale === 'ko'
    ? '추가로 짚을 만한 빈칸은 많지 않습니다. 본문과 질문이 더 보이면 구체적인 팁을 드릴 수 있습니다.'
    : 'Not much seems missing beyond what follows. More page text and questions will allow sharper tips.';
}

/** Video-only template lines (headings / blocks) — strip from editorial & commerce. */
const VIDEO_HEADING_TEXT = new Set<string>([
  ko.headings.videoChapters,
  ko.headings.videoPinned,
  ko.headings.videoFaq,
  en.headings.videoChapters,
  en.headings.videoPinned,
  en.headings.videoFaq,
]);

const VIDEO_BLOCK_TEXT = new Set<string>([
  ko.blocks.videoChapters,
  ko.blocks.videoFaq,
  en.blocks.videoChapters,
  en.blocks.videoFaq,
]);

const VIDEO_PRIORITY_DROP = new Set<string>([
  ko.priority.paragraph,
  ko.priority.structure,
  ko.priority.answerability,
  ko.priority.questionMatch,
  en.priority.paragraph,
  en.priority.structure,
  en.priority.answerability,
  en.priority.questionMatch,
]);

const VIDEO_GAP_DROP = new Set<string>([
  ko.gap.paragraph,
  ko.gap.structure,
  ko.gap.questionMatch,
  en.gap.paragraph,
  en.gap.structure,
  en.gap.questionMatch,
]);

/** Extra document-structure hints (ko/en) beyond exact template lines */
const VIDEO_GAP_LINE_REJECT = (trimmed: string): boolean => {
  if (VIDEO_GAP_DROP.has(trimmed)) return true;
  if (
    /맨 앞 요약이 약하고|소제목과 한눈에|제목·본문에 잘 드러나지/.test(trimmed)
  ) {
    return true;
  }
  if (
    /The opening summary is weak and the body reads long/i.test(trimmed) ||
    /Headings and a short outline are hard to see/i.test(trimmed) ||
    /Search question phrases do not show clearly in titles or body text/i.test(trimmed)
  ) {
    return true;
  }
  return false;
};

const VIDEO_METADATA_GAP = new Set<string>([ko.gap.videoMetadata, en.gap.videoMetadata]);
const VIDEO_METADATA_PRIORITY = new Set<string>([ko.priority.videoMetadata, en.priority.videoMetadata]);

function parseGapLines(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

function joinGapLines(lines: string[]): string {
  return lines.map((l) => (l.startsWith('-') ? l : `- ${l}`)).join('\n').trim();
}

function filterNotesVideo(notes: string[] | undefined): string[] {
  if (!notes?.length) return [];
  return notes.filter((n) => {
    const t = n.trim();
    return t && !VIDEO_PRIORITY_DROP.has(t);
  });
}

function filterNotesDropVideoMeta(notes: string[] | undefined): string[] {
  if (!notes?.length) return [];
  return notes.filter((n) => {
    const t = n.trim();
    return t && !VIDEO_METADATA_PRIORITY.has(t);
  });
}

function filterGapVideo(contentGapSummary: string): string {
  const lines = parseGapLines(contentGapSummary);
  const kept = lines
    .map((l) => l.replace(/^-\s*/, '').trim())
    .filter((trimmed) => trimmed && !VIDEO_GAP_LINE_REJECT(trimmed));
  return joinGapLines(kept.map((t) => `- ${t}`));
}

function filterGapDropVideoMeta(contentGapSummary: string): string {
  const lines = parseGapLines(contentGapSummary);
  const kept = lines
    .map((l) => l.replace(/^-\s*/, '').trim())
    .filter((trimmed) => trimmed && !VIDEO_METADATA_GAP.has(trimmed));
  return joinGapLines(kept.map((t) => `- ${t}`));
}

function stripVideoHeadings(headings: string[]): string[] {
  return headings.filter((h) => !VIDEO_HEADING_TEXT.has(h.trim()));
}

function stripVideoBlocks(blocks: string[]): string[] {
  return blocks.filter((b) => !VIDEO_BLOCK_TEXT.has(b.trim()));
}

/**
 * Safe output filter: align guide copy with page surface (editorial vs commerce vs video).
 */
export function filterRecommendationsByPageType(rec: GeoRecommendations, pageType: PageType): GeoRecommendations {
  const surface = surfaceFor(pageType);
  const loc = localeOf(rec);

  if (surface === 'video') {
    let contentGapSummary = filterGapVideo(rec.contentGapSummary);
    if (!contentGapSummary.trim()) {
      contentGapSummary = gapFallback(loc);
    }
    const priorityNotes = filterNotesVideo(rec.actionPlan.priorityNotes);
    return {
      ...rec,
      contentGapSummary,
      actionPlan: {
        ...rec.actionPlan,
        suggestedHeadings: [],
        suggestedBlocks: rec.actionPlan.suggestedBlocks,
        priorityNotes: priorityNotes.length > 0 ? priorityNotes : undefined,
      },
    };
  }

  if (surface === 'commerce') {
    let contentGapSummary = filterGapDropVideoMeta(rec.contentGapSummary);
    if (!contentGapSummary.trim()) {
      contentGapSummary = gapFallback(loc);
    }
    const priorityNotes = filterNotesDropVideoMeta(rec.actionPlan.priorityNotes);
    return {
      ...rec,
      contentGapSummary,
      actionPlan: {
        ...rec.actionPlan,
        suggestedHeadings: stripVideoHeadings(rec.actionPlan.suggestedHeadings),
        suggestedBlocks: stripVideoBlocks(rec.actionPlan.suggestedBlocks),
        priorityNotes: priorityNotes.length > 0 ? priorityNotes : undefined,
      },
    };
  }

  // editorial + default
  let contentGapSummary = filterGapDropVideoMeta(rec.contentGapSummary);
  if (!contentGapSummary.trim()) {
    contentGapSummary = gapFallback(loc);
  }
  const editorialPriority = filterNotesDropVideoMeta(rec.actionPlan.priorityNotes);
  return {
    ...rec,
    contentGapSummary,
    actionPlan: {
      ...rec.actionPlan,
      suggestedHeadings: stripVideoHeadings(rec.actionPlan.suggestedHeadings),
      suggestedBlocks: stripVideoBlocks(rec.actionPlan.suggestedBlocks),
      priorityNotes: editorialPriority.length > 0 ? editorialPriority : undefined,
    },
  };
}
