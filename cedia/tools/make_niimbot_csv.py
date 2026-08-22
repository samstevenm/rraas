#!/usr/bin/env python3
"""Emit NIIMBOT-importable CSVs (one per inviter) from tokens.csv. LOCAL ONLY.

The NIIMBOT app batch-prints from a CSV/Excel: you design ONE label template,
drop a QR element and text elements onto it, bind each to a column, then it
prints one label per row. This writes the columns to bind:

  url       HTTPS://RICKROLL.WIN/XXXXXXXXXX   -> the QR element (uppercase so
            the encoder uses alphanumeric mode = fewer modules = scannable
            small; the Worker matches tokens case-insensitively)
  code      XXXXXXXXXX                        -> the "can't scan? code ___" text
  inviter   SAM | CONNOR | PEARL              -> the "I met ___ at CEDIA" line
  codename  velvet-forklift                   -> optional; nice on the back

Output: cedia/local/niimbot/{sam,connor,pearl}.csv (gitignored). Import each
file on the phone that belongs to that person so their stack is theirs.

Usage: make_niimbot_csv.py [--per-inviter 100] [--domain RICKROLL.WIN]
"""
from __future__ import annotations

import argparse
import csv
from collections import defaultdict
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    here = Path(__file__).resolve().parents[1]
    ap.add_argument("--tokens", default=str(here / "local" / "tokens.csv"))
    ap.add_argument("--out", default=str(here / "local" / "niimbot"))
    ap.add_argument("--per-inviter", type=int, default=100)
    ap.add_argument("--domain", default="RICKROLL.WIN")
    ap.add_argument("--exclude-file",
                    help="file of already-claimed tokens (one per line) to skip "
                         "— dump from D1 so crew/test cards never get printed")
    args = ap.parse_args()

    exclude: set[str] = set()
    if args.exclude_file and Path(args.exclude_file).exists():
        exclude = {ln.strip() for ln in Path(args.exclude_file).read_text().splitlines()
                   if ln.strip()}

    with open(args.tokens, newline="") as fh:
        rows = list(csv.DictReader(fh))

    by_inviter: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if r["token"] in exclude:
            continue
        by_inviter[r["inviter"]].append(r)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for inviter, items in by_inviter.items():
        picked = items[: args.per_inviter]
        path = out / f"{inviter}.csv"
        with open(path, "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["url", "code", "inviter", "codename"])
            for r in picked:
                tok = r["token"]
                w.writerow([f"HTTPS://{args.domain}/{tok.upper()}", tok,
                            inviter.upper(), r["codename"]])
        print(f"{inviter}: {len(picked)} rows -> {path}")
    print("\nNIIMBOT app: New Label -> add QR bound to `url`, text bound to "
          "`code`/`inviter` -> import CSV -> Batch print. Print ONE first and "
          "scan-test on 3 phones in dim light.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
