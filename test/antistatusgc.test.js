'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '..')
const indexSource = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8')
const storeStart = indexSource.indexOf('const ANTISTATUS_DIR =')
const storeEnd = indexSource.indexOf('async function handleAntistatusInline', storeStart)
assert.ok(storeStart >= 0 && storeEnd > storeStart, 'could not locate the production anti-status storage functions')
const storeSource = indexSource.slice(storeStart, storeEnd)

function makeStore(dataDir) {
  const context = {
    __dirname: dataDir,
    fs,
    path,
    process,
    console,
    antistatusCache: new Map(),
    cacheGet: (cache, key) => cache.get(key),
    cacheSet: (cache, key, value) => cache.set(key, value),
  }
  vm.runInNewContext(`${storeSource}\n;globalThis.__store = { enable: antistatusEnable, isEnabled: antistatusIsEnabled, getMode: antistatusGetMode, addWarning: antistatusAddWarning, resetWarnings: antistatusResetWarnings };`, context)
  return context.__store
}

function bindStore(store) {
  global.__antistatusEnable = store.enable
  global.__antistatusIsEnabled = store.isEnabled
  global.__antistatusGetMode = store.getMode
  global.__antistatusAddWarning = store.addWarning
  global.__antistatusResetWarnings = store.resetWarnings
}

function statusMessage(group, sender, id) {
  return {
    key: { remoteJid: group, participant: sender, participantPn: sender, id },
    message: { groupStatusMentionMessage: { message: { conversation: 'A group status update' } } },
  }
}

test('anti-status warning mode sends only a quoted warning and persists counts across store reloads', async () => {
  const dataDir = fs.mkdtempSync(path.join(ROOT, '.tmp-antistatus-'))
  const globals = [
    '__antistatusEnable', '__antistatusIsEnabled', '__antistatusGetMode',
    '__antistatusAddWarning', '__antistatusResetWarnings', '__sessionStates',
  ]
  const oldGlobals = new Map(globals.map(key => [key, global[key]]))

  try {
    const phone = '999000000101'
    const group = '120363000000000101@g.us'
    const sender = '234800000101@s.whatsapp.net'
    const bot = `${phone}:1@s.whatsapp.net`
    const modulePath = path.join(ROOT, 'lib/antistatusgc.js')
    delete require.cache[require.resolve(modulePath)]
    const { handleAntistatusGroup } = require(modulePath)
    const state = { sent: [], removals: [], deleteFails: false }
    const sock = {
      user: { id: bot },
      async groupMetadata() {
        return { participants: [
          { id: `${phone}@s.whatsapp.net`, admin: 'admin' },
          { id: sender, phoneNumber: sender, admin: null },
        ] }
      },
      async sendMessage(to, payload, options) {
        state.sent.push({ to, payload, options })
        if (payload.delete && state.deleteFails) throw new Error('mock revoke denied')
        return { key: { remoteJid: to, id: `reply-${state.sent.length}` } }
      },
      async groupParticipantsUpdate(groupJid, participants, action) {
        state.removals.push({ groupJid, participants, action })
        return [{ jid: participants[0], status: 200 }]
      },
    }

    let store = makeStore(dataDir)
    bindStore(store)
    store.enable(phone, group, 'warn')

    for (let count = 1; count <= 2; count++) {
      const msg = statusMessage(group, sender, `status-${count}`)
      state.sent.length = 0
      await handleAntistatusGroup(sock, msg, phone)
      const reply = state.sent.find(item => typeof item.payload.text === 'string')
      assert.ok(reply, `warning ${count} should produce a response`)
      assert.equal(state.sent.filter(item => typeof item.payload.text === 'string').length, 1)
      assert.equal(reply.options.quoted, msg)
      assert.deepEqual(reply.payload.mentions, [sender])
      assert.match(reply.payload.text, new RegExp(`STATUS WARNING[\\s\\S]*Warning ${count}\\/3`))
      assert.doesNotMatch(reply.payload.text, /STATUS REMOVED|STATUS VIOLATION/)
      assert.equal(state.sent.filter(item => item.payload.delete).length, 0)
    }

    // Recreate the storage module to simulate a process restart; warning 3
    // must continue from the local JSON file and remain warning-only.
    store = makeStore(dataDir)
    bindStore(store)
    const third = statusMessage(group, sender, 'status-3')
    state.sent.length = 0
    await handleAntistatusGroup(sock, third, phone)
    const warning3Reply = state.sent.find(item => typeof item.payload.text === 'string')
    assert.ok(warning3Reply)
    assert.equal(state.sent.filter(item => typeof item.payload.text === 'string').length, 1)
    assert.equal(warning3Reply.options.quoted, third)
    assert.ok(warning3Reply.payload.text.includes('STATUS WARNING'))
    assert.ok(warning3Reply.payload.text.includes('Warning 3/3'))
    assert.doesNotMatch(warning3Reply.payload.text, /STATUS REMOVED|STATUS VIOLATION/)
    assert.equal(state.sent.filter(item => item.payload.delete).length, 0)
    assert.equal(state.removals.length, 0)

    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'data', 'antistatus', `${phone}.json`), 'utf8'))
    assert.equal(saved.warnings[group][sender], 3)

    store.resetWarnings(phone, group, sender)
    assert.equal(store.addWarning(phone, group, sender), 1)

    store.enable(phone, group, 'delete')
    state.sent.length = 0
    state.deleteFails = true
    const failed = statusMessage(group, sender, 'status-delete-failed')
    await handleAntistatusGroup(sock, failed, phone)
    const failedReply = state.sent.find(item => typeof item.payload.text === 'string')
    assert.equal(failedReply.options.quoted, failed)
    assert.match(failedReply.payload.text, /STATUS DELETE FAILED/)
    assert.doesNotMatch(failedReply.payload.text, /STATUS REMOVED/)
    assert.equal(state.sent.filter(item => typeof item.payload.text === 'string').length, 1)

    state.deleteFails = false
    store.enable(phone, group, 'kick')
    state.sent.length = 0
    const kicked = statusMessage(group, sender, 'status-kick')
    await handleAntistatusGroup(sock, kicked, phone)
    const kickReply = state.sent.find(item => typeof item.payload.text === 'string')
    assert.ok(kickReply)
    assert.equal(kickReply.options.quoted, kicked)
    assert.match(kickReply.payload.text, /STATUS VIOLATION/)
    assert.doesNotMatch(kickReply.payload.text, /STATUS REMOVED|STATUS ACTION FAILED/)
    assert.equal(state.sent.filter(item => typeof item.payload.text === 'string').length, 1)
    assert.equal(state.removals.length, 1)
  } finally {
    for (const key of globals) {
      if (oldGlobals.get(key) === undefined) delete global[key]
      else global[key] = oldGlobals.get(key)
    }
    const resolved = path.resolve(dataDir)
    if (!resolved.startsWith(ROOT + path.sep) || !path.basename(resolved).startsWith('.tmp-antistatus-')) {
      throw new Error(`Refusing to remove test directory outside workspace: ${resolved}`)
    }
    fs.rmSync(resolved, { recursive: true, force: true })
  }
})
