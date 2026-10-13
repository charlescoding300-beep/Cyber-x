'use strict'

const persistence = require('../database/persistence')
require('../lib/reminderScheduler')

const NAMESPACE = 'reminders'
const MAX_PER_USER = 10
const MAX_DELAY_MS = 30 * 24 * 60 * 60 * 1000
const formatDate = new Intl.DateTimeFormat('en-NG', { timeZone: process.env.BOT_TIME_ZONE || 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' })

function normalizePhone(value) {
  return String(value || '').split(':')[0].replace(/\D/g, '')
}

function parseDuration(value) {
  const match = String(value || '').match(/^(\d+)(s|m|h|d)$/i)
  if (!match) return null
  const amount = Number(match[1])
  const unit = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2].toLowerCase()]
  const duration = amount * unit
  return duration >= 60000 && duration <= MAX_DELAY_MS ? duration : null
}

function userReminders(phone, sender) {
  return persistence.list(NAMESPACE).flatMap(row => {
    try {
      const item = JSON.parse(row.data)
      return item.phone === phone && item.sender === sender ? [{ key: row.data_key, ...item }] : []
    } catch { return [] }
  }).sort((a, b) => a.dueAt - b.dueAt)
}

module.exports = {
  pattern: 'remind',
  alias: ['reminder'],
  category: 'utility',
  desc: 'Set, list, or cancel a reminder',
  usage: '.remind 10m Drink water | .remind list | .remind cancel <id>',
  parseDuration,
  run: async ({ sock, from, msg, text, sender }) => {
    const phone = normalizePhone(sock.user && sock.user.id)
    const who = sender || from
    const input = String(text || '').trim()

    if (/^list$/i.test(input)) {
      const items = userReminders(phone, who)
      if (!items.length) return sock.sendMessage(from, { text: 'You have no active reminders.', quoted: msg })
      const lines = items.map(item => item.id + ' - ' + formatDate.format(new Date(item.dueAt)) + ' - ' + item.message)
      return sock.sendMessage(from, { text: 'Your reminders:\n' + lines.join('\n'), quoted: msg })
    }

    const cancel = input.match(/^cancel\s+(\w+)/i)
    if (cancel) {
      const items = userReminders(phone, who)
      const item = items.find(entry => entry.id.startsWith(cancel[1]))
      if (!item) return sock.sendMessage(from, { text: 'I could not find that reminder ID. Use .remind list to see your IDs.', quoted: msg })
      persistence.remove(NAMESPACE, item.key)
      return sock.sendMessage(from, { text: 'Reminder ' + item.id + ' cancelled.', quoted: msg })
    }

    const match = input.match(/^(\S+)\s+([\s\S]+)$/)
    const delay = match && parseDuration(match[1])
    if (!match || !delay) {
      return sock.sendMessage(from, { text: 'Use .remind 10m Drink water. Units: s, m, h, d. Minimum 1 minute, maximum 30 days.\nUse .remind list or .remind cancel <id> to manage reminders.', quoted: msg })
    }
    if (!phone) return sock.sendMessage(from, { text: 'Could not identify this bot session. Try again later.', quoted: msg })
    const items = userReminders(phone, who)
    if (items.length >= MAX_PER_USER) return sock.sendMessage(from, { text: 'You already have 10 active reminders. Cancel one before adding another.', quoted: msg })

    const id = require('crypto').randomBytes(4).toString('hex')
    const dueAt = Date.now() + delay
    persistence.set(NAMESPACE, phone + ':' + id, {
      id, phone, chat: from, sender: who, message: match[2].trim(), dueAt
    })
    return sock.sendMessage(from, { text: 'Reminder set for ' + formatDate.format(new Date(dueAt)) + '. ID: ' + id, quoted: msg })
  }
}
