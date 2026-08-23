#!/usr/bin/env python3
"""Network-growth integration test for RACK & ROLL '26.

Grows a multi-level invite network through the REAL claim/invite endpoints of a
local dev worker, then audits every invariant that matters for the crew and the
downline chain: crew attribution follows the chain, no inviter leakage, reach +
downline aggregate correctly, the invite cap holds, and a traded ("cheated")
code splits provenance without contradicting the display.

Run it:
  1) Start a local worker with Turnstile bypassed (Cloudflare's always-pass test
     secret) and a future SEASON_START so nothing wipes:

     bash tools/cfrun.sh wrangler dev --local --port 8788 \\
       --var TURNSTILE_SECRET:1x0000000000000000000000000000000AA \\
       --var ADMIN_SECRET:simadmin --var SITE_ORIGIN:http://localhost:8788 \\
       --var SEASON_START:2027-01-01T00:00:00Z

  2) In another shell:  python3 tools/sim_network.py

The script reseeds the local D1 itself (crew + a code pool) before each run.
Exits non-zero if any invariant fails.
"""
import json, os, re, subprocess, sys, urllib.request, urllib.error

BASE = os.environ.get("SIM_BASE", "http://localhost:8788")
HERE = os.path.dirname(os.path.abspath(__file__))
CEDIA = os.path.dirname(HERE)
UA = {"content-type": "application/json", "user-agent": "Mozilla/5.0 sim"}

# ---- seed the local D1 -----------------------------------------------------
CREW = [("sam", "corduroy-soffit", "Sam Myers", "samkey"),
        ("connor", "caffeinated-lumen", "Connor McCullough", "connorkey"),
        ("pearl", "color-corrected-tweeter", "Pearl Myers", "pearlkey")]
FIRST = ["photon","spectral","kelvin","aligned","velvet","gigabit","dichroic","phase",
         "wireless","infrared","quantum","analog","matte","chromatic","helical","lumen",
         "ohmic","dynamic","static","resonant"]
SECOND = ["rack","truss","keypad","ballast","driver","soffit","downlight","backbox","node",
          "capacitor","tweeter","decoder","relay","gasket","conduit","fader","gobo","riser",
          "shroud","manifold"]

import time
def _d1(*args):
    # the dev server holds the local D1; a concurrent execute can hit a
    # transient SQLite lock at startup — retry a few times.
    for attempt in range(4):
        p = subprocess.run(["bash", os.path.join(HERE, "cfrun.sh"), "wrangler", "d1",
                            "execute", "rr26", "--local", "-y", *args],
                           cwd=CEDIA, capture_output=True)
        if p.returncode == 0:
            return
        time.sleep(1.5)
    raise RuntimeError(f"d1 execute failed: {p.stderr.decode()[-400:]}")

def wrangler(sql):
    _d1("--command", sql)

def reseed():
    # cfrun.sh cd's into worker/, so wrangler resolves --file from there.
    _d1("--file", "schema.sql")
    wrangler("DELETE FROM tokens; DELETE FROM rolls; DELETE FROM flags;")
    lines = []
    for inviter, codename, display, key in CREW:
        tok = codename.upper().replace("-", "")[:10]
        lines.append(f"INSERT INTO tokens (token,inviter,codename,claimed_at,display,mint_key) "
                     f"VALUES ('{tok}','{inviter}','{codename}','2026-08-20 00:00:00','{display}','{key}');")
    pool, i = [], 0
    for a in FIRST:
        for b in SECOND:
            pool.append(f"{a}-{b}")
    for i, code in enumerate(pool[:60]):
        lines.append(f"INSERT INTO tokens (token,inviter,codename) "
                     f"VALUES ('{code}','{CREW[i % 3][0]}','{code}');")
    wrangler("\n".join(lines))

# ---- http helpers ----------------------------------------------------------
def post(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), headers=UA)
    try:
        with urllib.request.urlopen(req) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return {"_http": e.code}

def get(path):
    with urllib.request.urlopen(BASE + path) as r:
        return r.read().decode()

claim = lambda code, disp, ref=None: post("/api/claim", {"token": code, "display": disp,
                                                         "turnstile": "x", "parent": ref or ""})
mint = lambda cn, key: post("/api/invite", {"codename": cn, "key": key})

