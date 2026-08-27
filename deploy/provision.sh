#!/usr/bin/env bash
# Prepare a bare Ubuntu host to run the OpenReply stack. Idempotent — safe to
# re-run after a change.
#
# Written for an Oracle Cloud Always Free Ampere A1 instance (arm64), which has
# two traps that make a correctly-deployed stack look broken:
#
#   1. The Ubuntu images ship a restrictive iptables INPUT chain that drops
#      everything except SSH. Opening 80/443 in the OCI security list is only
#      HALF the job; the host firewall silently drops the rest. Symptom: the
#      security list looks right, the container is listening, and every request
#      from the internet times out with no log line anywhere.
#   2. Those rules are persisted by netfilter-persistent, so an un-saved
#      iptables change survives until the first reboot and then vanishes.
#
# Run as a user with sudo:  bash deploy/provision.sh

set -euo pipefail

readonly STACK_PARENT=/opt/openreply
readonly REPO_URL=https://github.com/CricsConCarne/openreply.git
readonly STACK_DIR="$STACK_PARENT/openreply"
readonly BACKUP_HOUR_UTC=7

main() {
  installDocker
  openHttpPorts
  createStackDirectory
  fetchRepository
  scheduleNightlyBackup
  reportNextSteps
}

installDocker() {
  if command -v docker >/dev/null 2>&1; then
    echo "[provision] docker already installed"
    return
  fi
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl gnupg awscli
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker "$USER"
}

# Trap 1 and 2 from the header. Insert above the blanket REJECT rather than
# appending, or the packet is rejected before it reaches the ACCEPT.
openHttpPorts() {
  local port
  for port in 80 443; do
    if sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
      echo "[provision] port $port already open"
      continue
    fi
    sudo iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
  done
  sudo apt-get install -y iptables-persistent netfilter-persistent
  sudo netfilter-persistent save
}

createStackDirectory() {
  sudo mkdir -p "$STACK_PARENT"
  sudo chown "$USER":"$USER" "$STACK_PARENT"
  if [ ! -e "$STACK_PARENT/.env" ]; then
    install -m 600 /dev/null "$STACK_PARENT/.env"
    echo "[provision] created empty $STACK_PARENT/.env — populate it before starting the stack"
  fi
  chmod 600 "$STACK_PARENT/.env"
}

fetchRepository() {
  if [ -d "$STACK_DIR/.git" ]; then
    git -C "$STACK_DIR" pull --ff-only
    return
  fi
  git clone "$REPO_URL" "$STACK_DIR"
}

scheduleNightlyBackup() {
  local entry="0 $BACKUP_HOUR_UTC * * * $STACK_DIR/deploy/backup.sh >> /var/log/openreply-backup.log 2>&1"
  if crontab -l 2>/dev/null | grep -qF "$STACK_DIR/deploy/backup.sh"; then
    echo "[provision] backup cron already scheduled"
    return
  fi
  (crontab -l 2>/dev/null; echo "$entry") | crontab -
  sudo touch /var/log/openreply-backup.log
  sudo chown "$USER":"$USER" /var/log/openreply-backup.log
}

reportNextSteps() {
  cat <<'EOF'

[provision] done. Remaining, in order:
  1. Populate /opt/openreply/.env (see the OpenReply section of infrastructure/README.md).
  2. Open 80 and 443 in the OCI VCN security list for this subnet — the host
     firewall is now open, the cloud one is separate and is not done here.
  3. Point the DNS record at this host's public IP, unproxied, and wait for it
     to resolve. Caddy issues its certificate over HTTP-01 and cannot start
     until the name resolves here.
  4. cd /opt/openreply/openreply
     docker compose -f docker-compose.prod.yml --env-file /opt/openreply/.env up -d --build
  5. docker compose -f docker-compose.prod.yml exec web npx prisma migrate deploy
EOF
}

main "$@"
