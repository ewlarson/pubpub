import assert from 'node:assert/strict';
import test from 'node:test';
import { auditGrantIdentities, validateGrantIdentity } from '../scripts/grant-identity.mjs';

const person = { id: 'mark', name: 'Mark Osborn', foreName: 'Mark', lastName: 'Osborn' };
const pi = { profile_id: 1, first_name: 'Mark', middle_name: 'A', last_name: 'Osborn', is_contact_pi: true };

test('first and last names must belong to the same investigator', () => {
  const result = validateGrantIdentity(person, [
    { first_name: 'Mark', last_name: 'Thomas' },
    { first_name: 'John', last_name: 'Osborn' }
  ]);
  assert.equal(result.status, 'needs-review');
  assert.equal(result.reason, 'no-matching-investigator');
  assert.equal(result.role, 'Not listed');
});

test('structured names tolerate middle names, case and punctuation without substring matching', () => {
  assert.equal(validateGrantIdentity(person, [pi]).role, 'Contact PI');
  assert.equal(validateGrantIdentity(person, [{ ...pi, first_name: 'MARK', is_contact_pi: false }]).role, 'PI');
  assert.equal(validateGrantIdentity(person, [{ ...pi, first_name: 'Marcus' }]).status, 'needs-review');
  assert.equal(validateGrantIdentity({ foreName: 'José', lastName: "O'Neil" },
    [{ first_name: 'Jose', last_name: 'O-Neil' }]).status, 'name-match');
  assert.equal(validateGrantIdentity({ foreName: 'M', lastName: 'Osborn' }, [pi]).status, 'needs-review');
});

test('missing data and distinct same-name investigator profiles need review', () => {
  for (const pis of [null, [], [null], [{ full_name: 'Mark Osborn' }]]) {
    assert.equal(validateGrantIdentity(person, pis).status, 'needs-review');
  }
  assert.equal(validateGrantIdentity(person, [pi, { ...pi, profile_id: 2 }]).reason, 'ambiguous-investigators');
  assert.equal(validateGrantIdentity(person, [pi, { ...pi }]).status, 'name-match');
});

test('reviewed profile IDs take precedence and never fall back to a conflicting name', () => {
  const registry = { mark: { profileIds: [1], evidence: 'Reviewed source' } };
  assert.equal(validateGrantIdentity(person, [{ ...pi, first_name: 'M' }], registry).status, 'verified-id');
  assert.equal(validateGrantIdentity(person, [{ ...pi, profile_id: 2 }], registry).reason, 'profile-id-mismatch');
  assert.equal(validateGrantIdentity(person, [pi, { ...pi, profile_id: 2 }], registry).profileId, 1);
});

test('aliases are explicit and scoped to one faculty member', () => {
  const alias = { foreName: 'Dang Hai', lastName: 'Nguyen' };
  const registry = { nguyen: { aliases: [alias] } };
  const person = { id: 'nguyen', foreName: 'Hai Dang', lastName: 'Nguyen' };
  const pis = [{ first_name: 'Dang Hai', last_name: 'Nguyen' }];
  assert.equal(validateGrantIdentity(person, pis, registry).status, 'name-match');
  assert.equal(validateGrantIdentity({ ...person, id: 'another' }, pis, registry).status, 'needs-review');
});

test('audit retains evidence, deduplicates review dollars and does not modify shared associations', () => {
  const grants = [{ id: 'award', fiscalYear: 2025, amount: 100, investigators: [pi] },
    { id: 'unknown', fiscalYear: 2026, amount: null }];
  const faculty = [{ ...person, grants }, { id: 'other', foreName: 'Other', lastName: 'Person', grants }];
  const before = structuredClone(faculty);
  const audit = auditGrantIdentities(faculty);
  assert.deepEqual(audit.summary, {
    associations: 4, verifiedIds: 0, nameMatches: 1, needsReview: 3,
    uniqueAwardsNeedingReview: 2, knownFundingNeedingReview: 100, unknownAmountsNeedingReview: 1
  });
  assert.deepEqual(faculty, before);
  assert.deepEqual(audit.associations[0].investigators, [pi]);
});

test('standalone audit uses exact project/year evidence and leaves the dataset unchanged', async () => {
  const { mkdtemp, readFile, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const directory = await mkdtemp(join(tmpdir(), 'identity-audit-'));
  try {
    const dataset = JSON.stringify({ faculty: [{ ...person, grants: [
      { id: 'award', fiscalYear: 2025, amount: 100 },
      { id: 'award', fiscalYear: 2026, amount: 200 }
    ] }] });
    const input = join(directory, 'grants.json');
    const evidence = join(directory, 'nih.json');
    const output = join(directory, 'audit.json');
    await writeFile(input, dataset);
    await writeFile(evidence, JSON.stringify([{ project_num: 'award', fiscal_year: 2025, principal_investigators: [pi] }]));
    await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../scripts/audit-grant-identities.mjs', import.meta.url)), input, evidence, output]);
    const report = JSON.parse(await readFile(output));
    assert.equal(report.summary.nameMatches, 1);
    assert.equal(report.summary.needsReview, 1);
    assert.equal(report.summary.knownFundingNeedingReview, 200);
    assert.equal(await readFile(input, 'utf8'), dataset);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
