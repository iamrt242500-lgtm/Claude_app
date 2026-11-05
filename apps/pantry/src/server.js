import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { parseIngredient, renderIngredient, aggregate, SYSTEMS } from './food.js';

const SRC = dirname(fileURLToPath(import.meta.url)), PUBLIC = join(SRC, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" };
class HttpError extends Error { constructor(s, m, d) { super(m); this.status = s; this.details = d; } }
const isDate = (s) => { if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const t = Date.parse(s + 'T00:00:00Z'); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s; };
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const mondayOf = (d) => addDays(d, -((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7));
const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];

function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec(`BEGIN;
    CREATE TABLE recipes(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100), servings INTEGER NOT NULL CHECK(servings BETWEEN 1 AND 100), ingredients TEXT NOT NULL, steps TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT(datetime('now')));
    CREATE TABLE plan(id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, meal TEXT NOT NULL CHECK(meal IN ('breakfast','lunch','dinner','snack')), recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE, servings INTEGER NOT NULL CHECK(servings BETWEEN 1 AND 100));
    CREATE INDEX idx_plan_day ON plan(day);
    CREATE TABLE checks(week TEXT NOT NULL, item TEXT NOT NULL, PRIMARY KEY(week, item)) WITHOUT ROWID;
    PRAGMA user_version=1; COMMIT;`);
  return db;
}
async function readBody(req) {
  let n = 0; const c = [];
  for await (const x of req) { n += x.length; if (n > 100_000) throw new HttpError(413, 'Payload too large'); c.push(x); }
  if (!c.length) return {};
  try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}
function recipeIn(b) {
  const d = {}, title = typeof b.title === 'string' ? b.title.trim() : '';
  if (!title) d.title = 'Title is required'; else if (title.length > 100) d.title = 'Title must be ≤ 100 characters';
  const servings = Number(b.servings); if (!Number.isInteger(servings) || servings < 1 || servings > 100) d.servings = 'Servings must be a whole number from 1 to 100';
  const lines = (Array.isArray(b.ingredients) ? b.ingredients : String(b.ingredients ?? '').split('\n')).map((l) => String(l).trim()).filter(Boolean);
  if (!lines.length) d.ingredients = 'Add at least one ingredient'; else if (lines.length > 80) d.ingredients = 'At most 80 ingredients'; else if (lines.some((l) => l.length > 200)) d.ingredients = 'Each ingredient must be ≤ 200 characters';
  const steps = typeof b.steps === 'string' ? b.steps.trim() : ''; if (steps.length > 8000) d.steps = 'Steps are too long (max 8000 characters)';
  if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d);
  return { title, servings, ingredients: lines, steps };
}

