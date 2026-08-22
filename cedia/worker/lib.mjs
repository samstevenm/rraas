// RACK & ROLL '26 — pure functions, unit-tested with `node --test`.
// Server-side is the only side that counts: every cap and escape here is
// enforced in the Worker regardless of what the client claims to have done.

export const TOKEN_RE = /^[0-9A-HJKMNP-TV-Z]{10}$/; // Crockford base32, no I L O U
export const CODENAME_RE = /^[a-z0-9]+(-[a-z0-9]+){1,3}$/;
export const DISPLAY_RE = /^[\x20-\x7E]{1,40}$/;    // printable ASCII, <=40
export const BIO_MAX = 280;
export const PHOTO_MAX_BYTES = 300 * 1024;

export function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

// Crockford-friendly normalization: uppercase, map the confusables the
// alphabet excludes (labels are printed all-uppercase; humans type anything).
export function normToken(raw) {
  const t = String(raw || "").trim().toUpperCase()
    .replaceAll("O", "0").replaceAll("I", "1").replaceAll("L", "1")
    .replace(/[^0-9A-Z]/g, "");
  return TOKEN_RE.test(t) ? t : null;
}

// Plain text only. URLs are stripped, not linked — links are for LinkedIn.
export function cleanBio(raw) {
  let s = String(raw || "").replace(/\s+/g, " ").trim();
  s = s.replace(/\bhttps?:\/\/\S+/gi, "[link removed — links are for LinkedIn]");
  s = s.replace(/\bwww\.\S+/gi, "[link removed — links are for LinkedIn]");
  return s.slice(0, BIO_MAX);
}

export function cleanDisplay(raw) {
  const s = String(raw || "").replace(/\s+/g, " ").trim().slice(0, 40);
  return DISPLAY_RE.test(s) ? s : null;
}

export function cleanEmail(raw) {
  const s = String(raw || "").trim().slice(0, 120);
  if (!s) return "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s : null; // null = invalid
}

// JPEG-only, magic-byte sniff. Client-side canvas re-encode is UX; this is
// the control.
export function sniffJpeg(bytes) {
  if (!(bytes instanceof Uint8Array)) return false;
  if (bytes.length < 4 || bytes.length > PHOTO_MAX_BYTES) return false;
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff &&
         bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
}

// Deterministic identicon: codename -> gamey 5x5 mirrored pixel sprite SVG.
// Fully server-side, zero uploads, everyone gets one — nobody is their face.
export function identicon(codename) {
  let h = 2166136261;
  for (const c of String(codename)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const hues = [14, 32, 200, 260, 330, 160];
  const hue = hues[h % hues.length];
  let cells = "";
  let bits = h;
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      bits = Math.imul(bits ^ (y * 3 + x + 7), 2654435761) >>> 0;
      if (bits & 1) {
        for (const xx of new Set([x, 4 - x])) {
          cells += `<rect x="${xx * 20 + 10}" y="${y * 20 + 10}" width="20" height="20"/>`;
        }
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img" aria-label="avatar">` +
    `<rect width="120" height="120" fill="hsl(${hue} 35% 90%)"/>` +
    `<g fill="hsl(${hue} 60% 35%)">${cells}</g></svg>`;
}

export function makeVcard({ display, company, email, url }) {
  const esc = (v) => String(v).replaceAll("\\", "\\\\").replaceAll(";", "\\;")
    .replaceAll(",", "\\,").replaceAll("\n", "\\n");
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${esc(display)}`];
  if (company) lines.push(`ORG:${esc(company)}`);
  if (email) lines.push(`EMAIL;TYPE=INTERNET:${esc(email)}`);
  lines.push(`URL:${esc(url)}`, "END:VCARD");
  return lines.join("\r\n") + "\r\n";
}

export function utcDay(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

// SHA-256 of ip+codename+day -> dedup key (Workers crypto).
export async function rollKey(ip, codename, day) {
  const data = new TextEncoder().encode(`${ip}|${codename}|${day}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return "r1:" + [...new Uint8Array(digest)].slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}
