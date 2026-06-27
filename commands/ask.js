module.exports = {
  pattern:  "ask",
  desc:     "Chat with CYBER X AI",
  category: "ai",
  usage:    ".ask <question>",
  run: require("./ai").run,
}
