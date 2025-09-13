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

// simple in-memory logs/config
let history = [] // { date,to,text,status }
let autoReplies = [] // { keyword, reply }

function pushHistory(row) {
  history.push(row)
  if (history.length > 5000) history.shift()
  io.emit("history_update", history)
}

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

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update
      if (qr) io.emit("qr", qr)

      if (connection === "open") {
        io.emit("connection", { status: "open" })
      } else if (connection === "close") {
        const code = new Boom(lastDisconnect?.error)?.output?.statusCode
        const shouldReconnect = code !== DisconnectReason.loggedOut
        io.emit("connection", { status: "close", code })
        if (shouldReconnect) setTimeout(() => startSock(), 3000)
      }
    })

    // Auto reply handler
    sock.ev.on("messages.upsert", async ({ messages }) => {
      const m = messages?.[0]
      if (!m?.message || m?.key?.fromMe) return
      const jid = m.key.remoteJid
      const text =
        m.message?.conversation ||
        m.message?.extendedTextMessage?.text ||
        m.message?.imageMessage?.caption ||
        m.message?.videoMessage?.caption ||
        ""

      // match rules
      for (const rule of autoReplies) {
        if (!rule.keyword) continue
        if (String(text).toLowerCase().includes(String(rule.keyword).toLowerCase())) {
          try {
            await sock.sendMessage(jid, { text: rule.reply })
            pushHistory({
              date: new Date().toLocaleString(),
              to: jid,
              text: rule.reply,
              status: "Auto Reply"
            })
          } catch {}
        }
      }
    })
  } catch (e) {
    console.error("startSock error:", e)
  } finally {
    isStarting = false
  }
}

// ===== Socket.IO API =====
io.on("connection", (socket) => {
  // kirim history awal
  socket.emit("history_update", history)

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

  // Single text
  socket.on("send_message", async ({ number, text }) => {
    try {
      if (!sock) throw new Error("Not connected")
      const jid = number.includes("@s.whatsapp.net") ? number : number + "@s.whatsapp.net"
      await sock.sendMessage(jid, { text })
      pushHistory({ date: new Date().toLocaleString(), to: number, text, status: "Terkirim" })
      socket.emit("sent_ok", { type: "single_text", number })
    } catch (e) {
      console.error("send_message", e)
      socket.emit("error", "Gagal kirim teks")
    }
  })

  // Single media
  socket.on("send_media", async ({ number, dataURL, caption, fileName }) => {
    try {
      if (!sock) throw new Error("Not connected")
      const { buffer, mime } = dataURLToBuffer(dataURL)
      let content
      if (mime.startsWith("image/")) content = { image: buffer, caption, mimetype: mime }
      else if (mime.startsWith("video/")) content = { video: buffer, caption, mimetype: mime }
      else if (mime.startsWith("audio/")) content = { audio: buffer, mimetype: mime, ptt: false }
      else content = { document: buffer, caption, mimetype: mime, fileName: fileName || "file" }

      const jid = number.includes("@s.whatsapp.net") ? number : number + "@s.whatsapp.net"
      await sock.sendMessage(jid, content)
      pushHistory({
        date: new Date().toLocaleString(),
        to: number,
        text: caption || "(media)",
        status: "Terkirim"
      })
      socket.emit("sent_ok", { type: "single_media", number })
    } catch (e) {
      console.error("send_media", e)
      socket.emit("error", "Gagal kirim media")
    }
  })

  // Single with buttons (opsional media)
  socket.on("send_buttons", async ({ number, text, buttons, dataURL, caption }) => {
    try {
      if (!sock) throw new Error("Not connected")
      const jid = number.includes("@s.whatsapp.net") ? number : number + "@s.whatsapp.net"
      let content = { text, buttons: buttons || [], headerType: 1 }
      if (dataURL) {
        const { buffer, mime } = dataURLToBuffer(dataURL)
        if (mime.startsWith("image/")) content.image = buffer
        else if (mime.startsWith("video/")) content.video = buffer
        if (caption) content.caption = caption
      }
      await sock.sendMessage(jid, content)
      pushHistory({
        date: new Date().toLocaleString(),
        to: number,
        text: text || caption || "(buttons)",
        status: "Terkirim (Button)"
      })
      socket.emit("sent_ok", { type: "single_buttons", number })
    } catch (e) {
      console.error("send_buttons", e)
      socket.emit("error", "Gagal kirim pesan + button")
    }
  })

  // Broadcast text / media / buttons
  socket.on("send_broadcast", async ({ numbers, text, dataURL, caption, buttons }) => {
    try {
      if (!sock) throw new Error("Not connected")
      let baseContent = {}
      if (buttons?.length) baseContent = { text: text || caption || "", buttons, headerType: 1 }
      else baseContent = { text: text || caption || "" }

      let media = null
      if (dataURL) {
        const { buffer, mime } = dataURLToBuffer(dataURL)
        if (mime.startsWith("image/")) media = { image: buffer, mimetype: mime }
        else if (mime.startsWith("video/")) media = { video: buffer, mimetype: mime }
        else if (mime.startsWith("audio/")) media = { audio: buffer, mimetype: mime, ptt: false }
        else media = { document: buffer, mimetype: mime }
      }

      for (const num of numbers) {
        const jid = num.includes("@s.whatsapp.net") ? num : num + "@s.whatsapp.net"
        const content = { ...baseContent }
        if (caption) content.caption = caption
        if (media) Object.assign(content, media)
        await sock.sendMessage(jid, content)
        pushHistory({
          date: new Date().toLocaleString(),
          to: num,
          text: text || caption || (buttons?.length ? "(buttons)" : "(broadcast)"),
          status: "Terkirim"
        })
      }
      socket.emit("sent_ok", { type: "broadcast", count: numbers.length })
    } catch (e) {
      console.error("send_broadcast", e)
      socket.emit("error", "Gagal broadcast")
    }
  })

  // Auto reply
  socket.on("set_auto_reply", ({ keyword, reply }) => {
    autoReplies.push({ keyword, reply })
    socket.emit("sent_ok", { type: "auto_reply" })
  })
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => console.log("WA Tools Dashboard → http://localhost:" + PORT))
