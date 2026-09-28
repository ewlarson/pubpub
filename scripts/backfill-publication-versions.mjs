import { XMLParser } from 'fast-xml-parser';
import { getVersionMetadata } from './publication-versions.mjs';

// One-time enrichment of legacy cached publications. Export remains offline.
export const backfillPublicationVersions = async (db, fetchXml) => {
  const pending = db.prepare("SELECT pmid FROM publications WHERE version_metadata = '{}'").all();
  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });
  const update = db.prepare('UPDATE publications SET version_metadata = ? WHERE pmid = ?');
  for (let offset = 0; offset < pending.length; offset += 100) {
    const ids = pending.slice(offset, offset + 100).map((row) => row.pmid);
    const requested = new Set(ids);
    const document = parser.parse(await fetchXml(ids));
    const value = document?.PubmedArticleSet?.PubmedArticle;
    const articles = value ? [value].flat() : [];
    db.transaction(() => {
      for (const article of articles) {
        const citation = article.MedlineCitation;
        const pmid = String(citation?.PMID?.['#text'] || citation?.PMID || '');
        if (requested.has(pmid)) update.run(JSON.stringify(getVersionMetadata(citation)), pmid);
      }
    })();
  }
};
