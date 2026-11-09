#!/usr/bin/env bash
# VTT Chat App — NATIVE install on Ubuntu 24.04 LTS (the advanced-user tier; Docker Compose is the
# primary deployment, see infra/compose/). Installs and configures, with no containers:
#   Postgres, Valkey, Caddy (apt) · Node.js and LiveKit server (checksum-verified downloads) ·
#   the backend (built from this checkout) · systemd units · generated secrets.
# With --with-records also: ffmpeg, whisper.cpp (built from source), Ollama, and the records worker.
# LiveKit Egress (the recorder) is NOT installed: upstream ships it only as a container image, so
# native recording needs the Compose `egress` service or a manual build (docs/BUILD-STATUS.md).
#
#   sudo infra/install.sh --domain vtt.example.com [--public-ip 203.0.113.7] [--with-records]
#
# Re-running is safe: existing secrets are kept, packages and units are brought up to date.
# Secrets are written straight to /etc/vtt/vtt.env (mode 640) and never printed.
set -euo pipefail

# --- Pinned versions (bump deliberately; the checksums are fetched from the release itself) -------
NODE_VERSION="${NODE_VERSION:-26.13.0}"          # Node 26 "Lithium" LTS
LIVEKIT_VERSION="${LIVEKIT_VERSION:-1.13.5}"     # the version the Compose bundle was tested with
WHISPER_REF="${WHISPER_REF:-v1.9.5}"
WHISPER_MODEL_FILE="${WHISPER_MODEL_FILE:-ggml-small-q5_1.bin}"
OLLAMA_MODEL="${OLLAMA_MODEL:-llama3.2:3b}"

# --- Layout ---------------------------------------------------------------------------------------
APP_USER=vtt
APP_DIR=/opt/vtt            # deployed application
NODE_DIR=/opt/node
LIVEKIT_DIR=/opt/livekit
CONF_DIR=/etc/vtt
STATE_DIR=/var/lib/vtt
ENV_FILE="$CONF_DIR/vtt.env"

DOMAIN=""
PUBLIC_IP=""
WITH_RECORDS=0
SKIP_OLLAMA=0
NO_START=0
DRY_RUN=0
REGENERATE=0
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  cat <<'USAGE'

Options:
  --domain NAME         hostname players will use (required); a real domain gets a Let's Encrypt certificate
  --public-ip IP        server is behind NAT: advertise this address for voice
  --with-records        also install ffmpeg, whisper.cpp, Ollama and the records worker
  --skip-ollama         with --with-records: the LLM runs elsewhere (set it later with vtt-admin settings)
  --no-start            install and configure but do not enable or start services (containers, CI)
  --src DIR             repository checkout to deploy (default: this script's repository)
  --regenerate-secrets  replace /etc/vtt/vtt.env secrets (invalidates all sessions and tokens)
  --dry-run             print what would be done, change nothing
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --public-ip) PUBLIC_IP="${2:-}"; shift 2 ;;
    --with-records) WITH_RECORDS=1; shift ;;
    --skip-ollama) SKIP_OLLAMA=1; shift ;;
    --no-start) NO_START=1; shift ;;
    --src) SRC_DIR="$(cd "${2:-}" && pwd)"; shift 2 ;;
    --regenerate-secrets) REGENERATE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
done

[[ -n "$DOMAIN" ]] || { usage >&2; die "--domain is required"; }
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || die "--domain must be a hostname"
[[ -z "$PUBLIC_IP" || "$PUBLIC_IP" =~ ^[0-9a-fA-F.:]+$ ]] || die "--public-ip must be an IP address"

# Runs a command, or just prints it under --dry-run.
run() {
  if ((DRY_RUN)); then printf '  [dry-run] %s\n' "$*"; else "$@"; fi
}
# Writes stdin to a file with a mode and owner, or reports it under --dry-run.
write_file() { # path mode owner:group
  local path="$1" mode="$2" owner="$3"
  if ((DRY_RUN)); then printf '  [dry-run] write %s (%s %s)\n' "$path" "$mode" "$owner"; cat >/dev/null; return; fi
  install -d -m 0755 "$(dirname "$path")"
  local tmp; tmp="$(mktemp)"
  cat >"$tmp"
  install -m "$mode" -o "${owner%%:*}" -g "${owner##*:}" "$tmp" "$path"
  rm -f "$tmp"
}

