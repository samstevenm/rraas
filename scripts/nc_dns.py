#!/usr/bin/env python3
"""Namecheap DNS helper for diligentservices.io — used by the *.at wildcard cert lane.

Namecheap's setHosts API REPLACES the domain's entire record set, so every
mutation here is: getHosts -> snapshot to a backup file -> resubmit the full
set with the one change. EmailType is preserved (protects MX/mail routing).

Credentials come from 1Password (op read) at call time; the API only answers
to the whitelisted client IP (the `client_ip` field on the op item), so this
must run from that egress IP — in practice, the Mac mini.

Usage:
  nc_dns.py get
  nc_dns.py add-txt <host> <value>     e.g. add-txt _acme-challenge.at "xyz"
  nc_dns.py del-txt <host>             removes ALL TXT records at <host>
  nc_dns.py add <host> <type> <addr> [ttl]   generic add (A/NS/CNAME/...);
                                             no-op if the exact record exists
"""
import json
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

SLD, TLD = "diligentservices", "io"
OP_ITEM = "op://YOUR-VAULT/your-namecheap-api-key"
API = "https://api.namecheap.com/xml.response"
NS = {"nc": "http://api.namecheap.com/xml.response"}
BACKUP_DIR = Path.home() / ".atparty-dns-backups"


def op_read(field):
    return subprocess.run(
        ["op", "read", f"{OP_ITEM}/{field}"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()


def api_call(params):
    creds = {
        "ApiUser": op_read("api_user"),
        "ApiKey": op_read("api_key"),
        "UserName": op_read("username"),
        "ClientIp": op_read("client_ip"),
    }
    url = API + "?" + urllib.parse.urlencode({**creds, **params})
    with urllib.request.urlopen(url, timeout=30) as r:
        raw = r.read().decode()
    root = ET.fromstring(raw)
    if root.get("Status") != "OK":
        errs = [e.text for e in root.iter("{http://api.namecheap.com/xml.response}Error")]
        sys.exit(f"API error: {errs or raw[:500]}")
    return root, raw


def get_hosts():
    root, raw = api_call({
        "Command": "namecheap.domains.dns.getHosts", "SLD": SLD, "TLD": TLD,
    })
    result = root.find(".//nc:DomainDNSGetHostsResult", NS)
    email_type = result.get("EmailType", "")
    hosts = [
        {
            "Name": h.get("Name"), "Type": h.get("Type"),
            "Address": h.get("Address"), "MXPref": h.get("MXPref", "10"),
            "TTL": h.get("TTL", "1799"),
        }
        for h in result.findall("nc:host", NS)
    ]
    return hosts, email_type, raw


def set_hosts(hosts, email_type):
    params = {"Command": "namecheap.domains.dns.setHosts", "SLD": SLD, "TLD": TLD}
    if email_type:
        params["EmailType"] = email_type
    for i, h in enumerate(hosts, 1):
        params[f"HostName{i}"] = h["Name"]
        params[f"RecordType{i}"] = h["Type"]
        params[f"Address{i}"] = h["Address"]
        params[f"TTL{i}"] = h["TTL"]
        if h["Type"] == "MX":
            params[f"MXPref{i}"] = h["MXPref"]
    root, _ = api_call(params)
    ok = root.find(".//nc:DomainDNSSetHostsResult", NS)
    if ok is None or ok.get("IsSuccess") != "true":
        sys.exit("setHosts did not report success — check the domain in the "
                 "Namecheap console before retrying.")


def snapshot(hosts, email_type, raw, tag):
    BACKUP_DIR.mkdir(exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    (BACKUP_DIR / f"{SLD}.{TLD}-{stamp}-{tag}.xml").write_text(raw)
    (BACKUP_DIR / f"{SLD}.{TLD}-{stamp}-{tag}.json").write_text(
        json.dumps({"EmailType": email_type, "hosts": hosts}, indent=2))
    print(f"snapshot: {BACKUP_DIR}/{SLD}.{TLD}-{stamp}-{tag}.*")


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "get"
    hosts, email_type, raw = get_hosts()
    if cmd == "get":
        print(f"EmailType={email_type}  records={len(hosts)}")
        for h in hosts:
            print(f"  {h['Name']:<24} {h['Type']:<6} TTL={h['TTL']:<6} {h['Address']}")
        return
    if cmd == "add-txt":
        name, value = sys.argv[2], sys.argv[3]
        snapshot(hosts, email_type, raw, f"before-add-{name}")
        hosts.append({"Name": name, "Type": "TXT", "Address": value,
                      "MXPref": "10", "TTL": "60"})
        set_hosts(hosts, email_type)
        print(f"added TXT {name} ({len(hosts)} records total)")
        return
    if cmd == "add":
        name, rtype, addr = sys.argv[2], sys.argv[3].upper(), sys.argv[4]
        ttl = sys.argv[5] if len(sys.argv) > 5 else "1799"
        if any(h["Name"] == name and h["Type"] == rtype and h["Address"] == addr
               for h in hosts):
            print(f"exact record already present: {name} {rtype} {addr} — nothing to do")
            return
        snapshot(hosts, email_type, raw, f"before-add-{name}")
        hosts.append({"Name": name, "Type": rtype, "Address": addr,
                      "MXPref": "10", "TTL": ttl})
        set_hosts(hosts, email_type)
        print(f"added {rtype} {name} -> {addr} ({len(hosts)} records total)")
        return
    if cmd == "del-txt":
        name = sys.argv[2]
        keep = [h for h in hosts if not (h["Type"] == "TXT" and h["Name"] == name)]
        if len(keep) == len(hosts):
            print(f"no TXT records at {name} — nothing to do")
            return
        snapshot(hosts, email_type, raw, f"before-del-{name}")
        set_hosts(keep, email_type)
        print(f"removed {len(hosts) - len(keep)} TXT record(s) at {name} "
              f"({len(keep)} records remain)")
        return
    sys.exit(__doc__)


if __name__ == "__main__":
    main()
