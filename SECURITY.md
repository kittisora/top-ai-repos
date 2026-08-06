# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security bug.**

Report it privately through GitHub Security Advisories:

**[Report a vulnerability →](https://github.com/kittisora/top-ai-repos/security/advisories/new)**

If that form is unavailable, email **kittisoras@gmail.com** with `SECURITY` in the
subject line.

Useful things to include, roughly in order of value:

- What an attacker gets — read data, write data, execute code, impersonate someone
- The steps to reproduce it, ideally against a local instance
- The affected file, route or commit
- Anything that limits it: does it need a logged-in user (there aren't any), a
  specific repo in the index, a particular browser?

You will get an acknowledgement within **72 hours** and an assessment within
**7 days**. This is a personal project maintained by one person, so a fix may take
longer than either — you will be told where it stands rather than left guessing.
Credit in the advisory unless you would rather stay anonymous.

## Supported versions

There is one supported version: **`main`, as deployed**. This is a continuously
deployed website, not a released library — there are no maintenance branches and
no backports. Fixes land on `main` and go out with the next deploy.

## Scope

**In scope**

- The deployed site and its API routes
- This codebase: the Next.js app, the ingestion pipeline, the database schema and
  migrations, the CLI scripts under `scripts/`
- The `/submit` endpoint, which is the only place an anonymous visitor can write

**Out of scope**

- **The ~24,500 indexed repositories.** This project catalogues public GitHub
  repos and shows their metadata and README. A vulnerability *in* an indexed
  project belongs to that project — report it to its maintainers. Likewise
  malicious or objectionable content in a README we render: tell us and we will
  delist it, but it is not a vulnerability in this software.
- Volumetric testing. The site runs on a single small VPS; load tests, stress
  tests and traffic floods are not accepted as findings and will just take the
  site down for everyone.
- Scanner output with no demonstrated impact — a missing header, a version
  banner, a cookie flag on a site that sets no cookies.
- Anything requiring physical access, a compromised developer machine, or social
  engineering of the maintainer.
- Vulnerabilities in third-party dependencies with no exploitable path in this
  codebase. Report those upstream; open a normal issue here if a version bump is
  needed.

## Please don't

- Run automated scanners, fuzzers or brute-force tooling against the live site
- Access, modify or delete data that is not yours
- Test against production when a local instance reproduces the bug — setup is in
  the [README](README.md) and takes a few minutes

## Known, intentional, and not a finding

Listed so you can skip them, and so nobody spends an evening writing up a
decision that was made on purpose:

- **There is no authentication.** The site is public and read-only. No accounts,
  no sessions, no identity cookies. "Missing access control" on a page that is
  meant to be world-readable is not a finding.
- **`?sslmode=no-verify` in the documented Supabase connection string.** Supabase's
  session pooler presents a certificate signed by its own CA, so `verify-full`
  fails with `SELF_SIGNED_CERT_IN_CHAIN`. The connection is still TLS-encrypted;
  only the CA check is skipped. This applies to the Supabase pooler specifically —
  a self-hosted Postgres should use `verify-full`.
- **Row-level security is enabled with no policies.** That is the point: RLS with
  zero policies is default-deny, which is what keeps Supabase's auto-generated
  REST API from exposing the tables. The app connects as a role that bypasses RLS.
- **`GITHUB_TOKEN` is documented as needing no scopes.** It only lifts the
  anonymous rate limit for public data. A leaked one grants public-data reads at
  5,000 requests/hour and nothing else — still worth rotating, but it is not a
  key to anything private.

## The part we actually want you to look at

README content is rendered by requesting `application/vnd.github.html+json` from
GitHub's API and injecting the result with `dangerouslySetInnerHTML`
([`src/lib/github/readme.ts`](src/lib/github/readme.ts),
[`src/components/readme-section.tsx`](src/components/readme-section.tsx)). We
rely on GitHub's sanitizer rather than running our own.

That is a deliberate trade — GitHub's sanitizer is the one protecting github.com
itself — but it is the sharpest trust boundary in the project, and it means
attacker-authored content reaches the DOM. **Squarely in scope:**

- A sanitizer bypass that survives into our page
- Any path that renders raw, unsanitized markdown or HTML instead
- Injection through the owner/repo path segments (there is a character guard in
  `readme.ts`; tell us if it is insufficient)
- Anything that turns a crafted README into script execution, credential theft,
  or navigation the visitor did not choose

## Secrets

`.env` is gitignored and must never be committed. If you believe a credential has
been exposed in the repository, its history, or a build artifact, report it
through the private channel above rather than opening an issue — an issue makes
it more discoverable, not less.
