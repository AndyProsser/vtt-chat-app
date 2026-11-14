#!/usr/bin/env bash
# VTT Chat: one-command server install for a blank Ubuntu (or Debian) machine.
#
#   curl -fsSL https://raw.githubusercontent.com/AndyProsser/vtt-chat-app/main/infra/get.sh | sudo bash
#
# It asks a few questions (your domain, your email), then installs Docker if it is missing, downloads this
# release's server bundle to /opt/vtt-chat, writes fresh secrets, starts everything, makes you the first
# Admin, and prints what to do next. Safe to run again: an existing install is updated, never reset.
#
# Everything it asks can be given as a flag instead (for scripts and for pasting one line):
#   --domain vtt.example.com      the name players will use (its DNS must already point at this machine)
#   --email you@example.com       the first Admin's email   --name "Your Name"   (display name)
#   --version 0.4.0               the release to install (default: the newest stable release)
#   --with-records                also run recording, transcription and summaries (about 6 GB of downloads)
#   --records-remote              recording and the worker here, but the AI (Whisper and the LLM) on another machine you point it at;
#                                 chosen automatically when this CPU lacks AVX, which the local AI needs
#   --voice-address 203.0.113.7   where voice (UDP) connects: an IP or DNS name. Found automatically; set it when the
#                                 domain goes through Cloudflare's proxy or the machine is behind NAT (alias: --public-ip)
#   --dir /opt/vtt-chat           where to put it
#   --behind-tunnel               the website arrives through a Cloudflare Tunnel (your line blocks 80/443, or you prefer it): Caddy serves plain
#                                 HTTP and asks for no certificate; see the operator guide for the tunnel's hostname and token
#   --no-admin                    do not create the first Admin now (make one later: vtt-admin user create <email> --name <name> --accept-consent)
#   --yes                         do not ask anything; every value must come from flags
#   --skip-docker-install  --skip-firewall  --dry-run
set -euo pipefail

REPO="${VTT_REPO:-AndyProsser/vtt-chat-app}"
ASSUME_YES=0 DRY_RUN=0 SKIP_DOCKER=0 SKIP_FIREWALL=0 WITH_RECORDS=""
RECORDS_PROFILE=records TUNNEL=0 NO_ADMIN=0 BEHIND_CLOUDFLARE=0 DOMAIN="" EMAIL="" NAME="" VERSION="" PUBLIC_IP="" DIR="/opt/vtt-chat"

# ---------- small helpers ----------
if [[ -t 1 ]]; then B=$'\e[1m' G=$'\e[32m' Y=$'\e[33m' R=$'\e[31m' N=$'\e[0m'; else B="" G="" Y="" R="" N=""; fi
say() { printf '%s\n' "$*"; }
step() { printf '\n%s==>%s %s%s%s\n' "$G" "$N" "$B" "$*" "$N"; }
warn() { printf '%s!%s %s\n' "$Y" "$N" "$*" >&2; }
die() { printf '%sError:%s %s\n' "$R" "$N" "$*" >&2; exit 1; }
# apt is chatty and may ask questions: answer them, and keep the noise in a log shown only if something fails.
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
LOG=/var/log/vtt-install.log
apt_q() {
  ((DRY_RUN)) && { say "  (dry run) apt-get $*"; return 0; }
  if ! apt-get -o Dpkg::Progress-Fancy=0 -o Dpkg::Use-Pty=0 "$@" >>"$LOG" 2>&1; then
    tail -n 25 "$LOG" >&2
    die "apt-get $* failed; the full output is in $LOG"
  fi
}
run() { if ((DRY_RUN)); then say "  (dry run) $*"; else "$@"; fi; }

