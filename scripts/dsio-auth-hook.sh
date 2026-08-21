#!/bin/bash
set -u
D=/root/atds-dns01
echo "$CERTBOT_VALIDATION" > "$D/validation.txt"
# Not armed => this is an unattended `certbot renew` — fail fast instead of
# hanging the timer. Hand-renewal runbook: pinned in the Sam-Jane MM DM.
[ -f "$D/armed" ] || { echo "at-wildcard needs HAND renewal (see pinned runbook)" >&2; exit 1; }
for i in $(seq 1 90); do
  for v in $(dig +short TXT _acme-challenge.at.diligentservices.io @dns1.registrar-servers.com | tr -d '"'); do
    [ "$v" = "$CERTBOT_VALIDATION" ] && exit 0
  done
  sleep 10
done
echo "TXT record never appeared on the authoritative NS" >&2
exit 1
