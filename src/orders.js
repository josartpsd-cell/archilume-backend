const { nanoid } = require('nanoid');
const db = require('./db');

function createOrder({ email, plan, cycle }) {
  const id = nanoid(20);
  db.prepare(
    `INSERT INTO orders (id, email, plan, cycle, status) VALUES (?, ?, ?, ?, 'pending')`
  ).run(id, email, plan, cycle);
  return getOrder(id);
}

function getOrder(id) {
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
}

function findOrderByPreference(preferenceId) {
  return db.prepare('SELECT * FROM orders WHERE mp_preference_id = ?').get(preferenceId);
}

function setPreferenceId(id, preferenceId) {
  db.prepare('UPDATE orders SET mp_preference_id = ? WHERE id = ?').run(preferenceId, id);
}

function markPaid(id, { paymentId, licenseKey }) {
  db.prepare(
    `UPDATE orders SET status = 'paid', mp_payment_id = ?, license_key = ?, paid_at = datetime('now') WHERE id = ?`
  ).run(paymentId, licenseKey, id);
}

function markFailed(id, paymentId) {
  db.prepare(`UPDATE orders SET status = 'failed', mp_payment_id = ? WHERE id = ?`).run(paymentId, id);
}

function listOrders() {
  return db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 200').all();
}

module.exports = { createOrder, getOrder, findOrderByPreference, setPreferenceId, markPaid, markFailed, listOrders };
