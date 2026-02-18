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

export default function App() {
  const [data, setData] = useState({ updated: '', source: '', faculty: [] });
  const [status, setStatus] = useState('loading');
  const [query, setQuery] = useState('');
  const [yearMin, setYearMin] = useState('');
  const [yearMax, setYearMax] = useState('');
  const [sortBy, setSortBy] = useState('name');
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

  const handleClearFilters = () => {
    setQuery('');
    setSortBy('name');
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
        ...pubsInRange.map((pub) => `${pub.title} ${pub.journal}`)
      ]
        .filter(Boolean)
        .join(' ');

      const matchesQuery = needle
        ? normalize(searchableBits).includes(needle)
        : true;

      return {
        ...member,
        filteredPublications: pubsInRange,
        matchesQuery
      };
    });

    const filtered = facultyWithFilteredPubs.filter(
      (member) => member.filteredPublications.length > 0 && member.matchesQuery
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
  }, [data, query, sortBy, yearMin, yearMax]);

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
              <th className="num">Publications</th>
              <th className="num">Latest Year</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {filteredFaculty.map((member) => {
              const latestYear = Math.max(
                ...member.filteredPublications.map((pub) => pub.year)
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
                    <td>{member.programs?.length ? member.programs.join(', ') : '—'}</td>
                    <td className="num">{member.filteredPublications.length}</td>
                    <td className="num">{latestYear}</td>
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
                      <td colSpan={6}>
                        <div className="pub-table-wrap" id={`pub-list-${member.id}`}>
                          <div className="pub-table">
                            <div className="pub-grid pub-header">
                              <span className="pub-head pub-head-pmid">PMID</span>
                              <span className="pub-head pub-head-year">Year</span>
                              <span className="pub-head">Journal</span>
                              <span className="pub-head">Title</span>
                              <span className="pub-head pub-head-doi">DOI</span>
                            </div>
                            {member.filteredPublications.map((pub) => (
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
