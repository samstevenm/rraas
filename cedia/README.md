# RACK & ROLL '26 — the CEDIA invitational

The ephemeral, invite-only layer on top of [RRaaS](../README.md), built for
CEDIA Expo 2026 and hosted at **rickroll.win** until the show ends, at which
point the domain dies and the final scoreboard is committed here forever.
That's not a bug; that's rule 4.

## How it works

1. Sam, Connor, or Pearl decides you're interesting and hands you a card:
   *"I met SAM at CEDIA and they invited me to play RACK & ROLL '26"* + a QR
   + a ten-character code.
2. Scanning lands on your claim page: a pre-assigned codename
   (`velvet-turntable` — not negotiable), your name, a bio (links stripped),
   optional company/email (the email gets you a vCard on your page and a
   taunting message when you lose), optional photo (resized client-side;
   validated server-side; pixel avatar by default).
3. Your page rickrolls everyone YOU send it to. Every victim scores you a
   point. There is a leaderboard. There is also a recruiter race — claims,
   not cards handed out, so photographing someone's card stack buys nothing.
4. Cheating is a form of playing. Obvious curl loops earn a public badge
   instead of points.

## Architecture

One Cloudflare Worker with static assets, D1, and KV. D1 owns the one
invariant that matters — **multi-scan, single-claim** — via
`UPDATE ... WHERE claimed_at IS NULL` (KV can't do atomic test-and-set).
Pages are immutable after claim. Turnstile gates the claim form. Photos are
JPEG-sniffed server-side and served inert (`nosniff` + CSP sandbox), with a
global kill switch and a phone-usable admin page. The leaderboard JSON carries
only server-assigned slugs and charset-enforced names, so the federated tab on
the mothership renders it with `textContent` and nothing else.

```
worker/    worker.mjs (routes) · lib.mjs (tested pure functions) · schema.sql
site/      landing · leaderboard · admin · rr26.css (static assets binding)
tools/     mint_tokens.py (LOCAL ONLY output) · make_labels.py (card sheets)
tests/     node --test suite for lib.mjs
local/     gitignored: tokens.csv, seed.sql, label sheets — never committed
```

## Deploy (day-of runbook)

```
cd cedia/worker
wrangler d1 create rr26                # paste id into wrangler.toml
wrangler kv namespace create KV        # paste id into wrangler.toml
wrangler d1 execute rr26 --remote --file schema.sql
python3 ../tools/mint_tokens.py        # -> ../local/{tokens.csv,seed.sql}
wrangler d1 execute rr26 --remote --file ../local/seed.sql
wrangler secret put TURNSTILE_SECRET   # Turnstile site: dash.cloudflare.com
wrangler secret put ADMIN_SECRET
wrangler deploy
# attach custom domain rickroll.win to the worker (dashboard or API),
# then: python3 ../tools/make_labels.py --domain RICKROLL.WIN
```

Teardown is the same list in reverse, plus committing
`2026-results.json` from `/leaderboard.json` so the scoreboard outlives the
game.

## The one unskippable step

Print ONE sheet of labels and scan-test with three phones in bad light before
the full run. 203dpi thermal + small QR = physics, not vibes.