# The image version for a release tag: a stable release follows its MAJOR.MINOR line (the newest patch, never a
# new minor); a dev or rc build is pinned exactly, because only its own tag is published.
version_for_images() {
  local v=${1#v}
  if [[ $v == *-* ]]; then echo "$v"; else echo "${v%.*}"; fi
}

# Cloudflare's published ranges (https://www.cloudflare.com/ips/): the addresses its proxy connects from.
CLOUDFLARE_RANGES="173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22 2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32"

# Cloudflare proxy addresses (the orange cloud). The website may sit behind it; voice (UDP) goes straight to the machine instead.
is_cloudflare_ip() { [[ $1 =~ ^(104\.(1[6-9]|2[0-9]|3[01])\.|172\.(6[4-9]|7[01])\.|188\.114\.(9[6-9]|1[01][0-9])\.|162\.15[89]\.|141\.101\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.|108\.162\.|173\.245\.|131\.0\.7[2-5]\.|103\.2[12]\.) ]]; }

valid_domain() { [[ $1 =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$ || $1 == localhost ]]; }
valid_email() { [[ $1 =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; }

# Reading answers works even when this script itself is piped from curl: the terminal is /dev/tty.
have_tty() { [[ -r /dev/tty && -w /dev/tty ]] && (: </dev/tty) 2>/dev/null; }
ask() { # ask VAR "question" [default]
  local var=$1 q=$2 def=${3:-} reply
  if ((ASSUME_YES)) || ! have_tty; then die "$q  (give it with a flag, or run without --yes in a terminal)"; fi
  if [[ -n $def ]]; then printf '%s [%s]: ' "$q" "$def" >/dev/tty; else printf '%s: ' "$q" >/dev/tty; fi
  IFS= read -r reply </dev/tty || true
  printf -v "$var" '%s' "${reply:-$def}"
}
confirm() { # confirm "question" default(y|n)
  local q=$1 def=${2:-n} reply
  if ((ASSUME_YES)) || ! have_tty; then [[ $def == y ]]; return; fi
  printf '%s [%s]: ' "$q" "$([[ $def == y ]] && echo Y/n || echo y/N)" >/dev/tty
  IFS= read -r reply </dev/tty || true
  reply=${reply:-$def}
  [[ $reply =~ ^[Yy] ]]
}

# Sourcing this file with VTT_GET_SOURCE_ONLY=1 loads the helpers above and runs nothing (for the tests).
if [[ ${VTT_GET_SOURCE_ONLY:-} == 1 ]]; then return 0 2>/dev/null || exit 0; fi

# ---------- arguments ----------
while (($#)); do
  case $1 in
    --domain) DOMAIN=${2:?--domain needs a value}; shift 2 ;;
    --email) EMAIL=${2:?--email needs a value}; shift 2 ;;
    --name) NAME=${2:?--name needs a value}; shift 2 ;;
    --version) VERSION=${2:?--version needs a value}; shift 2 ;;
    --voice-address | --public-ip) PUBLIC_IP=${2:?$1 needs a value}; shift 2 ;;
    --dir) DIR=${2:?--dir needs a value}; shift 2 ;;
    --no-admin) NO_ADMIN=1; shift ;;
    --behind-tunnel) TUNNEL=1; shift ;;
    --with-records) WITH_RECORDS=1; shift ;;
    --no-records) WITH_RECORDS=0; shift ;;
    --records-remote) WITH_RECORDS=1; RECORDS_PROFILE=records-remote; shift ;;
    --yes | -y) ASSUME_YES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --skip-docker-install) SKIP_DOCKER=1; shift ;;
    --skip-firewall) SKIP_FIREWALL=1; shift ;;
    -h | --help) sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done

# Root is needed to install Docker, open the firewall and link /usr/local/bin. Without it (a test run, or Docker already
# there and the firewall handled by you) pass both skip flags.
if [[ $EUID -ne 0 ]] && ! ((DRY_RUN)) && ! ((SKIP_DOCKER && SKIP_FIREWALL)); then
  die "run this as root:  curl -fsSL https://raw.githubusercontent.com/$REPO/main/infra/get.sh | sudo bash"
fi

say "${B}VTT Chat server installer${N}"

