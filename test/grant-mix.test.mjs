import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildGrantMixSegments, getGrantMixFilterTypes, getGrantMixType, summarizeGrantPortfolio } from '../src/grants.js';

const labels = ['R01', 'R21', 'R03', 'K01', 'K08', 'K23', 'K99', 'Other'];

test('grant mix keeps all requested categories in order, including zero counts, with stable distinct colors', () => {
  const result = buildGrantMixSegments([{ label: 'K08', value: 1 }, { label: 'R01', value: 30 }]);
  assert.deepEqual(result.map(s => s.label), labels);
  assert.deepEqual(result.map(s => s.value), [30, 0, 0, 0, 1, 0, 0, 0]);
  assert.equal(new Set(result.map(s => s.color)).size, 8);
  assert.deepEqual(buildGrantMixSegments([{ label: 'R21', value: 1 }]).map(s => s.color), result.map(s => s.color));
  assert.deepEqual(buildGrantMixSegments([]), []);
});

test('Other combines unlisted and unknown types; K99 includes combined transition projects', () => {
  const input = [{ label: 'K99/R00', value: 2 }, { label: 'K99', value: 1 }, { label: 'U01', value: 4 }, { label: 'R34', value: 2 }, { label: 'Other', value: 1 }];
  const result = buildGrantMixSegments(input);
  assert.equal(result.find(s => s.label === 'K99').value, 3);
  assert.equal(result.find(s => s.label === 'Other').value, 7);
  assert.equal(getGrantMixType('K99/R00'), 'K99');
  for (const type of ['U01', 'R34', '', undefined]) assert.equal(getGrantMixType(type), 'Other');
  assert.equal(result.reduce((n, s) => n + s.value, 0), 10);
});

test('real portfolio categories conserve unique project totals, including shared awards and filtered faculty', async () => {
  const { faculty } = JSON.parse(await readFile(new URL('../public/data/grants.json', import.meta.url)));
  for (const members of [faculty, ...faculty.map(member => [member])]) {
    const portfolio = summarizeGrantPortfolio(members);
    const segments = buildGrantMixSegments(portfolio.typeCounts);
    assert.equal(segments.reduce((n, s) => n + s.value, 0), portfolio.projectCount);
    for (const segment of segments) {
      assert.equal(segment.value, portfolio.typeCounts.filter(s => getGrantMixType(s.label) === segment.label).reduce((n, s) => n + s.value, 0));
    }
  }
});

test('chart selection expands Other and K99 to the original table filter types', () => {
  const types = ['R01', 'K99/R00', 'U01', 'R34', 'Other', 'U01'];
  assert.deepEqual(getGrantMixFilterTypes(types, 'Other'), ['U01', 'R34', 'Other']);
  assert.deepEqual(getGrantMixFilterTypes(types, 'K99'), ['K99/R00']);
  assert.deepEqual(getGrantMixFilterTypes(types, 'R01'), ['R01']);
});
