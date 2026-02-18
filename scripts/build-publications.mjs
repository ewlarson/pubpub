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

const TODAY = new Date();
const CURRENT_YEAR = TODAY.getFullYear();
const YEAR_START_OVERRIDE = process.env.PUB_YEAR_START || process.env.PUB_YEAR || '';
const YEAR_END_OVERRIDE = process.env.PUB_YEAR_END || process.env.PUB_YEAR || '';
const parsedStartOverride = YEAR_START_OVERRIDE ? Number(YEAR_START_OVERRIDE) : NaN;
const parsedEndOverride = YEAR_END_OVERRIDE ? Number(YEAR_END_OVERRIDE) : NaN;
const DEFAULT_YEAR_START = Number.isFinite(parsedStartOverride) ? parsedStartOverride : null;
const DEFAULT_YEAR_END = Number.isFinite(parsedEndOverride) ? parsedEndOverride : CURRENT_YEAR;
const DEFAULT_END_DATE = Number.isFinite(parsedEndOverride)
  ? new Date(DEFAULT_YEAR_END, 11, 31)
  : TODAY;
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

const formatDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
};

const parseDateClause = (startDate, endDate) => {
  if (!startDate || !(startDate instanceof Date) || Number.isNaN(startDate.getTime())) {
    return '';
  }
  if (!endDate || !(endDate instanceof Date) || Number.isNaN(endDate.getTime())) {
    return `${formatDate(startDate)}[pdat]`;
  }
  return `("${formatDate(startDate)}"[pdat] : "${formatDate(endDate)}"[pdat])`;
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

const buildNameKey = (foreName, lastName) => {
  const fore = String(foreName || '').trim();
  const last = String(lastName || '').trim();
  if (!fore && !last) {
    return '';
  }
  return `${fore}||${last}`;
};

const parseNameKey = (key) => {
  const [foreName = '', lastName = ''] = String(key || '').split('||');
  return { foreName, lastName };
};

const normalizeName = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');

const normalizeAffiliation = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const MONTH_INDEX = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11
};

const parseMonthValue = (value) => {
  if (!value) {
    return null;
  }
  const token = String(value).toLowerCase();
  const numeric = Number(token);
  if (Number.isFinite(numeric)) {
    const monthIndex = numeric - 1;
    return monthIndex >= 0 && monthIndex <= 11 ? monthIndex : null;
  }
  const key = token.slice(0, 3);
  if (Object.prototype.hasOwnProperty.call(MONTH_INDEX, key)) {
    return MONTH_INDEX[key];
  }
  return null;
};

const parseYearValue = (value) => {
  if (!value) {
    return null;
  }
  const match = String(value).match(/\d{4}/);
  return match ? Number(match[0]) : null;
};

const buildDateFromParts = (yearValue, monthValue, dayValue) => {
  const year = parseYearValue(yearValue);
  if (!year) {
    return null;
  }
  const monthIndex = parseMonthValue(monthValue) ?? 0;
  const dayNumber = Number(dayValue);
  const day = Number.isFinite(dayNumber) && dayNumber >= 1 && dayNumber <= 31 ? dayNumber : 1;
  return new Date(year, monthIndex, day);
};

const parsePubDateString = (value) => {
  if (!value) {
    return null;
  }
  const cleaned = String(value).replace(/[;,]/g, ' ').trim();
  const tokens = cleaned.replace(/[-/]/g, ' ').split(/\s+/).filter(Boolean);
  let year = null;
  let yearIndex = -1;
  for (let i = 0; i < tokens.length; i += 1) {
    if (/^\d{4}$/.test(tokens[i])) {
      year = Number(tokens[i]);
      yearIndex = i;
      break;
    }
  }
  if (!year) {
    return null;
  }
  let monthIndex = 0;
  let monthTokenIndex = -1;
  for (let i = yearIndex + 1; i < tokens.length; i += 1) {
    const monthValue = parseMonthValue(tokens[i]);
    if (monthValue !== null) {
      monthIndex = monthValue;
      monthTokenIndex = i;
      break;
    }
  }
  let day = 1;
  if (monthTokenIndex >= 0) {
    for (let i = monthTokenIndex + 1; i < tokens.length; i += 1) {
      if (/^\d{1,2}$/.test(tokens[i])) {
        const numeric = Number(tokens[i]);
        if (numeric >= 1 && numeric <= 31) {
          day = numeric;
          break;
        }
      }
    }
  }
  return new Date(year, monthIndex, day);
};

const buildAffiliationClause = (terms) => {
  const cleaned = terms.map((term) => term.replace(/\s+/g, ' ').trim());
  if (!cleaned.length) {
    return '';
  }
  const clauses = cleaned.map((term) => `"${term}"[ad]`);
  return `(${clauses.join(' OR ')})`;
};

