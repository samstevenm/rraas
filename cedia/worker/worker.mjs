// RACK & ROLL '26 — the one Worker.
// Static assets (landing, rules, leaderboard shell, CSS) are served by the
// assets binding; this code owns the dynamic paths: invite/claim, player
// pages, beacons, leaderboard JSON, admin. Everything user-influenced is
// escaped at render and capped at write. D1 owns the single-claim invariant.

import {
  BIO_MAX, PHOTO_MAX_BYTES, cleanBio, cleanDisplay, cleanEmail, escapeHtml,
  identicon, makeVcard, normToken, rollKey, sniffJpeg, utcDay, CODENAME_RE,
} from "./lib.mjs";

const RICK = "dQw4w9WgXcQ";
const ROLL_CAP_PER_IP_DAY = 3;      // rolls one IP can score per codename/day
const BUSTED_TRIPWIRE = 50;         // raw hits/IP/day before the curl badge

const SEC_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p === "/leaderboard.json") return leaderboard(req, env);
      if (p === "/roll.gif") return roll(req, env, ctx);
      if (p === "/api/claim" && req.method === "POST") return claim(req, env);
      if (p === "/api/admin" && req.method === "POST") return admin(req, env);
      if (p.startsWith("/@")) return playerRoutes(req, env, p.slice(2));
      if (p.startsWith("/photo/")) return photo(env, p.slice(7));
      if (p.startsWith("/avatar/")) return avatar(p.slice(8));
      // /TOKEN or /i/TOKEN — multi-scan, single-claim: scanning is free forever
      const rawTok = p.startsWith("/i/") ? p.slice(3) : p.slice(1);
      const tok = normToken(rawTok);
      if (tok) return invite(env, tok);
      if (/^\/[0-9A-Za-z]{6,14}$/.test(p)) return snarky404();
      return env.ASSETS.fetch(req);
    } catch (e) {
      return new Response("the rack fell over. try again.", { status: 500 });
    }
  },
};

// ---- invite / claim ---------------------------------------------------------

