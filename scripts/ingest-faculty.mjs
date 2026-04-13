import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { initDb, remapFacultyIdReferences, toSlug, upsertCanonicalFaculty } from './db.mjs';

const envLocal = path.resolve('.env.local');
if (existsSync(envLocal)) {
  dotenv.config({ path: envLocal });
} else {
  dotenv.config();
}

const CSV_PATH = path.resolve('data', 'CTSI Faculty - Sheet1.csv');
const OVERRIDES_PATH = path.resolve('data', 'faculty-identity-overrides.json');

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

const normalizeHeader = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');

const normalize = (value) => String(value || '').trim();
const normalizeIdentity = (value) => normalize(value).toLowerCase();

const parseStartDate = (value) => {
  const raw = normalize(value);
  if (!raw) {
    return null;
  }
  const parts = raw.split('/');
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

const parsePrograms = (value) => {
  const token = normalize(value);
  return token ? [token] : [];
};

const parseSignatureTerms = (value) =>
  String(value || '')
    .split('|')
    .map((term) => term.trim())
    .filter(Boolean);

const readOverrides = async () => {
  if (!existsSync(OVERRIDES_PATH)) {
    return [];
  }
  const raw = await readFile(OVERRIDES_PATH, 'utf8');
  const data = JSON.parse(raw);
  return Array.isArray(data.aliases) ? data.aliases : [];
};

const parseFacultyRecords = (rows) => {
  const [headerRow, ...body] = rows;
  const headers = headerRow.map(normalizeHeader);
  return body
    .map((row) =>
      headers.reduce((acc, header, index) => {
        acc[header] = normalize(row[index]);
        return acc;
      }, {})
    )
    .filter((record) => record.fore_name || record.first_name)
    .map((record) => {
      const foreName = record.fore_name || record.first_name || '';
      const lastName = record.last_name || '';
      const email = record.email || '';
      const orcid = record.orcid || record.orcid_id || '';
      const legacySlug = toSlug(record.person_id || `${foreName}-${lastName}-${email}`);
      return {
        id: legacySlug,
        legacySlug,
        foreName,
        lastName,
        name: `${foreName} ${lastName}`.trim(),
        email,
        orcid: /^none$/i.test(orcid) ? '' : orcid,
        signatureTerms: parseSignatureTerms(record.signature_terms),
        programs: parsePrograms(record.program),
        startDate: parseStartDate(record.start_date || record.funding_start_date)
      };
    });
};

const resolveOverrideCanonicalId = (person, aliases) => {
  const personEmail = normalizeIdentity(person.email);
  const personOrcid = normalizeIdentity(person.orcid);
  const personName = normalizeIdentity(person.name);

  for (const alias of aliases) {
    const match = alias?.match || {};
    const matchEmail = normalizeIdentity(match.email);
    const matchOrcid = normalizeIdentity(match.orcid);
    const matchName = normalizeIdentity(match.name);
    if (matchEmail && matchEmail === personEmail) {
      return toSlug(alias.canonicalId);
    }
    if (matchOrcid && matchOrcid === personOrcid) {
      return toSlug(alias.canonicalId);
    }
    if (matchName && matchName === personName) {
      return toSlug(alias.canonicalId);
    }
  }
  return '';
};

const main = async () => {
  const csvText = await readFile(CSV_PATH, 'utf8');
  const rows = parseCsv(csvText);
  const facultyRecords = parseFacultyRecords(rows);
  const overrides = await readOverrides();
  const db = initDb();

  let mergedCount = 0;
  const canonicalIds = new Set();
  for (const person of facultyRecords) {
    const overrideCanonicalId = resolveOverrideCanonicalId(person, overrides);
    const canonicalId = upsertCanonicalFaculty(db, person, {
      source: 'csv',
      legacySlug: person.legacySlug
    });
    const resolvedCanonicalId = overrideCanonicalId || canonicalId;
    if (resolvedCanonicalId !== canonicalId) {
      upsertCanonicalFaculty(db, { ...person, id: resolvedCanonicalId }, { source: 'override' });
    }
    remapFacultyIdReferences(db, person.legacySlug, resolvedCanonicalId);
    if (person.legacySlug !== resolvedCanonicalId) {
      mergedCount += 1;
    }
    canonicalIds.add(resolvedCanonicalId);
  }

  const activeCount =
    db.prepare('SELECT COUNT(*) AS count FROM faculty WHERE active = 1').get()?.count || 0;

  db.close();
  console.log(
    `Ingested ${facultyRecords.length} source rows into ${canonicalIds.size} canonical faculty IDs.`
  );
  console.log(`Merged ${mergedCount} legacy IDs via identity rules/overrides.`);
  console.log(`Faculty rows in DB (active): ${activeCount}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
