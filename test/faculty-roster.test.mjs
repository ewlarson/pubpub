import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, copyFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { initDb } from '../scripts/db.mjs';

const additions = [
  ['Daphne Moutsoglou', '0000-0002-4071-3756', 'dmmoutso@umn.edu', 'KAP'],
  ['Corri Stuyvenberg', '0000-0003-4127-4684', 'stuyv006@umn.edu', 'KAP'],
  ['Evan Chen', '0000-0002-2193-2953', 'evanchen@umn.edu', 'KAP'],
  ['Lindsey Sloan', '0000-0002-1904-8376', 'sloan153@umn.edu', 'K12']
];

test('September faculty identities survive repeated roster ingestion and both dashboard exports', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pubpub-roster-'));
  const databasePath = path.join(directory, 'data/pubpub.sqlite');
  try {
    await mkdir(path.join(directory, 'data'));
    await mkdir(path.join(directory, 'public/data'), { recursive: true });
    for (const filename of ['CTSI Faculty - Sheet1.csv', 'faculty-identity-overrides.json']) {
      await copyFile(new URL(`../data/${filename}`, import.meta.url), path.join(directory, 'data', filename));
    }
    const run = script => promisify(execFile)(process.execPath, [fileURLToPath(new URL(`../scripts/${script}`, import.meta.url))], {
      cwd: directory, env: { ...process.env, PUBPUB_DB_PATH: databasePath }
    });
    await run('ingest-faculty.mjs');
    await run('ingest-faculty.mjs');
    const db = initDb(databasePath);
    try {
      for (const [name, orcid, email, program] of additions) {
        const rows = db.prepare('SELECT * FROM faculty WHERE orcid = ?').all(orcid);
        assert.equal(rows.length, 1, `${name} has one canonical identity`);
        assert.equal(rows[0].display_name, name);
        assert.equal(rows[0].email, email);
        assert.deepEqual(db.prepare('SELECT term FROM faculty_signature_terms WHERE faculty_id = ? ORDER BY term').all(rows[0].id).map(row => row.term), ['University of Minnesota', email].sort());
        assert.deepEqual(db.prepare('SELECT program, start_date FROM faculty_programs WHERE faculty_id = ?').all(rows[0].id),
          [{ program, start_date: '2026-09-01' }]);
      }
    } finally { db.close(); }
    await run('export-static-data.mjs');
    for (const file of ['publications.json', 'grants.json']) {
      const output = JSON.parse(await readFile(path.join(directory, 'public/data', file)));
      for (const [name, orcid, , program] of additions) {
        const matches = output.faculty.filter(person => person.name === name);
        assert.equal(matches.length, 1);
        assert.deepEqual(matches[0].programAssociations, [{ program, startDate: '2026-09-01' }]);
        assert.deepEqual(matches[0].programs, [program]);
        if (file === 'publications.json') assert.equal(matches[0].orcid, orcid);
      }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
