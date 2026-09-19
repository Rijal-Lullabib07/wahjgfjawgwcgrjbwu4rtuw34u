// Generate PWA icons tanpa dependency eksternal (PNG writer + rasterizer sederhana).
// Output: public/icons/icon-192.png, icon-512.png, favicon.svg
// Desain: logo perisai Polres dengan bintang, garis pangkat, dan gerbang.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "icons");
mkdirSync(outDir, { recursive: true });

// Palet logo Polres
const WHITE = [255, 255, 255];
const SHIELD = [15, 61, 110]; // #0f3d6e
const WALL = [8, 33, 60]; // #08213c
const GOLD = [245, 185, 66]; // #f5b942
const RED = [211, 47, 47]; // #d32f2f
const BUILDING = [245, 245, 245]; // #f5f5f5

// ---------- PNG encoder (tanpa dependency) ----------
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++)
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function adler32(buf) {
  let a = 1,
    b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function zlibStore(data) {
  // zlib stream dengan blok "stored" (uncompressed) — cukup untuk ikon kecil
  const blocks = [];
  const max = 65535;
  for (let i = 0; i < data.length; i += max) {
    const slice = data.subarray(i, Math.min(i + max, data.length));
    const isLast = i + max >= data.length;
    const header = Buffer.alloc(5);
    header[0] = isLast ? 1 : 0;
    header.writeUInt16LE(slice.length, 1);
    header.writeUInt16LE(~slice.length & 0xffff, 3);
    blocks.push(header, slice);
  }
  const header = Buffer.from([0x78, 0x01]);
  const trailer = Buffer.alloc(4);
  trailer.writeUInt32BE(adler32(data));
  return Buffer.concat([header, ...blocks, trailer]);
}

// ---------- Geometri logo (ruang koordinat 100 x 116) ----------
function cubic(p0, p1, p2, p3, steps = 10) {
  const pts = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps,
      u = 1 - t;
    pts.push([
      u * u * u * p0[0] +
        3 * u * u * t * p1[0] +
        3 * u * t * t * p2[0] +
        t * t * t * p3[0],
      u * u * u * p0[1] +
        3 * u * u * t * p1[1] +
        3 * u * t * t * p2[1] +
        t * t * t * p3[1],
    ]);
  }
  return pts;
}

const SHIELD_OUTER = [
  [50, 2],
  [94, 12],
  [94, 58],
  ...cubic([94, 58], [94, 84], [76, 102], [50, 114]),
  ...cubic([50, 114], [24, 102], [6, 84], [6, 58]),
  [6, 12],
];
const SHIELD_INNER = [
  [50, 6],
  [90, 15],
  [90, 58],
  ...cubic([90, 58], [90, 81.5], [74, 98.5], [50, 109.5]),
  ...cubic([50, 109.5], [26, 98.5], [10, 81.5], [10, 58]),
  [10, 15],
];
const STAR = [
  [50, 12],
  [52.2, 16.6],
  [57.2, 17.3],
  [53.6, 20.8],
  [54.5, 25.8],
  [50, 23.4],
  [45.5, 25.8],
  [46.4, 20.8],
  [42.8, 17.3],
  [47.8, 16.6],
];

function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

function inRect(px, py, x, y, w, h) {
  return px >= x && px <= x + w && py >= y && py <= y + h;
}

function inEllipse(px, py, cx, cy, rx, ry, rotDeg = 0) {
  const a = (rotDeg * Math.PI) / 180;
  const dx = px - cx,
    dy = py - cy;
  const xr = (dx * Math.cos(a) + dy * Math.sin(a)) / rx;
  const yr = (-dx * Math.sin(a) + dy * Math.cos(a)) / ry;
  return xr * xr + yr * yr <= 1;
}

/** Daftar bentuk dari bawah ke atas; warna akhir = bentuk teratas yang mengena. */
const SHAPES = [
  { test: (x, y) => pointInPoly(x, y, SHIELD_INNER), color: SHIELD },
  { test: (x, y) => pointInPoly(x, y, STAR), color: GOLD },
  // Bintang dan garis pangkat
  { test: (x, y) => inRect(x, y, 24, 55, 52, 5), color: GOLD },
  { test: (x, y) => inRect(x, y, 30, 66, 40, 5), color: BUILDING },
  { test: (x, y) => inRect(x, y, 36, 77, 28, 18), color: BUILDING },
  { test: (x, y) => inRect(x, y, 36, 77, 28, 3), color: RED },
  { test: (x, y) => inRect(x, y, 42, 83, 5, 12), color: WALL },
  { test: (x, y) => inRect(x, y, 53, 83, 5, 12), color: WALL },
];

/** Warna pada satu titik ruang logo (100 x 116), dengan latar putih di luar perisai. */
function colorAtLogo(lx, ly) {
  let color = WHITE;
  for (const s of SHAPES) {
    if (s.test(lx, ly)) color = s.color;
  }
  return color;
}

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 3);
  // Ruang logo 100 x 116 di-map ke kanvas persegi (perisai memenuhi tinggi).
  const scale = size / 116;
  const ox = (size - 100 * scale) / 2;
  const sample = (sx, sy) => colorAtLogo((sx - ox) / scale, sy / scale);
  // Supersampling 2x2 untuk tepi halus
  const offsets = [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.25, 0.75],
    [0.75, 0.75],
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0,
        g = 0,
        b = 0;
      for (const [dx, dy] of offsets) {
        const c = sample(x + dx, y + dy);
        r += c[0];
        g += c[1];
        b += c[2];
      }
      const i = (y * size + x) * 3;
      px[i] = Math.round(r / 4);
      px[i + 1] = Math.round(g / 4);
      px[i + 2] = Math.round(b / 4);
    }
  }
  return px;
}

function encodePng(size) {
  const px = drawIcon(size);
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter none
    px.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlibStore(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 116">
  <path d="M50 2 L94 12 V58 C94 84 76 102 50 114 C24 102 6 84 6 58 V12 Z" fill="#ffffff"/>
  <path d="M50 6 L90 15 V58 C90 81.5 74 98.5 50 109.5 C26 98.5 10 81.5 10 58 V15 Z" fill="#0f3d6e"/>
  <path d="M50 12 l2.2 4.6 5 .7 -3.6 3.5 .9 5 -4.5-2.4 -4.5 2.4 .9-5 -3.6-3.5 5-.7 Z" fill="#f5b942"/>
  <path d="M24 55 H76 V60 H24 Z" fill="#f5b942"/>
  <path d="M30 66 H70 V71 H30 Z" fill="#f5f5f5"/>
  <path d="M36 77 H64 V95 H36 Z" fill="#f5f5f5"/>
  <path d="M36 77 H64 V80 H36 Z" fill="#d32f2f"/>
  <path d="M42 83 H47 V95 H42 Z M53 83 H58 V95 H53 Z" fill="#08213c"/>
</svg>`;

writeFileSync(join(outDir, "icon-192.png"), encodePng(192));
writeFileSync(join(outDir, "icon-512.png"), encodePng(512));
writeFileSync(join(outDir, "favicon.svg"), faviconSvg.trim() + "\n");
console.log("Ikon PWA (logo Polres) dibuat di public/icons");
