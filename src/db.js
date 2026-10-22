const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// SQLite embutido no Node (22+), sem dependencia nativa pra compilar - evita
// precisar de Visual Studio Build Tools so pra rodar o backend localmente.
const dbPath = path.join(__dirname, '..', 'data.sqlite');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS licenses (
    key TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    plan TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', -- active | suspended | revoked
    renders_used INTEGER NOT NULL DEFAULT 0,
    period_start TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS activations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_key TEXT NOT NULL,
    machine_id TEXT NOT NULL,
    activated_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(license_key, machine_id),
    FOREIGN KEY (license_key) REFERENCES licenses(key)
  );

  CREATE TABLE IF NOT EXISTS render_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_key TEXT NOT NULL,
    machine_id TEXT,
    model TEXT,
    resolution TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    plan TEXT NOT NULL,
    cycle TEXT NOT NULL, -- monthly | annual
    status TEXT NOT NULL DEFAULT 'pending', -- pending | paid | failed
    mp_preference_id TEXT,
    mp_payment_id TEXT,
    license_key TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    paid_at TEXT
  );
`);

module.exports = db;
