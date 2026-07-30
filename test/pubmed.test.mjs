import assert from 'node:assert/strict';
import test from 'node:test';
import { isPlaceholderNcbiEmail } from '../scripts/pubmed.mjs';

test('detects placeholder NCBI emails by their exact domain', () => {
  assert.equal(isPlaceholderNcbiEmail('researcher@example.com'), true);
  assert.equal(isPlaceholderNcbiEmail(' RESEARCHER@EXAMPLE.COM '), true);
  assert.equal(isPlaceholderNcbiEmail(''), true);
  assert.equal(isPlaceholderNcbiEmail('not-an-email'), true);

  assert.equal(isPlaceholderNcbiEmail('researcher@umn.edu'), false);
  assert.equal(isPlaceholderNcbiEmail('researcher@example.com.evil.test'), false);
  assert.equal(isPlaceholderNcbiEmail('example.com@umn.edu'), false);
});
