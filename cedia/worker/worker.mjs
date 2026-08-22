// RACK & ROLL '26 — the one Worker.
// Static assets (landing, rules, leaderboard shell, CSS) are served by the
// assets binding; this code owns the dynamic paths: invite/claim, player
// pages, beacons, leaderboard JSON, admin. Everything user-influenced is
// escaped at render and capped at write. D1 owns the single-claim invariant.

import {
  BIO_MAX, PHOTO_MAX_BYTES, cleanBio, cleanDisplay, cleanEmail, escapeHtml,
  identicon, makeVcard, normToken, rollKey, sniffJpeg, utcDay, CODENAME_RE,
} from "./lib.mjs";
import { qrSvg } from "./qr.mjs";

const RICK = "dQw4w9WgXcQ";
const ROLL_CAP_PER_IP_DAY = 3;      // rolls one IP can score per codename/day
const BUSTED_TRIPWIRE = 50;         // raw hits/IP/day before the curl badge
const INVITE_CAP = 3;               // invites a player may MINT (the official number)

function randHex(n) {
  return [...crypto.getRandomValues(new Uint8Array(n))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

const SEC_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  // origin-only (not full path): private enough for our public codenames, and
  // crucially it lets YouTube see the embedding origin — no-referrer stripped
  // it entirely and YouTube answered the pre-roll with error 153.
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

// Bare paths served straight from static assets (no DB lookup). Everything
// else that isn't a file (no ".") is treated as a code to resolve.
const ASSET_PATHS = new Set(["", "leaderboard", "admin", "index"]);

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;
    // Canonical host: rackroll.win (the typo domain) and www both 301 here,
    // so every card/QR resolves to one place no matter what people type.
    if (url.hostname !== "rickroll.win") {
      return Response.redirect("https://rickroll.win" + p + url.search, 301);
    }
    try {
      if (p === "/leaderboard.json") return leaderboard(req, env);
      if (p === "/stats") return stats(env);
      if (p === "/cheat") return cheat();
      if (p === "/roll.gif") return roll(req, env, ctx);
      if (p === "/api/claim" && req.method === "POST") return claim(req, env);
      if (p === "/api/invite" && req.method === "POST") return mintInvite(req, env);
      if (p === "/api/admin" && req.method === "POST") return admin(req, env);
      if (p.startsWith("/@")) return playerRoutes(req, env, p.slice(2));
      if (p.startsWith("/photo/")) return photo(env, p.slice(7));
      if (p.startsWith("/avatar/")) return avatar(p.slice(8));
      if (p.startsWith("/qr/")) return qrRoute(env, p.slice(4));
      // Static assets keep a fast path (no DB): the root, anything with a file
      // extension, and the handful of named pages.
      const seg = p.slice(1);
      if (p === "/" || seg.includes(".") || ASSET_PATHS.has(seg)) {
        return env.ASSETS.fetch(req);
      }
      // Everything else is treated as a code: a word-pair, a 10-char token, or
      // a codename (the crew seeds have token != codename). invite() resolves
      // any of those and snarky-404s a real miss. /i/<code> is an alias.
      const raw = seg.startsWith("i/") ? seg.slice(2) : seg;
      return invite(env, raw);
    } catch (e) {
      return new Response("the rack fell over. try again.", { status: 500 });
    }
  },

  // Sandbox → live. Cron ticks every 15 min; the first tick at/after
  // SEASON_START wipes every practice claim + roll (codes survive, cards keep
  // working) and latches the `season_started` flag so the real season is never
  // wiped again. No human, no AI, no terminal — it just happens.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(maybeStartSeason(env));
  },
};

// Parse SEASON_START; true while we're still before it (the sandbox window).
// Unset/unparseable => treat as already live (fail open to the real game).
function beforeStart(env) {
  const t = Date.parse(env.SEASON_START || "");
  return Number.isFinite(t) && Date.now() < t;
}

// Shown on the interactive pages during the sandbox window so testers know
// the slate wipes clean at go-live. Disappears on its own once we're live.
function sandboxBanner(env) {
  if (!beforeStart(env)) return "";
  return `<div class="sandbox">SANDBOX &middot; practice run. Everything here ` +
    `wipes clean when the network goes live <strong>Aug 31</strong>. Break it, ` +
    `test it, have fun &mdash; nothing you do now counts yet.</div>`;
}

// Tokens that survive the go-live wipe as fixtures (crew seed pages). Their
// claim stays; only their practice scores reset. Everyone else wipes clean.
function seedTokens(env) {
  return String(env.SEED_TOKENS || "").split(",")
    .map((s) => s.trim()).filter(Boolean);
}

async function maybeStartSeason(env) {
  const t = Date.parse(env.SEASON_START || "");
  if (!Number.isFinite(t) || Date.now() < t) return;      // not yet
  if (await flag(env, "season_started")) return;          // already done
  const keep = seedTokens(env);
  const ph = keep.map(() => "?").join(",");
  const notIn = keep.length ? ` WHERE token NOT IN (${ph})` : "";
  // One transaction: wipe every non-fixture claim (codes stay unclaimed so
  // printed cards still work), zero the fixtures' practice scores, drop all
  // rolls, and latch the flag — all-or-nothing so a partial failure can never
  // leave the reset half-done or re-fire and wipe the live season every tick.
  const stmts = [
    env.DB.prepare(
      `UPDATE tokens SET claimed_at=NULL, display=NULL, bio=NULL, company=NULL,
         email=NULL, has_photo=0, busted=0, parent=NULL${notIn}`).bind(...keep),
  ];
  if (keep.length) {
    stmts.push(env.DB.prepare(
      `UPDATE tokens SET busted=0, parent=NULL WHERE token IN (${ph})`).bind(...keep));
  }
  stmts.push(env.DB.prepare("DELETE FROM rolls"));
  stmts.push(env.DB.prepare(
    `INSERT INTO flags (name,value) VALUES ('season_started','1')
     ON CONFLICT(name) DO UPDATE SET value='1'`));
  await env.DB.batch(stmts);
}

