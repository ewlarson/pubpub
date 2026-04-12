import { initDb } from './db.mjs';

const db = initDb();

const totalFaculty = db.prepare('SELECT COUNT(*) AS count FROM faculty WHERE active = 1').get().count;
const facultyWithPublications = db
  .prepare('SELECT COUNT(DISTINCT faculty_id) AS count FROM faculty_publications')
  .get().count;
const facultyWithGrants = db
  .prepare('SELECT COUNT(DISTINCT faculty_id) AS count FROM faculty_grants')
  .get().count;

const duplicateEmailClusters = db
  .prepare(
    `
    SELECT lower(email) AS email_key, COUNT(*) AS count
    FROM faculty
    WHERE trim(coalesce(email, '')) != ''
    GROUP BY lower(email)
    HAVING COUNT(*) > 1
    ORDER BY count DESC, email_key ASC
  `
  )
  .all();

const duplicateOrcidClusters = db
  .prepare(
    `
    SELECT lower(orcid) AS orcid_key, COUNT(*) AS count
    FROM faculty
    WHERE trim(coalesce(orcid, '')) != ''
    GROUP BY lower(orcid)
    HAVING COUNT(*) > 1
    ORDER BY count DESC, orcid_key ASC
  `
  )
  .all();

const publicationOnly = db
  .prepare(
    `
    SELECT COUNT(*) AS count
    FROM faculty f
    WHERE EXISTS (
      SELECT 1 FROM faculty_publications fp WHERE fp.faculty_id = f.id
    )
      AND NOT EXISTS (
        SELECT 1 FROM faculty_grants fg WHERE fg.faculty_id = f.id
      )
  `
  )
  .get().count;

const grantOnly = db
  .prepare(
    `
    SELECT COUNT(*) AS count
    FROM faculty f
    WHERE EXISTS (
      SELECT 1 FROM faculty_grants fg WHERE fg.faculty_id = f.id
    )
      AND NOT EXISTS (
        SELECT 1 FROM faculty_publications fp WHERE fp.faculty_id = f.id
      )
  `
  )
  .get().count;

console.log(`Canonical faculty (active): ${totalFaculty}`);
console.log(`Faculty with publications: ${facultyWithPublications}`);
console.log(`Faculty with grants: ${facultyWithGrants}`);
console.log(`Publication-only faculty: ${publicationOnly}`);
console.log(`Grant-only faculty: ${grantOnly}`);
console.log(`Duplicate email clusters: ${duplicateEmailClusters.length}`);
console.log(`Duplicate ORCID clusters: ${duplicateOrcidClusters.length}`);

if (duplicateEmailClusters.length) {
  console.log('\nDuplicate email clusters:');
  duplicateEmailClusters.forEach((row) => {
    console.log(`- ${row.email_key}: ${row.count}`);
  });
}

if (duplicateOrcidClusters.length) {
  console.log('\nDuplicate ORCID clusters:');
  duplicateOrcidClusters.forEach((row) => {
    console.log(`- ${row.orcid_key}: ${row.count}`);
  });
}

db.close();
