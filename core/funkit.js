'use strict'
// ════════════════════════════════════════════════════════════════════
//  core/funkit.js — shared helpers for the fun commands
//  createBag(): every item is used once before any repeats; never the same item twice in a row.
// ════════════════════════════════════════════════════════════════════
const crypto = require('crypto')

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1)
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function createBag(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('createBag needs at least one item')
  let remaining = []
  let last
  return {
    size: items.length,
    next() {
      if (remaining.length === 0) {
        remaining = shuffle(items.slice())
        // avoid starting a new cycle with the item we just showed
        if (remaining.length > 1 && remaining[remaining.length - 1] === last) {
          ;[remaining[0], remaining[remaining.length - 1]] = [remaining[remaining.length - 1], remaining[0]]
        }
      }
      last = remaining.pop()
      return last
    },
  }
}

// one line of user text, safe to place inside a box
const cleanLine = (s, max = 160) =>
  String(s || '').replace(/\s+/g, ' ').trim().slice(0, max)

module.exports = { shuffle, createBag, cleanLine }
