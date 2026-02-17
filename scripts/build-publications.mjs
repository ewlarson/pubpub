import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { fetchArticleXml, fetchPmids, fetchSummaries } from './pubmed.mjs';

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

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_START_OVERRIDE = process.env.PUB_YEAR_START || process.env.PUB_YEAR || '';
const YEAR_END_OVERRIDE = process.env.PUB_YEAR_END || process.env.PUB_YEAR || '';
const parsedStartOverride = YEAR_START_OVERRIDE ? Number(YEAR_START_OVERRIDE) : NaN;
const parsedEndOverride = YEAR_END_OVERRIDE ? Number(YEAR_END_OVERRIDE) : NaN;
const DEFAULT_YEAR_START = Number.isFinite(parsedStartOverride) ? parsedStartOverride : null;
const DEFAULT_YEAR_END = Number.isFinite(parsedEndOverride) ? parsedEndOverride : CURRENT_YEAR;
const DEFAULT_AFFILIATION = 'University of Minnesota';
const ALLOW_INITIALS = process.env.PUB_USE_INITIALS !== 'false';
const VALIDATE_AFFILIATION = process.env.PUB_VALIDATE_AFFILIATION !== 'false';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  trimValues: true
});

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

const parseStartDate = (value) => {
  if (!value) {
    return null;
  }
  const parts = String(value).trim().split('/');
  if (parts.length !== 3) {
    return null;
  }
  const [month, day, year] = parts.map((part) => Number(part));
  if (!month || !day || !year) {
    return null;
  }
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseSignatureTerms = (value) =>
  value
    .split('|')
    .map((term) => term.trim())
    .filter(Boolean);

const isEmail = (value) => /@/.test(value);

const toArray = (value) => {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};

const getText = (value) => {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'object' && '#text' in value) {
    return String(value['#text']);
  }
  return '';
};

const normalizeName = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');

const normalizeAffiliation = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const buildAffiliationClause = (terms) => {
  const cleaned = terms.map((term) => term.replace(/\s+/g, ' ').trim());
  if (!cleaned.length) {
    return '';
  }
  const clauses = cleaned.map((term) => `"${term}"[ad]`);
  return `(${clauses.join(' OR ')})`;
};

const buildAuthorClause = (firstName, lastName, orcid, includeInitials = true) => {
  const trimmedFirst = (firstName || '').trim();
  const trimmedLast = (lastName || '').trim();
  const fullName = trimmedFirst && trimmedLast ? `"${trimmedLast} ${trimmedFirst}"[fau]` : '';
  const firstInitial = trimmedFirst ? trimmedFirst[0] : '';
  const initialName = includeInitials && firstInitial && trimmedLast
    ? `"${trimmedLast} ${firstInitial}"[au]`
    : '';

  const clauses = [fullName, initialName, orcid ? `"${orcid}"[auid]` : ''].filter(Boolean);
  if (clauses.length === 1) {
    return clauses[0];
  }
  return `(${clauses.join(' OR ')})`;
};

const extractOrcid = (author) => {
  const identifiers = toArray(author?.Identifier);
  for (const identifier of identifiers) {
    if (typeof identifier === 'string') {
      if (/\\d{4}-\\d{4}-\\d{4}-\\d{4}/.test(identifier)) {
        return identifier;
      }
      continue;
    }
    if (identifier?.['@_Source'] === 'ORCID') {
      return getText(identifier);
    }
  }
  return '';
};

const extractAffiliations = (author) => {
  const infoEntries = toArray(author?.AffiliationInfo);
  return infoEntries
    .flatMap((entry) => {
      if (!entry) {
        return [];
      }
      if (typeof entry === 'string') {
        return [entry];
      }
      const affiliation = entry.Affiliation ?? entry;
      return toArray(affiliation).map(getText);
    })
    .map((text) => text.trim())
    .filter(Boolean);
};

const authorMatchesPerson = (author, person) => {
  if (!author) {
    return false;
  }

  if (person.orcid) {
    const authorOrcid = extractOrcid(author).replace(/-/g, '');
    const targetOrcid = person.orcid.replace(/-/g, '');
    if (authorOrcid && targetOrcid && authorOrcid === targetOrcid) {
      return true;
    }
  }

  const authorLast = normalizeName(getText(author.LastName));
  const personLast = normalizeName(person.lastName);
  if (!authorLast || authorLast !== personLast) {
    return false;
  }

  const authorFore = normalizeName(getText(author.ForeName));
  const personFore = normalizeName(person.foreName);

  if (authorFore && personFore) {
    if (authorFore === personFore) {
      return true;
    }
    if (authorFore.startsWith(personFore) || personFore.startsWith(authorFore)) {
      return true;
    }
  }

  const authorInitial = normalizeName(getText(author.Initials || author.ForeName)).charAt(0);
  const personInitial = personFore.charAt(0);
  return Boolean(authorInitial && personInitial && authorInitial === personInitial);
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
    year: year || null,
    doi: extractDoi(summary.articleids),
    url: `https://pubmed.ncbi.nlm.nih.gov/${summary.uid}/`
  };
};

