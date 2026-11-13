// Small CSV reader for staff uploads. Handles a leading byte order mark, quoted
// fields, doubled quotes, Windows line endings and comma, semicolon or tab separators.
export function parseCsv(text) {
  let s = String(text || '').replace(/^﻿/, '');
  const firstLine = s.split(/\r?\n/, 1)[0];
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch] += 1;
  }
  const sep = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    if (row.some((c) => c.trim() !== '')) rows.push({ line: rowLine, cells: row.map((c) => c.trim()) });
    row = [];
    rowLine = line + 1;
  };
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else {
        if (ch === '\n') line += 1;
        field += ch;
      }
    } else if (ch === '"') quoted = true;
    else if (ch === sep) endField();
    else if (ch === '\r') continue;
    else if (ch === '\n') {
      endRow();
      line += 1;
      rowLine = line;
    } else field += ch;
  }
  if (field !== '' || row.length) endRow();
  return rows;
}
