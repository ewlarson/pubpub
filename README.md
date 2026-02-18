# pubpub

Static publication dashboard for University of Minnesota CTSI faculty members. Built with React + Vite and deployed to GitHub Pages.

## Quickstart

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## Data

Publication data lives in `public/data/publications.json` and is loaded at runtime. Update that file, commit, and the GitHub Pages workflow will rebuild and deploy.

### Building data from PubMed

There is a Node script that reads `data/CTSI Faculty - Sheet1.csv`, queries PubMed E-utilities, and writes `public/data/publications.json`:

```bash
NCBI_EMAIL="you@umn.edu" NCBI_TOOL="ctsi_pubpub" NCBI_API_KEY="..." PUB_YEAR_START=2025 PUB_YEAR_END=2025 npm run build:data
```

You can also put secrets in `.env.local` (already gitignored):

```bash
NCBI_EMAIL=you@umn.edu
NCBI_TOOL=ctsi_pubpub
NCBI_API_KEY=your_pubmed_key
PUB_YEAR_START=2025
PUB_YEAR_END=2025
PUB_VALIDATE_AFFILIATION=true
PUB_USE_INITIALS=true
```

Notes:
- If `PUB_YEAR_START` is not provided, the script uses each faculty member's `start date` from the CSV.
- By default, the script queries through today's date (not just the end of the calendar year).
- `PUB_VALIDATE_AFFILIATION` (default `true`) filters results so the matched author has an affiliation that includes the allowed terms (e.g., University of Minnesota).
- `PUB_USE_INITIALS` (default `true`) includes initial-based author matches when no ORCID is available.
- `PUBPUB_DB_PATH` (default `data/pubpub.sqlite`) sets the SQLite database location.
- When `start date` is used, month/day are respected; if PubMed only provides a month/year, the script treats it as the first of that month.

### SQLite persistence + curation

Harvested publications and curator feedback now live in SQLite so they persist
between crawls. The build script writes to `data/pubpub.sqlite` by default; set
`PUBPUB_DB_PATH` to override.

Tables (created automatically):
- `publications` (metadata keyed by PMID)
- `faculty_publications` (join table with first/last seen timestamps)
- `curation` (true/false positive labels)
- `faculty_publication_coauthors` (co-author names per faculty/PMID)

To mark false/true positives, insert rows into `curation`:

```bash
sqlite3 data/pubpub.sqlite \
  "INSERT INTO curation (faculty_id, pmid, verdict, updated_at) \
   VALUES ('haynes-david', '41373131', 'false_positive', datetime('now')) \
   ON CONFLICT(faculty_id, pmid) DO UPDATE SET \
     verdict=excluded.verdict, updated_at=excluded.updated_at;"
```

The build step will:
- exclude `false_positive` PMIDs
- allow `true_positive` PMIDs to override affiliation filters
- emit per-faculty signal summaries (`signals`) into `public/data/publications.json`

If `data/curation.json` exists and the database has no curation rows yet, it is
used once as a seed (legacy import).

Minimal schema:

```json
{
  "updated": "YYYY-MM-DD",
  "source": "optional string",
  "faculty": [
    {
      "id": "unique-id",
      "name": "Full Name, Credentials",
      "department": "Department or Institute",
      "areas": ["Research area"],
      "orcid": "0000-0000-0000-0000",
      "publications": [
        {
          "id": "unique-id",
          "title": "Publication title",
          "journal": "Journal name",
          "year": 2026,
          "doi": "10.xxxx/xxxx",
          "url": "https://..."
        }
      ]
    }
  ]
}
```

## Deploying to GitHub Pages

This repo includes `.github/workflows/deploy.yml` for GitHub Pages.

1. In GitHub, go to **Settings → Pages**.
2. Under **Build and deployment**, select **GitHub Actions**.
3. Push to `main` and the workflow will publish the site.

## Notes

- The Vite `base` option is set to `./` to keep asset paths relative for GitHub Pages.
- Update the UI in `src/App.jsx` and styles in `src/styles.css`.
- Deep link to a faculty member with `?faculty=serena-xiong` or `?faculty=Serena%20Xiong` in the URL.
