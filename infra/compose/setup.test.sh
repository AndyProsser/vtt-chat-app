#!/usr/bin/env bash
# Tests setup.sh in a scratch copy (never touches a real .env):  ./setup.test.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d); trap 'kill "${listener:-0}" 2>/dev/null || true; rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

mkdir -p "$tmp/infra/compose" "$tmp/tauri-client"
cp "$here/setup.sh" "$tmp/infra/compose/"
printf '[workspace.package]\nversion = "0.7.3"\n' > "$tmp/tauri-client/Cargo.toml"
run() { (cd "$tmp/infra/compose" && rm -f .env livekit.yaml && env "$@" ./setup.sh localhost >/dev/null); }
val() { sed -n "s/^$1=//p" "$tmp/infra/compose/.env"; }

# no git, no override: the MAJOR.MINOR line of Cargo.toml
run; [[ $(val VTT_VERSION) == 0.7 ]] || fail "cargo line, got $(val VTT_VERSION)"
# an override (a dev build) wins
run VTT_VERSION=0.7.0-dev.2; [[ $(val VTT_VERSION) == 0.7.0-dev.2 ]] || fail "override, got $(val VTT_VERSION)"
# a git tag: release tag -> line, dev tag -> exact
git -C "$tmp" init -q && git -C "$tmp" -c user.name=t -c user.email=t@t commit -q --allow-empty -m x
git -C "$tmp" tag v0.7.3; run; [[ $(val VTT_VERSION) == 0.7 ]] || fail "release tag, got $(val VTT_VERSION)"
git -C "$tmp" -c user.name=t -c user.email=t@t commit -q --allow-empty -m y; git -C "$tmp" tag v0.8.0-dev.5
run; [[ $(val VTT_VERSION) == 0.8.0-dev.5 ]] || fail "dev tag, got $(val VTT_VERSION)"
# a busy port moves the loopback ports up
if command -v ss >/dev/null && command -v python3 >/dev/null; then
  python3 -m http.server 38000 --bind 127.0.0.1 >/dev/null 2>&1 & listener=$!
  for _ in 1 2 3 4 5 6 7 8 9 10; do ss -Hltn | grep -q ':38000$' && break; sleep 0.3; done
  run BACKEND_PORT=38000 VALKEY_HOST_PORT=36379; [[ $(val BACKEND_PORT) == 38001 ]] || fail "busy backend port, got $(val BACKEND_PORT)"
  [[ $(val VALKEY_HOST_PORT) == 36379 ]] || fail "explicit valkey port kept"
fi
# secrets are not printed and the files are private
out=$(cd "$tmp/infra/compose" && rm -f .env livekit.yaml && ./setup.sh localhost)
grep -q "$(val POSTGRES_PASSWORD)" <<<"$out" && fail "a secret was printed"
[[ $(stat -c %a "$tmp/infra/compose/.env") == 600 ]] || fail ".env mode"
# voice address: an IP, a name, and auto
run_v() { (cd "$tmp/infra/compose" && rm -f .env livekit.yaml && ./setup.sh localhost "$1" >/dev/null); }
run_v 203.0.113.9; grep -q '^  node_ip: 203.0.113.9$' "$tmp/infra/compose/livekit.yaml" || fail "node_ip for an IP"
[[ $(val VOICE_ADDRESS) == 203.0.113.9 ]] || fail "VOICE_ADDRESS recorded"
run_v localhost; grep -q '^  node_ip: 127.0.0.1$' "$tmp/infra/compose/livekit.yaml" || fail "node_ip resolved from a name"
run_v auto; grep -q 'use_external_ip: true' "$tmp/infra/compose/livekit.yaml" && ! grep -q node_ip "$tmp/infra/compose/livekit.yaml" || fail "auto means STUN"
echo "setup.sh: all checks passed"
