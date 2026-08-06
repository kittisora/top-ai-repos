# Contributing

Thanks for taking a look. This is a small, opinionated project — a ranked index of
open-source AI repositories — and contributions are welcome.

By contributing you agree that your work is licensed under the
[Apache License 2.0](LICENSE), the same licence as the project. There is no CLA.

## Getting set up

Full instructions are in the [README](README.md#setup). The short version:

```bash
npm install
cp .env.example .env      # fill in DATABASE_URL and GITHUB_TOKEN
npm run db:migrate        # create the schema
npm run seed              # load the category taxonomy
npm run dev               # http://localhost:3000
```

You need **Node 22.6+** and a **Postgres 17** you can write to. A free Supabase or
Neon database is fine. `GITHUB_TOKEN` needs **no scopes** — it only raises the API
rate limit from 60 to 5,000 requests/hour.

You do *not* need a full ingest to work on the site. `npm run daily` takes a long
while and makes thousands of API calls; for UI work, `npm run add -- owner/name`
pulls in a handful of repos in seconds.

## Before you open a pull request

```bash
npm run typecheck      # must pass
npm test               # must pass — 76 tests, ~350ms
npm run build          # must pass
```

**`npm run lint` is currently broken, and it is not your fault.**
`eslint-config-next` bundles a copy of `eslint-plugin-react` that is incompatible
with ESLint 10; it dies with `contextOrFilename.getFilename is not a function`
while loading `react/display-name`, before it reads a single source file. It is a
dependency problem, not a code problem — don't try to fix your PR around it. A
patch that resolves it properly is very welcome as its own change.

## Where help is most useful

- **Category taxonomy.** `src/lib/taxonomy.ts` is a rule-based classifier. Repos
  that land in the wrong category, or in none, are the most common real defect.
  Rule confidence and matched evidence are stored per assignment, so a
  mis-categorisation is debuggable — include the repo name in your issue.
- **`src/lib/geo.ts`.** Free-text location → country. It deliberately returns
  nothing for "Remote", "/dev/null" or "Mars"; a wrong country is worse than a
  missing one. New patterns should come with tests.
- **Accessibility and Core Web Vitals.** Both are actively tracked.
- **Scoring.** `src/lib/scoring.ts` encodes opinions about what makes a repository
  worth adopting. Disagreeing with those opinions is a legitimate issue to open —
  bring reasoning, ideally with example repos the current model gets wrong.

## How the code is organised

`taxonomy.ts`, `scoring.ts`, `geo.ts` and `filter-items.ts` are pure and
dependency-free on purpose: they hold the product's opinions, so they must be
readable and testable without a database. **That is where the tests are.** If you
are adding logic that could live in one of these, put it there.

Everything else is laid out in the [README](README.md#project-layout).

## Conventions

**Comments explain *why*, not *what*.** This codebase leans on comments more than
most, and they earn their place by recording the reasoning that is not visible in
the code — a constraint of the GitHub API, a Postgres behaviour, a decision that
looks wrong until you know what it prevents. A comment restating the line below it
will be asked about in review.

**Numbers are tabular.** Use the `num` class anywhere digits are stacked in a
column, so they line up down the page.

**Commit messages follow Conventional Commits**, matching the existing history:

```
feat(header): replace star icon with GitHub logo
fix(a11y): make the definition lists valid, and name the language links
perf(db): stop rewriting unchanged rows in the daily pipeline
```

Branch off `main`, open a PR, and describe what you verified rather than only what
you changed.

## Tests

```bash
npm test                                    # everything
node --test src/lib/scoring.test.ts         # one file
```

Tests are `src/**/*.test.ts`, using the built-in `node --test` runner — no Jest,
no Vitest. Note that the suite runs with `--experimental-test-isolation=none`, so
**all test files share one process**: module-level state persists across files. If
your module memoises or caches anything, reset it in the test rather than assuming
a fresh module.

## Changing the database schema

```bash
# 1. edit src/db/schema.ts
npm run db:generate      # 2. writes a new SQL file into drizzle/
npm run db:migrate       # 3. apply it locally
```

Commit the generated SQL. **Never hand-edit a migration that has already been
applied anywhere** — write a new one. Migrations also enable row-level security on
new tables; keep that, it is what stops Supabase's auto-generated REST API from
exposing the data (see the [README](README.md#setup)).

## Working on the ingestion pipeline

`src/lib/ingest/` is the part most likely to bite you. Four things are load-bearing
and not obvious:

1. **`import 'dotenv/config'` must be the first import in any `scripts/` entry
   file.** ESM evaluates imports in source order, and `@/db` reads `DATABASE_URL`
   at module-evaluation time. Import anything else first and the script dies with
   "Missing required environment variable DATABASE_URL" before its first line runs.

2. **Never add an unconditional full-table `UPDATE`.** Postgres has no in-place
   update: rewriting a row that did not change still writes a new tuple and, if it
   is not a HOT update, touches *every* index on the table. Two stages used to
   rewrite ~30,000 rows daily so that ~4% could change, which is what put the
   database into Disk IO exhaustion. Every bulk write in this pipeline carries a
   change filter — keep it that way, and use `is distinct from` rather than `<>`
   for nullable columns.

3. **`classify` and `discover` are a pair.** `classify` only reconsiders a repo
   whose `classified_at` is null or older than its last sync; `discover` is what
   resets `classified_at` to null when a description, topic list or language
   actually changes. Change one side without the other and repos silently stop
   being reclassified.

4. **`snapshot` data cannot be rebuilt.** It records one row per repo per day and
   a missed day is gone forever — which is why it runs third in the daily job
   rather than last, ahead of the stages that can sit in a rate-limit pause. Do
   not move it later.

Every stage records a row in `sync_runs` with its stats, or its error if it
failed. That table is the first place to look when a scheduled run misbehaves.

## Reporting bugs

Open an issue with what you expected, what happened, and — for data problems — the
repository or category involved, since almost everything here is reproducible from
a repo name.

For anything security-related, **do not open an issue**. See
[SECURITY.md](SECURITY.md).
