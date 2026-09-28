const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'into',
  'is',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with'
]);

const topValues = (values, limit) => {
  const counts = new Map();
  values.filter(Boolean).forEach((value) => {
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  return [...counts]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
};

export const buildSignals = (publications, coauthorsByPmid) => {
  const years = publications.map((publication) => publication.year).filter(Number.isFinite);
  const yearCounts = topValues(years.map(String), Number.POSITIVE_INFINITY)
    .map(({ name, count }) => ({ year: Number(name), count }))
    .sort((left, right) => left.year - right.year);
  const keywords = publications.flatMap((publication) =>
    String(publication.title || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
  );
  const coauthors = publications.flatMap(
    (publication) => coauthorsByPmid.get(String(publication.id)) || []
  );

  return {
    count: publications.length,
    yearRange: years.length ? { min: Math.min(...years), max: Math.max(...years) } : null,
    yearCounts,
    topJournals: topValues(
      publications.map((publication) => publication.journal),
      10
    ),
    topKeywords: topValues(keywords, 12),
    topCoauthors: topValues(coauthors, 12)
  };
};

export const buildAuthorCounts = (publications) => {
  const known = publications.filter((publication) => publication.authorship);
  return known.length
    ? {
        first: known.filter((publication) => publication.authorship.isFirst).length,
        last: known.filter((publication) => publication.authorship.isLast).length,
        total: publications.length,
        known: known.length
      }
    : null;
};

