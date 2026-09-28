const toArray = (value) => value == null ? [] : Array.isArray(value) ? value : [value];
const text = (value) => String(typeof value === 'object' ? value?.['#text'] || '' : value || '');

// PubMed supplies these links independently of title spelling or publication year.
export const getVersionMetadata = (citation) => ({
  publicationTypes: toArray(citation?.Article?.PublicationTypeList?.PublicationType).map(text),
  versionLinks: toArray(citation?.CommentsCorrectionsList?.CommentsCorrections)
    .filter((entry) => ['UpdateIn', 'UpdateOf'].includes(entry?.['@_RefType']))
    .map((entry) => ({ type: entry['@_RefType'], id: text(entry.PMID) }))
    .filter((entry) => /^\d+$/.test(entry.id))
});

const isPreprint = (publication) => publication.publicationTypes?.includes('Preprint');
const isJournalArticle = (publication) => !isPreprint(publication) &&
  publication.publicationTypes?.includes('Journal Article');

export const preferPublishedVersions = (publications) => {
  const published = publications.filter(isJournalArticle);
  const replacements = new Map();
  for (const preprint of publications.filter(isPreprint)) {
    const matches = published.filter((article) =>
      preprint.versionLinks?.some((link) => link.type === 'UpdateIn' && link.id === String(article.id)) ||
      article.versionLinks?.some((link) => link.type === 'UpdateOf' && link.id === String(preprint.id))
    );
    // Ambiguous links and absent/ineligible journal records retain the preprint.
    if (matches.length === 1) replacements.set(String(preprint.id), String(matches[0].id));
  }
  return publications.filter((publication) => !replacements.has(String(publication.id)))
    .map((publication) => {
      const versions = publications.filter((candidate) => replacements.get(String(candidate.id)) === String(publication.id));
      if (!versions.length) return publication;
      const combined = [...(publication.preprintVersions || []), ...versions];
      return {
        ...publication,
        preprintVersions: [...new Map(combined.map((version) => [String(version.id), version])).values()]
      };
    });
};
