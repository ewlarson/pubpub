export const extractCoreGrantNumber = (value) => {
  if (!value) {
    return '';
  }
  const base = String(value).split('-')[0];
  const stripped = base.replace(/^[0-9]+/, '');
  return (stripped || base).toUpperCase();
};

const parseGrantCore = (value) => {
  const coreNumber = extractCoreGrantNumber(value);
  if (!coreNumber) {
    return { coreNumber: '', activity: '', institute: '', serial: '' };
  }
  const match = coreNumber.match(/^([A-Z0-9]+?)([A-Z]{2})(\d+)$/);
  if (!match) {
    return { coreNumber, activity: '', institute: '', serial: '' };
  }
  return {
    coreNumber,
    activity: match[1],
    institute: match[2],
    serial: match[3]
  };
};

export const getGrantGroupInfo = (grant) => {
  const source = grant.coreProjectNum || grant.id || '';
  const parsed = parseGrantCore(source);
  if (
    ['K99', 'R00'].includes(parsed.activity) &&
    parsed.institute &&
    parsed.serial
  ) {
    const displayNumber = `K99/R00${parsed.institute}${parsed.serial}`;
    return {
      key: displayNumber,
      displayNumber,
      type: 'K99/R00'
    };
  }
  const displayNumber = parsed.coreNumber || extractCoreGrantNumber(source) || 'Unknown';
  return {
    key: displayNumber,
    displayNumber,
    type: parsed.activity || ''
  };
};

export const getYearFromDate = (value) => {
  if (!value) {
    return null;
  }
  const match = String(value).match(/^(\d{4})/);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  return Number.isFinite(year) ? year : null;
};

export const getGrantYear = (grant) =>
  (Number.isFinite(grant?.fiscalYear) && grant.fiscalYear) ||
  getYearFromDate(grant?.startDate) ||
  getYearFromDate(grant?.endDate);

// An award is an annual funding record, not its multi-year project group.
// Keep supplements and fiscal years separate while merging faculty associations.
export const summarizeGrantPortfolio = (faculty) => {
  const awards = new Map();
  faculty.forEach((member, memberIndex) => {
    (member.filteredGrants ?? member.grants ?? []).forEach((grant, grantIndex) => {
      const id = String(grant.id || '').trim().toUpperCase();
      const year = Number.isFinite(grant.fiscalYear) ? grant.fiscalYear : '';
      const key = id
        ? JSON.stringify(['id', id, year])
        : grant.url
          ? JSON.stringify(['url', grant.url, year])
          : JSON.stringify(['unidentified', memberIndex, grantIndex]);
      const existing = awards.get(key);
      // Prefer a known amount over a missing copy, without adding it twice.
      if (!existing || (!Number.isFinite(existing.amount) && Number.isFinite(grant.amount))) {
        awards.set(key, grant);
      }
    });
  });

  const projects = new Map();
  const years = new Map();
  let totalAmount = 0;
  let hasAmounts = false;
  for (const [awardKey, grant] of awards) {
    const group = getGrantGroupInfo(grant);
    projects.set(group.key === 'Unknown' ? awardKey : group.key, group.type || 'Other');
    const hasAmount = Number.isFinite(grant.amount);
    if (hasAmount) {
      totalAmount += grant.amount;
      hasAmounts = true;
    }
    const year = getGrantYear(grant);
    if (year) {
      const entry = years.get(year) || { year, total: 0, count: 0 };
      entry.count += 1;
      if (hasAmount) {
        entry.total += grant.amount;
      }
      years.set(year, entry);
    }
  }
  const types = new Map();
  for (const type of projects.values()) {
    types.set(type, (types.get(type) || 0) + 1);
  }
  return {
    awardCount: awards.size,
    projectCount: projects.size,
    totalAmount,
    hasAmounts,
    yearSeries: [...years.values()].sort((a, b) => a.year - b.year),
    typeCounts: [...types].map(([label, value]) => ({ label, value }))
  };
};

// Fixed reporting categories; retain the existing K99/R00 project grouping.
export const GRANT_MIX_TYPES = ['R01', 'R21', 'R03', 'K01', 'K08', 'K23', 'K99', 'Other'];
const GRANT_MIX_COLORS = ['#1f5ca7', '#2f8bc1', '#2aa58b', '#f0b429', '#ee6c4d', '#7c8f3b', '#8856a7', '#687780'];

export const getGrantMixType = (type) => {
  const label = type === 'K99/R00' ? 'K99' : type;
  return GRANT_MIX_TYPES.includes(label) ? label : 'Other';
};

export const buildGrantMixSegments = (typeCounts) => {
  if (!typeCounts.some(({ value }) => value > 0)) return [];
  const counts = new Map(GRANT_MIX_TYPES.map(type => [type, 0]));
  for (const { label, value } of typeCounts) {
    const category = getGrantMixType(label);
    counts.set(category, counts.get(category) + value);
  }
  return GRANT_MIX_TYPES.map((label, index) => ({
    label, value: counts.get(label), color: GRANT_MIX_COLORS[index]
  }));
};

export const getGrantMixFilterTypes = (types, category) =>
  [...new Set(types.filter(type => getGrantMixType(type) === category))];
