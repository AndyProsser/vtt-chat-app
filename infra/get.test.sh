#!/usr/bin/env bash
# Tests the pure helpers of get.sh (no network, no root):  ./get.test.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
fail() { echo "FAIL: $*" >&2; exit 1; }
VTT_GET_SOURCE_ONLY=1 source "$here/get.sh"
[[ $(version_for_images v0.4.0) == 0.4 ]] || fail "release line"
[[ $(version_for_images 0.4.2) == 0.4 ]] || fail "patch to line"
[[ $(version_for_images v0.4.0-dev.6) == 0.4.0-dev.6 ]] || fail "dev pinned"
[[ $(version_for_images 1.0.0-rc.1) == 1.0.0-rc.1 ]] || fail "rc pinned"
for d in vtt.example.com a.b.co localhost; do valid_domain "$d" || fail "domain $d"; done
for d in "" nodots "a b.com" "-x.com" "http://x.com"; do ! valid_domain "$d" || fail "bad domain '$d'"; done
# --http / --port: which hosts and ports are accepted, and the address people open
valid_host 192.168.1.20 1 || fail "http mode takes an IP"; valid_host myserver 1 || fail "http mode takes a short name"; valid_host vtt.example.com 1 || fail "http mode takes a domain"
! valid_host 192.168.1.20 0 || fail "an IP needs --http"; ! valid_host myserver 0 || fail "a short name needs --http"; valid_host vtt.example.com 0 || fail "domain without --http"
! valid_host "a b" 1 || fail "space in host"; ! valid_host "" 1 || fail "empty host"
for c in clean default graphic; do valid_content "$c" || fail "content $c"; done
for c in Clean rude "" all; do ! valid_content "$c" || fail "bad content '$c'"; done
for p in 1 80 8443 65535; do valid_port "$p" || fail "port $p"; done
for p in 0 65536 abc "" -1 80.5; do ! valid_port "$p" || fail "bad port '$p'"; done
[[ $(site_origin https vtt.example.com 443) == https://vtt.example.com ]] || fail "origin default https"
[[ $(site_origin https vtt.example.com 8443) == https://vtt.example.com:8443 ]] || fail "origin custom https"
[[ $(site_origin http 192.168.1.20 80) == http://192.168.1.20 ]] || fail "origin default http"
[[ $(site_origin http 192.168.1.20 8080) == http://192.168.1.20:8080 ]] || fail "origin custom http"
[[ $(site_origin wss vtt.example.com 8443) == wss://vtt.example.com:8443 ]] || fail "origin wss"
[[ $(site_origin ws 10.0.0.5 80) == ws://10.0.0.5 ]] || fail "origin ws default"
env_file=$(mktemp); printf 'A=1\nB=2\n' > "$env_file"
set_env "$env_file" B "x|y"; set_env "$env_file" C 3
[[ $(cat "$env_file") == $'A=1\nB=x|y\nC=3' ]] || fail "set_env"; rm -f "$env_file"
valid_email a@b.co || fail "email"; ! valid_email a@b || fail "bad email"; ! valid_email "a b@c.de" || fail "email space"
for ip in 104.21.67.121 172.67.1.1 188.114.97.3 162.159.0.1; do is_cloudflare_ip "$ip" || fail "cloudflare $ip"; done
for ip in 148.222.0.23 8.8.8.8 104.15.0.1 172.63.0.1; do ! is_cloudflare_ip "$ip" || fail "not cloudflare $ip"; done
# HSTS is written once, and an existing file (even one the operator emptied) is left alone
hsts_dir=$(mktemp -d)
enable_hsts "$hsts_dir" || fail "hsts first write"
grep -q '^header Strict-Transport-Security "max-age=2592000"$' "$hsts_dir/tls.d/hsts.caddy" || fail "hsts header"
! grep -qi 'includeSubDomains\|preload' "$hsts_dir/tls.d/hsts.caddy" || fail "hsts must cover this hostname only"
: > "$hsts_dir/tls.d/hsts.caddy"
! enable_hsts "$hsts_dir" || fail "hsts rewritten"
[[ ! -s $hsts_dir/tls.d/hsts.caddy ]] || fail "hsts overwrote the operator's file"
rm -rf "$hsts_dir"
# an update removes only VTT Chat's own images, keeps the running version and the one before, and removes untagged leftovers
imgs='ghcr.io/andyprosser/vtt-chat-backend 0.5.2 aaa
ghcr.io/andyprosser/vtt-chat-backend 0.5.1 bbb
ghcr.io/andyprosser/vtt-chat-backend 0.5.0 ccc
ghcr.io/andyprosser/vtt-chat-whisper-compat 0.4.3 ddd
ghcr.io/andyprosser/vtt-chat-worker <none> eee
my.registry/team/vtt-chat-caddy 0.4.0-dev.2 fff
postgres 16-alpine ggg
ollama/ollama <none> hhh
example.com/other/vtt-chat-backend-tools 0.1 iii'
want='ghcr.io/andyprosser/vtt-chat-backend:0.5.0
ghcr.io/andyprosser/vtt-chat-whisper-compat:0.4.3
eee
my.registry/team/vtt-chat-caddy:0.4.0-dev.2'
[[ $(old_images 0.5.2 0.5.1 <<<"$imgs") == "$want" ]] || fail "old images"
[[ $(old_images 0.5.2 "" <<<"$imgs" | wc -l) == 5 ]] || fail "old images without a previous version"
[[ -z $(old_images 0.5.2 0.5.2 <<<"") ]] || fail "old images, none"
# the script refuses to run without root unless told it is a test run; and --help works
out=$("$here/get.sh" --yes --domain vtt.example.com --email a@b.co --version 0.4.0 2>&1 || true)
grep -q "run this as root" <<<"$out" || fail "root check"
"$here/get.sh" --help | grep -q -- '--domain' || fail "help"
"$here/get.sh" --help | grep -q -- '--http' || fail "help lists --http"
out=$("$here/get.sh" --yes --http --behind-tunnel --domain x 2>&1 || true); grep -q "pick one" <<<"$out" || fail "--http with a tunnel"
out=$("$here/get.sh" --yes --port 99999 --domain x.example.com 2>&1 || true); grep -q "1 to 65535" <<<"$out" || fail "bad --port"
echo "get.sh: all checks passed"
