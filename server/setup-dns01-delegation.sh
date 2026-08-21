#!/usr/bin/env bash
# Runs ON dsio (root). Idempotent. Sets up the least-privilege DNS-01 lane for
# *.at.diligentservices.io so the wildcard cert renews unattended forever:
#
#   Namecheap zone (hand-set once, via nc_dns.py from the mini):
#     acme-ns.diligentservices.io            A   95.217.133.86
#     _acme-challenge.at.diligentservices.io NS  acme-ns.diligentservices.io.
#
#   dsio (this script): bind9 serves ONLY the tiny delegated zone
#   _acme-challenge.at.diligentservices.io, authoritative-only (recursion off,
#   transfers off). certbot's rfc2136 plugin updates it via a TSIG key whose
#   allow-update covers exactly that zone — so the only thing the key (or a
#   compromised certbot) can ever touch is one challenge TXT name for hosts
#   whose TLS keys dsio already holds. The account-wide Namecheap API key is
#   never used for renewals and never lands on this box.
#
# Everything comes from Ubuntu apt (bind9, python3-certbot-dns-rfc2136).
set -euo pipefail

ZONE="_acme-challenge.at.diligentservices.io"
ZFILE="/var/lib/bind/${ZONE}.zone"
KEYFILE="/etc/bind/acme-update.key"
INI="/etc/letsencrypt/rfc2136.ini"

echo "== packages =="
export DEBIAN_FRONTEND=noninteractive
apt-get install -y -q bind9 bind9-dnsutils python3-certbot-dns-rfc2136 >/dev/null
echo "installed."

echo "== TSIG key (generate once, root:bind 640) =="
if [ ! -s "$KEYFILE" ]; then
  tsig-keygen -a hmac-sha256 acme-update > "$KEYFILE"
  chown root:bind "$KEYFILE"; chmod 640 "$KEYFILE"
  echo "generated."
else
  echo "exists — kept."
fi

echo "== authoritative-only options =="
cat > /etc/bind/named.conf.options <<'EOF'
// dsio: authoritative-only nameserver for the delegated ACME challenge zone.
// No recursion, no transfers — this box is not a resolver for anyone.
options {
    directory "/var/cache/bind";
    recursion no;
    allow-transfer { none; };
    allow-query { any; };
    dnssec-validation auto;
    listen-on-v6 { any; };
};
EOF

echo "== zone: $ZONE =="
if [ ! -s "$ZFILE" ]; then
  cat > "$ZFILE" <<EOF
\$TTL 60
@   IN SOA acme-ns.diligentservices.io. hostmaster.diligentservices.io. (
        1 3600 600 604800 60 )
    IN NS  acme-ns.diligentservices.io.
EOF
  chown bind:bind "$ZFILE"
  echo "zone file written."
else
  echo "zone file exists — kept."
fi
if ! grep -q "$ZONE" /etc/bind/named.conf.local; then
  cat >> /etc/bind/named.conf.local <<EOF

include "$KEYFILE";
zone "$ZONE" {
    type master;
    file "$ZFILE";
    allow-update { key "acme-update"; };
    allow-transfer { none; };
};
EOF
  echo "zone block added."
else
  echo "zone block exists — kept."
fi

echo "== firewall: DNS for the delegated zone =="
ufw allow 53 comment 'acme delegated zone (bind9, authoritative-only)' >/dev/null
echo "ufw ok."

echo "== start bind =="
named-checkconf
named-checkzone "$ZONE" "$ZFILE" >/dev/null
systemctl enable --now named >/dev/null 2>&1
systemctl restart named
sleep 1
systemctl is-active named

echo "== certbot rfc2136 credentials =="
SECRET="$(grep -o 'secret "[^"]*"' "$KEYFILE" | cut -d'"' -f2)"
umask 077
cat > "$INI" <<EOF
# certbot-dns-rfc2136 credentials — TSIG key scoped to ${ZONE} only.
dns_rfc2136_server = 127.0.0.1
dns_rfc2136_port = 53
dns_rfc2136_name = acme-update
dns_rfc2136_secret = ${SECRET}
dns_rfc2136_algorithm = HMAC-SHA256
EOF
chmod 600 "$INI"
echo "written ($INI)."

echo "== self-test: TSIG update against the local zone =="
TESTVAL="selftest-$(date +%s)"
nsupdate -k "$KEYFILE" <<EOF
server 127.0.0.1
zone $ZONE
update add $ZONE 60 TXT "$TESTVAL"
send
EOF
dig +short TXT "$ZONE" @127.0.0.1 | grep -q "$TESTVAL"
nsupdate -k "$KEYFILE" <<EOF
server 127.0.0.1
zone $ZONE
update delete $ZONE TXT
send
EOF
echo "TSIG update lane works."

echo
echo "Ready. Issue/renew the cert with:"
echo "  certbot certonly --dns-rfc2136 --dns-rfc2136-credentials $INI \\"
echo "    --dns-rfc2136-propagation-seconds 20 \\"
echo "    --cert-name at-wildcard.diligentservices.io -d '*.at.diligentservices.io' \\"
echo "    -n --agree-tos --deploy-hook 'systemctl reload nginx'"
echo "(after first issuance, the standard certbot timer renews it unattended)"
