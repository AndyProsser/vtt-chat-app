# Caddy with the Cloudflare DNS module, so it can get a real certificate through the DNS challenge (a Cloudflare API token)
# without inbound ports 80/443: for a server behind a Cloudflare Tunnel that still wants HTTPS everywhere, or any server
# whose line blocks those ports. Stock caddy:2-alpine lacks the module. Published as vtt-chat-caddy (images.yml).
FROM caddy:2-builder AS build
RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM caddy:2-alpine
COPY --from=build /usr/bin/caddy /usr/bin/caddy
