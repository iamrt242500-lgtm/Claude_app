import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { newToken, hashToken, isToken, validatePoll, isClosed, canSeeResults, tally, validateChoice, createLimiter } from './poll.js';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d, h) { super(m); this.status = s; this.details = d; this.headers = h; } }

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE polls(id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, admin_hash TEXT NOT NULL UNIQUE, question TEXT NOT NULL, multi INTEGER NOT NULL DEFAULT 0, results_mode TEXT NOT NULL DEFAULT 'always',
      closes_at TEXT, closed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT(datetime('now')));
    CREATE TABLE options(id INTEGER PRIMARY KEY AUTOINCREMENT, poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE, position INTEGER NOT NULL, text TEXT NOT NULL);
    CREATE TABLE votes(poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE, voter TEXT NOT NULL, option_id INTEGER NOT NULL REFERENCES options(id) ON DELETE CASCADE, PRIMARY KEY(poll_id, voter, option_id)) WITHOUT ROWID;
    CREATE INDEX idx_votes_option ON votes(option_id);
    PRAGMA user_version=1; COMMIT;`);
  return db;
}
async function readBody(req) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > 20_000) throw new HttpError(413, 'Payload too large'); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split(/=(.*)/s).slice(0, 2)).filter(([k]) => k));

export function createApp({ dbPath = ':memory:', now = () => Date.now(), trustProxy = false, limits = { create: 10, vote: 40 } } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s);
  const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const createLim = createLimiter(limits.create, 60_000, now), voteLim = createLimiter(limits.vote, 60_000, now);
  const ipOf = (req) => (trustProxy && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
  const limit = (lim, req) => { const r = lim(ipOf(req)); if (!r.ok) throw new HttpError(429, 'Too many requests — please slow down', null, { 'Retry-After': String(r.retryAfter) }); };

  const bySlug = (slug) => { const p = isToken(slug) || /^[A-Za-z0-9_-]{4,64}$/.test(slug) ? q('SELECT * FROM polls WHERE slug=?').get(slug) : null; if (!p) throw new HttpError(404, 'Poll not found'); return p; };
  const byAdmin = (token) => { const p = isToken(token) ? q('SELECT * FROM polls WHERE admin_hash=?').get(hashToken(token)) : null; if (!p) throw new HttpError(404, 'Poll not found'); return p; };
  function view(p, { voter = null, isAdmin = false } = {}) {
    const opts = q('SELECT id, text FROM options WHERE poll_id=? ORDER BY position').all(p.id), closed = isClosed({ closed: p.closed, closesAt: p.closes_at }, now());
    const mine = voter ? q('SELECT option_id FROM votes WHERE poll_id=? AND voter=?').all(p.id, voter).map((r) => r.option_id) : [];
    const show = canSeeResults(p.results_mode, { hasVoted: mine.length > 0, closed, isAdmin });
    const counts = show ? tally(opts.map((o) => o.id), q('SELECT option_id FROM votes WHERE poll_id=?').all(p.id).map((r) => r.option_id)) : null;
    const voters = isAdmin ? q('SELECT COUNT(DISTINCT voter) n FROM votes WHERE poll_id=?').get(p.id).n : null;
    const total = counts ? Object.values(counts).reduce((s, n) => s + n, 0) : null;
    return { slug: p.slug, question: p.question, multi: !!p.multi, resultsMode: p.results_mode, closesAt: p.closes_at, closed, manuallyClosed: !!p.closed, createdAt: p.created_at, hasVoted: mine.length > 0, myVote: mine, resultsVisible: show,
      options: opts.map((o) => ({ id: o.id, text: o.text, ...(counts ? { votes: counts[o.id], percent: total ? Math.round((counts[o.id] / total) * 1000) / 10 : 0 } : {}) })), totalVotes: total, ...(isAdmin ? { voters } : {}) };
  }

  async function api(req, url, ctx) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method;
    if (p[0] === 'health') return { body: { ok: true } };
    const jar = cookies(req); let voter = isToken(jar.vid) ? jar.vid : null;
    const ensureVoter = () => { if (!voter) { voter = newToken(); ctx.setCookie = `vid=${voter}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`; } return voter; };
    if (p[0] === 'polls' && p.length === 1 && m === 'POST') {
      limit(createLim, req);
      const r = validatePoll(await readBody(req), now()); if (r.errors) throw new HttpError(422, 'Validation failed', r.errors);
      const slug = newToken(6), admin = newToken(24), v = r.value;
      const id = tx(() => { const id = Number(q('INSERT INTO polls(slug,admin_hash,question,multi,results_mode,closes_at) VALUES(?,?,?,?,?,?)').run(slug, hashToken(admin), v.question, v.multi ? 1 : 0, v.resultsMode, v.closesAt).lastInsertRowid); v.options.forEach((t, i) => q('INSERT INTO options(poll_id,position,text) VALUES(?,?,?)').run(id, i, t)); return id; });
      return { status: 201, body: { ...view(q('SELECT * FROM polls WHERE id=?').get(id), { isAdmin: true }), adminToken: admin } };   // the admin token is shown exactly once; only its hash is stored
    }
    if (p[0] === 'polls' && p.length === 2 && m === 'GET') { const poll = bySlug(p[1]); return { body: view(poll, { voter }) }; }
    if (p[0] === 'polls' && p[2] === 'vote' && m === 'POST') {
      limit(voteLim, req); const poll = bySlug(p[1]);
      if (isClosed({ closed: poll.closed, closesAt: poll.closes_at }, now())) throw new HttpError(409, 'This poll is closed');
      const opts = q('SELECT id FROM options WHERE poll_id=?').all(poll.id).map((o) => o.id), c = validateChoice({ optionIds: opts, multi: !!poll.multi }, (await readBody(req)).options);
      if (c.error) throw new HttpError(422, 'Validation failed', { options: c.error });
      const vid = ensureVoter();
      tx(() => { q('DELETE FROM votes WHERE poll_id=? AND voter=?').run(poll.id, vid); for (const id of c.ids) q('INSERT INTO votes(poll_id,voter,option_id) VALUES(?,?,?)').run(poll.id, vid, id); });   // re-voting replaces, never adds
      return { body: view(poll, { voter: vid }) };
    }
    if (p[0] === 'admin' && p.length >= 2) {
      const poll = byAdmin(p[1]);
      if (p.length === 2) {
        if (m === 'GET') return { body: view(poll, { isAdmin: true }) };
        if (m === 'DELETE') { q('DELETE FROM polls WHERE id=?').run(poll.id); return { status: 204 }; }
      }
      if (p[2] === 'close' && m === 'POST') { q('UPDATE polls SET closed=1 WHERE id=?').run(poll.id); return { body: view(byAdmin(p[1]), { isAdmin: true }) }; }
      if (p[2] === 'reopen' && m === 'POST') {
        const expired = poll.closes_at && Date.parse(poll.closes_at) <= now();
        if (expired) throw new HttpError(409, 'The closing time has passed — remove or extend it first', { closesAt: 'closing time has passed' });
        q('UPDATE polls SET closed=0 WHERE id=?').run(poll.id); return { body: view(byAdmin(p[1]), { isAdmin: true }) };
      }
      if (p[2] === 'deadline' && m === 'POST') {
        const b = await readBody(req); let t = null;
        if (b.closesAt != null && b.closesAt !== '') { const ms = Date.parse(b.closesAt); if (Number.isNaN(ms) || ms <= now()) throw new HttpError(422, 'Validation failed', { closesAt: 'Closing time must be in the future' }); t = new Date(ms).toISOString(); }
        q('UPDATE polls SET closes_at=? WHERE id=?').run(t, poll.id); return { body: view(byAdmin(p[1]), { isAdmin: true }) };
      }
    }
    throw new HttpError(404, 'Not found');
  }

  const server = createServer(async (req, res) => {
    const ctx = {};
    const send = (s, b, t = 'application/json; charset=utf-8', h = {}) => { res.writeHead(s, { ...SEC, 'Content-Type': t, 'Cache-Control': 'no-store', ...(ctx.setCookie ? { 'Set-Cookie': ctx.setCookie } : {}), ...h }); res.end(b); };
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/api/')) { const r = await api(req, url, ctx); return send(r.status ?? 200, r.body === undefined ? '' : JSON.stringify(r.body)); }
      if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
      const rel = url.pathname === '/' ? 'index.html' : normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
      if (rel.includes('..')) throw new HttpError(404, 'Not found');
      try { return send(200, await readFile(join(PUBLIC, rel)), MIME[extname(rel)] || 'application/octet-stream'); } catch { throw new HttpError(404, 'Not found'); }
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, JSON.stringify({ error: e.message, details: e.details }), 'application/json; charset=utf-8', e.headers);
      if (e instanceof URIError) return send(400, JSON.stringify({ error: 'Bad request' }));
      console.error(e); send(500, JSON.stringify({ error: 'Internal server error' }));
    }
  });
  return { server, db };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/pollbox.db', trustProxy: process.env.TRUST_PROXY === '1' });
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => console.log(`Pollbox listening on :${port}`));
}
