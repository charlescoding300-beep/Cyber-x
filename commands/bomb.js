'use strict'
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CYBER X — BOMB GAME COMMAND
//  Usage: .bomb @user  OR  reply to someone + .bomb
//  Anyone can use | Category: fun
//  Original idea by Kasan — rewritten for CYBER X by Charles Tech
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CREDIT =
`*╭══ ✕-CYBER X ⚡*
*┃👨‍💻 ᴅᴇᴠᴇʟᴏᴘᴇʀ :* *Charles Tech*
*╰═════════════════⊷*`

const TIMEOUT     = 180000 // 3 min game timeout
const INVITE_TIME = 60000  // 60s to accept/decline

// ── State maps ─────────────────────────────────────────────────
const pendingInvites = new Map()
const activeGames    = new Map()

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function makeBoard() {
    const bom  = ['💥', '✅', '✅', '✅', '✅', '✅', '✅', '✅', '✅'].sort(() => Math.random() - 0.5)
    const nums = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣']
    return bom.map((v, i) => ({
        emot:     v,
        number:   nums[i],
        position: i + 1,
        state:    false,
    }))
}

function renderBoard(array) {
    let board = ''
    for (let i = 0; i < array.length; i += 3) {
        board += array.slice(i, i + 3).map(v => v.state ? v.emot : v.number).join('') + '\n'
    }
    return board
}

function renderFull(array) {
    let board = ''
    for (let i = 0; i < array.length; i += 3) {
        board += array.slice(i, i + 3).map(v => v.emot).join('') + '\n'
    }
    return board
}

async function startGame(sock, from, player1, player2) {
    const board1 = makeBoard()
    const board2 = makeBoard()

    const msg1 = await sock.sendMessage(from, {
        text:
`乂  *B O M B  —  YOUR BOARD*

👤 *@${player1.split('@')[0]}* vs 👤 *@${player2.split('@')[0]}*

Send *1-9* to open a box:

${renderBoard(board1)}
💥 Avoid the bomb! ✅ Open all safe boxes to win!
⏱️ *3 minutes* | Type *suren* to surrender.

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
        mentions: [player1, player2],
    })

    const msg2 = await sock.sendMessage(from, {
        text:
`乂  *B O M B  —  YOUR BOARD*

👤 *@${player2.split('@')[0]}* vs 👤 *@${player1.split('@')[0]}*

Send *1-9* to open a box:

${renderBoard(board2)}
💥 Avoid the bomb! ✅ Open all safe boxes to win!
⏱️ *3 minutes* | Type *suren* to surrender.

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
        mentions: [player1, player2],
    })

    const t1 = setTimeout(async () => {
        if (!activeGames.has(player1)) return
        const g = activeGames.get(player1)
        const bombBox = g.board.find(v => v.emot === '💥')
        await sock.sendMessage(from, {
            text:
`⏰ *Time's up @${player1.split('@')[0]}!*
The bomb was in box *${bombBox.number}*

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
            mentions: [player1],
        }, { quoted: g.msg })
        activeGames.delete(player1)
    }, TIMEOUT)

    const t2 = setTimeout(async () => {
        if (!activeGames.has(player2)) return
        const g = activeGames.get(player2)
        const bombBox = g.board.find(v => v.emot === '💥')
        await sock.sendMessage(from, {
            text:
`⏰ *Time's up @${player2.split('@')[0]}!*
The bomb was in box *${bombBox.number}*

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
            mentions: [player2],
        }, { quoted: g.msg })
        activeGames.delete(player2)
    }, TIMEOUT)

    activeGames.set(player1, { board: board1, msg: msg1, opponent: player2, from, timeoutId: t1 })
    activeGames.set(player2, { board: board2, msg: msg2, opponent: player1, from, timeoutId: t2 })
}

