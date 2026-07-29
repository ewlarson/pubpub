import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCollaborationGraph } from '../src/collaboration.js';

const publication = (id, title) => ({
  id,
  title,
  journal: 'Test Journal',
  year: 2026,
  url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`
});

test('collaboration edges retain the publications shared by each faculty pair', () => {
  const firstPublication = publication('1', 'Shared by all three faculty');
  const secondPublication = publication('2', 'Shared by two faculty');
  const graph = buildCollaborationGraph([
    {
      id: 'faculty-a',
      name: 'Faculty A',
      department: 'CTSI',
      filteredPublications: [firstPublication, secondPublication]
    },
    {
      id: 'faculty-b',
      name: 'Faculty B',
      department: 'CTSI',
      filteredPublications: [firstPublication, secondPublication]
    },
    {
      id: 'faculty-c',
      name: 'Faculty C',
      department: 'CTSI',
      filteredPublications: [firstPublication]
    }
  ]);

  assert.equal(graph.sharedPublicationCount, 2);
  assert.equal(graph.edges.length, 3);

  const firstPair = graph.edges.find(
    (edge) => edge.id === 'faculty-a__faculty-b'
  );
  assert.deepEqual(
    firstPair.publications.map((entry) => entry.id),
    ['1', '2']
  );
  assert.equal(firstPair.weight, firstPair.publications.length);

  const otherPairs = graph.edges.filter((edge) => edge.id !== firstPair.id);
  assert.deepEqual(
    otherPairs.map((edge) => ({
      id: edge.id,
      publicationIds: edge.publications.map((entry) => entry.id),
      weight: edge.weight
    })),
    [
      {
        id: 'faculty-a__faculty-c',
        publicationIds: ['1'],
        weight: 1
      },
      {
        id: 'faculty-b__faculty-c',
        publicationIds: ['1'],
        weight: 1
      }
    ]
  );
});
