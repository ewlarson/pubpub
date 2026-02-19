import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

const PUBLICATIONS_URL = `${import.meta.env.BASE_URL}data/publications.json`;
const GRANTS_URL = `${import.meta.env.BASE_URL}data/grants.json`;

const normalize = (value) => value.toLowerCase();
const normalizeKey = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
const normalizeSlug = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const toNumber = (value) => {
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0
});

const formatCurrency = (value) => {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return currencyFormatter.format(value);
};

const formatDate = (value) => {
  if (!value) {
    return '—';
  }
  const text = String(value);
  return text.length >= 10 ? text.slice(0, 10) : text;
};

const extractCoreGrantNumber = (value) => {
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

const getGrantGroupInfo = (grant) => {
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

const buildYearSeries = (publications, range) => {
  const years = publications
    .map((pub) => pub.year)
    .filter((year) => Number.isFinite(year));
  if (!years.length) {
    return [];
  }
  const minYear = Number.isFinite(range?.min) ? range.min : Math.min(...years);
  const maxYear = Number.isFinite(range?.max) ? range.max : Math.max(...years);
  const counts = new Map();
  years.forEach((year) => {
    if (year < minYear || year > maxYear) {
      return;
    }
    counts.set(year, (counts.get(year) || 0) + 1);
  });
  const series = [];
  for (let year = minYear; year <= maxYear; year += 1) {
    series.push({ year, count: counts.get(year) || 0 });
  }
  return series;
};

const formatSparklineLabel = (series) => {
  if (!series.length) {
    return 'No publication history available.';
  }
  return `Publication counts per year: ${series
    .map((entry) => `${entry.year}: ${entry.count}`)
    .join(', ')}`;
};

const getAuthorCounts = (member, publications) => {
  const pubs = publications || member.publications || [];
  const hasAuthorship = pubs.some((pub) => pub?.authorship);
  if (hasAuthorship) {
    let first = 0;
    let last = 0;
    let known = 0;
    pubs.forEach((pub) => {
      if (!pub?.authorship) {
        return;
      }
      known += 1;
      if (pub.authorship.isFirst) {
        first += 1;
      }
      if (pub.authorship.isLast) {
        last += 1;
      }
    });
    return known ? { first, last, total: pubs.length, known } : null;
  }
  return member.authorCounts || member.signals?.positive?.authorCounts || null;
};

const formatAuthorshipLabel = (authorship) => {
  if (!authorship) {
    return { label: '—', title: 'Authorship position unknown.', isKnown: false };
  }
  let label = 'Middle';
  if (authorship.isFirst && authorship.isLast) {
    label = 'Sole';
  } else if (authorship.isFirst) {
    label = 'First';
  } else if (authorship.isLast) {
    label = 'Last';
  }
  const position = Number.isFinite(authorship.position) ? authorship.position + 1 : null;
  const total = Number.isFinite(authorship.total) ? authorship.total : null;
  const title =
    position && total
      ? `Author position ${position} of ${total}.`
      : 'Authorship position known.';
  return { label, title, isKnown: true };
};

export default function App() {
  const [pubData, setPubData] = useState({ updated: '', source: '', faculty: [] });
  const [grantData, setGrantData] = useState({ updated: '', source: '', faculty: [] });
  const [pubStatus, setPubStatus] = useState('loading');
  const [grantStatus, setGrantStatus] = useState('loading');
  const [tab, setTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('tab') === 'grants' ? 'grants' : 'publications';
  });
  const [query, setQuery] = useState('');
  const [yearMin, setYearMin] = useState('');
  const [yearMax, setYearMax] = useState('');
  const [pubSortBy, setPubSortBy] = useState('name');
  const [grantSortBy, setGrantSortBy] = useState('name');
  const [programFilters, setProgramFilters] = useState([]);
  const [grantTypeFilters, setGrantTypeFilters] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [stickyActive, setStickyActive] = useState(false);
  const stickyRef = useRef(null);

  const handleTabChange = (nextTab) => {
    setTab(nextTab);
    const url = new URL(window.location.href);
    if (nextTab === 'grants') {
      url.searchParams.set('tab', 'grants');
    } else {
      url.searchParams.delete('tab');
    }
    window.history.replaceState({}, '', url.toString());
  };

  useEffect(() => {
    let active = true;

    const loadDataset = async (url, setPayload, setState) => {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('missing');
          }
          throw new Error(`Failed to load data (${response.status})`);
        }
        const payload = await response.json();
        if (active) {
          setPayload(payload);
          setState('ready');
        }
      } catch (error) {
        console.error(error);
        if (active) {
          setState(error.message === 'missing' ? 'missing' : 'error');
        }
      }
    };

    loadDataset(PUBLICATIONS_URL, setPubData, setPubStatus);
    loadDataset(GRANTS_URL, setGrantData, setGrantStatus);

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const currentStatus = tab === 'publications' ? pubStatus : grantStatus;
    if (currentStatus !== 'ready') {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const facultyParam =
      params.get('faculty') || params.get('name') || params.get('researcher');
    if (!facultyParam) {
      return;
    }
    const key = normalizeKey(facultyParam);
    const slug = normalizeSlug(facultyParam);
    const facultyList = tab === 'publications' ? pubData.faculty : grantData.faculty;
    const match = facultyList.find((member) => {
      const idKey = normalizeKey(member.id);
      const nameKey = normalizeKey(member.name);
      return (
        idKey === key ||
        nameKey === key ||
        normalizeSlug(member.name) === slug ||
        normalizeSlug(member.id) === slug
      );
    });
    if (match) {
      setQuery(match.name);
      setOpenId(match.id);
    }
  }, [tab, pubStatus, grantStatus, pubData.faculty, grantData.faculty]);

  const handleCopyLink = async (member) => {
    const url = new URL(window.location.href);
    url.searchParams.set('faculty', member.id);
    if (tab === 'grants') {
      url.searchParams.set('tab', 'grants');
    } else {
      url.searchParams.delete('tab');
    }
    const link = url.toString();

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const input = document.createElement('input');
        input.value = link;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      setCopiedId(member.id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === member.id ? null : current));
      }, 1500);
    } catch (error) {
      console.error('Failed to copy link', error);
    }
  };

  const yearBounds = useMemo(() => {
    const years = pubData.faculty.flatMap((member) =>
      member.publications.map((pub) => pub.year)
    );
    if (!years.length) {
      return { min: '', max: '' };
    }
    return { min: Math.min(...years), max: Math.max(...years) };
  }, [pubData]);

  useEffect(() => {
    if (yearBounds.min && yearBounds.max) {
      setYearMin(yearBounds.min);
      setYearMax(yearBounds.max);
    }
  }, [yearBounds]);

  const activeYearRange = useMemo(() => {
    const min = toNumber(yearMin) ?? yearBounds.min;
    const max = toNumber(yearMax) ?? yearBounds.max;
    return {
      min: Number.isFinite(min) ? min : null,
      max: Number.isFinite(max) ? max : null
    };
  }, [yearMin, yearMax, yearBounds]);

  const toggleProgramFilter = (program) => {
    if (!program) {
      return;
    }
    setProgramFilters((current) =>
      current.includes(program)
        ? current.filter((entry) => entry !== program)
        : [...current, program]
    );
  };

  const toggleGrantTypeFilter = (type) => {
    if (!type) {
      return;
    }
    setGrantTypeFilters((current) =>
      current.includes(type)
        ? current.filter((entry) => entry !== type)
        : [...current, type]
    );
  };

  const handleClearFilters = () => {
    setQuery('');
    setProgramFilters([]);
    setGrantTypeFilters([]);
    if (tab === 'publications') {
      setPubSortBy('name');
      if (yearBounds.min && yearBounds.max) {
        setYearMin(yearBounds.min);
        setYearMax(yearBounds.max);
      } else {
        setYearMin('');
        setYearMax('');
      }
    } else {
      setGrantSortBy('name');
    }
    setOpenId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('faculty');
    url.searchParams.delete('name');
    url.searchParams.delete('researcher');
    if (tab === 'grants') {
      url.searchParams.set('tab', 'grants');
    } else {
      url.searchParams.delete('tab');
    }
    window.history.replaceState({}, '', url.toString());
  };

  const filteredPublications = useMemo(() => {
    const needle = normalize(query.trim());

    const facultyWithFilteredPubs = pubData.faculty.map((member) => {
      const pubsInRange = member.publications.filter((pub) => {
        const inMin = yearMin ? pub.year >= Number(yearMin) : true;
        const inMax = yearMax ? pub.year <= Number(yearMax) : true;
        return inMin && inMax;
      });

      const searchableBits = [
        member.name,
        member.department,
        ...(member.areas || []),
        ...(member.programs || []),
        ...pubsInRange.map((pub) => `${pub.title} ${pub.journal}`)
      ]
        .filter(Boolean)
        .join(' ');

      const matchesQuery = needle
        ? normalize(searchableBits).includes(needle)
        : true;

      const matchesPrograms = programFilters.length
        ? (member.programs || []).some((program) => programFilters.includes(program))
        : true;

      return {
        ...member,
        filteredPublications: pubsInRange,
        matchesQuery,
        matchesPrograms
      };
    });

    const filtered = facultyWithFilteredPubs.filter(
      (member) =>
        member.filteredPublications.length > 0 &&
        member.matchesQuery &&
        member.matchesPrograms
    );

    const sorted = [...filtered].sort((a, b) => {
      if (pubSortBy === 'count') {
        return b.filteredPublications.length - a.filteredPublications.length;
      }
      if (pubSortBy === 'latest') {
        const aLatest = Math.max(...a.filteredPublications.map((pub) => pub.year));
        const bLatest = Math.max(...b.filteredPublications.map((pub) => pub.year));
        return bLatest - aLatest;
      }
      return a.name.localeCompare(b.name);
    });

    return sorted;
  }, [pubData, query, pubSortBy, yearMin, yearMax, programFilters]);

  const filteredGrants = useMemo(() => {
    const needle = normalize(query.trim());

    const facultyWithFilteredGrants = grantData.faculty.map((member) => {
      const grants = member.grants || [];
      const searchableBits = [
        member.name,
        member.department,
        ...(member.areas || []),
        ...(member.programs || []),
        ...grants.map(
          (grant) =>
            `${grant.title} ${grant.id} ${grant.coreProjectNum || ''} ${extractCoreGrantNumber(
              grant.id
            )} ${getGrantGroupInfo(grant).type || ''}`
        )
      ]
        .filter(Boolean)
        .join(' ');

      const matchesQuery = needle
        ? normalize(searchableBits).includes(needle)
        : true;

      const matchesPrograms = programFilters.length
        ? (member.programs || []).some((program) => programFilters.includes(program))
        : true;

      const totalAmount = grants.reduce(
        (sum, grant) => sum + (Number.isFinite(grant.amount) ? grant.amount : 0),
        0
      );
      const hasAmount = grants.some((grant) => Number.isFinite(grant.amount));

      const groupedMap = new Map();
      grants.forEach((grant) => {
        const groupInfo = getGrantGroupInfo(grant);
        if (!groupedMap.has(groupInfo.key)) {
          groupedMap.set(groupInfo.key, {
            coreNumber: groupInfo.displayNumber,
            type: groupInfo.type,
            awards: [],
            totalAmount: 0,
            latestEnd: '',
            titles: new Set()
          });
        }
        const group = groupedMap.get(groupInfo.key);
        group.awards.push(grant);
        if (Number.isFinite(grant.amount)) {
          group.totalAmount += grant.amount;
        }
        if (grant.endDate && grant.endDate > group.latestEnd) {
          group.latestEnd = grant.endDate;
        }
        if (grant.title) {
          group.titles.add(grant.title);
        }
      });

      const groupedGrants = Array.from(groupedMap.values())
        .map((group) => {
          const titleList = Array.from(group.titles);
          let title = '';
          if (titleList.length === 1) {
            title = titleList[0];
          } else if (titleList.length > 1) {
            title = 'Multiple project titles';
          }
          return {
            coreNumber: group.coreNumber,
            type: group.type,
            title,
            totalAmount: group.totalAmount,
            latestEnd: group.latestEnd,
            awards: [...group.awards].sort((a, b) =>
              (b.startDate || '').localeCompare(a.startDate || '')
            )
          };
        })
        .sort((a, b) => (b.latestEnd || '').localeCompare(a.latestEnd || ''));

      const grantTypes = Array.from(
        new Set(groupedGrants.map((group) => group.type).filter(Boolean))
      ).sort();

      const matchesGrantTypes = grantTypeFilters.length
        ? grantTypes.some((type) => grantTypeFilters.includes(type))
        : true;

      return {
        ...member,
        filteredGrants: grants,
        groupedGrants,
        grantCount: groupedGrants.length,
        grantTypes,
        matchesQuery,
        matchesPrograms,
        matchesGrantTypes,
        totalAmount,
        hasAmount
      };
    });

    const filtered = facultyWithFilteredGrants.filter(
      (member) =>
        member.groupedGrants.length > 0 &&
        member.matchesQuery &&
        member.matchesPrograms &&
        member.matchesGrantTypes
    );

    const sorted = [...filtered].sort((a, b) => {
      if (grantSortBy === 'count') {
        return b.grantCount - a.grantCount;
      }
      if (grantSortBy === 'amount') {
        return (b.totalAmount || 0) - (a.totalAmount || 0);
      }
      return a.name.localeCompare(b.name);
    });

    return sorted;
  }, [grantData, query, grantSortBy, programFilters, grantTypeFilters]);

  const activeFaculty = tab === 'publications' ? filteredPublications : filteredGrants;

  useEffect(() => {
    setOpenId(null);
    setStickyActive(false);
  }, [tab]);

  useEffect(() => {
    if (!openId) {
      return;
    }
    const target = document.getElementById(`faculty-${openId}`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [openId, activeFaculty]);

  const totalPublications = useMemo(() => {
    return filteredPublications.reduce(
      (sum, member) => sum + member.filteredPublications.length,
      0
    );
  }, [filteredPublications]);

  const totalGrants = useMemo(() => {
    return filteredGrants.reduce(
      (sum, member) => sum + member.grantCount,
      0
    );
  }, [filteredGrants]);

  const totalGrantAmount = useMemo(() => {
    return filteredGrants.reduce(
      (sum, member) => sum + (member.totalAmount || 0),
      0
    );
  }, [filteredGrants]);

  const hasGrantAmounts = useMemo(() => {
    return filteredGrants.some((member) => member.hasAmount);
  }, [filteredGrants]);

  const openMember = useMemo(() => {
    if (!openId) {
      return null;
    }
    return activeFaculty.find((member) => member.id === openId) || null;
  }, [activeFaculty, openId]);

  useEffect(() => {
    if (!openId) {
      setStickyActive(false);
      return;
    }

    const STICKY_OFFSET = 12;

    const listPrefix = tab === 'publications' ? 'pub-list' : 'grant-list';

    const handlePosition = () => {
      const listEl = document.getElementById(`${listPrefix}-${openId}`);
      if (!listEl) {
        setStickyActive(false);
        return;
      }
      const rect = listEl.getBoundingClientRect();
      const stickyHeight = stickyRef.current?.offsetHeight || 0;
      const withinTop = rect.top <= STICKY_OFFSET;
      const withinBottom = rect.bottom >= STICKY_OFFSET + stickyHeight + 8;
      setStickyActive(withinTop && withinBottom);
    };

    handlePosition();
    window.addEventListener('scroll', handlePosition, { passive: true });
    window.addEventListener('resize', handlePosition);
    return () => {
      window.removeEventListener('scroll', handlePosition);
      window.removeEventListener('resize', handlePosition);
    };
  }, [openId, tab]);

  const isPublications = tab === 'publications';
  const activeStatus = isPublications ? pubStatus : grantStatus;
  const activeData = isPublications ? pubData : grantData;
  const activeLabel = isPublications ? 'publications' : 'grants';
  const activeFile = isPublications
    ? 'public/data/publications.json'
    : 'public/data/grants.json';

  if (activeStatus === 'loading') {
    return (
      <main className="page">
        <section className="hero">
          <p className="eyebrow">CTSI Faculty Dashboard</p>
          <h1>Loading {activeLabel} data...</h1>
        </section>
      </main>
    );
  }

  if (activeStatus === 'error' || activeStatus === 'missing') {
    return (
      <main className="page">
        <section className="hero">
          <p className="eyebrow">CTSI Faculty Dashboard</p>
          <h1>We could not load the dataset.</h1>
          <p className="muted">
            Check the JSON file at <span className="mono">{activeFile}</span> and
            try again.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="topbar">
        <div className="tabs" role="tablist" aria-label="Dashboard sections">
          <button
            type="button"
            role="tab"
            aria-selected={isPublications}
            aria-controls="tab-panel-publications"
            id="tab-publications"
            className={`tab ${isPublications ? 'is-active' : ''}`}
            onClick={() => handleTabChange('publications')}
          >
            Publications
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={!isPublications}
            aria-controls="tab-panel-grants"
            id="tab-grants"
            className={`tab ${!isPublications ? 'is-active' : ''}`}
            onClick={() => handleTabChange('grants')}
          >
            Grants
          </button>
        </div>
      </div>
      <header className="hero">
        <p className="eyebrow">University of Minnesota CTSI</p>
        <h1>
          {isPublications ? 'Faculty Publication Dashboard' : 'Faculty Grant Dashboard'}
        </h1>
        <p className="lead">
          {isPublications
            ? 'Explore recent publications, filter by year, and highlight CTSI faculty output for grants, reports, and public engagement.'
            : 'Review NIH RePORTER grants tied to CTSI faculty and track award amounts across the program.'}
        </p>
        <div className="hero-meta">
          <div>
            <span className="label">Faculty in view</span>
            <strong>{activeFaculty.length}</strong>
          </div>
          {isPublications ? (
            <div>
              <span className="label">Publications in view</span>
              <strong>{totalPublications}</strong>
            </div>
          ) : (
            <div>
              <span className="label">Grant projects in view</span>
              <strong>{totalGrants}</strong>
            </div>
          )}
          {!isPublications ? (
            <div>
              <span className="label">Total awarded</span>
              <strong>
                {hasGrantAmounts ? formatCurrency(totalGrantAmount) : '—'}
              </strong>
            </div>
          ) : null}
          <div>
            <span className="label">Last updated</span>
            <strong>{activeData.updated || 'Unknown'}</strong>
          </div>
        </div>
        <div className="hero-actions">
          <a
            className="button"
            href={isPublications ? PUBLICATIONS_URL : GRANTS_URL}
            target="_blank"
            rel="noreferrer"
          >
            Download JSON
          </a>
          {activeData.source ? (
            <span className="tag">Source: {activeData.source}</span>
          ) : null}
        </div>
      </header>

      <section className="panel">
        <div className="panel-row">
          <label className="field">
            <span>Search</span>
            <input
              type="search"
              placeholder={
                isPublications ? 'Name, department, title' : 'Name, department, project'
              }
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {isPublications ? (
            <>
              <label className="field">
                <span>Start year</span>
                <input
                  type="number"
                  min={yearBounds.min || undefined}
                  max={yearBounds.max || undefined}
                  value={yearMin}
                  onChange={(event) => setYearMin(event.target.value)}
                />
              </label>
              <label className="field">
                <span>End year</span>
                <input
                  type="number"
                  min={yearBounds.min || undefined}
                  max={yearBounds.max || undefined}
                  value={yearMax}
                  onChange={(event) => setYearMax(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Sort by</span>
                <select
                  value={pubSortBy}
                  onChange={(event) => setPubSortBy(event.target.value)}
                >
                  <option value="name">Faculty name</option>
                  <option value="count">Publication count</option>
                  <option value="latest">Most recent year</option>
                </select>
              </label>
            </>
          ) : (
            <label className="field">
              <span>Sort by</span>
              <select
                value={grantSortBy}
                onChange={(event) => setGrantSortBy(event.target.value)}
              >
                <option value="name">Faculty name</option>
                <option value="count">Grant count</option>
                <option value="amount">Total awarded</option>
              </select>
            </label>
          )}
          <div className="field">
            <span>Reset</span>
            <button type="button" className="clear-button" onClick={handleClearFilters}>
              Clear filters
            </button>
          </div>
        </div>
        {programFilters.length || (!isPublications && grantTypeFilters.length) ? (
          <div className="active-filters">
            {programFilters.length ? (
              <>
                <span className="label">Program filters</span>
                <div className="chip-row">
                  {programFilters.map((program) => (
                    <button
                      key={program}
                      type="button"
                      className="chip is-active"
                      onClick={() => toggleProgramFilter(program)}
                      aria-pressed="true"
                    >
                      {program}
                      <span aria-hidden="true">×</span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            {!isPublications && grantTypeFilters.length ? (
              <>
                <span className="label">Grant type filters</span>
                <div className="chip-row">
                  {grantTypeFilters.map((type) => (
                    <button
                      key={type}
                      type="button"
                      className="chip is-active"
                      onClick={() => toggleGrantTypeFilter(type)}
                      aria-pressed="true"
                    >
                      {type}
                      <span aria-hidden="true">×</span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </section>

      {openMember ? (
        <div
          className={`sticky-author ${stickyActive ? 'is-active' : ''}`}
          ref={stickyRef}
        >
          <div className="sticky-author-card">
            <div className="sticky-author-main">
              <span className="sticky-author-name">{openMember.name}</span>
              <span className="sticky-author-meta">{openMember.department}</span>
            </div>
            <span className="sticky-author-count">
              {isPublications
                ? `${openMember.filteredPublications.length} publications`
                : `${openMember.grantCount} grants`}
            </span>
          </div>
        </div>
      ) : null}

      {isPublications ? (
        <>
          <section
            className="table-wrap"
            id="tab-panel-publications"
            role="tabpanel"
            aria-labelledby="tab-publications"
          >
            <table className="table">
              <thead>
                <tr>
                  <th>Faculty</th>
                  <th>Affiliation</th>
                  <th>Programs</th>
                  <th>Trend</th>
                  <th className="num">Publications</th>
                  <th className="num">Latest Year</th>
                  <th>First/Last</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {filteredPublications.map((member) => {
                  const latestYear = Math.max(
                    ...member.filteredPublications.map((pub) => pub.year)
                  );
                  const yearSeries = buildYearSeries(
                    member.filteredPublications,
                    activeYearRange
                  );
                  const sparkMax = Math.max(
                    ...yearSeries.map((entry) => entry.count),
                    1
                  );
                  const authorCounts = getAuthorCounts(
                    member,
                    member.filteredPublications
                  );
                  const isOpen = openId === member.id;

                  return (
                    <Fragment key={member.id}>
                      <tr id={`faculty-${member.id}`}>
                        <td>
                          <div className="name-row">
                            <div className="name">{member.name}</div>
                            <button
                              type="button"
                              className="copy-link"
                              onClick={() => handleCopyLink(member)}
                              aria-label={`Copy link for ${member.name}`}
                              title="Copy link"
                            >
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L10 5" />
                                <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L14 19" />
                              </svg>
                            </button>
                            {copiedId === member.id ? (
                              <span className="muted small">Copied</span>
                            ) : null}
                          </div>
                          <div className="muted small">
                            {member.orcid ? (
                              <a
                                href={`https://orcid.org/${member.orcid}`}
                                target="_blank"
                                rel="noreferrer"
                                className="mono"
                              >
                                {member.orcid}
                              </a>
                            ) : (
                              'ORCID not listed'
                            )}
                          </div>
                        </td>
                        <td>{member.department}</td>
                        <td>
                          {member.programs?.length ? (
                            <div className="program-list">
                              {member.programs.map((program) => {
                                const isActive = programFilters.includes(program);
                                return (
                                  <button
                                    key={`${member.id}-${program}`}
                                    type="button"
                                    className={`program-pill ${
                                      isActive ? 'is-active' : ''
                                    }`}
                                    onClick={() => toggleProgramFilter(program)}
                                    aria-pressed={isActive}
                                    title={`Filter by ${program}`}
                                  >
                                    {program}
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          {yearSeries.length ? (
                            <div
                              className="sparkline"
                              role="img"
                              aria-label={formatSparklineLabel(yearSeries)}
                            >
                              {yearSeries.map((entry) => (
                                <span
                                  key={entry.year}
                                  className={`spark-bar ${
                                    entry.count ? 'is-active' : ''
                                  }`}
                                  style={{
                                    height: `${(entry.count / sparkMax) * 100}%`
                                  }}
                                  title={`${entry.year}: ${entry.count}`}
                                />
                              ))}
                            </div>
                          ) : (
                            <span className="muted">—</span>
                          )}
                          {yearSeries.length ? (
                            <div className="sparkline-range">
                              <span>{yearSeries[0].year}</span>
                              <span>{yearSeries[yearSeries.length - 1].year}</span>
                            </div>
                          ) : null}
                        </td>
                        <td className="num">{member.filteredPublications.length}</td>
                        <td className="num">{latestYear}</td>
                        <td>
                          {authorCounts ? (
                            <div
                              className="author-counts"
                              title={
                                Number.isFinite(authorCounts.known)
                                  ? `Authorship positions known for ${authorCounts.known} of ${authorCounts.total} publications.`
                                  : undefined
                              }
                            >
                              <span>
                                <strong>{authorCounts.first ?? 0}</strong> first
                              </span>
                              <span>
                                <strong>{authorCounts.last ?? 0}</strong> last
                              </span>
                            </div>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="pub-toggle"
                            aria-expanded={isOpen}
                            aria-controls={`pub-list-${member.id}`}
                            onClick={() => {
                              setOpenId(isOpen ? null : member.id);
                            }}
                          >
                            {isOpen ? 'Hide list' : 'View list'}
                          </button>
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr className="pub-row">
                          <td colSpan={8}>
                            <div className="pub-table-wrap" id={`pub-list-${member.id}`}>
                              <div className="pub-table">
                                <div className="pub-grid pub-header">
                                  <span className="pub-head pub-head-pmid">PMID</span>
                                  <span className="pub-head pub-head-year">Year</span>
                                  <span className="pub-head pub-head-authorship">Authorship</span>
                                  <span className="pub-head">Journal</span>
                                  <span className="pub-head">Title</span>
                                  <span className="pub-head pub-head-doi">DOI</span>
                                </div>
                                {member.filteredPublications.map((pub) => {
                                  const authorship = formatAuthorshipLabel(pub.authorship);
                                  return (
                                    <div className="pub-grid" key={pub.id}>
                                      <div className="pub-cell mono pub-pmid">
                                        {pub.url ? (
                                          <a
                                            href={pub.url}
                                            target="_blank"
                                            rel="noreferrer"
                                          >
                                            {pub.id}
                                          </a>
                                        ) : (
                                          pub.id
                                        )}
                                      </div>
                                      <div className="pub-cell num pub-year">
                                        {pub.year ?? '—'}
                                      </div>
                                      <div
                                        className={`pub-cell pub-authorship ${
                                          authorship.isKnown ? '' : 'muted'
                                        }`}
                                        title={authorship.title}
                                      >
                                        {authorship.label}
                                      </div>
                                      <div className="pub-cell">{pub.journal}</div>
                                      <div className="pub-cell pub-title-cell">
                                        {pub.url ? (
                                          <a
                                            href={pub.url}
                                            target="_blank"
                                            rel="noreferrer"
                                          >
                                            {pub.title}
                                          </a>
                                        ) : (
                                          pub.title
                                        )}
                                      </div>
                                      <div className="pub-cell pub-doi">
                                        {pub.doi ? (
                                          <a
                                            href={`https://doi.org/${pub.doi}`}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="doi-link"
                                            aria-label={`Open DOI ${pub.doi}`}
                                          >
                                            DOI
                                          </a>
                                        ) : (
                                          '—'
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </section>

          {filteredPublications.length === 0 ? (
            <section className="empty">
              <h2>No results found</h2>
              <p>Try adjusting the search term or widening the year range.</p>
            </section>
          ) : null}
        </>
      ) : (
        <>
          <section
            className="table-wrap"
            id="tab-panel-grants"
            role="tabpanel"
            aria-labelledby="tab-grants"
          >
            <table className="table">
              <thead>
                <tr>
                  <th>Faculty</th>
                  <th>Affiliation</th>
                  <th>Programs</th>
                  <th>Grant Type</th>
                  <th className="num">Grants</th>
                  <th className="num">Total Awarded</th>
                  <th>Latest End</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {filteredGrants.map((member) => {
                  const latestEnd = member.groupedGrants.reduce((latest, grant) => {
                    const end = grant.latestEnd || '';
                    return end > latest ? end : latest;
                  }, '');
                  const isOpen = openId === member.id;

                  return (
                    <Fragment key={member.id}>
                      <tr id={`faculty-${member.id}`}>
                        <td>
                          <div className="name-row">
                            <div className="name">{member.name}</div>
                            <button
                              type="button"
                              className="copy-link"
                              onClick={() => handleCopyLink(member)}
                              aria-label={`Copy link for ${member.name}`}
                              title="Copy link"
                            >
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L10 5" />
                                <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L14 19" />
                              </svg>
                            </button>
                            {copiedId === member.id ? (
                              <span className="muted small">Copied</span>
                            ) : null}
                          </div>
                        </td>
                        <td>{member.department}</td>
                        <td>
                          {member.programs?.length ? (
                            <div className="program-list">
                              {member.programs.map((program) => {
                                const isActive = programFilters.includes(program);
                                return (
                                  <button
                                    key={`${member.id}-${program}`}
                                    type="button"
                                    className={`program-pill ${
                                      isActive ? 'is-active' : ''
                                    }`}
                                    onClick={() => toggleProgramFilter(program)}
                                    aria-pressed={isActive}
                                    title={`Filter by ${program}`}
                                  >
                                    {program}
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          {member.grantTypes?.length ? (
                            <div className="program-list">
                              {member.grantTypes.map((type) => {
                                const isActive = grantTypeFilters.includes(type);
                                return (
                                  <button
                                    key={`${member.id}-${type}`}
                                    type="button"
                                    className={`program-pill ${isActive ? 'is-active' : ''}`}
                                    onClick={() => toggleGrantTypeFilter(type)}
                                    aria-pressed={isActive}
                                    title={`Filter by ${type}`}
                                  >
                                    {type}
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="num">{member.grantCount}</td>
                        <td className="num">
                          {member.hasAmount ? formatCurrency(member.totalAmount) : '—'}
                        </td>
                        <td>{latestEnd ? formatDate(latestEnd) : '—'}</td>
                        <td>
                          <button
                            type="button"
                            className="pub-toggle"
                            aria-expanded={isOpen}
                            aria-controls={`grant-list-${member.id}`}
                            onClick={() => {
                              setOpenId(isOpen ? null : member.id);
                            }}
                          >
                            {isOpen ? 'Hide list' : 'View list'}
                          </button>
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr className="grant-row">
                          <td colSpan={8}>
                            <div
                              className="grant-table-wrap"
                              id={`grant-list-${member.id}`}
                            >
                              <div className="grant-table">
                                <div className="grant-grid grant-header">
                                  <span className="grant-head grant-head-number">
                                    Grant #
                                  </span>
                                  <span className="grant-head grant-head-type">
                                    Type
                                  </span>
                                  <span className="grant-head grant-head-role">Role</span>
                                  <span className="grant-head grant-head-amount">Award</span>
                                  <span className="grant-head grant-head-start">Start</span>
                                  <span className="grant-head grant-head-end">End</span>
                                  <span className="grant-head">Project title</span>
                                </div>
                                {member.groupedGrants.map((group) => (
                                  <Fragment key={group.coreNumber}>
                                    <div className="grant-group">
                                      <div className="grant-group-title">
                                        <span className="mono">{group.coreNumber}</span>
                                        {group.title ? (
                                          <span className="grant-group-title-text">
                                            — {group.title}
                                          </span>
                                        ) : null}
                                      </div>
                                      <div className="grant-group-meta">
                                        {group.awards.length} awards
                                        {group.totalAmount
                                          ? ` • ${formatCurrency(group.totalAmount)}`
                                          : ''}
                                      </div>
                                    </div>
                                    {group.awards.map((grant) => (
                                      <div
                                        className="grant-grid"
                                        key={`${group.coreNumber}-${grant.id}-${grant.fiscalYear || ''}`}
                                      >
                                        <div className="grant-cell mono grant-number">
                                          {grant.url ? (
                                            <a
                                              href={grant.url}
                                              target="_blank"
                                              rel="noreferrer"
                                            >
                                              {grant.id || '—'}
                                            </a>
                                          ) : (
                                            grant.id || '—'
                                          )}
                                        </div>
                                        <div className="grant-cell grant-type">
                                          {group.type || '—'}
                                        </div>
                                        <div className="grant-cell grant-role">
                                          {grant.role || '—'}
                                        </div>
                                        <div className="grant-cell num grant-amount">
                                          {formatCurrency(grant.amount)}
                                        </div>
                                        <div className="grant-cell num grant-date">
                                          {formatDate(grant.startDate)}
                                        </div>
                                        <div className="grant-cell num grant-date">
                                          {formatDate(grant.endDate)}
                                        </div>
                                        <div className="grant-cell grant-title">
                                          {grant.title || '—'}
                                        </div>
                                      </div>
                                    ))}
                                  </Fragment>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </section>

          {filteredGrants.length === 0 ? (
            <section className="empty">
              <h2>No results found</h2>
              <p>Try adjusting the search term or clearing filters.</p>
            </section>
          ) : null}
        </>
      )}

      <footer className="footer">
        <p>
          Built for CTSI faculty reporting. Update the dataset in
          <span className="mono"> {activeFile}</span> to refresh the dashboard.
        </p>
      </footer>
    </main>
  );
}
