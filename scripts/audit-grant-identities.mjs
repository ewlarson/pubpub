import { readFile, writeFile } from 'node:fs/promises';
import { auditGrantIdentities } from './grant-identity.mjs';

// Optional saved NIH response lets reviewers audit legacy JSON without changing it.
const [datasetPath = 'public/data/grants.json', reporterPath, outputPath = 'data/grant-identity-audit.json'] = process.argv.slice(2);
const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
if (reporterPath) {
  const projects = JSON.parse(await readFile(reporterPath, 'utf8'));
  if (!Array.isArray(projects)) throw new Error('Expected an array of NIH project records');
  const key = (id, year) => JSON.stringify([id, year]);
  const evidence = new Map();
  for (const project of projects) {
    const id = key(project.project_num, project.fiscal_year);
    evidence.set(id, [...(evidence.get(id) || []), ...(project.principal_investigators || [])]);
  }
  for (const person of dataset.faculty) {
    for (const grant of person.grants || []) {
      grant.investigators = evidence.get(key(grant.id, grant.fiscalYear)) || [];
    }
  }
}
const audit = auditGrantIdentities(dataset.faculty);
await writeFile(outputPath, `${JSON.stringify(audit, null, 2)}\n`);
console.log(JSON.stringify(audit.summary, null, 2));
console.log(`Audit only: no funding removed. Review evidence: ${outputPath}`);
