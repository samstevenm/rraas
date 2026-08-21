# RRaaS — RickRoll as a Service

**Give everyone at your company a page at their own name, a downloadable
contact card, a QR code, and one Rick Astley surprise. All static files, no
backend, nothing to get owned.**

This is the stack behind `sam.at.diligentservices.io` and friends, built for
CEDIA 2026 by [Diligent Services](https://diligentservices.io). Business cards
are forgettable. A URL with a name in it is slightly less forgettable. A URL
that rickrolls people first is a conversation.

The pages idea is borrowed from [at.hn](https://at.hn), found on Hacker News.
This repo is our working production config, published as-is so another company
can fork it and swap the names.

## What you get

- `name.at.yourdomain.com` — an old-school, MySpace-flavored profile page per
  person ("Sam is in your extended network"). Photo left, bio right, links.
- **Save my card** — a vCard (`name.vcf`) generated at build time with phone,
  email, title, and the page URL.
- `name.at.yourdomain.com/qr` — a QR code for the page, sized for a badge.
- **The rickroll**: first visit per browser, ~10 seconds of the canonical
  video play before the profile appears. Skippable, once per browser
  (localStorage + cookie), with a real unmute button.
- `rickroll.at.yourdomain.com` — the full video plus a **leaderboard** of who
  has been rolled the most. Most rolls, most conversations.
- Unclaimed `*.at` names redirect to your main site instead of erroring.

## Design rules

1. **Static, not an app.** Flat TOML profiles → a stdlib-only Python builder →
   HTML, vCards, and QR SVGs. nginx serves files. There is no runtime
   write-path, no database, and no framework to patch.
2. **The rickroll counter has no backend either.** The pre-roll fires a beacon
   (`/roll.gif?who=sam`) served by nginx's built-in `empty_gif` into a
   dedicated access log. A one-minute systemd timer folds the log into a
   static `leaderboard.json`. Logrotate-safe (inode + offset state).
3. **A fail-closed safety gate.** Every profile passes a regex PII check
   before the builder will emit anything. A street address, a birthday, or a
   phone number outside the deliberate `[contact]` block kills the whole
   build, so one bad page can't slip out in a batch.
4. **TLS renews itself, including for names that don't exist yet.** Claimed
   names ride a normal SAN certificate (webroot). Everything else rides a
   wildcard certificate that renews unattended via `certbot dns-rfc2136`
   against a tiny delegated DNS zone (`_acme-challenge.at.yourdomain.com`)
   served by an authoritative-only bind9 on the same box, with a TSIG key
   scoped to exactly that zone. Your registrar API key never touches the
   web server.

## Layout

```
profiles/     one TOML per person (see templates/profile.template.toml)
photos/       headshots the profiles reference
scripts/      build_atds.py (the builder) · pii_gate_ds.py (the safety gate)
              deploy + DNS/TLS automation (finish_automation.sh and friends)
server/       bind9 delegation setup · leaderboard aggregator · systemd units
nginx-*.conf  the whole vhost: profiles, wildcard catch-all, beacon, defaults
tests/        pytest suites for the builder and the aggregator
docs/         the original design/requirements doc, warts and all
```

## Adapting it to your company

Everything is literal, so adapting is mostly search and replace:

1. Replace `diligentservices.io` with your domain across the repo (we built
   this by doing exactly that to its predecessor, `at.themyers.party`).
2. Replace the server addresses in `scripts/*.sh` with your box.
3. Write your people's TOML files in `profiles/` (the template is commented),
   drop headshots in `photos/`.
4. DNS: `at`, `*.at`, and `acme-ns` A records to your box, plus an
   `_acme-challenge.at` NS record delegating to `acme-ns` — or just run
   `scripts/finish_automation.sh`, which creates them, stands up bind9,
   issues both certificates, deploys, and verifies, in one idempotent run.
5. Build with `python3 scripts/build_atds.py` (needs
   [segno](https://pypi.org/project/segno/) for the QR pages, or pass
   `--skip-qr`), then `scripts/deploy_atds.sh`.

Two hard-won notes: a wildcard certificate does NOT cover its own bare label
(`at.yourdomain.com` needs an explicit SAN), and if your box has no nginx
`default_server`, unknown hostnames fall through to your first vhost
alphabetically — ours leaked a CRM login page until this repo's conf claimed
the default.

## Credits

Built by Diligent Services in Corona, California. Most of the code and this
README were written by Jane, our AI operator, with humans reviewing and
publishing ([G611](https://diligentservices.io/g611/)). Rick Astley is Rick
Astley. MIT licensed — roll your friends.
