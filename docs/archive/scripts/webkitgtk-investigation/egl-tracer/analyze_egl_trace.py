#!/usr/bin/env python3
"""Analyze a log produced by egl_trace.so / run.sh.

Pairs each ENTER with its matching EXIT (per thread + function), then checks
whether any eglCreateImageKHR / eglDestroyImageKHR call on one thread
overlapped in wall-clock time with one on a *different* thread against the
*same* EGL context. That overlap is the concrete signal for the race
hypothesis in ../../WEBKITGTK-NVIDIA-EGL-CRASH.md: GStreamer's gsteglimage.c
thread-confines eglDestroyImageKHR but not eglCreateImageKHR, so if WebKit's
compositor thread and GStreamer's streaming thread both touch the same EGL
context around the same moment, calls can overlap here.

Usage:
    python3 analyze_egl_trace.py [/tmp/egl_trace.log]
"""
import sys
from collections import defaultdict

TRACKED = ("eglCreateImageKHR", "eglDestroyImageKHR")


def parse(path):
    events = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            ns, tid, event, func, dpy, ctx, extra = line.split(",", 6)
            events.append({
                "ns": int(ns), "tid": int(tid), "event": event, "func": func,
                "dpy": dpy, "ctx": ctx, "extra": extra,
            })
    return events


def pair_intervals(events):
    """Match ENTER/EXIT per (tid, func) into completed call intervals."""
    open_calls = defaultdict(list)  # (tid, func) -> stack of ENTER events
    intervals = []
    for e in events:
        key = (e["tid"], e["func"])
        if e["event"] == "ENTER":
            open_calls[key].append(e)
        elif e["event"] == "EXIT":
            if open_calls[key]:
                start = open_calls[key].pop()
                intervals.append({
                    "func": e["func"], "tid": e["tid"], "ctx": start["ctx"],
                    "start": start["ns"], "end": e["ns"],
                    "extra_start": start["extra"], "extra_end": e["extra"],
                })
            # else: EXIT with no matching ENTER (log started mid-call) — skip
    return intervals


def overlaps(a, b):
    return a["start"] < b["end"] and b["start"] < a["end"]


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/egl_trace.log"
    events = parse(path)
    if not events:
        print(f"No events found in {path}")
        return

    intervals = pair_intervals(events)
    tracked = [iv for iv in intervals if iv["func"] in TRACKED]

    threads = sorted({e["tid"] for e in events})
    print(f"Parsed {len(events)} log lines from {path}")
    print(f"Threads seen: {threads}")
    print(f"Completed eglCreateImageKHR/eglDestroyImageKHR calls: {len(tracked)}")
    for func in TRACKED:
        n = sum(1 for iv in tracked if iv["func"] == func)
        print(f"  {func}: {n}")

    # Group by ctx (skip null/0 context — can't correlate those)
    by_ctx = defaultdict(list)
    for iv in tracked:
        if iv["ctx"] not in ("0x0", "(nil)", "0"):
            by_ctx[iv["ctx"]].append(iv)

    print(f"\nDistinct non-null EGL contexts seen in create/destroy calls: {len(by_ctx)}")

    races = []
    for ctx, ivs in by_ctx.items():
        ivs_sorted = sorted(ivs, key=lambda iv: iv["start"])
        for i in range(len(ivs_sorted)):
            for j in range(i + 1, len(ivs_sorted)):
                a, b = ivs_sorted[i], ivs_sorted[j]
                if a["tid"] == b["tid"]:
                    continue  # same thread can't race with itself
                if not overlaps(a, b):
                    continue
                races.append((ctx, a, b))

    print(f"\n{'=' * 60}")
    if not races:
        print("NO cross-thread overlap found on any shared EGL context.")
        print("This run does not confirm the race hypothesis. That's a real")
        print("negative result, not a null one — rerun a few times (the doc")
        print("notes the crash signature varies between runs) before treating")
        print("the hypothesis as ruled out.")
    else:
        print(f"FOUND {len(races)} cross-thread overlapping call(s) on a shared EGL context:\n")
        for ctx, a, b in races:
            print(f"  ctx={ctx}")
            print(f"    thread {a['tid']}: {a['func']}  [{a['start']} .. {a['end']}] ns")
            print(f"    thread {b['tid']}: {b['func']}  [{b['start']} .. {b['end']}] ns")
            overlap_ns = min(a["end"], b["end"]) - max(a["start"], b["start"])
            print(f"    overlap: {overlap_ns} ns\n")
        print("This is the concrete signal the source-level hypothesis in")
        print("WEBKITGTK-NVIDIA-EGL-CRASH.md predicts: unsynchronized")
        print("eglCreateImageKHR racing against another thread's EGL call on")
        print("the same context. Worth attaching this trace to the NVIDIA")
        print("and/or GStreamer bug reports as supporting evidence.")
    print("=" * 60)


if __name__ == "__main__":
    main()
