/**
 * Curated seeds for GEO criteria research (no runtime Tavily required).
 * URLs are documentation and industry references; fetches may fail (firewalls, geo); academic path uses APIs.
 */

export const OFFICIAL_DOC_URLS: ReadonlyArray<{ url: string; title: string }> = [
  {
    url: 'https://developers.google.com/search/docs/fundamentals/creating-helpful-content',
    title: 'Google Search — Creating helpful, reliable, people-first content',
  },
  {
    url: 'https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data',
    title: 'Google Search — Introduction to structured data',
  },
  {
    url: 'https://developers.google.com/search/docs/appearance/ai-features',
    title: 'Google Search — AI features and your website',
  },
  {
    url: 'https://schema.org/docs/documents.html',
    title: 'Schema.org — Documentation overview',
  },
  {
    url: 'https://schema.org/FAQPage',
    title: 'Schema.org — FAQPage type',
  },
  {
    url: 'https://www.w3.org/TR/json-ld11/',
    title: 'W3C — JSON-LD 1.1',
  },
];

export const INDUSTRY_ARTICLE_URLS: ReadonlyArray<{ url: string; title: string }> = [
  {
    url: 'https://moz.com/learn/seo/schema-structured-data',
    title: 'Moz — Schema structured data',
  },
  {
    url: 'https://ahrefs.com/blog/seo-vs-geo/',
    title: 'Ahrefs — SEO vs GEO',
  },
  {
    url: 'https://www.searchenginejournal.com/generative-engine-optimization-geo/625101/',
    title: 'Search Engine Journal — Generative Engine Optimization (GEO)',
  },
  {
    url: 'https://www.semrush.com/blog/generative-engine-optimization/',
    title: 'Semrush — Generative Engine Optimization',
  },
  {
    url: 'https://developers.google.com/search/blog',
    title: 'Google Search Central Blog (index)',
  },
];

/** Semantic Scholar search queries — IR, QA, RAG, ranking, citation-relevant literature. */
export const ACADEMIC_SEARCH_QUERIES: readonly string[] = [
  'dense retrieval passage ranking neural information retrieval',
  'retrieval augmented generation factual grounding attribution',
  'question answering extractive machine reading comprehension',
  'web search result ranking neural relevance citation',
];

/** Optional Tavily supplement: recent industry discourse on AI search / GEO (not core theory). */
export const TREND_TAVILY_QUERIES: readonly string[] = [
  'Google AI Overview citation factors for editorial and FAQ pages 2026',
  'How Perplexity AI ranks authoritative blog posts and news articles',
  'Importance of expert bylines and first-person insights for GEO',
  'How Google AI summarizes and cites YouTube videos 2026',
  'Optimization of video descriptions and timestamps for AI search agents',
  'YouTube metadata SEO vs GEO: key differences in AI citation',
  'Generative Engine Optimization (GEO) for e-commerce product pages',
  'How AI search engines extract specifications from product tables',
  'The role of customer reviews and shipping policies in AI search citations',
];