// ---- invite / claim ---------------------------------------------------------

async function invite(env, raw) {
  const row = await resolveEntry(env, raw);
  if (!row) return snarky404();
  if (row.claimed_at) {
    return Response.redirect(`${env.SITE_ORIGIN}/@${row.codename}`, 302);
  }
  const token = row.token;
  // claimed players feed the "who roped you in?" autocomplete (fuzzy-findable
  // by codename or display name)
  const players = await env.DB.prepare(
    "SELECT codename, display FROM tokens WHERE claimed_at IS NOT NULL AND hidden = 0 ORDER BY display"
  ).all();
  // no-store: the claim page must reflect live claimed/unclaimed state — a
  // cached copy could show the form for a code someone already claimed.
  return html(claimPage(env, token, row, players.results || []),
    200, { "cache-control": "no-store" });
}

// Resolve a pasted string to a row by TOKEN or CODENAME, tolerant of format:
// word-pair ("photon-rack"), 10-char crew token ("3J5BXDSGZ5"), a codename
// that differs from its token, and any casing. This is why a crew member can
// paste their codename OR their code and land on their page either way.
async function resolveEntry(env, raw) {
  const wp = normToken(raw);                                        // word-pair
  const up = String(raw || "").toUpperCase().replace(/[^0-9A-Z]/g, ""); // token
  const low = String(raw || "").trim().toLowerCase();              // codename
  const cands = [...new Set([wp, up, low].filter(Boolean))];
  if (!cands.length) return null;
  const ph = cands.map(() => "?").join(",");
  return env.DB.prepare(
    `SELECT token, codename, inviter, claimed_at, minted_by FROM tokens
     WHERE token IN (${ph}) OR codename IN (${ph}) LIMIT 1`
  ).bind(...cands, ...cands).first();
}

// /qr/<codename> -> SVG QR of that player's page (for anyone who wants the
// image directly). The player page also inlines its own QR, so this is a
// convenience/fallback, cached hard at the edge.
async function qrRoute(env, rest) {
  const codename = rest.endsWith(".svg") ? rest.slice(0, -4) : rest;
  if (!CODENAME_RE.test(codename)) return snarky404();
  const svg = qrSvg(`${env.SITE_ORIGIN}/@${codename}`);
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=86400",
      ...SEC_HEADERS,
    },
  });
}

// Best-effort: resolve a typed referrer to a real claimed codename. Exact
// codename wins; else a unique fuzzy hit on codename OR display name. Never
// throws and never blocks a claim — a bad/blank referrer just means no parent
// (a "lone wolf"). Can't self-parent; can't parent an unclaimed page (so the
// chain is always a tree rooted at a real, earlier claim — no cycles).
async function resolveParent(env, raw, selfToken) {
  const slug = normToken(raw);
  const needle = String(raw || "").trim().toLowerCase();
  if (!needle) return null;
  if (slug) {
    const exact = await env.DB.prepare(
      "SELECT codename FROM tokens WHERE codename = ? AND claimed_at IS NOT NULL AND hidden = 0 AND codename != ?"
    ).bind(slug, selfToken).first();
    if (exact) return exact.codename;
  }
  const like = "%" + needle.replace(/[%_]/g, "") + "%";
  const hits = await env.DB.prepare(
    `SELECT codename FROM tokens
     WHERE claimed_at IS NOT NULL AND hidden = 0 AND codename != ?
       AND (codename LIKE ? OR lower(display) LIKE ?) LIMIT 2`
  ).bind(selfToken, like, like).all();
  const rows = hits.results || [];
  return rows.length === 1 ? rows[0].codename : null;   // ambiguous -> none
}

async function claim(req, env) {
  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return jerr(400, "json only");
  let body;
  try { body = await req.json(); } catch { return jerr(400, "bad json"); }

  const token = normToken(body.token);
  if (!token) return jerr(400, "that code is a forgery");

  // Turnstile: the attendees own Claude; the robots buy a ticket like anyone.
  const ts = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      secret: env.TURNSTILE_SECRET,
      response: String(body.turnstile || ""),
      remoteip: req.headers.get("CF-Connecting-IP") || "",
    }),
  }).then((r) => r.json()).catch(() => ({ success: false }));
  if (!ts.success) return jerr(403, "the robot check doubts you");

  const display = cleanDisplay(body.display);
  if (!display) return jerr(400, "pick a printable name, 40 chars max");
  const bio = cleanBio(body.bio);
  const company = cleanBio(body.company).slice(0, 60);
  const email = cleanEmail(body.email);
  if (email === null) return jerr(400, "that email doesn't parse");

  // Chain parent: what the claimer typed wins; otherwise, if a player MINTED
  // this code for them, they default into that player's downline. (They can
  // still name someone else — that mismatch is exactly the provenance we log.)
  let parent = body.parent ? await resolveParent(env, body.parent, token) : null;
  if (!parent) {
    const m = await env.DB.prepare(
      "SELECT minted_by FROM tokens WHERE token = ?").bind(token).first();
    if (m && m.minted_by) parent = m.minted_by;
  }
  const mintKey = randHex(16); // owner secret: gates minting from this device

  let hasPhoto = 0;
  let photoBytes = null;
  if (body.photo) {
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(body.photo));
    if (!m) return jerr(400, "photo must be a jpeg (the form resizes for you)");
    try { photoBytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)); }
    catch { return jerr(400, "photo didn't decode"); }
    if (!sniffJpeg(photoBytes)) {
      return jerr(400, `photo must be a real jpeg under ${PHOTO_MAX_BYTES / 1024}KB`);
    }
    hasPhoto = 1;
  }

  // THE claim: atomic single-winner. A replayed/scripted second claim loses
  // here no matter what the client said. Pages are immutable after this.
  const res = await env.DB.prepare(
    `UPDATE tokens SET claimed_at = datetime('now'), display = ?, bio = ?,
       company = ?, email = ?, has_photo = ?, parent = ?, mint_key = ?
     WHERE token = ? AND claimed_at IS NULL`
  ).bind(display, bio, company, email || "", hasPhoto, parent, mintKey, token).run();
  if (!res.meta || res.meta.changes !== 1) {
    return jerr(409, "already claimed. first scan wins; that's rule zero");
  }
  const row = await env.DB.prepare(
    "SELECT codename FROM tokens WHERE token = ?").bind(token).first();
  if (hasPhoto) {
    await env.KV.put(`photo:${row.codename}`, photoBytes.buffer);
  }
  return json({
    ok: true, page: `${env.SITE_ORIGIN}/@${row.codename}`,
    codename: row.codename, mintKey,
  });
}

