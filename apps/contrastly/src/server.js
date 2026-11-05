import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { parseColor, toHex, contrast, grade, round2, suggest } from './color.js';

const SRC = dirname(fileURLToPath(import.meta.url)), PUBLIC = join(SRC, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }
const level = (r) => (r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? 'AA Large' : 'Fail');

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path); db.exec('PRAGMA journal_mode=WAL;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE palettes(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60), colors TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT(datetime('now')));
    PRAGMA user_version=1; COMMIT;`);
  return db;
}
async function readBody(req) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > 50_000) throw new HttpError(413, 'Payload too large'); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}
/** Full report for one pair. fg may be translucent; bg too. */
export function check(fgIn, bgIn) {
  const fg = parseColor(fgIn), bg = parseColor(bgIn), d = {};
  if (!fg) d.fg = 'Not a recognised colour (try #1a2b3c, rgb(…) or hsl(…))'; if (!bg) d.bg = 'Not a recognised colour (try #1a2b3c, rgb(…) or hsl(…))';
  if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d);
  const ratio = contrast(fg, bg), g = grade(ratio), out = { fg: toHex(fg), bg: toHex(bg), ratio: round2(ratio), level: level(ratio), ...g, suggestions: {} };
  if (!g.aaNormal) out.suggestions.aa = suggest(fg, bg, 4.5) && { ...suggest(fg, bg, 4.5), ratio: round2(suggest(fg, bg, 4.5).ratio) };
  if (!g.aaaNormal) out.suggestions.aaa = suggest(fg, bg, 7) && { ...suggest(fg, bg, 7), ratio: round2(suggest(fg, bg, 7).ratio) };
  return out;
}

export function createApp({ dbPath = ':memory:' } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s);
  const dto = (r) => ({ id: r.id, name: r.name, colors: JSON.parse(r.colors) });
  const get = (id) => { const r = q('SELECT * FROM palettes WHERE id=?').get(id); if (!r) throw new HttpError(404, 'Palette not found'); return r; };
  const paletteIn = (b) => {
    const d = {}, name = typeof b.name === 'string' ? b.name.trim() : '', colors = [];
    if (!name) d.name = 'Name is required'; else if (name.length > 60) d.name = 'Name must be ≤ 60 characters';
    if (!Array.isArray(b.colors) || b.colors.length < 1 || b.colors.length > 12) d.colors = 'Provide 1–12 colours';
    else b.colors.forEach((x, i) => { const p = parseColor(x); if (!p) d.colors = `Colour ${i + 1} (“${String(x).slice(0, 20)}”) is not recognised`; else if (p.a < 1) d.colors = `Colour ${i + 1} is translucent; palettes need opaque colours`; else colors.push(toHex(p)); });
    if (!d.colors && new Set(colors).size !== colors.length) d.colors = 'Palette contains duplicate colours';
    if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d); return { name, colors };
  };
  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method;
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] === 'check' && m === 'POST') { const b = await readBody(req); return { body: check(b.fg, b.bg) }; }
    if (p[0] === 'palettes') {
      if (p.length === 1) {
        if (m === 'GET') return { body: q('SELECT * FROM palettes ORDER BY id DESC').all().map(dto) };
        if (m === 'POST') { const v = paletteIn(await readBody(req)); const r = q('INSERT INTO palettes(name,colors) VALUES(?,?)').run(v.name, JSON.stringify(v.colors)); return { status: 201, body: dto(get(Number(r.lastInsertRowid))) }; }
      } else {
        const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id'); const row = get(id);
        if (p[2] === 'matrix' && m === 'GET') {
          const colors = JSON.parse(row.colors), cells = []; let fails = 0, pairs = 0;
          for (const fg of colors) for (const bg of colors) { if (fg === bg) { cells.push(null); continue; } const r = contrast(parseColor(fg), parseColor(bg)); cells.push({ fg, bg, ratio: round2(r), level: level(r) }); pairs++; if (r < 4.5) fails++; }
          return { body: { id, name: row.name, colors, cells, summary: { pairs, belowAA: fails } } };
        }
        if (p.length === 2) {
          if (m === 'GET') return { body: dto(row) };
          if (m === 'PUT') { const v = paletteIn(await readBody(req)); q('UPDATE palettes SET name=?, colors=? WHERE id=?').run(v.name, JSON.stringify(v.colors), id); return { body: dto(get(id)) }; }
          if (m === 'DELETE') { q('DELETE FROM palettes WHERE id=?').run(id); return { status: 204 }; }
        }
      }
    }
    throw new HttpError(404, 'Not found');
  }
  const server = createServer(async (req, res) => {
    const send = (s, b, t = 'application/json; charset=utf-8') => { res.writeHead(s, { ...SEC, 'Content-Type': t, 'Cache-Control': 'no-store' }); res.end(b); };
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/api/')) { const r = await api(req, url); return send(r.status ?? 200, r.body === undefined ? '' : JSON.stringify(r.body)); }
      if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
      const rel = url.pathname === '/' ? 'index.html' : normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
      if (rel.includes('..')) throw new HttpError(404, 'Not found');
      if (rel === 'color.js') return send(200, await readFile(join(SRC, 'color.js')), MIME['.js']);
      try { return send(200, await readFile(join(PUBLIC, rel)), MIME[extname(rel)] || 'application/octet-stream'); } catch { throw new HttpError(404, 'Not found'); }
    } catch (e) {
      if (e instanceof HttpError) { if (e.status === 413) res.setHeader('Connection', 'close'); return send(e.status, JSON.stringify({ error: e.message, details: e.details })); }
      if (e instanceof URIError) return send(400, JSON.stringify({ error: 'Bad request' }));
      console.error(e); send(500, JSON.stringify({ error: 'Internal server error' }));
    }
  });
  return { server, db };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/contrastly.db' });
  const port = Number(process.env.PORT) || 3000; server.listen(port, '0.0.0.0', () => console.log(`Contrastly listening on :${port}`));
}
