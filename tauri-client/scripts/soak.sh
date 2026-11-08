#!/usr/bin/env bash
# Soak test helper: samples the running app's CPU and memory once a minute so a long session
# ("4 hours, hidden, untouched" — ROADMAP Stage 4 definition of done) leaves evidence instead of a
# feeling. It only watches; run the session yourself (sign in, join voice, hide the window, survive a
# Wi-Fi drop and a laptop sleep) and read the summary at the end.
#
#   tauri-client/scripts/soak.sh [hours=4] [process-name=vtt-chat-app]
#
# Writes soak-<timestamp>.csv in the current directory: time, cpu_pct (last minute), rss_kb, threads.
set -euo pipefail

hours="${1:-4}"
name="${2:-vtt-chat-app}"
pid="$(pgrep -x "$name" | head -1 || true)"
[ -n "$pid" ] || { echo "no running process called $name" >&2; exit 1; }

out="soak-$(date +%Y%m%d-%H%M%S).csv"
tck="$(getconf CLK_TCK)"
echo "time,cpu_pct,rss_kb,threads" >"$out"
echo "watching pid $pid for ${hours}h -> $out (Ctrl+C to stop early)"

ticks() { awk '{print $14 + $15}' "/proc/$pid/stat"; }
end=$(( $(date +%s) + hours * 3600 ))
prev="$(ticks)"
while [ "$(date +%s)" -lt "$end" ] && [ -d "/proc/$pid" ]; do
  sleep 60
  [ -d "/proc/$pid" ] || { echo "process $pid exited" >&2; break; }
  now="$(ticks)"
  cpu="$(awk -v a="$prev" -v b="$now" -v h="$tck" 'BEGIN { printf "%.2f", (b - a) / h / 60 * 100 }')"
  rss="$(awk '/VmRSS/ {print $2}' "/proc/$pid/status")"
  thr="$(awk '/Threads/ {print $2}' "/proc/$pid/status")"
  echo "$(date +%H:%M:%S),$cpu,$rss,$thr" >>"$out"
  prev="$now"
done

awk -F, 'NR > 1 { n++; cpu += $2; if ($2 > maxc) maxc = $2; if (NR == 2) first = $3; last = $3; if ($3 > maxr) maxr = $3 }
  END { if (n) printf "samples=%d avg_cpu=%.2f%% max_cpu=%.2f%% rss_first=%dkB rss_last=%dkB rss_max=%dkB growth=%dkB\n", n, cpu / n, maxc, first, last, maxr, last - first }' "$out"
