module.exports = {
  name: "whois",
  aliases: ["who", "userinfo"],
  desc: "Show WhatsApp information about a user",
  usage: ".whois (reply to a user)",
  category: "owner",

  async run({
    sock,
    from,
    msg,
    args,
    isOwner,
    isGroup
  }) {
    try {
      // ============================================
      // OWNER ONLY
      // ============================================
      if (!isOwner) {
        return await sock.sendMessage(
          from,
          {
            text:
              `╭───〔 𓃦 𝗭Ξ𝗡 𝗫 〕───╮\n` +
              `│ 🔒 OWNER ONLY\n` +
              `╰────────────────────╯\n\n` +
              `│ ❌ This command is restricted to the bot owner.\n\n` +
              `> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`
          },
          { quoted: msg }
        );
      }

      // ============================================
      // REACTION TO THE PERSON WHO TRIGGERED COMMAND
      // ============================================
      try {
        await sock.sendMessage(
          from,
          {
            react: {
              text: "🔮",
              key: msg.key
            }
          }
        );
      } catch (reactionError) {
        console.error(
          "[WHOIS] Reaction error:",
          reactionError?.message || reactionError
        );
      }

      // ============================================
      // FIND TARGET USER
      //
      // Priority:
      // 1. Replied message
      // 2. Mentioned user
      // 3. Sender themselves
      // ============================================

      let targetJid = null;

      const contextInfo =
        msg?.message?.extendedTextMessage?.contextInfo ||
        msg?.message?.imageMessage?.contextInfo ||
        msg?.message?.videoMessage?.contextInfo ||
        msg?.message?.documentMessage?.contextInfo;

      // --------------------------------------------
      // 1. REPLIED MESSAGE
      // --------------------------------------------

      if (contextInfo?.participant) {
        targetJid = contextInfo.participant;
      }

      // --------------------------------------------
      // 2. MENTION
      // --------------------------------------------

      if (!targetJid) {
        const mentioned =
          contextInfo?.mentionedJid ||
          [];

        if (mentioned.length) {
          targetJid = mentioned[0];
        }
      }

      // --------------------------------------------
      // 3. COMMAND SENDER
      // --------------------------------------------

      if (!targetJid) {
        targetJid =
          msg?.key?.participant ||
          msg?.participant ||
          msg?.key?.remoteJid;
      }

      // ============================================
      // NORMALIZE JID
      // ============================================

      if (!targetJid) {
        throw new Error(
          "Unable to determine the WhatsApp user."
        );
      }

      targetJid = String(targetJid);

      // If target is a LID, don't try to fabricate a
      // phone number from it.
      const isLid =
        targetJid.endsWith("@lid");

      // ============================================
      // BASIC NUMBER
      // ============================================

      let number = "Unknown";

      if (!isLid) {
        number =
          targetJid
            .split("@")[0]
            .replace(/\D/g, "") ||
          "Unknown";
      }

      // ============================================
      // WHATSAPP CHECK
      // ============================================

      let exists = true;
      let resolvedJid = targetJid;
      let isBusiness = false;

      try {
        if (!isLid && number !== "Unknown") {
          const result =
            await sock.onWhatsApp(number);

          if (Array.isArray(result) && result[0]) {
            exists =
              result[0].exists !== false;

            resolvedJid =
              result[0].jid ||
              targetJid;

            isBusiness =
              Boolean(result[0].isBusiness);
          }
        }
      } catch (waError) {
        console.error(
          "[WHOIS] WhatsApp lookup error:",
          waError?.message || waError
        );
      }

      // ============================================
      // PROFILE NAME
      // ============================================

      let name =
        msg?.pushName ||
        "Unknown";

      // If replying to someone, try the quoted
      // participant's push name from message context.
      if (
        contextInfo?.participant &&
        contextInfo?.quotedMessage
      ) {
        name =
          contextInfo?.quotedMessage?.extendedTextMessage
            ?.contextInfo?.participant ||
          name;
      }

      // Try common Baileys message metadata.
      if (
        contextInfo?.participant &&
        msg?.pushName &&
        contextInfo.participant === msg?.key?.participant
      ) {
        name = msg.pushName;
      }

      // ============================================
      // BUSINESS PROFILE
      // ============================================

      let business = null;

      if (isBusiness) {
        try {
          business =
            await sock.getBusinessProfile(
              resolvedJid
            );
        } catch (businessError) {
          console.error(
            "[WHOIS] Business profile error:",
            businessError?.message || businessError
          );
        }
      }

      // ============================================
      // STATUS
      // ============================================

      let statusText = "Unavailable";

      try {
        const status =
          await sock.fetchStatus(
            resolvedJid
          );

        if (status?.status) {
          statusText = status.status;
        }
      } catch (statusError) {
        console.error(
          "[WHOIS] Status error:",
          statusError?.message || statusError
        );
      }

      // ============================================
      // PROFILE PICTURE
      // ============================================

      let profilePicture = null;

      try {
        profilePicture =
          await sock.profilePictureUrl(
            resolvedJid,
            "image"
          );
      } catch (ppError) {
        try {
          profilePicture =
            await sock.profilePictureUrl(
              resolvedJid,
              "preview"
            );
        } catch {
          profilePicture = null;
        }
      }

      // ============================================
      // GROUP INFORMATION
      // ============================================

      let groupName = "Private Chat";
      let groupId = "N/A";
      let role = "Member";

      if (
        isGroup &&
        from?.endsWith("@g.us")
      ) {
        groupId = from;

        try {
          const metadata =
            await sock.groupMetadata(from);

          groupName =
            metadata?.subject ||
            "Unknown Group";

          const participant =
            metadata?.participants?.find(
              p =>
                p?.id === resolvedJid ||
                p?.jid === resolvedJid ||
                p?.lid === resolvedJid
            );

          if (participant?.admin === "superadmin") {
            role = "Creator";
          } else if (participant?.admin) {
            role = "Admin";
          } else {
            role = "Member";
          }
        } catch (groupError) {
          console.error(
            "[WHOIS] Group metadata error:",
            groupError?.message || groupError
          );
        }
      }

      // ============================================
      // ACCOUNT TYPE
      // ============================================

      const accountType =
        isBusiness || business
          ? "Business"
          : "Personal";

      // ============================================
      // OUTPUT
      // ============================================

      const output =
        `╭───〔 𓃦 𝗭Ξ𝗡 𝗫 〕───╮\n` +
        `│ 🔎 *WHO IS*\n` +
        `╰────────────────────╯\n\n` +

        `╭─〔 👤 *USER INFO* 〕\n` +
        `│ *Name:* ${name}\n` +
        `│ *Number:* +${number}\n` +
        `│ *WhatsApp:* ${exists ? "✅ Available" : "❌ Not Found"}\n` +
        `│ *JID:* ${resolvedJid}\n` +
        `╰────────────────────\n\n` +

        `╭─〔 📱 *ACCOUNT* 〕\n` +
        `│ *Type:* ${accountType}\n` +
        `│ *Business:* ${isBusiness ? "✅" : "❌"}\n` +
        `│ *Status:* ${statusText}\n` +
        `╰────────────────────\n\n` +

        `╭─〔 👥 *GROUP* 〕\n` +
        `│ *Group:* ${groupName}\n` +
        `│ *Role:* ${role}\n` +
        `│ *Group ID:* ${groupId}\n` +
        `╰────────────────────\n\n` +

        `> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`;

      // ============================================
      // SEND WITH PROFILE PICTURE
      // ============================================

      if (profilePicture) {
        return await sock.sendMessage(
          from,
          {
            image: {
              url: profilePicture
            },
            caption: output
          },
          {
            quoted: msg
          }
        );
      }

      // ============================================
      // FALLBACK WITHOUT PROFILE PICTURE
      // ============================================

      return await sock.sendMessage(
        from,
        {
          text: output
        },
        {
          quoted: msg
        }
      );

    } catch (error) {
      console.error(
        "[WHOIS] Error:",
        error
      );

      return await sock.sendMessage(
        from,
        {
          text:
            `❌ *WHOIS failed.*\n\n` +
            `${error?.message || "Unable to retrieve user information"}`
        },
        {
          quoted: msg
        }
      );
    }
  }
};
