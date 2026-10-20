'use strict'

// Track only presence events WhatsApp delivers for actual group participants.
// Subscriptions and state are socket-local and are discarded on reconnect.
const sockets = new WeakMap()
const GROUP_REFRESH_MS = 15_000
const MAX_INITIAL_WAIT_MS = 1_400
const QUIET_WINDOW_MS = 250
const SUBSCRIPTION_BATCH_SIZE = 16

function cleanJid(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const jid = raw.replace(/:\d+(?=@)/, '')
  if (jid.includes('@')) return jid.toLowerCase()
  const digits = jid.replace(/\D/g, '')
  return digits ? `${digits}@s.whatsapp.net` : ''
}

function createGroupState(id) {
  return {
    id,
    participants: new Map(), // mention JID -> display JID
    aliases: new Map(), // any PN/LID form -> mention JID
    online: new Set(),
    onlineCount: null,
    updatedAt: 0,
    hasMemberPresence: false,
    lastGroupSubscribeAt: 0,
    pendingRefresh: null,
    waiters: new Set(),
  }
}

function createSocketState(sock) {
  const state = {
    groups: new Map(),
    groupsByParticipant: new Map(),
    subscribed: new Set(),
    queued: new Set(),
    queue: [],
    draining: false,
  }
  sockets.set(sock, state)

  sock.ev.on('presence.update', update => {
    const updateId = cleanJid(update?.id)
    if (!updateId) return

    const groupIds = updateId.endsWith('@g.us')
      ? [updateId]
      : [...(state.groupsByParticipant.get(updateId) || [])]
    if (!groupIds.length) return

    for (const groupId of groupIds) {
      const group = state.groups.get(groupId)
      if (!group) continue
      const isGroupUpdate = updateId === groupId

      for (const [rawJid, presence] of Object.entries(update.presences || {})) {
        if (!rawJid || !presence) continue

        if (presence.groupOnlineCount != null) {
          const count = Number(presence.groupOnlineCount)
          if (Number.isFinite(count) && count >= 0) {
            group.onlineCount = count
            if (count === 0) group.online.clear()
          }
        }

        const participantAlias = cleanJid(rawJid)
        // Group-level count events can use the group JID as their only key.
        // Never turn that aggregate record into a fake member mention.
        if (!participantAlias || participantAlias === groupId || participantAlias.endsWith('@g.us')) continue

        const mentionJid = group.aliases.get(participantAlias) ||
          (!isGroupUpdate ? group.aliases.get(updateId) : null)
        if (!mentionJid) continue

        const status = presence.lastKnownPresence
        if (status === 'unavailable') {
          group.online.delete(mentionJid)
        } else if (['available', 'composing', 'recording', 'paused'].includes(status)) {
          group.online.add(mentionJid)
        } else {
          continue
        }
        group.hasMemberPresence = true
      }

      group.updatedAt = Date.now()
      for (const notify of group.waiters) notify()
    }
  })

  return state
}

function getSocketState(sock) {
  return sockets.get(sock) || createSocketState(sock)
}

function waitForPresence(group) {
  return new Promise(resolve => {
    let quietTimer
    let finished = false
    const maxTimer = setTimeout(finish, MAX_INITIAL_WAIT_MS)

    function finish() {
      if (finished) return
      finished = true
      clearTimeout(maxTimer)
      clearTimeout(quietTimer)
      group.waiters.delete(notify)
      resolve()
    }

    function notify() {
      clearTimeout(quietTimer)
      quietTimer = setTimeout(finish, QUIET_WINDOW_MS)
    }

    group.waiters.add(notify)
  })
}

function addGroupParticipants(state, group, participants, sock) {
  // Rebuild aliases from the current metadata snapshot so removed members
  // cannot remain in the output or receive an old cached presence state.
  for (const alias of group.aliases.keys()) {
    const groups = state.groupsByParticipant.get(alias)
    groups?.delete(group.id)
    if (!groups?.size) state.groupsByParticipant.delete(alias)
  }
  group.aliases.clear()
  group.participants.clear()
  const remainingOnline = new Set()
  const own = new Set([sock.user?.id, sock.user?.lid, sock.user?.phoneNumber].map(cleanJid).filter(Boolean))
  const subscribeJids = new Set()

  for (const participant of participants) {
    if (!participant || typeof participant !== 'object') continue
    const rawIds = [participant.id, participant.jid, participant.lid, participant.phoneNumber]
      .map(cleanJid)
      .filter(Boolean)
    const mentionJid = rawIds[0]
    if (!mentionJid || rawIds.some(id => own.has(id))) continue

    const displayJid = cleanJid(participant.phoneNumber) || mentionJid
    group.participants.set(mentionJid, displayJid)
    for (const alias of rawIds) {
      group.aliases.set(alias, mentionJid)
      let groups = state.groupsByParticipant.get(alias)
      if (!groups) state.groupsByParticipant.set(alias, groups = new Set())
      groups.add(group.id)
    }
    if (group.online.has(mentionJid)) remainingOnline.add(mentionJid)
    subscribeJids.add(mentionJid)
  }

  group.online = remainingOnline
  return [...subscribeJids]
}

function queueParticipantSubscriptions(sock, state, jids) {
  let added = 0
  for (const jid of jids) {
    if (!jid || state.subscribed.has(jid) || state.queued.has(jid)) continue
    state.queued.add(jid)
    state.queue.push(jid)
    added++
  }
  if (!added || state.draining || typeof sock.presenceSubscribe !== 'function') return added

  state.draining = true
  void (async () => {
    try {
      while (state.queue.length) {
        const batch = state.queue.splice(0, SUBSCRIPTION_BATCH_SIZE)
        await Promise.all(batch.map(async jid => {
          try {
            await sock.presenceSubscribe(jid)
            state.subscribed.add(jid)
          } catch {
            // Failed subscriptions can be retried on the next command.
          } finally {
            state.queued.delete(jid)
          }
        }))
        await new Promise(resolve => setImmediate(resolve))
      }
    } finally {
      state.draining = false
      if (state.queue.length) queueParticipantSubscriptions(sock, state, [])
    }
  })().catch(() => { state.draining = false })
  return added
}

async function getGroupPresence(sock, groupJid, participants = []) {
  const state = getSocketState(sock)
  let group = state.groups.get(groupJid)
  if (!group) {
    group = createGroupState(groupJid)
    state.groups.set(groupJid, group)
  }

  const newSubscriptions = addGroupParticipants(state, group, participants, sock)
  const now = Date.now()
  const refreshGroup = now - group.lastGroupSubscribeAt >= GROUP_REFRESH_MS
  if (!group.pendingRefresh && (refreshGroup || newSubscriptions.length > 0)) {
    group.pendingRefresh = waitForPresence(group)
      .finally(() => { group.pendingRefresh = null })

    if (refreshGroup && typeof sock.presenceSubscribe === 'function') {
      group.lastGroupSubscribeAt = now
      Promise.resolve()
        .then(() => sock.presenceSubscribe(groupJid))
        .catch(() => {})
    }
    queueParticipantSubscriptions(sock, state, newSubscriptions)
  }

  if (group.pendingRefresh) await group.pendingRefresh

  const members = [...group.online]
    .filter(jid => group.participants.has(jid))
    .map(jid => ({ jid, displayJid: group.participants.get(jid) }))
  return {
    onlineCount: group.onlineCount ?? members.length,
    countFromWhatsApp: group.onlineCount !== null,
    members,
    hasPresenceData: group.updatedAt > 0,
    hasMemberPresence: group.hasMemberPresence,
  }
}

module.exports = { getGroupPresence }
