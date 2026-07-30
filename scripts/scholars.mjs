const normalize = (value) => String(value ?? '').trim();

const normalizeHeader = (value) =>
  normalize(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

export const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        index += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += char;
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
};

export const normalizeOrcid = (value) => {
  const candidate = normalize(value)
    .replace(/^https?:\/\/orcid\.org\//i, '')
    .replace(/^\/+/, '')
    .toUpperCase();
  if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(candidate)) {
    return '';
  }

  const digits = candidate.replaceAll('-', '');
  let total = 0;
  for (const digit of digits.slice(0, 15)) {
    total = (total + Number(digit)) * 2;
  }
  const remainder = total % 11;
  const result = (12 - remainder) % 11;
  const expectedCheckDigit = result === 10 ? 'X' : String(result);
  return digits.at(-1) === expectedCheckDigit ? candidate : '';
};

export const parseDate = (value) => {
  const raw = normalize(value);
  if (!raw) {
    return null;
  }

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const parts = isoMatch
    ? [Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3])]
    : slashMatch
      ? [Number(slashMatch[3]), Number(slashMatch[1]), Number(slashMatch[2])]
      : null;
  if (!parts) {
    return null;
  }

  const [year, month, day] = parts;
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
};

const normalizeProgram = (value) => {
  const program = normalize(value);
  if (/TL1/i.test(program)) {
    return 'TL1';
  }
  if (/T32/i.test(program)) {
    return 'T32';
  }
  if (/TRDP|Translational Research Development Program/i.test(program)) {
    return 'TRDP';
  }
  return program;
};

const toIsoDate = (date) =>
  date instanceof Date && !Number.isNaN(date.getTime())
    ? [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
      ].join('-')
    : '';

const toPubMedDate = (date) => toIsoDate(date).replaceAll('-', '/');

export const parseScholarsCsv = (text) => {
  const [headerRow = [], ...body] = parseCsv(text);
  const headers = headerRow.map(normalizeHeader);
  const skipped = [];
  const scholars = [];

  body.forEach((row, index) => {
    const record = headers.reduce((entry, header, column) => {
      entry[header] = normalize(row[column]);
      return entry;
    }, {});
    if (!record.first_name && !record.last_name && !record.orcid) {
      return;
    }

    const orcid = normalizeOrcid(record.orcid || record.orcid_id);
    const startDate = parseDate(record.funding_start_date);
    if (!orcid || !startDate) {
      skipped.push({
        row: index + 2,
        name: `${record.first_name || ''} ${record.last_name || ''}`.trim(),
        reason: !orcid ? 'missing or invalid ORCID' : 'missing or invalid funding start date'
      });
      return;
    }

    const program = normalizeProgram(record.program);
    const endDate = parseDate(record.funding_end_date);
    scholars.push({
      id: `t-scholar-${orcid.toLowerCase()}`,
      name: `${record.first_name || ''} ${record.last_name || ''}`.trim(),
      foreName: record.first_name || '',
      lastName: record.last_name || '',
      orcid,
      program,
      projectTitle: record.project_title_research_topic || '',
      startDate,
      endDate
    });
  });

  return { scholars, skipped };
};

export const buildScholarQuery = ({ orcid, startDate, endDate }) => {
  const normalizedOrcid = normalizeOrcid(orcid);
  const start = toPubMedDate(startDate);
  const end = toPubMedDate(endDate);
  if (!normalizedOrcid || !start || !end) {
    return '';
  }
  return `${normalizedOrcid}[auid] AND ("${start}"[pdat] : "${end}"[pdat])`;
};

export const isPublicationOnOrAfter = ({ publicationDate, publicationYear, startDate }) => {
  if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) {
    return true;
  }
  if (publicationDate instanceof Date && !Number.isNaN(publicationDate.getTime())) {
    return publicationDate >= startDate;
  }
  return Number.isFinite(publicationYear)
    ? publicationYear > startDate.getFullYear()
    : false;
};

export const formatScholarProgramAssociation = (scholar) => ({
  program: scholar.program,
  startDate: toIsoDate(scholar.startDate),
  endDate: toIsoDate(scholar.endDate)
});
