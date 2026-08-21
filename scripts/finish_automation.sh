#!/usr/bin/env bash
# One-command finisher for the at.diligentservices.io TLS automation. Run INTERACTIVELY from the mini (TouchID for 1Password) after the
# branch is merged to main:
#
#   cd <checkout-with-atds>/
#   bash atds/scripts/finish_automation.sh
#
# Idempotent end-to-end; safe to re-run after a partial failure. Does, in order:
#   1. two permanent parent-zone records at Namecheap (acme-ns A,
#      _acme-challenge.at NS) via nc_dns.py — full-zone snapshot first
#   2. bind9 delegated-zone setup on dsio (setup-dns01-delegation.sh)
#   3. unattended-renewable wildcard cert via certbot dns-rfc2136
#   4. atds build + vhost deploy (deploy_atds.sh)
#   5. cert-watchdog timer install on dsio + first live run
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"          # atds/scripts
ROOT="$(cd "$HERE/../.." && pwd)"              # repo root
DSIO=root@100.64.0.4
KEY_REF="op://YOUR-VAULT/your-server-ssh-key/private key?ssh-format=openssh"

eval "$(ssh-agent -s)" >/dev/null
trap 'ssh-agent -k >/dev/null 2>&1 || true' EXIT
op read "$KEY_REF" | ssh-add - 2>/dev/null || {
  echo "ABORT: op read failed — run interactively with 1Password unlocked."; exit 3; }

O=(-o IdentityAgent="$SSH_AUTH_SOCK" -o IdentitiesOnly=no
   -o PreferredAuthentications=publickey -o BatchMode=yes
   -o NumberOfPasswordPrompts=0 -o ConnectTimeout=12)
ssh "${O[@]}" "$DSIO" true 2>/dev/null || {
  echo "ABORT: dsio SSH unreachable (fail2ban? see deploy_atds.sh header)."; exit 4; }
echo "dsio reachable."

echo
echo "==[1/5] parent-zone records (Namecheap, snapshot-first) =="
# The at-lane itself (themyers added these in a separate manual step — here
# they ride the finisher so one run stands the whole lane up):
python3 "$HERE/nc_dns.py" add at A 95.217.133.86
python3 "$HERE/nc_dns.py" add '*.at' A 95.217.133.86
# ACME delegation for the unattended wildcard-cert lane:
python3 "$HERE/nc_dns.py" add acme-ns A 95.217.133.86
python3 "$HERE/nc_dns.py" add _acme-challenge.at NS acme-ns.diligentservices.io.
echo "waiting for the registrar NS to publish the delegation..."
# NB: a delegation NS arrives in the AUTHORITY section (the parent is not
# authoritative for the child zone), so +short shows nothing — read the
# authority section explicitly.
# Poll the domain's OWN authoritative NS (PremiumDNS = pdns1/pdns2) — the
# generic dns1.registrar-servers.com mirror lags them by many minutes and
# stalled the first live run.
AUTH_NS="$(dig +short NS diligentservices.io | head -1)"
[ -n "$AUTH_NS" ] || AUTH_NS=pdns1.registrar-servers.com
for i in $(seq 1 60); do
  NSOK="$(dig +noall +authority +answer NS _acme-challenge.at.diligentservices.io @"$AUTH_NS" | grep -o 'acme-ns\.diligentservices\.io\.' | head -1)"
  AOK="$(dig +short A acme-ns.diligentservices.io @"$AUTH_NS")"
  [ -n "$NSOK" ] && [ -n "$AOK" ] && break
  sleep 5
done
[ -n "$NSOK" ] && [ -n "$AOK" ] || { echo "ABORT: delegation not visible after 5min."; exit 5; }
echo "delegation live: NS=$NSOK A=$AOK"

echo
echo "==[2/5] bind9 delegated zone on dsio =="
scp -q "${O[@]}" "$ROOT/atds/server/setup-dns01-delegation.sh" "$DSIO:/root/"
ssh "${O[@]}" "$DSIO" 'bash /root/setup-dns01-delegation.sh'

echo
echo "==[3/5] wildcard cert via rfc2136 (renews unattended from here on) =="
ssh "${O[@]}" "$DSIO" "certbot certonly --dns-rfc2136 --dns-rfc2136-credentials /etc/letsencrypt/rfc2136.ini --dns-rfc2136-propagation-seconds 20 --cert-name at-wildcard.diligentservices.io -d '*.at.diligentservices.io' -n --agree-tos --deploy-hook 'systemctl reload nginx' 2>&1 | tail -4"

echo
echo "==[4/5] atds build + vhost deploy =="
"${ATDS_PY:-$ROOT/.venv/bin/python3}" "$HERE/build_atds.py"
bash "$HERE/deploy_atds.sh"


echo
echo "==[5/5] cert-watchdog install on dsio (files pushed from this checkout) =="
# NB: dsio has no ExMen26 checkout (deliberately — no standing repo key), so we
# scp the exact files from the checkout we are running out of. The unit name
# is at-cert-watchdog.* to stay clear of any future shared cert-watchdog.
ssh "${O[@]}" "$DSIO" 'mkdir -p /opt/exmen26 /var/lib/exmen26'
scp -q "${O[@]}" "$ROOT/scripts/cert_watchdog.py" "$DSIO:/opt/exmen26/cert_watchdog.py"
scp -q "${O[@]}" "$ROOT/atds/server/cert-watchdog.service" "$DSIO:/etc/systemd/system/at-cert-watchdog.service"
scp -q "${O[@]}" "$ROOT/atds/server/cert-watchdog.timer" "$DSIO:/etc/systemd/system/at-cert-watchdog.timer"
ssh "${O[@]}" "$DSIO" 'systemctl daemon-reload && systemctl enable --now at-cert-watchdog.timer >/dev/null 2>&1; systemctl start at-cert-watchdog.service; sleep 2; journalctl -u at-cert-watchdog.service -n 10 --no-pager | tail -10'

echo
echo "== final verify (informational — a transient curl failure is not fatal) =="
for h in at.diligentservices.io sam.at.diligentservices.io connor.at.diligentservices.io pearl.at.diligentservices.io; do
  printf "  %-26s -> " "$h"
  curl -sI --max-time 10 "https://$h/" | head -1 || echo "CURL FAILED (retry by hand)"
done
printf "  %-26s -> " "nobody.at (404+validTLS)"
curl -so /dev/null -w "%{http_code}\n" --max-time 10 https://nobody.at.diligentservices.io/ || echo "CURL FAILED (retry by hand)"
echo "done — the wildcard now renews itself; the watchdog pages if anything drifts."