preflight() {
  ((DRY_RUN)) || [[ $EUID -eq 0 ]] || die "run as root (sudo)"
  [[ -r /etc/os-release ]] || die "cannot read /etc/os-release"
  # shellcheck disable=SC1091
  . /etc/os-release
  [[ "${ID:-}" == ubuntu && "${VERSION_ID:-}" == "24.04" ]] \
    || die "this installer targets Ubuntu 24.04 LTS (found ${PRETTY_NAME:-unknown}); other systems: use Docker Compose (infra/compose)"
  case "$(uname -m)" in
    x86_64) ARCH=amd64; NODE_ARCH=x64 ;;
    aarch64) ARCH=arm64; NODE_ARCH=arm64 ;;
    *) die "unsupported CPU architecture: $(uname -m)" ;;
  esac
  if ((NO_START == 0)) && [[ ! -d /run/systemd/system ]]; then
    die "systemd is not running here; pass --no-start to install without starting services"
  fi
  [[ -f "$SRC_DIR/backend/package.json" ]] || die "$SRC_DIR is not a vtt-chat-app checkout (use --src)"
}

rand_hex() { openssl rand -hex "$1"; }

# Downloads $1 to $2 and verifies it against the line for $3 in the checksum file at $4.
fetch_verified() {
  local url="$1" out="$2" name="$3" sums_url="$4" sums
  sums="$(curl -fsSL "$sums_url")" || die "could not fetch checksums from $sums_url"
  local want; want="$(printf '%s\n' "$sums" | awk -v n="$name" '$2 == n || $2 == "*" n {print $1}' | head -1)"
  [[ -n "$want" ]] || die "no checksum for $name in $sums_url"
  curl -fsSL -o "$out" "$url" || die "download failed: $url"
  local got; got="$(sha256sum "$out" | awk '{print $1}')"
  [[ "$got" == "$want" ]] || { rm -f "$out"; die "checksum mismatch for $name (wanted $want, got $got)"; }
}

install_packages() {
  log "Installing packages (Postgres, Valkey, Caddy, curl, openssl)"
  run apt-get update -qq
  run env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    postgresql valkey-server caddy curl ca-certificates openssl xz-utils rsync gnupg
  if ((WITH_RECORDS)); then
    run env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
      ffmpeg build-essential cmake git zstd
  fi
}

create_user() {
  log "Creating the '$APP_USER' system user and directories"
  id "$APP_USER" >/dev/null 2>&1 || run useradd --system --home-dir "$STATE_DIR" --shell /usr/sbin/nologin "$APP_USER"
  run install -d -m 0750 -o "$APP_USER" -g "$APP_USER" "$STATE_DIR"
  run install -d -m 0750 -o root -g "$APP_USER" "$CONF_DIR"
  run install -d -m 0755 "$APP_DIR" "$LIVEKIT_DIR"
  run install -d -m 0750 -o "$APP_USER" -g "$APP_USER" "$STATE_DIR/media"
  run install -d -m 0755 -o "$APP_USER" -g "$APP_USER" "$STATE_DIR/updates"
  ((WITH_RECORDS)) && run install -d -m 0750 -o "$APP_USER" -g "$APP_USER" "$STATE_DIR/recordings" "$STATE_DIR/models" "$STATE_DIR/ollama"
  return 0
}

install_node() {
  if [[ -x "$NODE_DIR/bin/node" && "$("$NODE_DIR/bin/node" -v)" == "v$NODE_VERSION" ]]; then
    log "Node.js v$NODE_VERSION already installed"; return
  fi
  log "Installing Node.js v$NODE_VERSION"
  ((DRY_RUN)) && { echo "  [dry-run] download + verify node-v$NODE_VERSION-linux-$NODE_ARCH.tar.xz"; return; }
  local name="node-v$NODE_VERSION-linux-$NODE_ARCH.tar.xz" tmp; tmp="$(mktemp -d)"
  fetch_verified "https://nodejs.org/dist/v$NODE_VERSION/$name" "$tmp/$name" "$name" \
    "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"
  rm -rf "$NODE_DIR"; mkdir -p "$NODE_DIR"
  tar -xJf "$tmp/$name" -C "$NODE_DIR" --strip-components=1
  rm -rf "$tmp"
}

