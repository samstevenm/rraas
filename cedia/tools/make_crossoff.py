#!/usr/bin/env python3
"""Printable cross-off sheets, one per inviter. LOCAL ONLY output.

The physical fallback: a sheet of your word-pair codes with a checkbox by each.
Hand one out (say it, write it, or give the card), cross it off. Works even
when a QR won't scan or the printer dies. Same first-N codes as the NIIMBOT
labels, in the same order, so a crossed-off code == a handed-out card.

Usage: make_crossoff.py [--per-inviter 100] [--domain rickroll.win]
"""
from __future__ import annotations

import argparse
import csv
import html
from collections import defaultdict
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    here = Path(__file__).resolve().parents[1]
    ap.add_argument("--tokens", default=str(here / "local" / "tokens.csv"))
    ap.add_argument("--out", default=str(here / "local" / "crossoff"))
    ap.add_argument("--per-inviter", type=int, default=100)
    ap.add_argument("--domain", default="rickroll.win")
    args = ap.parse_args()

    with open(args.tokens, newline="") as fh:
        rows = list(csv.DictReader(fh))
    by_inviter: dict[str, list[str]] = defaultdict(list)
    for r in rows:
        by_inviter[r["inviter"]].append(r["token"])

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for inviter, codes in by_inviter.items():
        picked = codes[: args.per_inviter]
        items = "\n".join(
            f'<label class="c"><input type="checkbox"> {html.escape(code)}</label>'
            for code in picked)
        page = f"""<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>RACK &amp; ROLL '26 — {html.escape(inviter)}'s codes</title>
<style>
@page {{ size: letter; margin: 0.5in; }}
body {{ font-family: -apple-system, Helvetica, Arial, sans-serif; margin: 0;
       color: #111; }}
h1 {{ font-size: 15pt; margin: 0 0 1pt; }}
.sub {{ color: #555; font-size: 9.5pt; margin: 0 0 8pt; }}
.grid {{ column-count: 3; column-gap: 18pt; font-size: 9pt; }}
.c {{ display: block; break-inside: avoid; padding: 1.5pt 0;
      border-bottom: 0.5pt dotted #ccc; }}
input {{ vertical-align: middle; margin-right: 4pt; }}
.hdr {{ background: #7c5cff; color: #fff; padding: 4pt 8pt; font-weight: bold;
        display: inline-block; text-transform: uppercase; letter-spacing: .06em; }}
</style></head><body>
<h1><span class="hdr">{html.escape(inviter.upper())}</span> &mdash; RACK &amp; ROLL '26 codes</h1>
<p class="sub">Hand one out, cross it off. Anyone types it at
<strong>{html.escape(args.domain)}</strong> (or scans the matching card).
{len(picked)} codes &middot; these are yours &middot; a claim credits you.</p>
<div class="grid">
{items}
</div>
</body></html>"""
        (out / f"{inviter}.html").write_text(page, encoding="utf-8")
        print(f"{inviter}: {len(picked)} codes -> {out / (inviter + '.html')}")
    print("Print each to paper (Letter). Same codes/order as the NIIMBOT labels.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
