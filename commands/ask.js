module.exports = {
  pattern:  "ask",
  desc:     "Chat with ZENX AI",
  category: 'ai',
  usage:    ".ask <question>",
  run: require("./ai").run,
}
