"use strict";

const db = require("./database");

/*
 * ZEN X — CENTRAL VPS PERSISTENCE
 *
 * Source of truth:
 *   ./zenx.db (inside ~/zenx-bot/database/)
 *
 * All new persistent bot features should use this module.
 */

const getStmt = db.prepare(`
  SELECT data
  FROM app_data
  WHERE namespace = ? AND data_key = ?
`);

const setStmt = db.prepare(`
  INSERT INTO app_data (
    namespace,
    data_key,
    data,
    updated_at
  )
  VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(namespace, data_key)
  DO UPDATE SET
    data = excluded.data,
    updated_at = CURRENT_TIMESTAMP
`);

const deleteStmt = db.prepare(`
  DELETE FROM app_data
  WHERE namespace = ? AND data_key = ?
`);

const existsStmt = db.prepare(`
  SELECT 1
  FROM app_data
  WHERE namespace = ? AND data_key = ?
  LIMIT 1
`);

function get(namespace, key, fallback = null) {
  const row = getStmt.get(namespace, key);

  if (!row) return fallback;

  try {
    return JSON.parse(row.data);
  } catch (err) {
    console.error(
      `[PERSISTENCE] Invalid JSON: ${namespace}/${key}`,
      err
    );
    return fallback;
  }
}

function set(namespace, key, value) {
  const json = JSON.stringify(value);

  setStmt.run(namespace, key, json);

  return value;
}

function remove(namespace, key) {
  deleteStmt.run(namespace, key);
}

function has(namespace, key) {
  return !!existsStmt.get(namespace, key);
}

function update(namespace, key, updater, fallback = {}) {
  const current = get(namespace, key, fallback);
  const next = updater(current);

  set(namespace, key, next);

  return next;
}

function transaction(fn) {
  return db.transaction(fn)();
}

function list(namespace) {
  return db.prepare(`
    SELECT
      data_key,
      data,
      updated_at
    FROM app_data
    WHERE namespace = ?
    ORDER BY data_key
  `).all(namespace);
}

module.exports = {
  db,
  get,
  set,
  remove,
  has,
  update,
  transaction,
  list
};
