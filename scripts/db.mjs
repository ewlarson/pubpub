import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

export const DEFAULT_DB_PATH =
  process.env.PUBPUB_DB_PATH || path.resolve('data', 'pubpub.sqlite');

export const toSlug = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const normalizeIdentity = (value) => String(value || '').trim().toLowerCase();

const toIsoDate = (value) => {
  if (!value) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  if (!raw) {
    return '';
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return parsed.toISOString().slice(0, 10);
};

export const initDb = (dbPath = DEFAULT_DB_PATH) => {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS faculty (
      id TEXT PRIMARY KEY,
      external_slug TEXT UNIQUE,
      display_name TEXT NOT NULL,
      fore_name TEXT,
      last_name TEXT,
      email TEXT,
      orcid TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_faculty_email ON faculty(email);
    CREATE INDEX IF NOT EXISTS idx_faculty_orcid ON faculty(orcid);

    CREATE TABLE IF NOT EXISTS faculty_aliases (
      alias_id INTEGER PRIMARY KEY AUTOINCREMENT,
      faculty_id TEXT NOT NULL,
      alias_name TEXT,
      alias_email TEXT,
      alias_orcid TEXT,
      source TEXT NOT NULL DEFAULT 'csv',
      UNIQUE(faculty_id, alias_name, alias_email, alias_orcid, source),
      FOREIGN KEY (faculty_id) REFERENCES faculty(id)
    );
    CREATE INDEX IF NOT EXISTS idx_alias_email ON faculty_aliases(alias_email);
    CREATE INDEX IF NOT EXISTS idx_alias_orcid ON faculty_aliases(alias_orcid);

    CREATE TABLE IF NOT EXISTS faculty_programs (
      faculty_id TEXT NOT NULL,
      program TEXT NOT NULL,
      start_date TEXT,
      end_date TEXT,
      PRIMARY KEY (faculty_id, program, start_date),
      FOREIGN KEY (faculty_id) REFERENCES faculty(id)
    );

    CREATE TABLE IF NOT EXISTS publications (
      pmid TEXT PRIMARY KEY,
      title TEXT,
      journal TEXT,
      year INTEGER,
      doi TEXT,
      url TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS faculty_publications (
      faculty_id TEXT NOT NULL,
      pmid TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'pubmed',
      PRIMARY KEY (faculty_id, pmid)
    );
    CREATE TABLE IF NOT EXISTS curation (
      faculty_id TEXT NOT NULL,
      pmid TEXT NOT NULL,
      verdict TEXT NOT NULL CHECK (verdict IN ('true_positive', 'false_positive')),
      reason TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (faculty_id, pmid)
    );
    CREATE TABLE IF NOT EXISTS faculty_publication_coauthors (
      faculty_id TEXT NOT NULL,
      pmid TEXT NOT NULL,
      name TEXT NOT NULL,
      PRIMARY KEY (faculty_id, pmid, name)
    );

    CREATE TABLE IF NOT EXISTS grants (
      id TEXT PRIMARY KEY,
      core_project_num TEXT,
      title TEXT,
      start_date TEXT,
      end_date TEXT,
      fiscal_year INTEGER,
      url TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS faculty_grants (
      faculty_id TEXT NOT NULL,
      grant_id TEXT NOT NULL,
      role TEXT,
      amount REAL,
      source TEXT NOT NULL DEFAULT 'nih_reporter',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (faculty_id, grant_id),
      FOREIGN KEY (faculty_id) REFERENCES faculty(id),
      FOREIGN KEY (grant_id) REFERENCES grants(id)
    );
    CREATE INDEX IF NOT EXISTS idx_faculty_grants_faculty ON faculty_grants(faculty_id);
    CREATE INDEX IF NOT EXISTS idx_faculty_grants_grant ON faculty_grants(grant_id);
  `);

  const currentVersion = db.pragma('user_version', { simple: true });
  if (currentVersion < 1) {
    db.pragma('user_version = 1');
  }
  return db;
};

const findFacultyByIdentity = (db, { orcid, email, legacySlug }) => {
  const normalizedOrcid = normalizeIdentity(orcid);
  const normalizedEmail = normalizeIdentity(email);
  const normalizedSlug = normalizeIdentity(legacySlug);

  if (normalizedOrcid) {
    const byOrcid = db
      .prepare('SELECT id FROM faculty WHERE lower(orcid) = ? LIMIT 1')
      .get(normalizedOrcid);
    if (byOrcid?.id) {
      return byOrcid.id;
    }
    const aliasOrcid = db
      .prepare('SELECT faculty_id AS id FROM faculty_aliases WHERE lower(alias_orcid) = ? LIMIT 1')
      .get(normalizedOrcid);
    if (aliasOrcid?.id) {
      return aliasOrcid.id;
    }
  }

  if (normalizedEmail) {
    const byEmail = db
      .prepare('SELECT id FROM faculty WHERE lower(email) = ? LIMIT 1')
      .get(normalizedEmail);
    if (byEmail?.id) {
      return byEmail.id;
    }
    const aliasEmail = db
      .prepare('SELECT faculty_id AS id FROM faculty_aliases WHERE lower(alias_email) = ? LIMIT 1')
      .get(normalizedEmail);
    if (aliasEmail?.id) {
      return aliasEmail.id;
    }
  }

  if (normalizedSlug) {
    const bySlug = db
      .prepare('SELECT id FROM faculty WHERE lower(external_slug) = ? LIMIT 1')
      .get(normalizedSlug);
    if (bySlug?.id) {
      return bySlug.id;
    }
  }

  return '';
};

export const upsertCanonicalFaculty = (db, person, options = {}) => {
  const source = options.source || 'csv';
  const legacySlug = toSlug(options.legacySlug || person.id || '');
  const displayName =
    person.name ||
    `${String(person.foreName || '').trim()} ${String(person.lastName || '').trim()}`.trim() ||
    legacySlug;
  const foreName = String(person.foreName || '').trim();
  const lastName = String(person.lastName || '').trim();
  const email = String(person.email || '').trim();
  const orcid = String(person.orcid || '').trim();

  let canonicalId = findFacultyByIdentity(db, { orcid, email, legacySlug });
  if (!canonicalId) {
    canonicalId = legacySlug || toSlug(displayName);
  }

  db.prepare(`
    INSERT INTO faculty (id, external_slug, display_name, fore_name, last_name, email, orcid, active, updated_at)
    VALUES (@id, @external_slug, @display_name, @fore_name, @last_name, @email, @orcid, 1, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      external_slug = COALESCE(NULLIF(faculty.external_slug, ''), excluded.external_slug),
      display_name = COALESCE(NULLIF(excluded.display_name, ''), faculty.display_name),
      fore_name = COALESCE(NULLIF(excluded.fore_name, ''), faculty.fore_name),
      last_name = COALESCE(NULLIF(excluded.last_name, ''), faculty.last_name),
      email = COALESCE(NULLIF(excluded.email, ''), faculty.email),
      orcid = COALESCE(NULLIF(excluded.orcid, ''), faculty.orcid),
      active = 1,
      updated_at = excluded.updated_at
  `).run({
    id: canonicalId,
    external_slug: legacySlug || canonicalId,
    display_name: displayName || canonicalId,
    fore_name: foreName,
    last_name: lastName,
    email,
    orcid
  });

  db.prepare(`
    INSERT OR IGNORE INTO faculty_aliases
      (faculty_id, alias_name, alias_email, alias_orcid, source)
    VALUES (?, ?, ?, ?, ?)
  `).run(canonicalId, displayName, email, orcid, source);

  const programs = Array.isArray(person.programs) ? person.programs : [];
  programs.forEach((program) => {
    const cleanProgram = String(program || '').trim();
    if (!cleanProgram) {
      return;
    }
    db.prepare(`
      INSERT OR IGNORE INTO faculty_programs (faculty_id, program, start_date, end_date)
      VALUES (?, ?, ?, '')
    `).run(canonicalId, cleanProgram, toIsoDate(person.startDate));
  });

  return canonicalId;
};

const remapPairTable = (db, tableName, legacyId, canonicalId, extraCols = []) => {
  const extra = extraCols.length ? `, ${extraCols.join(', ')}` : '';
  const insertCols = `faculty_id, pmid${extra}`;
  const selectCols = `?, pmid${extra}`;
  db.prepare(`
    INSERT OR IGNORE INTO ${tableName} (${insertCols})
    SELECT ${selectCols}
    FROM ${tableName}
    WHERE faculty_id = ?
  `).run(canonicalId, legacyId);
  db.prepare(`DELETE FROM ${tableName} WHERE faculty_id = ?`).run(legacyId);
};

export const remapFacultyIdReferences = (db, legacyId, canonicalId) => {
  const fromId = String(legacyId || '').trim();
  const toId = String(canonicalId || '').trim();
  if (!fromId || !toId || fromId === toId) {
    return;
  }

  const tx = db.transaction(() => {
    remapPairTable(db, 'faculty_publications', fromId, toId, [
      'first_seen_at',
      'last_seen_at',
      'source'
    ]);
    remapPairTable(db, 'faculty_publication_coauthors', fromId, toId, ['name']);

    db.prepare(`
      INSERT INTO curation (faculty_id, pmid, verdict, reason, updated_at)
      SELECT ?, pmid, verdict, reason, updated_at
      FROM curation
      WHERE faculty_id = ?
      ON CONFLICT(faculty_id, pmid)
      DO UPDATE SET
        verdict = excluded.verdict,
        reason = excluded.reason,
        updated_at = excluded.updated_at
    `).run(toId, fromId);
    db.prepare('DELETE FROM curation WHERE faculty_id = ?').run(fromId);

    db.prepare(`
      INSERT OR IGNORE INTO faculty_programs (faculty_id, program, start_date, end_date)
      SELECT ?, program, start_date, end_date
      FROM faculty_programs
      WHERE faculty_id = ?
    `).run(toId, fromId);
    db.prepare('DELETE FROM faculty_programs WHERE faculty_id = ?').run(fromId);
  });
  tx();
};

export const upsertGrant = (db, grant) => {
  db.prepare(`
    INSERT INTO grants (id, core_project_num, title, start_date, end_date, fiscal_year, url, updated_at)
    VALUES (@id, @core_project_num, @title, @start_date, @end_date, @fiscal_year, @url, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      core_project_num = COALESCE(NULLIF(excluded.core_project_num, ''), grants.core_project_num),
      title = COALESCE(NULLIF(excluded.title, ''), grants.title),
      start_date = COALESCE(NULLIF(excluded.start_date, ''), grants.start_date),
      end_date = COALESCE(NULLIF(excluded.end_date, ''), grants.end_date),
      fiscal_year = COALESCE(excluded.fiscal_year, grants.fiscal_year),
      url = COALESCE(NULLIF(excluded.url, ''), grants.url),
      updated_at = excluded.updated_at
  `).run({
    id: String(grant.id || '').trim(),
    core_project_num: String(grant.coreProjectNum || '').trim(),
    title: String(grant.title || '').trim(),
    start_date: toIsoDate(grant.startDate),
    end_date: toIsoDate(grant.endDate),
    fiscal_year: Number.isFinite(Number(grant.fiscalYear)) ? Number(grant.fiscalYear) : null,
    url: String(grant.url || '').trim()
  });
};

export const replaceFacultyGrants = (db, facultyId, grants, source = 'nih_reporter') => {
  const id = String(facultyId || '').trim();
  if (!id) {
    return;
  }
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM faculty_grants WHERE faculty_id = ?').run(id);
    grants.forEach((grant) => {
      const grantId = String(grant.id || '').trim();
      if (!grantId) {
        return;
      }
      upsertGrant(db, grant);
      db.prepare(`
        INSERT INTO faculty_grants (faculty_id, grant_id, role, amount, source, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(faculty_id, grant_id) DO UPDATE SET
          role = excluded.role,
          amount = excluded.amount,
          source = excluded.source,
          updated_at = excluded.updated_at
      `).run(
        id,
        grantId,
        String(grant.role || '').trim(),
        Number.isFinite(Number(grant.amount)) ? Number(grant.amount) : null,
        source
      );
    });
  });
  tx();
};