install_livekit() {
  if [[ -x "$LIVEKIT_DIR/livekit-server" ]] && "$LIVEKIT_DIR/livekit-server" --version 2>/dev/null | grep -q "$LIVEKIT_VERSION"; then
    log "LiveKit server $LIVEKIT_VERSION already installed"; return
  fi
  log "Installing LiveKit server $LIVEKIT_VERSION"
  ((DRY_RUN)) && { echo "  [dry-run] download + verify livekit_${LIVEKIT_VERSION}_linux_$ARCH.tar.gz"; return; }
  local name="livekit_${LIVEKIT_VERSION}_linux_$ARCH.tar.gz" base tmp
  base="https://github.com/livekit/livekit/releases/download/v$LIVEKIT_VERSION"
  tmp="$(mktemp -d)"
  fetch_verified "$base/$name" "$tmp/$name" "$name" "$base/checksums.txt"
  tar -xzf "$tmp/$name" -C "$LIVEKIT_DIR" livekit-server
  chmod 0755 "$LIVEKIT_DIR/livekit-server"
  rm -rf "$tmp"
}

setup_secrets_and_database() {
  log "Generating secrets and the database"
  if [[ -f "$ENV_FILE" && $REGENERATE -eq 0 ]]; then
    log "  keeping the existing $ENV_FILE"
    return
  fi
  if ((DRY_RUN)); then echo "  [dry-run] create role/database '$APP_USER' and write $ENV_FILE"; return; fi
  local pg_pass lk_key lk_secret
  pg_pass="$(rand_hex 16)"; lk_key="API$(rand_hex 6)"; lk_secret="$(rand_hex 32)"
  # Start the services first (the package postinst usually has), then create the role and database.
  if ((NO_START == 0)); then systemctl enable --now postgresql valkey-server >/dev/null; else pg_ctlcluster_start; fi
  local sql="DO \$\$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$APP_USER') THEN CREATE ROLE $APP_USER LOGIN; END IF;
  END \$\$;
  ALTER ROLE $APP_USER PASSWORD '$pg_pass';"
  printf '%s\n' "$sql" | runuser -u postgres -- psql -v ON_ERROR_STOP=1 -q
  runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='$APP_USER'" | grep -q 1 \
    || runuser -u postgres -- createdb -O "$APP_USER" "$APP_USER"
  write_file "$ENV_FILE" 0640 "root:$APP_USER" <<EOF
# Generated by infra/install.sh. Secrets live here and nowhere else; do not commit or share.
PORT=3000
MEDIA_DIR=$STATE_DIR/media
# Signed client updates (`vtt-admin updates publish`), served at /updates.
UPDATES_DIR=$STATE_DIR/updates
WEB_DIR=$APP_DIR/web/dist
DATABASE_URL=postgres://$APP_USER:$pg_pass@127.0.0.1:5432/$APP_USER
VALKEY_URL=redis://127.0.0.1:6379
LIVEKIT_URL=wss://$DOMAIN/livekit
LIVEKIT_HEALTH_URL=http://127.0.0.1:7880
$( ((WITH_RECORDS)) && echo "RECORDINGS_DIR=$STATE_DIR/recordings" )
LIVEKIT_API_KEY=$lk_key
LIVEKIT_API_SECRET=$lk_secret
EOF
}

pg_ctlcluster_start() {
  # Containers without systemd: start the default cluster directly so the role can be created.
  local v; v="$(find /etc/postgresql -mindepth 1 -maxdepth 1 -printf '%f\n' | sort -V | tail -1)"
  pg_ctlcluster "$v" main start 2>/dev/null || true
  for _ in $(seq 1 30); do runuser -u postgres -- psql -tAc 'SELECT 1' >/dev/null 2>&1 && return; sleep 1; done
  die "Postgres did not start"
}