// Mint an invite: a claimed player pulls a fresh code from the pool into their
// own downline. Gated by the mint_key handed to them at claim (so only the
// person who claimed can mint, from the device they claimed on). Capped at
// INVITE_CAP — "officially". Out-of-band code sharing is not blocked; it's
// logged (minted_by stays the origin, parent records who the claimer names).
async function mintInvite(req, env) {
  let body;
  try { body = await req.json(); } catch { return jerr(400, "bad json"); }
  const codename = String(body.codename || "");
  if (!CODENAME_RE.test(codename)) return jerr(400, "who are you again?");
  const me = await env.DB.prepare(
    "SELECT mint_key, claimed_at FROM tokens WHERE codename = ?").bind(codename).first();
  if (!me || !me.claimed_at) return jerr(404, "claim a page before you recruit");
  if (!me.mint_key || me.mint_key !== String(body.key || "")) {
    return jerr(403, "recruit from the phone you claimed on (that's where your key lives)");
  }
  const cnt = await env.DB.prepare(
    "SELECT COUNT(*) n FROM tokens WHERE minted_by = ?").bind(codename).first();
  if ((cnt ? cnt.n : 0) >= INVITE_CAP) {
    return json({
      ok: false, capped: true,
      error: `You've minted your ${INVITE_CAP}. Officially, that's the limit. ` +
        `If a code reaches someone another way, we're not the police. (We are, ` +
        `however, keeping the receipts.)`,
    });
  }
  // Atomic allocate: grab one unclaimed, unminted code for this player.
  const alloc = await env.DB.prepare(
    `UPDATE tokens SET minted_by = ?, minted_at = datetime('now')
     WHERE token IN (
       SELECT token FROM tokens
       WHERE claimed_at IS NULL AND minted_by IS NULL
       ORDER BY token LIMIT 1)
     RETURNING token`).bind(codename).first();
  if (!alloc || !alloc.token) {
    return json({ ok: false, error: "the invite drawer is empty. recruit the old-fashioned way: say a code out loud." });
  }
  const url = `${env.SITE_ORIGIN}/${alloc.token}`;
  return json({
    ok: true, code: alloc.token, url, qr: qrSvg(url),
    left: INVITE_CAP - ((cnt ? cnt.n : 0) + 1),
  });
}

// ---- player pages -----------------------------------------------------------

async function playerRoutes(req, env, rest) {
  const wantVcf = rest.endsWith(".vcf");
  const codename = wantVcf ? rest.slice(0, -4) : rest;
  if (!CODENAME_RE.test(codename)) return snarky404();
  const row = await env.DB.prepare(
    `SELECT codename, inviter, display, bio, company, email, has_photo, hidden,
            busted, claimed_at, parent FROM tokens WHERE codename = ?`
  ).bind(codename).first();
  if (!row || !row.claimed_at || row.hidden) return snarky404();
  if (wantVcf) {
    if (!row.email) return snarky404();
    return new Response(makeVcard({
      display: row.display, company: row.company, email: row.email,
      url: `${env.SITE_ORIGIN}/@${row.codename}`,
    }), {
      headers: {
        "content-type": "text/vcard",
        "content-disposition": `attachment; filename="${row.codename}.vcf"`,
        ...SEC_HEADERS,
      },
    });
  }
  const photosKilled = await flag(env, "photos_killed");
  const lineage = await getLineage(env, row);
  return html(playerPage(env, row, photosKilled, lineage));
}

// The chain: who roped you in, who you brought, and your "reach" (rolls across
// your whole downline). Reach is the perceived bonus for being on a real chain
// early — the trunk accumulates every descendant's rolls; a lone wolf who
// skipped attribution only ever counts their own.
async function getLineage(env, row) {
  let parent = null;
  if (row.parent) {
    parent = await env.DB.prepare(
      "SELECT codename, display FROM tokens WHERE codename = ? AND claimed_at IS NOT NULL AND hidden = 0"
    ).bind(row.parent).first();
  }
  const kids = await env.DB.prepare(
    "SELECT codename, display FROM tokens WHERE parent = ? AND claimed_at IS NOT NULL AND hidden = 0 ORDER BY claimed_at"
  ).bind(row.codename).all();
  // recursive downline (self + descendants), then sum their rolls
  const sub = await env.DB.prepare(
    `WITH RECURSIVE line(codename) AS (
       SELECT ? UNION
       SELECT t.codename FROM tokens t JOIN line l ON t.parent = l.codename
       WHERE t.claimed_at IS NOT NULL AND t.hidden = 0)
     SELECT (SELECT COUNT(*) FROM line) - 1 AS downline,
            COALESCE((SELECT SUM(count) FROM rolls WHERE codename IN (SELECT codename FROM line)), 0) AS reach`
  ).bind(row.codename).first();
  return {
    parent,
    children: kids.results || [],
    downline: sub ? sub.downline : 0,
    reach: sub ? sub.reach : 0,
  };
}

