// Minimal QR encoder — byte mode, ECC level M, versions 1..10 (auto-picked).
// Enough for a short URL and nothing more. Faithful, trimmed port of the
// public-domain Nayuki QR algorithm; the RS core, module placement, masking
// and penalty rules follow it exactly so scanners read the output reliably.
// Verified end-to-end (encode here -> decode with OpenCV) in tests/qr.test.mjs.

const ECC_PER_BLOCK_M = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26]; // v1..10
const NUM_BLOCKS_M = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];             // v1..10
const FORMAT_BITS_M = 0; // level M's ECC indicator in the format string

// ---- GF(256), primitive polynomial 0x11d --------------------------------
const EXP = new Array(255), LOG = new Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
})();
function gmul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[(LOG[a] + LOG[b]) % 255]; }

function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gmul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gmul(root, 2);
  }
  return result;
}
function rsRemainder(data, divisor) {
  const result = new Array(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    for (let i = 0; i < divisor.length; i++) result[i] ^= gmul(divisor[i], factor);
  }
  return result;
}

// ---- capacity math (Nayuki formulas) ------------------------------------
function numRawDataModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const na = Math.floor(ver / 7) + 2;
    r -= (25 * na - 10) * na - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}
function numDataCodewords(ver) {
  const raw = Math.floor(numRawDataModules(ver) / 8);
  return raw - ECC_PER_BLOCK_M[ver - 1] * NUM_BLOCKS_M[ver - 1];
}
function countBits(ver) { return ver <= 9 ? 8 : 16; } // byte-mode char count

function chooseVersion(byteLen) {
  for (let v = 1; v <= 10; v++) {
    const need = 4 + countBits(v) + byteLen * 8;
    if (need <= numDataCodewords(v) * 8) return v;
  }
  throw new Error("qr: data too long");
}

// ---- data codewords -----------------------------------------------------
function encodeData(text, ver) {
  const bytes = new TextEncoder().encode(text);
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4);                 // byte mode
  push(bytes.length, countBits(ver));
  for (const b of bytes) push(b, 8);
  const capBits = numDataCodewords(ver) * 8;
  for (let i = 0; i < 4 && bits.length < capBits; i++) bits.push(0); // terminator
  while (bits.length % 8 !== 0) bits.push(0);
  const cw = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    cw.push(b);
  }
  const pads = [0xEC, 0x11]; let pi = 0;
  while (cw.length < numDataCodewords(ver)) { cw.push(pads[pi]); pi ^= 1; }
  return cw;
}

function interleave(text, ver) {
  const data = encodeData(text, ver);
  const numBlocks = NUM_BLOCKS_M[ver - 1];
  const eccLen = ECC_PER_BLOCK_M[ver - 1];
  const rawCw = Math.floor(numRawDataModules(ver) / 8);
  const numShort = numBlocks - (rawCw % numBlocks);
  const shortLen = Math.floor(rawCw / numBlocks);
  const divisor = rsDivisor(eccLen);
  const blocks = [];
  let k = 0;
  for (let i = 0; i < numBlocks; i++) {
    const dataLen = shortLen - eccLen + (i < numShort ? 0 : 1);
    const dat = data.slice(k, k + dataLen); k += dataLen;
    blocks.push({ dat, ecc: rsRemainder(dat, divisor) });
  }
  const out = [];
  const maxData = Math.max(...blocks.map((b) => b.dat.length));
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.dat.length) out.push(b.dat[i]);
  for (let i = 0; i < eccLen; i++) for (const b of blocks) out.push(b.ecc[i]);
  return out;
}

// ---- matrix -------------------------------------------------------------
const bit = (x, i) => ((x >>> i) & 1) !== 0;

function alignPositions(ver) {
  if (ver === 1) return [];
  const num = Math.floor(ver / 7) + 2;
  const size = ver * 4 + 17;
  const step = Math.ceil((size - 13) / (num * 2 - 2)) * 2;
  const res = [6];
  for (let pos = size - 7; res.length < num; pos -= step) res.splice(1, 0, pos);
  return res;
}

