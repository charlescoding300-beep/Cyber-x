"use strict";

const persistence = require("../database/persistence");

const NAMESPACE = "zenx";
const KEY = "autotag_groups";

function load() {
  const data = persistence.get(NAMESPACE, KEY, {});
  return data && typeof data === "object" && !Array.isArray(data)
    ? data
    : {};
}

function save(data) {
  persistence.set(NAMESPACE, KEY, data);
  return data;
}

function isEnabled(groupJid) {
  if (!groupJid) return false;
  return !!load()[groupJid];
}

function enable(groupJid) {
  if (!groupJid) return false;

  const data = load();
  data[groupJid] = true;
  save(data);

  return true;
}

function disable(groupJid) {
  if (!groupJid) return false;

  const data = load();
  delete data[groupJid];
  save(data);

  return true;
}

function list() {
  return Object.keys(load());
}

module.exports = {
  isEnabled,
  enable,
  disable,
  list,
};