async function photo(env, name) {
  const codename = name.replace(/\.jpg$/, "");
  if (!CODENAME_RE.test(codename)) return snarky404();
  if (await flag(env, "photos_killed")) return snarky404();
  const row = await env.DB.prepare(
    "SELECT hidden FROM tokens WHERE codename = ? AND claimed_at IS NOT NULL"
  ).bind(codename).first();
  if (!row || row.hidden) return snarky404();
  const bytes = await env.KV.get(`photo:${codename}`, "arrayBuffer");
  if (!bytes) return snarky404();
  return new Response(bytes, {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "public, max-age=300",
      "content-security-policy": "sandbox",   // a polyglot is inert here
      ...SEC_HEADERS,
    },
  });
}

function avatar(name) {
  const codename = name.replace(/\.svg$/, "");
  if (!CODENAME_RE.test(codename)) return snarky404();
  return new Response(identicon(codename), {
    headers: {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=86400",
      "content-security-policy": "sandbox",
      ...SEC_HEADERS,
    },
  });
}

// ---- rolls ------------------------------------------------------------------

const GIF = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="),
  (c) => c.charCodeAt(0));

async function roll(req, env, ctx) {
  const gif = new Response(GIF, {
    headers: { "content-type": "image/gif", "cache-control": "no-store" },
  });
  const codename = new URL(req.url).searchParams.get("who") || "";
  if (!CODENAME_RE.test(codename)) return gif;
  ctx.waitUntil(countRoll(req, env, codename));
  return gif;   // the gif is always served; scoring is best-effort
}

async function countRoll(req, env, codename) {
  const ip = req.headers.get("CF-Connecting-IP") || "0.0.0.0";
  const day = utcDay();
  const key = await rollKey(ip, codename, day);
  const seen = parseInt((await env.KV.get(key)) || "0", 10);
  await env.KV.put(key, String(seen + 1), { expirationTtl: 90000 });
  if (seen + 1 === BUSTED_TRIPWIRE) {
    // we see you, curl user — the badge, not the ban
    await env.DB.prepare("UPDATE tokens SET busted = 1 WHERE codename = ?")
      .bind(codename).run();
  }
  if (seen >= ROLL_CAP_PER_IP_DAY) return;
  const exists = await env.DB.prepare(
    "SELECT 1 FROM tokens WHERE codename = ? AND claimed_at IS NOT NULL AND hidden = 0"
  ).bind(codename).first();
  if (!exists) return;
  await env.DB.prepare(
    `INSERT INTO rolls (codename, day, count) VALUES (?, ?, 1)
     ON CONFLICT(codename, day) DO UPDATE SET count = count + 1`
  ).bind(codename, day).run();
}

// ---- leaderboard ------------------------------------------------------------

async function leaderboard(req, env) {
  const players = await env.DB.prepare(
    `SELECT t.codename, t.display, t.inviter, t.busted, t.parent,
            COALESCE(SUM(r.count), 0) AS rolls
     FROM tokens t LEFT JOIN rolls r ON r.codename = t.codename
     WHERE t.claimed_at IS NOT NULL AND t.hidden = 0
     GROUP BY t.codename
     ORDER BY rolls DESC, t.claimed_at DESC, t.codename`).all();
  const kidRows = await env.DB.prepare(
    `SELECT parent, COUNT(*) AS c FROM tokens
     WHERE parent IS NOT NULL AND claimed_at IS NOT NULL AND hidden = 0
     GROUP BY parent`).all();
  const kids = {};
  for (const k of (kidRows.results || [])) kids[k.parent] = k.c;
  const recruiters = await env.DB.prepare(
    `SELECT inviter, COUNT(claimed_at) AS claims, COUNT(*) AS invitations
     FROM tokens GROUP BY inviter`).all();
  const unclaimed = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM tokens WHERE claimed_at IS NULL").first();
  // Server-assigned slugs + charset-enforced display names ONLY: this JSON is
  // rendered on the flagship domain, so nothing free-form rides in it.
  const body = JSON.stringify({
    game: "RACK & ROLL '26",
    updated: new Date().toISOString().slice(0, 16) + "Z",
    players: (players.results || []).map((r) => ({
      codename: r.codename,
      display: r.display,
      inviter: r.inviter,
      rolls: r.rolls,
      busted: !!r.busted,
      parent: r.parent || null,
      downline: kids[r.codename] || 0,
    })),
    recruiters: recruiters.results || [],
    unclaimed_invitations: unclaimed ? unclaimed.n : 0,
    sandbox: beforeStart(env),
  });
  const origin = req.headers.get("Origin") || "";
  const allow = origin === env.DS_ORIGIN ? origin : env.DS_ORIGIN;
  return new Response(body, {
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": allow,
      "cache-control": "public, max-age=30",
      ...SEC_HEADERS,
    },
  });
}

// ---- stats (how it propagates) ---------------------------------------------
// Cached 30 min at the edge — the "periodic update" without a cron. Recomputed
// on the first request after the cache lapses.

