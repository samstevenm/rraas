#!/usr/bin/env python3
"""Aggregate rickroll beacons into rickroll/leaderboard.json — runs on dsio.

nginx logs every GET /roll.gif?who=<sub> (empty_gif, dedicated access log,
format: "$time_iso8601 $arg_who"). This script tails that log incrementally
(inode+offset state survives logrotate: on rotation the old inode is finished
from the rotated file, then the fresh file is read from zero), counts rolls
per claimed subname, and atomically rewrites the static leaderboard the
rickroll page fetches. Counts are cumulative in the state file, so log
rotation never loses history. Stdlib only; scheduled by
atds-roll-aggregate.timer every minute.

Usage: roll_aggregate.py [--log F] [--state F] [--docroot D]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

LOG = "/var/log/nginx/atds-roll.log"
STATE = "/var/lib/exmen26/atds-rolls-state.json"
DOCROOT = "/var/www/at.diligentservices.io"


def _read_new_lines(log: Path, state: dict) -> list[str]:
    """Return unseen log lines, updating state's inode/offset. Handles one
    rotation (the .1 file) — enough for a 1-minute cadence vs daily rotate."""
    lines: list[str] = []
    try:
        st = log.stat()
    except FileNotFoundError:
        return lines
    if state.get("inode") == st.st_ino:
        start = state.get("offset", 0)
        if st.st_size < start:  # truncated in place (copytruncate)
            start = 0
    else:
        # rotated: drain the remainder of the previous inode first
        prev = log.with_name(log.name + ".1")
        try:
            pst = prev.stat()
            if pst.st_ino == state.get("inode"):
                with open(prev, "r", encoding="utf-8", errors="replace") as fh:
                    fh.seek(state.get("offset", 0))
                    lines.extend(fh.read().splitlines())
        except FileNotFoundError:
            pass
        start = 0
    with open(log, "r", encoding="utf-8", errors="replace") as fh:
        fh.seek(start)
        chunk = fh.read()
        state["inode"] = st.st_ino
        state["offset"] = start + len(chunk.encode("utf-8", errors="replace"))
    lines.extend(chunk.splitlines())
    return lines


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--log", default=LOG)
    ap.add_argument("--state", default=STATE)
    ap.add_argument("--docroot", default=DOCROOT)
    args = ap.parse_args(argv)

    docroot = Path(args.docroot)
    try:
        directory = json.loads((docroot / "directory.json").read_text())
        allow = {d["subname"] for d in directory if d.get("status") == "claimed"}
    except (OSError, ValueError):
        print("no readable directory.json — refusing to guess the allowlist",
              file=sys.stderr)
        return 1

    state_path = Path(args.state)
    try:
        state = json.loads(state_path.read_text())
    except (OSError, ValueError):
        state = {}
    counts: dict = state.setdefault("counts", {})

    for line in _read_new_lines(Path(args.log), state):
        parts = line.split()
        if len(parts) >= 2 and parts[1] in allow:
            counts[parts[1]] = counts.get(parts[1], 0) + 1

    out = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "rolls": {sub: counts.get(sub, 0) for sub in sorted(allow)},
    }

    state_path.parent.mkdir(parents=True, exist_ok=True)
    lb_dir = docroot / "rickroll"
    lb_dir.mkdir(parents=True, exist_ok=True)
    for path, payload in ((state_path, state), (lb_dir / "leaderboard.json", out)):
        fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-roll")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=1)
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    print(f"rolls: {out['rolls']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
