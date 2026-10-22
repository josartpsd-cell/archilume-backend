const { nanoid } = require('nanoid');
const db = require('./db');
const { getPlan } = require('./plans');

class LicenseError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Chave no formato ARCH-XXXX-XXXX-XXXX (facil de digitar/ler, nanoid maiusculo)
function formatKey() {
  const raw = nanoid(12).toUpperCase().replace(/[^A-Z0-9]/g, 'X');
  return `ARCH-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

function generateLicense({ email, plan, notes }) {
  if (!getPlan(plan)) throw new LicenseError('invalid_plan', `Plano desconhecido: ${plan}`);
  if (!email) throw new LicenseError('missing_email', 'Email do cliente e obrigatorio');

  const key = formatKey();
  const periodStart = new Date().toISOString();
  db.prepare(
    `INSERT INTO licenses (key, email, plan, status, renders_used, period_start, notes)
     VALUES (?, ?, ?, 'active', 0, ?, ?)`
  ).run(key, email, plan, periodStart, notes || null);

  return getLicense(key);
}

function getLicense(key) {
  const row = db.prepare('SELECT * FROM licenses WHERE key = ?').get(key);
  if (!row) return null;
  return maybeResetPeriod(row);
}

// Se o plano renova todo mes e ja passou um mes desde period_start, zera o
// contador de uso e avança period_start - feito "sob demanda" (lazy), sem
// precisar de um cron rodando.
function maybeResetPeriod(license) {
  const plan = getPlan(license.plan);
  if (!plan || !plan.renewsMonthly) return license;

  const periodStart = new Date(license.period_start);
  const nextReset = new Date(periodStart);
  nextReset.setMonth(nextReset.getMonth() + 1);

  if (new Date() >= nextReset) {
    const newPeriodStart = new Date().toISOString();
    db.prepare('UPDATE licenses SET renders_used = 0, period_start = ? WHERE key = ?')
      .run(newPeriodStart, license.key);
    return { ...license, renders_used: 0, period_start: newPeriodStart };
  }
  return license;
}

function listLicenses() {
  const rows = db.prepare('SELECT * FROM licenses ORDER BY created_at DESC').all();
  return rows.map((row) => {
    const license = maybeResetPeriod(row);
    const plan = getPlan(license.plan);
    return {
      ...license,
      activeDevices: activations(license.key).length,
      rendersLimit: plan ? plan.rendersPerMonth : null,
      rendersRemaining: plan ? Math.max(plan.rendersPerMonth - license.renders_used, 0) : null
    };
  });
}

function activations(key) {
  return db.prepare('SELECT * FROM activations WHERE license_key = ?').all(key);
}

function activate(key, machineId) {
  const license = getLicense(key);
  if (!license) throw new LicenseError('not_found', 'Chave de licenca invalida.');
  if (license.status !== 'active') throw new LicenseError('inactive', `Licenca ${license.status}.`);

  const plan = getPlan(license.plan);
  const existing = activations(key);
  const alreadyActivatedHere = existing.some((a) => a.machine_id === machineId);

  if (!alreadyActivatedHere && existing.length >= plan.activationsLimit) {
    throw new LicenseError(
      'activation_limit',
      `Limite de ${plan.activationsLimit} ativacao(oes) simultaneas atingido para este plano.`
    );
  }

  db.prepare(
    `INSERT INTO activations (license_key, machine_id) VALUES (?, ?)
     ON CONFLICT(license_key, machine_id) DO UPDATE SET last_seen_at = datetime('now')`
  ).run(key, machineId);

  return { license, plan };
}

function deactivate(key, machineId) {
  db.prepare('DELETE FROM activations WHERE license_key = ? AND machine_id = ?').run(key, machineId);
}

function validate(key, machineId) {
  const license = getLicense(key);
  if (!license) throw new LicenseError('not_found', 'Chave de licenca invalida.');
  if (license.status !== 'active') throw new LicenseError('inactive', `Licenca ${license.status}.`);

  const isActivatedHere = activations(key).some((a) => a.machine_id === machineId);
  if (!isActivatedHere) throw new LicenseError('not_activated', 'Esta maquina nao esta ativada para esta licenca.');

  db.prepare("UPDATE activations SET last_seen_at = datetime('now') WHERE license_key = ? AND machine_id = ?")
    .run(key, machineId);

  const plan = getPlan(license.plan);
  return {
    license,
    plan,
    rendersRemaining: Math.max(plan.rendersPerMonth - license.renders_used, 0)
  };
}

function checkUsage(key) {
  const license = getLicense(key);
  if (!license) throw new LicenseError('not_found', 'Chave de licenca invalida.');
  const plan = getPlan(license.plan);
  return {
    plan: license.plan,
    rendersUsed: license.renders_used,
    rendersLimit: plan.rendersPerMonth,
    rendersRemaining: Math.max(plan.rendersPerMonth - license.renders_used, 0),
    periodStart: license.period_start
  };
}

function consumeUsage(key, { machineId, model, resolution } = {}) {
  const license = getLicense(key);
  if (!license) throw new LicenseError('not_found', 'Chave de licenca invalida.');
  if (license.status !== 'active') throw new LicenseError('inactive', `Licenca ${license.status}.`);

  const plan = getPlan(license.plan);
  const remaining = plan.rendersPerMonth - license.renders_used;
  if (remaining <= 0) {
    throw new LicenseError(
      'quota_exceeded',
      `Limite de ${plan.rendersPerMonth} renders do plano ${plan.label} atingido neste periodo.`
    );
  }

  db.prepare('UPDATE licenses SET renders_used = renders_used + 1 WHERE key = ?').run(key);
  db.prepare('INSERT INTO render_log (license_key, machine_id, model, resolution) VALUES (?, ?, ?, ?)')
    .run(key, machineId || null, model || null, resolution || null);

  return checkUsage(key);
}

// Revoga/reativa uma chave (admin) - nao apaga a linha do banco (preserva
// historico de uso e a referencia em orders.license_key), so bloqueia
// validacao/ativacao enquanto o status nao for 'active'.
function setStatus(key, status) {
  const license = getLicense(key);
  if (!license) throw new LicenseError('not_found', 'Chave de licenca invalida.');
  db.prepare('UPDATE licenses SET status = ? WHERE key = ?').run(status, key);
  return getLicense(key);
}

function revokeLicense(key) {
  return setStatus(key, 'revoked');
}

function reactivateLicense(key) {
  return setStatus(key, 'active');
}

module.exports = {
  LicenseError,
  generateLicense,
  getLicense,
  listLicenses,
  activate,
  deactivate,
  validate,
  checkUsage,
  consumeUsage,
  activations,
  revokeLicense,
  reactivateLicense
};
