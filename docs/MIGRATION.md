# Moving the database off Supabase onto your own VPS

Written against the live database on 2026-08-04. Baseline at that point:

```
server   : PostgreSQL 17.6
database : 203 MB on disk
role     : postgres (superuser=false, bypassrls=true)
pg_trgm  : present (1.6), installed in the `public` schema

repositories              24,525      repository_contributors   89,723
repository_metrics        73,291      discovery_shards             916
categories                    33      submissions                    2
repository_categories     42,159      sync_runs                    246
contributors              73,025      TOTAL                    303,920
```

Re-run `npm run db:info` to refresh those numbers before you start; they are what
you verify the restore against.

## Should you move?

For this project, on a VPS that already runs the web server: yes, fairly clearly.

| | Supabase free | Postgres on the same VPS |
| --- | --- | --- |
| Egress | Billed. Every row the app or the worker reads crosses the internet. | **Zero.** Unix socket / loopback. |
| Disk IO | A budget that can deplete, then throttle. | Your disk. |
| Size cap | 500 MB (at 203 MB, growing ~8 MB/month) | Your disk. |
| Query latency | Internet round trip, several per page render | Loopback — the single biggest win |
| Backups | Managed for you | **Yours. Non-negotiable — see below.** |
| Upgrades, patching, monitoring | Managed | Yours |

The latency point is the one that is easy to overlook. A page like `/repos` issues
several independent queries; every one currently pays a round trip across the
internet. On loopback that collapses to near zero, which shows up directly in
TTFB.

The real cost you are taking on is **backups**. `repository_metrics` holds 73,291
rows of star history that **cannot be rebuilt** — GitHub has no historical-stars
API, so a lost snapshot is lost permanently. On Supabase that risk was somebody
else's. After this move it is yours.

## What must survive

Do **not** migrate by running `npm run db:migrate && npm run seed && npm run daily`
against an empty database. That produces a working site with **no history**: every
"+N today" and "+N this week" would be blank, the trend scores would all be zero,
and the 90-day charts would be empty. It is not recoverable afterwards.

The migration has to be a dump and restore.

## 0. Before you start

Two things to check:

- **Your Supabase egress is already at ~5.09/5 GB.** The dump reads every row, so
  it will add roughly the size of the data (call it 150–200 MB) on top of that. It
  is a one-off, and it is the last egress you will ever pay them — but if the
  project has been restricted for overage, check when your billing cycle resets
  before relying on being able to read it.
- **`pg_dump` must be version 17 or newer**, because the server is 17.6. An older
  client refuses to dump a newer server. Check with `pg_dump --version`.

## 1. Baseline the old database

```bash
npm run db:info          # against the Supabase DATABASE_URL
```

Keep the output. You will diff the new database against it in step 5.

## 2. Dump — do this **on the VPS**, not through your laptop

The destination is the VPS, so dumping there is one transfer instead of two
(down to Windows, then back up again). Install a PG 17 client and dump:

```bash
# Debian/Ubuntu — pull in the PGDG repo so you get 17, not the distro default
sudo apt install -y postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh
sudo apt install -y postgresql-17 postgresql-contrib-17

# Dump. SUPABASE_URL is the connection string currently in your .env
pg_dump "$SUPABASE_URL" \
  --schema=public \
  --schema=drizzle \
  --no-owner \
  --no-privileges \
  --file=topairepos-$(date -u +%Y%m%d).sql
```

Every flag there matters:

- `--schema=public` — the nine application tables. **Without this you would also
  dump Supabase's own `auth` (23 tables), `storage` (8), `realtime` (2) and
  `vault` schemas**, which reference Supabase-specific roles and extensions and
  will fail noisily on a plain Postgres.
- `--schema=drizzle` — easy to miss and it breaks things quietly. This schema
  holds drizzle's `__drizzle_migrations` journal. Leave it out and the new
  database looks un-migrated, so the next `npm run db:migrate` tries to re-run
  every migration from `0000_init.sql` and fails on tables that already exist.
- `--no-owner` / `--no-privileges` — strips `OWNER TO supabase_admin` and grants
  to `anon` / `authenticated` / `service_role`, none of which exist on your VPS.

`pg_trgm` is installed in `public` here (Supabase often puts extensions in an
`extensions` schema — yours is not), so `--schema=public` carries it. That is why
`postgresql-contrib` is in the install line: without it `CREATE EXTENSION pg_trgm`
fails and the trigram index cannot be built.

Want a compressed dump instead? Swap `--file=…sql` for
`--format=custom --file=…dump` and restore with `pg_restore` — much smaller on
disk and restorable in parallel. It does **not** reduce Supabase egress; the wire
transfer is the same either way, compression happens client-side.

## 3. Create the database and restore

