# at.diligentservices.io — CEDIA personal pages (+ the rickroll lane)

**Sam, 2026-08-21 (verbatim intent):** DS is going to CEDIA. Business cards and
QR codes are forgettable. Duplicate the at.themyers.party functionality for
diligentservices.io — including all certificate and TLS automation — then
profiles for **Sam, Connor & Pearl** (Jane drafts the copy). Only once that's
at parity with the themyers.party implementation, phase 2: the rickroll lane.
We'll probably leave it up after CEDIA — the point is to start conversations.

## Hard gates (Sam's, on the record)

1. **Nothing goes live on diligentservices.io** and **nothing is committed to
   the dsquarto GitHub repo** until Sam signs off on the **copy for the 4
   pages** (sam, connor, pearl profiles + the at. apex page).
2. Phase 2 (rickroll) starts **only after** phase 1 is at parity with the
   themyers.party implementation.
3. Test everything **locally** first (quarto site untouched + the at-lane
   builder); leverage Codex for grunt work.

## Phase 1 — parity port

- **Source home: ExMen26 `atds/`** (this dir), mirroring `atparty/`.
  *Decision + why:* `samstevenm/diligentservices-quarto` is **public**; the
  profiles carry deliberately-public contact info but the tooling, cert
  automation and any future counter data don't belong in a public repo, and
  the atparty precedent already lives in ExMen26. The dsquarto repo is
  untouched (gate #1 protects it anyway). Tradeoff: two repos deploy to one
  box; same as mm2 today.
- **URLs:** `at.diligentservices.io` = explainer + directory. Lists **only**
  sam / connor / pearl, explains the idea (stolen from at.hn via Hacker News,
  "we thought it would be fun at CEDIA"), **no rickroll mention or link**.
  `sam|connor|pearl.at.diligentservices.io` = profile pages. **Unclaimed
  `*.at.diligentservices.io` → 301 to `at.diligentservices.io`** (same as
  themyers). The marketing apex `diligentservices.io` (Quarto) is untouched.
- **Profile page layout — old-school MySpace, not the themyers minimalist
  page:** photo left column, bio section right, tags, a **downloadable vCard**
  (`<name>.vcf`, generated at build time: FN, ORG Diligent Services, TITLE,
  TEL, EMAIL, URL `https://<name>.at.diligentservices.io`), links block.
  Phase 2 adds the rickroll footer link.
- **Builder:** port of `build_atparty.py` (stdlib-only, escape-first markdown
  subset, fail-closed PII gate). Changes vs atparty:
  - New `[contact]` TOML table (phone / email / title / org) that is
    **exempt from the phone rule** — on a business card the phone number is
    the point. The blurb and every other field stay fully gated.
  - MySpace-flavored template + vCard emission.
  - `robots`: **indexable** (this is marketing; themyers' noindex+noai posture
    is a family-privacy choice that doesn't apply). Flag for Sam.
- **TLS (identical two-lane architecture, new box):**
  - Lane 1: SAN cert for `at.` + each claimed name, certbot webroot,
    auto-renewing (builder emits `certbot-domains.txt`).
  - Lane 2: `at-wildcard.diligentservices.io` (`*.at.diligentservices.io`)
    renewing unattended via certbot **dns-rfc2136** against a bind9
    authoritative-only zone `_acme-challenge.at.diligentservices.io` on the
    dsio box, TSIG-scoped to exactly that zone (port of
    `setup-dns01-delegation.sh`). Requires **ufw allow 53** on the dsio box
    (new exposure; justified per the network-exposure doctrine by the mm2
    precedent — authoritative-only, recursion off, transfers off).
  - Wildcard-cert gotcha from themyers (2026-07-27): a wildcard does **not**
    match its own apex label — the bare `at.diligentservices.io` must be in a
    SAN explicitly.
- **DNS (Namecheap, `pdns1/2.registrar-servers.com`):** add
  `at` A → 95.217.133.86 · `*.at` A → 95.217.133.86 ·
  `acme-ns` A → 95.217.133.86 · `_acme-challenge.at` NS → `acme-ns.…`.
  Writes go through `nc_dns.py` (full record-set snapshot first —
  **`setHosts` REPLACES the whole zone and diligentservices.io carries
  Fastmail MX/SPF/DKIM**). API key `op://YOUR-VAULT/your-namecheap-api-key`,
  answers only to the mini's egress IP. The permission classifier blocks Jane
  from registrar-zone writes and remote root cert ops — those steps become a
  **finisher script Sam runs** (`! bash atds/scripts/finish_automation.sh`),
  same as themyers.
- **Deploy target:** dsio box `root@95.217.133.86` (SSH key
  `op://YOUR-VAULT/your-server-ssh-key/private key?ssh-format=openssh`;
  throwaway agent, never the 10-key 1P spray). New vhost
  `at.diligentservices.io.conf`; docroot `/var/www/at.diligentservices.io/`.
  The Quarto site's vhost/webroot untouched.

## Phase 2 — the rickroll lane (design, build AFTER parity sign-off)

- **Pre-roll on each profile:** first visit per browser, a dismissable overlay
  plays ~10s of *Never Gonna Give You Up* before revealing the profile; a
  cookie (`atds_rolled=1`, 1yr) makes it once-per-browser (incognito cheats —
  accepted). **Browser-physics constraint to flag for Sam:** unmuted autoplay
  is blocked by every modern browser without a prior user gesture. Plan:
  YouTube iframe (`dQw4w9WgXcQ`, autoplay+mute) with a big "🔊 turn it up"
  button; a QR-code arrival is a fresh page load with no gesture, so silent-
  start is unavoidable. (Self-hosting an audible clip has the same policy
  problem plus copyright exposure.)
- **Footer link on each profile:** cute line, e.g. "If you actually wanted
  Rick Astley and not Sam →" linking `rickroll.at.diligentservices.io`.
- **`rickroll.at.diligentservices.io`:** embeds the canonical YouTube video +
  a **leaderboard** of who has the most rolls (= most interactions).
- **Counter — recommendation: nginx-log beacon, no backend.** The pre-roll
  fires a beacon (`/roll.gif?who=sam`) logged to a dedicated access log; a
  1-min systemd timer aggregates → `leaderboard.json` (static). Zero new
  write surface on the box, survives the static-site doctrine; tradeoff =
  ≤1 min leaderboard lag. Alternative (rejected unless Sam wants realtime):
  a loopback Flask counter behind nginx — live counts but a new persistent
  service + write path on the prod box.
- Stays up after CEDIA.

## Open items for Sam (with the copy review)

1. Confirm **connor@** and **pearl@diligentservices.io** exist (or which
   emails the vCards should carry).
2. Phone numbers on the cards: office **(424) 448-5200** for everyone
   (drafted default), or personal cells?
3. Photos for the three profiles (drafts ship with placeholders).
4. Indexable vs noindex (drafted: indexable).
5. Titles on the vCards (drafted: Sam "Owner", Pearl "Co-Owner", Connor
   "Field Technician").
