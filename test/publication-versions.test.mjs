import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';
import { getVersionMetadata, preferPublishedVersions } from '../scripts/publication-versions.mjs';
import { buildSignals, buildAuthorCounts } from '../scripts/scholar-publications.mjs';
const before = JSON.parse(await readFile(new URL('./fixtures/rawls-before.json', import.meta.url)));
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });
const articles = parser.parse(await readFile(new URL('./fixtures/rawls-publication-versions.xml', import.meta.url), 'utf8')).PubmedArticleSet.PubmedArticle;
const metadata = new Map(articles.map(({ MedlineCitation: c }) => [c.PMID['#text'], getVersionMetadata(c)]));
const candidates = before.publications.map((p) => ({ ...p, ...metadata.get(p.id) }));
const preprint = candidates.find((p) => p.id === '37502872');
const journal = candidates.find((p) => p.id === '39899115');

test('real PubMed version links retain the journal article once and preserve preprint provenance', () => {
  const snapshot = structuredClone(candidates);
  const result = preferPublishedVersions(candidates);
  assert.equal(result.length, 6);
  assert.ok(!result.some((p) => p.id === preprint.id));
  const retained = result.find((p) => p.id === journal.id);
  assert.equal(retained.year, 2025);
  assert.equal(retained.doi, '10.1037/abn0000925');
  assert.deepEqual(retained.preprintVersions, [preprint]);
  assert.deepEqual(retained.authorship, journal.authorship);
  assert.ok(result.some((p) => p.id === '37961578'), 'standalone preprint remains');
  assert.deepEqual(candidates, snapshot);
  assert.deepEqual(preferPublishedVersions(result), result, 'idempotent');
});

test('supports links in either direction and changed titles without title-based merging', () => {
  for (const [p, j] of [[preprint, { ...journal, versionLinks: [] }], [{ ...preprint, versionLinks: [] }, journal]]) {
    const result = preferPublishedVersions([p, { ...j, title: 'A revised title' }]);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, journal.id);
  }
  const unrelated = { ...journal, id: '999', versionLinks: [] };
  assert.equal(preferPublishedVersions([preprint, unrelated]).length, 2, 'same title without links is insufficient');
  assert.equal(preferPublishedVersions([journal, unrelated]).length, 2, 'two journal articles must remain');
});

test('retains preprints when published versions are absent, ineligible, ambiguous or lack type metadata', () => {
  assert.deepEqual(preferPublishedVersions([preprint]), [preprint]);
  assert.equal(preferPublishedVersions([preprint, { ...journal, publicationTypes: [] }]).length, 2);
  assert.equal(preferPublishedVersions([preprint, { ...journal, publicationTypes: ['Preprint', 'Journal Article'] }]).length, 2);
  assert.equal(preferPublishedVersions([preprint, journal, { ...journal, id: '999' }]).length, 3);
  assert.deepEqual(getVersionMetadata({}), { publicationTypes: [], versionLinks: [] });
  assert.deepEqual(getVersionMetadata({ CommentsCorrectionsList: { CommentsCorrections: { '@_RefType': 'ErratumIn', PMID: '123' } } }).versionLinks, []);
});

test('summary counts, years, journals and coauthors derive from the retained version only', () => {
  const result = preferPublishedVersions(candidates);
  assert.deepEqual(buildAuthorCounts(result), { first: 3, last: 1, total: 6, known: 6 });
  const signals = buildSignals(result, new Map([[preprint.id, ['Duplicate coauthor']], [journal.id, ['Retained coauthor']]]));
  assert.equal(signals.count, 6);
  assert.equal(signals.yearCounts.some((entry) => entry.year === 2023), false);
  assert.deepEqual(signals.topCoauthors, [{ name: 'Retained coauthor', count: 1 }]);
  assert.equal(signals.topJournals.find((entry) => entry.name.startsWith('bioRxiv')).count, 1);
});

test('checked-in scholar correction matches the version policy and consistent counts', async () => {
  const dataset = JSON.parse(await readFile(new URL('../public/data/scholars.json', import.meta.url)));
  const rawls = dataset.faculty.find((p) => p.id === before.id);
  assert.deepEqual(rawls.publications, preferPublishedVersions(candidates));
  assert.deepEqual(rawls.authorCounts, buildAuthorCounts(rawls.publications));
  assert.equal(rawls.signals.positive.count, 6);
});

test('real scholar refresh repeatedly outputs the journal version and consistent signals', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pubpub-versions-'));
  try {
    await mkdir(path.join(directory, 'data'));
    await mkdir(path.join(directory, 'public/data'), { recursive: true });
    await writeFile(path.join(directory, 'data/CTSI T Scholars - TRDP TL1 T32.csv'),
      'First Name,Last Name,Program,Project Title / Research Topic,Funding Start Date,Funding End Date,ORCID\n' +
      'Eric,Rawls,TL1,Neural correlates,2022-08-01,2023-07-31,0000-0002-4852-9961\n');
    const fixturePath = fileURLToPath(new URL('./fixtures/rawls-before.json', import.meta.url));
    const xmlPath = fileURLToPath(new URL('./fixtures/rawls-articles.xml', import.meta.url));
    const mock = path.join(directory, 'mock.mjs');
    await writeFile(mock, `
      import { readFile } from 'node:fs/promises';
      const { publications } = JSON.parse(await readFile(${JSON.stringify(fixturePath)}));
      globalThis.fetch = async (url) => {
        const name = new URL(url).pathname.split('/').at(-1);
        if (name === 'efetch.fcgi') return new Response(await readFile(${JSON.stringify(xmlPath)}, 'utf8'));
        if (name === 'esearch.fcgi') return Response.json({ esearchresult: { idlist: publications.map(p => p.id), count: String(publications.length) } });
        if (name === 'esummary.fcgi') return Response.json({ result: {
          uids: publications.map(p => p.id),
          ...Object.fromEntries(publications.map(p => [p.id, {
            uid: p.id, title: p.title, fulljournalname: p.journal, pubdate: String(p.year),
            articleids: [{ idtype: 'doi', value: p.doi }]
          }]))
        } });
        throw new Error('Unexpected request: ' + name);
      };
    `);
    for (let attempt = 0; attempt < 2; attempt++) {
      await promisify(execFile)(process.execPath, ['--import', mock, fileURLToPath(new URL('../scripts/build-scholars.mjs', import.meta.url))], { cwd: directory });
      const output = JSON.parse(await readFile(path.join(directory, 'public/data/scholars.json')));
      const rawls = output.faculty[0];
      assert.equal(rawls.publications.length, 6);
      assert.equal(rawls.signals.positive.count, 6);
      assert.equal(rawls.authorCounts.total, 6);
      assert.equal(rawls.publications.filter(p => p.id === journal.id).length, 1);
      assert.equal(rawls.publications.some(p => p.id === preprint.id), false);
      assert.ok(rawls.publications.some(p => p.id === '37961578'));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
