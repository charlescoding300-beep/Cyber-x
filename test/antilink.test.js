'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')

function isolatedApp() {
  const dir = fs.mkdtempSync(path.join(ROOT, '.tmp-antilink-'))
  for (const file of [
    'commands/antilink.js',
    'lib/antilink.js',
    'lib/groupAdminNotice.js',
  ]) {
    const destination = path.join(dir, file)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(path.join(ROOT, file), destination)
  }
  fs.writeFileSync(path.join(dir, 'lib/userDb.js'), [
    "'use strict'",
    "const fs = require('node:fs')",
    "const path = require('node:path')",
    "const file = path.join(__dirname, '..', 'test-userdb.json')",
    "let data = {}",
    "try { data = JSON.parse(fs.readFileSync(file, 'utf8')) } catch {}",
    "function getSection(phone, name) { return data[phone]?.[name] }",
    "function setSection(phone, name, value) { data[phone] ||= {}; data[phone][name] = value; fs.writeFileSync(file, JSON.stringify(data)) }",
    "module.exports = { getSection, setSection }",
  ].join('\n'))
  return dir
}

function countAfterProcessRestart(appDir, phone, group, sender) {
  const enginePath = path.join(appDir, 'lib/antilink.js')
  const code = [
    `const engine = require(${JSON.stringify(enginePath)})`,
    `console.log('__WARN_COUNT__' + engine.getWarnCount(${JSON.stringify(phone)}, ${JSON.stringify(group)}, ${JSON.stringify(sender)}))`,
  ].join(';')
  const output = execFileSync(process.execPath, ['-e', code], {
    cwd: appDir,
    encoding: 'utf8',
  })
  const match = output.match(/__WARN_COUNT__(\d+)/)
  assert.ok(match, `restart process did not return a warning count: ${output}`)
  return Number(match[1])
}

function makeSocket(phone, state) {
  return {
    user: { id: `${phone}:1@s.whatsapp.net` },
    async groupMetadata() {
      return {
        participants: [
          { id: `${phone}@s.whatsapp.net`, admin: 'admin' },
          { id: `${state.sender}@s.whatsapp.net`, admin: null },
        ],
      }
    },
    async sendMessage(to, payload, options) {
      state.sent.push({ to, payload, options })
      if (payload.delete && state.deleteFails) throw new Error('mock delete failure')
      return { key: { remoteJid: to, id: `mock-${state.sent.length}` } }
    },
    async groupParticipantsUpdate(group, participants, action) {
      state.removals.push({ group, participants, action })
      if (state.removalFails) throw new Error('mock removal failure')
      return [{ jid: participants[0], status: 200 }]
    },
  }
}

function textReply(state) {
  return state.sent.find(item => typeof item.payload.text === 'string')
}

