#!/usr/bin/env python3
"""Create (or find) the Turnstile widget for the game domain.

Uses CLOUDFLARE_API_TOKEN from the environment (run via cfrun.sh). Prints the
SITEKEY (public by design — it ships in the page HTML) and writes the widget
SECRET to stdout only as the final line prefixed SECRET= so the caller can
pipe it straight into `wrangler secret put` without it landing anywhere else.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request

API = "https://api.cloudflare.com/client/v4"
TOKEN = os.environ["CLOUDFLARE_API_TOKEN"]
DOMAIN = sys.argv[1] if len(sys.argv) > 1 else "rickroll.win"
NAME = sys.argv[2] if len(sys.argv) > 2 else "rr26"


def call(method: str, path: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(
        API + path,
        data=json.dumps(body).encode() if body else None,
        method=method,
        headers={"Authorization": f"Bearer {TOKEN}",
                 "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as resp:
        out = json.load(resp)
    if not out.get("success"):
        raise SystemExit(f"API error on {path}: {out.get('errors')}")
    return out["result"]


accounts = call("GET", "/accounts")
account_id = accounts[0]["id"]

widgets = call("GET", f"/accounts/{account_id}/challenges/widgets") or []
existing = [w for w in widgets if w.get("name") == NAME]
if existing:
    w = existing[0]
    print(f"widget exists: sitekey {w['sitekey']}", file=sys.stderr)
    # secret is only returned at creation; rotate to get a fresh one
    w = call("PUT",
             f"/accounts/{account_id}/challenges/widgets/{w['sitekey']}/rotate_secret",
             {"invalidate_immediately": False})
else:
    w = call("POST", f"/accounts/{account_id}/challenges/widgets", {
        "name": NAME,
        "domains": [DOMAIN],
        "mode": "managed",
    })
    print(f"widget created: sitekey {w['sitekey']}", file=sys.stderr)

print(f"SITEKEY={w['sitekey']}", file=sys.stderr)
print(w["secret"])  # stdout: pipe me into `wrangler secret put TURNSTILE_SECRET`
