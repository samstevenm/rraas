# RACK & ROLL '26 — operator & reset runbook (Sam)

Every command runs from **`~/rraas/cedia`** on the mini. `tools/cfrun.sh` pulls
the Cloudflare token from your keychain and runs wrangler for you — you never
paste a token. Prefix D1 commands with it:

```
cd ~/rraas/cedia
bash tools/cfrun.sh wrangler d1 execute rr26 --remote --command "<SQL>" -y
```

Fastest moderation (no terminal) is **rickroll.win/admin.html** on your phone +
the admin secret (keychain item `rr26-admin-secret`). Use the terminal for the
bigger resets below.

## Sandbox → go-live (automatic, Aug 31)

Right now the game is a **sandbox**: hand the crew test codes, let people claim,
roll, chain — break it freely. Every interactive page shows a "SANDBOX · wipes
Aug 31" banner while we're before go-live.

At **`SEASON_START`** (set in `wrangler.toml`, currently
`2026-08-31T06:00:00Z` = midnight Mountain, start of 8/31 in Denver) the Worker's
cron trigger fires and, exactly once, **wipes every practice claim and every
roll** — the codes go back to unclaimed so the printed cards still work, and the
real season begins. No terminal, no phone, no one has to remember: it just
happens. It's a single atomic transaction and latches a `season_started` flag,
so it can never re-fire and wipe the live board mid-show.

**The three crew pages survive the wipe** (Sam / Pearl / Connor), so you're on
the board from minute one — their practice *scores* zero out, their pages stay.
That survivor list is `SEED_TOKENS` in `wrangler.toml`. Set it to `""` if you'd
rather everyone (crew included) start from a truly blank board.

To **move go-live**: edit `SEASON_START`, `bash tools/cfrun.sh wrangler deploy`.
If go-live already fired and you need to reset the sandbox again, clear the latch:
```
bash tools/cfrun.sh wrangler d1 execute rr26 --remote -y --command \
 "DELETE FROM flags WHERE name='season_started'"
```
then push SEASON_START back to a future instant (or run the big red button below
by hand). To **disable the auto-wipe entirely**, remove the `[triggers]` block
from `wrangler.toml` and redeploy.

## Check the state
```
bash tools/cfrun.sh wrangler d1 execute rr26 --remote -y --command \
 "SELECT COUNT(*) total, SUM(CASE WHEN claimed_at IS NOT NULL THEN 1 ELSE 0 END) claimed FROM tokens"
```
Look someone up: `... --command "SELECT codename,display,inviter,hidden FROM tokens WHERE codename='velvet-forklift'"`

## Un-claim ONE code (put it back in circulation)
Someone fat-fingered their claim, or you want a card reusable:
```
bash tools/cfrun.sh wrangler d1 execute rr26 --remote -y --command \
 "UPDATE tokens SET claimed_at=NULL,display=NULL,bio=NULL,company=NULL,email=NULL,has_photo=0,busted=0,parent=NULL WHERE token='photon-rack'; DELETE FROM rolls WHERE codename='photon-rack';"
```
(If they'd uploaded a photo, also nuke the page once via admin.html — that clears the stored image.)

## Hide / unhide / nuke a page (bad content)
Phone: admin.html → enter secret → hide / nuke / global photos-off. Or SQL:
```
# hide:   ... "UPDATE tokens SET hidden=1 WHERE codename='X'"
# unhide: ... "UPDATE tokens SET hidden=0 WHERE codename='X'"
# global photos OFF (every photo hidden at once):
... "INSERT INTO flags (name,value) VALUES ('photos_killed','1') ON CONFLICT(name) DO UPDATE SET value='1'"
# photos back ON: same with '0'
```

## Reset the scoreboard
```
# zero everyone's rolls (fresh start, keeps players):
bash tools/cfrun.sh wrangler d1 execute rr26 --remote -y --command "DELETE FROM rolls"
# one player's rolls only:
... --command "DELETE FROM rolls WHERE codename='X'"
```

## Nuke the whole game but KEEP the invitations (the big red button)
Wipes every claim + every roll; the 900 codes stay unclaimed and reusable:
```
bash tools/cfrun.sh wrangler d1 execute rr26 --remote -y --command \
 "UPDATE tokens SET claimed_at=NULL,display=NULL,bio=NULL,company=NULL,email=NULL,has_photo=0,busted=0,parent=NULL; DELETE FROM rolls;"
```
Then re-seed the three crew pages if you want them back:
`python3 tools/... ` — or just ping Jane.

## Test codes (for you three to practice)
`test-sam`, `test-connor`, `test-pearl` exist for dry-runs — claim them, poke
the board, then reset with the un-claim command above. **Delete them before the
show** so they never appear as real players:
```
bash tools/cfrun.sh wrangler d1 execute rr26 --remote -y --command \
 "DELETE FROM tokens WHERE token LIKE 'test-%'; DELETE FROM rolls WHERE codename LIKE 'test-%';"
```

## Running low on codes?
900 is a lot (you printed ~100 each). If you somehow burn through them, ping
Jane to mint + seed a fresh batch — it needs a careful append so it can't
collide with codes already claimed.

## Watch it spread (read-only)
`rickroll.win/stats` — participation, recruiter race, best connectors (who
roped in the most), and claims-by-day. It's edge-cached ~30 min, so it updates
itself; nothing to run. Test codes (`test-*`) are excluded from it. Each
player's profile shows their own chain (who brought them, who they brought,
and their reach). The `parent` column in `tokens` is the codename who roped
them in — the un-claim commands above clear it so a re-circulated card starts
chainless.

## Health check anytime (read-only, safe during the show)
```
bash tools/smoke.sh
```
