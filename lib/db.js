const mongoose = require("mongoose")

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI)
    console.log("🧠 CYBER X DB CONNECTED")
  } catch (e) {
    console.log("DB ERROR:", e.message)
  }
}

module.exports = { connectDB }