env_value() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }

# The environment changes below are deliberately confined to subshells.
# shellcheck disable=SC2030,SC2031
deploy_app() {
  log "Building and deploying the application from $SRC_DIR"
  if ((DRY_RUN)); then echo "  [dry-run] npm ci, build shared/ai/backend, install production dependencies into $APP_DIR"; return; fi
  # /var/tmp, not /tmp: hardened systems mount /tmp noexec, and the build runs tools it writes.
  local build; build="$(mktemp -d -p /var/tmp vtt-build.XXXXXX)"
  rsync -a --exclude node_modules --exclude .git --exclude target --exclude dist --exclude '*.tsbuildinfo' \
    --exclude tauri-client/src-tauri --exclude tauri-client/rust-livekit --exclude tauri-client/rust-sync \
    "$SRC_DIR"/ "$build"/
  (
    export PATH="$NODE_DIR/bin:$PATH" HOME="$build" npm_config_update_notifier=false npm_config_fund=false
    cd "$build"
    npm ci -w backend -w ai -w ddb -w shared -w web --no-audit
    npm run build -w shared -w ai -w ddb -w backend -w web
  )
  # Production tree: manifests + compiled output + production-only node_modules (as in the Dockerfile).
  rm -rf "$APP_DIR.new"; mkdir -p "$APP_DIR.new"
  (
    cd "$build"
    mkdir -p "$APP_DIR.new"/{shared,ai,backend,ddb,status,web,tauri-client/panels-ui}
    cp package.json package-lock.json tsconfig.base.json "$APP_DIR.new"/
    for d in shared ai backend ddb status web tauri-client/panels-ui; do cp "$d/package.json" "$APP_DIR.new/$d/"; done
    for d in shared ai ddb backend; do cp -r "$d/dist" "$APP_DIR.new/$d/"; done
    cp -r backend/migrations "$APP_DIR.new/backend/"
    cp -r web/dist "$APP_DIR.new/web/"
  )
  (
    export PATH="$NODE_DIR/bin:$PATH" HOME="$build" npm_config_update_notifier=false npm_config_fund=false
    cd "$APP_DIR.new"
    npm ci --omit=dev -w backend -w ai -w ddb -w shared --no-audit
  )
  rm -rf "$APP_DIR.old"; [[ -d "$APP_DIR" ]] && mv "$APP_DIR" "$APP_DIR.old"
  mv "$APP_DIR.new" "$APP_DIR"; rm -rf "$APP_DIR.old" "$build"
  chown -R root:root "$APP_DIR"
}

install_records() {
  ((WITH_RECORDS)) || return 0
  log "Building whisper.cpp $WHISPER_REF (CPU) — a few minutes"
  if ((DRY_RUN)); then echo "  [dry-run] build whisper-server, fetch $WHISPER_MODEL_FILE, install Ollama + $OLLAMA_MODEL"; return; fi
  local src; src="$(mktemp -d -p /var/tmp vtt-whisper.XXXXXX)"
  git clone -q --depth 1 --branch "$WHISPER_REF" https://github.com/ggml-org/whisper.cpp "$src"
  cmake -S "$src" -B "$src/build" -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=OFF >/dev/null
  cmake --build "$src/build" -j"$(nproc)" --target whisper-server >/dev/null
  install -d /opt/whisper/lib
  install -m 0755 "$src/build/bin/whisper-server" /opt/whisper/whisper-server
  find "$src/build" -name '*.so*' -exec cp -P {} /opt/whisper/lib/ \;
  rm -rf "$src"
  local model="$STATE_DIR/models/$WHISPER_MODEL_FILE"
  [[ -s "$model" ]] || runuser -u "$APP_USER" -- curl -fL --retry 3 -o "$model" \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$WHISPER_MODEL_FILE"

  if ((SKIP_OLLAMA)); then
    log "Skipping Ollama (--skip-ollama): point the LLM at your own server with vtt-admin settings"
    return
  fi
  log "Installing Ollama and pulling $OLLAMA_MODEL — about 1.5 GB plus the model"
  local tmp; tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/ollama.tar.zst" "https://github.com/ollama/ollama/releases/latest/download/ollama-linux-$ARCH.tar.zst"
  tar --zstd -xf "$tmp/ollama.tar.zst" -C /usr/local
  rm -rf "$tmp"
}

