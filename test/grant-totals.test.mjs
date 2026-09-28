import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeGrantPortfolio } from '../src/grants.js';

// Four annual awards shared by Jason Baker and Chetan Shenoy in NIH RePORTER.
const sharedAwards = [
  { id: '1R01HL158756-01A1', fiscalYear: 2022, amount: 694590 },
  { id: '5R01HL158756-02', fiscalYear: 2023, amount: 685031 },
  { id: '5R01HL158756-03', fiscalYear: 2024, amount: 671068 },
  { id: '5R01HL158756-04', fiscalYear: 2025, amount: 662793 }
].map((grant) => ({ ...grant, coreProjectNum: 'R01HL158756' }));
const faculty = [
  { id: 'baker', filteredGrants: sharedAwards.map((g) => ({ ...g, role: 'PI' })) },
  { id: 'shenoy', filteredGrants: sharedAwards.map((g) => ({ ...g, role: 'Contact PI' })) }
];

test('shared annual awards count once in funding, projects, year charts, and type charts', () => {
  const before = structuredClone(faculty);
  assert.deepEqual(summarizeGrantPortfolio(faculty), {
    awardCount: 4,
    projectCount: 1,
    totalAmount: 2713482,
    hasAmounts: true,
    yearSeries: [
      { year: 2022, total: 694590, count: 1 },
      { year: 2023, total: 685031, count: 1 },
      { year: 2024, total: 671068, count: 1 },
      { year: 2025, total: 662793, count: 1 }
    ],
    typeCounts: [{ label: 'R01', value: 1 }]
  });
  assert.deepEqual(faculty, before, 'retain both faculty associations and their amounts');
});

test('filtering to either collaborator retains the full award, with no division by faculty count', () => {
  const combined = summarizeGrantPortfolio(faculty);
  assert.deepEqual(summarizeGrantPortfolio([faculty[0]]), combined);
  assert.deepEqual(summarizeGrantPortfolio([faculty[1]]), combined);
  assert.deepEqual(summarizeGrantPortfolio([...faculty].reverse()), combined);
  assert.equal(summarizeGrantPortfolio([{ grants: sharedAwards, filteredGrants: [] }]).awardCount, 0);
});

test('retains distinct fiscal years, supplements, and other projects', () => {
  const result = summarizeGrantPortfolio([{ grants: [
    { id: '5R01HL158756-04', fiscalYear: 2025, amount: 100 },
    { id: '5R01HL158756-04', fiscalYear: 2026, amount: 200 },
    { id: '3R01HL158756-04S1', fiscalYear: 2025, amount: 50 },
    { id: '1R21AA000001-01', fiscalYear: 2025, amount: 75 }
  ] }]);
  assert.equal(result.awardCount, 4);
  assert.equal(result.projectCount, 2);
  assert.equal(result.totalAmount, 425);
  assert.deepEqual(result.yearSeries, [
    { year: 2025, total: 225, count: 3 },
    { year: 2026, total: 200, count: 1 }
  ]);
  assert.deepEqual(result.typeCounts, [{ label: 'R01', value: 1 }, { label: 'R21', value: 1 }]);
});

test('keeps the existing combined K99/R00 project grouping without merging its awards', () => {
  const result = summarizeGrantPortfolio([{ grants: [
    { id: '1K99HL123456-01', fiscalYear: 2024, amount: 100 },
    { id: '4R00HL123456-03', fiscalYear: 2026, amount: 200 }
  ] }]);
  assert.equal(result.awardCount, 2);
  assert.equal(result.projectCount, 1);
  assert.equal(result.totalAmount, 300);
  assert.deepEqual(result.typeCounts, [{ label: 'K99/R00', value: 1 }]);
});

test('counts unknown and zero amounts correctly and uses known duplicate amounts only once', () => {
  const missing = { id: '1R01HL123456-01', fiscalYear: 2026, amount: null };
  const known = { ...missing, amount: 125 };
  const zero = { id: '1R21HL654321-01', fiscalYear: 2026, amount: 0 };
  const unknown = summarizeGrantPortfolio([{ grants: [missing] }]);
  assert.equal(unknown.hasAmounts, false);
  assert.equal(unknown.awardCount, 1);
  assert.equal(summarizeGrantPortfolio([{ grants: [zero] }]).hasAmounts, true);
  for (const grants of [[missing, known, zero], [known, missing, zero]]) {
    const result = summarizeGrantPortfolio([{ grants }]);
    assert.equal(result.totalAmount, 125);
    assert.equal(result.awardCount, 2);
    assert.deepEqual(result.yearSeries, [{ year: 2026, total: 125, count: 2 }]);
  }
});

test('handles missing IDs and years without merging unrelated anonymous awards', () => {
  const result = summarizeGrantPortfolio([{ grants: [
    { url: 'https://reporter.nih.gov/project-details/1', startDate: '2024-01-01', amount: 10 },
    { url: 'https://reporter.nih.gov/project-details/1', startDate: '2024-01-01', amount: 10 },
    { amount: 20, endDate: '2025-12-31' },
    { amount: 30 }
  ] }]);
  assert.equal(result.awardCount, 3);
  assert.equal(result.projectCount, 3);
  assert.equal(result.totalAmount, 60);
  assert.deepEqual(result.yearSeries, [
    { year: 2024, total: 10, count: 1 },
    { year: 2025, total: 20, count: 1 }
  ]);
});

test('empty filtered views have no funding, years, or grant types', () => {
  assert.deepEqual(summarizeGrantPortfolio([]), {
    awardCount: 0, projectCount: 0, totalAmount: 0, hasAmounts: false,
    yearSeries: [], typeCounts: []
  });
});
