import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildScholarQuery,
  isPublicationOnOrAfter,
  normalizeOrcid,
  parseScholarsCsv
} from '../scripts/scholars.mjs';

test('normalizes ORCID values without accepting names or affiliations', () => {
  assert.equal(normalizeOrcid('https://orcid.org/0000-0003-4220-0919'), '0000-0003-4220-0919');
  assert.equal(normalizeOrcid('/0000-0003-4220-0919'), '0000-0003-4220-0919');
  assert.equal(normalizeOrcid('does not attach publications'), '');
  assert.equal(normalizeOrcid('University of Minnesota'), '');
  assert.equal(normalizeOrcid('0000-0002-1825-0098'), '');
});

test('parses only scholars with an ORCID and funding start date', () => {
  const source = [
    'First Name,Last Name,Program,Project Title / Research Topic,Funding Start Date,Funding End Date,ORCID',
    'Ada,Lovelace,TL1 Program,Computing,2022-08-01,2023-07-31,0000-0002-1825-0097',
    'Grace,Hopper,CTSI T32 Program,Compilers,7/1/2024,,',
    'Katherine,Johnson,Translational Research Development Program (TRDP),Orbits,2015-06-01,,0000-0001-5109-3700'
  ].join('\n');

  const { scholars, skipped } = parseScholarsCsv(source);

  assert.deepEqual(
    scholars.map(({ name, program, orcid }) => ({ name, program, orcid })),
    [
      { name: 'Ada Lovelace', program: 'TL1', orcid: '0000-0002-1825-0097' },
      { name: 'Katherine Johnson', program: 'TRDP', orcid: '0000-0001-5109-3700' }
    ]
  );
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].reason, 'missing or invalid ORCID');
});

test('builds an ORCID-only PubMed query bounded by funding start and refresh date', () => {
  const query = buildScholarQuery({
    orcid: '0000-0002-1825-0097',
    startDate: new Date(2022, 7, 1),
    endDate: new Date(2026, 6, 29)
  });

  assert.equal(
    query,
    '0000-0002-1825-0097[auid] AND ("2022/08/01"[pdat] : "2026/07/29"[pdat])'
  );
  assert.doesNotMatch(query, /Lovelace|University|affiliation/i);
});

test('excludes publications before the scholar funding start date', () => {
  const startDate = new Date(2022, 7, 1);

  assert.equal(
    isPublicationOnOrAfter({
      publicationDate: new Date(2022, 6, 31),
      publicationYear: 2022,
      startDate
    }),
    false
  );
  assert.equal(
    isPublicationOnOrAfter({
      publicationDate: new Date(2022, 7, 1),
      publicationYear: 2022,
      startDate
    }),
    true
  );
  assert.equal(
    isPublicationOnOrAfter({
      publicationDate: null,
      publicationYear: 2022,
      startDate
    }),
    false
  );
  assert.equal(
    isPublicationOnOrAfter({
      publicationDate: null,
      publicationYear: 2023,
      startDate
    }),
    true
  );
});