write_configs() {
  log "Writing LiveKit, Caddy and systemd configuration"
  local lk_key lk_secret use_ip=false
  if ((DRY_RUN)); then lk_key=dry; lk_secret=dry; else lk_key="$(env_value LIVEKIT_API_KEY)"; lk_secret="$(env_value LIVEKIT_API_SECRET)"; fi
  [[ -n "$PUBLIC_IP" ]] && use_ip=true

  write_file "$CONF_DIR/livekit.yaml" 0640 "root:$APP_USER" <<EOF
# Generated by infra/install.sh. Host networking is the default here: no containers involved.
port: 7880
bind_addresses:
  - ''
rtc:
  tcp_port: 7881        # ICE-over-TCP fallback
  port_range_start: 50000
  port_range_end: 50200 # forward this UDP range to the server
  use_external_ip: $use_ip
redis:
  address: 127.0.0.1:6379
keys:
  $lk_key: $lk_secret
EOF

  write_file /etc/caddy/Caddyfile 0644 root:root <<EOF
# Generated by infra/install.sh
$DOMAIN {
	encode zstd gzip
	handle_path /livekit/* {
		reverse_proxy 127.0.0.1:7880
	}
	handle {
		reverse_proxy 127.0.0.1:3000
	}
}
EOF

  local hardening='NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true'

  write_file /etc/systemd/system/vtt-backend.service 0644 root:root <<EOF
[Unit]
Description=VTT Chat App backend
After=network-online.target postgresql.service valkey-server.service
Wants=network-online.target postgresql.service valkey-server.service

[Service]
User=$APP_USER
EnvironmentFile=$ENV_FILE
WorkingDirectory=$APP_DIR
ExecStart=$NODE_DIR/bin/node $APP_DIR/backend/dist/index.js
Restart=on-failure
RestartSec=3
$hardening
ReadWritePaths=$STATE_DIR/media

[Install]
WantedBy=multi-user.target
EOF

  write_file /etc/systemd/system/vtt-livekit.service 0644 root:root <<EOF
[Unit]
Description=LiveKit server (voice SFU)
After=network-online.target valkey-server.service
Wants=network-online.target valkey-server.service

[Service]
User=$APP_USER
ExecStart=$LIVEKIT_DIR/livekit-server --config $CONF_DIR/livekit.yaml
Restart=on-failure
RestartSec=3
LimitNOFILE=65536
$hardening

[Install]
WantedBy=multi-user.target
EOF

  write_file /usr/local/bin/vtt-admin 0755 root:root <<EOF
#!/usr/bin/env bash
# The Admin CLI, run as the service user with the service environment.
set -a; . $ENV_FILE; set +a
exec runuser -m -u $APP_USER -- $NODE_DIR/bin/node $APP_DIR/backend/dist/cli/main.js "\$@"
EOF

  if ((WITH_RECORDS)); then
    write_file /etc/systemd/system/vtt-whisper.service 0644 root:root <<EOF
[Unit]
Description=whisper.cpp server (local transcription, OpenAI-compatible)
After=network.target

[Service]
User=$APP_USER
Environment=LD_LIBRARY_PATH=/opt/whisper/lib
ExecStart=/opt/whisper/whisper-server -m $STATE_DIR/models/$WHISPER_MODEL_FILE --host 127.0.0.1 --port 8080 --inference-path /v1/audio/transcriptions -l en
Restart=on-failure
$hardening

[Install]
WantedBy=multi-user.target
EOF
    if ((SKIP_OLLAMA == 0)); then
      write_file /etc/systemd/system/vtt-ollama.service 0644 root:root <<EOF
[Unit]
Description=Ollama (local LLM for summaries)
After=network.target

[Service]
User=$APP_USER
Environment=OLLAMA_HOST=127.0.0.1:11434
Environment=OLLAMA_MODELS=$STATE_DIR/ollama
Environment=HOME=$STATE_DIR
ExecStart=/usr/local/bin/ollama serve
Restart=on-failure
$hardening
ReadWritePaths=$STATE_DIR

[Install]
WantedBy=multi-user.target
EOF
    fi
    write_file /etc/systemd/system/vtt-worker.service 0644 root:root <<EOF
[Unit]
Description=VTT Chat App records worker (transcribe, merge, summarise)
After=postgresql.service vtt-whisper.service
Wants=vtt-whisper.service

[Service]
User=$APP_USER
EnvironmentFile=$ENV_FILE
Environment=WHISPER_LOCAL_URL=http://127.0.0.1:8080
Environment=OLLAMA_URL=http://127.0.0.1:11434
Environment=OLLAMA_MODEL=$OLLAMA_MODEL
WorkingDirectory=$APP_DIR
ExecStart=$NODE_DIR/bin/node $APP_DIR/ai/dist/cli/worker.js
Restart=on-failure
RestartSec=5
$hardening
ReadWritePaths=$STATE_DIR

[Install]
WantedBy=multi-user.target
EOF
  fi
}

start_services() {
  if ((NO_START)); then
    log "Not starting services (--no-start). Enable them with: systemctl enable --now vtt-livekit vtt-backend caddy"
    return
  fi
  log "Starting services"
  run systemctl daemon-reload
  local units=(postgresql valkey-server vtt-livekit vtt-backend caddy)
  if ((WITH_RECORDS)); then
    units+=(vtt-whisper)
    if ((SKIP_OLLAMA == 0)); then
      run systemctl enable --now vtt-ollama
      ((DRY_RUN)) || { for _ in $(seq 1 60); do curl -fs http://127.0.0.1:11434/api/version >/dev/null 2>&1 && break; sleep 1; done; }
      run runuser -u "$APP_USER" -- env OLLAMA_HOST=127.0.0.1:11434 HOME="$STATE_DIR" /usr/local/bin/ollama pull "$OLLAMA_MODEL"
    fi
    units+=(vtt-worker)
  fi
  run systemctl enable --now "${units[@]}"
  run systemctl reload caddy || run systemctl restart caddy
}

health_check() {
  ((NO_START || DRY_RUN)) && return 0
  log "Waiting for the backend to answer"
  for _ in $(seq 1 60); do
    if curl -fs http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
      echo "  backend: ok"
      vtt-admin status || warn "vtt-admin status reported a problem (see above)"
      return 0
    fi
    sleep 1
  done
  die "the backend did not become healthy; see: journalctl -u vtt-backend -n 50"
}

summary() {
  cat <<EOF

Installed. Next:
  1. Open these to the internet:  80/tcp, 443/tcp+udp, 7881/tcp, 50000-50200/udp
     (the script does not touch your firewall; with ufw: ufw allow 80,443,7881/tcp && ufw allow 443/udp && ufw allow 50000:50200/udp)
  2. Point DNS for $DOMAIN at this server, then browse to https://$DOMAIN/api/health
  3. The first account to register becomes the Admin. Manage the instance with: vtt-admin help
  4. Secrets are in $ENV_FILE (readable by root and the '$APP_USER' group only).
EOF
  if ((WITH_RECORDS)); then
    echo "  5. Recording needs LiveKit Egress, which is not installed natively (container-only upstream)."
    echo "     Run the Compose 'egress' service next to this install, or see docs/BUILD-STATUS.md."
  fi
}

main() {
  preflight
  log "Installing for $DOMAIN${PUBLIC_IP:+ (public IP $PUBLIC_IP)}$( ((WITH_RECORDS)) && echo ', with the records pipeline')"
  install_packages
  create_user
  install_node
  install_livekit
  setup_secrets_and_database
  deploy_app
  install_records
  write_configs
  start_services
  health_check
  summary
}

main "$@"
