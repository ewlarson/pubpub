import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  initDb,
  replaceAllFacultyProgramAssociations,
  upsertCanonicalFaculty
} from '../scripts/db.mjs';

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
