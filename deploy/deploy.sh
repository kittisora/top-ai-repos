#!/usr/bin/bash

set -Eeuo pipefail
IFS=$'\n\t'
umask 027

# This script is installed as /usr/local/sbin/top-ai-repos-deploy and run as
# root by top-ai-repos-deploy.service. Application commands always run as the
# unprivileged application account.
readonly APP_USER='topairepos'
readonly APP_GROUP='topairepos'
readonly BUILD_USER='topairepos-deploy'
readonly BUILD_GROUP='topairepos-deploy'
readonly APP_ROOT='/srv/top-ai-repos'
readonly RELEASES_DIR="${APP_ROOT}/releases"
readonly SHARED_DIR="${APP_ROOT}/shared"
readonly CACHE_DIR="${APP_ROOT}/cache"
readonly NPM_CACHE_DIR="${CACHE_DIR}/npm"
readonly REPOSITORY_DIR="${CACHE_DIR}/repository.git"
readonly ENV_FILE="${SHARED_DIR}/.env"
readonly CURRENT_LINK="${APP_ROOT}/current"
readonly NEXT_LINK="${APP_ROOT}/.current.next"
readonly LOCK_DIR='/run/top-ai-repos-deploy'
readonly LOCK_FILE="${LOCK_DIR}/deploy.lock"
readonly REPOSITORY_URL='https://github.com/kittisora/top-ai-repos.git'
readonly ACTIONS_API='https://api.github.com/repos/kittisora/top-ai-repos/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=20'
readonly APP_SERVICE='top-ai-repos.service'
readonly HEALTH_URL='http://127.0.0.1:3002/api/health'
readonly FALLBACK_HEALTH_URL='http://127.0.0.1:3002/api/stats'
readonly KEEP_RELEASES=3

readonly GIT_BIN='/usr/bin/git'
readonly CURL_BIN='/usr/bin/curl'
readonly JQ_BIN='/usr/bin/jq'
readonly HEAD_BIN='/usr/bin/head'
readonly NPM_BIN='/usr/bin/npm'
readonly BSDTAR_BIN='/usr/bin/bsdtar'
readonly BASH_BIN='/usr/bin/bash'
readonly SETPRIV_BIN='/usr/bin/setpriv'
readonly SYSTEMCTL_BIN='/usr/bin/systemctl'

export PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

log() {
  printf '[%(%Y-%m-%dT%H:%M:%SZ)T] %s\n' -1 "$*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

require_root() {
  [[ ${EUID} -eq 0 ]] || die 'this deployer must run as root'
}

require_executable() {
  [[ -x "$1" ]] || die "required executable is missing: $1"
}

is_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]]
}

guard_release_path() {
  local path="$1"
  [[ "$path" =~ ^/srv/top-ai-repos/releases/[0-9a-f]{40}$ ]] ||
    die "refusing unsafe release path: ${path}"
  [[ "$(dirname -- "$path")" == "$RELEASES_DIR" ]] ||
    die "release is outside ${RELEASES_DIR}: ${path}"
}

