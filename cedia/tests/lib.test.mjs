// node --test — pure-function coverage for the Worker's enforcement layer.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanBio, cleanDisplay, cleanEmail, escapeHtml, identicon, makeVcard,
  normToken, sniffJpeg, utcDay,
} from "../worker/lib.mjs";

test("normToken: word-pair, case/space/underscore insensitive", () => {
  assert.equal(normToken("photon-rack"), "photon-rack");
  assert.equal(normToken("PHOTON RACK"), "photon-rack");
  assert.equal(normToken("  Photon_Rack  "), "photon-rack");
  assert.equal(normToken("kelvin-keypad-two"), "kelvin-keypad-two");
  assert.equal(normToken("leaderboard"), null);  // single word -> not a code
  assert.equal(normToken("rr26.css"), null);     // asset, no hyphen
  assert.equal(normToken(""), null);
});

test("escapeHtml kills markup", () => {
  assert.equal(escapeHtml('<script>"x"&\'y\''),
    "&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;");
});

test("cleanBio strips urls and caps length", () => {
  const b = cleanBio("hi https://evil.example/x and www.spam.biz ok");
  assert.ok(!b.includes("evil.example") && !b.includes("spam.biz"));
  assert.ok(b.includes("links are for LinkedIn"));
  assert.ok(cleanBio("a".repeat(500)).length <= 280);
});

test("cleanDisplay: printable ascii only, 40 max", () => {
  assert.equal(cleanDisplay("  Robert   Paulson "), "Robert Paulson");
  assert.equal(cleanDisplay("x".repeat(60)).length, 40);
  assert.equal(cleanDisplay("<b>bold</b>"), "<b>bold</b>"); // allowed chars; escaped at render
  assert.equal(cleanDisplay("emoji \u{1F600}"), null);
  assert.equal(cleanDisplay(""), null);
});

test("cleanEmail: empty ok, junk rejected", () => {
  assert.equal(cleanEmail(""), "");
  assert.equal(cleanEmail("a@b.co"), "a@b.co");
  assert.equal(cleanEmail("not an email"), null);
});

test("sniffJpeg: magic bytes both ends, size cap", () => {
  const good = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  assert.equal(sniffJpeg(good), true);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0xff, 0xd9]);
  assert.equal(sniffJpeg(png), false);
  const truncated = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
  assert.equal(sniffJpeg(truncated), false);
  const huge = new Uint8Array(400 * 1024);
  huge[0] = 0xff; huge[1] = 0xd8; huge[2] = 0xff;
  huge[huge.length - 2] = 0xff; huge[huge.length - 1] = 0xd9;
  assert.equal(sniffJpeg(huge), false);
});

test("identicon: deterministic svg, no interpolation leaks", () => {
  const a = identicon("velvet-forklift");
  assert.equal(a, identicon("velvet-forklift"));
  assert.notEqual(a, identicon("polite-chaos"));
  assert.ok(a.startsWith("<svg") && a.endsWith("</svg>"));
});

test("vcard escapes separators, crlf", () => {
  const v = makeVcard({ display: "A; B, C", company: "X,Y", email: "a@b.co",
                        url: "https://x/@a" });
  assert.ok(v.includes("FN:A\\; B\\, C"));
  assert.ok(v.includes("ORG:X\\,Y"));
  assert.ok(v.endsWith("END:VCARD\r\n"));
});

test("utcDay shape", () => {
  assert.match(utcDay(0), /^1970-01-01$/);
});

test("normToken: rejects >4 parts, collapses double hyphen", () => {
  assert.equal(normToken("a-b-c-d-e"), null);
  assert.equal(normToken("photon--rack"), "photon-rack");
});

test("rollKey: deterministic, varies by input, prefixed", async () => {
  const { rollKey } = await import("../worker/lib.mjs");
  const a = await rollKey("1.2.3.4", "photon-rack", "2026-09-02");
  assert.equal(a, await rollKey("1.2.3.4", "photon-rack", "2026-09-02"));
  assert.notEqual(a, await rollKey("1.2.3.5", "photon-rack", "2026-09-02"));
  assert.notEqual(a, await rollKey("1.2.3.4", "spectral-truss", "2026-09-02"));
  assert.notEqual(a, await rollKey("1.2.3.4", "photon-rack", "2026-09-03"));
  assert.match(a, /^r1:[0-9a-f]{32}$/);
});
