// Renders icons/icon{16,32,48,128}.png — a rounded dark tile with a crescent
// cut out of a LinkedIn-blue disc. Written with a minimal zlib-backed PNG
// encoder so the repo needs no image dependencies.
//
// Usage: node tools/generate-icons.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "icons");
mkdirSync(outDir, { recursive: true });

const TILE = [27, 31, 35, 255]; // #1b1f23, the theme's card surface
const DISC = [112, 181, 249, 255]; // #70b5f9, dark-mode action blue

const SS = 4; // supersampling factor; the only anti-aliasing we get

function render(size) {
  const n = size * SS;
  const px = new Float64Array(size * size * 4);

  const r = n / 2;
  const cornerR = n * 0.22;
  const discR = n * 0.3;
  const discC = [n * 0.46, n * 0.5];
  // Offset bite turns the disc into a crescent; radius slightly larger than the
  // disc so the cut reads as a moon rather than a pac-man wedge.
  const biteR = n * 0.27;
  const biteC = [n * 0.63, n * 0.36];

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;

      // rounded-square mask
      const dx = Math.max(Math.abs(cx - r) - (r - cornerR), 0);
      const dy = Math.max(Math.abs(cy - r) - (r - cornerR), 0);
      if (Math.hypot(dx, dy) > cornerR) continue;

      const inDisc = Math.hypot(cx - discC[0], cy - discC[1]) <= discR;
      const inBite = Math.hypot(cx - biteC[0], cy - biteC[1]) <= biteR;
      const color = inDisc && !inBite ? DISC : TILE;

      const o = ((y / SS) | 0) * size * 4 + (((x / SS) | 0) * 4);
      for (let c = 0; c < 4; c++) px[o + c] += color[c];
    }
  }

  const samples = SS * SS;
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < px.length; i++) out[i] = Math.round(px[i] / samples);
  return out;
}

const crcTable = Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolor + alpha
  // 10-12: compression, filter, interlace — all 0

  // one filter byte (0 = None) per scanline
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [16, 32, 48, 128]) {
  const file = join(outDir, `icon${size}.png`);
  writeFileSync(file, png(render(size), size));
  console.log(`wrote icons/icon${size}.png`);
}
