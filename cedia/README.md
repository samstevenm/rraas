# RACK & ROLL '26 — the CEDIA invitational

The invite-only layer on top of [RRaaS](../README.md), born at CEDIA Expo
2026 and hosted at **rickroll.win**. It runs like The Game: knowing about it
means you're playing it, and it ends when we say it ends. (It has not ended.)
CEDIA 2026 is season one — the schema carries an `event` column so future
shows can be future seasons; if it ever does end, the final scoreboard gets
committed here forever.

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

## Minting the Cloudflare API token (as-driven 2026-08-21, ~5 minutes)

Everything below deploys with ONE custom API token. Dashboard path:
**My Profile → API Tokens → Create Token → Create Custom Token**.

1. **Name** it (`rr26-cf-token` here) — name for the project, not the person.
2. **Permissions** — seven rows; the middle dropdown filters as you type:
   - Account · **Workers Scripts** · Edit (deploy the Worker)
   - Account · **Workers KV Storage** · Edit (photo/dedup storage)
   - Account · **D1** · Edit (the claim database)
   - Account · **Turnstile** · Edit (create the bot-check site)
   - Account · **Account Settings** · **Read** (lets wrangler find the
     account id — the only Read in the set)
   - Zone · **DNS** · Edit (the game domain's records)
   - Zone · **Workers Routes** · Edit (attach the custom domain)
3. **Zone Resources**: Include → **Specific zone** → the game domain only.
   Never leave "All zones" on a token a machine will hold.
4. **Client IP filtering**: optional; skip it if you'll deploy while
   traveling.
5. **TTL**: end date shortly after your event. A dead token is the best
   token.
6. **Continue to summary — and actually read it.** Ours was missing a row on
   the first pass (a stray click had deleted it); the summary is the last
   place you catch that. It should list every account permission AND the
   zone line.
7. **Create Token** → the secret shows ONCE. Straight into the password
   manager (and wherever your automation reads secrets from); never into a
   chat, a file, or a repo.

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

Teardown (IF The Game ever ends — Sam's call, not the calendar's) is the
same list in reverse, plus committing `2026-results.json` from
`/leaderboard.json` so the scoreboard outlives the game. Roadmap if it gets
traction: player-issued invitations, per-event seasons on the leaderboard.

## The one unskippable step

Print ONE sheet of labels and scan-test with three phones in bad light before
the full run. 203dpi thermal + small QR = physics, not vibes.
