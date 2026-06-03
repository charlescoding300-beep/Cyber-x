const mongoose = require("mongoose")

const userSchema = new mongoose.Schema({
  id: String,

  memory: { type: Array, default: [] },

  anger: { type: Number, default: 0 },

  relationship: {
    type: String,
    default: "neutral" // friend | enemy | neutral
  }
})

module.exports = mongoose.model("User", userSchema)
