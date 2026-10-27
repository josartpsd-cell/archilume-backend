const { nanoid } = require('nanoid');
const db = require('./db');

async function createOrder({ email, plan, cycle }) {
  const id = nanoid(20);
  await db.run(`INSERT INTO orders (id, email, plan, cycle, status) VALUES (?, ?, ?, ?, 'pending')`, id, email, plan, cycle);
  return getOrder(id);
}

function getOrder(id) {
  return db.get('SELECT * FROM orders WHERE id = ?', id);
}

function findOrderByPreference(preferenceId) {
  return db.get('SELECT * FROM orders WHERE mp_preference_id = ?', preferenceId);
}

async function setPreferenceId(id, preferenceId) {
  await db.run('UPDATE orders SET mp_preference_id = ? WHERE id = ?', preferenceId, id);
}

async function markPaid(id, { paymentId, licenseKey }) {
  await db.run(
    `UPDATE orders SET status = 'paid', mp_payment_id = ?, license_key = ?, paid_at = datetime('now') WHERE id = ?`,
    paymentId, licenseKey, id
  );
}

async function markFailed(id, paymentId) {
  await db.run(`UPDATE orders SET status = 'failed', mp_payment_id = ? WHERE id = ?`, paymentId, id);
}

function listOrders() {
  return db.all('SELECT * FROM orders ORDER BY created_at DESC LIMIT 200');
}

module.exports = { createOrder, getOrder, findOrderByPreference, setPreferenceId, markPaid, markFailed, listOrders };
