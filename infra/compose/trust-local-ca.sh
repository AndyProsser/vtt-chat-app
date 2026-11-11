#!/usr/bin/env bash
# Trust this stack's Caddy local CA on this Linux machine, so the app and browsers accept
# https://localhost (the default SITE_ADDRESS for a local try-out). Run it from anywhere; it asks for
# your sudo password once. It only adds the CA's PUBLIC certificate (never the key).
# Remove again with:  sudo rm /usr/local/share/ca-certificates/vtt-chat-caddy-local.crt && sudo update-ca-certificates --fresh
set -euo pipefail
cd "$(dirname "$0")"

crt="$(mktemp)"
trap 'rm -f "$crt"' EXIT
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt "$crt"

sudo install -m 0644 "$crt" /usr/local/share/ca-certificates/vtt-chat-caddy-local.crt
sudo update-ca-certificates

# Chrome/Chromium and Firefox keep their own store; add it there too when certutil is installed.
if command -v certutil >/dev/null 2>&1 && [ -d "$HOME/.pki/nssdb" ]; then
  certutil -d "sql:$HOME/.pki/nssdb" -D -n vtt-chat-caddy-local >/dev/null 2>&1 || true
  certutil -d "sql:$HOME/.pki/nssdb" -A -t "C,," -n vtt-chat-caddy-local -i "$crt"
fi
echo "Trusted. Restart the app (and the browser) so they re-read the store."