function buildMatrix(cw, ver, mask) {
  const size = ver * 4 + 17;
  const mods = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const setFn = (x, y, v) => { mods[y][x] = v; fn[y][x] = true; };

  // timing
  for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
  // finders + separators
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || x >= size || y < 0 || y >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      setFn(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  // alignment
  const ap = alignPositions(ver);
  for (let i = 0; i < ap.length; i++) for (let j = 0; j < ap.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) continue;
    const cx = ap[i], cy = ap[j];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
      setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  // reserve format + version areas
  const drawFormat = (m) => {
    const dataBits = (FORMAT_BITS_M << 3) | m;
    let rem = dataBits;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
    const bits = ((dataBits << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(bits, i));
    setFn(8, 7, bit(bits, 6)); setFn(8, 8, bit(bits, 7)); setFn(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(bits, i));
    setFn(8, size - 8, true); // dark module
  };
  drawFormat(0); // placeholder so data placement avoids these modules
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const b = bit(bits, i), a = size - 11 + (i % 3), c = Math.floor(i / 3);
      setFn(a, c, b); setFn(c, a, b);
    }
  }

  // data placement (zigzag)
  let idx = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - v : v;
        if (!fn[y][x] && idx < cw.length * 8) {
          mods[y][x] = bit(cw[idx >> 3], 7 - (idx & 7));
          idx++;
        }
      }
    }
  }

  // mask (non-function modules only)
  const maskFn = (m, x, y) => {
    switch (m) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++)
    if (!fn[y][x] && maskFn(mask, x, y)) mods[y][x] = !mods[y][x];
  drawFormat(mask); // real format info for the chosen mask

  return { mods, size };
}

// ---- penalty (choose the least-noisy mask) ------------------------------
function penalty(mods, size) {
  let p = 0;
  const line = (get) => {
    for (let a = 0; a < size; a++) {
      let run = 1, prev = get(a, 0);
      for (let b = 1; b < size; b++) {
        const cur = get(a, b);
        if (cur === prev) { run++; if (run === 5) p += 3; else if (run > 5) p++; }
        else { run = 1; prev = cur; }
      }
    }
  };
  line((a, b) => mods[a][b]);       // rows
  line((a, b) => mods[b][a]);       // cols
  // 2x2 blocks
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const c = mods[y][x];
    if (c === mods[y][x + 1] && c === mods[y + 1][x] && c === mods[y + 1][x + 1]) p += 3;
  }
  // finder-like patterns 1:1:3:1:1 with 4 light on either side
  const pat = [true, false, true, true, true, false, true];
  const scan = (get) => {
    for (let a = 0; a < size; a++) for (let b = 0; b <= size - 7; b++) {
      let ok = true; for (let k = 0; k < 7; k++) if (get(a, b + k) !== pat[k]) { ok = false; break; }
      if (!ok) continue;
      const before = b < 4 || [get(a, b - 1), get(a, b - 2), get(a, b - 3), get(a, b - 4)].every((v) => v === false);
      const after = b + 7 > size - 4 || [get(a, b + 7), get(a, b + 8), get(a, b + 9), get(a, b + 10)].every((v) => v === false);
      if (before || after) p += 40;
    }
  };
  scan((a, b) => mods[a][b]);
  scan((a, b) => mods[b][a]);
  // proportion of dark modules
  let dark = 0; for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (mods[y][x]) dark++;
  const pct = (dark * 100) / (size * size);
  p += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return p;
}

// ---- public: matrix + SVG ----------------------------------------------
export function qrMatrix(text) {
  const ver = chooseVersion(new TextEncoder().encode(text).length);
  const cw = interleave(text, ver);
  let best = null, bestP = Infinity;
  for (let m = 0; m < 8; m++) {
    const built = buildMatrix(cw, ver, m);
    const pen = penalty(built.mods, built.size);
    if (pen < bestP) { bestP = pen; best = built; }
  }
  return best; // { mods, size }
}

// Compact SVG: one <path> of dark modules + a white ground, quiet zone 4.
export function qrSvg(text, opts = {}) {
  const { mods, size } = qrMatrix(text);
  const q = opts.quiet == null ? 4 : opts.quiet;
  const dim = size + q * 2;
  let d = "";
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++)
    if (mods[y][x]) d += `M${x + q} ${y + q}h1v1h-1z`;
  const dark = opts.dark || "#0b0810";
  const light = opts.light || "#ffffff";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" ` +
    `shape-rendering="crispEdges" role="img" aria-label="QR code">` +
    `<rect width="${dim}" height="${dim}" fill="${light}"/>` +
    `<path d="${d}" fill="${dark}"/></svg>`;
}
