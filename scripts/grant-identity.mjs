import { readFileSync } from 'node:fs';

const registry = JSON.parse(readFileSync(new URL('../data/grant-identities.json', import.meta.url), 'utf8'));
const normalize = (value) => String(value || '').normalize('NFKD')
  .replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const sameName = (name, pi) => {
  const first = normalize(name.foreName);
  const last = normalize(name.lastName);
  return first && last && first === normalize(pi.first_name) && last === normalize(pi.last_name);
};

// Search hits are candidates. A name match is evidence, not proof against homonyms.
export const validateGrantIdentity = (person, investigators, identities = registry) => {
  const pis = Array.isArray(investigators) ? investigators.filter((pi) => pi && typeof pi === 'object') : [];
  const identity = identities[person.id];
  const ids = (identity?.profileIds || []).map(String);
  const byId = pis.filter((pi) => ids.includes(String(pi.profile_id)));
  const byName = pis.filter((pi) => sameName(person, pi) ||
    (identity?.aliases || []).some((alias) => sameName(alias, pi)));
  const candidates = ids.length ? byId : byName;
  // Repeated copies of one profile are harmless; distinct same-name profiles are ambiguous.
  const unique = [...new Map(candidates.map((pi) => [
    pi.profile_id ? String(pi.profile_id) : JSON.stringify(pi), pi
  ])).values()];
  if (unique.length === 1) {
    return {
      status: ids.length ? 'verified-id' : 'name-match',
      reason: ids.length ? 'reviewed-profile-id' : 'structured-name-or-reviewed-alias',
      profileId: unique[0].profile_id ?? null,
      role: unique[0].is_contact_pi ? 'Contact PI' : 'PI'
    };
  }
  return {
    status: 'needs-review',
    reason: !pis.length ? 'missing-investigators' : unique.length > 1 ? 'ambiguous-investigators' :
      ids.length ? 'profile-id-mismatch' : 'no-matching-investigator',
    profileId: null,
    role: 'Not listed'
  };
};

export const auditGrantIdentities = (faculty, identities = registry) => {
  const associations = faculty.flatMap((person) => (person.grants || []).map((grant) => ({
    facultyId: person.id,
    facultyName: person.name,
    grantId: grant.id,
    fiscalYear: grant.fiscalYear ?? null,
    amount: Number.isFinite(grant.amount) ? grant.amount : null,
    url: grant.url || '',
    ...validateGrantIdentity(person, grant.investigators, identities),
    investigators: grant.investigators || []
  })));
  const review = associations.filter((entry) => entry.status === 'needs-review');
  const awards = new Map(review.map((entry) => [JSON.stringify([entry.grantId, entry.fiscalYear]), entry]));
  return {
    mode: 'audit-only',
    summary: {
      associations: associations.length,
      verifiedIds: associations.filter((entry) => entry.status === 'verified-id').length,
      nameMatches: associations.filter((entry) => entry.status === 'name-match').length,
      needsReview: review.length,
      uniqueAwardsNeedingReview: awards.size,
      knownFundingNeedingReview: [...awards.values()].reduce((sum, entry) => sum + (entry.amount ?? 0), 0),
      unknownAmountsNeedingReview: [...awards.values()].filter((entry) => entry.amount === null).length
    },
    associations
  };
};
