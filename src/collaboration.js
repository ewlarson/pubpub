export const getPublicationKey = (publication) => {
  if (!publication) {
    return '';
  }
  return publication.id || publication.doi || publication.title || '';
};

export const buildCollaborationGraph = (members) => {
  const publicationToAuthors = new Map();
  const nodeMap = new Map();

  members.forEach((member) => {
    nodeMap.set(member.id, {
      id: member.id,
      name: member.name,
      department: member.department,
      programs: member.programs || [],
      publicationCount: member.filteredPublications.length
    });

    member.filteredPublications.forEach((publication) => {
      const key = getPublicationKey(publication);
      if (!key) {
        return;
      }
      if (!publicationToAuthors.has(key)) {
        publicationToAuthors.set(key, {
          authors: new Set(),
          publication
        });
      }
      publicationToAuthors.get(key).authors.add(member.id);
    });
  });

  const edgeMap = new Map();
  let sharedPublicationCount = 0;

  publicationToAuthors.forEach(({ authors, publication }) => {
    if (authors.size < 2) {
      return;
    }
    sharedPublicationCount += 1;
    const list = Array.from(authors);
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const source = list[i] < list[j] ? list[i] : list[j];
        const target = list[i] < list[j] ? list[j] : list[i];
        const id = `${source}__${target}`;
        const edge = edgeMap.get(id) || {
          id,
          source,
          target,
          weight: 0,
          publications: []
        };
        edge.weight += 1;
        edge.publications.push(publication);
        edgeMap.set(id, edge);
      }
    }
  });

  return {
    nodes: Array.from(nodeMap.values()),
    edges: Array.from(edgeMap.values()),
    sharedPublicationCount
  };
};
