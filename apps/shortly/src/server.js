import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { generateCode, validateUrl, validateSlug, validateExpiry, classifyUa, referrerHost, isExpired } from './logic.js';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE links(id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE COLLATE NOCASE, url TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', expires_on TEXT, disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1)),
      clicks INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT(datetime('now')));
    CREATE TABLE clicks(id INTEGER PRIMARY KEY AUTOINCREMENT, link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE, day TEXT NOT NULL, device TEXT NOT NULL, referrer TEXT);
    CREATE INDEX idx_clicks_link_day ON clicks(link_id, day);
    PRAGMA user_version=1; COMMIT;`);
  return db;
}
async function readBody(req) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > 20_000) throw new HttpError(413, 'Payload too large'); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}
const page = (title, msg) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:18px system-ui;display:grid;place-items:center;min-height:90vh;margin:0;text-align:center;color:#222}main{padding:1rem}a{color:#0a58ca}</style><main><h1>${title}</h1><p>${msg}</p><p><a href="/">Shortly home</a></p></main>`;

export function createApp({ dbPath = ':memory:', now = () => new Date() } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s);
  const today = () => now().toISOString().slice(0, 10);
  const dto = (l) => ({ id: l.id, code: l.code, url: l.url, title: l.title, expiresOn: l.expires_on, disabled: !!l.disabled, clicks: l.clicks, createdAt: l.created_at, expired: isExpired(l.expires_on, today()) });
  const get404 = (id) => { const l = q('SELECT * FROM links WHERE id=?').get(id); if (!l) throw new HttpError(404, 'Link not found'); return l; };

  function analytics(l) {
    const t = today(), from = new Date(Date.parse(t + 'T00:00:00Z') - 29 * 86400000).toISOString().slice(0, 10);
    const byDay = new Map(q("SELECT day, COUNT(*) n FROM clicks WHERE link_id=? AND day>=? AND device<>'bot' GROUP BY day").all(l.id, from).map((r) => [r.day, r.n]));
    const days = Array.from({ length: 30 }, (_, i) => { const d = new Date(Date.parse(from + 'T00:00:00Z') + i * 86400000).toISOString().slice(0, 10); return { day: d, clicks: byDay.get(d) || 0 }; });
    return { ...dto(l), humanClicks: q("SELECT COUNT(*) n FROM clicks WHERE link_id=? AND device<>'bot'").get(l.id).n, botClicks: q("SELECT COUNT(*) n FROM clicks WHERE link_id=? AND device='bot'").get(l.id).n, days,
      devices: q("SELECT device, COUNT(*) n FROM clicks WHERE link_id=? AND device<>'bot' GROUP BY device ORDER BY n DESC").all(l.id),
      referrers: q("SELECT COALESCE(referrer,'(direct)') name, COUNT(*) n FROM clicks WHERE link_id=? AND device<>'bot' GROUP BY referrer ORDER BY n DESC, name LIMIT 8").all(l.id) };
  }

  function redirect(req, res, code, send) {
    const l = q('SELECT * FROM links WHERE code=?').get(code);
    if (!l) return send(404, page('Link not found', 'This short link does not exist.'), 'text/html; charset=utf-8');
    if (l.disabled) return send(410, page('Link disabled', 'The owner has turned this link off.'), 'text/html; charset=utf-8');
    if (isExpired(l.expires_on, today())) return send(410, page('Link expired', 'This link has expired.'), 'text/html; charset=utf-8');
    if (req.method === 'GET') {
      db.exec('BEGIN');
      try { q('UPDATE links SET clicks = clicks + 1 WHERE id=?').run(l.id); q('INSERT INTO clicks(link_id, day, device, referrer) VALUES(?,?,?,?)').run(l.id, today(), classifyUa(req.headers['user-agent']), referrerHost(req.headers.referer)); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    }
    res.writeHead(302, { ...SEC, Location: l.url, 'Cache-Control': 'private, max-age=0, no-store' }); res.end();
  }

  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method;
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] !== 'links') throw new HttpError(404, 'Not found');
    if (p.length === 1) {
      if (m === 'GET') return { body: q('SELECT * FROM links ORDER BY id DESC LIMIT 500').all().map(dto) };
      if (m === 'POST') {
        const b = await readBody(req), d = {}, u = validateUrl(b.url, req.headers.host), s = validateSlug(b.slug), e = validateExpiry(b.expiresOn, today());
        const title = typeof b.title === 'string' ? b.title.trim() : ''; if (title.length > 100) d.title = 'Title must be ≤ 100 characters';
        if (u.error) d.url = u.error; if (s.error) d.slug = s.error; if (e.error) d.expiresOn = e.error;
        if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d);
        let code = s.value;
        if (code) { if (q('SELECT 1 FROM links WHERE code=?').get(code)) throw new HttpError(409, 'That slug is already taken', { slug: 'That slug is already taken' }); }
        else { for (let i = 0; i < 10 && !code; i++) { const c = generateCode(i < 5 ? 6 : 8); if (!q('SELECT 1 FROM links WHERE code=?').get(c) && !RESERVED_HAS(c)) code = c; } if (!code) throw new HttpError(503, 'Could not allocate a code, please retry'); }
        const r = q('INSERT INTO links(code,url,title,expires_on) VALUES(?,?,?,?)').run(code, u.value, title, e.value);
        return { status: 201, body: dto(get404(Number(r.lastInsertRowid))) };
      }
      throw new HttpError(405, 'Method not allowed');
    }
    const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id');
    const l = get404(id);
    if (p.length === 2) {
      if (m === 'GET') return { body: analytics(l) };
      if (m === 'DELETE') { q('DELETE FROM links WHERE id=?').run(id); return { status: 204 }; }
      if (m === 'PATCH') {
        const b = await readBody(req), d = {};
        if (b.disabled !== undefined && typeof b.disabled !== 'boolean') d.disabled = 'disabled must be true or false';
        const e = b.expiresOn === undefined ? { value: l.expires_on } : validateExpiry(b.expiresOn, today()); if (e.error) d.expiresOn = e.error;
        if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d);
        q('UPDATE links SET disabled=?, expires_on=? WHERE id=?').run(b.disabled === undefined ? l.disabled : b.disabled ? 1 : 0, e.value, id); return { body: dto(get404(id)) };
      }
    }
    throw new HttpError(405, 'Method not allowed');
  }
  const RESERVED_HAS = (c) => ['api', 's'].includes(c.toLowerCase());

  const server = createServer(async (req, res) => {
    const send = (s, b, t = 'application/json; charset=utf-8') => { res.writeHead(s, { ...SEC, 'Content-Type': t, 'Cache-Control': 'no-store' }); res.end(b); };
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/api/')) { const r = await api(req, url); return send(r.status ?? 200, r.body === undefined ? '' : JSON.stringify(r.body)); }
      const sm = /^\/s\/([A-Za-z0-9_-]{1,64})\/?$/.exec(url.pathname);
      if (sm && (req.method === 'GET' || req.method === 'HEAD')) return redirect(req, res, sm[1], send);
      if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
      const rel = url.pathname === '/' ? 'index.html' : normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
      if (rel.includes('..')) throw new HttpError(404, 'Not found');
      try { return send(200, await readFile(join(PUBLIC, rel)), MIME[extname(rel)] || 'application/octet-stream'); } catch { throw new HttpError(404, 'Not found'); }
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, JSON.stringify({ error: e.message, details: e.details }));
      if (e instanceof URIError) return send(400, JSON.stringify({ error: 'Bad request' }));
      console.error(e); send(500, JSON.stringify({ error: 'Internal server error' }));
    }
  });
  return { server, db };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/shortly.db' });
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => console.log(`Shortly listening on :${port}`));
}