test('anti-link modes send separate quoted notices and warning counts survive process restarts', async () => {
  const appDir = isolatedApp()
  const phone = '999000000001'
  const group = '120363000000000001@g.us'
  const sender = '234800000001@s.whatsapp.net'
  const state = { sender: sender.split('@')[0], sent: [], removals: [], deleteFails: false, removalFails: false }
  try {
    const command = require(path.join(appDir, 'commands/antilink.js'))
    const engine = require(path.join(appDir, 'lib/antilink.js'))
    const sock = makeSocket(phone, state)
    engine.setConfig(phone, group, { enabled: false, action: 'warn' })
    const commandMessage = {
      key: { remoteJid: group, participant: sender, id: 'command-1' },
      message: { conversation: '.antilink on' },
    }

    await command.run({
      sock,
      from: group,
      msg: commandMessage,
      args: ['on'],
      isGroup: true,
      isAdmin: true,
      isBotAdmin: true,
    })
    assert.equal(engine.getConfig(phone, group).enabled, true)
    assert.equal(engine.getConfig(phone, group).action, 'delete')
    assert.equal(textReply(state).options.quoted, commandMessage)

    engine.setConfig(phone, group, {
      enabled: true,
      action: 'warn',
      maxWarns: 3,
      applyToAdmins: false,
    })

    for (let strike = 1; strike <= 3; strike++) {
      state.sent.length = 0
      const message = {
        key: { remoteJid: group, participant: sender, participantPn: sender, id: `link-${strike}` },
        message: { conversation: 'Please visit https://example.com' },
      }
      await engine.handleAntilinkInline(sock, message, phone)

      const reply = textReply(state)
      assert.ok(reply, `strike ${strike} should receive a notice`)
      assert.equal(state.sent.filter(item => typeof item.payload.text === 'string').length, 1)
      assert.equal(reply.options.quoted, message)
      assert.deepEqual(reply.payload.mentions, [sender])
      assert.match(reply.payload.text, new RegExp(`Warning ${strike}/3`))
      assert.match(reply.payload.text, /LINK WARNING/)
      assert.doesNotMatch(reply.payload.text, /LINK DELETED|LINK VIOLATION/)
      assert.equal(state.sent.filter(item => item.payload.delete).length, 0)
      assert.equal(state.removals.length, 0)
      if (strike === 1) {
        assert.equal(countAfterProcessRestart(appDir, phone, group, sender), 1)
      }
    }

    engine.setConfig(phone, group, { enabled: true, action: 'delete', maxWarns: 3, applyToAdmins: false })
    state.sent.length = 0
    const deleteMessage = {
      key: { remoteJid: group, participant: sender, participantPn: sender, id: 'link-delete-only' },
      message: { conversation: 'Please visit https://delete-only.example' },
    }
    await engine.handleAntilinkInline(sock, deleteMessage, phone)
    const deleteReply = textReply(state)
    assert.equal(deleteReply.options.quoted, deleteMessage)
    assert.match(deleteReply.payload.text, /LINK DELETED/)
    assert.doesNotMatch(deleteReply.payload.text, /LINK WARNING|LINK VIOLATION/)
    assert.equal(state.sent.filter(item => typeof item.payload.text === 'string').length, 1)

    const statusMessage = {
      key: { remoteJid: group, participant: sender, participantPn: sender, id: 'status-link-1' },
      message: {
        groupStatusMentionMessage: {
          message: { extendedTextMessage: { text: 'Group update: https://example.com/news' } },
        },
      },
    }
    assert.equal(engine.antilinkContainsStatusLink(statusMessage), true)
    state.sent.length = 0
    await engine.handleAntilinkInline(sock, statusMessage, phone)
    const statusReply = textReply(state)
    assert.ok(statusReply)
    assert.equal(statusReply.options.quoted, statusMessage)
    assert.deepEqual(statusReply.payload.mentions, [sender])
    assert.match(statusReply.payload.text, /LINK DELETED/)
    assert.match(statusReply.payload.text, /status share was removed from this group/)

    const previousAntiStatusCheck = global.__antistatusIsEnabled
    try {
      // When both protections are active, Anti-Status owns this event so the
      // same group post is not deleted twice or counted in two warning paths.
      global.__antistatusIsEnabled = () => true
      state.sent.length = 0
      await engine.handleAntilinkInline(sock, { ...statusMessage, key: { ...statusMessage.key, id: 'status-link-2' } }, phone)
      assert.equal(state.sent.length, 0)
    } finally {
      if (previousAntiStatusCheck === undefined) delete global.__antistatusIsEnabled
      else global.__antistatusIsEnabled = previousAntiStatusCheck
    }

    const failedDeleteSender = '234800000002@s.whatsapp.net'
    state.sender = failedDeleteSender.split('@')[0]
    state.sent.length = 0
    state.deleteFails = true
    const failedDelete = {
      key: { remoteJid: group, participant: failedDeleteSender, participantPn: failedDeleteSender, id: 'link-delete-failed' },
      message: { conversation: 'https://example.org' },
    }
    await engine.handleAntilinkInline(sock, failedDelete, phone)
    const failedReply = textReply(state)
    assert.equal(failedReply.options.quoted, failedDelete)
    assert.match(failedReply.payload.text, /LINK DELETE FAILED/)
    assert.doesNotMatch(failedReply.payload.text, /message was deleted/)
    assert.equal(state.sent.filter(item => typeof item.payload.text === 'string').length, 1)

    const failedRemovalSender = '234800000003@s.whatsapp.net'
    state.sender = failedRemovalSender.split('@')[0]
    state.sent.length = 0
    state.deleteFails = false
    state.removalFails = true
    engine.setConfig(phone, group, { enabled: true, action: 'delete', maxWarns: 3 })
    const failedRemoval = {
      key: { remoteJid: group, participant: failedRemovalSender, participantPn: failedRemovalSender, id: 'link-remove-failed' },
      message: { conversation: 'https://example.net' },
    }
    await engine.handleAntilinkInline(sock, failedRemoval, phone)
    const removalReply = textReply(state)
    assert.equal(removalReply.options.quoted, failedRemoval)
    assert.match(removalReply.payload.text, /LINK DELETED/)
    assert.doesNotMatch(removalReply.payload.text, /LINK VIOLATION/)
    assert.equal(state.removals.length, 0)

    engine.setConfig(phone, group, { enabled: true, action: 'kick', maxWarns: 3 })
    state.removalFails = true
    state.sent.length = 0
    const kickFailed = {
      key: { remoteJid: group, participant: failedRemovalSender, participantPn: failedRemovalSender, id: 'link-kick-failed' },
      message: { conversation: 'https://kick-failed.example' },
    }
    await engine.handleAntilinkInline(sock, kickFailed, phone)
    const kickReply = textReply(state)
    assert.equal(kickReply.options.quoted, kickFailed)
    assert.match(kickReply.payload.text, /LINK ACTION FAILED/)
    assert.doesNotMatch(kickReply.payload.text, /LINK DELETED|LINK VIOLATION/)
    assert.equal(state.sent.filter(item => typeof item.payload.text === 'string').length, 1)

    engine.resetWarn(phone, group, sender)
    assert.equal(countAfterProcessRestart(appDir, phone, group, sender), 0)
  } finally {
    const resolved = path.resolve(appDir)
    if (!resolved.startsWith(ROOT + path.sep) || !path.basename(resolved).startsWith('.tmp-antilink-')) {
      throw new Error(`Refusing to remove test directory outside workspace: ${resolved}`)
    }
    fs.rmSync(resolved, { recursive: true, force: true })
  }
})
