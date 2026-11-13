'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

/**
 * Schema migrations. Append only — never edit a shipped migration.
 * Money is stored as integer cents; timestamps as ISO-8601 UTC strings.
 */
const MIGRATIONS = [`
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('admin','portal')),
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE inquiries (
  id INTEGER PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'project' CHECK (kind IN ('project','contact')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewing','quoted','won','lost','archived')),
  brand_name TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  garment_category TEXT NOT NULL DEFAULT '',
  package_interest TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  measurements TEXT NOT NULL DEFAULT '',
  fabric_preferences TEXT NOT NULL DEFAULT '',
  budget TEXT NOT NULL DEFAULT '',
  timeline TEXT NOT NULL DEFAULT '',
  deliverables TEXT NOT NULL DEFAULT '[]',
  triage TEXT,
  triage_source TEXT,
  internal_notes TEXT NOT NULL DEFAULT '',
  consent_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE clients (
  id INTEGER PRIMARY KEY,
  brand_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT NOT NULL DEFAULT '',
  portal_key_hash TEXT,
  portal_key_issued_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  inquiry_id INTEGER REFERENCES inquiries(id),
  name TEXT NOT NULL,
  package TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'scoping'
    CHECK (status IN ('scoping','awaiting_deposit','active','delivered','closed','cancelled')),
  brief TEXT NOT NULL DEFAULT '',
  brief_status TEXT NOT NULL DEFAULT 'none' CHECK (brief_status IN ('none','draft','approved')),
  brief_source TEXT,
  due_date TEXT,
  started_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE quotes (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','declined','superseded')),
  scope TEXT NOT NULL DEFAULT '',
  line_items TEXT NOT NULL DEFAULT '[]',
  total_cents INTEGER NOT NULL DEFAULT 0,
  deposit_percent INTEGER NOT NULL DEFAULT 50,
  deposit_cents INTEGER NOT NULL DEFAULT 0,
  terms TEXT NOT NULL DEFAULT '',
  valid_until TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  responded_at TEXT,
  accepted_name TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE contractors (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  discipline TEXT NOT NULL DEFAULT '',
  hourly_rate_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  milestone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('proposed','todo','doing','review','done')),
  contractor_id INTEGER REFERENCES contractors(id),
  due_date TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE TABLE files (
  id INTEGER PRIMARY KEY,
  inquiry_id INTEGER REFERENCES inquiries(id),
  project_id INTEGER REFERENCES projects(id),
  kind TEXT NOT NULL CHECK (kind IN ('reference','working','deliverable')),
  label TEXT NOT NULL DEFAULT '',
  storage_name TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE deliverables (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'other',
  stage TEXT NOT NULL DEFAULT 'final' CHECK (stage IN ('preview','final')),
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress','in_review','approved','released')),
  version INTEGER NOT NULL DEFAULT 0,
  file_id INTEGER REFERENCES files(id),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','index_v3','form')),
  notes TEXT NOT NULL DEFAULT '',
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  released_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE revisions (
  id INTEGER PRIMARY KEY,
  deliverable_id INTEGER NOT NULL REFERENCES deliverables(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  requested_by TEXT NOT NULL,
  notes TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE TABLE invoices (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  quote_id INTEGER REFERENCES quotes(id),
  kind TEXT NOT NULL CHECK (kind IN ('deposit','final','other')),
  description TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','paid','void')),
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE checkout_sessions (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  provider TEXT NOT NULL,
  session_id TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','expired')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  provider TEXT NOT NULL,
  provider_ref TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'succeeded' CHECK (status IN ('succeeded','duplicate','mismatch')),
  note TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL
);
CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at TEXT NOT NULL
);
CREATE TABLE costs (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  contractor_id INTEGER REFERENCES contractors(id),
  description TEXT NOT NULL,
  hours REAL,
  amount_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE status_updates (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  source TEXT NOT NULL DEFAULT 'manual',
  approved_by INTEGER REFERENCES users(id),
  published_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE integration_jobs (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  product TEXT NOT NULL CHECK (product IN ('index_v3','form')),
  mode TEXT NOT NULL CHECK (mode IN ('manual','api')),
  job_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('needs_human','queued','running','completed','failed','cancelled')),
  external_id TEXT,
  request TEXT NOT NULL DEFAULT '{}',
  result TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL DEFAULT '',
  entity_id INTEGER,
  project_id INTEGER,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_inquiries_status ON inquiries(status, created_at);
CREATE INDEX idx_files_project ON files(project_id);
CREATE INDEX idx_files_inquiry ON files(inquiry_id);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_invoices_project ON invoices(project_id);
CREATE INDEX idx_audit_project ON audit_log(project_id, id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);
`];

function openDb(config) {
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(config.dataDir, 'sunday-division.sqlite');
  const sqlite = new DatabaseSync(file);
  try { fs.chmodSync(file, 0o600); } catch { /* best effort on non-POSIX */ }
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

  const statements = new Map();
  const prep = (sql) => {
    let s = statements.get(sql);
    if (!s) { s = sqlite.prepare(sql); statements.set(sql, s); }
    return s;
  };
  const db = {
    file,
    run: (sql, ...params) => prep(sql).run(...params),
    get: (sql, ...params) => prep(sql).get(...params),
    all: (sql, ...params) => prep(sql).all(...params),
    insert: (table, row) => {
      const cols = Object.keys(row);
      const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
      return Number(prep(sql).run(...cols.map((c) => row[c])).lastInsertRowid);
    },
    update: (table, id, row) => {
      const cols = Object.keys(row);
      prep(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => row[c]), id);
    },
    /** Run fn inside a transaction; nested calls join the outer transaction. */
    tx: (fn) => {
      if (db._inTx) return fn();
      sqlite.exec('BEGIN IMMEDIATE');
      db._inTx = true;
      try {
        const result = fn();
        sqlite.exec('COMMIT');
        return result;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      } finally {
        db._inTx = false;
      }
    },
    close: () => { statements.clear(); sqlite.close(); },
  };

  const { user_version: version } = sqlite.prepare('PRAGMA user_version').get();
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.tx(() => sqlite.exec(MIGRATIONS[v]));
    sqlite.exec(`PRAGMA user_version = ${v + 1}`);
  }
  return db;
}

module.exports = { openDb };
