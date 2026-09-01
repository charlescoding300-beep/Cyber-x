// lib/cloudSock.js
// Cloud API adapter exposing a Baileys-compatible interface so the
// existing command files, settings engine, and inline handlers
// (antilink/antitag/ban pipeline) keep working unchanged.

const { EventEmitter } = require("events")

const API_ROOT = "https://graph.facebook.com"

class CloudSock extends EventEmitter {
  constructor({ phone, accessToken, phoneNumberId, apiVersion = "v22.0" }) {
    super()
    this.phone          = phone
    this.accessToken    = accessToken
    this.phoneNumberId  = phoneNumberId
    this.apiVersion     = apiVersion
    this.user           = { id: `${phone}@s.whatsapp.net` }   // normalizeNum(sock.user.id) keeps working
    this.connected      = true
    this.ev             = this                                 // sock.ev.on(...) keeps working
    this._lastInboundId = new Map()                            // jid -> last inbound message id (for typing indicator)
  }

  // ── Transport ────────────────────────────────────────────────────────────
  async _api(endpoint, method = "GET", body = null, isForm = false) {
    const url = `${API_ROOT}/${this.apiVersion}${endpoint}`
    let payload
    if (isForm) payload = body
    else if (body !== null) payload = JSON.stringify(body)

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...(isForm ? {} : body !== null ? { "Content-Type": "application/json" } : {}),
      },
      body: payload,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`
      throw new Error(`[CLOUD] ${method} ${endpoint.split("?")[0]}: ${msg}`)
    }
    return data
  }

  // ── JID mapping ──────────────────────────────────────────────────────────
  // Bot-side convention: groups are `${groupId}@g.us`, users `${digits}@s.whatsapp.net`.
  // Cloud-side: group ids are plain numeric strings, users are wa_ids.
  static _toWaId(jid) {
    return String(jid).replace(/@.*$/, "").replace(/:\d+$/, "").replace(/\D/g, "")
  }
  _isGroupJid(jid) { return String(jid).endsWith("@g.us") }
  _graphId(jid)    { return CloudSock._toWaId(jid) }

  // ── Media upload (buffer or {url}) → media id ────────────────────────────
  async _uploadMedia(source, mimetype = "application/octet-stream") {
    let file
    if (source?.url) {
      const res = await fetch(source.url)
      const ab  = await res.arrayBuffer()
      file = new Blob([ab], { type: mimetype })
    } else {
      const buf = Buffer.isBuffer(source) ? source : Buffer.from(source)
      file = new Blob([buf], { type: mimetype })
    }
    const fd = new FormData()
    fd.append("messaging_product", "whatsapp")
    fd.append("file", file)
    const data = await this._api(`/${this.phoneNumberId}/media`, "POST", fd, true)
    return data.id
  }

  async _downloadMedia(mediaId) {
    const meta = await this._api(`/${mediaId}`)          // { url, mimetype, ... }
    const res  = await fetch(meta.url, { headers: { Authorization: `Bearer ${this.accessToken}` } })
    return Buffer.from(await res.arrayBuffer())
  }

  // ── SEND — same content shapes as sock.sendMessage ───────────────────────
  async sendMessage(jid, content = {}, options = {}) {
    // react
    if (content.react) {
      return this._api(`/${this.phoneNumberId}/messages`, "POST", {
        messaging_product: "whatsapp",
        type: "reaction",
        to: CloudSock._toWaId(options.statusJidList?.[0] || content.react.key?.participant || jid),
        reaction: { message_id: content.react.key.id, emoji: content.react.text },
      })
    }

    // delete others' messages: NOT possible on Cloud API — callers (antilink
    // warn mode etc.) get a clear error instead of a silent no-op.
    if (content.delete) {
      throw new Error("[CLOUD] Message deletion of others' messages is not supported on Cloud API")
    }

    const body = {
      messaging_product: "whatsapp",
      to: CloudSock._toWaId(jid),
    }

    if (this._isGroupJid(jid)) {
      body.recipient_type = "group"
      // Cloud group ids are bare numeric strings — strip @g.us for `to`
      body.to = this._graphId(jid)
    }

    // quoted reply → context
    if (options.quoted?.key?.id) body.context = { message_id: options.quoted.key.id }

    if (content.text !== undefined) {
      body.type = "text"
      body.text = { body: content.text }
    } else if (content.image) {
      const src = typeof content.image === "string" ? { url: content.image } : content.image
      const id  = await this._uploadMedia(src, "image/jpeg")
      body.type  = "image"
      body.image = { id, caption: content.caption || undefined }
    } else if (content.video) {
      const src = typeof content.video === "string" ? { url: content.video } : content.video
      const id  = await this._uploadMedia(src, "video/mp4")
      body.type  = "video"
      body.video = { id, caption: content.caption || undefined }
      // gifPlayback: Cloud API has no GIF flag — sends as mp4 (loops in most clients)
    } else if (content.audio) {
      const id  = await this._uploadMedia(content.audio, content.mimetype || "audio/mpeg")
      body.type  = "audio"
      body.audio = { id }
      // ptt: Cloud API audio plays as a voice note by default — ptt param not exposed
    } else if (content.document) {
      const buf = Buffer.isBuffer(content.document) ? content.document : Buffer.from(content.document)
      const id  = await this._uploadMedia(buf, content.mimetype)
      body.type     = "document"
      body.document = { id, filename: content.fileName || "file" }
    } else if (content.sticker) {
      const id  = await this._uploadMedia(content.sticker, "image/webp")
      body.type    = "sticker"
      body.sticker = { id }
    } else {
      throw new Error("[CLOUD] sendMessage: unsupported content shape " + JSON.stringify(Object.keys(content)))
    }

    return this._api(`/${this.phoneNumberId}/messages`, "POST", body)
  }

  // ── Groups ───────────────────────────────────────────────────────────────
  async groupMetadata(jid) {
    const id   = this._graphId(jid)
    const data = await this._api(`/${id}?fields=id,subject,participants`)
    return {
      id: `${data.id}@g.us`,
      subject: data.subject || data.id,
      participants: (data.participants || []).map(p => ({
        id:    `${p.phone_number}@s.whatsapp.net`,
        admin: p.is_admin ? "admin" : null,
      })),
    }
  }

  async groupParticipantsUpdate(gid, jids, action) {
    const ids = jids.map(j => CloudSock._toWaId(j))
    try {
      return await this._api(`/${this._graphId(gid)}/participants`, "POST", {
        participants: ids,
        action, // "remove" | "promote" | "demote"
      })
    } catch (e) {
      // Note: participant ADD currently requires group invite links on Cloud API.
      throw e
    }
  }

  // ── Read receipts / presence ─────────────────────────────────────────────
  async readMessages(keys) {
    for (const k of keys) {
      await this._api(`/${this.phoneNumberId}/messages`, "POST", {
        messaging_product: "whatsapp",
        status: "read",
        message_id: k.id,
      }).catch(() => {})
    }
  }

  async sendPresenceUpdate(type, jid) {
    // "composing" → typing indicator (Cloud API best-effort; needs an inbound message id)
    if (type !== "composing") return                       // recording/paused/available: not supported
    const lastId = this._lastInboundId.get(this._graphId(jid))
    if (!lastId) return
    await this._api(`/${this.phoneNumberId}/messages`, "POST", {
      messaging_product: "whatsapp",
      status: "typing_indicator",
      message_id: lastId,
    }).catch(() => {})
  }

  // ── Not available on Cloud API — explicit, no silent failure ─────────────
  async profilePictureUrl() { throw new Error("[CLOUD] Profile pictures are not exposed by Cloud API") }
  async rejectCall()        { throw new Error("[CLOUD] Call events/rejection are not available on Cloud API") }
  async updateMediaMessage(){}
  end() {}

  // ── Inbound routing — called by webhook.js ───────────────────────────────
  _noteInboundId(msgObj) {
    this._lastInboundId.set(this._graphId(msgObj.key.remoteJid), msgObj.key.id)
  }

  emitMessagesUpsert(baileysMessages) {
    for (const m of baileysMessages) this._noteInboundId(m)
    this.emit("messages.upsert", { messages: baileysMessages, type: "notify" })
  }

  emitMessagesUpdate(updates) {
    this.emit("messages.update", updates)
  }
}

module.exports = CloudSock
