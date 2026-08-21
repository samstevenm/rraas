#!/usr/bin/env python3
"""Build the at.diligentservices.io static site from the flat-file profile DB.

Port of atparty/scripts/build_atparty.py (the at.themyers.party builder) for
the Diligent Services CEDIA pages. Same architecture — TOML profiles, escape-
first markdown subset, fail-closed PII gate, static dist/ — with three
business-card changes:

  * an optional [contact] table per profile (phone/email/title/org) that is
    DELIBERATELY public and exempt from the phone rule (on a business card the
    phone number is the point); the blurb and every other field stay gated
  * a generated vCard (dist/<name>/<name>.vcf) per claimed profile
  * an old-school MySpace-flavored profile layout (photo left, bio right)

Pipeline (fail-closed on PII):
  1. load atds/profiles/*.toml
  2. gate every profile (contact table stripped first, validated separately);
     ANY finding aborts the whole build
  3. render each claimed/unclaimed profile to dist/<name>/index.html (+ .vcf)
  4. render dist/404.html, dist/50x.html; write dist/directory.json (data for
     the roll aggregator — NOT served; Sam nixed any public roster 2026-08-21,
     the bare at.<apex> host just 301s to the marketing site) + the certbot -d
     list (at.<apex> + claimed names ONLY — the marketing apex and www belong
     to the Quarto site's own cert)

No external dependencies (stdlib only). Submitted content is HTML-escaped
BEFORE the markdown subset is applied, so a profile can never inject markup.

Usage:
  build_atds.py [--profiles DIR] [--out DIR] [--apex-domain diligentservices.io]
"""
from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import sys
from pathlib import Path

try:
    import tomllib  # 3.11+
except ModuleNotFoundError:  # pragma: no cover
    import tomli as tomllib  # type: ignore

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pii_gate_ds as pii_gate  # noqa: E402

APEX_DEFAULT = "diligentservices.io"

# --- MySpace-flavored markup (shared by every page) ---------------------------

