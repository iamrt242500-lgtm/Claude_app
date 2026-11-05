import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const MIGRATIONS = [
  `CREATE TABLE decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    context TEXT NOT NULL DEFAULT '',
    choice TEXT NOT NULL DEFAULT '',
    prediction TEXT NOT NULL,
    confidence INTEGER NOT NULL CHECK (confidence BETWEEN 50 AND 99),
    tags TEXT NOT NULL DEFAULT '[]',
    decided_at TEXT NOT NULL,
    review_on TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed')),
    outcome TEXT CHECK (outcome IN ('hit','partial','miss')),
    outcome_note TEXT NOT NULL DEFAULT '',
    reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_decisions_status_review ON decisions(status, review_on);`,
];

export function openDb(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try { db.exec(MIGRATIONS[v]); db.exec(`PRAGMA user_version = ${v + 1}`); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  return db;
}

const toDto = (r) => r && ({
  id: r.id, title: r.title, context: r.context, choice: r.choice, prediction: r.prediction,
  confidence: r.confidence, tags: JSON.parse(r.tags), decidedAt: r.decided_at, reviewOn: r.review_on,
  status: r.status, outcome: r.outcome, outcomeNote: r.outcome_note, reviewedAt: r.reviewed_at,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

export function repo(db) {
  const q = {
    get: db.prepare('SELECT * FROM decisions WHERE id = ?'),
    all: db.prepare('SELECT * FROM decisions ORDER BY decided_at DESC, id DESC'),
    insert: db.prepare(`INSERT INTO decisions (title, context, choice, prediction, confidence, tags, decided_at, review_on)
      VALUES (?,?,?,?,?,?,?,?)`),
    update: db.prepare(`UPDATE decisions SET title=?, context=?, choice=?, prediction=?, confidence=?, tags=?,
      decided_at=?, review_on=?, updated_at=datetime('now') WHERE id=?`),
    review: db.prepare(`UPDATE decisions SET status='reviewed', outcome=?, outcome_note=?, reviewed_at=datetime('now'),
      updated_at=datetime('now') WHERE id=?`),
    reopen: db.prepare(`UPDATE decisions SET status='open', outcome=NULL, outcome_note='', reviewed_at=NULL,
      updated_at=datetime('now') WHERE id=?`),
    del: db.prepare('DELETE FROM decisions WHERE id = ?'),
  };
  return {
    list: () => q.all.all().map(toDto),
    get: (id) => toDto(q.get.get(id)),
    create(v) {
      const r = q.insert.run(v.title, v.context, v.choice, v.prediction, v.confidence, JSON.stringify(v.tags), v.decidedAt, v.reviewOn);
      return toDto(q.get.get(Number(r.lastInsertRowid)));
    },
    update(id, v) {
      const r = q.update.run(v.title, v.context, v.choice, v.prediction, v.confidence, JSON.stringify(v.tags), v.decidedAt, v.reviewOn, id);
      return r.changes ? toDto(q.get.get(id)) : null;
    },
    review(id, v) { return q.review.run(v.outcome, v.outcomeNote, id).changes ? toDto(q.get.get(id)) : null; },
    reopen(id) { return q.reopen.run(id).changes ? toDto(q.get.get(id)) : null; },
    remove: (id) => q.del.run(id).changes > 0,
  };
}
