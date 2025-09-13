document.addEventListener('DOMContentLoaded', function () {
    // --- Elemen UI ---
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('overlay');
    const featureOverlay = document.getElementById('feature-overlay');
    
    // Elemen UI WhatsApp
    const connectBtn = document.getElementById('connect-wa-btn');
    const disconnectBtn = document.getElementById('disconnect-wa-btn');
    const statusDot = document.querySelector('.status-dot');
    const connectionStatus = document.getElementById('connection-status');
    const statusDescription = document.getElementById('status-description');

    // Socket
    const socket = io();

    // --- Sidebar & Overlay ---
    const openSidebar = () => { sidebar.classList.add('show'); overlay.classList.add('show'); };
    const closeSidebar = () => { sidebar.classList.remove('show'); overlay.classList.remove('show'); };

    if (sidebarToggle) sidebarToggle.addEventListener('click', (e) => { e.stopPropagation(); sidebar.classList.contains('show') ? closeSidebar() : openSidebar(); });
    if (overlay) overlay.addEventListener('click', closeSidebar);

    // --- UI State ---
    function setUIState(state) {
        if (state === 'connected') {
            statusDot.className = 'status-dot connected';
            connectionStatus.textContent = 'TERHUBUNG';
            statusDescription.textContent = 'Perangkat Anda berhasil terhubung.';
            connectBtn.classList.add('d-none');
            disconnectBtn.classList.remove('d-none');
            featureOverlay.classList.add('d-none');
        } else if (state === 'disconnected') {
            statusDot.className = 'status-dot disconnected';
            connectionStatus.textContent = 'TERPUTUS';
            statusDescription.textContent = 'Hubungkan perangkat Anda untuk memulai.';
            disconnectBtn.classList.add('d-none');
            connectBtn.classList.remove('d-none');
            featureOverlay.classList.remove('d-none');
        } else if (state === 'pending') {
            statusDot.className = 'status-dot pending';
            connectionStatus.textContent = 'MENUNGGU';
            statusDescription.textContent = 'Pindai QR atau masukkan Pairing Code...';
        }
    }

    // --- Modal QR ---
    function showQrLoginModal(qrText) {
        Swal.fire({
            title: 'Pindai QR Code',
            html: `<div id="qrcode"></div>`,
            showConfirmButton: false,
            allowOutsideClick: false,
            didOpen: () => {
                document.getElementById("qrcode").innerHTML = "";
                new QRCode(document.getElementById("qrcode"), { text: qrText, width: 220, height: 220 });
                setUIState('pending');
            }
        });
    }

    // --- Pairing Code Modal (loading + copy) ---
    function showPairingModal() {
        Swal.fire({
            title: 'Mendapatkan Pairing Code...',
            html: '<div class="spinner-border text-primary" role="status"></div>',
            showConfirmButton: false,
            allowOutsideClick: false
        });
        const phone = prompt("Masukkan nomor (format 62...):");
        if (phone) socket.emit("request_pairing", phone);
        else Swal.close();
    }

    // --- Koneksi Actions ---
    connectBtn.addEventListener('click', () => {
        Swal.fire({
            title: 'Pilih Metode Login',
            showDenyButton: true,
            confirmButtonText: 'QR Code',
            denyButtonText: 'Pairing Code'
        }).then((res) => {
            if (res.isConfirmed) {
                socket.emit("start"); // QR Mode
            }
            if (res.isDenied) {
                showPairingModal();
            }
        });
    });

    disconnectBtn.addEventListener('click', () => {
        Swal.fire({
            title: 'Anda Yakin?', text: "Koneksi WhatsApp akan diputus.", icon: 'warning',
            showCancelButton: true, confirmButtonColor: '#dc3545', cancelButtonColor: '#6c757d',
            confirmButtonText: 'Ya, Putuskan!', cancelButtonText: 'Batal'
        }).then((result) => {
            if (result.isConfirmed) {
                // Catatan: Baileys tidak punya "logout()" resmi v7 di contoh ini.
                // Untuk benar-benar logout, hapus folder ./session lalu restart.
                setUIState('disconnected');
                Swal.fire('Terputus!', 'Koneksi dianggap diputus. Jika masih terhubung, hapus folder session.', 'info');
            }
        });
    });

    // --- Socket Events ---
    socket.on("qr", (qr) => showQrLoginModal(qr));

    socket.on("pairing-code", (code) => {
        Swal.fire({
            title: 'Pairing Code',
            html: `
                <div class="input-group mb-3">
                  <input id="pairCodeInput" type="text" readonly class="form-control" value="${code}">
                  <button class="btn btn-outline-primary" id="copyPairBtn"><i class="fas fa-copy"></i></button>
                </div>
                <small>Masukkan kode ini di WhatsApp → <b>Linked Devices</b></small>
            `,
            showConfirmButton: false
        });
        document.getElementById("copyPairBtn").onclick = () => {
            navigator.clipboard.writeText(code);
            Swal.fire("Disalin!", "Pairing code berhasil disalin.", "success");
        };
        setUIState('pending');
    });

    socket.on("connection", (d) => {
        if (d.status === "open" || d.status === "maybe-open") {
            Swal.close();
            setUIState("connected");
            Swal.fire("Berhasil!", "WhatsApp terhubung.", "success");
        } else {
            setUIState("disconnected");
            if (d.code) {
                // info kecil saat mencoba reconnect
                console.log("WS closed with code:", d.code);
            }
        }
    });

    socket.on("sent_ok", (d) => Swal.fire("Sukses", `Aksi: ${d.type}`, "success"));
    socket.on("error", (e) => Swal.fire("Error", e, "error"));

    // --- DataTables (History) ---
    const table = new DataTable('#history-table', {
        responsive: true,
        language: { url: '//cdn.datatables.net/plug-ins/2.0.8/i18n/id.json' }
    });
    socket.on("history_update", (rows) => {
        table.clear();
        rows.forEach(r => {
            table.row.add([
                r.date,
                r.to,
                $('<div/>').text(r.text).html(), // escape
                `<span class="badge ${r.status==='Terkirim' || r.status==='Auto Reply' ? 'bg-success-light' : 'bg-danger-light'}">${r.status}</span>`
            ]);
        });
        table.draw(false);
    });

    // --- Form Kirim Pesan (single) ---
    document.getElementById("form-send-message").addEventListener("submit", (e) => {
        e.preventDefault();
        const number = e.target.querySelector("input").value.trim();
        const text = e.target.querySelector("textarea").value.trim();
        const btnInput = document.getElementById("singleButtonsInput");
        const file = document.getElementById("singleFile").files[0];
        const caption = document.getElementById("singleCaption").value.trim();

        if (!number || (!text && !file)) {
            return Swal.fire("Error", "Isi nomor dan minimal salah satu dari pesan atau media.", "error");
        }

        let buttons = [];
        if (btnInput && btnInput.value.trim()) {
            try { buttons = JSON.parse(btnInput.value) } catch { return Swal.fire("Error", "Format JSON tombol salah", "error") }
        }

        // Prioritas: jika ada buttons → gunakan send_buttons (opsional media).
        if (buttons.length) {
            if (file) {
                const r = new FileReader()
                r.onload = () => socket.emit("send_buttons", { number, text, buttons, dataURL: r.result, caption })
                r.readAsDataURL(file)
            } else {
                socket.emit("send_buttons", { number, text, buttons })
            }
            e.target.reset()
            return
        }

        // Jika tidak ada buttons: kirim text / media
        if (file) {
            const r = new FileReader()
            r.onload = () => socket.emit("send_media", { number, dataURL: r.result, caption, fileName: file.name })
            r.readAsDataURL(file)
        } else {
            socket.emit("send_message", { number, text })
        }
        e.target.reset()
    })

    // --- Form Broadcast ---
    document.getElementById("form-broadcast").addEventListener("submit", (e) => {
        e.preventDefault()
        const areas = e.target.querySelectorAll("textarea")
        const numbersRaw = areas[0].value.trim()
        const text = areas[1].value.trim()
        const numbers = numbersRaw.split(/[, \n]+/).map(s => s.trim()).filter(Boolean)
        const file = document.getElementById("bcFile").files[0]
        const caption = document.getElementById("bcCaption").value.trim()
        let buttons = []
        const bcButtons = document.getElementById("bcButtons").value.trim()
        if (bcButtons) { try { buttons = JSON.parse(bcButtons) } catch { return Swal.fire("Error", "Format JSON tombol salah", "error") } }

        if (!numbers.length || (!text && !file && !buttons.length)) {
            return Swal.fire("Error", "Isi daftar nomor dan minimal salah satu dari pesan/media/buttons.", "error")
        }

        if (file) {
            const r = new FileReader()
            r.onload = () => socket.emit("send_broadcast", { numbers, text, dataURL: r.result, caption, buttons })
            r.readAsDataURL(file)
        } else {
            socket.emit("send_broadcast", { numbers, text, buttons })
        }
        e.target.reset()
    })

    // --- Auto Reply ---
    document.getElementById("form-auto-reply").addEventListener("submit", (e) => {
        e.preventDefault()
        const keyword = e.target.querySelector("input").value.trim()
        const reply = e.target.querySelector("textarea").value.trim()
        if (!keyword || !reply) return Swal.fire("Error", "Isi keyword & balasan", "error")
        socket.emit("set_auto_reply", { keyword, reply })
        e.target.reset()
    })

    // State awal
    setUIState('disconnected');
});
