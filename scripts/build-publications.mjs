import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchPmids, fetchSummaries } from './pubmed.mjs';

const CSV_PATH = path.resolve('data', 'CTSI Faculty - Sheet1.csv');
const OUTPUT_PATH = path.resolve('public', 'data', 'publications.json');

const envLocal = path.resolve('.env.local');
if (existsSync(envLocal)) {
  dotenv.config({ path: envLocal });
} else {
  dotenv.config();
}

const EMAIL = process.env.NCBI_EMAIL || 'ewlarson@example.com';
const TOOL = process.env.NCBI_TOOL || 'ctsi_pubpub';
const API_KEY = process.env.NCBI_API_KEY || '';

const YEAR_START = Number(process.env.PUB_YEAR_START || process.env.PUB_YEAR || '2025');
const YEAR_END = Number(process.env.PUB_YEAR_END || process.env.PUB_YEAR || YEAR_START);
const DEFAULT_AFFILIATION = 'University of Minnesota';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const toSlug = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
};

const parseYearClause = (startYear, endYear) => {
  if (!startYear || !Number.isFinite(startYear)) {
    return '';
  }
  if (!endYear || startYear === endYear) {
    return `${startYear}[pdat]`;
  }
  return `("${startYear}/01/01"[pdat] : "${endYear}/12/31"[pdat])`;
};

const parseSignatureTerms = (value) =>
  value
    .split('|')
    .map((term) => term.trim())
    .filter(Boolean);

const isEmail = (value) => /@/.test(value);

const buildAffiliationClause = (terms) => {
  const cleaned = terms.map((term) => term.replace(/\s+/g, ' ').trim());
  if (!cleaned.length) {
    return '';
  }
  const clauses = cleaned.map((term) => `"${term}"[ad]`);
  return `(${clauses.join(' OR ')})`;
};

const buildAuthorClause = (firstName, lastName, orcid) => {
  const name = `"${lastName} ${firstName}"[fau]`;
  if (orcid) {
    return `(${name} OR "${orcid}"[auid])`;
  }
  return name;
};

const chunk = (arr, size) => {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
};

const extractYear = (value) => {
  if (!value) {
    return null;
  }
  const match = String(value).match(/\d{4}/);
  return match ? Number(match[0]) : null;
};

const extractDoi = (articleIds = []) => {
  const doi = articleIds.find((id) => id.idtype === 'doi');
  return doi ? doi.value : '';
};

const mapSummaryToPublication = (summary) => {
  const year = extractYear(summary.pubdate);
  return {
    id: summary.uid,
    title: summary.title?.trim() || `PubMed ${summary.uid}`,
    journal: summary.fulljournalname || summary.source || 'Unknown journal',
    year: year || YEAR_START,
    doi: extractDoi(summary.articleids),
    url: `https://pubmed.ncbi.nlm.nih.gov/${summary.uid}/`
  };
};

const parseFaculty = (rows) => {
  const [headerRow, ...body] = rows;
  const headers = headerRow.map((header) => header.trim());
  const records = body
    .map((row) =>
      headers.reduce((acc, header, index) => {
        acc[header] = (row[index] ?? '').trim();
        return acc;
      }, {})
    )
    .filter((record) => record.fore_name || record.last_name);

  const facultyMap = new Map();

  records.forEach((record) => {
    const idBase = record.person_id || `${record.fore_name}-${record.last_name}-${record.email}`;
    const key = toSlug(idBase);

    if (!facultyMap.has(key)) {
      facultyMap.set(key, {
        id: key,
        foreName: record.fore_name,
        lastName: record.last_name,
        orcid: record.orcid,
        email: record.email,
        signatureTerms: new Set(),
        programs: new Set()
      });
    }

    const person = facultyMap.get(key);
    parseSignatureTerms(record.signature_terms).forEach((term) => person.signatureTerms.add(term));
    if (record['program']) {
      person.programs.add(record['program']);
    }
  });

  return Array.from(facultyMap.values()).map((person) => {
    const signatureTerms = Array.from(person.signatureTerms);
    const affiliationTerms = signatureTerms.filter((term) => !isEmail(term));

    return {
      id: person.id,
      name: `${person.foreName} ${person.lastName}`.trim(),
      foreName: person.foreName,
      lastName: person.lastName,
      department: DEFAULT_AFFILIATION,
      orcid: person.orcid || '',
      email: person.email || '',
      signatureTerms,
      programs: Array.from(person.programs)
    };
  });
};

const buildTerm = ({ nameFirst, nameLast, orcid, signatureTerms }) => {
  const authorClause = buildAuthorClause(nameFirst, nameLast, orcid);
  const yearClause = parseYearClause(YEAR_START, YEAR_END);
  const affiliationTerms = signatureTerms.filter((term) => !isEmail(term));
  if (
    DEFAULT_AFFILIATION &&
    !affiliationTerms.some(
      (term) => term.toLowerCase() === DEFAULT_AFFILIATION.toLowerCase()
    )
  ) {
    affiliationTerms.push(DEFAULT_AFFILIATION);
  }
  const affiliationClause = buildAffiliationClause(affiliationTerms);

  return [authorClause, yearClause, affiliationClause].filter(Boolean).join(' AND ');
};

const main = async () => {
  if (!EMAIL || EMAIL.includes('example.com')) {
    console.warn('NCBI_EMAIL is not set. Using a placeholder email may be rate-limited.');
  }

  const csvText = await readFile(CSV_PATH, 'utf8');
  const rows = parseCsv(csvText);
  const faculty = parseFaculty(rows);

  const results = [];

  for (const person of faculty) {
    const term = buildTerm({
      nameFirst: person.foreName,
      nameLast: person.lastName,
      orcid: person.orcid,
      signatureTerms: person.signatureTerms
    });

    console.log(`Searching PubMed for ${person.name}...`);
    const pmids = await fetchPmids(term, EMAIL, TOOL, API_KEY);

    const summaries = [];
    for (const batch of chunk(pmids, 200)) {
      const batchSummaries = await fetchSummaries(batch, EMAIL, TOOL, API_KEY);
      summaries.push(...batchSummaries);
    }

    const publications = summaries
      .map(mapSummaryToPublication)
      .filter((pub) => pub.year >= YEAR_START && pub.year <= YEAR_END)
      .sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));

    results.push({
      id: person.id,
      name: person.name,
      department: person.department,
      orcid: person.orcid,
      areas: [],
      programs: person.programs,
      publications
    });

    await sleep(350);
  }

  const output = {
    updated: new Date().toISOString().slice(0, 10),
    source: 'PubMed E-utilities',
    faculty: results
  };

  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${OUTPUT_PATH}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
