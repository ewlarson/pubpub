const normalizeSignalKey = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const normalizeName = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');

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

const tallyValues = (values, normalize = (value) => value, labeler) => {
  const counts = new Map();
  const labels = new Map();
  values.forEach((value) => {
    if (!value) {
      return;
    }
    const normalized = normalize(value);
    if (!normalized) {
      return;
    }
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
    if (!labels.has(normalized)) {
      labels.set(normalized, labeler ? labeler(value) : value);
    }
  });
  return { counts, labels };
};

const topList = (counts, labels, limit = 10) =>
  Array.from(counts.entries())
    .sort((a, b) => {
      const diff = b[1] - a[1];
      if (diff) {
        return diff;
      }
      return String(labels.get(a[0]) || a[0]).localeCompare(String(labels.get(b[0]) || b[0]));
    })
    .slice(0, limit)
    .map(([key, count]) => ({ name: labels.get(key) || key, count }));

const extractKeywords = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));

export const buildSignals = (publications, coauthorsByPmid = new Map()) => {
  const years = publications.map((pub) => pub.year).filter((year) => Number.isFinite(year));
  const yearRange = years.length ? { min: Math.min(...years), max: Math.max(...years) } : null;
  const yearCounts = Array.from(
    years.reduce((map, year) => {
      map.set(year, (map.get(year) || 0) + 1);
      return map;
    }, new Map())
  )
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => a.year - b.year);

  const journalTally = tallyValues(publications.map((pub) => pub.journal), normalizeSignalKey);
  const keywordTally = tallyValues(publications.flatMap((pub) => extractKeywords(pub.title)));
  const coauthorTally = tallyValues(
    publications.flatMap((pub) => coauthorsByPmid.get(String(pub.id)) || []),
    normalizeName
  );

  return {
    count: publications.length,
    yearRange,
    yearCounts,
    topJournals: topList(journalTally.counts, journalTally.labels, 10),
    topKeywords: topList(keywordTally.counts, keywordTally.labels, 12),
    topCoauthors: topList(coauthorTally.counts, coauthorTally.labels, 12)
  };
};

