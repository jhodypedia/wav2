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
app.get("/", (_, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
)

let sock = null
let isStarting = false
let history = []
let autoReplies = []

function pushHistory(row) {
  history.push(row)
  if (history.length > 2000) history.shift()
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
        if (shouldReconnect) setTimeout(() => startSock(), 5000)
      }
    })

    sock.ev.on("messages.upsert", async ({ messages }) => {
      const m = messages[0]
      if (!m?.message || m.key.fromMe) return
      const jid = m.key.remoteJid
      const text =
        m.message?.conversation ||
        m.message?.extendedTextMessage?.text ||
        ""

      for (const rule of autoReplies) {
        if (text.toLowerCase().includes(rule.keyword.toLowerCase())) {
          await sock.sendMessage(jid, { text: rule.reply })
          pushHistory({
            date: new Date().toLocaleString(),
            to: jid,
            text: rule.reply,
            status: "Auto Reply"
          })
        }
      }
    })
  } catch (e) {
    console.error("startSock error:", e)
  } finally {
    isStarting = false
  }
}

io.on("connection", (socket) => {
  socket.emit("history_update", history)

  socket.on("start", async () => {
    if (!sock) await startSock()
    else socket.emit("connection", { status: "maybe-open" })
  })

  socket.on("request_pairing", async (phone) => {
    try {
      if (!sock) await startSock()
      const code = await sock.requestPairingCode(phone)
      io.emit("pairing-code", code)
    } catch (err) {
      console.error("pairing error", err)
      socket.emit("error", "Gagal generate Pairing Code")
    }
  })

  socket.on("send_message", async ({ number, text }) => {
    try {
      const jid = number.includes("@s.whatsapp.net")
        ? number
        : number + "@s.whatsapp.net"
      await sock.sendMessage(jid, { text })
      pushHistory({ date: new Date().toLocaleString(), to: number, text, status: "Terkirim" })
      socket.emit("sent_ok", { type: "single_text" })
    } catch {
      socket.emit("error", "Gagal kirim pesan")
    }
  })

  socket.on("send_media", async ({ number, dataURL, caption, fileName }) => {
    try {
      const { buffer, mime } = dataURLToBuffer(dataURL)
      let content
      if (mime.startsWith("image/")) content = { image: buffer, caption }
      else if (mime.startsWith("video/")) content = { video: buffer, caption }
      else if (mime.startsWith("audio/")) content = { audio: buffer, mimetype: mime }
      else content = { document: buffer, caption, fileName: fileName || "file" }

      const jid = number.includes("@s.whatsapp.net") ? number : number + "@s.whatsapp.net"
      await sock.sendMessage(jid, content)
      pushHistory({ date: new Date().toLocaleString(), to: number, text: caption || "(media)", status: "Terkirim" })
      socket.emit("sent_ok", { type: "single_media" })
    } catch {
      socket.emit("error", "Gagal kirim media")
    }
  })

  socket.on("send_buttons", async ({ number, text, buttons, dataURL, caption }) => {
    try {
      const jid = number.includes("@s.whatsapp.net") ? number : number + "@s.whatsapp.net"
      let content = { text, buttons, headerType: 1 }
      if (dataURL) {
        const { buffer, mime } = dataURLToBuffer(dataURL)
        if (mime.startsWith("image/")) content.image = buffer
        else if (mime.startsWith("video/")) content.video = buffer
        if (caption) content.caption = caption
      }
      await sock.sendMessage(jid, content)
      pushHistory({ date: new Date().toLocaleString(), to: number, text: text || caption, status: "Terkirim (Button)" })
      socket.emit("sent_ok", { type: "single_buttons" })
    } catch {
      socket.emit("error", "Gagal kirim tombol")
    }
  })

  socket.on("send_broadcast", async ({ numbers, text, dataURL, caption, buttons }) => {
    try {
      let media = null
      if (dataURL) {
        const { buffer, mime } = dataURLToBuffer(dataURL)
        if (mime.startsWith("image/")) media = { image: buffer }
        else if (mime.startsWith("video/")) media = { video: buffer }
        else if (mime.startsWith("audio/")) media = { audio: buffer }
        else media = { document: buffer }
      }

      for (const num of numbers) {
        const jid = num.includes("@s.whatsapp.net") ? num : num + "@s.whatsapp.net"
        let content = {}
        if (buttons?.length) content = { text: text || caption || "", buttons, headerType: 1 }
        else content = { text: text || caption || "" }
        if (media) Object.assign(content, media)
        await sock.sendMessage(jid, content)
        pushHistory({ date: new Date().toLocaleString(), to: num, text: text || caption, status: "Terkirim" })
      }
      socket.emit("sent_ok", { type: "broadcast" })
    } catch {
      socket.emit("error", "Gagal broadcast")
    }
  })

  socket.on("set_auto_reply", ({ keyword, reply }) => {
    autoReplies.push({ keyword, reply })
    socket.emit("sent_ok", { type: "auto_reply" })
  })
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () =>
  console.log("WA Tools Dashboard jalan di http://localhost:" + PORT)
)
