#!/usr/bin/env bash
# Nightly Postgres backup to S3-compatible object storage (Cloudflare R2).
#
# Managed Postgres took backups for us. This host does not, so this script is the
# ONLY copy of the data. It is wired into the host crontab by deploy/provision.sh
# and is deliberately loud: a backup that fails quietly is worse than no backup,
# because it buys false confidence.
#
# Restore is the inverse and is documented in the runbook, not here — a restore
# procedure that lives only inside the backup script is a procedure nobody reads
# until the night they cannot read it.
#
# Env (from /opt/openreply/.env):
#   POSTGRES_DB POSTGRES_USER
#   BACKUP_S3_BUCKET BACKUP_S3_ENDPOINT
#   AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
#   BACKUP_RETENTION_DAYS (default 30)

set -euo pipefail

readonly ENV_FILE=/opt/openreply/.env
readonly STACK_DIR=/opt/openreply/openreply
readonly COMPOSE_FILE="$STACK_DIR/docker-compose.prod.yml"
readonly DEFAULT_RETENTION_DAYS=30

main() {
  loadEnvironment
  local archive
  archive=$(dumpDatabase)
  uploadArchive "$archive"
  rm -f "$archive"
  pruneRemoteBackups
  echo "[backup] ok"
}

loadEnvironment() {
  [ -r "$ENV_FILE" ] || fail "cannot read $ENV_FILE"
  set -a; . "$ENV_FILE"; set +a
  : "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"
  : "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT is required}"
  : "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required}"
  : "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required}"
}

# pg_dump runs inside the container because Postgres is not published to the host.
# `-Fc` is the custom format: compressed, and restorable table-by-table, which is
# what you want at 3am when only one table is wrong.
dumpDatabase() {
  local stamp archive
  stamp=$(date -u '+%Y%m%dT%H%M%SZ')
  archive="/tmp/openreply-${stamp}.dump"
  docker compose -f "$COMPOSE_FILE" exec -T postgres \
    pg_dump -Fc -U "${POSTGRES_USER:-openreply}" -d "${POSTGRES_DB:-openreply}" > "$archive" \
    || fail "pg_dump failed"
  [ -s "$archive" ] || fail "pg_dump produced an empty file"
  echo "$archive"
}

uploadArchive() {
  local archive=$1
  aws s3 cp "$archive" "s3://${BACKUP_S3_BUCKET}/openreply/$(basename "$archive")" \
    --endpoint-url "$BACKUP_S3_ENDPOINT" \
    || fail "upload to $BACKUP_S3_BUCKET failed"
}

pruneRemoteBackups() {
  local cutoff
  cutoff=$(date -u -d "${BACKUP_RETENTION_DAYS:-$DEFAULT_RETENTION_DAYS} days ago" '+%Y%m%d')
  aws s3 ls "s3://${BACKUP_S3_BUCKET}/openreply/" --endpoint-url "$BACKUP_S3_ENDPOINT" \
    | awk '{print $4}' \
    | while read -r key; do
        [ -n "$key" ] || continue
        local stamp=${key#openreply-}
        stamp=${stamp%%T*}
        if [ "$stamp" -lt "$cutoff" ] 2>/dev/null; then
          aws s3 rm "s3://${BACKUP_S3_BUCKET}/openreply/${key}" --endpoint-url "$BACKUP_S3_ENDPOINT"
        fi
      done
}

fail() {
  echo "[backup] FAILED: $*" >&2
  exit 1
}

main "$@"
