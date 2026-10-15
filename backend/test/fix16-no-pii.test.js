import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '../src');
const TEST = __dirname;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(js|json|txt|md)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('Fix 16: no real personal data in source or tests', () => {
  it('has no consumer email domains or the known real address', () => {
    const parts = [
      ['guru', 'oshan'].join(''),
      ['@gmail', '.com'].join(''),
      ['@yahoo', '.com'].join(''),
      ['@hotmail', '.com'].join(''),
    ];
    const pattern = new RegExp(parts.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
    const files = [...walk(SRC), ...walk(TEST)];
    const bad = [];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      if (pattern.test(text)) bad.push(file);
    }
    expect(bad).toEqual([]);
  });
});
