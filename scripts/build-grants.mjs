import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const envLocal = path.resolve('.env.local');
if (existsSync(envLocal)) {
  dotenv.config({ path: envLocal });
} else {
  dotenv.config();
}

const CSV_PATH = path.resolve('data', 'CTSI Faculty - Sheet1.csv');
const OUTPUT_PATH = path.resolve('public', 'data', 'grants.json');
const API_URL = process.env.REPORTER_API_URL || 'https://api.reporter.nih.gov/v2/projects/search';

const DEFAULT_AFFILIATION = process.env.REPORTER_DEFAULT_ORG || 'University of Minnesota';
const ORG_NAMES_OVERRIDE = process.env.REPORTER_ORG_NAMES || '';
const FISCAL_YEARS_OVERRIDE = process.env.REPORTER_FISCAL_YEARS || '';
const parsedDelay = Number(process.env.REPORTER_DELAY_MS);
const parsedLimit = Number(process.env.REPORTER_PAGE_LIMIT);
const REQUEST_DELAY_MS = Number.isFinite(parsedDelay) ? parsedDelay : 1100;
const PAGE_LIMIT = Number.isFinite(parsedLimit) ? parsedLimit : 500;

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const INCLUDE_FIELDS = [
  'ProjectNum',
  'CoreProjectNum',
  'ProjectTitle',
  'ProjectStartDate',
  'ProjectEndDate',
  'AwardAmount',
  'FiscalYear',
  'PrincipalInvestigators',
  'ProjectDetailUrl'
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseList = (value) =>
  String(value || '')
    .split(/[|,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const parseYearList = (value) =>
  parseList(value)
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry));

const normalizeKey = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const toSlug = (value) =>
  String(value || '')
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

const parseSignatureTerms = (value) =>
  String(value || '')
    .split('|')
    .map((entry) => entry.trim())
    .filter(Boolean);

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

const isEmail = (value) => String(value || '').includes('@');

const buildOrgNames = (signatureTerms) => {
  const orgs = signatureTerms.filter((term) => !isEmail(term));
  if (
    DEFAULT_AFFILIATION &&
    !orgs.some(
      (term) => term.toLowerCase() === DEFAULT_AFFILIATION.toLowerCase()
    )
  ) {
    orgs.push(DEFAULT_AFFILIATION);
  }
  return orgs;
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
        email: record.email,
        signatureTerms: new Set(),
        programs: new Set(),
        startDate: null
      });
    }

    const person = facultyMap.get(key);
    parseSignatureTerms(record.signature_terms).forEach((term) =>
      person.signatureTerms.add(term)
    );
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
    const orgNames = buildOrgNames(signatureTerms);

    return {
      id: person.id,
      name: `${person.foreName} ${person.lastName}`.trim(),
      foreName: person.foreName,
      lastName: person.lastName,
      department: DEFAULT_AFFILIATION,
      email: person.email || '',
      signatureTerms,
      programs: Array.from(person.programs),
      orgNames,
      startDate: person.startDate
    };
  });
};

const buildPiNames = (person) => {
  const first = person.foreName?.trim() || '';
  const last = person.lastName?.trim() || '';
  const anyName = `${first} ${last}`.trim();
  return [
    {
      first_name: first,
      last_name: last,
      any_name: anyName
    }
  ];
};

const toDate = (value) => {
  if (!value) {
    return '';
  }
  const iso = String(value);
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
};

const parseProjectDate = (value) => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const filterProjectsByStartDate = (projects, startDate) => {
  if (!startDate) {
    return projects;
  }
  return projects.filter((project) => {
    const projectStart = parseProjectDate(project.project_start_date);
    if (!projectStart) {
      return true;
    }
    return projectStart >= startDate;
  });
};

const resolveRole = (person, principalInvestigators) => {
  if (!Array.isArray(principalInvestigators) || principalInvestigators.length === 0) {
    return 'Not listed';
  }
  const target = normalizeKey(`${person.foreName} ${person.lastName}`);
  const match = principalInvestigators.find((pi) => {
    const name = pi.full_name || `${pi.first_name || ''} ${pi.last_name || ''}`;
    const normalized = normalizeKey(name);
    return normalized === target || normalized.includes(target) || target.includes(normalized);
  });

  if (!match) {
    return 'Not listed';
  }
  return match.is_contact_pi ? 'Contact PI' : 'PI';
};

