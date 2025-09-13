document.addEventListener('DOMContentLoaded', function () {
  const socket = io()
  const connectBtn = document.getElementById('connect-wa-btn')
  const disconnectBtn = document.getElementById('disconnect-wa-btn')
  const statusDot = document.querySelector('.status-dot')
  const connectionStatus = document.getElementById('connection-status')
  const statusDescription = document.getElementById('status-description')
  const featureOverlay = document.getElementById('feature-overlay')
  const sidebarToggle = document.getElementById("sidebar-toggle")
  const sidebar = document.getElementById("sidebar")
  const overlay = document.getElementById("overlay")

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
    return values.filter(v=>v.trim()!=="").map((txt,i)=>({
      buttonId:"btn"+(i+1),
      buttonText:{displayText:txt.trim()},
      type:1
    }))
  }

  // Sidebar
  sidebarToggle.addEventListener("click", ()=>sidebar.classList.toggle("show"))
  overlay.addEventListener("click", ()=>sidebar.classList.remove("show"))

  // Connect
  connectBtn.addEventListener('click', () => {
    Swal.fire({
      title: 'Pilih Login',
      showDenyButton: true,
      confirmButtonText: 'QR Code',
      denyButtonText: 'Pairing Code'
    }).then((res) => {
      if (res.isConfirmed) socket.emit("start")
      if (res.isDenied) {
        const phone = prompt("Masukkan nomor (62...)")
        if (phone) socket.emit("request_pairing", phone)
      }
    })
  })

  disconnectBtn.addEventListener('click', () => {
    Swal.fire("Info", "Untuk logout hapus folder ./session lalu restart server.", "info")
    setUIState("disconnected")
  })

  // QR
  let qrTimerInterval
  socket.on("qr", (qr) => {
    let countdown = 30
    clearInterval(qrTimerInterval)
    Swal.fire({
      title: "Scan QR",
      html: `<div class="qr-box"><div id="qrcode"></div><div class="qr-timer">Kadaluarsa <span id="qr-countdown">${countdown}</span>d</div></div>`,
      allowOutsideClick: false,
      showConfirmButton: false,
      didOpen: () => {
        document.getElementById("qrcode").innerHTML = ""
        new QRCode(document.getElementById("qrcode"), { text: qr, width: 220, height: 220 })
        qrTimerInterval = setInterval(()=>{
          countdown--;const el=document.getElementById("qr-countdown");if(el)el.innerText=countdown
          if(countdown<=0){clearInterval(qrTimerInterval);Swal.update({html:`<p class='text-danger'>QR expired, tunggu refresh...</p>`})}
        },1000)
      },
      willClose: ()=>clearInterval(qrTimerInterval)
    })
  })

  // Pairing
  socket.on("pairing-code", (code) => {
    let countdown = 60
    let timer = setInterval(()=>{
      countdown--;const el=document.getElementById("pair-countdown");if(el)el.innerText=countdown
      if(countdown<=0){clearInterval(timer);Swal.update({html:`<p class='text-danger'>Kode kadaluarsa.</p>`})}
    },1000)
    Swal.fire({
      title:"Masukkan Kode di WhatsApp",
      html:`<div class="pair-code">${code}</div><button id="copyPairBtn" class="btn btn-outline-primary">Copy</button><div class="pair-expire">Kadaluarsa <span id="pair-countdown">${countdown}</span>d</div>`,
      showConfirmButton:false,
      didOpen:()=>{
        document.getElementById("copyPairBtn").onclick=()=>{navigator.clipboard.writeText(code);Swal.fire("Disalin!","","success")}
      },
      willClose:()=>clearInterval(timer)
    })
  })

  socket.on("connection",(d)=>setUIState(d.status==="open"?"connected":"disconnected"))

  // Toggle form
  $("#useMediaSingle").on("change",function(){$("#mediaSingleFields").toggleClass("d-none",!this.checked)})
  $("#useButtonsSingle").on("change",function(){$("#buttonsSingleFields").toggleClass("d-none",!this.checked)})
  $("#useMediaBc").on("change",function(){$("#mediaBcFields").toggleClass("d-none",!this.checked)})
  $("#useButtonsBc").on("change",function(){$("#buttonsBcFields").toggleClass("d-none",!this.checked)})

  // Send Message
  document.getElementById("form-send-message").addEventListener("submit",e=>{
    e.preventDefault()
    const number=e.target.querySelector("input").value
    const text=e.target.querySelector("textarea").value
    const useMedia=document.getElementById("useMediaSingle").checked
    const useButtons=document.getElementById("useButtonsSingle").checked
    const buttons=useButtons?buildButtons([btn1.value,btn2.value,btn3.value]):[]
    const file=document.getElementById("singleFile").files[0]
    const caption=document.getElementById("singleCaption").value
    if(useButtons&&buttons.length){
      if(useMedia&&file){
        const r=new FileReader();r.onload=()=>socket.emit("send_buttons",{number,text,buttons,dataURL:r.result,caption});r.readAsDataURL(file)
      }else socket.emit("send_buttons",{number,text,buttons})
    }else if(useMedia&&file){
      const r=new FileReader();r.onload=()=>socket.emit("send_media",{number,dataURL:r.result,caption,fileName:file.name});r.readAsDataURL(file)
    }else socket.emit("send_message",{number,text})
  })

  // Broadcast
  document.getElementById("form-broadcast").addEventListener("submit",e=>{
    e.preventDefault()
    const numbers=e.target.querySelector("textarea").value.split(/,|\n/).map(n=>n.trim()).filter(Boolean)
    const text=e.target.querySelectorAll("textarea")[1].value
    const useMedia=document.getElementById("useMediaBc").checked
    const useButtons=document.getElementById("useButtonsBc").checked
    const buttons=useButtons?buildButtons([bcBtn1.value,bcBtn2.value,bcBtn3.value]):[]
    const file=document.getElementById("bcFile").files[0]
    const caption=document.getElementById("bcCaption").value
    if(useMedia&&file){
      const r=new FileReader();r.onload=()=>socket.emit("send_broadcast",{numbers,text,dataURL:r.result,caption,buttons});r.readAsDataURL(file)
    }else socket.emit("send_broadcast",{numbers,text,buttons})
  })

  // Auto reply
  document.getElementById("form-auto-reply").addEventListener("submit",e=>{
    e.preventDefault()
    const keyword=e.target.querySelector("input").value
    const reply=e.target.querySelector("textarea").value
    socket.emit("set_auto_reply",{keyword,reply})
  })

  // History
  socket.on("history_update",(rows)=>{
    const tbody=document.querySelector("#history-table tbody");tbody.innerHTML=""
    rows.forEach(r=>{
      const tr=document.createElement("tr")
      tr.innerHTML=`<td>${r.date}</td><td>${r.to}</td><td>${r.text}</td><td>${r.status}</td>`
      tbody.appendChild(tr)
    })
  })

  setUIState("disconnected")
})
