import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

const DATA_URL = `${import.meta.env.BASE_URL}data/publications.json`;

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
  const [data, setData] = useState({ updated: '', source: '', faculty: [] });
  const [status, setStatus] = useState('loading');
  const [query, setQuery] = useState('');
  const [yearMin, setYearMin] = useState('');
  const [yearMax, setYearMax] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [programFilters, setProgramFilters] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [stickyActive, setStickyActive] = useState(false);
  const stickyRef = useRef(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const response = await fetch(DATA_URL, { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`Failed to load data (${response.status})`);
        }
        const payload = await response.json();
        if (active) {
          setData(payload);
          setStatus('ready');
        }
      } catch (error) {
        console.error(error);
        if (active) {
          setStatus('error');
        }
      }
    };

    load();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (status !== 'ready') {
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
    const match = data.faculty.find((member) => {
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
  }, [status, data.faculty]);

  const handleCopyLink = async (member) => {
    const url = new URL(window.location.href);
    url.searchParams.set('faculty', member.id);
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
    const years = data.faculty.flatMap((member) =>
      member.publications.map((pub) => pub.year)
    );
    if (!years.length) {
      return { min: '', max: '' };
    }
    return { min: Math.min(...years), max: Math.max(...years) };
  }, [data]);

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

  const handleClearFilters = () => {
    setQuery('');
    setSortBy('name');
    setProgramFilters([]);
    if (yearBounds.min && yearBounds.max) {
      setYearMin(yearBounds.min);
      setYearMax(yearBounds.max);
    } else {
      setYearMin('');
      setYearMax('');
    }
    setOpenId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('faculty');
    url.searchParams.delete('name');
    url.searchParams.delete('researcher');
    window.history.replaceState({}, '', url.toString());
  };

  const filteredFaculty = useMemo(() => {
    const needle = normalize(query.trim());

    const facultyWithFilteredPubs = data.faculty.map((member) => {
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
      if (sortBy === 'count') {
        return b.filteredPublications.length - a.filteredPublications.length;
      }
      if (sortBy === 'latest') {
        const aLatest = Math.max(...a.filteredPublications.map((pub) => pub.year));
        const bLatest = Math.max(...b.filteredPublications.map((pub) => pub.year));
        return bLatest - aLatest;
      }
      return a.name.localeCompare(b.name);
    });

    return sorted;
  }, [data, query, sortBy, yearMin, yearMax, programFilters]);

  useEffect(() => {
    if (!openId) {
      return;
    }
    const target = document.getElementById(`faculty-${openId}`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [openId, filteredFaculty]);

  const totalPublications = useMemo(() => {
    return filteredFaculty.reduce(
      (sum, member) => sum + member.filteredPublications.length,
      0
    );
  }, [filteredFaculty]);

  const openMember = useMemo(() => {
    if (!openId) {
      return null;
    }
    return filteredFaculty.find((member) => member.id === openId) || null;
  }, [filteredFaculty, openId]);

  useEffect(() => {
    if (!openId) {
      setStickyActive(false);
      return;
    }

    const STICKY_OFFSET = 12;

    const handlePosition = () => {
      const listEl = document.getElementById(`pub-list-${openId}`);
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
  }, [openId]);

  if (status === 'loading') {
    return (
      <main className="page">
        <section className="hero">
          <p className="eyebrow">CTSI Faculty Publications</p>
          <h1>Loading publication data...</h1>
        </section>
      </main>
    );
  }

  if (status === 'error') {
    return (
      <main className="page">
        <section className="hero">
          <p className="eyebrow">CTSI Faculty Publications</p>
          <h1>We could not load the dataset.</h1>
          <p className="muted">
            Check the JSON file at <span className="mono">public/data/publications.json</span>
            and try again.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">University of Minnesota CTSI</p>
        <h1>Faculty Publication Dashboard</h1>
        <p className="lead">
          Explore recent publications, filter by year, and highlight CTSI faculty
          output for grants, reports, and public engagement.
        </p>
        <div className="hero-meta">
          <div>
            <span className="label">Faculty in view</span>
            <strong>{filteredFaculty.length}</strong>
          </div>
          <div>
            <span className="label">Publications in view</span>
            <strong>{totalPublications}</strong>
          </div>
          <div>
            <span className="label">Last updated</span>
            <strong>{data.updated || 'Unknown'}</strong>
          </div>
        </div>
        <div className="hero-actions">
          <a className="button" href={DATA_URL} target="_blank" rel="noreferrer">
            Download JSON
          </a>
          {data.source ? <span className="tag">Source: {data.source}</span> : null}
        </div>
      </header>

      <section className="panel">
        <div className="panel-row">
          <label className="field">
            <span>Search</span>
            <input
              type="search"
              placeholder="Name, department, title"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
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
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
              <option value="name">Faculty name</option>
              <option value="count">Publication count</option>
              <option value="latest">Most recent year</option>
            </select>
          </label>
          <div className="field">
            <span>Reset</span>
            <button type="button" className="clear-button" onClick={handleClearFilters}>
              Clear filters
            </button>
          </div>
        </div>
        {programFilters.length ? (
          <div className="active-filters">
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
              {openMember.filteredPublications.length} publications
            </span>
          </div>
        </div>
      ) : null}

      <section className="table-wrap">
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
            {filteredFaculty.map((member) => {
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
              const authorCounts = getAuthorCounts(member, member.filteredPublications);
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
                                className={`program-pill ${isActive ? 'is-active' : ''}`}
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
                              className={`spark-bar ${entry.count ? 'is-active' : ''}`}
                              style={{ height: `${(entry.count / sparkMax) * 100}%` }}
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
                                      <a href={pub.url} target="_blank" rel="noreferrer">
                                        {pub.id}
                                      </a>
                                    ) : (
                                      pub.id
                                    )}
                                  </div>
                                  <div className="pub-cell num pub-year">{pub.year ?? '—'}</div>
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
                                      <a href={pub.url} target="_blank" rel="noreferrer">
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

      {filteredFaculty.length === 0 ? (
        <section className="empty">
          <h2>No results found</h2>
          <p>Try adjusting the search term or widening the year range.</p>
        </section>
      ) : null}

      <footer className="footer">
        <p>
          Built for CTSI faculty reporting. Update the dataset in
          <span className="mono"> public/data/publications.json</span> to refresh the
          dashboard.
        </p>
      </footer>
    </main>
  );
}
