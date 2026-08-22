#!/usr/bin/env bash
# Read-only live smoke test of the deployed game. Mutates nothing (never
# claims a code or scores a real roll), so it's safe to run any time —
# including during the show. Exit non-zero on the first failed check.
#
#   bash cedia/tools/smoke.sh
set -uo pipefail

FAIL=0
ck() { # ck "label" expected actual
  if [ "$2" = "$3" ]; then printf "  ok   %-34s %s\n" "$1" "$3"
  else printf "  FAIL %-34s want=%s got=%s\n" "$1" "$2" "$3"; FAIL=1; fi
}
code() { curl -so /dev/null -w '%{http_code}' --max-time 12 "$1"; }
rcode() { curl -so /dev/null -w '%{http_code}' --max-time 12 --resolve "$2" "$1"; }

echo "rickroll.win:"
ck "landing"        200 "$(code https://rickroll.win/)"
ck "leaderboard"    200 "$(code https://rickroll.win/leaderboard)"
ck "leaderboard.json" 200 "$(code https://rickroll.win/leaderboard.json)"
ck "stats (propagation)" 200 "$(code https://rickroll.win/stats)"
ck "cheat manifesto" 200 "$(code https://rickroll.win/cheat)"
ck "robots.txt"     200 "$(code https://rickroll.win/robots.txt)"
ck "bad code -> 404" 404 "$(code https://rickroll.win/not-a-real-code-xyz)"

echo "leaderboard.json shape:"
J=$(curl -s --max-time 12 https://rickroll.win/leaderboard.json)
for key in '"players"' '"recruiters"' '"unclaimed_invitations"' '"game"'; do
  case "$J" in *$key*) echo "  ok   has $key";; *) echo "  FAIL missing $key"; FAIL=1;; esac
done

echo "federation (DS tab source, on the mothership):"
ck "rickroll.at reachable" 200 "$(code https://rickroll.at.diligentservices.io/)"

echo "rackroll.win redirect (pinned; stub resolver may cache NXDOMAIN):"
IP=$(dig +short rackroll.win @1.1.1.1 | head -1)
[ -z "$IP" ] && IP=104.21.84.125
ck "rackroll -> 301" 301 "$(rcode https://rackroll.win/photon-rack rackroll.win:443:$IP)"

[ "$FAIL" = 0 ] && echo "ALL GREEN" || echo "SMOKE FAILED"
exit $FAIL
