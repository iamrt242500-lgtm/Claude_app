// RFC 4180 CSV parser with BOM stripping and delimiter detection.
export function detectDelimiter(text) {
  const head = text.split(/\r?\n/).slice(0, 5).join('\n');
  let best = ',', bestN = -1;
  for (const d of [',', ';', '\t', '|']) {
    let n = 0, q = false;
    for (const ch of head) { if (ch === '"') q = !q; else if (!q && ch === d) n++; }
    if (n > bestN) { best = d; bestN = n; }
  }
  return best;
}
export function parseCsv(input, delimiter) {
  const text = String(input).replace(/^﻿/, '');
  const d = delimiter || detectDelimiter(text);
  const rows = []; let row = [], cell = '', q = false, i = 0, wasQuoted = false;
  const endCell = () => { row.push(cell); cell = ''; wasQuoted = false; };
  const endRow = () => { const blank = row.length === 0 && cell === '' && !wasQuoted; endCell(); if (!blank) rows.push(row); row = []; };
  while (i < text.length) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"' && cell === '') { q = true; wasQuoted = true; }
    else if (ch === d) endCell();
    else if (ch === '\n') endRow();
    else if (ch === '\r') { if (text[i + 1] === '\n') i++; endRow(); }
    else cell += ch;
    i++;
  }
  if (q) throw new Error('Unterminated quoted field');
  if (cell !== '' || row.length || wasQuoted) endRow();
  return { delimiter: d, rows };
}
