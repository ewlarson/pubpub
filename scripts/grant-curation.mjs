import { readFileSync } from 'node:fs';

const exclusions = JSON.parse(
  readFileSync(new URL('../data/grant-exclusions.json', import.meta.url), 'utf8')
);

const coreProjectNumber = (value) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/^\d+/, '')
  .split('-')[0];

// Scope corrections to a faculty/project pair and cover every annual award,
// renewal, and supplement, including exports from a previously cached database.
export const filterCuratedGrants = (facultyId, grants) => {
  const excludedProjects = new Set(exclusions
    .filter((entry) => entry.facultyId === facultyId)
    .map((entry) => coreProjectNumber(entry.coreProjectNum)));
  return grants.filter((grant) => !excludedProjects.has(
    coreProjectNumber(grant.coreProjectNum || grant.id)
  ));
};