async function stats(env) {
  const c = await env.DB.prepare(
    `SELECT COUNT(*) total,
            SUM(CASE WHEN claimed_at IS NOT NULL THEN 1 ELSE 0 END) claimed,
            SUM(CASE WHEN claimed_at IS NOT NULL AND parent IS NOT NULL THEN 1 ELSE 0 END) in_chain
     FROM tokens WHERE token NOT LIKE 'test-%'`).first();
  const rec = await env.DB.prepare(
    `SELECT inviter, COUNT(claimed_at) claims FROM tokens
     WHERE token NOT LIKE 'test-%' GROUP BY inviter ORDER BY claims DESC`).all();
  const connectors = await env.DB.prepare(
    `SELECT p.display, p.codename, COUNT(*) kids FROM tokens t
     JOIN tokens p ON p.codename = t.parent
     WHERE t.claimed_at IS NOT NULL AND t.hidden = 0
       AND t.token NOT LIKE 'test-%' AND p.token NOT LIKE 'test-%'
     GROUP BY t.parent ORDER BY kids DESC LIMIT 10`).all();
  const daily = await env.DB.prepare(
    `SELECT substr(claimed_at,1,10) d, COUNT(*) n FROM tokens
     WHERE claimed_at IS NOT NULL AND token NOT LIKE 'test-%'
     GROUP BY d ORDER BY d`).all();

  const t = c || { total: 0, claimed: 0, in_chain: 0 };
  const pct = t.claimed ? Math.round((t.in_chain / t.claimed) * 100) : 0;
  const recRows = (rec.results || []).map((r) =>
    `<tr><td>${escapeHtml(r.inviter)}</td><td class="n">${r.claims}</td></tr>`).join("");
  const conRows = (connectors.results || []).length
    ? (connectors.results).map((r) =>
        `<tr><td><a href="/@${encodeURIComponent(r.codename)}">${escapeHtml(r.display || r.codename)}</a></td><td class="n">${r.kids}</td></tr>`).join("")
    : `<tr><td colspan="2">no chains yet — nobody's roped anyone in</td></tr>`;
  const dayRows = (daily.results || []).map((r) =>
    `<tr><td>${escapeHtml(r.d)}</td><td class="n">${r.n}</td></tr>`).join("");

  const bodyHtml = `<main>
${sandboxBanner(env)}<p class="masthead">RACK &amp; ROLL '26 &middot; how it's spreading</p>
<h1>The propagation</h1>
<div class="box warm"><h2>Right now</h2><div class="pad">
<p><strong>${t.claimed}</strong> claimed of ${t.total} codes &middot;
<strong>${t.in_chain}</strong> joined someone's chain (${pct}%) &middot;
the rest are roots or lone wolves.</p>
<p class="muted">Updates every ~30 minutes.</p></div></div>
<div class="box"><h2>Recruiter race</h2><div class="pad">
<table class="lb"><thead><tr><th>Recruiter</th><th class="n">Claims</th></tr></thead>
<tbody>${recRows}</tbody></table></div></div>
<div class="box"><h2>Best connectors (most roped in)</h2><div class="pad">
<table class="lb"><thead><tr><th>Player</th><th class="n">Brought in</th></tr></thead>
<tbody>${conRows}</tbody></table>
<p class="muted">reach (rolls across a whole downline) shows on each profile.</p></div></div>
<div class="box"><h2>Claims by day</h2><div class="pad">
<table class="lb"><thead><tr><th>Day</th><th class="n">New players</th></tr></thead>
<tbody>${dayRows}</tbody></table></div></div>
<footer><p><a href="/leaderboard">the scoreboard</a> &middot;
<a href="https://diligentservices.io/">a Diligent Services thing</a></p></footer>
</main>`;
  return html(bodyHtml, 200, { "cache-control": "public, max-age=1800" });
}

// ---- admin (phone-usable; secret in 1P) ------------------------------------

async function admin(req, env) {
  const body = await req.json().catch(() => ({}));
  const provided = String(body.secret || "");
  const want = String(env.ADMIN_SECRET || "");
  const a = new TextEncoder().encode(provided.padEnd(64).slice(0, 64));
  const b = new TextEncoder().encode(want.padEnd(64).slice(0, 64));
  let diff = provided.length === want.length ? 0 : 1;
  for (let i = 0; i < 64; i++) diff |= a[i] ^ b[i];
  if (!want || diff) return jerr(403, "no");
  const act = String(body.action || "");
  const codename = String(body.codename || "");
  if (act === "photos_off" || act === "photos_on") {
    await env.DB.prepare(
      "INSERT INTO flags (name, value) VALUES ('photos_killed', ?) " +
      "ON CONFLICT(name) DO UPDATE SET value = excluded.value"
    ).bind(act === "photos_off" ? "1" : "0").run();
    return json({ ok: true, photos_killed: act === "photos_off" });
  }
  if (!CODENAME_RE.test(codename)) return jerr(400, "bad codename");
  if (act === "hide" || act === "unhide") {
    await env.DB.prepare("UPDATE tokens SET hidden = ? WHERE codename = ?")
      .bind(act === "hide" ? 1 : 0, codename).run();
    return json({ ok: true, codename, hidden: act === "hide" });
  }
  if (act === "nuke") {   // page + photo, gone
    await env.DB.prepare("UPDATE tokens SET hidden = 1, has_photo = 0 WHERE codename = ?")
      .bind(codename).run();
    await env.KV.delete(`photo:${codename}`);
    return json({ ok: true, codename, nuked: true });
  }
  return jerr(400, "unknown action");
}

// ---- templates --------------------------------------------------------------

function preRoll(env, codename, first) {
  // youtube-nocookie = the privacy-enhanced embed domain (no tracking cookie
  // until play). origin + enablejsapi are required for the unmute postMessage;
  // iv_load_policy=3 kills annotations, modestbranding trims chrome.
  const embed = `https://www.youtube-nocookie.com/embed/${RICK}` +
    "?autoplay=1&mute=1&playsinline=1&rel=0&iv_load_policy=3&modestbranding=1" +
    "&enablejsapi=1&origin=" + encodeURIComponent(env.SITE_ORIGIN);
  const f = escapeHtml(first);
  return `
<div id="preroll" hidden>
  <h2>Before you meet ${f}&hellip;</h2>
  <div id="preroll-video"></div>
  <div>
    <button id="preroll-sound" type="button">&#128266; It deserves sound</button>
    <button id="preroll-skip" type="button">Skip &rarr;</button>
  </div>
</div>
<script>
(function () {
  function rolled() {
    try { if (localStorage.getItem("rr26_rolled")) return true; } catch (e) {}
    return document.cookie.indexOf("rr26_rolled=1") !== -1;
  }
  function markRolled() {
    try { localStorage.setItem("rr26_rolled", "1"); } catch (e) {}
    document.cookie = "rr26_rolled=1; max-age=31536000; path=/; SameSite=Lax";
  }
  if (rolled()) return;
  var el = document.getElementById("preroll");
  el.hidden = false; el.classList.add("show");
  document.body.style.overflow = "hidden";
  var f = document.createElement("iframe");
  f.src = ${JSON.stringify(embed)};
  f.allow = "autoplay; encrypted-media";
  document.getElementById("preroll-video").appendChild(f);
  new Image().src = "/roll.gif?who=${codename}&r=" + Math.random();
  markRolled();
  function dismiss() { clearTimeout(t); el.remove(); document.body.style.overflow = ""; }
  var t = setTimeout(dismiss, 13000);
  document.getElementById("preroll-skip").addEventListener("click", dismiss);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") dismiss(); });
  document.getElementById("preroll-sound").addEventListener("click", function () {
    clearTimeout(t);
    function cmd(fn, args) {
      f.contentWindow.postMessage(JSON.stringify({event: "command", func: fn, args: args || []}), "*");
    }
    cmd("unMute"); cmd("seekTo", [0, true]); cmd("playVideo");
    t = setTimeout(dismiss, 13000);
    this.remove();
  });
})();
</script>`;
}