ensure_layout() {
  [[ "$APP_ROOT" == '/srv/top-ai-repos' ]] || die 'unexpected application root'
  [[ "$RELEASES_DIR" == '/srv/top-ai-repos/releases' ]] || die 'unexpected releases path'
  [[ "$SHARED_DIR" == '/srv/top-ai-repos/shared' ]] || die 'unexpected shared path'
  [[ "$CACHE_DIR" == '/srv/top-ai-repos/cache' ]] || die 'unexpected cache path'
  [[ "$CURRENT_LINK" == '/srv/top-ai-repos/current' ]] || die 'unexpected current link path'
  [[ "$NEXT_LINK" == '/srv/top-ai-repos/.current.next' ]] || die 'unexpected staging link path'

  getent passwd "$APP_USER" >/dev/null || die "user ${APP_USER} does not exist"
  getent group "$APP_GROUP" >/dev/null || die "group ${APP_GROUP} does not exist"
  getent passwd "$BUILD_USER" >/dev/null || die "user ${BUILD_USER} does not exist"
  getent group "$BUILD_GROUP" >/dev/null || die "group ${BUILD_GROUP} does not exist"
  id -nG "$BUILD_USER" | tr ' ' '\n' | grep -Fxq "$APP_GROUP" ||
    die "${BUILD_USER} must be a member of ${APP_GROUP}"

  [[ ! -L "$APP_ROOT" ]] || die "${APP_ROOT} must not be a symbolic link"
  install -d -o root -g root -m 0755 "$APP_ROOT"
  [[ "$(realpath -e -- "$APP_ROOT")" == "$APP_ROOT" ]] || die 'application root is not canonical'

  [[ ! -L "$RELEASES_DIR" ]] || die "${RELEASES_DIR} must not be a symbolic link"
  [[ ! -L "$SHARED_DIR" ]] || die "${SHARED_DIR} must not be a symbolic link"
  [[ ! -L "$CACHE_DIR" ]] || die "${CACHE_DIR} must not be a symbolic link"
  [[ ! -L "$NPM_CACHE_DIR" ]] || die "${NPM_CACHE_DIR} must not be a symbolic link"
  install -d -o root -g "$APP_GROUP" -m 0750 "$RELEASES_DIR"
  install -d -o root -g "$APP_GROUP" -m 0750 "$SHARED_DIR"
  install -d -o "$BUILD_USER" -g "$BUILD_GROUP" -m 0700 "$CACHE_DIR"
  install -d -o "$BUILD_USER" -g "$BUILD_GROUP" -m 0700 "$NPM_CACHE_DIR"
  [[ "$(realpath -e -- "$RELEASES_DIR")" == "$RELEASES_DIR" ]] || die 'releases directory is not canonical'
  [[ "$(realpath -e -- "$SHARED_DIR")" == "$SHARED_DIR" ]] || die 'shared directory is not canonical'
  [[ "$(realpath -e -- "$CACHE_DIR")" == "$CACHE_DIR" ]] || die 'cache directory is not canonical'
  [[ "$(realpath -e -- "$NPM_CACHE_DIR")" == "$NPM_CACHE_DIR" ]] || die 'npm cache directory is not canonical'

  [[ ! -L "$ENV_FILE" ]] || die "${ENV_FILE} must be a regular file, not a symlink"
  [[ -f "$ENV_FILE" ]] || die "missing ${ENV_FILE}; create it before the first deploy"
  chown root:"$APP_GROUP" "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
  "$SETPRIV_BIN" --reuid="$APP_USER" --regid="$APP_GROUP" --init-groups \
    "$HEAD_BIN" --bytes=0 "$ENV_FILE" ||
    die "${APP_USER} cannot read ${ENV_FILE}"
  "$SETPRIV_BIN" --reuid="$BUILD_USER" --regid="$BUILD_GROUP" --init-groups \
    "$HEAD_BIN" --bytes=0 "$ENV_FILE" ||
    die "${BUILD_USER} cannot read ${ENV_FILE}"

  if [[ -e "$CURRENT_LINK" && ! -L "$CURRENT_LINK" ]]; then
    die "${CURRENT_LINK} exists and is not a symbolic link"
  fi
}

acquire_lock() {
  [[ "$LOCK_DIR" == '/run/top-ai-repos-deploy' ]] || die 'unexpected lock directory'
  [[ "$LOCK_FILE" == '/run/top-ai-repos-deploy/deploy.lock' ]] || die 'unexpected lock path'
  [[ ! -L "$LOCK_DIR" ]] || die "${LOCK_DIR} must not be a symbolic link"
  install -d -o root -g root -m 0755 "$LOCK_DIR"
  [[ "$(realpath -e -- "$LOCK_DIR")" == "$LOCK_DIR" ]] || die 'lock directory is not canonical'

  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    log 'another deployment is already running; exiting'
    exit 0
  fi
}

run_as_builder() {
  "$SETPRIV_BIN" --reuid="$BUILD_USER" --regid="$BUILD_GROUP" --init-groups \
    env -i \
      HOME="$CACHE_DIR" \
      USER="$BUILD_USER" \
      LOGNAME="$BUILD_USER" \
      PATH='/usr/local/bin:/usr/bin:/bin' \
      CI='true' \
      npm_config_cache="$NPM_CACHE_DIR" \
      npm_config_update_notifier='false' \
      NEXT_TELEMETRY_DISABLED='1' \
      NODE_OPTIONS='--max-old-space-size=2048' \
      "$@"
}

ensure_repository() {
  [[ ! -L "$REPOSITORY_DIR" ]] || die "${REPOSITORY_DIR} must not be a symbolic link"
  install -d -o "$BUILD_USER" -g "$BUILD_GROUP" -m 0700 "$REPOSITORY_DIR"
  [[ "$(realpath -e -- "$REPOSITORY_DIR")" == "$REPOSITORY_DIR" ]] ||
    die 'repository cache is not canonical'

  if [[ ! -f "${REPOSITORY_DIR}/HEAD" ]]; then
    if find "$REPOSITORY_DIR" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
      die "${REPOSITORY_DIR} is non-empty but is not a bare Git repository"
    fi
    log 'initializing the public Git repository cache'
    run_as_builder "$GIT_BIN" init --bare "$REPOSITORY_DIR"
    run_as_builder "$GIT_BIN" --git-dir="$REPOSITORY_DIR" remote add origin "$REPOSITORY_URL"
  fi

  [[ "$(run_as_builder "$GIT_BIN" --git-dir="$REPOSITORY_DIR" rev-parse --is-bare-repository)" == 'true' ]] ||
    die "${REPOSITORY_DIR} is not a bare Git repository"

  local remote_url
  remote_url="$(run_as_builder "$GIT_BIN" --git-dir="$REPOSITORY_DIR" remote get-url origin)"
  [[ "$remote_url" == "$REPOSITORY_URL" ]] ||
    die "unexpected origin URL in repository cache: ${remote_url}"
}

