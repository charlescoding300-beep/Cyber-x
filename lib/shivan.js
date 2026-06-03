const state = {
  anger: 0,
  memory: []
}

function addAnger(n = 10) {
  state.anger = Math.min(100, state.anger + n)
}

function calmDown() {
  state.anger = Math.max(0, state.anger - 8)
}

function mood() {
  if (state.anger < 30) return "calm"
  if (state.anger < 70) return "angry"
  return "berserk"
}

function remember(text) {
  state.memory.push(text)
  if (state.memory.length > 30) state.memory.shift()
}

function generate(text, sender) {

  remember(`${sender}: ${text}`)

  if (/idiot|stupid|fool/i.test(text)) addAnger(20)
  if (/sorry/i.test(text)) calmDown()

  const m = mood()

  if (m === "calm") return `...I hear you. ${text}`
  if (m === "angry") return `Don't talk like that... ${text}`
  return `🔥 STOP IT!! ${text.toUpperCase()}!!`
}

module.exports = {
  state,
  addAnger,
  calmDown,
  mood,
  generate
}