const parseArticlesFromXml = (xmlText) => {
  if (!xmlText) {
    return [];
  }
  const doc = xmlParser.parse(xmlText);
  const articles = toArray(doc?.PubmedArticleSet?.PubmedArticle);
  return articles.map((article) => {
    const citation = article.MedlineCitation || {};
    const pmid = getText(citation.PMID);
    const authors = toArray(citation.Article?.AuthorList?.Author);
    return { pmid, authors };
  });
};

const filterPmidsByAuthorAffiliation = async (pmids, person, affiliationTerms) => {
  if (!pmids.length) {
    return new Set();
  }

  const allowedTerms = affiliationTerms.length ? affiliationTerms : [DEFAULT_AFFILIATION];
  const normalizedAllowed = allowedTerms.map(normalizeAffiliation).filter(Boolean);
  const kept = new Set();
  let missingAffiliationCount = 0;

  for (const batch of chunk(pmids, 100)) {
    const xmlText = await fetchArticleXml(batch, EMAIL, TOOL, API_KEY);
    const articles = parseArticlesFromXml(xmlText);

    articles.forEach(({ pmid, authors }) => {
      const matchedAuthor = authors.find((author) => authorMatchesPerson(author, person));
      if (!matchedAuthor) {
        return;
      }

      const affiliations = extractAffiliations(matchedAuthor);
      if (!affiliations.length) {
        missingAffiliationCount += 1;
        kept.add(String(pmid));
        return;
      }

      const normalizedAffiliations = affiliations.map(normalizeAffiliation);
      const matches = normalizedAffiliations.some((aff) =>
        normalizedAllowed.some((term) => aff.includes(term))
      );

      if (matches) {
        kept.add(String(pmid));
      }
    });

    await sleep(120);
  }

  if (missingAffiliationCount > 0) {
    console.warn(
      `${person.name}: ${missingAffiliationCount} records missing author affiliation; kept them anyway.`
    );
  }

  return kept;
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
        programs: new Set(),
        startDate: null
      });
    }

    const person = facultyMap.get(key);
    parseSignatureTerms(record.signature_terms).forEach((term) => person.signatureTerms.add(term));
    if (record['program']) {
      person.programs.add(record['program']);
    }
    const startDate = parseStartDate(record['start date']);
    if (startDate && (!person.startDate || startDate < person.startDate)) {
      person.startDate = startDate;
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
      programs: Array.from(person.programs),
      startDate: person.startDate,
      startYear: person.startDate ? person.startDate.getFullYear() : null
    };
  });
};

const buildTerm = ({ nameFirst, nameLast, orcid, signatureTerms, yearStart, yearEnd }) => {
  const includeInitials = ALLOW_INITIALS && !orcid;
  const authorClause = buildAuthorClause(nameFirst, nameLast, orcid, includeInitials);
  const yearClause = parseYearClause(yearStart, yearEnd);
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

  return {
    term: [authorClause, yearClause, affiliationClause].filter(Boolean).join(' AND '),
    affiliationTerms
  };
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
    const personYearStart = Number.isFinite(DEFAULT_YEAR_START)
      ? DEFAULT_YEAR_START
      : person.startYear || DEFAULT_YEAR_END;
    const personYearEnd = DEFAULT_YEAR_END;

    const { term, affiliationTerms } = buildTerm({
      nameFirst: person.foreName,
      nameLast: person.lastName,
      orcid: person.orcid,
      signatureTerms: person.signatureTerms,
      yearStart: personYearStart,
      yearEnd: personYearEnd
    });

    console.log(`Searching PubMed for ${person.name} (${personYearStart}-${personYearEnd})...`);
    const pmids = await fetchPmids(term, EMAIL, TOOL, API_KEY);

    const validPmids = VALIDATE_AFFILIATION
      ? await filterPmidsByAuthorAffiliation(pmids, person, affiliationTerms)
      : new Set(pmids.map(String));

    const summaries = [];
    for (const batch of chunk(pmids, 200)) {
      const batchSummaries = await fetchSummaries(batch, EMAIL, TOOL, API_KEY);
      summaries.push(...batchSummaries);
    }

    const publications = summaries
      .filter((summary) => validPmids.has(String(summary.uid)))
      .map(mapSummaryToPublication)
      .filter(
        (pub) =>
          !pub.year ||
          (pub.year >= personYearStart && pub.year <= personYearEnd)
      )
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
