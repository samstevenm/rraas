#!/usr/bin/env bash
# One-command deploy for at.diligentservices.io → the dsio Hetzner box.
#
# Run from a context where `op` is authorized — an INTERACTIVE Jane session, not
# a background job (op TouchID-gates in background jobs, which is why this is a
# hand-off script). Idempotent: safe to re-run.
#
#   cd <checkout-with-atds>
#   python3 atds/scripts/build_atds.py && bash atds/scripts/deploy_atds.sh
#
# Fail-fast + publickey-only, so it can NEVER fall back to password auth (the
# fail2ban trap). If the host is unreachable, fail2ban has likely banned this
# machine: on dsio run `fail2ban-client unban <ip>`, wait, then re-run —
# nothing here is destructive or partial.
#
# First run bootstraps TLS in the right order: an :80-only vhost goes in
# first so certbot --webroot can answer for the at.* names, THEN the SAN cert
# is issued (NEW cert-name at.diligentservices.io — the Quarto site's
# diligentservices.io cert is never touched), THEN the full vhost lands. The
# wildcard cert comes from the rfc2136 lane (finish_automation.sh) and is a
# prerequisite for the full vhost's catch-all block.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"   # -> atds/
DIST="$HERE/dist"
CONF="$HERE/nginx-at.diligentservices.io.conf"
DSIO=root@100.64.0.4
KEY_REF="op://YOUR-VAULT/your-server-ssh-key/private key?ssh-format=openssh"
SITE=/etc/nginx/sites-available/at.diligentservices.io
LINK=/etc/nginx/sites-enabled/at.diligentservices.io

[ -f "$DIST/404.html" ] || { echo "ABORT: no dist — run build_atds.py first."; exit 2; }

eval "$(ssh-agent -s)" >/dev/null
trap 'ssh-agent -k >/dev/null 2>&1 || true' EXIT

# Load EXACTLY the dsio key into a throwaway agent (avoids the 1P agent's
# multi-key MaxAuthTries flood).
if ! op read "$KEY_REF" 2>/dev/null | ssh-add - 2>/dev/null; then
  echo "ABORT: op read failed. Run from an interactive session with 1Password unlocked."; exit 3
fi
[ "$(ssh-add -l 2>/dev/null | grep -c .)" -ge 1 ] || { echo "ABORT: no key loaded."; exit 3; }
echo "key loaded."

O1=(-o IdentityAgent="$SSH_AUTH_SOCK" -o IdentitiesOnly=no
    -o PreferredAuthentications=publickey -o BatchMode=yes
    -o NumberOfPasswordPrompts=0 -o ConnectTimeout=12)

if ! ssh "${O1[@]}" "$DSIO" true 2>/dev/null; then
  echo "ABORT: dsio SSH unreachable — fail2ban likely still has this host banned."
  echo "       On dsio: fail2ban-client unban <this-host-ip>, then re-run."
  exit 4
fi
echo "dsio reachable."

DOMS="$(cat "$DIST/certbot-domains.txt")"

