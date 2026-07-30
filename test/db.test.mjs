import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  getStoredAuthorship,
  initDb,
  replaceAllFacultyProgramAssociations,
  updateFacultyPublicationAuthorship,
  upsertFacultyPublication,
  upsertCanonicalFaculty
} from '../scripts/db.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const withDatabase = async (run) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pubpub-db-test-'));
  const db = initDb(path.join(directory, 'test.sqlite'));
  try {
    await run(db);
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
};

const getProgramAssociations = (db) =>
  db
    .prepare(
      'SELECT faculty_id AS facultyId, program, start_date AS startDate FROM faculty_programs ORDER BY faculty_id, program, start_date'
    )
    .all();

test('upsertCanonicalFaculty preserves each program association start date', async () => {
  await withDatabase((db) => {
    upsertCanonicalFaculty(db, {
      id: 'allyson-hart',
      name: 'Allyson Hart',
      programs: ['K-R01', 'KL2 Career Development Program'],
      startDate: new Date(2015, 9, 1)
    });

    upsertCanonicalFaculty(db, {
      id: 'allyson-hart',
      name: 'Allyson Hart',
      programs: ['K-R01', 'KL2 Career Development Program'],
      startDate: new Date(2015, 9, 1),
      programAssociations: [
        { program: 'K-R01', startDate: new Date(2018, 10, 1) },
        {
          program: 'KL2 Career Development Program',
          startDate: new Date(2015, 9, 1)
        }
      ]
    });

    assert.deepEqual(getProgramAssociations(db), [
      {
        facultyId: 'allyson-hart',
        program: 'K-R01',
        startDate: '2018-11-01'
      },
      {
        facultyId: 'allyson-hart',
        program: 'KL2 Career Development Program',
        startDate: '2015-10-01'
      }
    ]);
  });
});

test('authoritative program association replacement removes stale cross-products', async () => {
  await withDatabase((db) => {
    upsertCanonicalFaculty(db, {
      id: 'allyson-hart',
      name: 'Allyson Hart',
      programs: ['K-R01', 'KL2 Career Development Program'],
      startDate: new Date(2015, 9, 1)
    });

    replaceAllFacultyProgramAssociations(db, [
      {
        facultyId: 'allyson-hart',
        program: 'K-R01',
        startDate: new Date(2018, 10, 1)
      },
      {
        facultyId: 'allyson-hart',
        program: 'KL2 Career Development Program',
        startDate: new Date(2015, 9, 1)
      }
    ]);

    assert.deepEqual(getProgramAssociations(db), [
      {
        facultyId: 'allyson-hart',
        program: 'K-R01',
        startDate: '2018-11-01'
      },
      {
        facultyId: 'allyson-hart',
        program: 'KL2 Career Development Program',
        startDate: '2015-10-01'
      }
    ]);
  });
});

test('publication authorship survives relational persistence and can be exported', async () => {
  await withDatabase((db) => {
    upsertCanonicalFaculty(db, {
      id: 'test-scholar',
      name: 'Test Scholar'
    });
    db.prepare(`
      INSERT INTO publications (pmid, title, year, updated_at)
      VALUES ('12345', 'A publication', 2026, datetime('now'))
    `).run();

    upsertFacultyPublication(db, 'test-scholar', '12345', {
      position: 0,
      total: 4,
      isFirst: true,
      isLast: false
    });

    const row = db
      .prepare(`
        SELECT
          author_position AS authorPosition,
          author_count AS authorCount
        FROM faculty_publications
        WHERE faculty_id = 'test-scholar' AND pmid = '12345'
      `)
      .get();

    assert.deepEqual(row, { authorPosition: 0, authorCount: 4 });
    assert.deepEqual(getStoredAuthorship(row), {
      position: 0,
      total: 4,
      isFirst: true,
      isLast: false
    });

    assert.equal(
      updateFacultyPublicationAuthorship(db, 'test-scholar', '12345', {
        position: 3,
        total: 4
      }),
      1
    );
    const updated = db
      .prepare(`
        SELECT
          author_position AS authorPosition,
          author_count AS authorCount
        FROM faculty_publications
        WHERE faculty_id = 'test-scholar' AND pmid = '12345'
      `)
      .get();
    assert.deepEqual(getStoredAuthorship(updated), {
      position: 3,
      total: 4,
      isFirst: false,
      isLast: true
    });
    assert.equal(
      updateFacultyPublicationAuthorship(db, 'test-scholar', 'missing', {
        position: 0,
        total: 1
      }),
      0
    );
  });
});

test('initDb migrates legacy publication relationships for authorship storage', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pubpub-db-migration-test-'));
  const databasePath = path.join(directory, 'legacy.sqlite');
  const legacyDb = new Database(databasePath);
  legacyDb.exec(`
    CREATE TABLE faculty_publications (
      faculty_id TEXT NOT NULL,
      pmid TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'pubmed',
      PRIMARY KEY (faculty_id, pmid)
    );
    PRAGMA user_version = 1;
  `);
  legacyDb.close();

  const migratedDb = initDb(databasePath);
  try {
    const columnNames = migratedDb
      .pragma('table_info(faculty_publications)')
      .map((column) => column.name);
    assert.ok(columnNames.includes('author_position'));
    assert.ok(columnNames.includes('author_count'));
    assert.equal(migratedDb.pragma('user_version', { simple: true }), 2);
  } finally {
    migratedDb.close();
    await rm(directory, { recursive: true, force: true });
  }
});
