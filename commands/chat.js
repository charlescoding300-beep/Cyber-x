module.exports = {
  pattern:  "chat",
  desc:     "Chat with ZENX AI",
  category: 'ai',
  usage:    ".chat <question>",
  run: require("./ai").run,
}