function plink(p) {
  return `<a href="/@${encodeURIComponent(p.codename)}">${escapeHtml(p.display || p.codename)}</a>`;
}

// A deliberately opaque "compensation plan" rank. Blends downline size, reach,
// and whether you're plugged into an upline — on purpose you can't tell which
// one is carrying you. That's the MLM bit: is it better to have people under
// you, or to be under someone big? Nobody will say.
function mlmRank(ln) {
  const score = (ln.downline || 0) * 3 + (ln.reach || 0) + (ln.parent ? 2 : 0);
  const tiers = ["Prospect", "Associate", "Bronze Distributor", "Silver Distributor",
    "Gold Distributor", "Platinum Executive", "Diamond Founder's Circle"];
  let i = 0;
  for (const t of [1, 5, 12, 25, 50, 100]) if (score >= t) i++;
  return tiers[i];
}

function playerPage(env, row, photosKilled, lineage) {
  const name = escapeHtml(row.display);
  const first = row.display.split(" ")[0];
  const pageUrl = `${env.SITE_ORIGIN}/@${row.codename}`;
  const qr = qrSvg(pageUrl);
  const img = (row.has_photo && !photosKilled)
    ? `<img src="/photo/${row.codename}.jpg" alt="${name}">`
    : `<img src="/avatar/${row.codename}.svg" alt="avatar">`;
  const vcf = row.email
    ? `<p><a class="btn" href="/@${row.codename}.vcf" download>&#128190; Save my card</a></p>`
    : "";
  const busted = row.busted
    ? `<p class="busted">&#9888; definitely not curl</p>` : "";
  const ln = lineage || { parent: null, children: [], downline: 0, reach: 0 };
  const upline = ln.parent
    ? `<p>Roped in by ${plink(ln.parent)}.</p>`
    : `<p class="muted">Lone wolf &mdash; nobody roped you in. No chain, no bonus. (You can&#39;t change it now.)</p>`;
  const kids = ln.children.length
    ? `<p>Brought in (${ln.children.length}): ${ln.children.map(plink).join(" &middot; ")}</p>`
    : `<p class="muted">You haven&#39;t roped anyone in yet. Hand out a code and tell them to name you.</p>`;
  const reach = `<p class="tease">Reach: <strong>${ln.reach}</strong> ${ln.reach === 1 ? "roll" : "rolls"} across a downline of <strong>${ln.downline}</strong>. The original chains run deepest.</p>`;
  return `<main>
${sandboxBanner(env)}<p class="masthead">RACK &amp; ROLL '26 &middot; an invitational</p>
<h1>${name}</h1>
<div class="cols">
  <div class="col-l">
    <div class="box"><h2>${escapeHtml(row.codename)}</h2><div class="pad photo">${img}</div></div>
    <div class="box"><h2>Contact</h2><div class="pad">
      ${row.company ? `<p>${escapeHtml(row.company)}</p>` : ""}${vcf}
      <p class="muted">invited by ${escapeHtml(row.inviter)}</p>${busted}
    </div></div>
  </div>
  <div class="col-r">
    <div class="extnet"><strong>${escapeHtml(first)}</strong> is in the network now</div>
    <div class="box warm"><h2>Dossier</h2><div class="pad"><p>${escapeHtml(row.bio) || "No comment."}</p></div></div>
    <div class="box"><h2>The chain</h2><div class="pad">${upline}${kids}${reach}
      <p class="tease">Compensation rank: <strong>${mlmRank(ln)}</strong>.
      <span class="muted">Is it better to have a big downline, or to be plugged
      into a big upline? Our proprietary plan will never tell you. Keep
      recruiting to find out (you won&#39;t).</span></p></div></div>
    <div class="box warm"><h2>Roll the world</h2><div class="pad">
      <p>Every new visitor to your page eats ten seconds of Rick and scores you a
      point. Send it, or show your QR and let someone roll themselves.</p>
      <p><button class="btn" id="share" type="button">&#128279; Share</button>
      <button class="btn" id="qrbtn" type="button">&#9783; Show QR</button>
      <span class="muted" id="shared" hidden>&nbsp;copied</span></p>
      <p class="muted"><a href="/leaderboard">The scoreboard</a> &middot;
      <a href="/stats">how it&#39;s spreading</a></p>
    </div></div>
    <div class="box"><h2>Recruit your downline</h2><div class="pad">
      <p>The real money&#39;s in the network. Mint an invite, hand it to someone
      promising, and when they claim they&#39;re in <strong>your</strong> downline
      forever. You get <strong>${INVITE_CAP}</strong>. Officially.</p>
      <p><button class="btn" id="invite" type="button">Mint an invite</button>
      <span class="muted" id="invite-left"></span></p>
      <div id="invite-out" hidden>
        <p>Send this. First to claim it joins your downline:</p>
        <p><a id="invite-link" href="#" class="tease"></a></p>
        <div id="invite-qr" class="qrimg" style="max-width:12rem"></div>
        <p><button class="btn" id="invite-copy" type="button">copy link</button>
        <button class="btn" id="invite-more" type="button">mint another</button></p>
      </div>
      <p id="invite-err" class="busted" hidden></p>
      <p class="muted">Codes get traded. People text them, shout them, screenshot
      them. We pretend not to notice. We notice everything &mdash; every code&#39;s
      whole provenance is logged, and the ledger drops when the game ends.
      Creative cheating isn&#39;t punished, it&#39;s <em>scored</em>. Play dirty, play smart.</p>
    </div></div>
  </div>
</div>
<div id="qrbox"><div class="qrcard">
  <div class="qrimg">${qr}</div>
  <p>Point a phone camera here. They land on <strong>your</strong> page and get rolled.</p>
  <p class="muted">${escapeHtml(pageUrl)}</p>
  <button class="btn" id="qrclose" type="button">close</button>
</div></div>
<footer><p><a href="https://diligentservices.io/">a Diligent Services thing</a></p></footer>
</main>
<script>
(function () {
  var url = ${JSON.stringify(`${env.SITE_ORIGIN}/@${row.codename}`)};
  var btn = document.getElementById("share");
  var ok = document.getElementById("shared");
  if (!btn) return;
  btn.addEventListener("click", function () {
    var share = { title: "RACK & ROLL '26", text: "Someone thought you were interesting.", url: url };
    if (navigator.share) { navigator.share(share).catch(function () {}); return; }
    var flash = function () { ok.hidden = false; setTimeout(function () { ok.hidden = true; }, 2500); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(flash, flash);
    } else { flash(); }
  });
  var box = document.getElementById("qrbox");
  var qb = document.getElementById("qrbtn"), qc = document.getElementById("qrclose");
  if (box && qb) {
    qb.addEventListener("click", function () { box.classList.add("show"); });
    qc.addEventListener("click", function () { box.classList.remove("show"); });
    box.addEventListener("click", function (e) { if (e.target === box) box.classList.remove("show"); });
  }
  var codename = ${JSON.stringify(row.codename)};
  var ib = document.getElementById("invite");
  if (ib) {
    var iout = document.getElementById("invite-out");
    var ierr = document.getElementById("invite-err");
    var ilink = document.getElementById("invite-link");
    var iqr = document.getElementById("invite-qr");
    var ileft = document.getElementById("invite-left");
    var mint = function () {
      ierr.hidden = true; ib.disabled = true;
      var key = ""; try { key = localStorage.getItem("rr26_mint_" + codename) || ""; } catch (e) {}
      fetch("/api/invite", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ codename: codename, key: key }) })
        .then(function (r) { return r.json(); }).then(function (d) {
          ib.disabled = false;
          if (d.ok) {
            ilink.textContent = d.url; ilink.href = d.url;
            iqr.innerHTML = d.qr; iout.hidden = false;
            ileft.textContent = d.left > 0 ? (d.left + " official invites left") : "that was your last official one";
          } else {
            ierr.textContent = d.error || "no"; ierr.hidden = false;
            if (d.capped) ib.style.display = "none";
          }
        }).catch(function () { ib.disabled = false; ierr.textContent = "network said no. try again."; ierr.hidden = false; });
    };
    ib.addEventListener("click", mint);
    var imore = document.getElementById("invite-more");
    if (imore) imore.addEventListener("click", mint);
    var icopy = document.getElementById("invite-copy");
    if (icopy) icopy.addEventListener("click", function () {
      if (navigator.clipboard) navigator.clipboard.writeText(ilink.textContent).catch(function () {});
    });
  }
})();
</script>${preRoll(env, row.codename, first)}`;
}

