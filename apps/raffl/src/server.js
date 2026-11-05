import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { seedFrom, rng, parseEntries, drawWinners, makeGroups, secretSanta } from './draw.js';

const SRC = dirname(fileURLToPath(import.meta.url)), PUBLIC = join(SRC, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }
const KINDS = ['winners', 'groups', 'santa'], MAX_ENTRIES = 500;

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path); db.exec('PRAGMA journal_mode=WAL;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE draws(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, title TEXT NOT NULL, entries TEXT NOT NULL, seed TEXT NOT NULL, params TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT(datetime('now')));
    PRAGMA user_version=1; COMMIT;`);
  return db;
}
async function readBody(req) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > 100_000) throw new HttpError(413, 'Payload too large'); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}
/** Pure and deterministic: the same (kind, entries text, seed, params) always gives the same result. */
export function compute(kind, entriesText, seed, params) {
  const d = {}; if (!KINDS.includes(kind)) throw new HttpError(422, 'Validation failed', { kind: `kind must be one of ${KINDS.join(', ')}` });
  const { entries, errors } = parseEntries(entriesText); if (errors.length) d.entries = errors.slice(0, 3).join('; '); else if (entries.length < (kind === 'winners' ? 1 : 2)) d.entries = kind === 'winners' ? 'Add at least one entry' : 'Add at least two entries'; else if (entries.length > MAX_ENTRIES) d.entries = `At most ${MAX_ENTRIES} entries`;
  if (typeof seed !== 'string' || !seed.trim() || seed.length > 100) d.seed = 'Seed must be 1–100 characters';
  const p = {}; if (kind === 'winners') { p.count = params?.count ?? 1; if (!Number.isInteger(p.count) || p.count < 1 || p.count > 100) d.count = 'Winners must be 1–100'; else if (!d.entries && p.count > entries.length) d.count = `Only ${entries.length} distinct entries to choose from`; }
  if (kind === 'groups') { p.groups = params?.groups ?? 2; if (!Number.isInteger(p.groups) || p.groups < 2 || p.groups > 50) d.groups = 'Groups must be 2–50'; else if (!d.entries && p.groups > entries.length) d.groups = 'More groups than people'; }
  if (kind === 'santa') p.ring = params?.ring !== false;
  if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d);
  const r = rng(seedFrom(`${seed.trim()}|${kind}`)), names = entries.map((e) => e.name);
  if (kind === 'winners') return { entries, params: p, result: { winners: drawWinners(entries, p.count, r) } };
  if (kind === 'groups') return { entries, params: p, result: { groups: makeGroups(names, p.groups, r) } };
  return { entries, params: p, result: { pairs: secretSanta(names, r, { ring: p.ring }) } };
}

export function createApp({ dbPath = ':memory:' } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s);
  const dto = (r) => ({ id: r.id, kind: r.kind, title: r.title, seed: r.seed, params: JSON.parse(r.params), entries: r.entries, result: JSON.parse(r.result), createdAt: r.created_at });
  const get = (id) => { const r = q('SELECT * FROM draws WHERE id=?').get(id); if (!r) throw new HttpError(404, 'Draw not found'); return r; };
  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method;
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] === 'verify' && m === 'POST') { const b = await readBody(req); const c = compute(b.kind, b.entries, b.seed, b.params); const same = b.result === undefined ? null : JSON.stringify(c.result) === JSON.stringify(b.result); return { body: { result: c.result, matches: same } }; }
    if (p[0] === 'draws') {
      if (p.length === 1 && m === 'GET') return { body: q('SELECT * FROM draws ORDER BY id DESC LIMIT 100').all().map((r) => { const d = dto(r); return { id: d.id, kind: d.kind, title: d.title, createdAt: d.createdAt, entryCount: d.entries.split('\n').filter((x) => x.trim()).length }; }) };
      if (p.length === 1 && m === 'POST') {
        const b = await readBody(req), title = typeof b.title === 'string' ? b.title.trim() : ''; if (title.length > 80) throw new HttpError(422, 'Validation failed', { title: 'Title must be ≤ 80 characters' });
        const seed = typeof b.seed === 'string' && b.seed.trim() ? b.seed.trim() : randomBytes(6).toString('hex'), c = compute(b.kind, b.entries, seed, b.params);
        const r = q('INSERT INTO draws(kind,title,entries,seed,params,result) VALUES(?,?,?,?,?,?)').run(b.kind, title || `${b.kind[0].toUpperCase()}${b.kind.slice(1)} draw`, String(b.entries), seed, JSON.stringify(c.params), JSON.stringify(c.result)); return { status: 201, body: dto(get(Number(r.lastInsertRowid))) };
      }
      const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id'); const row = get(id);
      if (p.length === 2 && m === 'GET') return { body: dto(row) }; if (p.length === 2 && m === 'DELETE') { q('DELETE FROM draws WHERE id=?').run(id); return { status: 204 }; }
      if (p[2] === 'verify' && m === 'GET') { const d = dto(row), c = compute(d.kind, d.entries, d.seed, d.params); return { body: { matches: JSON.stringify(c.result) === JSON.stringify(d.result), recomputed: c.result } }; }
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
      if (rel === 'draw.js') return send(200, await readFile(join(SRC, 'draw.js')), MIME['.js']);
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
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/raffl.db' });
  const port = Number(process.env.PORT) || 3000; server.listen(port, '0.0.0.0', () => console.log(`Raffl listening on :${port}`));
}
