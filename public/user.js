document.addEventListener('DOMContentLoaded', function () {
  const connectBtn = document.getElementById('connect-wa-btn')
  const disconnectBtn = document.getElementById('disconnect-wa-btn')
  const statusDot = document.querySelector('.status-dot')
  const connectionStatus = document.getElementById('connection-status')
  const statusDescription = document.getElementById('status-description')
  const featureOverlay = document.getElementById('feature-overlay')
  const socket = io()

  function setUIState(state) {
    if (state === 'connected') {
      statusDot.className = 'status-dot connected'
      connectionStatus.textContent = 'TERHUBUNG'
      statusDescription.textContent = 'WhatsApp berhasil terhubung.'
      connectBtn.classList.add('d-none')
      disconnectBtn.classList.remove('d-none')
      featureOverlay.classList.add('d-none')
    } else {
      statusDot.className = 'status-dot disconnected'
      connectionStatus.textContent = 'TERPUTUS'
      statusDescription.textContent = 'Hubungkan perangkat Anda untuk memulai.'
      disconnectBtn.classList.add('d-none')
      connectBtn.classList.remove('d-none')
      featureOverlay.classList.remove('d-none')
    }
  }

  function buildButtons(values) {
    const buttons = []
    values.forEach((txt, idx) => {
      if (txt && txt.trim() !== "") {
        buttons.push({
          buttonId: `btn${idx+1}`,
          buttonText: { displayText: txt.trim() },
          type: 1
        })
      }
    })
    return buttons
  }

  // Login
  connectBtn.addEventListener('click', () => {
    Swal.fire({
      title: 'Pilih Login',
      showDenyButton: true,
      confirmButtonText: 'QR Code',
      denyButtonText: 'Pairing Code'
    }).then((res) => {
      if (res.isConfirmed) socket.emit("start")
      if (res.isDenied) {
        const phone = prompt("Masukkan nomor (format 62...)")
        if (phone) socket.emit("request_pairing", phone)
      }
    })
  })

  disconnectBtn.addEventListener('click', () => {
    Swal.fire("Info", "Untuk logout hapus folder ./session lalu restart server.", "info")
    setUIState("disconnected")
  })

  // Socket
  socket.on("qr", (qr) => {
    Swal.fire({title:"Scan QR",html:`<div id="qrcode"></div>`,showConfirmButton:false})
    new QRCode(document.getElementById("qrcode"), { text: qr, width: 220, height: 220 })
  })
  socket.on("pairing-code", (code) => {
    Swal.fire({title:"Pairing Code",html:`<input type="text" class="form-control" value="${code}" readonly>`})
  })
  socket.on("connection", (d)=> setUIState(d.status==="open"?"connected":"disconnected"))
  socket.on("sent_ok", (d)=> Swal.fire("Sukses", d.type, "success"))
  socket.on("error", (e)=> Swal.fire("Error", e, "error"))

  // History
  const table = new DataTable('#history-table',{responsive:true})
  socket.on("history_update",(rows)=>{
    table.clear()
    rows.forEach(r=> table.row.add([r.date,r.to,r.text,r.status]))
    table.draw()
  })

  // Send Single
  document.getElementById("form-send-message").addEventListener("submit",(e)=>{
    e.preventDefault()
    const number = e.target.querySelector("input").value.trim()
    const text = e.target.querySelector("textarea").value.trim()
    const file = document.getElementById("singleFile").files[0]
    const caption = document.getElementById("singleCaption").value.trim()
    const buttons = buildButtons([
      document.getElementById("btn1").value,
      document.getElementById("btn2").value,
      document.getElementById("btn3").value
    ])
    if (buttons.length) {
      if (file) {
        const r = new FileReader()
        r.onload = ()=> socket.emit("send_buttons",{number,text,buttons,dataURL:r.result,caption})
        r.readAsDataURL(file)
      } else {
        socket.emit("send_buttons",{number,text,buttons})
      }
    } else if (file) {
      const r = new FileReader()
      r.onload = ()=> socket.emit("send_media",{number,dataURL:r.result,caption,fileName:file.name})
      r.readAsDataURL(file)
    } else {
      socket.emit("send_message",{number,text})
    }
    e.target.reset()
  })

  // Broadcast
  document.getElementById("form-broadcast").addEventListener("submit",(e)=>{
    e.preventDefault()
    const areas = e.target.querySelectorAll("textarea")
    const numbersRaw = areas[0].value.trim()
    const text = areas[1].value.trim()
    const numbers = numbersRaw.split(/[, \n]+/).map(s=>s.trim()).filter(Boolean)
    const file = document.getElementById("bcFile").files[0]
    const caption = document.getElementById("bcCaption").value.trim()
    const buttons = buildButtons([
      document.getElementById("bcBtn1").value,
      document.getElementById("bcBtn2").value,
      document.getElementById("bcBtn3").value
    ])
    if (file) {
      const r = new FileReader()
      r.onload = ()=> socket.emit("send_broadcast",{numbers,text,dataURL:r.result,caption,buttons})
      r.readAsDataURL(file)
    } else {
      socket.emit("send_broadcast",{numbers,text,buttons})
    }
    e.target.reset()
  })

  // Auto Reply
  document.getElementById("form-auto-reply").addEventListener("submit",(e)=>{
    e.preventDefault()
    const keyword = e.target.querySelector("input").value.trim()
    const reply = e.target.querySelector("textarea").value.trim()
    socket.emit("set_auto_reply",{keyword,reply})
    e.target.reset()
  })

  setUIState("disconnected")
})
