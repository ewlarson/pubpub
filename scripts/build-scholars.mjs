import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { fetchArticleXml, fetchPmids, fetchSummaries } from './pubmed.mjs';
import {
  buildScholarQuery,
  formatScholarProgramAssociation,
  isPublicationOnOrAfter,
  normalizeOrcid,
  parseScholarsCsv
} from './scholars.mjs';

const envLocal = path.resolve('.env.local');
dotenv.config(existsSync(envLocal) ? { path: envLocal } : undefined);

const INPUT_PATH = path.resolve('data', 'CTSI T Scholars - TRDP TL1 T32.csv');
const OUTPUT_PATH = path.resolve('public', 'data', 'scholars.json');
const EMAIL = process.env.NCBI_EMAIL || 'ewlarson@example.com';
const TOOL = process.env.NCBI_TOOL || 'ctsi_pubpub';
const API_KEY = process.env.NCBI_API_KEY || '';
const TODAY = new Date();

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  trimValues: true
});

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const chunk = (values, size) => {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

const toArray = (value) => {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};

const getText = (value) => {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  return String(value['#text'] || '');
};

const parseMonth = (value) => {
  const token = getText(value).trim().toLowerCase();
  const numeric = Number(token);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 12) {
    return numeric - 1;
  }
  const monthIndex = [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec'
  ].indexOf(token.slice(0, 3));
  return monthIndex >= 0 ? monthIndex : 0;
};

