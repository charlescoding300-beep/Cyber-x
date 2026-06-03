const User = require("../models/User")

async function getUser(id) {
  let user = await User.findOne({ id })
  if (!user) user = await User.create({ id })
  return user
}

async function updateMemory(user, text) {
  user.memory.push(text)
  if (user.memory.length > 20) user.memory.shift()
}

function calcMood(anger) {
  if (anger < 30) return "calm"
  if (anger < 70) return "angry"
  return "berserk"
}

async function generate(text, sender) {

  const user = await getUser(sender)

  await updateMemory(user, text)

  // emotion triggers
  if (/idiot|stupid|fool/i.test(text)) user.anger += 25
  if (/sorry|forgive/i.test(text)) user.anger -= 10

  user.anger = Math.max(0, Math.min(100, user.anger))

  const mood = calcMood(user.anger)

  // relationship evolution
  if (user.anger > 80) user.relationship = "enemy"
  if (user.anger < 20) user.relationship = "friend"

  await user.save()

  // voice-ready responses
  if (mood === "calm") return "I hear you."
  if (mood === "angry") return "Don't talk like that."
  return "Stop it. You are testing me."
}

module.exports = { generate }