function claimPage(env, token, row, players) {
  const inviter = escapeHtml(row.inviter);
  const codename = escapeHtml(row.codename);
  const options = (players || []).map((p) =>
    `<option value="${escapeHtml(p.display || p.codename)}">${escapeHtml(p.codename)}</option>`
  ).join("");
  return `<main>
${sandboxBanner(env)}<p class="masthead">RACK &amp; ROLL '26 &middot; an invitational</p>
<h1>You're in. Sort of.</h1>
<div class="box warm"><h2>The rules</h2><div class="pad"><ol>
<li>You do not talk about RACK &amp; ROLL.</li>
<li>You DO share your page.</li>
<li>Cheating is a form of playing.</li>
<li>Knowing about RACK &amp; ROLL means you are playing RACK &amp; ROLL. You just lost, by the way.</li>
<li>Nobody here is their khakis.</li>
</ol></div></div>
<div class="box"><h2>Your dossier</h2><div class="pad">
<p>${inviter} vouched for you. Your codename is <strong>${codename}</strong>.
It is not negotiable.</p>${row.minted_by
  ? `<p><strong>${escapeHtml(row.minted_by)}</strong> recruited you into their
     downline &mdash; their empire grows with yours. You can still name someone
     else below; the ledger remembers who minted the code either way.</p>` : ""}
<form id="claim">
  <p class="muted">Just a name gets you in. Everything else is optional.</p>
  <label>Name <input name="display" maxlength="40" required placeholder="what humans call you"
    autocapitalize="words" autocorrect="off" autocomplete="name" enterkeyhint="next"></label>
  <label>Bio <textarea name="bio" maxlength="${BIO_MAX}" placeholder="${BIO_MAX} chars. Links are for LinkedIn."></textarea></label>
  <label>Company <input name="company" maxlength="60" placeholder="optional"
    autocapitalize="words" autocomplete="organization"></label>
  <label>Email <input name="email" type="email" maxlength="120"
    autocapitalize="off" autocorrect="off" autocomplete="email" inputmode="email" spellcheck="false"
    placeholder="optional — so we can taunt you when you lose"></label>
  <label>Who roped you in? <input name="referrer" list="players" maxlength="60"
    autocapitalize="words" autocorrect="off" autocomplete="off"
    value="${row.minted_by ? escapeHtml(row.minted_by) : ""}"
    placeholder="start typing their name — you join their chain">
    <span class="muted">optional, but joining a chain beats going it alone (that's where the reach bonus lives)</span></label>
  <datalist id="players">${options}</datalist>
  <label class="photo-label">Photo <input name="photo" type="file" accept="image/*">
    <span class="muted">optional; you get a pixel avatar either way</span></label>
  <div class="cf-turnstile" data-sitekey="${escapeHtml(env.TURNSTILE_SITEKEY || "")}"></div>
  <button type="submit" class="btn">Claim the codename &rarr;</button>
  <p id="claim-err" class="busted" hidden></p>
</form>
</div></div>
<div class="box"><h2>The fine print (such as it is)</h2><div class="pad">
<p class="muted">This is a game. It runs on a lark and a $10 domain. We make no
promises about your data, its handling, or how long any of this lives &mdash;
put nothing here you'd mind seeing on a screen at a trade show. We encourage
silliness and ask only that you stay in the spirit of good fun. Be excellent to
each other.</p>
</div></div>
<footer><p>first successful claim wins &middot; scans are free forever &middot; The Game ends when we say it ends. It has not ended.</p></footer>
</main>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<script>
(function () {
  var form = document.getElementById("claim");
  var err = document.getElementById("claim-err");
  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var fd = new FormData(form);
    var file = fd.get("photo");
    var done = function (photoDataUrl) {
      fetch("/api/claim", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({
          token: ${JSON.stringify(token)},
          display: fd.get("display"), bio: fd.get("bio"),
          company: fd.get("company"), email: fd.get("email"),
          parent: fd.get("referrer"),
          photo: photoDataUrl || "",
          turnstile: (form.querySelector('[name="cf-turnstile-response"]') || {}).value || ""
        })
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.ok) {
          try { if (d.mintKey) localStorage.setItem("rr26_mint_" + d.codename, d.mintKey); } catch (e) {}
          location.href = d.page;
        }
        else { err.textContent = d.error || "no"; err.hidden = false; }
      }).catch(function () { err.textContent = "network said no. try again."; err.hidden = false; });
    };
    if (file && file.size) {
      // client-side resize to <=512px JPEG — UX only; the Worker re-checks.
      var img = new Image();
      img.onload = function () {
        var s = Math.min(1, 512 / Math.max(img.width, img.height));
        var c = document.createElement("canvas");
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        done(c.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = function () { done(""); };
      img.src = URL.createObjectURL(file);
    } else { done(""); }
  });
})();
</script>`;
}