```bash
sudo -u postgres createdb topairepos
sudo -u postgres psql -d topairepos -v ON_ERROR_STOP=1 -f topairepos-YYYYMMDD.sql
```

`ON_ERROR_STOP=1` is not optional. Without it psql prints errors, keeps going and
exits 0 — a half-restored database that looks like a success.

Expect this to take a few minutes and to be CPU-bound at the end. `search_vector`
is a `GENERATED ALWAYS AS … STORED` column, so its data is *not* in the dump:
Postgres recomputes 24,525 tsvectors on insert and then builds the GIN index over
them, plus the trigram index on `full_name`.

## 4. ANALYZE — do not skip this

```bash
sudo -u postgres psql -d topairepos -c 'VACUUM ANALYZE'
```

`pg_dump` does not carry planner statistics (PG 17 has no option for it). A
freshly restored database has none, so the planner guesses, and it will guess
wrong on exactly the queries this app depends on — the sorted/filtered index scans
behind `/repos`. Skip this and the site will feel slower than Supabase did, which
looks like the migration failed when it only needs one command.

## 5. Verify against the baseline

Point `DATABASE_URL` at the new database and re-run:

```bash
npm run db:info
```

**Every row count must match step 1 exactly.** That is the only check that proves
the data actually arrived — a restore can report success and still have skipped a
table. Also confirm `pg_trgm` shows `present`.

## 6. Switch the connection string

```diff
- DATABASE_URL=postgresql://postgres.xxxx:pw@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=no-verify
+ DATABASE_URL=postgresql://postgres:pw@localhost:5432/topairepos
```

Drop `?sslmode=no-verify` — it existed only because Supabase's pooler presents a
certificate signed by its own CA. On loopback there is no TLS to verify and no
network to intercept. `src/db/index.ts` configures SSL purely from the connection
string, so removing the parameter is the whole change; no code edit is needed.

Then `npm run build && npm run typecheck`, restart the app, and load `/` and
`/repos`.

### The RLS trap

`drizzle/0001_enable_rls.sql` enables row-level security on all nine tables **with
no policies**, which is default-deny. It exists because Supabase exposes public
tables through PostgREST with an anon key — a threat that does not exist on your
VPS, but the setting comes across in the dump anyway.

It is harmless *as long as the app connects as a role that bypasses RLS*. On
Supabase that was `postgres` (`bypassrls=true`, per the baseline above). On a
self-hosted install `postgres` is a full superuser, so connecting as `postgres`
behaves identically and you need do nothing.

But if you create a dedicated least-privilege role — good practice — it will
**silently return zero rows from every table**, with no error. The site will
render as though the index were empty. Pick one:

```sql
-- Option A: let the app role bypass RLS (closest to today's behaviour)
ALTER ROLE ailist_app BYPASSRLS;

-- Option B: drop RLS, since the reason for it is gone on a private VPS.
-- Note that a future `npm run db:migrate` on a FRESH database re-applies 0001.
ALTER TABLE repositories DISABLE ROW LEVEL SECURITY;
-- … and the other eight tables.
```

`npm run db:info` prints each table's RLS state and policy count, and warns if the
connected role lacks `BYPASSRLS` — that is what it is for.

## 7. Backups — the part you are now responsible for

`repository_metrics` cannot be reconstructed. Set this up the same day you cut
over, not later:

```bash
# crontab -e   (as root, or a user that can read the cluster)
30 4 * * * pg_dump -U postgres -Fc topairepos -f /var/backups/pg/topairepos-$(date +\%F).dump && find /var/backups/pg -name 'topairepos-*.dump' -mtime +14 -delete
```

Then get those files **off the VPS** — object storage, another host, anywhere that
does not die with the machine. A backup that only exists on the server it is
backing up is not a backup. Restore-test it once so you know the command works
before you need it at 3am.

## 8. Keep Supabase for a week

Don't delete the project immediately. Leave it untouched as a rollback (switching
back is one `DATABASE_URL` edit) until you have seen a couple of successful
`npm run daily` runs and a day of real traffic on the new database.

## Also worth doing while you are in here

- **Do not expose Postgres to the internet.** The app is on the same host, so keep
  `listen_addresses = 'localhost'` in `postgresql.conf` and let the firewall drop
  5432 from outside. There is no reason for this port to be reachable.
- **Basic tuning.** Stock Postgres ships deliberately conservative settings. On a
  VPS with N GB of RAM, `shared_buffers ≈ N/4`, `effective_cache_size ≈ 3N/4`, and
  raise `maintenance_work_mem` before the next `db:vacuum`. Worth 10 minutes.
- **The vacuum you were told to defer.** With no Disk IO budget to exhaust, the
  `db:vacuum` pass that was risky on Supabase is now just a local disk operation.
  A restored database starts with no bloat at all, though, so there is nothing to
  reclaim on day one — the change-only writes shipped in `4e8296c` are what keep
  it that way.