_CSS = """
:root { --bg:#d5dced; --panel:#ffffff; --ink:#000000; --muted:#5a5a5a;
        --box:#6699cc; --hdr-ink:#ffffff; --hdr2:#e8730c; --link:#0033cc;
        --rule:#c9d3e8; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#181c26; --panel:#232834; --ink:#e8e8e8; --muted:#a3a3a3;
          --box:#3d5f85; --hdr2:#b35a0a; --link:#7da7ff; --rule:#39415a; }
}
* { margin:0; padding:0; box-sizing:border-box; }
body { background:var(--bg); color:var(--ink);
       font-family:Verdana,Arial,Helvetica,sans-serif; font-size:14px;
       line-height:1.5; padding:1rem; }
a { color:var(--link); }
main { max-width:62rem; margin:0 auto; background:var(--panel);
       border:1px solid var(--box); padding:1rem; }
.masthead { font-size:0.75rem; letter-spacing:0.08em; color:var(--muted);
            border-bottom:1px solid var(--rule); padding-bottom:0.5rem;
            margin-bottom:1rem; }
.masthead a { color:var(--muted); }
h1 { font-size:1.5rem; margin-bottom:0.75rem; }
.cols { display:flex; gap:1rem; align-items:flex-start; flex-wrap:wrap; }
.col-l { flex:1 1 15rem; max-width:20rem; }
.col-r { flex:2 1 24rem; min-width:16rem; }
.box { border:2px solid var(--box); margin-bottom:1rem; }
.box > h2 { background:var(--box); color:var(--hdr-ink); font-size:0.9rem;
            font-weight:bold; padding:0.25rem 0.5rem; letter-spacing:0.02em; }
.box.warm { border-color:var(--hdr2); }
.box.warm > h2 { background:var(--hdr2); }
.box .pad { padding:0.6rem; }
.box .pad p { margin:0.5rem 0; }
.box .pad ul, .box .pad ol { margin:0.5rem 0 0.5rem 1.3rem; }
.box .pad h2 { background:none; color:var(--ink); font-size:1rem;
               border-bottom:1px solid var(--rule); margin:0.9rem 0 0.3rem;
               padding:0; }
.photo img, .photo svg { display:block; width:100%; height:auto; }
.tags { color:var(--muted); font-style:italic; font-size:0.85rem; }
.extnet { border:1px solid var(--box); padding:0.6rem; margin-bottom:1rem;
          font-size:1.05rem; text-align:center; }
.vcard-btn { display:inline-block; background:var(--box); color:var(--hdr-ink);
             padding:0.45rem 0.9rem; text-decoration:none; font-weight:bold;
             margin:0.25rem 0; }
.links li { padding:0.15rem 0; }
.dir { list-style:none; }
.dir li { padding:0.55rem 0.2rem; border-bottom:1px solid var(--rule); }
.dir .who { font-size:1.1rem; }
.dir .note { color:var(--muted); font-size:0.85rem; font-style:italic; }
.claim { color:var(--muted); font-style:italic; }
footer { margin-top:1.25rem; border-top:1px solid var(--rule);
         padding-top:0.6rem; text-align:center; color:var(--muted);
         font-size:0.78rem; }
footer a { color:var(--muted); }
.rr-tease { margin-top:0.75rem; font-style:italic; }
#preroll { display:none; position:fixed; inset:0; z-index:99;
           background:rgba(10,10,14,0.94); align-items:center;
           justify-content:center; flex-direction:column; padding:1rem;
           text-align:center; }
#preroll.show { display:flex; }
#preroll h2 { color:#fff; font-size:1.2rem; margin-bottom:0.75rem; }
#preroll-video { width:min(92vw, 40rem); aspect-ratio:16/9; background:#000; }
#preroll-video iframe { width:100%; height:100%; border:0; }
#preroll button { font:inherit; font-weight:bold; margin:0.9rem 0.4rem 0;
                  padding:0.5rem 1.1rem; cursor:pointer; border:2px solid #fff;
                  background:transparent; color:#fff; }
#preroll button:hover { background:#fff; color:#000; }
.lb { width:100%; border-collapse:collapse; margin-top:0.5rem; }
.lb td, .lb th { border:1px solid var(--rule); padding:0.45rem 0.7rem;
                 text-align:left; }
.lb th { background:var(--box); color:var(--hdr-ink); }
.lb .n { text-align:right; font-variant-numeric:tabular-nums; }
.rr-embed { width:100%; aspect-ratio:16/9; background:#000; }
.rr-embed iframe { width:100%; height:100%; border:0; }
@media (max-width:40rem) { .cols { display:block; } .col-l { max-width:none; } }
""".strip()

_FAVICON = ("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' "
            "viewBox='0 0 100 100'><text y='.9em' font-size='90'>📇</text></svg>")

# Placeholder headshot for profiles that have no photo file yet.
_PLACEHOLDER_SVG = (
    '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" '
    'role="img" aria-label="photo coming soon">'
    '<rect width="200" height="200" fill="#9db4d4"/>'
    '<circle cx="100" cy="78" r="38" fill="#e8eef7"/>'
    '<path d="M30 200a70 70 0 0 1 140 0z" fill="#e8eef7"/>'
    '<text x="100" y="192" text-anchor="middle" font-size="13" '
    'fill="#3a4a63" font-family="Verdana,sans-serif">photo coming soon</text>'
    '</svg>'
)