const buildDateFromParts = (yearValue, monthValue, dayValue) => {
  const year = Number(getText(yearValue));
  if (!Number.isInteger(year)) {
    return null;
  }
  const month = parseMonth(monthValue);
  const day = Number(getText(dayValue)) || 1;
  const date = new Date(year, month, day);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseSummaryDate = (value) => {
  const match = String(value || '').match(
    /(\d{4})(?:\s+([A-Za-z]{3,9}|\d{1,2}))?(?:\s+(\d{1,2}))?/
  );
  return match ? buildDateFromParts(match[1], match[2], match[3]) : null;
};

const parseArticleDate = (article) => {
  const citation = article?.MedlineCitation?.Article;
  for (const entry of toArray(citation?.ArticleDate)) {
    const date = buildDateFromParts(entry?.Year, entry?.Month, entry?.Day);
    if (date) {
      return date;
    }
  }
  const pubDate = citation?.Journal?.JournalIssue?.PubDate;
  return (
    buildDateFromParts(pubDate?.Year, pubDate?.Month, pubDate?.Day) ||
    parseSummaryDate(pubDate?.MedlineDate)
  );
};

const getAuthorOrcid = (author) => {
  for (const identifier of toArray(author?.Identifier)) {
    const source =
      typeof identifier === 'object' ? String(identifier['@_Source'] || '') : '';
    const normalized = normalizeOrcid(getText(identifier));
    if (normalized && (!source || /orcid/i.test(source))) {
      return normalized;
    }
  }
  return '';
};

const formatAuthorName = (author) =>
  [getText(author?.ForeName), getText(author?.LastName)].filter(Boolean).join(' ').trim();

const readArticleMetadata = async (pmids, scholar) => {
  const pubDates = new Map();
  const authorshipByPmid = new Map();
  const coauthorsByPmid = new Map();

  for (const batch of chunk(pmids, 100)) {
    const xmlText = await fetchArticleXml(batch, EMAIL, TOOL, API_KEY);
    const document = xmlParser.parse(xmlText);
    for (const article of toArray(document?.PubmedArticleSet?.PubmedArticle)) {
      const citation = article?.MedlineCitation || {};
      const pmid = getText(citation.PMID);
      if (!pmid) {
        continue;
      }

      const publicationDate = parseArticleDate(article);
      if (publicationDate) {
        pubDates.set(pmid, publicationDate);
      }

      const authors = toArray(citation?.Article?.AuthorList?.Author);
      const scholarIndex = authors.findIndex(
        (author) => getAuthorOrcid(author) === scholar.orcid
      );
      if (scholarIndex >= 0) {
        authorshipByPmid.set(pmid, {
          position: scholarIndex,
          total: authors.length,
          isFirst: scholarIndex === 0,
          isLast: scholarIndex === authors.length - 1
        });
        coauthorsByPmid.set(
          pmid,
          authors
            .filter((author, index) => index !== scholarIndex)
            .map(formatAuthorName)
            .filter(Boolean)
        );
      }
    }
    await sleep(120);
  }

  return { pubDates, authorshipByPmid, coauthorsByPmid };
};

const extractYear = (value) => {
  const match = String(value || '').match(/\d{4}/);
  return match ? Number(match[0]) : null;
};

const extractDoi = (articleIds = []) =>
  articleIds.find((entry) => entry.idtype === 'doi')?.value || '';

const mapSummary = (summary, publicationDate, authorship) => ({
  id: summary.uid,
  title: summary.title?.trim() || `PubMed ${summary.uid}`,
  journal: summary.fulljournalname || summary.source || 'Unknown journal',
  year: publicationDate?.getFullYear() || extractYear(summary.pubdate),
  doi: extractDoi(summary.articleids),
  url: `https://pubmed.ncbi.nlm.nih.gov/${summary.uid}/`,
  ...(authorship ? { authorship } : {})
});

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

const buildSignals = (publications, coauthorsByPmid) => {
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

const buildAuthorCounts = (publications) => {
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

const main = async () => {
  if (!EMAIL || EMAIL.includes('example.com')) {
    console.warn('NCBI_EMAIL is not set. Using a placeholder email may be rate-limited.');
  }

  const source = await readFile(INPUT_PATH, 'utf8');
  const { scholars, skipped } = parseScholarsCsv(source);
  skipped.forEach((entry) => {
    console.warn(`Skipping source row ${entry.row} (${entry.name || 'unnamed'}): ${entry.reason}.`);
  });

  const results = [];
  for (const scholar of scholars) {
    const term = buildScholarQuery({
      orcid: scholar.orcid,
      startDate: scholar.startDate,
      endDate: TODAY
    });
    console.log(
      `Searching PubMed by ORCID for ${scholar.name} (${scholar.startDate
        .toISOString()
        .slice(0, 10)} onward)...`
    );

    const pmids = await fetchPmids(term, EMAIL, TOOL, API_KEY);
    const { pubDates, authorshipByPmid, coauthorsByPmid } =
      await readArticleMetadata(pmids, scholar);
    const summaries = [];
    for (const batch of chunk(pmids, 200)) {
      summaries.push(...(await fetchSummaries(batch, EMAIL, TOOL, API_KEY)));
    }

    const publications = summaries
      .map((summary) => {
        const publicationDate =
          pubDates.get(String(summary.uid)) || parseSummaryDate(summary.pubdate);
        const publicationYear =
          publicationDate?.getFullYear() || extractYear(summary.pubdate);
        return { summary, publicationDate, publicationYear };
      })
      .filter(({ publicationDate, publicationYear }) =>
        isPublicationOnOrAfter({
          publicationDate,
          publicationYear,
          startDate: scholar.startDate
        })
      )
      .map(({ summary, publicationDate }) =>
        mapSummary(
          summary,
          publicationDate,
          authorshipByPmid.get(String(summary.uid))
        )
      )
      .sort(
        (left, right) =>
          (right.year || 0) - (left.year || 0) ||
          left.title.localeCompare(right.title)
      );

    results.push({
      id: scholar.id,
      name: scholar.name,
      foreName: scholar.foreName,
      lastName: scholar.lastName,
      department: '',
      orcid: scholar.orcid,
      areas: scholar.projectTitle ? [scholar.projectTitle] : [],
      programs: [scholar.program],
      programAssociations: [formatScholarProgramAssociation(scholar)],
      projectTitle: scholar.projectTitle,
      publications,
      authorCounts: buildAuthorCounts(publications),
      signals: {
        positive: buildSignals(publications, coauthorsByPmid),
        negative: buildSignals([], new Map())
      }
    });

    await sleep(350);
  }

  const updatedAt = new Date().toISOString();
  const output = {
    updated: updatedAt.slice(0, 10),
    updatedAt,
    source: 'PubMed E-utilities (ORCID)',
    faculty: results
  };
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${OUTPUT_PATH} with ${results.length} scholars.`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

