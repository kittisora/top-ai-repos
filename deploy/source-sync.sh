#!/usr/bin/env bash
# Keep the VPS working copy at /root/top-ai-repos in step with origin/main.
#
# This is NOT what deploys the website — deploy.sh does that, from its own bare
# clone, into /srv/top-ai-repos/releases. This keeps the *checkout you type
# commands in* current, which matters for two reasons:
#
#   1. top-ai-repos-ingest.service runs `npm run daily` from this directory. A
#      stale checkout means the site serves new code while ingestion runs old
#      code — the kind of split that produces bugs nobody can reproduce.
#   2. `npm run db:info`, `db:migrate` and the other manual tools are run from
#      here, and should not be a fortnight behind main.
#
# Refuses rather than destroys. Uncommitted work, a detached HEAD, a branch that
# is not main, or local commits that main does not have are all left strictly
# alone: this job fast-forwards or it does nothing.
set -Eeuo pipefail

readonly REPO=/root/top-ai-repos
readonly BRANCH=main

cd "$REPO"

# Never swap code out from under a running ingestion.
if systemctl is-active --quiet top-ai-repos-ingest.service; then
  echo 'ingestion is running; leaving the checkout alone'
  exit 0
fi

git fetch --quiet --prune origin "$BRANCH"

local_sha=$(git rev-parse HEAD)
remote_sha=$(git rev-parse "origin/${BRANCH}")
if [[ "$local_sha" == "$remote_sha" ]]; then
  exit 0   # already current; stay quiet so the journal is not spammed
fi

branch=$(git symbolic-ref --quiet --short HEAD || echo '(detached)')
if [[ "$branch" != "$BRANCH" ]]; then
  echo "on ${branch}, not ${BRANCH}; not touching it"
  exit 0
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo 'working tree has uncommitted changes; not updating'
  exit 0
fi

# Local commits that main does not have. Fast-forwarding is impossible and
# merging or rebasing automatically would be a bad surprise, so stop.
ahead=$(git rev-list --count "origin/${BRANCH}..HEAD")
if [[ "$ahead" -gt 0 ]]; then
  echo "local ${BRANCH} is ${ahead} commit(s) ahead of origin; push or reset by hand"
  exit 0
fi

lock_before=$(git rev-parse "HEAD:package-lock.json" 2>/dev/null || echo none)
git merge --ff-only --quiet "origin/${BRANCH}"
lock_after=$(git rev-parse "HEAD:package-lock.json" 2>/dev/null || echo none)

echo "updated ${local_sha:0:7} -> ${remote_sha:0:7}"

# Dependencies must match the code that is now checked out, or the next
# ingestion run imports whatever the previous commit happened to install.
if [[ "$lock_before" != "$lock_after" ]]; then
  echo 'package-lock.json changed; reinstalling dependencies'
  npm ci --no-audit --no-fund
fi