const buildAuthorClause = (nameVariants, orcid, includeInitials = true) => {
  const clauses = [];

  (nameVariants || []).forEach(({ foreName, lastName }) => {
    const trimmedFirst = (foreName || '').trim();
    const trimmedLast = (lastName || '').trim();
    if (!trimmedLast) {
      return;
    }
    const fullName = trimmedFirst && trimmedLast ? `${trimmedLast} ${trimmedFirst}[fau]` : '';
    const firstInitial = trimmedFirst ? trimmedFirst[0] : '';
    const initialName = includeInitials && firstInitial && trimmedLast
      ? `${trimmedLast} ${firstInitial}[au]`
      : '';
    if (fullName) {
      clauses.push(fullName);
    }
    if (initialName) {
      clauses.push(initialName);
    }
  });

  if (orcid) {
    clauses.push(`${orcid}[auid]`);
  }

  const uniqueClauses = Array.from(new Set(clauses));
  if (!uniqueClauses.length) {
    return '';
  }
  if (uniqueClauses.length === 1) {
    return uniqueClauses[0];
  }
  return `(${uniqueClauses.join(' OR ')})`;
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
  if (!authorLast) {
    return false;
  }

  const variants = Array.isArray(person.nameVariants) && person.nameVariants.length
    ? person.nameVariants
    : [{ foreName: person.foreName, lastName: person.lastName }];

  const authorFore = normalizeName(getText(author.ForeName));
  const authorInitial = normalizeName(getText(author.Initials || author.ForeName)).charAt(0);

  return variants.some((variant) => {
    const personLast = normalizeName(variant.lastName);
    if (!personLast || authorLast !== personLast) {
      return false;
    }

    const personFore = normalizeName(variant.foreName);
    if (authorFore && personFore) {
      if (authorFore === personFore) {
        return true;
      }
      if (authorFore.startsWith(personFore) || personFore.startsWith(authorFore)) {
        return true;
      }
    }

    const personInitial = personFore.charAt(0);
    return Boolean(authorInitial && personInitial && authorInitial === personInitial);
  });
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

const mapSummaryToPublication = (summary, pubDate) => {
  const year = pubDate ? pubDate.getFullYear() : extractYear(summary.pubdate);
  return {
    id: summary.uid,
    title: summary.title?.trim() || `PubMed ${summary.uid}`,
    journal: summary.fulljournalname || summary.source || 'Unknown journal',
    year: year || null,
    doi: extractDoi(summary.articleids),
    url: `https://pubmed.ncbi.nlm.nih.gov/${summary.uid}/`
  };
};

const parsePubDateFromXml = (article) => {
  const articleDates = toArray(article?.MedlineCitation?.Article?.ArticleDate);
  for (const dateEntry of articleDates) {
    const parsed = buildDateFromParts(dateEntry?.Year, dateEntry?.Month, dateEntry?.Day);
    if (parsed) {
      return parsed;
    }
  }

  const pubDate = article?.MedlineCitation?.Article?.Journal?.JournalIssue?.PubDate;
  if (pubDate) {
    const parsed = buildDateFromParts(pubDate.Year, pubDate.Month, pubDate.Day);
    if (parsed) {
      return parsed;
    }
    const medlineDate = getText(pubDate.MedlineDate);
    const medlineParsed = parsePubDateString(medlineDate);
    if (medlineParsed) {
      return medlineParsed;
    }
  }

  return null;
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
    const pubDate = parsePubDateFromXml(article);
    return { pmid, authors, pubDate };
  });
};

const filterPmidsByAuthorAffiliation = async (pmids, person, affiliationTerms) => {
  if (!pmids.length) {
    return { validPmids: new Set(), pubDates: new Map() };
  }

  const allowedTerms = affiliationTerms.length ? affiliationTerms : [DEFAULT_AFFILIATION];
  const normalizedAllowed = allowedTerms.map(normalizeAffiliation).filter(Boolean);
  const kept = new Set();
  const pubDates = new Map();
  let missingAffiliationCount = 0;

  for (const batch of chunk(pmids, 100)) {
    const xmlText = await fetchArticleXml(batch, EMAIL, TOOL, API_KEY);
    const articles = parseArticlesFromXml(xmlText);

    articles.forEach(({ pmid, authors, pubDate }) => {
      if (pmid && pubDate) {
        pubDates.set(String(pmid), pubDate);
      }
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

  return { validPmids: kept, pubDates };
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
        startDate: null,
        nameVariants: new Set()
      });
    }

    const person = facultyMap.get(key);
    const nameKey = buildNameKey(record.fore_name, record.last_name);
    if (nameKey) {
      person.nameVariants.add(nameKey);
    }
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

    const nameVariants = Array.from(person.nameVariants).map(parseNameKey);

    return {
      id: person.id,
      name: `${person.foreName} ${person.lastName}`.trim(),
      foreName: person.foreName,
      lastName: person.lastName,
      department: DEFAULT_AFFILIATION,
      orcid: person.orcid || '',
      email: person.email || '',
      nameVariants: nameVariants.length
        ? nameVariants
        : [{ foreName: person.foreName, lastName: person.lastName }],
      signatureTerms,
      programs: Array.from(person.programs),
      startDate: person.startDate,
      startYear: person.startDate ? person.startDate.getFullYear() : null
    };
  });
};

