#!/usr/bin/env bash
# FALLBACK lane: issue/renew the *.at.diligentservices.io wildcard cert by hand
# (manual DNS-01 through the Namecheap API from the mini).
#
# The PRIMARY lane is unattended: bind9 on dsio serves the delegated zone
# _acme-challenge.at.diligentservices.io and certbot renews via rfc2136 + a
# zone-scoped TSIG key (see atds/dsio/setup-dns01-delegation.sh and
# docs/ATPARTY.md § TLS). Use THIS script only if that lane is broken —
# e.g. bind is down, the delegation records are gone, or port 53 is blocked.
# It runs from the Mac mini (whose egress IP is the one whitelisted on the
# Namecheap API) and needs 1Password unlocked.
#
#   cd <worktree-or-checkout>
#   bash atds/scripts/at_wildcard_cert.sh
#
# What it does, all idempotent:
#   1. loads the dsio SSH key from 1Password into a throwaway agent (TouchID)
#   2. stages + arms the DNS-01 auth hook on dsio, launches certbot there
#   3. reads the ACME validation string the hook writes
#   4. adds the _acme-challenge.at TXT record via nc_dns.py (Namecheap API;
#      snapshots the full record set to ~/.atds-dns-backups first)
#   5. waits for certbot to finish, removes the TXT, disarms the hook
#   6. reloads nginx and prints cert dates
#
# Unattended `certbot renew` on dsio deliberately FAILS for this cert when the
# hook is not armed — that is the fail-fast reminder that a hand-run is due.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DSIO=root@100.64.0.4
KEY_REF="op://YOUR-VAULT/your-server-ssh-key/private key?ssh-format=openssh"
D=/root/atds-dns01
TXT_HOST="_acme-challenge.at"

# --- throwaway agent with EXACTLY the dsio key (the 1P agent's 10-key flood
# trips dsio's MaxAuthTries/fail2ban — never reuse it) ---
eval "$(ssh-agent -s)" >/dev/null
trap 'ssh-agent -k >/dev/null 2>&1 || true' EXIT
op read "$KEY_REF" | ssh-add - 2>/dev/null || {
  echo "ABORT: op read failed — run interactively with 1Password unlocked."; exit 3; }
ssh-add -l >/dev/null 2>&1 || { echo "ABORT: no key loaded."; exit 3; }

O=(-o IdentityAgent="$SSH_AUTH_SOCK" -o IdentitiesOnly=no
   -o PreferredAuthentications=publickey -o BatchMode=yes
   -o NumberOfPasswordPrompts=0 -o ConnectTimeout=12)

ssh "${O[@]}" "$DSIO" true 2>/dev/null || {
  echo "ABORT: dsio SSH unreachable (fail2ban? see deploy_atds.sh header)."; exit 4; }
echo "dsio reachable."

echo "== stage + arm the auth hook =="
ssh "${O[@]}" "$DSIO" "mkdir -p $D && rm -f $D/validation.txt $D/certbot.log $D/certbot.done && touch $D/armed"
scp -q "${O[@]}" "$HERE/dsio-auth-hook.sh" "$DSIO:$D/auth-hook.sh"
ssh "${O[@]}" "$DSIO" "chmod +x $D/auth-hook.sh"

echo "== launch certbot on dsio (backgrounded there; hook polls DNS) =="
ssh "${O[@]}" "$DSIO" "systemd-run --unit=atds-certbot --collect certbot certonly --manual --preferred-challenges dns --manual-auth-hook $D/auth-hook.sh --cert-name at-wildcard.diligentservices.io -d '*.at.diligentservices.io' -n --agree-tos"

echo "== wait for the ACME validation string =="
VAL=""
for i in $(seq 1 30); do
  VAL="$(ssh "${O[@]}" "$DSIO" "cat $D/validation.txt 2>/dev/null" || true)"
  [ -n "$VAL" ] && break
  sleep 4
done
[ -n "$VAL" ] || { echo "ABORT: no validation string — journalctl -u atds-certbot on dsio."; exit 5; }
echo "validation: $VAL"

echo "== publish TXT via Namecheap API (records snapshot to ~/.atds-dns-backups) =="
python3 "$HERE/nc_dns.py" add-txt "$TXT_HOST" "$VAL"

echo "== wait for certbot to finish (hook sees the TXT, LE validates) =="
RC=""
for i in $(seq 1 100); do
  RC="$(ssh "${O[@]}" "$DSIO" "systemctl is-active atds-certbot 2>/dev/null" || true)"
  case "$RC" in active|activating) sleep 10 ;; *) break ;; esac
done

echo "== clean up: remove TXT, disarm hook =="
python3 "$HERE/nc_dns.py" del-txt "$TXT_HOST"
ssh "${O[@]}" "$DSIO" "rm -f $D/armed $D/validation.txt"

echo "== result =="
ssh "${O[@]}" "$DSIO" "certbot certificates --cert-name at-wildcard.diligentservices.io 2>/dev/null | sed -n '/Certificate Name/,/Private Key Path/p'"
ssh "${O[@]}" "$DSIO" "nginx -t 2>/dev/null && systemctl reload nginx && echo 'nginx reloaded.'"
printf "  %-28s -> " "nobody.at (expect 404, valid TLS)"
curl -so /dev/null -w "%{http_code}\n" --max-time 10 https://nobody.at.diligentservices.io/ || echo "TLS STILL FAILING"
echo "done."
