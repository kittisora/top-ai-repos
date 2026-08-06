# VPS deployment

This directory installs a pull-based deployment on an Ubuntu VPS. Every two
minutes the server fetches public `origin/main`, checks the public GitHub Actions
API for a successful **push** run of `.github/workflows/ci.yml` at that exact
commit, and only then builds and activates it. Git uses public HTTPS; the server
needs no GitHub SSH key, deploy key, webhook, or repository secret.

Releases live at `/srv/top-ai-repos/releases/<40-character-sha>`. The deployer
builds as the unprivileged `topairepos-deploy` user, while the web process runs
under the separate `topairepos` account. It runs migrations and the idempotent
taxonomy seed, atomically changes `/srv/top-ai-repos/current`, restarts the app,
and checks `/api/health` with `/api/stats` as a compatibility fallback. A failed
health check restores the previous code symlink. Database migrations are not
reversed, so migrations merged to `main` must remain backward-compatible with
the immediately preceding release. The three newest releases are retained.

## 1. DNS and prerequisites

Point these records at the VPS before requesting certificates:

| Name | Type | Value |
| --- | --- | --- |
| `topairepos.com` | `A` | `62.238.43.103` |
| `www.topairepos.com` | `A` | `62.238.43.103` |
| `aireporank.com` | `A` | `62.238.43.103` |
| `www.aireporank.com` | `A` | `62.238.43.103` |
| `airepolist.com` | `A` | `62.238.43.103` |
| `www.airepolist.com` | `A` | `62.238.43.103` |

Cloudflare's proxied (orange-cloud) records are supported; the HTTP-01
challenge is forwarded through Cloudflare to nginx. After the origin
certificate is installed, set **SSL/TLS → Overview → Encryption mode** to
**Full (strict)**. Do not use Flexible mode. Cloudflare may publish edge AAAA
answers automatically even when the origin record is IPv4-only.

Open TCP ports 80 and 443. Install system-wide Node.js 22.6 or newer so both
`/usr/bin/node` and `/usr/bin/npm` exist, then install the remaining packages:

```bash
sudo apt update
sudo apt install -y git curl jq libarchive-tools nginx certbot python3-certbot-nginx
/usr/bin/node --version
/usr/bin/npm --version
```

On a small VPS, provision swap before enabling server-side builds. This host
uses a 2 GiB `/swapfile` managed by `deploy/swapfile.swap`.

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 0600 /swapfile
sudo mkswap /swapfile
```

## 2. Install the service

Run these commands from the repository checkout:

```bash
sudo useradd --system --user-group --home-dir /srv/top-ai-repos \
  --shell /usr/sbin/nologin topairepos
sudo useradd --system --user-group --home-dir /var/lib/topairepos-deploy \
  --shell /usr/sbin/nologin topairepos-deploy
sudo usermod --append --groups topairepos topairepos-deploy
sudo install -d -o root -g root -m 0755 /srv/top-ai-repos
sudo install -d -o root -g topairepos -m 0750 /srv/top-ai-repos/shared
sudo install -o root -g topairepos -m 0640 .env /srv/top-ai-repos/shared/.env

sudo install -o root -g root -m 0755 deploy/deploy.sh \
  /usr/local/sbin/top-ai-repos-deploy
sudo install -o root -g root -m 0644 deploy/top-ai-repos.service \
  /etc/systemd/system/top-ai-repos.service
sudo install -o root -g root -m 0644 deploy/top-ai-repos-deploy.service \
  /etc/systemd/system/top-ai-repos-deploy.service
sudo install -o root -g root -m 0644 deploy/top-ai-repos-deploy.timer \
  /etc/systemd/system/top-ai-repos-deploy.timer
sudo install -o root -g root -m 0644 deploy/swapfile.swap \
  /etc/systemd/system/swapfile.swap
sudo install -o root -g root -m 0644 deploy/nginx.conf \
  /etc/nginx/sites-available/top-ai-repos.conf
sudo ln -s /etc/nginx/sites-available/top-ai-repos.conf \
  /etc/nginx/sites-enabled/top-ai-repos.conf
sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl enable --now swapfile.swap
sudo systemctl enable top-ai-repos.service top-ai-repos-deploy.timer nginx
sudo systemctl restart nginx
sudo systemctl start top-ai-repos-deploy.service
sudo systemctl start top-ai-repos-deploy.timer
```

If either service account already exists, skip its `useradd`. Ensure the shared
`.env` has at least `DATABASE_URL`, `GITHUB_TOKEN`, and
`NEXT_PUBLIC_SITE_URL=https://topairepos.com`. The application token reads
public repository data; it is unrelated to deployment and is never used to pull
code or query the CI gate.

The first deploy may take several minutes. Check it with:

```bash
sudo systemctl status top-ai-repos.service top-ai-repos-deploy.timer
sudo journalctl -u top-ai-repos-deploy.service -u top-ai-repos.service -n 200
curl --fail http://127.0.0.1:3002/api/health || \
  curl --fail http://127.0.0.1:3002/api/stats
```

## 3. Enable HTTPS

After all six DNS records exist and HTTP reaches this VPS, let Certbot update
the installed nginx site and redirect HTTP to HTTPS:

```bash
sudo certbot --nginx --redirect \
  -d topairepos.com -d www.topairepos.com \
  -d aireporank.com -d www.aireporank.com \
  -d airepolist.com -d www.airepolist.com
sudo certbot renew --dry-run
```

With Cloudflare proxying enabled, switch each zone to **Full (strict)** after
the command succeeds, then verify both the public edge and the origin:

```bash
curl --fail --head https://topairepos.com
curl --fail --head --resolve topairepos.com:443:62.238.43.103 \
  https://topairepos.com
```

Do not reinstall `deploy/nginx.conf` over Certbot's managed copy afterward
without first preserving the generated TLS directives.

## 4. Scheduled jobs

Three timers run alongside `top-ai-repos-deploy.timer`. Each is a `oneshot`
service plus a timer, installed the same way as the deployer:

```bash
sudo install -m 0755 deploy/db-backup.sh   /usr/local/sbin/top-ai-repos-db-backup
sudo install -m 0755 deploy/source-sync.sh /usr/local/sbin/top-ai-repos-source-sync
sudo cp deploy/top-ai-repos-{db-backup,ingest,source-sync}.{service,timer} \
  /etc/systemd/system/
sudo install -d -o root -g root -m 0700 /var/backups/pg
sudo systemctl daemon-reload
sudo systemctl enable --now \
  top-ai-repos-db-backup.timer top-ai-repos-ingest.timer top-ai-repos-source-sync.timer
```

`/var/backups/pg` must exist **before** the backup unit first starts: it is
listed in `ReadWritePaths=`, and systemd builds that mount namespace before
`ExecStart` runs, so the script cannot create its own destination.

| Timer | Schedule | What it does |
| --- | --- | --- |
| `db-backup` | 04:30 UTC daily | `pg_dump -Fc` to `/var/backups/pg`, 7-day retention |
| `ingest` | 00:00 and 12:00 UTC | `npm run daily` from `/root/top-ai-repos` |
| `source-sync` | every 2 minutes | fast-forwards `/root/top-ai-repos` to `origin/main` |

### Backups

Each dump is a **complete** copy of the database, not an increment, so any one
of them restores everything:

```bash
sudo -u postgres createdb topairepos_restore
sudo -u postgres pg_restore --exit-on-error --single-transaction \
  --dbname=topairepos_restore < /var/backups/pg/topairepos-YYYY-MM-DD.dump
```

The script verifies every dump with `pg_restore --list` and fails if
`repository_metrics` is missing, because that table is the reason backups exist:
GitHub has no historical-stars API, so a lost star snapshot cannot be re-fetched
from anywhere. Everything else could be rebuilt with `npm run daily`.

These files still live on the same disk as the database they protect. Copying
them off-host is not yet configured, and until it is, this is not a real backup.

### Why source-sync exists

`deploy.sh` builds the website from its own bare clone into
`/srv/top-ai-repos/releases`; it never touches `/root/top-ai-repos`. But the
ingestion timer runs `npm run daily` from that checkout, so without this job the
site would serve new code while ingestion ran whatever was last pulled by hand.

It only ever fast-forwards. Uncommitted changes, a detached HEAD, a branch other
than `main`, or local commits not yet pushed all cause it to log and exit
without touching anything.
