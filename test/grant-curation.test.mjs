import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { filterCuratedGrants } from '../scripts/grant-curation.mjs';
import { initDb, replaceFacultyGrants, upsertCanonicalFaculty } from '../scripts/db.mjs';

const execFileAsync = promisify(execFile);
const markId = 'mark-osborn-osbor026-umn-edu';
const johnId = 'john-osborn';
const fixture = JSON.parse(await readFile(new URL('./fixtures/osborn-reporter.json', import.meta.url)));
const incorrectAwards = fixture.map((project) => ({
  id: project.project_num,
  coreProjectNum: project.core_project_num,
  title: project.project_title,
  fiscalYear: project.fiscal_year,
  amount: 100,
  startDate: '2017-09-20',
  endDate: '2020-08-31'
}));
const unrelatedAward = { id: '1U01DK999999-01', coreProjectNum: 'U01DK999999', amount: 250 };

const withWorkspace = async (run) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pubpub-grant-curation-'));
  await mkdir(path.join(directory, 'data'));
  await mkdir(path.join(directory, 'public/data'), { recursive: true });
  try {
    await run(directory, path.join(directory, 'data/test.sqlite'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

const runScript = (name, cwd, databasePath, extraEnv = {}) => execFileAsync(
  process.execPath,
  [fileURLToPath(new URL(`../scripts/${name}`, import.meta.url))],
  { cwd, env: { ...process.env, PUBPUB_DB_PATH: databasePath, ...extraEnv } }
);
const readGrants = async (directory) => JSON.parse(
  await readFile(path.join(directory, 'public/data/grants.json'), 'utf8')
);

test('excludes all known renal-nerve awards and future renewals or supplements for Mark', () => {
  const awards = [...incorrectAwards,
    { id: '5U01DK116320-04S1' },
    { id: '2U01DK116320-05A1' },
    { id: 'future-award', coreProjectNum: ' u01dk116320 ' }
  ];
  assert.deepEqual(filterCuratedGrants(markId, awards), []);
});

test('correction preserves other U01 grants and the same project for other faculty', () => {
  const similarNumber = { id: '1U01DK1163200-01' };
  const awards = [...incorrectAwards, unrelatedAward, similarNumber];
  const before = structuredClone(awards);
  assert.deepEqual(filterCuratedGrants(markId, awards), [unrelatedAward, similarNumber]);
  assert.deepEqual(filterCuratedGrants(johnId, awards), awards);
  assert.deepEqual(awards, before, 'filter must not mutate source records');
});

test('checked-in dashboard data retains Mark but excludes his incorrect grant', async () => {
  const data = JSON.parse(await readFile(new URL('../public/data/grants.json', import.meta.url)));
  const mark = data.faculty.find((member) => member.id === markId);
  assert.ok(mark, 'Mark must remain in the faculty dataset');
  assert.deepEqual(mark.grants, filterCuratedGrants(markId, mark.grants));
});

test('grant refresh rejects the API false positive before both SQLite and JSON persistence', async () => {
  await withWorkspace(async (directory, databasePath) => {
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ results: [...fixture, {
        project_num: unrelatedAward.id,
        core_project_num: unrelatedAward.coreProjectNum,
        project_title: 'Unrelated U01 retained',
        award_amount: 250,
        fiscal_year: 2026,
        project_start_date: '2026-01-01',
        principal_investigators: [{ profile_id: 42, first_name: 'Mark', middle_name: 'A', last_name: 'Osborn', is_contact_pi: true }]
      }] }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      await writeFile(path.join(directory, 'data/CTSI Faculty - Sheet1.csv'),
        'person_id,fore_name,last_name,email,program,start date\n' +
        `${markId},Mark,Osborn,osbor026@umn.edu,KL2,9/1/2014\n`);
      // Repeating the refresh verifies the exclusion is durable, not a one-time edit.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await runScript('build-grants.mjs', directory, databasePath, {
          REPORTER_API_URL: `http://127.0.0.1:${server.address().port}`,
          REPORTER_DELAY_MS: '0', REPORTER_PAGE_LIMIT: '500',
          REPORTER_ORG_NAMES: 'University of Minnesota'
        });
        const data = await readGrants(directory);
        assert.equal(data.faculty[0].grants[0].role, 'Contact PI');
        assert.equal(data.faculty[0].grants[0].investigators[0].profile_id, 42);
        const audit = JSON.parse(await readFile(path.join(directory, 'data/grant-identity-audit.json')));
        assert.equal(audit.summary.nameMatches, 1);
        assert.equal(audit.summary.needsReview, 0);
        assert.deepEqual(data.faculty[0].grants.map((grant) => grant.id), [unrelatedAward.id]);
        const db = initDb(databasePath);
        try {
          assert.deepEqual(db.prepare('SELECT grant_id FROM faculty_grants WHERE faculty_id = ?')
            .all(markId), [{ grant_id: unrelatedAward.id }]);
        } finally {
          db.close();
        }
        await runScript('export-static-data.mjs', directory, databasePath);
        const exportedAudit = JSON.parse(await readFile(path.join(directory, 'data/grant-identity-audit.json')));
        assert.deepEqual(exportedAudit, audit, 'cached export preserves and revalidates investigator evidence');
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

test('standalone export excludes stale cached associations without suppressing John or other grants', async () => {
  await withWorkspace(async (directory, databasePath) => {
    const db = initDb(databasePath);
    try {
      for (const person of [{ id: markId, name: 'Mark Osborn' }, { id: johnId, name: 'John Osborn' }]) {
        upsertCanonicalFaculty(db, person);
        replaceFacultyGrants(db, person.id, [...incorrectAwards, unrelatedAward]);
      }
    } finally {
      db.close();
    }
    await runScript('export-static-data.mjs', directory, databasePath);
    const data = await readGrants(directory);
    assert.deepEqual(data.faculty.find((m) => m.id === markId).grants.map((g) => g.id), [unrelatedAward.id]);
    assert.equal(data.faculty.find((m) => m.id === johnId).grants.length, 4);
    const audit = JSON.parse(await readFile(path.join(directory, 'data/grant-identity-audit.json')));
    assert.equal(audit.summary.needsReview, 5, 'legacy cached grants without evidence need review, not deletion');
  });
});
