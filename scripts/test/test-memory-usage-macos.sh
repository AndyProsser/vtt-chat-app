#!/usr/bin/env bash
# Measures the memory and CPU an app really uses on macOS: the app's whole process tree (helpers and the WebKit
# web view included), memory as the PHYSICAL FOOTPRINT that Activity Monitor shows in its "Memory" column (from
# `vmmap -summary`), CPU as a share of the whole machine. Where vmmap cannot read a process (some protected
# apps), that process falls back to RSS, which overstates shared memory; the output says so.
# The same line of output as test-memory-usage.ps1 (Windows) and test-memory-usage.sh (Linux).
#
#   ./test-memory-usage-macos.sh                      # VTT Chat, 60 seconds
#   ./test-memory-usage-macos.sh -n Discord -s 120    # any app: -n is a case-insensitive match on the process name
#   ./test-memory-usage-macos.sh -p 12345             # one process (and its children) by pid
#   ./test-memory-usage-macos.sh --self-test          # prove the script measures correctly (uses perl)
#
# Find an app's process name with:  ps -axo pid,ppid,comm,rss | sort -k4 -n -r | head -20
# Works with the bash 3.2 that ships with macOS. See scripts/test/README.md for how to compare apps fairly.
set -euo pipefail

name='vtt-chat-app'
seconds=60
root_pid=''
self_test=0
while [ $# -gt 0 ]; do
  case $1 in
    -n | --name) name=${2:?-n needs a process name}; shift 2 ;;
    -s | --seconds) seconds=${2:?-s needs a number}; shift 2 ;;
    -p | --pid) root_pid=${2:?-p needs a pid}; shift 2 ;;
    --self-test) self_test=1; shift ;;
    -h | --help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done
case $seconds in '' | *[!0-9]*) echo 'seconds must be a whole number, 5 or more' >&2; exit 2 ;; esac
if [ "$seconds" -lt 5 ]; then echo 'seconds must be a whole number, 5 or more' >&2; exit 2; fi

cores=$(sysctl -n hw.logicalcpu 2>/dev/null || nproc)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# `ps` for every process: pid ppid rss(KB) cputime(seconds). cputime is [dd-][hh:]mm:ss(.cc).
snapshot() {
  ps -axo pid=,ppid=,rss=,cputime= | awk '
    { cpu = $4; days = 0
      if (cpu ~ /-/) { split(cpu, d, "-"); days = d[1]; cpu = d[2] }
      n = split(cpu, t, ":"); secs = 0
      for (i = 1; i <= n; i++) secs = secs * 60 + t[i]
      printf "%s %s %s %.2f\n", $1, $2, $3, secs + days * 86400 }'
}

# The pids of the trees under the root pids, one per line (reads a snapshot on stdin).
tree_of() {
  awk -v roots="$1" '
    BEGIN { n = split(roots, r, " "); for (i = 1; i <= n; i++) keep[r[i]] = 1 }
    { pp[$1] = $2; ord[NR] = $1; rss[$1] = $3; cpu[$1] = $4 }
    END {
      do { changed = 0
        for (i = 1; i <= NR; i++) { p = ord[i]; if (!(p in keep) && (pp[p] in keep)) { keep[p] = 1; changed = 1 } }
      } while (changed)
      for (p in keep) print p, rss[p], cpu[p]
    }'
}

find_roots() {
  if [ -n "$root_pid" ]; then echo "$root_pid"; return; fi
  # Match the process name (the last path component of the command), case-insensitively, never this script.
  ps -axo pid=,comm= | awk -v pat="$name" -v me="$$" 'BEGIN { pat = tolower(pat) }
    { pid = $1; $1 = ""; sub(/^ /, ""); n = split($0, parts, "/"); base = tolower(parts[n])
      if (pid != me && index(base, pat) > 0) print pid }' | tr '\n' ' '
}

# Physical footprint of one pid in KB from vmmap, or nothing when it cannot be read.
footprint_kb() {
  vmmap -summary "$1" 2>/dev/null | awk '/^Physical footprint:/ {
    v = $3; u = substr(v, length(v)); sub(/[KMG]$/, "", v)
    if (u == "G") v *= 1048576; else if (u == "M") v *= 1024; else if (u != "K") v = v / 1024
    printf "%d\n", v; exit }'
}

