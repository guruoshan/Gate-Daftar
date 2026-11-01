import { deflateSync } from 'zlib';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const cream = [0xf4, 0xf1, 0xea];
  const green = [0x1f, 0x6b, 0x4f];
  const rows = [];
  const cx = size / 2;
  const r = size * 0.32;
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cx;
      const c = dx * dx + dy * dy <= r * r ? green : cream;
      const o = 1 + x * 3;
      row[o] = c[0];
      row[o + 1] = c[1];
      row[o + 2] = c[2];
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

const dir = join(dirname(fileURLToPath(import.meta.url)), '../public/icons');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'icon-192.png'), png(192));
writeFileSync(join(dir, 'icon-512.png'), png(512));