export function createApp({ dbPath = ':memory:' } = {}) {
  const db = openDb(dbPath), q = (s) => db.prepare(s);
  const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const rec404 = (id) => { const r = q('SELECT * FROM recipes WHERE id=?').get(id); if (!r) throw new HttpError(404, 'Recipe not found'); return r; };
  const dto = (r, { servings = r.servings, system = 'original' } = {}) => {
    const factor = servings / r.servings, lines = JSON.parse(r.ingredients);
    return { id: r.id, title: r.title, servings: r.servings, steps: r.steps, ingredients: lines, view: { servings, factor, system, ingredients: lines.map((l) => renderIngredient(parseIngredient(l), factor, system)) } };
  };
  const viewOpts = (sp, r) => {
    const system = sp.get('system') ?? 'original'; if (!SYSTEMS.includes(system)) throw new HttpError(422, 'Validation failed', { system: 'system must be original, metric or us' });
    let servings = r.servings; if (sp.get('servings') != null) { servings = Number(sp.get('servings')); if (!Number.isInteger(servings) || servings < 1 || servings > 500) throw new HttpError(422, 'Validation failed', { servings: 'servings must be a whole number from 1 to 500' }); }
    return { servings, system };
  };

  function weekPlan(week) {
    return q('SELECT p.id, p.day, p.meal, p.servings, p.recipe_id recipeId, r.title FROM plan p JOIN recipes r ON r.id = p.recipe_id WHERE p.day >= ? AND p.day <= ? ORDER BY p.day, CASE p.meal WHEN \'breakfast\' THEN 0 WHEN \'lunch\' THEN 1 WHEN \'dinner\' THEN 2 ELSE 3 END, p.id').all(week, addDays(week, 6));
  }
  function shopping(week, system) {
    const items = [];
    for (const p of weekPlan(week)) { const r = rec404(p.recipeId), factor = p.servings / r.servings; for (const l of JSON.parse(r.ingredients)) { const ing = parseIngredient(l); items.push({ name: ing.name, qty: ing.qty && { min: ing.qty.min * factor, max: ing.qty.max * factor }, unit: ing.unit }); } }
    const checked = new Set(q('SELECT item FROM checks WHERE week=?').all(week).map((r) => r.item));
    return aggregate(items, system).map((x) => ({ ...x, checked: checked.has(x.key) }));
  }
  const weekParam = (sp) => { const w = sp.get('week'); if (!isDate(w)) throw new HttpError(422, 'Validation failed', { week: 'week must be a valid YYYY-MM-DD date' }); return mondayOf(w); };

  async function api(req, url) {
    const p = url.pathname.split('/').filter(Boolean).slice(1), m = req.method, sp = url.searchParams;
    if (p[0] === 'health') return { body: { ok: true } };
    if (p[0] === 'recipes') {
      if (p.length === 1) {
        if (m === 'GET') { const t = (sp.get('q') || '').toLowerCase(); return { body: q('SELECT id, title, servings, ingredients FROM recipes ORDER BY title COLLATE NOCASE').all().filter((r) => !t || r.title.toLowerCase().includes(t) || r.ingredients.toLowerCase().includes(t)).map((r) => ({ id: r.id, title: r.title, servings: r.servings, ingredientCount: JSON.parse(r.ingredients).length })) }; }
        if (m === 'POST') { const v = recipeIn(await readBody(req)); const r = q('INSERT INTO recipes(title,servings,ingredients,steps) VALUES(?,?,?,?)').run(v.title, v.servings, JSON.stringify(v.ingredients), v.steps); return { status: 201, body: dto(rec404(Number(r.lastInsertRowid))) }; }
      } else {
        const id = Number(p[1]); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id'); const r = rec404(id);
        if (m === 'GET') return { body: dto(r, viewOpts(sp, r)) };
        if (m === 'PUT') { const v = recipeIn(await readBody(req)); q('UPDATE recipes SET title=?, servings=?, ingredients=?, steps=? WHERE id=?').run(v.title, v.servings, JSON.stringify(v.ingredients), v.steps, id); return { body: dto(rec404(id)) }; }
        if (m === 'DELETE') { q('DELETE FROM recipes WHERE id=?').run(id); return { status: 204 }; }
      }
    }
    if (p[0] === 'plan') {
      if (m === 'GET') { const week = weekParam(sp); return { body: { week, days: Array.from({ length: 7 }, (_, i) => addDays(week, i)), entries: weekPlan(week) } }; }
      if (m === 'POST') {
        const b = await readBody(req), d = {}; if (!isDate(b.day)) d.day = 'Invalid date'; if (!MEALS.includes(b.meal)) d.meal = 'meal must be breakfast, lunch, dinner or snack';
        const rec = Number.isInteger(b.recipeId) ? q('SELECT * FROM recipes WHERE id=?').get(b.recipeId) : null; if (!rec) d.recipeId = 'Choose a recipe';
        const servings = b.servings === undefined ? rec?.servings : b.servings; if (!Number.isInteger(servings) || servings < 1 || servings > 100) d.servings = 'Servings must be a whole number from 1 to 100';
        if (Object.keys(d).length) throw new HttpError(422, 'Validation failed', d);
        q('INSERT INTO plan(day,meal,recipe_id,servings) VALUES(?,?,?,?)').run(b.day, b.meal, rec.id, servings); return { status: 201, body: { week: mondayOf(b.day), entries: weekPlan(mondayOf(b.day)) } };
      }
      if (m === 'DELETE' && p.length === 2) { const id = Number(p[1]); const row = q('SELECT day FROM plan WHERE id=?').get(id); if (!row) throw new HttpError(404, 'Plan entry not found'); q('DELETE FROM plan WHERE id=?').run(id); return { status: 204 }; }
    }
    if (p[0] === 'shopping') {
      const week = weekParam(sp), system = sp.get('system') ?? 'metric'; if (!['metric', 'us'].includes(system)) throw new HttpError(422, 'Validation failed', { system: 'system must be metric or us' });
      if (m === 'GET') return { body: { week, system, items: shopping(week, system) } };
      if (m === 'POST' && p[1] === 'check') {
        const b = await readBody(req); if (typeof b.item !== 'string' || typeof b.checked !== 'boolean') throw new HttpError(422, 'Validation failed', { item: 'item (string) and checked (boolean) are required' });
        if (!shopping(week, system).some((x) => x.key === b.item)) throw new HttpError(404, 'Item is not on this week\'s list');
        if (b.checked) q('INSERT OR IGNORE INTO checks(week,item) VALUES(?,?)').run(week, b.item); else q('DELETE FROM checks WHERE week=? AND item=?').run(week, b.item);
        return { body: { week, system, items: shopping(week, system) } };
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
      if (rel === 'food.js') return send(200, await readFile(join(SRC, 'food.js')), MIME['.js']);
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
  const { server } = createApp({ dbPath: process.env.DB_PATH || './data/pantry.db' });
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => console.log(`Pantry listening on :${port}`));
}