def _page(title: str, description: str, body: str, apex: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(description)}">
<link rel="icon" href="{_FAVICON}">
<style>{_CSS}</style>
</head>
<body>
<main>
<p class="masthead">the people of <a href="https://{html.escape(apex)}/">Diligent Services</a></p>
{body}
</main>
</body>
</html>
"""


# --- tiny, safe markdown subset ----------------------------------------------
# Escape FIRST, then introduce only the tags we choose. Links are restricted to
# http/https/mailto schemes. This is intentionally minimal.

_SAFE_SCHEME = re.compile(r"^(https?:|mailto:)", re.I)
_LINK = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
_BOLD = re.compile(r"\*\*([^*]+)\*\*")
# word-bounded so snake_case identifiers in prose don't italicize
_ITALIC = re.compile(r"(?<![\w_])_([^_\n]+)_(?![\w_])")
_OL_ITEM = re.compile(r"^\d+\.\s+")


def _inline(text: str) -> str:
    """Escape then apply inline markdown (links, bold) on already-escaped text."""
    esc = html.escape(text)

    def link_sub(m: re.Match) -> str:
        label, url = m.group(1), m.group(2).strip()
        raw = url.replace("&amp;", "&")
        if not _SAFE_SCHEME.match(raw):
            return label  # drop unsafe-scheme links, keep the label text
        return f'<a href="{url}">{label}</a>'

    esc = _LINK.sub(link_sub, esc)
    esc = _BOLD.sub(r"<strong>\1</strong>", esc)
    esc = _ITALIC.sub(r"<em>\1</em>", esc)
    return esc


def md_to_html(text: str) -> str:
    """Render the blurb subset: ## headings, - bullets, 1. ordered lists,
    blank-line paragraphs, inline links + bold + _italic_. Escaped first."""
    lines = text.strip().splitlines()
    out: list[str] = []
    para: list[str] = []
    bullets: list[str] = []
    numbered: list[str] = []

    def flush_para():
        if para:
            out.append(f"<p>{' '.join(_inline(l) for l in para)}</p>")
            para.clear()

    def flush_bullets():
        if bullets:
            items = "".join(f"<li>{_inline(b)}</li>" for b in bullets)
            out.append(f"<ul>{items}</ul>")
            bullets.clear()

    def flush_numbered():
        if numbered:
            items = "".join(f"<li>{_inline(b)}</li>" for b in numbered)
            out.append(f"<ol>{items}</ol>")
            numbered.clear()

    for line in lines:
        s = line.strip()
        if not s:
            flush_para(); flush_bullets(); flush_numbered()
        elif s.startswith("## "):
            flush_para(); flush_bullets(); flush_numbered()
            out.append(f"<h2>{_inline(s[3:].strip())}</h2>")
        elif s.startswith("- "):
            flush_para(); flush_numbered()
            bullets.append(s[2:].strip())
        elif _OL_ITEM.match(s):
            flush_para(); flush_bullets()
            numbered.append(_OL_ITEM.sub("", s, count=1))
        else:
            flush_bullets(); flush_numbered()
            para.append(s)
    flush_para(); flush_bullets(); flush_numbered()
    return "\n".join(out)


# --- [contact] validation -----------------------------------------------------
# Contact fields are DELIBERATELY public business-card data, so they bypass the
# phone rule — but they must still LOOK like contact data. Shape failures abort
# the build exactly like PII findings (fail closed).

_EMAIL_OK = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
_PHONE_OK = re.compile(r"^[0-9+() .\-]{7,20}$")
_CONTACT_KEYS = {"phone", "email", "title", "org"}


def check_contact(contact: dict, name: str) -> list[str]:
    errors: list[str] = []
    for key in contact:
        if key not in _CONTACT_KEYS:
            errors.append(f"{name}: [contact] unknown key {key!r} "
                          f"(allowed: {sorted(_CONTACT_KEYS)})")
    email = str(contact.get("email", ""))
    if email and not _EMAIL_OK.match(email):
        errors.append(f"{name}: [contact] email doesn't look like an email: {email!r}")
    phone = str(contact.get("phone", ""))
    if phone and not _PHONE_OK.match(phone):
        errors.append(f"{name}: [contact] phone doesn't look like a phone: {phone!r}")
    return errors


# --- vCard --------------------------------------------------------------------

def _vcf_escape(value: str) -> str:
    return (value.replace("\\", "\\\\").replace(";", "\\;")
                 .replace(",", "\\,").replace("\n", "\\n"))


def make_vcard(profile: dict, subname: str, apex: str) -> str:
    """vCard 3.0 for a claimed profile with a [contact] table. CRLF per RFC."""
    contact = profile.get("contact", {}) or {}
    name = profile.get("name") or subname.title()
    parts = name.split()
    first, last = parts[0], (parts[-1] if len(parts) > 1 else "")
    lines = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        f"N:{_vcf_escape(last)};{_vcf_escape(first)};;;",
        f"FN:{_vcf_escape(name)}",
        f"ORG:{_vcf_escape(str(contact.get('org', 'Diligent Services')))}",
    ]
    if contact.get("title"):
        lines.append(f"TITLE:{_vcf_escape(str(contact['title']))}")
    if contact.get("phone"):
        lines.append(f"TEL;TYPE=WORK,VOICE:{_vcf_escape(str(contact['phone']))}")
    if contact.get("email"):
        lines.append(f"EMAIL;TYPE=INTERNET,WORK:{_vcf_escape(str(contact['email']))}")
    lines.append(f"URL:https://{subname}.at.{apex}/")
    if profile.get("updated"):
        lines.append(f"REV:{_vcf_escape(str(profile['updated']))}")
    lines.append("END:VCARD")
    return "\r\n".join(lines) + "\r\n"


# --- rendering ---------------------------------------------------------------

def _photo_html(profile: dict, photos_dir: Path, dest_dir: Path) -> str:
    """Copy the profile photo into the page dir if present; else placeholder."""
    fname = str(profile.get("photo", "")).strip()
    if fname:
        src = photos_dir / fname
        if src.is_file():
            dest_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest_dir / fname)
            return (f'<img src="{html.escape(fname)}" '
                    f'alt="{html.escape(profile.get("name", ""))}">')
    return _PLACEHOLDER_SVG


def render_profile(profile: dict, subname: str, apex: str,
                   photos_dir: Path, dest_dir: Path) -> str:
    name = profile.get("name") or subname.title()
    first = name.split()[0]
    status = profile.get("status", "claimed")
    host = f"{subname}.at.{apex}"

    if status == "unclaimed":
        body = (
            f'<h1>{html.escape(name)}</h1>\n'
            f'<p class="claim">This page is unclaimed. If this is you and you\'d '
            f'like a page here, email '
            f'<a href="mailto:sam@{apex}">sam@{apex}</a>.</p>\n'
            f'<footer><p>{html.escape(host)}</p></footer>'
        )
        return _page(f"{name} — {host}", f"{name} at {host} (unclaimed).", body, apex)

    contact = profile.get("contact", {}) or {}

    # left column: photo, contact, links
    left = ['<div class="box"><h2>' + html.escape(name) + '</h2>'
            '<div class="pad photo">' + _photo_html(profile, photos_dir, dest_dir)
            + '</div></div>']
    contact_bits = []
    if contact:
        contact_bits.append(
            f'<p><a class="vcard-btn" href="{html.escape(subname)}.vcf" '
            f'download>&#128190; Save my card</a></p>')
        if contact.get("title"):
            contact_bits.append(
                f'<p>{html.escape(str(contact["title"]))}, '
                f'{html.escape(str(contact.get("org", "Diligent Services")))}</p>')
        if contact.get("phone"):
            contact_bits.append(f'<p>{html.escape(str(contact["phone"]))}</p>')
        if contact.get("email"):
            em = html.escape(str(contact["email"]))
            contact_bits.append(f'<p><a href="mailto:{em}">{em}</a></p>')
    links = profile.get("links", []) or []
    link_items = []
    for link in links:
        if not isinstance(link, dict):
            continue
        label = html.escape(str(link.get("label", "")))
        url = str(link.get("url", "")).strip()
        if _SAFE_SCHEME.match(url):
            link_items.append(f'<li><a href="{html.escape(url)}">{label}</a></li>')
    if link_items:
        contact_bits.append('<ul class="links">' + "".join(link_items) + '</ul>')
    if contact_bits:
        left.append('<div class="box"><h2>Contacting ' + html.escape(first)
                    + '</h2><div class="pad">' + "\n".join(contact_bits)
                    + '</div></div>')
    details = []
    tags = [t for t in profile.get("tags", []) if isinstance(t, str)]
    if tags:
        details.append(f'<p class="tags">{html.escape(" · ".join(tags))}</p>')
    if str(profile.get("location", "")).strip():
        details.append(f'<p>{html.escape(str(profile["location"]))}</p>')
    if details:
        left.append('<div class="box"><h2>Details</h2><div class="pad">'
                    + "\n".join(details) + '</div></div>')

    # right column: the extended-network wink + bio
    right = [f'<div class="extnet"><strong>{html.escape(first)}</strong> '
             f'is in your extended network</div>']
    blurb = profile.get("blurb", "")
    if blurb.strip():
        right.append('<div class="box warm"><h2>About ' + html.escape(first)
                     + '</h2><div class="pad">' + md_to_html(blurb)
                     + '</div></div>')

    body = (
        f'<h1>{html.escape(name)}</h1>\n'
        f'<div class="cols">\n<div class="col-l">\n' + "\n".join(left) +
        f'\n</div>\n<div class="col-r">\n' + "\n".join(right) + '\n</div>\n</div>\n'
        f'<p class="rr-tease">If you actually wanted Rick Astley and not '
        f'{html.escape(first)}, <a href="https://rickroll.at.{apex}/">this way '
        f'to the real thing (and the leaderboard)</a>.</p>\n'
        f'<footer><p>{html.escape(host)} &middot; '
        f'<a href="https://{apex}/">Diligent Services</a> &middot; '
        f'<a href="https://{apex}/g611/">(G611)</a></p></footer>'
        + _preroll_html(subname, first)
    )
    return _page(f"{name} — {host}", f"{name} of Diligent Services at {host}.",
                 body, apex)


# --- phase 2: the rickroll lane -----------------------------------------------
# First visit per browser, a claimed profile page opens with ~10s of the
# canonical video (muted — every modern browser blocks unmuted autoplay
# without a prior user gesture, so a QR-scan arrival can't start with sound;
# the 🔊 button restarts it audibly on click). Dismissable; a 1-year cookie
# makes it once per browser per page; incognito cheats and that's accepted.
# The beacon GET /roll.gif?who=<sub> is served by nginx empty_gif into a
# dedicated access log, and a 1-minute timer on the box aggregates it into
# rickroll/leaderboard.json — no runtime backend, the static-site doctrine
# holds.

_RICK_ID = "dQw4w9WgXcQ"  # the canonical video


def _preroll_html(subname: str, first: str) -> str:
    embed = (f"https://www.youtube-nocookie.com/embed/{_RICK_ID}"
             "?autoplay=1&mute=1&start=0&end=10&controls=0&playsinline=1"
             "&rel=0&enablejsapi=1")
    return f"""
