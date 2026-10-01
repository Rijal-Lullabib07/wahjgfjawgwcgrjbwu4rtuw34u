// Optimasi logo JAWARA: decode PNG sumber beresolusi raksasa (13.440x7.560),
// turunkan skala ke 1.024px dengan area-average (anti-alias, aman untuk tepi
// transparan lewat premultiplied alpha), tambah unsharp mask ringan agar tajam,
// lalu encode ulang jadi PNG terkompresi. Tanpa dependency eksternal.
//
// Jalankan: npm run logo:optimize  (ulangi hanya jika logo sumber berganti.)
import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "public", "logo-jawara-istimewa-2.png");
const OUT = join(root, "public", "logo-jawara-hd.png");
const TARGET_W = 2048; // aman untuk tampilan TV/layar besar
const SHARPEN = 0.35; // kekuatan unsharp mask (0 = mati)

// ---------- Decode PNG (bit depth 8, non-interlaced, RGB/RGBA) ----------
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("Bukan file PNG");
  let off = 8;
  let ihdr = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  if (!ihdr) throw new Error("IHDR tidak ditemukan");
  if (ihdr.bitDepth !== 8) throw new Error("Bit depth " + ihdr.bitDepth + " tidak didukung");
  if (ihdr.interlace !== 0) throw new Error("PNG interlaced tidak didukung");
  const channels = ihdr.colorType === 6 ? 4 : ihdr.colorType === 2 ? 3 : 0;
  if (!channels) throw new Error("Color type " + ihdr.colorType + " tidak didukung");

  const raw = inflateSync(Buffer.concat(idat));
  const { width, height } = ihdr;
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let val = raw[pos + x];
      switch (filter) {
        case 1: val = (val + a) & 255; break; // Sub
        case 2: val = (val + b) & 255; break; // Up
        case 3: val = (val + ((a + b) >> 1)) & 255; break; // Average
        case 4: { // Paeth
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          val = (val + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
          break;
        }
      }
      cur[x] = val;
    }
    pos += stride;
  }
  return { width, height, channels, data: out };
}

// ---------- Area-average downscale (premultiplied alpha) ----------
function resizeArea(img, dstW, dstH) {
  const { width: sw, height: sh, channels, data } = img;
  const dst = new Float64Array(dstW * dstH * 4); // r,g,b premultiplied + a
  const xr = sw / dstW;
  const yr = sh / dstH;
  const geoWeight = xr * yr; // total bobot geometri per piksel tujuan
  for (let dy = 0; dy < dstH; dy++) {
    const y0 = dy * yr;
    const y1 = (dy + 1) * yr;
    const iy0 = Math.floor(y0);
    const iy1 = Math.min(sh, Math.ceil(y1));
    for (let dx = 0; dx < dstW; dx++) {
      const x0 = dx * xr;
      const x1 = (dx + 1) * xr;
      const ix0 = Math.floor(x0);
      const ix1 = Math.min(sw, Math.ceil(x1));
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = iy0; sy < iy1; sy++) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        if (wy <= 0) continue;
        for (let sx = ix0; sx < ix1; sx++) {
          const wx = Math.min(sx + 1, x1) - Math.max(sx, x0);
          if (wx <= 0) continue;
          const w = wx * wy;
          const i = (sy * sw + sx) * channels;
          const al = channels === 4 ? data[i + 3] : 255;
          const wa = w * al;
          r += data[i] * wa;
          g += data[i + 1] * wa;
          b += data[i + 2] * wa;
          a += w * al;
        }
      }
      const o = (dy * dstW + dx) * 4;
      // Warna terakumulasi premultiplied dgn alpha 0-255 -> bagi 255 agar
      // kembali ke skala premultiplied standar (BUG lama: piksel opaque
      // terkalikan 255 dan ter-clamp jadi putih).
      dst[o] = r / (geoWeight * 255);
      dst[o + 1] = g / (geoWeight * 255);
      dst[o + 2] = b / (geoWeight * 255);
      dst[o + 3] = a / geoWeight;
    }
  }
  return { width: dstW, height: dstH, data: dst };
}

// ---------- Unsharp mask ringan (3x3, di atas nilai premultiplied) ----------
function unsharp(img, amount) {
  const { width: w, height: h, data } = img;
  const out = Float64Array.from(data);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        const center = data[i + c];
        const around =
          data[i - w * 4 + c] + data[i + w * 4 + c] +
          data[i - 4 + c] + data[i + 4 + c];
        out[i + c] = center * (1 + 4 * amount) - amount * around;
      }
    }
  }
  return { width: w, height: h, data: out };
}

// ---------- Normalisasi premultiplied -> RGBA 8-bit ----------
function toRgbaBytes(img) {
  const { width, height, data } = img;
  const px = Buffer.alloc(width * height * 4);
  for (let i = 0, o = 0; i < data.length; i += 4, o += 4) {
    const a = Math.max(0, Math.min(255, Math.round(data[i + 3])));
    px[o + 3] = a;
    if (a >= 1) {
      const k = 255 / a;
      px[o] = Math.max(0, Math.min(255, Math.round(data[i] * k)));
      px[o + 1] = Math.max(0, Math.min(255, Math.round(data[i + 1] * k)));
      px[o + 2] = Math.max(0, Math.min(255, Math.round(data[i + 2] * k)));
    }
  }
  return px;
}

// ---------- Encode PNG: pilih filter terbaik per baris, deflate level 9 ----------
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
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(rgba, width, height) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const cands = Array.from({ length: 5 }, () => Buffer.alloc(stride));
  for (let y = 0; y < height; y++) {
    const src = rgba.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? rgba.subarray((y - 1) * stride, y * stride) : null;
    let bestScore = Infinity;
    let bestFilter = 0;
    for (let f = 0; f < 5; f++) {
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const rawv = src[x];
        const a = x >= 4 ? src[x - 4] : 0;
        const b = prev ? prev[x] : 0;
        const c = prev && x >= 4 ? prev[x - 4] : 0;
        let v;
        switch (f) {
          case 0: v = rawv; break;
          case 1: v = rawv - a; break;
          case 2: v = rawv - b; break;
          case 3: v = rawv - ((a + b) >> 1); break;
          default: {
            const p = a + b - c;
            const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
            v = rawv - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          }
        }
        const sv = v << 24 >> 24;
        score += sv < 0 ? -sv : sv;
        cands[f][x] = v & 255;
      }
      if (score < bestScore) {
        bestScore = score;
        bestFilter = f;
      }
    }
    raw[y * (stride + 1)] = bestFilter;
    cands[bestFilter].copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- Main ----------
const t0 = Date.now();
const src = decodePng(readFileSync(SRC));
console.log("Sumber: " + src.width + "x" + src.height + " ch=" + src.channels);
const dstH = Math.round((src.height * TARGET_W) / src.width);
let out = resizeArea(src, TARGET_W, dstH);
if (SHARPEN > 0) out = unsharp(out, SHARPEN);
const png = encodePng(toRgbaBytes(out), TARGET_W, dstH);
writeFileSync(OUT, png);
console.log(
  "Hasil: " + OUT + " -> " + TARGET_W + "x" + dstH +
  " (" + (png.length / 1024).toFixed(0) + " KB, " + (Date.now() - t0) + " ms)"
);
