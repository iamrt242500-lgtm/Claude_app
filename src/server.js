import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { openDb, repo } from './db.js';
import { validateDecision, validateReview, computeStats } from './logic.js';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
};

class HttpError extends Error { constructor(status, message, details) { super(message); this.status = status; this.details = details; } }

const safeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const csvCell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replaceAll('"', '""')}"`; };

async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 100_000) throw new HttpError(413, 'Payload too large'); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

export function createApp({ dbPath = ':memory:', password = '' } = {}) {
  const db = openDb(dbPath);
  const store = repo(db);

  async function api(req, url) {
    const parts = url.pathname.split('/').filter(Boolean).slice(1); // after "api"
    const m = req.method;
    const id = parts[1] !== undefined ? Number(parts[1]) : null;
    if (parts[0] === 'health') return { body: { ok: true } };
    if (parts[0] === 'stats' && m === 'GET') return { body: computeStats(store.list()) };
    if (parts[0] === 'export' && m === 'GET') {
      const rows = store.list();
      if (url.searchParams.get('format') === 'csv') {
        const cols = ['id', 'title', 'context', 'choice', 'prediction', 'confidence', 'tags', 'decidedAt', 'reviewOn', 'status', 'outcome', 'outcomeNote'];
        const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(c === 'tags' ? r.tags.join(';') : r[c])).join(','))].join('\n');
        return { raw: csv, type: 'text/csv; charset=utf-8', headers: { 'Content-Disposition': 'attachment; filename="hindsight.csv"' } };
      }
      return { body: rows, headers: { 'Content-Disposition': 'attachment; filename="hindsight.json"' } };
    }
    if (parts[0] !== 'decisions') throw new HttpError(404, 'Not found');
    if (parts.length === 1) {
      if (m === 'GET') return { body: store.list() };
      if (m === 'POST') {
        const r = validateDecision(await readJson(req));
        if (r.errors) throw new HttpError(422, 'Validation failed', r.errors);
        return { status: 201, body: store.create(r.value) };
      }
      throw new HttpError(405, 'Method not allowed');
    }
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id');
    const sub = parts[2];
    if (!sub) {
      if (m === 'GET') { const d = store.get(id); if (!d) throw new HttpError(404, 'Decision not found'); return { body: d }; }
      if (m === 'PUT') {
        const r = validateDecision(await readJson(req));
        if (r.errors) throw new HttpError(422, 'Validation failed', r.errors);
        const d = store.update(id, r.value); if (!d) throw new HttpError(404, 'Decision not found');
        return { body: d };
      }
      if (m === 'DELETE') { if (!store.remove(id)) throw new HttpError(404, 'Decision not found'); return { status: 204 }; }
    }
    if (sub === 'review' && m === 'POST') {
      const r = validateReview(await readJson(req));
      if (r.errors) throw new HttpError(422, 'Validation failed', r.errors);
      const d = store.review(id, r.value); if (!d) throw new HttpError(404, 'Decision not found');
      return { body: d };
    }
    if (sub === 'reopen' && m === 'POST') {
      const d = store.reopen(id); if (!d) throw new HttpError(404, 'Decision not found');
      return { body: d };
    }
    throw new HttpError(405, 'Method not allowed');
  }

  async function handler(req, res) {
    const send = (status, body, type = 'application/json; charset=utf-8', extra = {}) => {
      res.writeHead(status, { ...SEC_HEADERS, 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
      res.end(body);
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (password && url.pathname !== '/api/health') {
        const h = req.headers.authorization || '';
        const given = h.startsWith('Basic ') ? Buffer.from(h.slice(6), 'base64').toString() : '';
        if (!safeEq(given, `hindsight:${password}`))
          return send(401, 'Authentication required', 'text/plain', { 'WWW-Authenticate': 'Basic realm="Hindsight"' });
      }
      if (url.pathname.startsWith('/api/')) {
        const r = await api(req, url);
        if (r.raw !== undefined) return send(200, r.raw, r.type, r.headers);
        return send(r.status ?? 200, r.body === undefined ? '' : JSON.stringify(r.body), undefined, r.headers);
      }
      if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
      const rel = url.pathname === '/' ? 'index.html' : normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
      if (rel.includes('..')) throw new HttpError(404, 'Not found');
      try {
        const data = await readFile(join(PUBLIC, rel));
        return send(200, data, MIME[extname(rel)] || 'application/octet-stream');
      } catch { throw new HttpError(404, 'Not found'); }
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, JSON.stringify({ error: e.message, details: e.details }));
      console.error(e);
      return send(500, JSON.stringify({ error: 'Internal server error' }));
    }
  }
  return { server: createServer(handler), db };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/hindsight.db', password: process.env.ACCESS_PASSWORD || '' });
  server.listen(port, '0.0.0.0', () => console.log(`Hindsight listening on :${port}`));
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => server.close(() => process.exit(0)));
}
