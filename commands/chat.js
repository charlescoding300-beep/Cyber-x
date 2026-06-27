module.exports = {
  pattern:  "chat",
  desc:     "Chat with CYBER X AI",
  category: "ai",
  usage:    ".chat <question>",
  run: require("./ai").run,
}
