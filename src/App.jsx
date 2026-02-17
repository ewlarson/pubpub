import { useEffect, useMemo, useState } from 'react';

const DATA_URL = `${import.meta.env.BASE_URL}data/publications.json`;

const normalize = (value) => value.toLowerCase();

export default function App() {
  const [data, setData] = useState({ updated: '', source: '', faculty: [] });
  const [status, setStatus] = useState('loading');
  const [query, setQuery] = useState('');
  const [yearMin, setYearMin] = useState('');
  const [yearMax, setYearMax] = useState('');
  const [sortBy, setSortBy] = useState('name');

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

  const totalPublications = useMemo(() => {
    return filteredFaculty.reduce(
      (sum, member) => sum + member.filteredPublications.length,
      0
    );
  }, [filteredFaculty]);

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
        </div>
      </section>

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

              return (
                <tr key={member.id}>
                  <td>
                    <div className="name">{member.name}</div>
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
                    <details className="pub-details">
                      <summary>View list</summary>
                      <ul className="pub-list">
                        {member.filteredPublications.map((pub) => (
                          <li key={pub.id}>
                            <div className="pub-title">
                              {pub.url ? (
                                <a href={pub.url} target="_blank" rel="noreferrer">
                                  {pub.title}
                                </a>
                              ) : (
                                pub.title
                              )}
                            </div>
                            <div className="pub-meta">
                              <span>{pub.journal}</span>
                              <span className="dot" />
                              <span>{pub.year}</span>
                              {pub.doi ? (
                                <>
                                  <span className="dot" />
                                  <a
                                    href={`https://doi.org/${pub.doi}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mono"
                                  >
                                    DOI {pub.doi}
                                  </a>
                                </>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </td>
                </tr>
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
