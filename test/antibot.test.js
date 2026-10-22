'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')

function isolatedApp() {
  const dir = fs.mkdtempSync(path.join(ROOT, '.tmp-antibot-'))
  for (const file of ['lib/antibot.js', 'lib/groupAdminNotice.js']) {
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
  const enginePath = path.join(appDir, 'lib/antibot.js')
  const code = [
    `const engine = require(${JSON.stringify(enginePath)})`,
    `const state = engine.getGroupState(${JSON.stringify(phone)}, ${JSON.stringify(group)})`,
    `console.log('__WARN_COUNT__' + (state.warnings[${JSON.stringify(sender.split('@')[0])}] || 0))`,
  ].join(';')
  const output = execFileSync(process.execPath, ['-e', code], {
    cwd: appDir,
    encoding: 'utf8',
  })
  const match = output.match(/__WARN_COUNT__(\d+)/)
  assert.ok(match, `restart process did not return a warning count: ${output}`)
  return Number(match[1])
}

function makeMessage(group, sender, id) {
  return {
    key: { remoteJid: group, participant: sender, id },
    message: { conversation: `ordinary message ${id}` },
  }
}

function makeSocket(phone, sender, botAdmin, state) {
  return {
    user: { id: `${phone}:1@s.whatsapp.net` },
    async groupMetadata() {
      return { subject: 'Test group', participants: [
        { id: `${phone}@s.whatsapp.net`, admin: botAdmin ? 'admin' : null },
        { id: sender, admin: null },
      ] }
    },
    async sendMessage(to, payload, options) {
      state.sent.push({ to, payload, options })
      return { key: { remoteJid: to, id: `response-${state.sent.length}` } }
    },
    async groupParticipantsUpdate(group, participants, action) {
      state.removals.push({ group, participants, action })
      return [{ jid: participants[0], status: 200 }]
    },
  }
}

async function sendBurst(engine, sock, group, sender, state, start) {
  state.sent.length = 0
  for (let i = 0; i < 3; i++) {
    const msg = makeMessage(group, sender, `message-${start + i}`)
    await engine.handleAntibot(sock, msg, item => item.message.conversation)
    if (i === 2) return msg
  }
}

function onlyText(state) {
  const replies = state.sent.filter(item => typeof item.payload.text === 'string')
  assert.equal(replies.length, 1, 'each action must send exactly one text response')
  return replies[0]
}

test('anti-bot warning, delete, and kick modes produce separate quoted messages and warnings persist', async () => {
  const appDir = isolatedApp()
  const phone = '999000000201'
  const group = '120363000000000201@g.us'
  const sender = '234800000201@s.whatsapp.net'
  const state = { sent: [], removals: [] }
  try {
    const engine = require(path.join(appDir, 'lib/antibot.js'))

    engine.setMode(group, 'warn', phone)
    const warningSock = makeSocket(phone, sender, false, state)
    const warning = await sendBurst(engine, warningSock, group, sender, state, 1)
    const warningReply = onlyText(state)
    assert.equal(warningReply.options.quoted, warning)
    assert.match(warningReply.payload.text, /ANTIBOT WARNING/)
    assert.match(warningReply.payload.text, /Warning: 1\/3/)
    assert.equal(state.sent.filter(item => item.payload.delete).length, 0)
    assert.equal(state.removals.length, 0)
    assert.equal(countAfterProcessRestart(appDir, phone, group, sender), 1)

    const secondWarning = await sendBurst(engine, warningSock, group, sender, state, 4)
    assert.equal(onlyText(state).options.quoted, secondWarning)
    assert.match(onlyText(state).payload.text, /Warning: 2\/3/)
    assert.equal(state.sent.filter(item => item.payload.delete).length, 0)
    assert.equal(state.removals.length, 0)

    engine.setMode(group, 'delete', phone)
    const deleteSock = makeSocket(phone, sender, true, state)
    const deleted = await sendBurst(engine, deleteSock, group, sender, state, 7)
    const deleteReply = onlyText(state)
    assert.equal(deleteReply.options.quoted, deleted)
    assert.match(deleteReply.payload.text, /ANTIBOT/)
    assert.match(deleteReply.payload.text, /message was deleted/)
    assert.doesNotMatch(deleteReply.payload.text, /WARNING|BOT DETECTED/)
    assert.equal(state.sent.filter(item => item.payload.delete).length, 1)
    assert.equal(state.removals.length, 0)

    engine.setMode(group, 'kick', phone)
    const kickSock = makeSocket(phone, sender, true, state)
    const removed = await sendBurst(engine, kickSock, group, sender, state, 10)
    const kickReply = onlyText(state)
    assert.equal(kickReply.options.quoted, removed)
    assert.match(kickReply.payload.text, /BOT DETECTED/)
    assert.match(kickReply.payload.text, /removed from the group/)
    assert.doesNotMatch(kickReply.payload.text, /ANTIBOT WARNING|ANTIBOT 」/)
    assert.equal(state.sent.filter(item => item.payload.delete).length, 1)
    assert.equal(state.removals.length, 1)
  } finally {
    const resolved = path.resolve(appDir)
    if (!resolved.startsWith(ROOT + path.sep) || !path.basename(resolved).startsWith('.tmp-antibot-')) {
      throw new Error(`Refusing to remove test directory outside workspace: ${resolved}`)
    }
    fs.rmSync(resolved, { recursive: true, force: true })
  }
})
