import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { initDb } from './db.mjs';

const PUBLICATIONS_OUTPUT_PATH = path.resolve('public', 'data', 'publications.json');
const GRANTS_OUTPUT_PATH = path.resolve('public', 'data', 'grants.json');
const DEFAULT_DEPARTMENT = 'University of Minnesota';

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

const buildSignals = (publications, coauthorsByPmid = new Map()) => {
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

const getFacultyRows = (db) =>
  db.prepare('SELECT id, display_name, fore_name, last_name, orcid FROM faculty WHERE active = 1').all();

const toProgramAssociation = (row) => ({
  program: row.program,
  startDate: row.start_date || row.startDate || ''
});

const getPublicationRows = (db, facultyId) =>
  db
    .prepare(
      `
      SELECT p.pmid AS id, p.title, p.journal, p.year, p.doi, p.url
      FROM publications p
      INNER JOIN faculty_publications fp ON fp.pmid = p.pmid
      LEFT JOIN curation c
        ON c.faculty_id = fp.faculty_id
       AND c.pmid = fp.pmid
       AND c.verdict = 'false_positive'
      WHERE fp.faculty_id = ? AND c.pmid IS NULL
      ORDER BY p.year DESC, p.title ASC
    `
    )
    .all(facultyId);

const getFalsePositivePublicationRows = (db, facultyId) =>
  db
    .prepare(
      `
      SELECT p.pmid AS id, p.title, p.journal, p.year, p.doi, p.url
      FROM publications p
      INNER JOIN curation c ON c.pmid = p.pmid
      WHERE c.faculty_id = ? AND c.verdict = 'false_positive'
    `
    )
    .all(facultyId);

const getCoauthorsByPmid = (db, facultyId) => {
  const rows = db
    .prepare('SELECT pmid, name FROM faculty_publication_coauthors WHERE faculty_id = ?')
    .all(facultyId);
  const map = new Map();
  rows.forEach((row) => {
    const key = String(row.pmid);
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(row.name);
  });
  return map;
};

const getGrantRows = (db, facultyId) =>
  db
    .prepare(
      `
      SELECT
        g.id,
        g.title,
        fg.role,
        fg.amount,
        g.start_date AS startDate,
        g.end_date AS endDate,
        g.fiscal_year AS fiscalYear,
        g.url,
        g.core_project_num AS coreProjectNum
      FROM faculty_grants fg
      INNER JOIN grants g ON g.id = fg.grant_id
      WHERE fg.faculty_id = ?
      ORDER BY g.start_date DESC
    `
    )
    .all(facultyId);

const buildPublicationsOutput = (db) => {
  const faculty = getFacultyRows(db).map((facultyRow) => {
    const id = facultyRow.id;
    const programAssociations = db
      .prepare(
        'SELECT program, start_date AS startDate FROM faculty_programs WHERE faculty_id = ? ORDER BY program, start_date'
      )
      .all(id)
      .map(toProgramAssociation);
    const programs = Array.from(
      new Set(programAssociations.map((entry) => entry.program).filter(Boolean))
    );
    const publications = getPublicationRows(db, id);
    const falsePositivePublications = getFalsePositivePublicationRows(db, id);
    const coauthorsByPmid = getCoauthorsByPmid(db, id);

    return {
      id,
      name:
        facultyRow.display_name ||
        `${facultyRow.fore_name || ''} ${facultyRow.last_name || ''}`.trim() ||
        id,
      department: DEFAULT_DEPARTMENT,
      orcid: facultyRow.orcid || '',
      areas: [],
      programs,
      programAssociations,
      publications,
      authorCounts: null,
      signals: {
        positive: buildSignals(publications, coauthorsByPmid),
        negative: buildSignals(falsePositivePublications, coauthorsByPmid)
      }
    };
  });

  return {
    updated: new Date().toISOString().slice(0, 10),
    source: 'PubMed E-utilities',
    faculty
  };
};

const buildGrantsOutput = (db) => {
  const faculty = getFacultyRows(db).map((facultyRow) => {
    const id = facultyRow.id;
    const programAssociations = db
      .prepare(
        'SELECT program, start_date AS startDate FROM faculty_programs WHERE faculty_id = ? ORDER BY program, start_date'
      )
      .all(id)
      .map(toProgramAssociation);
    const programs = Array.from(
      new Set(programAssociations.map((entry) => entry.program).filter(Boolean))
    );
    return {
      id,
      name:
        facultyRow.display_name ||
        `${facultyRow.fore_name || ''} ${facultyRow.last_name || ''}`.trim() ||
        id,
      department: DEFAULT_DEPARTMENT,
      programs,
      programAssociations,
      reporterUrl: '',
      grants: getGrantRows(db, id)
    };
  });

  return {
    updated: new Date().toISOString().slice(0, 10),
    source: 'NIH RePORTER API',
    faculty
  };
};

const main = async () => {
  const db = initDb();
  const publicationsOutput = buildPublicationsOutput(db);
  const grantsOutput = buildGrantsOutput(db);
  db.close();

  await writeFile(PUBLICATIONS_OUTPUT_PATH, `${JSON.stringify(publicationsOutput, null, 2)}\n`, 'utf8');
  await writeFile(GRANTS_OUTPUT_PATH, `${JSON.stringify(grantsOutput, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${PUBLICATIONS_OUTPUT_PATH}`);
  console.log(`Wrote ${GRANTS_OUTPUT_PATH}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
