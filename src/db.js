const { createClient } = require('@libsql/client/web');

// Banco no Turso (SQLite na nuvem). O disco do Render gratis e apagado a cada
// reinicio, e o data.sqlite que ficava na pasta do servidor levava junto todas
// as licencas - inclusive as pagas. O cliente "web" fala por HTTP, sem modulo
// nativo para compilar.
// Valor colado no painel do Render com aspas em volta fazia o Turso responder
// HTTP 400 e o servidor nao subia.
const limpa = (v) => (v || '').trim().replace(/^["']+|["']+$/g, '');
const url = limpa(process.env.TURSO_DATABASE_URL);
if (!url) throw new Error('TURSO_DATABASE_URL nao configurado no .env do backend.');
const client = createClient({ url, authToken: limpa(process.env.TURSO_AUTH_TOKEN) });

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS licenses (
    key TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    plan TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', -- active | suspended | revoked
    renders_used INTEGER NOT NULL DEFAULT 0,
    period_start TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    notes TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS activations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_key TEXT NOT NULL,
    machine_id TEXT NOT NULL,
    activated_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(license_key, machine_id),
    FOREIGN KEY (license_key) REFERENCES licenses(key)
  )`,
  `CREATE TABLE IF NOT EXISTS render_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_key TEXT NOT NULL,
    machine_id TEXT,
    model TEXT,
    resolution TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
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
  )`
];

// Cria as tabelas uma vez. Se o Turso falhar (credencial errada, rede), o
// servidor continua de pe com uma mensagem clara no log e tenta de novo na
// proxima consulta, em vez de cair e ficar reiniciando sem dizer o motivo.
let ready = null;
function init() {
  if (!ready) {
    ready = client.batch(SCHEMA, 'write').catch((err) => {
      ready = null;
      console.error(`[db] Nao foi possivel conectar no Turso: ${err.message}. Confira TURSO_DATABASE_URL e TURSO_AUTH_TOKEN no painel do Render.`);
      throw err;
    });
  }
  return ready;
}
init().catch(() => {});

// Linhas como objeto simples ({coluna: valor}), do jeito que o node:sqlite devolvia.
function toObjects(rs) {
  return rs.rows.map((row) => Object.fromEntries(rs.columns.map((col, i) => [col, row[i]])));
}

async function all(sql, ...args) {
  await init();
  return toObjects(await client.execute({ sql, args }));
}

async function get(sql, ...args) {
  return (await all(sql, ...args))[0];
}

async function run(sql, ...args) {
  await init();
  return client.execute({ sql, args });
}

module.exports = { all, get, run, init, client };