fetch_main_sha() {
  run_as_builder "$GIT_BIN" \
    --git-dir="$REPOSITORY_DIR" \
    fetch --quiet --no-tags --prune origin \
    '+refs/heads/main:refs/remotes/origin/main'

  local sha
  sha="$(run_as_builder "$GIT_BIN" --git-dir="$REPOSITORY_DIR" rev-parse --verify 'refs/remotes/origin/main^{commit}')"
  is_sha "$sha" || die "origin/main resolved to an invalid commit: ${sha}"
  printf '%s\n' "$sha"
}

current_release() {
  if [[ ! -L "$CURRENT_LINK" ]]; then
    printf '\n'
    return 0
  fi

  local target
  target="$(readlink -f -- "$CURRENT_LINK")" || die "${CURRENT_LINK} is dangling"
  guard_release_path "$target"
  [[ -d "$target" && ! -L "$target" ]] || die "current release is not a real directory: ${target}"
  printf '%s\n' "$target"
}

ci_succeeded_for() {
  local sha="$1"
  local response record status conclusion
  is_sha "$sha" || die "invalid SHA passed to CI gate: ${sha}"

  response="$(
    "$CURL_BIN" \
      --fail --silent --show-error --location \
      --connect-timeout 10 --max-time 30 \
      --retry 2 --retry-delay 2 --retry-all-errors \
      -H 'Accept: application/vnd.github+json' \
      -H 'X-GitHub-Api-Version: 2022-11-28' \
      -H 'User-Agent: top-ai-repos-vps-deployer' \
      "$ACTIONS_API"
  )" || die 'could not query the public GitHub Actions API'

  record="$(
    "$JQ_BIN" -r --arg sha "$sha" '
      [.workflow_runs[]? | select(.head_sha == $sha)]
      | first
      | if . == null then empty else [.status, (.conclusion // "")] | @tsv end
    ' <<<"$response"
  )" || die 'GitHub Actions returned an unexpected response'

  if [[ -z "$record" ]]; then
    log "CI has not produced a push run for ${sha}; leaving the current release unchanged"
    return 1
  fi

  IFS=$'\t' read -r status conclusion <<<"$record"
  if [[ "$status" != 'completed' || "$conclusion" != 'success' ]]; then
    log "CI for ${sha} is ${status}/${conclusion:-none}; leaving the current release unchanged"
    return 1
  fi

  return 0
}

safe_remove_release() {
  local release="$1"
  guard_release_path "$release"

  [[ ! -L "$release" ]] || die "refusing to remove symlinked release: ${release}"
  [[ -e "$release" ]] || return 0
  [[ -d "$release" ]] || die "release path is not a directory: ${release}"

  local active
  active="$(current_release)"
  [[ "$active" != "$release" ]] || die "refusing to remove active release: ${release}"

  find "$release" -xdev -depth -delete
  [[ ! -e "$release" ]] || die "failed to remove release: ${release}"
}

prepare_release() {
  local sha="$1"
  local release="${RELEASES_DIR}/${sha}"
  guard_release_path "$release"

  if [[ -e "$release" || -L "$release" ]]; then
    log "removing incomplete release ${sha}"
    safe_remove_release "$release"
  fi

  install -d -o "$BUILD_USER" -g "$APP_GROUP" -m 0750 "$release"
  log "exporting commit ${sha}"
  if ! run_as_builder "$BASH_BIN" -c \
    'set -o pipefail; "$1" --git-dir="$2" archive --format=tar "$3" | "$4" --no-same-owner --no-same-permissions -xf - -C "$5"' \
    _ "$GIT_BIN" "$REPOSITORY_DIR" "$sha" "$BSDTAR_BIN" "$release"; then
    safe_remove_release "$release"
    return 1
  fi

  if [[ -e "${release}/.env" || -L "${release}/.env" ]]; then
    log 'the repository archive unexpectedly contains .env'
    safe_remove_release "$release"
    return 1
  fi
  ln -s "$ENV_FILE" "${release}/.env"

  log "installing dependencies for ${sha}"
  if ! (cd "$release" && run_as_builder "$NPM_BIN" ci --no-audit --no-fund); then
    safe_remove_release "$release"
    return 1
  fi

  log "building ${sha}"
  if ! (cd "$release" && run_as_builder "$NPM_BIN" run build); then
    safe_remove_release "$release"
    return 1
  fi

  log 'applying database migrations'
  if ! (cd "$release" && run_as_builder "$NPM_BIN" run db:migrate); then
    safe_remove_release "$release"
    return 1
  fi

  log 'seeding the category taxonomy'
  if ! (cd "$release" && run_as_builder "$NPM_BIN" run seed); then
    safe_remove_release "$release"
    return 1
  fi

  # Make the release immutable to the runtime account. Next's image/data cache
  # is the only application-owned subtree and is also the only ReadWritePaths
  # exception in the application systemd unit.
  chown -hR root:"$APP_GROUP" "$release"
  chmod -R a-s "$release"
  chmod -R u=rwX,g=rX,o= "$release"
  install -d -o "$APP_USER" -g "$APP_GROUP" -m 0750 "${release}/.next/cache"
  chown -hR "$APP_USER":"$APP_GROUP" "${release}/.next/cache"
  chmod -R u=rwX,g=rX,o= "${release}/.next/cache"

}

