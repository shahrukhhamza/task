// Renders the PWA icons without any image dependencies: `node scripts/make-icons.mjs`
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const TEAL = [15, 118, 110];
const WHITE = [255, 255, 255];
const MINT = [153, 246, 228];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

function png(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(6, 9); // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const bezier = (p0, p1, p2, p3, t) => {
  const u = 1 - t;
  return [
    u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
    u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1],
  ];
};

// the favicon's wave, in a 64-unit box
const wave = [];
for (let i = 0; i <= 60; i++) wave.push(bezier([14, 40], [22, 40], [22, 24], [32, 24], i / 60));
for (let i = 1; i <= 60; i++) wave.push(bezier([32, 24], [42, 24], [42, 40], [50, 40], i / 60));

function render(size, { maskable }) {
  const pixels = Buffer.alloc(size * size * 4);
  // maskable icons keep their art inside the central safe zone
  const scale = maskable ? 0.62 : 1;
  const SS = 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = ((x + (sx + 0.5) / SS) / size) * 64;
          const py = ((y + (sy + 0.5) / SS) / size) * 64;
          let color = null;

          // background: rounded square, or full bleed when maskable
          const inside = maskable
            ? true
            : (() => {
                const rx = 14;
                const cx = Math.min(Math.max(px, rx), 64 - rx);
                const cy = Math.min(Math.max(py, rx), 64 - rx);
                return (px - cx) ** 2 + (py - cy) ** 2 <= rx * rx;
              })();
          if (inside) color = TEAL;

          const ux = (px - 32) / scale + 32;
          const uy = (py - 32) / scale + 32;
          if (inside) {
            if ((ux - 32) ** 2 + (uy - 16) ** 2 <= 16) color = MINT;
            const half = 2.5;
            for (const [wx, wy] of wave) {
              if ((ux - wx) ** 2 + (uy - wy) ** 2 <= half * half) {
                color = WHITE;
                break;
              }
            }
          }
          if (color) {
            r += color[0]; g += color[1]; b += color[2]; a += 255;
          }
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      const covered = a / 255;
      pixels[i] = covered ? Math.round(r / covered) : 0;
      pixels[i + 1] = covered ? Math.round(g / covered) : 0;
      pixels[i + 2] = covered ? Math.round(b / covered) : 0;
      pixels[i + 3] = Math.round(a / n);
    }
  }
  return pixels;
}

mkdirSync('public', { recursive: true });
for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
]) {
  writeFileSync(`public/${name}`, png(size, render(size, { maskable })));
  console.log('wrote', name);
}
