# Footprint scripts: how much memory and CPU does an app really use?

The numbers in the [main README](../../README.md#how-light-is-it) come from these scripts, so anyone can repeat
them, and run the same test on **any other app** to compare like with like.

| OS      | Script                                                     | Memory it reports                                                         |
| ------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| Windows | [`test-memory-usage.ps1`](test-memory-usage.ps1)           | **Private working set** (what Task Manager's Details tab shows)           |
| Linux   | [`test-memory-usage.sh`](test-memory-usage.sh)             | **PSS**: each process's fair share of shared libraries (RSS is shown too) |
| macOS   | [`test-memory-usage-macos.sh`](test-memory-usage-macos.sh) | **Physical footprint** (Activity Monitor's "Memory"), via `vmmap`         |

All three do the same thing: find the app's process, walk down its **whole process tree** (an app is rarely one
process: helpers, a web view, a GPU process), sample every 5 seconds, and print one line:

```text
10 processes, private working set: avg 189.2 MB, peak 197.8 MB; CPU avg 0.00% of the whole machine
```

CPU is the tree's share of the **whole machine** (100% = every core busy), so it compares across computers.

## Run it

```powershell
# Windows (PowerShell). The name is from Task Manager > Details, without ".exe".
.\test-memory-usage.ps1                          # VTT Chat, 60 seconds
.\test-memory-usage.ps1 -Name Discord -Seconds 120
```

```bash
# Linux
./test-memory-usage.sh                           # VTT Chat, 60 seconds
./test-memory-usage.sh -n discord -s 120         # -n: case-insensitive match on the process name
# macOS (works with the bash 3.2 macOS ships)
./test-memory-usage-macos.sh -n Discord -s 120
```

To find a name: Windows, Task Manager > Details; Linux, `ps -eo pid,ppid,comm,rss --sort=-rss | head -20`; macOS,
`ps -axo pid,ppid,comm,rss | sort -k4 -n -r | head -20`. `-p <pid>` / `-RootPid <pid>` measures one process and its
children instead of matching a name.

## Comparing apps fairly

1. **Same states, same length.** For each app measure: (a) _idle to the tray or minimised_, (b) _window open, connected,
   no interaction_ (this is what "Test 1" means below), (c) _window open and used hard_ (open and close everything), (d) _in
   voice with someone talking_. 60 to 120 seconds each. Let the app settle for a minute after launching it.
2. **Same machine**, nothing else changing, and write down the app version and OS version.
3. **Log in first.** A signed-out Discord or a disconnected VTT Chat is not the app people run.
4. **Report the line as printed**, with the state, the OS and the version. Do not mix metrics (a private working set
   against an RSS number is not a comparison).

## Prove the script works: `--self-test`

```bash
./test-memory-usage.sh --self-test         # Linux      (needs python3)
./test-memory-usage-macos.sh --self-test   # macOS      (needs perl)
.\test-memory-usage.ps1 -SelfTest          # Windows
```

It starts a **known** workload (a parent holding about 100 MB, with a child holding about 100 MB and spinning one
core), measures it, and checks that the script saw both processes, about 200 MB, and about one busy core. It
prints `SELF-TEST PASSED`, or says what was wrong and exits non-zero. Run it on a new machine before trusting a number.

## What has been verified, and what has not

- **Linux script:** self-test passes; shellcheck clean; its reading of VTT Chat matched a manual `/proc` check (about
  173 MB PSS against 172 MB).
- **macOS script:** the self-test passes **on Linux**, which exercises the process-tree walk, the `ps` parsing, the CPU
  maths and the RSS fallback. The `vmmap` footprint path (the real macOS numbers) has **not been run on a Mac**: run
  `--self-test` there first, and report the output line if it says `RSS fallback`.
- **Windows script:** the measuring logic is the original, used for the published Windows numbers. The `-SelfTest`
  mode and the friendlier errors were added later and have **not been run on Windows yet**.

## Limits

- Memory and CPU are not the whole cost: GPU use, disk, network and battery are not measured here.
- The tree is found by process name and parentage. An app that launches helpers outside its own tree (or a service) is
  undercounted; the printed process count is the thing to check.
- Everyone's machine, drivers and settings differ. These are comparisons of the same tests on one machine, not benchmarks.