async function invite(env, token) {
  const row = await env.DB.prepare(
    "SELECT codename, inviter, claimed_at FROM tokens WHERE token = ?"
  ).bind(token).first();
  if (!row) return snarky404();
  if (row.claimed_at) {
    return Response.redirect(`${env.SITE_ORIGIN}/@${row.codename}`, 302);
  }
  return html(claimPage(env, token, row));
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
       company = ?, email = ?, has_photo = ?
     WHERE token = ? AND claimed_at IS NULL`
  ).bind(display, bio, company, email || "", hasPhoto, token).run();
  if (!res.meta || res.meta.changes !== 1) {
    return jerr(409, "already claimed. first scan wins; that's rule zero");
  }
  const row = await env.DB.prepare(
    "SELECT codename FROM tokens WHERE token = ?").bind(token).first();
  if (hasPhoto) {
    await env.KV.put(`photo:${row.codename}`, photoBytes.buffer);
  }
  return json({ ok: true, page: `${env.SITE_ORIGIN}/@${row.codename}` });
}

// ---- player pages -----------------------------------------------------------

async function playerRoutes(req, env, rest) {
  const wantVcf = rest.endsWith(".vcf");
  const codename = wantVcf ? rest.slice(0, -4) : rest;
  if (!CODENAME_RE.test(codename)) return snarky404();
  const row = await env.DB.prepare(
    `SELECT codename, inviter, display, bio, company, email, has_photo, hidden,
            busted, claimed_at FROM tokens WHERE codename = ?`
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
  return html(playerPage(env, row, photosKilled));
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
    `SELECT t.codename, t.display, t.inviter, t.busted,
            COALESCE(SUM(r.count), 0) AS rolls
     FROM tokens t LEFT JOIN rolls r ON r.codename = t.codename
     WHERE t.claimed_at IS NOT NULL AND t.hidden = 0
     GROUP BY t.codename ORDER BY rolls DESC, t.codename`).all();
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
    })),
    recruiters: recruiters.results || [],
    unclaimed_invitations: unclaimed ? unclaimed.n : 0,
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
  const embed = `https://www.youtube-nocookie.com/embed/${RICK}` +
    "?autoplay=1&mute=1&start=0&end=10&controls=0&playsinline=1&rel=0&enablejsapi=1";
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

function playerPage(env, row, photosKilled) {
  const name = escapeHtml(row.display);
  const first = row.display.split(" ")[0];
  const img = (row.has_photo && !photosKilled)
    ? `<img src="/photo/${row.codename}.jpg" alt="${name}">`
    : `<img src="/avatar/${row.codename}.svg" alt="avatar">`;
  const vcf = row.email
    ? `<p><a class="btn" href="/@${row.codename}.vcf" download>&#128190; Save my card</a></p>`
    : "";
  const busted = row.busted
    ? `<p class="busted">&#9888; definitely not curl</p>` : "";
  return `<main>
<p class="masthead">RACK &amp; ROLL '26 &middot; an invitational</p>
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
    <p class="tease">Share this page. Every visitor you roll is a point.
    <a href="/leaderboard.html">The scoreboard</a>.</p>
  </div>
</div>
<footer><p><a href="https://diligentservices.io/">a Diligent Services thing</a></p></footer>
</main>${preRoll(env, row.codename, first)}`;
}

function claimPage(env, token, row) {
  const inviter = escapeHtml(row.inviter);
  const codename = escapeHtml(row.codename);
  return `<main>
<p class="masthead">RACK &amp; ROLL '26 &middot; an invitational</p>
<h1>You're in. Sort of.</h1>
<div class="box warm"><h2>The rules</h2><div class="pad"><ol>
<li>You do not talk about RACK &amp; ROLL.</li>
<li>You DO share your page.</li>
<li>Cheating is a form of playing.</li>
<li>The domain dies when the show does.</li>
<li>Nobody here is their khakis.</li>
</ol></div></div>
<div class="box"><h2>Your dossier</h2><div class="pad">
<p>${inviter} vouched for you. Your codename is <strong>${codename}</strong>.
It is not negotiable.</p>
<form id="claim">
  <label>Name <input name="display" maxlength="40" required placeholder="what humans call you"></label>
  <label>Bio <textarea name="bio" maxlength="${BIO_MAX}" placeholder="${BIO_MAX} chars. Links are for LinkedIn."></textarea></label>
  <label>Company <input name="company" maxlength="60" placeholder="optional"></label>
  <label>Email <input name="email" type="email" maxlength="120"
    placeholder="optional — so we can taunt you when you lose"></label>
  <label class="photo-label">Photo <input name="photo" type="file" accept="image/*">
    <span class="muted">optional; you get a pixel avatar either way</span></label>
  <div class="cf-turnstile" data-sitekey="${escapeHtml(env.TURNSTILE_SITEKEY || "")}"></div>
  <button type="submit" class="btn">Claim the codename &rarr;</button>
  <p id="claim-err" class="busted" hidden></p>
</form>
</div></div>
<footer><p>first successful claim wins &middot; scans are free forever</p></footer>
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
          photo: photoDataUrl || "",
          turnstile: (form.querySelector('[name="cf-turnstile-response"]') || {}).value || ""
        })
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.ok) { location.href = d.page; }
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

function html(body) {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>RACK &amp; ROLL '26</title>
<link rel="stylesheet" href="/rr26.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎛️</text></svg>">
</head><body>${body}</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", ...SEC_HEADERS } });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "content-type": "application/json", ...SEC_HEADERS },
  });
}

function jerr(status, error) { return json({ ok: false, error }, status); }

function snarky404() {
  return html(`<main><h1>There is no page here.</h1>
<p class="tease">If a card brought you here, check the code — first claim wins.
If you typed this URL hoping to find something: respect, but no.</p>
<footer><p>you do not talk about RACK &amp; ROLL</p></footer></main>`);
}
