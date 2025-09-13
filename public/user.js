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

  // pilih metode login
  connectBtn.addEventListener('click', () => {
    Swal.fire({
      title: 'Pilih Login',
      showDenyButton: true,
      confirmButtonText: 'QR Code',
      denyButtonText: 'Pairing Code'
    }).then((res) => {
      if (res.isConfirmed) socket.emit("start")
      if (res.isDenied) {
        const phone = prompt("Masukkan nomor 62...")
        if (phone) socket.emit("request_pairing", phone)
      }
    })
  })

  // disconnect
  disconnectBtn.addEventListener('click', () => {
    Swal.fire("Info","Untuk logout hapus folder ./session dan restart server.","info")
    setUIState("disconnected")
  })

  // socket events
  socket.on("qr", (qr) => {
    Swal.fire({
      title: 'Scan QR',
      html: `<div id="qrcode"></div>`,
      showConfirmButton: false,
      allowOutsideClick: false,
      didOpen: () => {
        document.getElementById("qrcode").innerHTML = ""
        new QRCode(document.getElementById("qrcode"), { text: qr, width: 220, height: 220 })
      }
    })
  })

  socket.on("pairing-code", (code) => {
    Swal.fire({
      title: 'Pairing Code',
      html: `<div class="input-group"><input id="pairCodeInput" type="text" class="form-control" value="${code}" readonly><button class="btn btn-outline-primary" id="copyPairBtn"><i class="fas fa-copy"></i></button></div>`,
      showConfirmButton: false
    })
    document.getElementById("copyPairBtn").onclick = () => {
      navigator.clipboard.writeText(code)
      Swal.fire("Disalin!","Pairing code disalin.","success")
    }
  })

  socket.on("connection", (d) => {
    if (d.status === "open" || d.status === "maybe-open") {
      Swal.close()
      setUIState("connected")
    } else {
      setUIState("disconnected")
    }
  })

  socket.on("sent_ok", (d) => Swal.fire("Sukses", `Aksi: ${d.type}`, "success"))
  socket.on("error", (e) => Swal.fire("Error", e, "error"))

  // kirim pesan
  document.getElementById("form-send-message").addEventListener("submit",(e)=>{
    e.preventDefault()
    const number = e.target.querySelector("input").value.trim()
    const text = e.target.querySelector("textarea").value.trim()
    socket.emit("send_message",{number,text})
    e.target.reset()
  })

  // auto reply
  document.getElementById("form-auto-reply").addEventListener("submit",(e)=>{
    e.preventDefault()
    const keyword = e.target.querySelector("input").value.trim()
    const reply = e.target.querySelector("textarea").value.trim()
    socket.emit("set_auto_reply",{keyword,reply})
    e.target.reset()
  })

  // datatable
  const table = new DataTable('#history-table',{responsive:true})
  socket.on("history_update",(rows)=>{
    table.clear()
    rows.forEach(r=>{
      table.row.add([r.date,r.to,r.text,r.status])
    })
    table.draw()
  })

  setUIState("disconnected")
})
