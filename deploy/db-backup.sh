#!/usr/bin/env bash
# Nightly backup of the self-hosted Top AI Repos database.
#
# Why this matters more than a normal backup: public.repository_metrics holds the
# star-history snapshots, and GitHub has no historical-stars API. A lost snapshot
# is lost permanently — it cannot be re-ingested. Everything else in the database
# could, in principle, be rebuilt from GitHub; that table could not.
#
# Deliberately dumps the WHOLE database rather than using --schema filters:
# pg_dump omits CREATE EXTENSION whenever a --schema filter is present, which is
# exactly what made the original Supabase dump unrestorable without hand-fixing
# pg_trgm first. An unfiltered dump restores cleanly into an empty database.
set -Eeuo pipefail

readonly DB=topairepos
readonly DEST=/var/backups/pg
readonly KEEP_DAYS=7
readonly PGBIN=/usr/lib/postgresql/17/bin

umask 077
install -d -o root -g root -m 0700 "$DEST"

stamp=$(date -u +%F)
out="${DEST}/${DB}-${stamp}.dump"
tmp="${out}.partial"

# Custom format: compressed, and restorable selectively with pg_restore.
# Run as the postgres superuser over the Unix socket, so no password is needed
# and no credential appears in argv or the environment.
#
# No --file: pg_dump writes the archive to the stdout it already inherited. With
# --file=/dev/stdout it would instead try to *reopen* the redirect target, which
# the dropped-to-postgres process has no permission to do (the file is root-owned
# 0600 under umask 077).
sudo -u postgres "$PGBIN/pg_dump" --format=custom --compress=9 \
  --dbname="$DB" > "$tmp"

# A dump that cannot be listed cannot be restored. Verifying here is what turns
# "a file exists" into "a backup exists".
if ! "$PGBIN/pg_restore" --list "$tmp" > /dev/null 2>&1; then
  rm -f "$tmp"
  echo "backup verification FAILED: ${tmp} is not a readable pg_dump archive" >&2
  exit 1
fi

# Sanity-check that the irreplaceable table is actually in there.
if ! "$PGBIN/pg_restore" --list "$tmp" | grep -q 'repository_metrics'; then
  rm -f "$tmp"
  echo 'backup verification FAILED: repository_metrics missing from archive' >&2
  exit 1
fi

mv -f "$tmp" "$out"
echo "wrote ${out} ($(du -h "$out" | cut -f1))"

# Prune old dumps only after a successful new one.
deleted=$(find "$DEST" -maxdepth 1 -name "${DB}-*.dump" -mtime "+${KEEP_DAYS}" -print -delete | wc -l)
echo "pruned ${deleted} dump(s) older than ${KEEP_DAYS} days"
echo "on-disk backup set: $(find "$DEST" -maxdepth 1 -name "${DB}-*.dump" | wc -l) file(s), $(du -sh "$DEST" | cut -f1)"

# NOTE: these files live on the same disk as the database they protect. A backup
# that dies with the machine is not a backup. Copy them off-host (object storage,
# another server) — that step is not yet configured.