echo "== sync at.* docroot =="
ssh "${O1[@]}" "$DSIO" 'mkdir -p /var/www/at.diligentservices.io /var/www/letsencrypt'
scp -q "${O1[@]}" -r "$DIST"/*/ "$DIST/404.html" "$DIST/50x.html" "$DIST/directory.json" \
    "$DSIO:/var/www/at.diligentservices.io/"
# the roster era left about.html + a root /qr page on the box — remove them
ssh "${O1[@]}" "$DSIO" 'rm -rf /var/www/at.diligentservices.io/about.html /var/www/at.diligentservices.io/qr' 

echo "== SAN cert (cert-name at.diligentservices.io: $DOMS) =="
if ! ssh "${O1[@]}" "$DSIO" 'test -s /etc/letsencrypt/live/at.diligentservices.io/fullchain.pem'; then
  echo "   first issuance — installing :80-only bootstrap vhost for the ACME challenge"
  # the :80 server block of the full conf is self-contained; extract it
  awk '/^# --- :80/,/^}/' "$CONF" | ssh "${O1[@]}" "$DSIO" "cat > $SITE"
  ssh "${O1[@]}" "$DSIO" "ln -sf $SITE $LINK && nginx -t && systemctl reload nginx"
fi
ssh "${O1[@]}" "$DSIO" "certbot certonly --webroot -w /var/www/letsencrypt --cert-name at.diligentservices.io --expand $DOMS -n --agree-tos 2>&1 | tail -4"

# The vhost's catch-all block needs the rfc2136 wildcard cert
# (finish_automation.sh step 3, or the manual at_wildcard_cert.sh fallback).
if ! ssh "${O1[@]}" "$DSIO" 'test -s /etc/letsencrypt/live/at-wildcard.diligentservices.io/fullchain.pem'; then
  echo "ABORT: at-wildcard.diligentservices.io cert missing on dsio."
  echo "       Run finish_automation.sh (or at_wildcard_cert.sh), then re-run this."
  exit 5
fi

echo "== install vhost + reload (rollback on failure) =="
ssh "${O1[@]}" "$DSIO" "cp $SITE /root/at.diligentservices.io.conf.prev 2>/dev/null || true"
scp -q "${O1[@]}" "$CONF" "$DSIO:$SITE"
if ! ssh "${O1[@]}" "$DSIO" "ln -sf $SITE $LINK && nginx -t 2>&1 && systemctl reload nginx"; then
  echo "vhost test failed — rolling back"
  ssh "${O1[@]}" "$DSIO" "cp /root/at.diligentservices.io.conf.prev $SITE && nginx -t && systemctl reload nginx"
  exit 1
fi

echo "== phase 2: roll aggregator install =="
ssh "${O1[@]}" "$DSIO" 'mkdir -p /opt/exmen26 /var/lib/exmen26 && touch /var/log/nginx/atds-roll.log'
scp -q "${O1[@]}" "$HERE/server/roll_aggregate.py" "$DSIO:/opt/exmen26/roll_aggregate.py"
scp -q "${O1[@]}" "$HERE/server/roll-aggregate.service" "$DSIO:/etc/systemd/system/atds-roll-aggregate.service"
scp -q "${O1[@]}" "$HERE/server/roll-aggregate.timer" "$DSIO:/etc/systemd/system/atds-roll-aggregate.timer"
ssh "${O1[@]}" "$DSIO" 'systemctl daemon-reload && systemctl enable --now atds-roll-aggregate.timer >/dev/null 2>&1; systemctl start atds-roll-aggregate.service && systemctl is-active atds-roll-aggregate.timer'

echo "== verify =="
sleep 2
# claimed names prove the SAN lane; an unknown label proves the wildcard lane
# (301 to the apex over VALID TLS proves both the catch-all block and cert).
printf "  %-32s -> " "at. (expect 301 to apex)"
curl -so /dev/null -w "%{http_code} -> %{redirect_url}\n" --max-time 10 --resolve at.diligentservices.io:443:95.217.133.86 https://at.diligentservices.io/
for h in sam.at.diligentservices.io connor.at.diligentservices.io pearl.at.diligentservices.io; do
  printf "  %-32s -> " "$h"
  curl -sI --max-time 10 --resolve "$h:443:95.217.133.86" "https://$h/" | head -1
done
printf "  %-32s -> " "nobody.at (expect 301)"
curl -so /dev/null -w "%{http_code}\n" --max-time 10 --resolve nobody.at.diligentservices.io:443:95.217.133.86 https://nobody.at.diligentservices.io/
for h in sam.at.diligentservices.io; do
  printf "  %-32s -> " "$h/sam.vcf (expect 200)"
  curl -so /dev/null -w "%{http_code}\n" --max-time 10 --resolve "$h:443:95.217.133.86" "https://$h/sam.vcf"
  printf "  %-32s -> " "$h/qr/ (expect 200)"
  curl -so /dev/null -w "%{http_code}\n" --max-time 10 --resolve "$h:443:95.217.133.86" "https://$h/qr/"
  printf "  %-32s -> " "$h/roll.gif (expect 200)"
  curl -so /dev/null -w "%{http_code}\n" --max-time 10 --resolve "$h:443:95.217.133.86" "https://$h/roll.gif?who=verify"
done
printf "  %-32s -> " "rickroll.at (expect 200)"
curl -so /dev/null -w "%{http_code}\n" --max-time 10 --resolve rickroll.at.diligentservices.io:443:95.217.133.86 https://rickroll.at.diligentservices.io/
printf "  %-32s -> " "rickroll leaderboard (expect 200)"
curl -so /dev/null -w "%{http_code}\n" --max-time 10 --resolve rickroll.at.diligentservices.io:443:95.217.133.86 https://rickroll.at.diligentservices.io/leaderboard.json
echo "done."