# ---------- 1. the machine ----------
step "Checking this machine"
OS_ID="" OS_VERSION=""
if [[ -r /etc/os-release ]]; then OS_ID=$(. /etc/os-release && echo "${ID:-}"); OS_VERSION=$(. /etc/os-release && echo "${VERSION_ID:-}"); fi
case $OS_ID in
  ubuntu | debian) say "  $OS_ID $OS_VERSION: supported" ;;
  *) warn "this is ${OS_ID:-an unknown system}; the installer is written for Ubuntu Server (22.04 or newer) and may not work" ;;
esac
[[ $(uname -m) == x86_64 || $(uname -m) == aarch64 ]] || warn "unusual CPU ($(uname -m)); the images are built for x86-64 and arm64"
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)
disk_gb=$(df -Pk "$(dirname "$DIR")" 2>/dev/null | awk 'NR==2 {print int($4/1048576)}' || echo 0)
say "  memory ${mem_mb} MB, free disk ${disk_gb} GB"
((mem_mb >= 3500)) || warn "less than 4 GB of memory: chat and voice are fine, recording and summaries need more (8 GB or more)"
((disk_gb >= 15)) || warn "less than 15 GB free: recordings and the AI models need room (30 GB or more is comfortable)"

# A minimal Ubuntu install lacks things this script and the guide lean on (curl, tar, openssl, gpg, ss, nano...). Fetch what is missing.
declare -A PKG_FOR=([curl]=curl [tar]=tar [openssl]=openssl [gpg]=gnupg [ss]=iproute2 [hostname]=hostname [getent]=libc-bin [nano]=nano [awk]=gawk [sed]=sed [grep]=grep)
missing_pkgs=(ca-certificates)
for tool in "${!PKG_FOR[@]}"; do command -v "$tool" >/dev/null 2>&1 || missing_pkgs+=("${PKG_FOR[$tool]}"); done
if ((${#missing_pkgs[@]} > 1)) || ! dpkg -s ca-certificates >/dev/null 2>&1; then
  step "Installing small tools this minimal system lacks: ${missing_pkgs[*]}"
  apt_q update
  apt_q install -y "${missing_pkgs[@]}"
fi

# ---------- 2. the questions ----------
step "A few questions"
if [[ -z $DOMAIN ]]; then
  say "  Players will open this address in a browser. It needs a DNS record pointing at the public IP of this machine"
  say "  (an \"A\" record) before the secure certificate can be issued."
  ask DOMAIN "Your domain name (for example vtt.example.com)"
fi
DOMAIN=$(printf '%s' "$DOMAIN" | tr '[:upper:]' '[:lower:]' | sed 's#^https\?://##; s#/.*$##')
valid_domain "$DOMAIN" || die "\"$DOMAIN\" does not look like a domain name"

EXISTING=0
[[ -f $DIR/.env ]] && EXISTING=1
if ((EXISTING)); then
  say "  An install already exists in $DIR: it will be updated and your data and secrets kept."
else
  ((NO_ADMIN)) || [[ -n $EMAIL ]] || ask EMAIL "Your email address (it becomes the Admin account; nothing is sent to it)"
  ((NO_ADMIN)) || valid_email "$EMAIL" || die "\"$EMAIL\" does not look like an email address"
  if ((NO_ADMIN)); then :; elif [[ -z $NAME ]]; then if ((ASSUME_YES)); then NAME=${EMAIL%%@*}; else ask NAME "Your name, as players will see it" "${EMAIL%%@*}"; fi; fi
  if [[ -z $WITH_RECORDS ]]; then
    say "  Recording keeps a searchable history of each session with AI summaries, all on this server."
    say "  It downloads about 6 GB of models and wants 8 GB of memory; you can add it later."
    if confirm "Turn on recording and summaries now?" n; then WITH_RECORDS=1; else WITH_RECORDS=0; fi
  fi
fi

if [[ $WITH_RECORDS == 1 && $RECORDS_PROFILE == records && $(uname -m) == x86_64 ]] && ! grep -qm1 -w avx /proc/cpuinfo 2>/dev/null; then
  warn "this CPU has no AVX, which the local Whisper and LLM need (they would crash). Recording will run here, but the AI must run on another machine:"
  say "    after the install: vtt-admin settings set ai.transcription.kind remote, ai.transcription.url, ai.llm.kind remote, ai.llm.url (operator guide: a gaming PC as the AI), and ai.fallback.enabled false"
  RECORDS_PROFILE=records-remote
fi

# ---------- 3. which release ----------
step "Choosing the release"
if [[ -z $VERSION && $EXISTING == 1 && -f $DIR/.installed-version ]]; then
  # An update stays on the installed MAJOR.MINOR line: a new minor changes how server and apps talk, and is a deliberate
  # upgrade (name it with --version), never something a plain re-run does.
  cur=$(tr -d '[:space:]' < "$DIR/.installed-version"); cur=${cur#v}; line=${cur%%-*}; line=${line%.*}
  stable_only=1; [[ $cur == *-* ]] && stable_only=0
  VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=50" 2>/dev/null | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' \
    | grep -E "^v${line//./\\.}\.[0-9]+(-.*)?$" | { if ((stable_only)); then grep -v -- '-'; else cat; fi; } | head -1 || true)
  [[ -n $VERSION ]] || { VERSION=$cur; say "  no newer release of the $line line found; keeping $cur"; }
fi
if [[ -z $VERSION ]]; then
  VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1 || true)
  [[ -n $VERSION ]] || die "could not find the newest release on GitHub; name one with --version (for example --version 0.4.0)"
fi
TAG="v${VERSION#v}"
IMAGE_VERSION=$(version_for_images "$TAG")
say "  release $TAG (images: $IMAGE_VERSION)"

# ---------- 4. network ----------
step "Checking the network"
local_ips=$(hostname -I 2>/dev/null || true)
if [[ -z $PUBLIC_IP ]]; then
  detected=$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)
  if [[ $detected =~ ^[0-9.]+$ ]]; then
    say "  public address: $detected"
    # If this machine does not carry that address itself, it is behind NAT: LiveKit must be told to advertise it.
    if [[ " $local_ips " != *" $detected "* ]]; then PUBLIC_IP=$detected; say "  (behind NAT: LiveKit will advertise $detected)"; fi
  else
    warn "could not find the public address; if this machine is behind a router, re-run with --public-ip <address>"
  fi
fi
if [[ $DOMAIN != localhost ]] && ((TUNNEL == 0)); then
  resolved=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1 {print $1}' || true)
  expected=${PUBLIC_IP:-${detected:-}}
  if [[ -z $resolved ]]; then
    warn "$DOMAIN does not resolve yet. Add a DNS \"A\" record pointing it at ${expected:-the public IP of this machine}; the certificate is issued once it does."
    ((ASSUME_YES)) || confirm "Carry on anyway?" y || die "stopped: set the DNS record and run this again"
  elif is_cloudflare_ip "$resolved"; then
    BEHIND_CLOUDFLARE=1
    say "  $DOMAIN goes through Cloudflare's proxy ($resolved): the website is protected, voice goes straight to this machine."
    if [[ -z $PUBLIC_IP && ${detected:-} =~ ^[0-9.]+$ ]]; then PUBLIC_IP=$detected; fi
    if [[ -n $PUBLIC_IP ]]; then say "  voice will be advertised at $PUBLIC_IP (change later: vtt-admin voice-address <ip|name|auto>)"; else
      warn "could not find this machine's public address; re-run with --voice-address <ip or name>"; fi
    say "    In Cloudflare: SSL/TLS mode \"Full (strict)\"; the voice ports below must reach this machine directly (no proxy, no tunnel)."
  elif [[ -n $expected && $resolved != "$expected" ]]; then
    warn "$DOMAIN points at $resolved but the public address of this machine is $expected. The secure certificate will not be issued until they match."
    ((ASSUME_YES)) || confirm "Carry on anyway?" n || die "stopped: fix the DNS record and run this again"
  else
    say "  $DOMAIN -> $resolved: good"
  fi
fi

if ((DRY_RUN)); then
  step "Dry run: nothing below was done"
  say "  would install Docker (unless present), fetch $TAG to $DIR, run setup.sh for $DOMAIN, start the stack,"
  say "  create the Admin ${EMAIL:-(existing)} and print a sign-in code."
  exit 0
fi

# ---------- 5. Docker ----------
if docker compose version >/dev/null 2>&1; then
  say "  Docker with Compose: present"
elif ((SKIP_DOCKER)); then
  die "Docker with the Compose plugin is not installed (and --skip-docker-install was given)"
else
  step "Installing Docker"
  [[ $OS_ID == ubuntu || $OS_ID == debian ]] || die "automatic Docker install supports Ubuntu and Debian; install Docker and re-run with --skip-docker-install"
  codename=$(. /etc/os-release && echo "${VERSION_CODENAME:-}")
  apt_q update
  apt_q install -y ca-certificates curl gnupg
  if curl -fsSI "https://download.docker.com/linux/$OS_ID/dists/$codename/InRelease" >/dev/null 2>&1; then
    say "  from the official Docker apt repository ($codename)"
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/$OS_ID/gpg" -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$OS_ID $codename stable" \
      > /etc/apt/sources.list.d/docker.list
    apt_q update
    apt_q install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  else
    # A release newer than Docker's repository knows about: the distribution's own packages are current enough.
    say "  Docker's repository has no $codename yet; using the distribution's docker.io and docker-compose-v2"
    apt_q install -y docker.io docker-compose-v2
  fi
  systemctl enable --now docker >/dev/null 2>&1 || true
  docker compose version >/dev/null 2>&1 || die "Docker installed but \"docker compose\" does not work"
fi

# ---------- 5b. are the ports free? ----------
# Skip only when our own stack is the one running (an update); a half-finished earlier attempt must still be checked.
own_running=0
if ((EXISTING)) && [[ -f $DIR/compose.yml ]] && [[ -n $(cd "$DIR" && docker compose ps -q 2>/dev/null) ]]; then own_running=1; fi
if ((own_running == 0)) && command -v ss >/dev/null 2>&1; then
  busy=""
  for port in 80 443 7880 7881; do
    who=$(ss -Hltnp 2>/dev/null | awk -v p=":$port" '$4 ~ p"$" {print $NF}' | sort -u | head -2 | tr '\n' ' ')
    [[ -n $(ss -Hltn 2>/dev/null | awk -v p=":$port" '$4 ~ p"$"') ]] && busy+="    $port/tcp  ${who:-(something is listening)}\n"
  done
  if [[ -n $busy ]]; then
    printf '%s\n' "${R}These ports are already in use on this machine, and VTT Chat needs them:${N}" >&2
    printf '%b' "$busy" >&2
    say "  Another web server, a proxy, or an earlier install is using them. Stop it (find it with: ss -ltnp), then run this again."
    say "  Docker containers using them:  docker ps --format '{{.Names}}  {{.Ports}}' | grep -E ':(80|443|7880|7881)->'"
    die "ports busy; nothing was changed"
  fi
fi

# ---------- 6. the bundle ----------
step "Downloading the server bundle ($TAG)"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/tags/$TAG" -o "$tmp/bundle.tar.gz" \
  || die "could not download $TAG (is the version right? releases: https://github.com/$REPO/releases)"
mkdir -p "$tmp/src"
tar -xzf "$tmp/bundle.tar.gz" -C "$tmp/src" --strip-components=1 --wildcards '*/infra/compose/*' '*/tauri-client/Cargo.toml' 2>/dev/null \
  || die "the download for $TAG did not contain the server bundle"
[[ -f $tmp/src/infra/compose/compose.yml ]] || die "the download for $TAG has no infra/compose/compose.yml"

mkdir -p "$DIR"
# The bundle files are replaced; .env, livekit.yaml and the Docker volumes (your data) are never touched.
for f in "$tmp"/src/infra/compose/*; do
  base=$(basename "$f")
  [[ $base == .env || $base == livekit.yaml ]] && continue
  cp -rf "$f" "$DIR/$base"
done
chmod +x "$DIR"/*.sh "$DIR/vtt-admin" 2>/dev/null || true
echo "$TAG" > "$DIR/.installed-version"

# ---------- 7. configure, pull, start ----------
cd "$DIR"
if ((EXISTING)); then
  step "Updating the existing install"
  # Keep the operator's settings; only move the image version (and the domain if it changed).
  sed -i "s|^VTT_VERSION=.*|VTT_VERSION=$IMAGE_VERSION|; s|^SITE_ADDRESS=.*|SITE_ADDRESS=$DOMAIN|" .env
  if [[ $WITH_RECORDS == 1 ]] && ! grep -q '^COMPOSE_PROFILES=' .env; then echo "COMPOSE_PROFILES=$RECORDS_PROFILE" >> .env; say "  recording and summaries: on"; fi
else
  step "Writing the configuration (fresh secrets, never shown)"
  VTT_VERSION="$IMAGE_VERSION" ./setup.sh "$DOMAIN" ${PUBLIC_IP:+"$PUBLIC_IP"}
  if [[ $WITH_RECORDS == 1 ]]; then echo "COMPOSE_PROFILES=$RECORDS_PROFILE" >> .env; say "  recording and summaries: on ($RECORDS_PROFILE)"; fi
fi
if ((TUNNEL)); then
  grep -q '^CADDY_SITE=' .env || echo "CADDY_SITE=http://$DOMAIN" >> .env
  grep -q '^CLIENT_IP_HEADERS=' .env || echo "CLIENT_IP_HEADERS=CF-Connecting-IP" >> .env
  say "  website through a Cloudflare Tunnel: Caddy serves plain HTTP on port 80"
elif ((BEHIND_CLOUDFLARE)); then
  # Caddy then sees Cloudflare's addresses, not the visitors': trust Cloudflare to say who they are.
  grep -q '^TRUSTED_PROXIES=' .env || {
    echo "TRUSTED_PROXIES=private_ranges $CLOUDFLARE_RANGES"
    echo "CLIENT_IP_HEADERS=CF-Connecting-IP"
  } >> .env
fi

step "Downloading the server images"
docker compose pull

step "Starting VTT Chat"
docker compose up -d --wait --wait-timeout 600 || {
  warn "the stack did not become healthy in time; recent logs:"
  docker compose ps || true
  docker compose logs --tail 30 backend caddy 2>/dev/null || true
  die "see the lines above; fix and run this installer again (it is safe to repeat)"
}

# The command everyone uses afterwards: a small launcher, so it works whichever bundle version is installed.
printf '#!/bin/sh\nexec "%s/vtt-admin" "$@"\n' "$DIR" > /usr/local/bin/vtt-admin 2>/dev/null && chmod 755 /usr/local/bin/vtt-admin || warn "could not link /usr/local/bin/vtt-admin; run it as $DIR/vtt-admin"

# ---------- 8. firewall ----------
FW_NOTE=""
if ((SKIP_FIREWALL)); then
  FW_NOTE="skipped (--skip-firewall)"
elif command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  step "Opening the needed ports in the firewall (ufw)"
  ufw allow 22/tcp >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 443/udp >/dev/null
  ufw allow 7881/tcp >/dev/null
  ufw allow 50000:50200/udp >/dev/null
  FW_NOTE="opened in ufw on this machine"
else
  FW_NOTE="no active firewall found on this machine"
fi

# ---------- 9. is it up? ----------
step "Checking it works"
local_ok=0 public_ok=0
for _ in $(seq 1 30); do
  if ((TUNNEL)); then
    curl -fsS --max-time 5 -H "Host: $DOMAIN" "http://127.0.0.1/api/health" >/dev/null 2>&1 && { local_ok=1; break; }
  elif curl -fsS --max-time 5 -k --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/health" >/dev/null 2>&1; then local_ok=1; break; fi
  sleep 2
done
if ((local_ok)); then say "  the server answers on this machine"; else warn "the server did not answer locally; check: docker compose -f $DIR/compose.yml logs backend caddy"; fi
if [[ $DOMAIN != localhost ]] && ((TUNNEL == 0)); then
  say "  waiting for the secure certificate (up to 2 minutes)..."
  for _ in $(seq 1 24); do
    if curl -fsS --max-time 6 "https://$DOMAIN/api/health" >/dev/null 2>&1; then public_ok=1; break; fi
    sleep 5
  done
  if ((public_ok)); then say "  https://$DOMAIN works with a valid certificate"; else
    warn "https://$DOMAIN is not reachable with a valid certificate yet. This is usually DNS (not pointing here yet) or ports 80/443 blocked at your router or cloud firewall. It retries by itself; see the notes below."
  fi
fi

# ---------- 10. the first Admin ----------
CODE_OUT=""
if ((EXISTING)); then
  say "  existing accounts kept"
elif ((NO_ADMIN)); then
  say "  no Admin created (--no-admin). Make one with: vtt-admin user create <email> --name <name> --accept-consent --admin   then: vtt-admin user code <email> signin"
else
  step "Creating your Admin account"
  say "  (This records that you accept the recording notice; players see it before joining.)"
  if ./vtt-admin user create "$EMAIL" --name "$NAME" --accept-consent >/dev/null 2>&1; then say "  created $EMAIL (Admin)"; else say "  $EMAIL already existed; reusing it"; fi
  CODE_OUT=$(./vtt-admin user code "$EMAIL" signin 2>/dev/null | tail -1 || true)
fi

# ---------- done ----------
site="https://$DOMAIN"
cat <<EOF

${G}${B}VTT Chat is running.${N}

  ${B}Open${N}           $site
EOF
if [[ -n $CODE_OUT ]]; then
  cat <<EOF
  ${B}Sign in with${N}   the code ${B}${CODE_OUT}${N}   (works once, about 15 minutes)
                   On the site choose "Sign in", then "I have a sign-in code".
                   Need another? run:  vtt-admin user code $EMAIL signin
EOF
fi
cat <<EOF

${B}Ports${N} (firewall on this machine: $FW_NOTE)
  Your router or cloud provider's firewall must also let these through to this machine:
    80/tcp  443/tcp  7881/tcp  50000-50200/udp
  The website needs 80 and 443. Voice needs 7881/tcp and the UDP range, straight to this machine
  (not through Cloudflare); without them chat works but voice does not connect.

${B}Running the server${N}  (from any directory)
  vtt-admin status                          is everything healthy?
  vtt-admin user code <email> signin        a sign-in code for someone
  vtt-admin settings show                   every setting you can change
  vtt-admin help                            all commands
  cd $DIR && docker compose logs -f backend   what the server is saying
  cd $DIR && ./backup.sh                    a backup of everything (see the operator guide)

${B}Next${N}
  1. Open $site and sign in. You start with a sample campaign and you are its DM.
  2. In the app, make or rename your campaign and invite players (a link or a short code).
  3. Players open $site/download for the desktop app, or just use the web chat.
  4. Update later by running this installer again. Your data and settings stay.

Guide: https://github.com/$REPO/blob/main/docs/guides/OPERATOR-GUIDE.md
EOF
if ((TUNNEL)); then
  cat <<EOF

${Y}One step is yours:${N} in Cloudflare (Zero Trust > Networks > Tunnels) give your tunnel a public hostname ${B}$DOMAIN${N} with the service
${B}http://$(hostname -I | awk '{print $1}'):80${N} (this machine, if the tunnel runs elsewhere on your network), or run the tunnel from here:
  vtt-admin config set CLOUDFLARE_TUNNEL_TOKEN <token>   then:   cd $DIR && docker compose --profile tunnel up -d
(with the token service set to http://caddy:80). Voice does not use the tunnel: forward 7881/tcp and 50000-50200/udp to this machine.
EOF
elif ((public_ok == 0)) && [[ $DOMAIN != localhost ]]; then
  cat <<EOF

${Y}Not finished:${N} the secure address is not answering yet. Check that $DOMAIN points at ${PUBLIC_IP:-${detected:-this machine}}
and that ports 80 and 443 reach this machine, then run: vtt-admin status
EOF
fi
