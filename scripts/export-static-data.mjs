import { buildSignals } from './publication-signals.mjs';
import { preferPublishedVersions } from './publication-versions.mjs';
import { buildAuthorCounts } from './scholar-publications.mjs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getStoredAuthorship, initDb } from './db.mjs';
import { filterCuratedGrants } from './grant-curation.mjs';

const PUBLICATIONS_OUTPUT_PATH = path.resolve('public', 'data', 'publications.json');
const GRANTS_OUTPUT_PATH = path.resolve('public', 'data', 'grants.json');
const DEFAULT_DEPARTMENT = 'University of Minnesota';

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
      SELECT
        p.pmid AS id,
        p.title,
        p.journal,
        p.year,
        p.doi,
        p.url,
        p.version_metadata AS versionMetadata,
        fp.author_position AS authorPosition,
        fp.author_count AS authorCount
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
    .all(facultyId)
    .map((publication) => {
      const publicationMetadata = { ...publication, ...JSON.parse(publication.versionMetadata) };
      delete publicationMetadata.versionMetadata;
      delete publicationMetadata.authorPosition;
      delete publicationMetadata.authorCount;
      const authorship = getStoredAuthorship(publication);
      return authorship
        ? { ...publicationMetadata, authorship }
        : publicationMetadata;
    });

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

const buildPublicationsOutput = (db, updatedAt) => {
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
    const publications = preferPublishedVersions(getPublicationRows(db, id));
    const falsePositivePublications = getFalsePositivePublicationRows(db, id);
    const coauthorsByPmid = getCoauthorsByPmid(db, id);

    return {
      id,
      name:
        facultyRow.display_name ||
        `${facultyRow.fore_name || ''} ${facultyRow.last_name || ''}`.trim() ||
        id,
      foreName: facultyRow.fore_name || '',
      lastName: facultyRow.last_name || '',
      department: DEFAULT_DEPARTMENT,
      orcid: facultyRow.orcid || '',
      areas: [],
      programs,
      programAssociations,
      publications,
      authorCounts: buildAuthorCounts(publications),
      signals: {
        positive: buildSignals(publications, coauthorsByPmid),
        negative: buildSignals(falsePositivePublications, coauthorsByPmid)
      }
    };
  });

  return {
    updated: updatedAt.slice(0, 10),
    updatedAt,
    source: 'PubMed E-utilities',
    faculty
  };
};

const buildGrantsOutput = (db, updatedAt) => {
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
      foreName: facultyRow.fore_name || '',
      lastName: facultyRow.last_name || '',
      department: DEFAULT_DEPARTMENT,
      programs,
      programAssociations,
      reporterUrl: '',
      grants: filterCuratedGrants(id, getGrantRows(db, id))
    };
  });

  return {
    updated: updatedAt.slice(0, 10),
    updatedAt,
    source: 'NIH RePORTER API',
    faculty
  };
};

const main = async () => {
  const db = initDb();
  const updatedAt = new Date().toISOString();
  const publicationsOutput = buildPublicationsOutput(db, updatedAt);
  const grantsOutput = buildGrantsOutput(db, updatedAt);
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