measure() {
  local interval=5 samples=$((seconds / 5 + 1)) i roots pid fp used_fallback=0 start end
  start=$(date +%s)
  : >"$work/samples"
  i=0
  while [ "$i" -lt "$samples" ]; do
    roots=$(find_roots)
    [ -n "$roots" ] || { echo "no running process matches '$name' (try: ps -axo pid,comm | sort -k2 | head)" >&2; return 1; }
    snapshot | tree_of "$roots" | while read -r pid rss cpu; do
      fp=''
      if command -v vmmap >/dev/null 2>&1; then fp=$(footprint_kb "$pid" || true); fi
      if [ -z "$fp" ]; then fp=$rss; echo "fallback" >>"$work/fallback"; fi
      echo "$i $pid $fp $rss $cpu" >>"$work/samples"
    done
    i=$((i + 1))
    [ "$i" -lt "$samples" ] && sleep "$interval"
  done
  end=$(date +%s)
  [ -s "$work/fallback" ] && used_fallback=1
  awk -v cores="$cores" -v secs=$((end - start)) -v fb="$used_fallback" '
    { s = $1; mem[s] += $3; rss[s] += $4; seen[s, $2] = 1; cnt[s]++
      if (($2) in last) { d = $5 - last[$2]; if (d > 0) cpu += d }
      last[$2] = $5; if (s > maxs) maxs = s }
    END {
      for (s = 0; s <= maxs; s++) { sum += mem[s]; rsum += rss[s]; if (mem[s] > peak) peak = mem[s]; if (cnt[s] > most) most = cnt[s] }
      n = maxs + 1
      printf "%d processes, %s: avg %.1f MB, peak %.1f MB (RSS avg %.1f MB); CPU avg %.2f%% of the whole machine\n",
        most, (fb ? "RSS fallback (overstates shared memory)" : "physical footprint"), sum / n / 1024, peak / 1024, rsum / n / 1024,
        cpu / secs / cores * 100 }' "$work/samples"
}

if [ "$self_test" -eq 1 ]; then
  command -v perl >/dev/null || { echo 'the self-test needs perl' >&2; exit 2; }
  # A parent holding ~100 MB, with a child that holds ~100 MB and spins one core: the script must see both.
  # (fork first and fill each buffer in place with vec, so no pages are shared and nothing is copied twice)
  perl -e 'my $n = 100 * 1024 * 1024;
    if (fork() == 0) { my $c = ""; vec($c, $n - 1, 8) = 1; for (my $i = 0; $i < $n; $i += 4096) { vec($c, $i, 8) = 1 } my $t = time; 1 while time - $t < 60; exit }
    my $b = ""; vec($b, $n - 1, 8) = 1; for (my $i = 0; $i < $n; $i += 4096) { vec($b, $i, 8) = 1 } sleep 60' &
  fixture=$!
  trap 'kill "$fixture" 2>/dev/null || true; rm -rf "$work"' EXIT
  sleep 3
  root_pid=$fixture
  seconds=10
  out=$(measure)
  echo "$out"
  count=${out%% *}
  avg=$(echo "$out" | sed -E 's/.*: avg ([0-9.]+) MB.*/\1/')
  cpu=$(echo "$out" | sed -E 's/.*CPU avg ([0-9.]+)%.*/\1/')
  ok=1
  [ "$count" -eq 2 ] || { echo "FAIL: expected the parent and its child (2 processes), saw $count"; ok=0; }
  awk -v a="$avg" 'BEGIN{exit !(a >= 170 && a <= 300)}' || { echo "FAIL: expected about 200 MB (two 100 MB holders), saw $avg MB"; ok=0; }
  awk -v c="$cpu" -v n="$cores" 'BEGIN{exit !(c >= 50 / n * 0.6)}' || { echo "FAIL: expected about one busy core, saw $cpu%"; ok=0; }
  [ "$ok" -eq 1 ] && echo 'SELF-TEST PASSED: the script counts the whole tree, its memory, and its CPU correctly.'
  [ "$ok" -eq 1 ]
  exit $?
fi

measure