switch_current() {
  local release="$1"
  guard_release_path "$release"
  [[ -d "$release" && ! -L "$release" ]] || die "cannot activate invalid release: ${release}"

  if [[ -e "$NEXT_LINK" || -L "$NEXT_LINK" ]]; then
    [[ -L "$NEXT_LINK" ]] || die "refusing to replace non-symlink ${NEXT_LINK}"
    unlink -- "$NEXT_LINK"
  fi

  ln -s "$release" "$NEXT_LINK"
  mv -Tf -- "$NEXT_LINK" "$CURRENT_LINK"
}

wait_for_health() {
  local attempt
  for attempt in $(seq 1 30); do
    if "$CURL_BIN" --fail --silent --show-error --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
      return 0
    fi
    if "$CURL_BIN" --fail --silent --show-error --max-time 5 "$FALLBACK_HEALTH_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

rollback() {
  local failed_release="$1"
  local previous_release="$2"
  guard_release_path "$failed_release"

  if [[ -n "$previous_release" ]]; then
    guard_release_path "$previous_release"
    log "rolling back code to $(basename -- "$previous_release")"
    switch_current "$previous_release"
    "$SYSTEMCTL_BIN" restart "$APP_SERVICE" ||
      die "failed to restart ${APP_SERVICE} during rollback"
    wait_for_health || die 'the previous release did not recover after rollback'
  else
    log 'no previous release exists; removing current and stopping the application'
    local active
    active="$(current_release)"
    if [[ "$active" == "$failed_release" ]]; then
      unlink -- "$CURRENT_LINK"
    fi
    "$SYSTEMCTL_BIN" stop "$APP_SERVICE" || true
  fi

  safe_remove_release "$failed_release"
}

cleanup_old_releases() {
  local active budget line name release
  active="$(current_release)"
  budget=$((KEEP_RELEASES - 1))

  while IFS= read -r line; do
    name="${line#* }"
    is_sha "$name" || {
      log "ignoring unexpected entry in releases directory: ${name}"
      continue
    }
    release="${RELEASES_DIR}/${name}"
    guard_release_path "$release"

    if [[ "$release" == "$active" ]]; then
      continue
    fi
    if ((budget > 0)); then
      budget=$((budget - 1))
      continue
    fi

    log "pruning old release ${name}"
    safe_remove_release "$release"
  done < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %f\n' | sort -nr)
}

main() {
  require_root
  require_executable "$GIT_BIN"
  require_executable "$CURL_BIN"
  require_executable "$JQ_BIN"
  require_executable "$HEAD_BIN"
  require_executable "$NPM_BIN"
  require_executable "$BSDTAR_BIN"
  require_executable "$BASH_BIN"
  require_executable "$SETPRIV_BIN"
  require_executable "$SYSTEMCTL_BIN"

  acquire_lock
  ensure_layout
  ensure_repository

  local sha previous release
  sha="$(fetch_main_sha)"
  previous="$(current_release)"

  if [[ -n "$previous" && "$(basename -- "$previous")" == "$sha" ]]; then
    log "${sha} is already deployed"
    exit 0
  fi

  # An absent, queued, running, cancelled, or failed ci.yml run is deliberately
  # a no-op. The two-minute timer will re-evaluate the same origin/main SHA.
  if ! ci_succeeded_for "$sha"; then
    exit 0
  fi

  log "CI passed for ${sha}; preparing release"
  release="${RELEASES_DIR}/${sha}"
  guard_release_path "$release"
  prepare_release "$sha"

  log "activating ${sha}"
  switch_current "$release"
  if "$SYSTEMCTL_BIN" restart "$APP_SERVICE" && wait_for_health; then
    log "deployment ${sha} is healthy"
    cleanup_old_releases
    exit 0
  fi

  log "deployment ${sha} failed its health check"
  rollback "$release" "$previous"
  die "deployment ${sha} was rolled back"
}

main "$@"