<div id="preroll" hidden>
  <h2>Before you meet {html.escape(first)}&hellip;</h2>
  <div id="preroll-video"></div>
  <div>
    <button id="preroll-sound" type="button">&#128266; It deserves sound</button>
    <button id="preroll-skip" type="button">Skip to {html.escape(first)} &rarr;</button>
  </div>
</div>
<script>
(function () {{
  function rolled() {{
    try {{ if (localStorage.getItem("atds_rolled")) return true; }} catch (e) {{}}
    return document.cookie.indexOf("atds_rolled=1") !== -1;
  }}
  function markRolled() {{
    try {{ localStorage.setItem("atds_rolled", "1"); }} catch (e) {{}}
    document.cookie = "atds_rolled=1; max-age=31536000; path=/; SameSite=Lax";
  }}
  if (rolled()) return;
  var el = document.getElementById("preroll");
  var slot = document.getElementById("preroll-video");
  el.hidden = false;
  el.classList.add("show");
  document.body.style.overflow = "hidden";
  var f = document.createElement("iframe");
  f.src = "{embed}";
  f.allow = "autoplay; encrypted-media";
  slot.appendChild(f);
  new Image().src = "/roll.gif?who={subname}&r=" + Math.random();
  markRolled();
  function dismiss() {{
    clearTimeout(t);
    el.remove();
    document.body.style.overflow = "";
  }}
  var t = setTimeout(dismiss, 13000);
  document.getElementById("preroll-skip").addEventListener("click", dismiss);
  document.addEventListener("keydown", function (e) {{
    if (e.key === "Escape") dismiss();
  }});
  // Unmute via the player API on the EXISTING player. Swapping the iframe src
  // was the old approach and it silently failed: the reloaded document has no
  // user activation, so unmuted autoplay is blocked and playback never
  // started. postMessage commands are honored after the parent-page gesture.
  document.getElementById("preroll-sound").addEventListener("click", function () {{
    clearTimeout(t);
    function cmd(func, args) {{
      f.contentWindow.postMessage(JSON.stringify(
        {{event: "command", func: func, args: args || []}}), "*");
    }}
    cmd("unMute");
    cmd("seekTo", [0, true]);
    cmd("playVideo");
    t = setTimeout(dismiss, 13000);
    this.remove();
  }});
}})();
</script>"""


def render_rickroll_page(profiles: list[tuple[str, dict]], apex: str) -> str:
    """rickroll.at.<apex> — the canonical video + the roll leaderboard.
    Served by the wildcard catch-all; deliberately NOT in the directory, the
    apex listing, or the SAN cert."""
    names = {sub: (p.get("name") or sub.title()).split()[0]
             for sub, p in profiles if p.get("status") == "claimed"}
    body = (
        '<h1>You wanted Rick. You get Rick.</h1>\n'
        '<div class="box warm"><h2>The canonical video</h2><div class="pad">\n'
        f'<div class="rr-embed"><iframe '
        f'src="https://www.youtube-nocookie.com/embed/{_RICK_ID}?rel=0" '
        'title="Rick Astley — Never Gonna Give You Up" '
        'allow="encrypted-media; fullscreen"></iframe></div>\n'
        '<p>No tricks this time. Press play.</p>\n'
        '</div></div>\n'
        '<div class="box"><h2>The leaderboard</h2><div class="pad">\n'
        '<p>Every point below is one human who scanned a badge or typed a URL '
        'and got Rick Astley first. Most rolls, most conversations.</p>\n'
        '<table class="lb"><thead><tr><th>Who</th><th class="n">Rolls</th>'
        '</tr></thead><tbody id="lb-body">'
        '<tr><td colspan="2">Counting&hellip;</td></tr></tbody></table>\n'
        '<p class="claim" id="lb-updated"></p>\n'
        '</div></div>\n'
        '<script>\n'
        f'var LB_NAMES = {json.dumps(names)};\n'
        'fetch("leaderboard.json", {cache: "no-store"})\n'
        '  .then(function (r) { return r.json(); })\n'
        '  .then(function (d) {\n'
        '    var rows = Object.keys(LB_NAMES).map(function (k) {\n'
        '      return [LB_NAMES[k], (d.rolls && d.rolls[k]) || 0];\n'
        '    }).sort(function (a, b) { return b[1] - a[1]; });\n'
        '    document.getElementById("lb-body").innerHTML = rows.map(\n'
        '      function (r) { return "<tr><td>" + r[0] + "</td>' +
        '<td class=\\"n\\">" + r[1] + "</td></tr>"; }).join("");\n'
        '    if (d.updated) document.getElementById("lb-updated").textContent =\n'
        '      "Counted as of " + d.updated + " (updates every minute).";\n'
        '  })\n'
        '  .catch(function () {\n'
        '    document.getElementById("lb-body").innerHTML =\n'
        '      "<tr><td colspan=2>No rolls counted yet.</td></tr>";\n'
        '  });\n'
        '</script>\n'
        f'<footer><p><a href="https://{apex}/">Diligent Services</a>, the people '
        'behind the rolls</p></footer>'
    )
    return _page(f"rickroll.at.{apex} — you know the rules",
                 "The canonical video, plus the leaderboard.", body, apex)


# --- QR pages ----------------------------------------------------------------
# Each claimed page gets a build-time /qr companion (dist/<name>/qr/index.html)
# encoding the page's own base URL — the thing that goes on a CEDIA badge or
# card. segno is the one non-stdlib build dependency (pure-Python; chosen over
# the qrencode wrapper, which needs the libqrencode C library on every box that
# builds). Missing encoder fails the build unless --skip-qr is passed, so a
# deploy can't silently ship without the QR pages the cards point at.

def render_qr_page(target_url: str, host: str, apex: str) -> str:
    import segno  # lazy: only needed when QR pages are built
    svg = segno.make(target_url, error="m").svg_inline(scale=6, border=2)
    body = (
        f'<h1>{html.escape(host)}</h1>\n'
        '<div class="box"><h2>Scan me</h2><div class="pad" '
        'style="text-align:center">\n'
        f'<div style="background:#fff; padding:0.75rem; display:inline-block; '
        f'max-width:20rem">{svg}</div>\n'
        f'<p><a href="{html.escape(target_url)}">{html.escape(target_url)}</a></p>\n'
        '</div></div>\n'
        f'<footer><p><a href="https://{apex}/">Diligent Services</a></p></footer>'
    )
    return _page(f"QR — {host}", f"QR code for {target_url}", body, apex)


def render_404(apex: str) -> str:
    body = (
        '<h1>No page at this name</h1>\n'
        '<div class="box"><h2>Hmm</h2><div class="pad">'
        + md_to_html(
            f"There's no page at this name. Head back to "
            f"[{apex}](https://{apex}/).")
        + '</div></div>\n'
        f'<footer><p><a href="https://{apex}/">Diligent Services</a></p></footer>'
    )
    return _page(f"Not found — at.{apex}", "No page at this name.", body, apex)


def render_50x(apex: str) -> str:
    body = (
        "<h1>Something's off on our end</h1>\n"
        '<p class="claim">Give it a minute and try again, or just head to '
        f'<a href="https://{apex}/">{html.escape(apex)}</a>.</p>\n'
        f'<footer><p><a href="https://{apex}/">Diligent Services</a></p></footer>'
    )
    return _page(f"Error — at.{apex}", "Temporary error.", body, apex)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    here = Path(__file__).resolve().parents[1]
    ap.add_argument("--profiles", default=str(here / "profiles"))
    ap.add_argument("--out", default=str(here / "dist"))
    ap.add_argument("--apex-domain", default=APEX_DEFAULT)
    ap.add_argument("--skip-qr", action="store_true",
                    help="build without the /qr pages (no segno needed)")
    args = ap.parse_args(argv)

    if not args.skip_qr:
        try:
            import segno  # noqa: F401
        except ModuleNotFoundError:
            print("BUILD ABORTED — segno not installed (uv sync), or pass "
                  "--skip-qr to build without the /qr pages.", file=sys.stderr)
            return 2

    profiles_dir = Path(args.profiles)
    photos_dir = here / "photos"
    out = Path(args.out)
    apex = args.apex_domain
    files = sorted(profiles_dir.glob("*.toml"))
    if not files:
        print(f"no profiles in {profiles_dir}", file=sys.stderr)
        return 2

    loaded: list[tuple[str, dict]] = []
    all_findings: list[str] = []
    for f in files:
        with open(f, "rb") as fh:
            profile = tomllib.load(fh)
        # [contact] is deliberately-public business-card data: validate its
        # shape, but exempt it from the PII gate (which would flag the phone).
        # EVERYTHING else still goes through the gate — a phone number in a
        # blurb still kills the build.
        contact = profile.get("contact", {}) or {}
        all_findings.extend(check_contact(contact, f.stem))
        gated = {k: v for k, v in profile.items() if k != "contact"}
        findings = pii_gate.check_profile(gated, name=f.stem)
        all_findings.extend(f"{f.stem}: {fnd}" for fnd in findings)
        loaded.append((f.stem, profile))

    # FAIL CLOSED: if any profile is dirty, publish nothing.
    if all_findings:
        print("BUILD ABORTED — PII/contact gate blocked the following:",
              file=sys.stderr)
        for finding in all_findings:
            print(f"  {finding}", file=sys.stderr)
        return 1

    out.mkdir(parents=True, exist_ok=True)
    # at.<apex> + claimed names ONLY: the marketing apex + www already ride the
    # Quarto site's own cert and must not migrate to this one.
    cert_hosts = [f"at.{apex}"]
    directory = []
    rendered = 0
    for subname, profile in loaded:
        if profile.get("status") == "hidden":
            continue
        pdir = out / subname
        pdir.mkdir(parents=True, exist_ok=True)
        page = render_profile(profile, subname, apex, photos_dir, pdir)
        (pdir / "index.html").write_text(page, encoding="utf-8")
        if profile.get("status", "claimed") == "claimed":
            cert_hosts.append(f"{subname}.at.{apex}")
            if profile.get("contact"):
                (pdir / f"{subname}.vcf").write_text(
                    make_vcard(profile, subname, apex), encoding="utf-8",
                    newline="")
            if not args.skip_qr:
                host = f"{subname}.at.{apex}"
                qdir = pdir / "qr"
                qdir.mkdir(parents=True, exist_ok=True)
                (qdir / "index.html").write_text(
                    render_qr_page(f"https://{host}/", host, apex),
                    encoding="utf-8")
        directory.append({
            "subname": subname,
            "name": profile.get("name") or subname.title(),
            "status": profile.get("status", "claimed"),
            "host": f"{subname}.at.{apex}",
        })
        rendered += 1

    # phase 2: rickroll.at.<apex> rides the wildcard lane — never in the
    # directory, the apex listing, or the SAN cert. leaderboard.json lands
    # beside it on the box, written by the roll aggregator.
    rdir = out / "rickroll"
    rdir.mkdir(parents=True, exist_ok=True)
    (rdir / "index.html").write_text(render_rickroll_page(loaded, apex),
                                     encoding="utf-8")
    (out / "404.html").write_text(render_404(apex), encoding="utf-8")
    (out / "50x.html").write_text(render_50x(apex), encoding="utf-8")
    (out / "directory.json").write_text(json.dumps(directory, indent=2),
                                        encoding="utf-8")
    (out / "certbot-domains.txt").write_text(
        " ".join(f"-d {h}" for h in cert_hosts) + "\n", encoding="utf-8")

    claimed = sum(1 for _, p in loaded if p.get("status") == "claimed")
    unclaimed = sum(1 for _, p in loaded if p.get("status") == "unclaimed")
    vcards = sum(1 for _, p in loaded
                 if p.get("status") == "claimed" and p.get("contact"))
    print(f"built {rendered} page(s): {claimed} claimed, {unclaimed} unclaimed, "
          f"{vcards} vCard(s) → {out}")
    print(f"certbot domains: {len(cert_hosts)} (see {out / 'certbot-domains.txt'})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