const buildTerm = ({
  nameFirst,
  nameLast,
  nameVariants,
  orcid,
  signatureTerms,
  startDate,
  endDate
}) => {
  const includeInitials = ALLOW_INITIALS && !orcid;
  const resolvedVariants = nameVariants?.length
    ? nameVariants
    : [{ foreName: nameFirst, lastName: nameLast }];
  const authorClause = buildAuthorClause(resolvedVariants, orcid, includeInitials);
  const yearClause = parseDateClause(startDate, endDate);
  const affiliationTerms = signatureTerms.filter((term) => !isEmail(term));
  if (
    DEFAULT_AFFILIATION &&
    !affiliationTerms.some(
      (term) => term.toLowerCase() === DEFAULT_AFFILIATION.toLowerCase()
    )
  ) {
    affiliationTerms.push(DEFAULT_AFFILIATION);
  }
  return {
    term: [authorClause, yearClause].filter(Boolean).join(' AND '),
    affiliationTerms
  };
};

const shouldIncludePublication = ({ pubDate, pubYear, startDate, endDate }) => {
  const startYear = startDate ? startDate.getFullYear() : null;
  const endYear = endDate ? endDate.getFullYear() : null;

  if (pubYear && startYear && pubYear < startYear) {
    return false;
  }
  if (pubYear && endYear && pubYear > endYear) {
    return false;
  }
  if (startDate && pubDate && pubDate < startDate) {
    return false;
  }
  if (endDate && pubDate && pubDate > endDate) {
    return false;
  }
  if (startDate && !pubDate && pubYear === startYear) {
    return false;
  }
  return true;
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
    const personStartDate = Number.isFinite(DEFAULT_YEAR_START)
      ? new Date(DEFAULT_YEAR_START, 0, 1)
      : person.startDate;
    const personEndDate = DEFAULT_END_DATE;
    const personYearStart = personStartDate ? personStartDate.getFullYear() : null;
    const personYearEnd = personEndDate.getFullYear();

    const { term, affiliationTerms } = buildTerm({
      nameFirst: person.foreName,
      nameLast: person.lastName,
      nameVariants: person.nameVariants,
      orcid: person.orcid,
      signatureTerms: person.signatureTerms,
      startDate: personStartDate,
      endDate: personEndDate
    });

    const dateLabel = personStartDate
      ? `${personStartDate.toISOString().slice(0, 10)}-${personEndDate
          .toISOString()
          .slice(0, 10)}`
      : `through ${personEndDate.toISOString().slice(0, 10)}`;
    console.log(`Searching PubMed for ${person.name} (${dateLabel})...`);
    const pmids = await fetchPmids(term, EMAIL, TOOL, API_KEY);

    const { validPmids, pubDates } = VALIDATE_AFFILIATION
      ? await filterPmidsByAuthorAffiliation(pmids, person, affiliationTerms)
      : { validPmids: new Set(pmids.map(String)), pubDates: new Map() };

    const summaries = [];
    for (const batch of chunk(pmids, 200)) {
      const batchSummaries = await fetchSummaries(batch, EMAIL, TOOL, API_KEY);
      summaries.push(...batchSummaries);
    }

    const publications = summaries
      .filter((summary) => validPmids.has(String(summary.uid)))
      .map((summary) => {
        const pubDate = pubDates.get(String(summary.uid)) || parsePubDateString(summary.pubdate);
        const pubYear = pubDate ? pubDate.getFullYear() : extractYear(summary.pubdate);
        return { summary, pubDate, pubYear };
      })
      .filter(({ pubDate, pubYear }) =>
        shouldIncludePublication({
          pubDate,
          pubYear,
          startDate: personStartDate,
          endDate: personEndDate
        })
      )
      .map(({ summary, pubDate }) => mapSummaryToPublication(summary, pubDate))
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
