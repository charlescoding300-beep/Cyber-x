'use strict'

const persistence = require('../database/persistence')
const active = new Set()
const NAMESPACE = 'reminders'

async function deliverDue() {
  for (const row of persistence.list(NAMESPACE)) {
    let item
    try { item = JSON.parse(row.data) } catch { continue }
    if (!item || item.dueAt > Date.now() || active.has(row.data_key)) continue
    const state = global.__sessionStates && global.__sessionStates.get(item.phone)
    if (!state || !state.connected || !state.sock) continue
    active.add(row.data_key)
    try {
      const mention = item.chat.endsWith('@g.us') && item.sender ? [item.sender] : []
      const label = mention.length ? '@' + item.sender.split('@')[0] + ' ' : ''
      await state.sock.sendMessage(item.chat, {
        text: 'Reminder: ' + label + item.message,
        mentions: mention
      })
      persistence.remove(NAMESPACE, row.data_key)
    } catch (error) {
      console.error('[REMINDER] Delivery failed:', error.message)
    } finally {
      active.delete(row.data_key)
    }
  }
}

const timer = setInterval(() => deliverDue().catch(error => {
  console.error('[REMINDER] Scheduler error:', error.message)
}), 5000)
if (timer.unref) timer.unref()

module.exports = { deliverDue }