# ---- grow ------------------------------------------------------------------
def main():
    reseed()
    crew = {h: (cn, key) for h, cn, _, key in CREW}
    disp0 = {"sam": "Sam Myers", "connor": "Connor McCullough", "pearl": "Pearl Myers"}
    players = {crew[h][0]: {"display": disp0[h], "key": crew[h][1], "crew": h, "parent": None}
               for h in crew}
    code_minter, fails = {}, []

    def do_mint(m):
        r = mint(m, players[m]["key"])
        if not r.get("ok"): return None
        code_minter[r["code"]] = m
        return r["code"]

    def do_claim(code, disp, ref=None):
        r = claim(code, disp, ref)
        if not r.get("ok"):
            fails.append(f"claim {disp} on {code}: {r}"); return None
        cn, m = r["codename"], code_minter.get(code)
        parent = ref or m
        players[cn] = {"display": disp, "key": r.get("mintKey"),
                       "crew": players[parent]["crew"] if parent else None, "parent": parent}
        return cn

    print("== grow ==")
    l1, nm = [], iter("Alice Bob Cara Dave Eve Finn Gwen Hank Ivy".split())
    for h in crew:
        for _ in range(3):
            c = do_mint(crew[h][0]); newc = do_claim(c, next(nm)) if c else None
            if newc: l1.append(newc)
    l2, nm2 = [], iter(f"L2-{i}" for i in range(20))
    for cn in l1[:3]:
        for _ in range(3):
            c = do_mint(cn); newc = do_claim(c, next(nm2)) if c else None
            if newc: l2.append(newc)
    l3, nm3 = [], iter(f"L3-{i}" for i in range(10))
    for _ in range(3):
        c = do_mint(l2[0]); newc = do_claim(c, next(nm3)) if c else None
        if newc: l3.append(newc)
    print(f"  L1={len(l1)} L2={len(l2)} L3={len(l3)}")

    traded = None
    if len(l1) >= 7:
        c = do_mint(l1[3])                       # connor-crew minter
        traded = do_claim(c, "Traitor", ref=l1[6])  # names a pearl-crew sponsor
    cap = mint(crew["sam"][0], "samkey")
    if not (cap.get("ok") is False and cap.get("capped")):
        fails.append(f"cap not enforced: {cap}")
    for cn, n in ((l3[0], 3), (l2[0], 2), (l1[0], 1)):
        for _ in range(n):
            urllib.request.urlopen(BASE + f"/roll.gif?who={cn}").read()  # binary gif

    # ---- audit ----
    print("== audit ==")
    kids = {}
    for cn, p in players.items():
        if p["parent"]: kids.setdefault(p["parent"], []).append(cn)
    def desc(cn):
        out = []
        for k in kids.get(cn, []): out.append(k); out.extend(desc(k))
        return out
    actual = {p["codename"]: p["rolls"] for p in json.loads(get("/leaderboard.json"))["players"]}
    def reach(cn): return sum(actual.get(x, 0) for x in [cn] + desc(cn))
    def root(cn):
        seen = set()
        while players[cn]["parent"] and cn not in seen:
            seen.add(cn); cn = players[cn]["parent"]
        return players[cn]["crew"]
    RC, RR, RL = re.compile(r"crew:\s*([a-z]+)"), re.compile(r"Roped in by <a[^>]*>([^<]+)</a>"), re.compile(r"Lone wolf")
    RE = re.compile(r"Reach:\s*<strong>(\d+)</strong>.*?downline of <strong>(\d+)</strong>", re.S)
    ck = lambda c, m: None if c else fails.append(m)
    for cn, p in players.items():
        if p["crew"] is None: continue
        h = get("/@" + cn)
        m = RC.search(h)
        ck(m and m.group(1) == p["crew"], f"{cn}: crew {m and m.group(1)} != {p['crew']}")
        ck(m and m.group(1) == root(cn), f"{cn}: crew != chain root {root(cn)}")
        if p["parent"]:
            rm = RR.search(h)
            ck(rm and rm.group(1) == players[p["parent"]]["display"], f"{cn}: roped-in wrong")
        else:
            ck(RL.search(h), f"{cn}: expected lone wolf")
        rc = RE.search(h)
        if rc: ck(int(rc.group(1)) == reach(cn), f"{cn}: reach {rc.group(1)} != {reach(cn)}"); \
               ck(int(rc.group(2)) == len(desc(cn)), f"{cn}: downline {rc.group(2)} != {len(desc(cn))}")
        else: fails.append(f"{cn}: no reach line")
    lb = json.loads(get("/leaderboard.json"))
    for pl in lb["players"]:
        ck(pl["inviter"] in ("sam", "connor", "pearl"), f"inviter leak {pl['inviter']}")
    exp = {"sam": 0, "connor": 0, "pearl": 0}
    for p in players.values(): exp[p["crew"]] += 1
    got = {r["inviter"]: r["claims"] for r in lb["recruiters"]}
    for h in exp: ck(got.get(h) == exp[h], f"recruiter {h}: {got.get(h)} != {exp[h]}")

    print(f"  audited {len(players)} players")
    if fails:
        print(f"\n!! {len(fails)} FINDINGS")
        for f in fails[:40]: print("  -", f)
        sys.exit(1)
    print("\nALL INVARIANTS HOLD")

if __name__ == "__main__":
    main()
