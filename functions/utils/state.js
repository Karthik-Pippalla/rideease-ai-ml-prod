// utils/state.js
// Simple in-memory per-user state for registration and menus.
// Note: Ephemeral. For production durability, store in DB or Redis.

const map = new Map();

function key(tgId) {
  return String(tgId);
}

function get(tgId) {
  return map.get(key(tgId)) || null;
}

function set(tgId, value) {
  map.set(key(tgId), value);
}

function clear(tgId) {
  map.delete(key(tgId));
}

function clearAll() {
  map.clear();
}

function getSize() {
  return map.size;
}

function getAllKeys() {
  return Array.from(map.keys());
}

module.exports = { get, set, clear, clearAll, getSize, getAllKeys };
