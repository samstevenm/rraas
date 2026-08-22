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
 "UPDATE tokens SET claimed_at=NULL,display=NULL,bio=NULL,company=NULL,email=NULL,has_photo=0,busted=0 WHERE token='photon-rack'; DELETE FROM rolls WHERE codename='photon-rack';"
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
 "UPDATE tokens SET claimed_at=NULL,display=NULL,bio=NULL,company=NULL,email=NULL,has_photo=0,busted=0; DELETE FROM rolls;"
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

## Health check anytime (read-only, safe during the show)
```
bash tools/smoke.sh
```
