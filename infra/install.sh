#!/usr/bin/env bash
# Prepare a fresh Debian 12/13 VPS for the assistant. Run as root, once.
# Idempotent: safe to run again.
#   - installs Docker Engine + compose plugin from Docker's repository
#   - installs rclone and unattended security upgrades
#   - firewall: SSH, 80 (ACME + redirect), 443 tcp/udp
#   - SSH: key-only login, but only if a key is already installed (no lockout)
#   - creates /opt/n8n-assistant for docker-compose.yml, Caddyfile and .env
set -euo pipefail

APP_DIR=/opt/n8n-assistant

if [[ $EUID -ne 0 ]]; then
  echo "run as root" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg ufw rclone unattended-upgrades sqlite3

# Docker Engine from the official repository.
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi
systemctl enable --now docker

# Automatic security updates for the OS (not for the pinned containers).
dpkg-reconfigure -f noninteractive unattended-upgrades

# Firewall. Note: Docker publishes ports through its own iptables rules, which
# bypass ufw; only Caddy publishes ports (80/443), and n8n is not published.
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# SSH: key-only, only when root or a sudo user already has an authorized key.
has_key=false
for f in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do
  [[ -s "$f" ]] && has_key=true
done
if $has_key; then
  cat > /etc/ssh/sshd_config.d/10-key-only.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
CONF
  systemctl reload ssh || systemctl reload sshd
  echo "ssh: password login disabled"
else
  echo "ssh: WARNING no authorized_keys found; password login left enabled" >&2
fi

install -d -m 0750 "$APP_DIR" "$APP_DIR/backups"
echo
echo "Next:"
echo "  1. copy infra/docker-compose.yml, infra/Caddyfile, infra/backup.sh, infra/restore.sh to $APP_DIR"
echo "  2. create $APP_DIR/.env from infra/.env.example (chmod 600)"
echo "  3. cd $APP_DIR && docker compose up -d"