// ---- plumbing ---------------------------------------------------------------

async function flag(env, name) {
  const row = await env.DB.prepare("SELECT value FROM flags WHERE name = ?")
    .bind(name).first();
  return row && row.value === "1";
}

const SRC_WINK = `<!--
  Oh — you view-source'd it. Or your agent did. Either way: hi.
  Yes, you can cheat. The rolls ARE the game and the beacon is right there:
    GET /roll.gif?who=<codename>
  We cap it per IP per day and pin a "definitely not curl" badge on the
  obvious ones, so the move isn't volume, it's *plausibility*. Pad yourself
  into looking popular and we'll never say a word.
  The ONE thing that isn't funny: burning the codes. Don't mass-claim
  invitations no human was handed — that ends the game for real people, and
  it's Turnstile-gated precisely to make doing it boring. Everything short of
  that, we salute. House rules: /cheat  (yes, it's a real endpoint.)
  -- the management
-->`;

function html(body, status = 200, extraHeaders = {}) {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
${SRC_WINK}
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>RACK &amp; ROLL '26</title>
<link rel="stylesheet" href="/rr26.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎛️</text></svg>">
</head><body>${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", ...SEC_HEADERS, ...extraHeaders } });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "content-type": "application/json", ...SEC_HEADERS },
  });
}

function jerr(status, error) { return json({ ok: false, error }, status); }

function cheat() {
  const body = [
    "RACK & ROLL '26 -- HOUSE RULES OF CHEATING",
    "",
    "You found this. Of course you did. Here's the deal.",
    "",
    "FAIR GAME (we salute it):",
    "  - Padding your own rolls. The beacon is GET /roll.gif?who=<your-codename>.",
    "    It's capped per IP per day and it badges the obvious bots",
    "    ('definitely not curl'). So the skill isn't a for-loop, it's staying",
    "    believable. Look popular, not omnipotent.",
    "  - Recruiting like your life depends on it.",
    "  - Wearing the 'definitely not curl' badge like a medal. It is one.",
    "",
    "THE ONE RULE (break it and you're just a vandal):",
    "  - Do NOT burn the codes. Mass-claiming invitations no human was handed",
    "    ends the game for real people. That's why claiming is Turnstile-gated:",
    "    not to stop you, to make it boring. If you can burn ONE code with style",
    "    and a good story, fine. Burning everyone's is the one move that isn't",
    "    funny.",
    "",
    "If you build a genuinely clever, bounded cheat: PR it.",
    "  github.com/samstevenm/rraas  (PRs judged harshly, and lovingly.)",
    "",
    "-- Diligent Services. We can't promise nothing goes down. We stay on.",
    "",
  ].join("\n");
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8",
               "x-the-game": "you-are-now-playing", ...SEC_HEADERS },
  });
}

function snarky404() {
  // no-store: a 404 must never get cached at the edge and then mask a code
  // that later becomes valid (e.g. a page reachable after a fix or a claim).
  return html(`<main><h1>There is no page here.</h1>
<p class="tease">If a card brought you here, check the code — first claim wins.
If you typed this URL hoping to find something: respect, but no.</p>
<footer><p>you do not talk about RACK &amp; ROLL</p></footer></main>`, 404,
    { "cache-control": "no-store" });
}
