import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "..", "src-tauri", "icons", "icon.png");

const W = 512;
const H = 512;

// --- CRC32 (PNG chunk checksum) ---
const table = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  table[n] = c;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

// --- IHDR: 512x512, 8-bit RGBA ---
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type: RGBA

// --- Raster: vertical brand gradient + white "H" glyph ---
const top = [0x6c, 0x5c, 0xe7]; // #6C5CE7
const bottom = [0x09, 0x84, 0xe3]; // #0984E3

const raw = Buffer.alloc((W * 4 + 1) * H);
const barW = 64;
const gapW = 48;
const barH = 256;
const barTop = (H - barH) / 2;
const leftBarX = (W - (barW * 2 + gapW)) / 2;
const rightBarX = leftBarX + barW + gapW;
const midY1 = barTop + (barH - gapW) / 2;
const midY2 = barTop + (barH + gapW) / 2;

for (let y = 0; y < H; y++) {
  const rowStart = y * (W * 4 + 1);
  raw[rowStart] = 0; // filter: none
  const t = y / (H - 1);
  const r = Math.round(top[0] + (bottom[0] - top[0]) * t);
  const g = Math.round(top[1] + (bottom[1] - top[1]) * t);
  const b = Math.round(top[2] + (bottom[2] - top[2]) * t);

  for (let x = 0; x < W; x++) {
    const inLeftBar = x >= leftBarX && x < leftBarX + barW && y >= barTop && y < barTop + barH;
    const inRightBar = x >= rightBarX && x < rightBarX + barW && y >= barTop && y < barTop + barH;
    const inMiddle = x >= leftBarX && x < rightBarX + barW && y >= midY1 && y < midY2;
    const p = rowStart + 1 + x * 4;
    if (inLeftBar || inRightBar || inMiddle) {
      raw[p] = 0xff;
      raw[p + 1] = 0xff;
      raw[p + 2] = 0xff;
      raw[p + 3] = 0xff;
    } else {
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
      raw[p + 3] = 0xff;
    }
  }
}

// --- Assemble PNG ---
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, png);
console.log(`Wrote ${outPath} (${png.length} bytes)`);