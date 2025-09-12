import express from "express"
import http from "http"
import { Server as SocketIOServer } from "socket.io"
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers
} from "@whiskeysockets/baileys"
import { Boom } from "@hapi/boom"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const server = http.createServer(app)
const io = new SocketIOServer(server, { cors: { origin: "*" } })

app.use(express.static(path.join(__dirname, "public")))
app.get("/", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")))

let sock = null
let isStarting = false

function dataURLToBuffer(dataURL) {
  const m = dataURL.match(/^data:(.+?);base64,(.+)$/)
  if (!m) throw new Error("Invalid dataURL")
  return { mime: m[1], buffer: Buffer.from(m[2], "base64") }
}

async function startSock() {
  if (isStarting) return
  isStarting = true
  try {
    const { state, saveCreds } = await useMultiFileAuthState("./session")
    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: Browsers.macOS("Safari")
    })
    sock.ev.on("creds.update", saveCreds)

    // Koneksi + Auto Reconnect
    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update
      if (qr) io.emit("qr", qr)

      if (connection === "open") {
        io.emit("connection", { status: "open" })
        sendChatList().catch(() => {})
      } else if (connection === "close") {
        const code = new Boom(lastDisconnect?.error)?.output?.statusCode
        const shouldReconnect = code !== DisconnectReason.loggedOut
        io.emit("connection", { status: "close", code })
        console.log("Koneksi putus:", code, "reconnect:", shouldReconnect)
        if (shouldReconnect) setTimeout(() => startSock(), 3000)
      }
    })

    // Pesan baru
    sock.ev.on("messages.upsert", async ({ messages }) => {
      if (!messages?.length) return
      const m = messages[0]
      const jid = m.key.remoteJid
      const fromMe = !!m.key.fromMe

      const text =
        m.message?.conversation ||
        m.message?.extendedTextMessage?.text ||
        m.message?.imageMessage?.caption ||
        m.message?.videoMessage?.caption ||
        ""

      io.emit("message", {
        jid,
        text,
        fromMe,
        timestamp: Number(m.messageTimestamp || Date.now()),
        key: m.key,
        hasMedia: !!(
          m.message?.imageMessage ||
          m.message?.videoMessage ||
          m.message?.documentMessage ||
          m.message?.audioMessage ||
          m.message?.stickerMessage
        ),
        mediaThumb: m.message?.imageMessage?.jpegThumbnail
          ? `data:image/jpeg;base64,${m.message.imageMessage.jpegThumbnail.toString("base64")}`
          : null
      })
    })

    // Perubahan daftar chat
    sock.ev.on("chats.upsert", () => sendChatList().catch(() => {}))
    sock.ev.on("chats.update", () => sendChatList().catch(() => {}))

    async function sendChatList() {
      if (!sock) return
      const chats = await sock?.chats?.all()
      const mapped = await Promise.all(
        (chats || []).map(async (c) => {
          let pfp = null
          try {
            pfp = await sock.profilePictureUrl(c.id, "image")
          } catch {}
          return {
            jid: c.id,
            name: c.name || c.displayName || c.id,
            pfp
          }
        })
      )
      io.emit("chat-list", mapped)
    }
  } catch (e) {
    console.error("startSock error:", e)
  } finally {
    isStarting = false
  }
}

io.on("connection", (socket) => {
  socket.emit("hello", { ok: true })

  socket.on("start", async () => {
    if (!sock) await startSock()
    else socket.emit("connection", { status: "maybe-open" })
  })

  socket.on("request_pairing", async (phone) => {
    try {
      if (!sock) await startSock()
      const code = await sock.requestPairingCode(String(phone))
      io.emit("pairing-code", code)
    } catch (err) {
      console.error("request_pairing error:", err)
      socket.emit("error", "Gagal membuat pairing code")
    }
  })

  socket.on("open_chat", async (jid) => {
    try {
      if (!sock) throw new Error("Socket belum siap")
      let pfp = null
      try { pfp = await sock.profilePictureUrl(jid, "image") } catch {}
      io.to(socket.id).emit("chat-header", { jid, pfp })

      const msgs = await sock.loadMessages(jid, 25)
      const simplified = msgs.map((m) => {
        const text =
          m.message?.conversation ||
          m.message?.extendedTextMessage?.text ||
          m.message?.imageMessage?.caption ||
          m.message?.videoMessage?.caption ||
          ""
        return {
          jid,
          text,
          fromMe: !!m.key.fromMe,
          timestamp: Number(m.messageTimestamp || Date.now()),
          key: m.key,
          hasMedia: !!(
            m.message?.imageMessage ||
            m.message?.videoMessage ||
            m.message?.documentMessage ||
            m.message?.audioMessage ||
            m.message?.stickerMessage
          ),
          mediaThumb: m.message?.imageMessage?.jpegThumbnail
            ? `data:image/jpeg;base64,${m.message.imageMessage.jpegThumbnail.toString("base64")}`
            : null
        }
      })
      io.to(socket.id).emit("chat-history", simplified.reverse())
    } catch (err) {
      console.error("open_chat error:", err)
      socket.emit("error", "Gagal membuka chat")
    }
  })

  socket.on("send_message", async ({ jid, text }) => {
    try {
      if (!sock) throw new Error("Socket belum siap")
      await sock.sendMessage(jid, { text })
      await sock.sendPresenceUpdate("paused", jid)
      socket.emit("sent_ok", { type: "text" })
    } catch (err) {
      console.error("send_message error:", err)
      socket.emit("error", "Gagal mengirim pesan teks")
    }
  })

  // Kirim media (image/video/audio/document/sticker webp)
  socket.on("send_media", async ({ jid, dataURL, caption, fileName }) => {
    try {
      if (!sock) throw new Error("Socket belum siap")
      const { buffer, mime } = dataURLToBuffer(dataURL)
      let content
      if (mime.startsWith("image/")) {
        if (mime === "image/webp") content = { sticker: buffer }
        else content = { image: buffer, caption, mimetype: mime }
      } else if (mime.startsWith("video/")) {
        content = { video: buffer, caption, mimetype: mime }
      } else if (mime.startsWith("audio/")) {
        content = { audio: buffer, mimetype: mime, ptt: true }
      } else {
        content = { document: buffer, caption, mimetype: mime, fileName: fileName || "file" }
      }
      await sock.sendMessage(jid, content)
      await sock.sendPresenceUpdate("paused", jid)
      socket.emit("sent_ok", { type: "media" })
    } catch (err) {
      console.error("send_media error:", err)
      socket.emit("error", "Gagal mengirim media")
    }
  })

  // Emoji reaction ke pesan tertentu
  socket.on("react_message", async ({ jid, key, emoji }) => {
    try {
      if (!sock) throw new Error("Socket belum siap")
      await sock.sendMessage(jid, { react: { text: emoji, key } })
      socket.emit("sent_ok", { type: "react" })
    } catch (err) {
      console.error("react_message error:", err)
      socket.emit("error", "Gagal mengirim reaction")
    }
  })
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => console.log("Ready → http://localhost:" + PORT))
