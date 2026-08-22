#!/usr/bin/env python3
"""Generate the invite cards/labels from tokens.csv. LOCAL ONLY output.

Two artifacts per run (into cedia/local/labels/, gitignored):
  labels.html      print-ready A4/Letter grid of cards (exact mm sizing via
                   CSS) — print on card stock, color-coded per inviter.
  png/TOKEN.png    one QR PNG per token, for feeding the NIIMBOT app if the
                   booth-printer theater is wanted.

QR discipline (the label is 12mm-class thermal at 203dpi — every module
counts): the encoded URL is ALL-UPPERCASE so segno picks alphanumeric mode
(fewer modules; DNS is case-insensitive and the Worker normalizes tokens),
error correction M. THE ONE UNSKIPPABLE STEP: physically print one sheet and
scan-test with 3 phones in dim light before the full run.

Usage: make_labels.py --domain RNR26.COM [--tokens cedia/local/tokens.csv]
"""
from __future__ import annotations

import argparse
import csv
import html
from pathlib import Path

import segno

CARD_W_MM, CARD_H_MM = 85, 54     # business-card size; NIIMBOT strips also fit
COLORS = {"sam": "#7c5cff", "connor": "#ff5c8a", "pearl": "#2dd4bf"}


def card(domain: str, token: str, inviter: str) -> str:
    url = f"HTTPS://{domain.upper()}/{token}"
    q = segno.make(url, error="m")
    qr_svg = q.svg_inline(scale=4, border=2)
    color = COLORS.get(inviter, "#888888")
    return f"""
<div class="card" style="border-color:{color}">
  <div class="strip" style="background:{color}"></div>
  <p class="meet">I met <strong>{html.escape(inviter.upper())}</strong> at CEDIA
  and they invited me to play</p>
  <p class="game">RACK &amp; ROLL '26</p>
  <div class="qr">{qr_svg}</div>
  <p class="fallback">can't scan? {html.escape(domain.upper())} &middot; code
  <strong>{token}</strong></p>
  <p class="rule">rule 1: you do not talk about RACK &amp; ROLL</p>
</div>"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    here = Path(__file__).resolve().parents[1]
    ap.add_argument("--domain", required=True, help="the short game domain")
    ap.add_argument("--tokens", default=str(here / "local" / "tokens.csv"))
    ap.add_argument("--out", default=str(here / "local" / "labels"))
    ap.add_argument("--limit", type=int, default=0, help="cards per inviter (0=all)")
    args = ap.parse_args()

    out = Path(args.out)
    (out / "png").mkdir(parents=True, exist_ok=True)

    with open(args.tokens, newline="") as fh:
        rows = list(csv.DictReader(fh))
    if args.limit:
        by = {}
        rows = [r for r in rows
                if by.setdefault(r["inviter"], []).append(r) or
                len(by[r["inviter"]]) <= args.limit]

    cards = []
    for r in rows:
        cards.append(card(args.domain, r["token"], r["inviter"]))
        url = f"HTTPS://{args.domain.upper()}/{r['token']}"
        segno.make(url, error="m").save(out / "png" / f"{r['token']}.png",
                                        scale=8, border=2)

    (out / "labels.html").write_text(f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>RR26 labels</title><style>
@page {{ margin: 8mm; }}
body {{ font-family: Verdana, sans-serif; display: flex; flex-wrap: wrap;
       gap: 4mm; margin: 0; }}
.card {{ width: {CARD_W_MM}mm; height: {CARD_H_MM}mm; border: 1.2mm solid;
         padding: 3mm; box-sizing: border-box; position: relative;
         page-break-inside: avoid; overflow: hidden; }}
.strip {{ position: absolute; top: 0; left: 0; right: 0; height: 2mm; }}
.meet {{ font-size: 8pt; margin: 2mm 0 0; }}
.game {{ font-size: 13pt; font-weight: bold; margin: 1mm 0; letter-spacing: 0.5pt; }}
.qr {{ width: 24mm; position: absolute; right: 3mm; top: 10mm; }}
.qr svg {{ width: 100%; height: auto; }}
.fallback {{ font-size: 7pt; margin: 1mm 0; max-width: 50mm; }}
.rule {{ font-size: 6pt; color: #666; position: absolute; bottom: 2mm; }}
</style></head><body>
{''.join(cards)}
</body></html>""", encoding="utf-8")

    print(f"{len(cards)} cards → {out}/labels.html (+ png/ for the NIIMBOT app)")
    print("PRINT ONE SHEET AND SCAN-TEST (3 phones, dim light) BEFORE THE RUN")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
