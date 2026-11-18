#!/usr/bin/env bash
# Measures the memory and CPU an app really uses on Linux: the app's whole process tree (its helpers and web
# view included), memory as PSS (each process's fair share of shared libraries; plain RSS double-counts them),
# CPU as a share of the whole machine. The same line of output as test-memory-usage.ps1 (Windows).
#
#   ./test-memory-usage.sh                      # VTT Chat, 60 seconds
#   ./test-memory-usage.sh -n discord -s 120    # any app: -n is a case-insensitive match on the process name
#   ./test-memory-usage.sh -p 12345             # one process (and its children) by pid
#   ./test-memory-usage.sh --self-test          # prove the script measures correctly (needs python3)
#
# Find an app's process name with:  ps -eo pid,ppid,comm,rss --sort=-rss | head -20
# See scripts/test/README.md for how to compare apps fairly.
set -euo pipefail

name='vtt-chat-app'
seconds=60
root_pid=''
self_test=0
while (($#)); do
  case $1 in
    -n | --name) name=${2:?-n needs a process name}; shift 2 ;;
    -s | --seconds) seconds=${2:?-s needs a number}; shift 2 ;;
    -p | --pid) root_pid=${2:?-p needs a pid}; shift 2 ;;
    --self-test) self_test=1; shift ;;
    -h | --help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done
if ! [[ $seconds =~ ^[0-9]+$ ]] || ((seconds < 5)); then
  echo 'seconds must be a whole number, 5 or more' >&2
  exit 2
fi

cores=$(nproc)
tck=$(getconf CLK_TCK)

# Every pid in the trees under the given root pids (the roots included), one per line.
tree() {
  ps -eo pid=,ppid= | awk -v roots="$*" '
    BEGIN { n = split(roots, r, " "); for (i = 1; i <= n; i++) keep[r[i]] = 1 }
    { pp[$1] = $2; ord[NR] = $1 }
    END {
      do { changed = 0
        for (i = 1; i <= NR; i++) { p = ord[i]; if (!(p in keep) && (pp[p] in keep)) { keep[p] = 1; changed = 1 } }
      } while (changed)
      for (p in keep) print p
    }'
}

roots() {
  if [[ -n $root_pid ]]; then echo "$root_pid"; else pgrep -i -- "$name" | grep -vx "$$" || true; fi
}

measure() {
  local interval=5 samples=$((seconds / 5 + 1)) i pid count=0 maxcount=0
  declare -A prev=()
  local -a pss_samples=() rss_samples=()
  local cpu_ticks=0 start end
  start=$(date +%s.%N)
  for ((i = 0; i < samples; i++)); do
    local r pids pss=0 rss=0
    r=$(roots)
    [[ -n $r ]] || { echo "no running process matches '$name' (try: ps -eo pid,comm --sort=-rss | head)" >&2; return 1; }
    # shellcheck disable=SC2086
    pids=$(tree $r)
    count=0
    for pid in $pids; do
      [[ -r /proc/$pid/smaps_rollup && -r /proc/$pid/stat ]] || continue
      local p_r ticks
      p_r=$(awk '/^Pss:/{p=$2} /^Rss:/{r=$2} END{print p+0, r+0}' "/proc/$pid/smaps_rollup" 2>/dev/null) || continue
      pss=$((pss + ${p_r% *})); rss=$((rss + ${p_r#* }))
      # utime + stime (fields 14 and 15), after the closing parenthesis of the name, which may hold spaces.
      ticks=$(sed 's/^.*) //' "/proc/$pid/stat" 2>/dev/null | awk '{print $12 + $13}') || continue
      if [[ -n ${prev[$pid]:-} ]]; then cpu_ticks=$((cpu_ticks + ticks - prev[$pid])); fi
      prev[$pid]=$ticks
      count=$((count + 1))
    done
    ((count > maxcount)) && maxcount=$count
    pss_samples+=("$pss"); rss_samples+=("$rss")
    ((i < samples - 1)) && sleep "$interval"
  done
  end=$(date +%s.%N)
  awk -v n="$maxcount" -v ticks="$cpu_ticks" -v tck="$tck" -v cores="$cores" -v t0="$start" -v t1="$end" \
      -v pss="${pss_samples[*]}" -v rss="${rss_samples[*]}" '
    function stats(s, a,   k, m, sum, mx) { m = split(s, a, " "); sum = 0; mx = 0
      for (k = 1; k <= m; k++) { sum += a[k]; if (a[k] > mx) mx = a[k] }; return sum / m / 1024 " " mx / 1024 }
    BEGIN { split(stats(pss), p, " "); split(stats(rss), r, " ")
      cpu = ticks / tck / (t1 - t0) / cores * 100
      printf "%d processes, PSS: avg %.1f MB, peak %.1f MB (RSS avg %.1f MB); CPU avg %.2f%% of the whole machine\n", n, p[1], p[2], r[1], cpu }'
}

if ((self_test)); then
  command -v python3 >/dev/null || { echo 'the self-test needs python3' >&2; exit 2; }
  # A parent holding ~100 MB, with a child that holds ~100 MB and spins one core: the script must see both.
  child='import time; b = bytearray(b"x") * (100 * 1024 * 1024); t = time.time()
while time.time() - t < 60: pass'
  python3 -c "import subprocess, sys, time
b = bytearray(b'x') * (100 * 1024 * 1024)
subprocess.Popen([sys.executable, '-c', sys.argv[1]])
time.sleep(60)" "$child" &
  fixture=$!
  trap 'pkill -P "$fixture" 2>/dev/null || true; kill "$fixture" 2>/dev/null || true' EXIT
  sleep 3
  root_pid=$fixture seconds=10
  out=$(measure)
  echo "$out"
  count=${out%% *}
  avg=$(sed -E 's/.*PSS: avg ([0-9.]+) MB.*/\1/' <<<"$out")
  cpu=$(sed -E 's/.*CPU avg ([0-9.]+)%.*/\1/' <<<"$out")
  ok=1
  ((count == 2)) || { echo "FAIL: expected the parent and its child (2 processes), saw $count"; ok=0; }
  awk -v a="$avg" 'BEGIN{exit !(a >= 170 && a <= 260)}' || { echo "FAIL: expected about 200 MB (two 100 MB holders), saw $avg MB"; ok=0; }
  awk -v c="$cpu" -v n="$cores" 'BEGIN{exit !(c >= 50 / n * 0.6)}' || { echo "FAIL: expected about one busy core ($((100 / cores))% of this machine), saw $cpu%"; ok=0; }
  ((ok)) && echo 'SELF-TEST PASSED: the script counts the whole tree, its memory, and its CPU correctly.'
  ((ok))
  exit $?
fi

measure
