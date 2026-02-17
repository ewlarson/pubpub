const ESEARCH_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi';
const ESUMMARY_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi';

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const buildQueryString = (params) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    query.set(key, String(value));
  });
  return query.toString();
};

export async function ncbiGetJson(url, params, { maxRetries = 8 } = {}) {
  const queryString = buildQueryString(params);
  const requestUrl = `${url}?${queryString}`;

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(requestUrl, { method: 'GET', signal: controller.signal });
      clearTimeout(timeout);

      if (response.ok) {
        return response.json();
      }

      if (RETRYABLE_STATUSES.has(response.status)) {
        const baseDelay = 800 * 2 ** attempt;
        const jitter = 1 + Math.random() * 0.25;
        await sleep(baseDelay * jitter);
        continue;
      }

      const errorBody = await response.text();
      throw new Error(`NCBI request failed (${response.status}): ${errorBody}`);
    } catch (error) {
      clearTimeout(timeout);
      if (attempt < maxRetries - 1) {
        const baseDelay = 800 * 2 ** attempt;
        const jitter = 1 + Math.random() * 0.25;
        await sleep(baseDelay * jitter);
        continue;
      }
      throw error;
    }
  }

  throw new Error('NCBI request failed after retries');
}

export async function fetchPmids(term, email, tool, apiKey) {
  const params = {
    db: 'pubmed',
    term,
    retmode: 'json',
    retmax: 500,
    tool,
    email,
    api_key: apiKey
  };

  const data = await ncbiGetJson(ESEARCH_URL, params);
  return data.esearchresult?.idlist ?? [];
}

export async function fetchSummaries(pmids, email, tool, apiKey) {
  if (!pmids.length) {
    return [];
  }

  const params = {
    db: 'pubmed',
    id: pmids.join(','),
    retmode: 'json',
    tool,
    email,
    api_key: apiKey
  };

  const data = await ncbiGetJson(ESUMMARY_URL, params);
  const result = data?.result;
  if (!result || !result.uids) {
    return [];
  }

  return result.uids.map((uid) => result[uid]).filter(Boolean);
}
