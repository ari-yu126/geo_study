export function getAuthorityLevel(url: string): 'high' | 'medium' | 'low' {
  if (!url || typeof url !== 'string') return 'low';
  const u = url.toLowerCase();
  if (u.includes('.gov') || u.includes('.edu')) return 'high';

  const highAuthorityDomains = [
    'developers.google.com',
    'schema.org',
    'w3.org',
  ];

  const mediumAuthorityDomains = [
    'searchenginejournal.com',
    'ahrefs.com',
    'moz.com',
    'semrush.com',
    'bain.com',
    'mckinsey.com',
  ];

  if (highAuthorityDomains.some((d) => u.includes(d))) return 'high';
  if (mediumAuthorityDomains.some((d) => u.includes(d))) return 'medium';

  return 'low';
}

// Note: recency-based or citation-count based authority can be added later.

