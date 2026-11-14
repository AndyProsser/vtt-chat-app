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
valid_email a@b.co || fail "email"; ! valid_email a@b || fail "bad email"; ! valid_email "a b@c.de" || fail "email space"
for ip in 104.21.67.121 172.67.1.1 188.114.97.3 162.159.0.1; do is_cloudflare_ip "$ip" || fail "cloudflare $ip"; done
for ip in 148.222.0.23 8.8.8.8 104.15.0.1 172.63.0.1; do ! is_cloudflare_ip "$ip" || fail "not cloudflare $ip"; done
# the script refuses to run without root unless told it is a test run; and --help works
out=$("$here/get.sh" --yes --domain vtt.example.com --email a@b.co --version 0.4.0 2>&1 || true)
grep -q "run this as root" <<<"$out" || fail "root check"
"$here/get.sh" --help | grep -q -- '--domain' || fail "help"
echo "get.sh: all checks passed"