async function handleMove(sock, sender, number) {
    if (!activeGames.has(sender)) return false

    const game        = activeGames.get(sender)
    const { board, msg, opponent, from } = game
    const selectedBox = board.find(v => v.position === number)

    if (!selectedBox || selectedBox.state) return true
    selectedBox.state = true

    if (selectedBox.emot === '💥') {
        await sock.sendMessage(from, {
            text:
`💥 *B O O M !*

@${sender.split('@')[0]} hit the bomb on box *${selectedBox.number}*! 😵

*Final Board:*
${renderFull(board)}
@${opponent.split('@')[0]} *WINS!* 🏆

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
            mentions: [sender, opponent],
        }, { quoted: msg })
        clearTimeout(game.timeoutId)
        activeGames.delete(sender)

        if (activeGames.has(opponent)) {
            const og = activeGames.get(opponent)
            await sock.sendMessage(from, {
                text:
`🏆 *YOU WIN @${opponent.split('@')[0]}!*

Your opponent hit the bomb! 💥

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
                mentions: [opponent],
            }, { quoted: og.msg })
            clearTimeout(og.timeoutId)
            activeGames.delete(opponent)
        }
        return true
    }

    const safe   = board.filter(v => v.emot === '✅')
    const opened = safe.filter(v => v.state)

    if (opened.length === safe.length) {
        await sock.sendMessage(from, {
            text:
`🎉 *@${sender.split('@')[0]} WINS!*

You opened all safe boxes! 🏆

*Final Board:*
${renderFull(board)}

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
            mentions: [sender, opponent],
        }, { quoted: msg })
        clearTimeout(game.timeoutId)
        activeGames.delete(sender)

        if (activeGames.has(opponent)) {
            const og = activeGames.get(opponent)
            await sock.sendMessage(from, {
                text:
`💀 *@${opponent.split('@')[0]} — You lost!*

Your opponent finished first! 😔

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
                mentions: [opponent],
            }, { quoted: og.msg })
            clearTimeout(og.timeoutId)
            activeGames.delete(opponent)
        }
        return true
    }

    await sock.sendMessage(from, {
        text:
`乂  *B O M B  —  YOUR BOARD*

Box *${selectedBox.number}* opened: ${selectedBox.emot} Safe!

Send *1-9* to open a box:

${renderBoard(board)}
⏱️ *3 minutes* | Type *suren* to surrender.

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
        mentions: [sender],
    }, { quoted: msg })

    return true
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  MAIN COMMAND
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

module.exports = {
    pattern:  'bomb',
    alias:    ['bom'],
    category: 'fun',
    desc:     'Challenge someone to a 1v1 bomb game!',
    usage:    '.bomb @user  OR  reply to someone + .bomb',

    run: async ({ sock, from, msg, sender, text, args }) => {

        const msgText = (text || '').toLowerCase().trim()

        // ── Pending invite response ────────────────────────────
        if (pendingInvites.has(sender)) {
            const invite = pendingInvites.get(sender)

            if (msgText === '1') {
                clearTimeout(invite.timeoutId)
                pendingInvites.delete(sender)

                await sock.sendMessage(from, {
                    text:
`✅ *@${sender.split('@')[0]} accepted the challenge!*

⚔️ *GAME STARTING NOW!*

Both players get their own board!
First to clear all safe boxes wins! 🏆

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
                    mentions: [sender, invite.challenger],
                }, { quoted: invite.msg })

                await startGame(sock, from, invite.challenger, sender)
                return
            }

            if (msgText === '2') {
                clearTimeout(invite.timeoutId)
                pendingInvites.delete(sender)

                await sock.sendMessage(from, {
                    text:
`❌ *@${sender.split('@')[0]} declined the challenge!*

Better luck next time @${invite.challenger.split('@')[0]} 😅

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
                    mentions: [sender, invite.challenger],
                }, { quoted: invite.msg })
                return
            }
        }

        // ── Active game move ───────────────────────────────────
        if (activeGames.has(sender)) {
            if (msgText === 'suren' || msgText === 'surrender') {
                const game    = activeGames.get(sender)
                const bombBox = game.board.find(v => v.emot === '💥')
                await sock.sendMessage(from, {
                    text:
`💣 *@${sender.split('@')[0]} surrendered!*

The bomb was in box *${bombBox.number}*
@${game.opponent.split('@')[0]} *WINS!* 🏆

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
                    mentions: [sender, game.opponent],
                }, { quoted: game.msg })
                clearTimeout(game.timeoutId)
                activeGames.delete(sender)
                if (activeGames.has(game.opponent)) {
                    const og = activeGames.get(game.opponent)
                    clearTimeout(og.timeoutId)
                    activeGames.delete(game.opponent)
                }
                return
            }

            const number = parseInt(msgText)
            if (!isNaN(number) && number >= 1 && number <= 9) {
                await handleMove(sock, sender, number)
            }
            return
        }

        // ── New challenge ──────────────────────────────────────
        await sock.sendMessage(from, {
            react: { text: '💣', key: msg.key }
        }).catch(() => {})

        const mentioned  = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
        const quotedJid  = msg.message?.extendedTextMessage?.contextInfo?.participant
                        || msg.message?.extendedTextMessage?.contextInfo?.remoteJid
                        || null
        const challenged = mentioned[0] || quotedJid || null

        if (!challenged) {
            return sock.sendMessage(from, {
                text:
`╔══════════════════════════════╗
║  💣 *CYBER X — BOMB GAME*   ║
╚══════════════════════════════╝

⚔️ *How to challenge someone:*

• Tag them: _.bomb @user_
• Reply to their message: _reply + .bomb_

🎮 *How to play:*
• Send *1-9* to open a box
• Avoid the 💥 bomb
• First to open all ✅ safe boxes wins!

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
                quoted: msg
            })
        }

        if (challenged === sender) {
            return sock.sendMessage(from, {
                text: `😂 You can't challenge yourself!\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n${CREDIT}`,
                quoted: msg
            })
        }

        if (activeGames.has(sender)) {
            return sock.sendMessage(from, {
                text: `⚠️ You're already in a game! Finish it first.\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n${CREDIT}`,
                quoted: msg
            })
        }

        const inviteMsg = await sock.sendMessage(from, {
            text:
`╔══════════════════════════════╗
║  ⚔️ *BOMB CHALLENGE!*        ║
╚══════════════════════════════╝

👤 *@${sender.split('@')[0]}* has challenged you to a Bomb Game!

@${challenged.split('@')[0]} do you accept?

1️⃣ — Accept
2️⃣ — Decline

_Please reply *1* or *2* as you desired_

⏱️ You have *60 seconds* to respond!

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
            mentions: [sender, challenged],
        }, { quoted: msg })

        const timeoutId = setTimeout(async () => {
            if (!pendingInvites.has(challenged)) return
            pendingInvites.delete(challenged)
            await sock.sendMessage(from, {
                text:
`⏰ *Challenge expired!*

@${challenged.split('@')[0]} did not respond in time.

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
                mentions: [sender, challenged],
            }, { quoted: inviteMsg })
        }, INVITE_TIME)

        pendingInvites.set(challenged, {
            challenger: sender,
            challenged,
            from,
            msg:       inviteMsg,
            timeoutId,
        })
    }
}
