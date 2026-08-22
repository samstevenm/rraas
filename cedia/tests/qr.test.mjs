// node --test — structural checks on the QR encoder. (End-to-end scannability
// is proven separately by decoding the output with OpenCV; see the commit that
// added qr.mjs. These guard against regressions without needing a decoder.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { qrMatrix, qrSvg } from "../worker/qr.mjs";

function finderOk(mods, ox, oy) {
  // 7x7 finder: dark ring, dark 3x3 center, light gap at ring distance 1.
  for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) {
    const edge = dx === 0 || dx === 6 || dy === 0 || dy === 6;
    const inner = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
    const want = edge || inner;
    if (mods[oy + dy][ox + dx] !== want) return false;
  }
  return true;
}

test("qrMatrix: sizes track version, square, deterministic", () => {
  const a = qrMatrix("https://rickroll.win/@corduroy-soffit");
  const b = qrMatrix("https://rickroll.win/@corduroy-soffit");
  assert.equal(a.size, 29);                 // v3
  assert.equal(a.mods.length, a.size);
  assert.equal(a.mods[0].length, a.size);
  assert.deepEqual(a.mods, b.mods);         // deterministic
  assert.equal(qrMatrix("https://rickroll.win/@a").size, 25);          // v2
  assert.equal(qrMatrix("https://rickroll.win/@" + "x".repeat(40)).size, 33); // v4
});

test("qrMatrix: three finder patterns in the right corners", () => {
  const { mods, size } = qrMatrix("https://rickroll.win/@color-corrected-tweeter");
  assert.ok(finderOk(mods, 0, 0), "top-left finder");
  assert.ok(finderOk(mods, size - 7, 0), "top-right finder");
  assert.ok(finderOk(mods, 0, size - 7), "bottom-left finder");
});

test("qrSvg: self-contained svg with a quiet zone", () => {
  const svg = qrSvg("https://rickroll.win/@corduroy-soffit");
  assert.ok(svg.startsWith("<svg") && svg.endsWith("</svg>"));
  assert.ok(svg.includes('viewBox="0 0 37 37"')); // 29 + 2*4 quiet
  assert.ok(!svg.includes("http://www.w3.org/1999/xlink")); // no external refs
});

test("qr: rejects data too long for v10", () => {
  assert.throws(() => qrMatrix("x".repeat(300)));
});
