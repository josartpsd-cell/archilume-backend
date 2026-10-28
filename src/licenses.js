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

async function generateLicense({ email, plan, notes }) {
  if (!getPlan(plan)) throw new LicenseError('invalid_plan', `Plano desconhecido: ${plan}`);
  if (!email) throw new LicenseError('missing_email', 'Email do cliente e obrigatorio');

  const key = formatKey();
  const periodStart = new Date().toISOString();
  await db.run(
    `INSERT INTO licenses (key, email, plan, status, renders_used, period_start, notes)
     VALUES (?, ?, ?, 'active', 0, ?, ?)`,
    key, email, plan, periodStart, notes || null
  );

  return getLicense(key);
}

async function getLicense(key) {
  const row = await db.get('SELECT * FROM licenses WHERE key = ?', key);
  if (!row) return null;
  return maybeResetPeriod(row);
}

// Se o plano renova todo mes e ja passou um mes desde period_start, zera o
// contador de uso e avança period_start - feito "sob demanda" (lazy), sem
// precisar de um cron rodando.
async function maybeResetPeriod(license) {
  const plan = getPlan(license.plan);
  if (!plan || !plan.renewsMonthly) return license;

  const periodStart = new Date(license.period_start);
  const nextReset = new Date(periodStart);
  nextReset.setMonth(nextReset.getMonth() + 1);

  if (new Date() >= nextReset) {
    const newPeriodStart = new Date().toISOString();
    await db.run('UPDATE licenses SET renders_used = 0, period_start = ? WHERE key = ?', newPeriodStart, license.key);
    return { ...license, renders_used: 0, period_start: newPeriodStart };
  }
  return license;
}

async function listLicenses() {
  // Contagem de ativacoes na mesma consulta: com o banco remoto, uma consulta
  // por licenca deixaria o painel lento.
  const rows = await db.all(
    `SELECT l.*, (SELECT COUNT(*) FROM activations a WHERE a.license_key = l.key) AS active_devices
     FROM licenses l ORDER BY l.created_at DESC`
  );
  return Promise.all(rows.map(async ({ active_devices: activeDevices, ...row }) => {
    const license = await maybeResetPeriod(row);
    const plan = getPlan(license.plan);
    return {
      ...license,
      activeDevices,
      rendersLimit: plan ? plan.rendersPerMonth : null,
      rendersRemaining: plan ? Math.max(plan.rendersPerMonth - license.renders_used, 0) : null
    };
  }));
}

function activations(key) {
  return db.all('SELECT * FROM activations WHERE license_key = ?', key);
}

async function activate(key, machineId) {
  const license = await getLicense(key);
  if (!license) throw new LicenseError('not_found', 'Chave de licenca invalida.');
  if (license.status !== 'active') throw new LicenseError('inactive', `Licenca ${license.status}.`);

  const plan = getPlan(license.plan);
  const existing = await activations(key);
  const alreadyActivatedHere = existing.some((a) => a.machine_id === machineId);

  if (!alreadyActivatedHere && existing.length >= plan.activationsLimit) {
    const limite = plan.activationsLimit === 1 ? '1 computador' : `${plan.activationsLimit} computadores`;
    throw new LicenseError(
      'activation_limit',
      `Esta chave ja esta ativada em outro computador (o plano ${plan.label} permite ${limite}). Fale com o suporte para liberar.`
    );
  }

  await db.run(
    `INSERT INTO activations (license_key, machine_id) VALUES (?, ?)
     ON CONFLICT(license_key, machine_id) DO UPDATE SET last_seen_at = datetime('now')`,
    key, machineId
  );

  return { license, plan };
}

async function deactivate(key, machineId) {
  await db.run('DELETE FROM activations WHERE license_key = ? AND machine_id = ?', key, machineId);
}

async function validate(key, machineId) {
  const license = await getLicense(key);
  if (!license) throw new LicenseError('not_found', 'Chave de licenca invalida.');
  if (license.status !== 'active') throw new LicenseError('inactive', `Licenca ${license.status}.`);

  // O plugin so ativa ao clicar em Salvar nas configuracoes; quem reabria o
  // painel com a chave ja salva via "maquina nao ativada". Se ainda houver
  // vaga no plano, ativa aqui mesmo; se nao houver, activate() explica o limite.
  const isActivatedHere = (await activations(key)).some((a) => a.machine_id === machineId);
  if (!isActivatedHere) await activate(key, machineId);

  await db.run("UPDATE activations SET last_seen_at = datetime('now') WHERE license_key = ? AND machine_id = ?", key, machineId);

  const plan = getPlan(license.plan);
  return {
    license,
    plan,
    rendersRemaining: Math.max(plan.rendersPerMonth - license.renders_used, 0)
  };
}

async function checkUsage(key) {
  const license = await getLicense(key);
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

async function consumeUsage(key, { machineId, model, resolution } = {}) {
  const license = await getLicense(key);
  if (!license) throw new LicenseError('not_found', 'Chave de licenca invalida.');
  if (license.status !== 'active') throw new LicenseError('inactive', `Licenca ${license.status}.`);

  // Confere e soma numa operacao so: dois renders ao mesmo tempo nao passam do limite.
  const plan = getPlan(license.plan);
  const result = await db.run(
    'UPDATE licenses SET renders_used = renders_used + 1 WHERE key = ? AND renders_used < ?',
    key, plan.rendersPerMonth
  );
  if (result.rowsAffected === 0) {
    throw new LicenseError(
      'quota_exceeded',
      `Limite de ${plan.rendersPerMonth} renders do plano ${plan.label} atingido neste periodo.`
    );
  }
  await db.run(
    'INSERT INTO render_log (license_key, machine_id, model, resolution) VALUES (?, ?, ?, ?)',
    key, machineId || null, model || null, resolution || null
  );

  return checkUsage(key);
}

// Revoga/reativa uma chave (admin) - nao apaga a linha do banco (preserva
// historico de uso e a referencia em orders.license_key), so bloqueia
// validacao/ativacao enquanto o status nao for 'active'.
async function setStatus(key, status) {
  const license = await getLicense(key);
  if (!license) throw new LicenseError('not_found', 'Chave de licenca invalida.');
  await db.run('UPDATE licenses SET status = ? WHERE key = ?', status, key);
  return getLicense(key);
}

// Libera as vagas de computador da chave (cliente trocou de PC, ou a chave foi
// testada em outra maquina). O proximo computador que abrir o plugin ativa sozinho.
async function releaseMachines(key) {
  const license = await getLicense(key);
  if (!license) throw new LicenseError('not_found', 'Chave de licenca invalida.');
  await db.run('DELETE FROM activations WHERE license_key = ?', key);
  return license;
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
  reactivateLicense,
  releaseMachines
};
