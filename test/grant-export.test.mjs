import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeGrantAwards } from '../src/grant-export.js';

const awards = [
  {
    id: '5R42CA295106-02', amount: 925504, fiscalYear: 2025,
    startDate: '2024-09-20', endDate: '2027-08-31',
    title: 'ConnectedNest', role: 'Contact PI', url: 'https://reporter.nih.gov/project-details/11195638'
  },
  {
    id: '1R42CA295106-01', amount: 954983, fiscalYear: 2024,
    startDate: '2023-09-20', endDate: '2026-08-31',
    title: 'ConnectedNest', role: 'Contact PI', url: 'https://reporter.nih.gov/project-details/11003527'
  }
];

test('combines annual amounts and spans the earliest start to the latest end', () => {
  const original = structuredClone(awards);
  const summary = summarizeGrantAwards(awards);
  assert.equal(summary.amount, 1880487);
  assert.equal(summary.startDate, '2023-09-20');
  assert.equal(summary.endDate, '2027-08-31');
  assert.deepEqual(summary.fiscalYears, [2024, 2025]);
  assert.deepEqual(awards, original, 'export must not mutate dashboard data');
  const reversed = summarizeGrantAwards([...awards].reverse());
  assert.equal(reversed.amount, summary.amount);
  assert.equal(reversed.startDate, summary.startDate);
  assert.equal(reversed.endDate, summary.endDate);
});

test('retains distinct award metadata without repeating shared values', () => {
  const summary = summarizeGrantAwards([...awards, {
    id: '3R42CA295106-02S1', amount: 100, fiscalYear: 2025,
    title: 'Supplement, phase two', role: 'Co-PI', url: awards[0].url
  }]);
  assert.deepEqual(summary.ids, ['5R42CA295106-02', '1R42CA295106-01', '3R42CA295106-02S1']);
  assert.deepEqual(summary.roles, ['Contact PI', 'Co-PI']);
  assert.deepEqual(summary.titles, ['ConnectedNest', 'Supplement, phase two']);
  assert.deepEqual(summary.urls, awards.map((award) => award.url));
  assert.deepEqual(summary.fiscalYears, [2024, 2025]);
  assert.equal(summary.amount, 1880587, 'include multiple awards in the same fiscal year');
});

test('missing amounts stay unknown, while zero and valid amounts remain numeric', () => {
  assert.equal(summarizeGrantAwards([{}, { amount: null }, { amount: NaN }, { amount: Infinity }]).amount, null);
  assert.equal(summarizeGrantAwards([{ amount: 0 }]).amount, 0);
  assert.equal(summarizeGrantAwards([{ amount: null }, { amount: 12.5 }, { amount: -2.5 }]).amount, 10);
});

test('ignores missing dates and metadata without losing available values', () => {
  assert.deepEqual(summarizeGrantAwards([{}, {
    amount: 0, startDate: '2026-01-01', fiscalYear: 2026
  }]), {
    ids: [], roles: [], amount: 0, startDate: '2026-01-01', endDate: '',
    fiscalYears: [2026], titles: [], urls: []
  });
});

test('single-award grants retain their original amount and dates', () => {
  const summary = summarizeGrantAwards([awards[0]]);
  assert.equal(summary.amount, awards[0].amount);
  assert.equal(summary.startDate, awards[0].startDate);
  assert.equal(summary.endDate, awards[0].endDate);
  assert.deepEqual(summary.ids, [awards[0].id]);
});