const reporterSearch = async (payload, { maxRetries = 6 } = {}) => {
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (response.ok) {
        return response.json();
      }

      if (RETRYABLE_STATUSES.has(response.status)) {
        const baseDelay = 800 * 2 ** attempt;
        const jitter = 1 + Math.random() * 0.25;
        await sleep(baseDelay * jitter);
        continue;
      }

      const errorBody = await response.text();
      throw new Error(`NIH RePORTER request failed (${response.status}): ${errorBody}`);
    } catch (error) {
      clearTimeout(timeout);
      if (attempt < maxRetries - 1) {
        const baseDelay = 800 * 2 ** attempt;
        const jitter = 1 + Math.random() * 0.25;
        await sleep(baseDelay * jitter);
        continue;
      }
      throw error;
    }
  }

  throw new Error('NIH RePORTER request failed after retries');
};

const fetchProjectsForPerson = async (person, { fiscalYears, orgNames }) => {
  const criteria = {
    pi_names: buildPiNames(person),
    fiscal_years: Array.isArray(fiscalYears) && fiscalYears.length > 0 ? fiscalYears : []
  };
  if (Array.isArray(orgNames) && orgNames.length > 0) {
    criteria.org_names = orgNames;
  }

  let offset = 0;
  let total = null;
  let searchUrl = '';
  const results = [];

  while (true) {
    const payload = {
      criteria,
      include_fields: INCLUDE_FIELDS,
      offset,
      limit: PAGE_LIMIT
    };

    const data = await reporterSearch(payload);
    const pageResults =
      data?.results || data?.projects || data?.data || data?.items || [];
    const meta = data?.meta || {};

    if (!searchUrl) {
      searchUrl = meta?.url || meta?.search_url || '';
    }

    if (typeof meta?.total === 'number') {
      total = meta.total;
    } else if (typeof meta?.total_count === 'number') {
      total = meta.total_count;
    }

    results.push(...pageResults);

    if (!pageResults.length) {
      break;
    }
    if (pageResults.length < PAGE_LIMIT) {
      break;
    }

    offset += PAGE_LIMIT;
    if (total !== null && offset >= total) {
      break;
    }
    if (offset >= 15_000) {
      console.warn(`Offset cap hit for ${person.name}; truncating results.`);
      break;
    }

    await sleep(REQUEST_DELAY_MS);
  }

  return { results, searchUrl };
};

const uniqueBy = (items, getKey) => {
  const seen = new Set();
  const output = [];
  items.forEach((item) => {
    const key = getKey(item);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    output.push(item);
  });
  return output;
};

const mapGrants = (person, projects) => {
  const grants = projects.map((project) => {
    const parsedAmount = Number(project.award_amount);
    const amount = Number.isFinite(parsedAmount) ? parsedAmount : null;
    const parsedYear = Number(project.fiscal_year);
    const fiscalYear = Number.isFinite(parsedYear) ? parsedYear : null;
    return {
      id: project.project_num || project.core_project_num || String(project.appl_id || ''),
      title: project.project_title || '',
      role: resolveRole(person, project.principal_investigators),
      amount,
      startDate: toDate(project.project_start_date),
      endDate: toDate(project.project_end_date),
      fiscalYear,
      url: project.project_detail_url || '',
      coreProjectNum: project.core_project_num || ''
    };
  });

  const deduped = uniqueBy(grants, (grant) => `${grant.id}-${grant.fiscalYear || ''}`);
  return deduped.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
};

const main = async () => {
  const csvText = await readFile(CSV_PATH, 'utf8');
  const rows = parseCsv(csvText);
  const faculty = parseFaculty(rows);

  const orgNamesOverride = parseList(ORG_NAMES_OVERRIDE);
  const fiscalYears = parseYearList(FISCAL_YEARS_OVERRIDE);

  const results = [];

  for (const person of faculty) {
    const orgNames = orgNamesOverride.length ? orgNamesOverride : person.orgNames;
    console.log(`Searching NIH RePORTER for ${person.name}...`);

    try {
      const { results: projects, searchUrl } = await fetchProjectsForPerson(person, {
        fiscalYears,
        orgNames
      });
      const eligibleProjects = filterProjectsByStartDate(projects, person.startDate);
      const grants = mapGrants(person, eligibleProjects);

      results.push({
        id: person.id,
        name: person.name,
        department: person.department,
        programs: person.programs,
        reporterUrl: searchUrl,
        grants
      });
    } catch (error) {
      console.error(`Failed to fetch grants for ${person.name}: ${error.message}`);
      results.push({
        id: person.id,
        name: person.name,
        department: person.department,
        programs: person.programs,
        reporterUrl: '',
        grants: []
      });
    }

    await sleep(REQUEST_DELAY_MS);
  }

  const output = {
    updated: new Date().toISOString().slice(0, 10),
    source: 'NIH RePORTER API',
    faculty: results
  };

  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${OUTPUT_PATH}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
