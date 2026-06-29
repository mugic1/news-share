// ─── DOM refs ───────────────────────────────────────────────
const peerIdDiv = document.getElementById("peerId");
const peerInput = document.getElementById("peerInput");
const connectBtn = document.getElementById("connectBtn");
const statusDiv = document.getElementById("status");
const sendBtn = document.getElementById("sendBtn");
const messageInput = document.getElementById("messageInput");
const messagesDiv = document.getElementById("messages");
const fileInput = document.getElementById("fileInput");
const sendFilesBtn = document.getElementById("sendFilesBtn");
const transfersDiv = document.getElementById("transfers");
const downloadsDiv = document.getElementById("downloads");
const downloadAllBtn = document.getElementById("downloadAllBtn");
const dropzone = document.getElementById("dropzone");
const speedDisplay = document.getElementById("speedDisplay");

// ─── TURBO CHUNK & BUFFER SETTINGS ────────────────────────
const CHUNK_SIZE = 16 * 1024 * 1024;          // 16 MB base chunk
const HIGH_WATER = 128 * 1024 * 1024;         // pause above 128 MB
const LOW_WATER = 16 * 1024 * 1024;           // resume below 16 MB

let conn;
let reconnectId = "";
let receivedFiles = [];
let incomingFiles = {};

// ─── Speed tracking ────────────────────────────────────────
let speedBytes = 0;
let speedLastUpdate = performance.now();

function updateSpeedDisplay(bytesSent) {
  speedBytes += bytesSent;
  const now = performance.now();
  if (now - speedLastUpdate > 500) {
    const mbps = (speedBytes / (now - speedLastUpdate)) * 8 / 1e6;
    speedDisplay.textContent =
      mbps > 1
        ? `${mbps.toFixed(1)} Mbps`
        : `${(speedBytes / (now - speedLastUpdate) * 1e3 / 1e6).toFixed(1)} MB/s`;
    speedBytes = 0;
    speedLastUpdate = now;
  }
}

// ─── PeerJS ─────────────────────────────────────────────────
const peer = new Peer({
  config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }
});

peer.on("open", (id) => {
  peerIdDiv.innerText = id;
  QRCode.toCanvas(document.getElementById("qrCanvas"), id, { width: 220 });
});

peer.on("connection", (connection) => setupConnection(connection));

// ─── Connection setup ──────────────────────────────────────
function setupConnection(connection) {
  conn = connection;
  reconnectId = connection.peer;

  conn.on("open", () => { statusDiv.innerText = "Connected"; });
  conn.on("close", () => { statusDiv.innerText = "Disconnected";
    autoReconnect(); });
  conn.on("error", () => { autoReconnect(); });

  conn.on("data", (data) => {
    if (data.type === "message") {
      addMessage("Peer: " + data.text);
    }
    if (data.type === "file-meta") {
      incomingFiles[data.fileId] = {
        name: data.name,
        size: data.size,
        mime: data.mime,
        chunks: [],
        received: 0
      };
      createProgress(data.fileId, data.name);
    }
    if (data.type === "file-chunk") {
      const file = incomingFiles[data.fileId];
      if (!file) return;
      file.chunks.push(data.chunk);
      file.received += data.chunk.byteLength;
      const percent = Math.floor((file.received / file.size) * 100);
      updateProgress(data.fileId, percent);
      if (file.received >= file.size) {
        const blob = new Blob(file.chunks, { type: file.mime });
        receivedFiles.push({ name: file.name, blob });
        showDownload(file.name, blob, file.mime);
        delete incomingFiles[data.fileId];
      }
    }
  });
}

// ─── Reconnect ─────────────────────────────────────────────
function autoReconnect() {
  if (!reconnectId) return;
  statusDiv.innerText = "Reconnecting…";
  setTimeout(() => {
    const connection = peer.connect(reconnectId, { reliable: true });
    setupConnection(connection);
  }, 2000);
}

connectBtn.onclick = () => {
  const id = peerInput.value.trim();
  if (!id) return;
  const connection = peer.connect(id, { reliable: true });
  setupConnection(connection);
};

// ─── Messaging ─────────────────────────────────────────────
function addMessage(text, self = false) {
  const div = document.createElement("div");
  div.className = "message" + (self ? " self" : "");
  div.innerText = text;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

sendBtn.onclick = () => {
  const text = messageInput.value.trim();
  if (!text || !conn) return;
  conn.send({ type: "message", text });
  addMessage("You: " + text, true);
  messageInput.value = "";
};

// ─── Progress UI ───────────────────────────────────────────
function createProgress(id, name) {
  const div = document.createElement("div");
  div.className = "progress-wrap";
  div.innerHTML = `
    <p>${name}</p>
    <div class="progress">
      <div class="progress-bar" id="bar-${id}"></div>
    </div>
  `;
  transfersDiv.appendChild(div);
}

function updateProgress(id, percent) {
  const bar = document.getElementById(`bar-${id}`);
  if (bar) bar.style.width = percent + "%";
}

// ─── SUPER‑FAST BACK‑PRESSURE ─────────────────────────────
async function waitForBuffer(dataChannel) {
  if (!dataChannel) return;
  while (dataChannel.bufferedAmount > HIGH_WATER) {
    await new Promise((resolve) => {
      let resolved = false;

      const onLow = () => {
        if (!resolved) {
          resolved = true;
          dataChannel.removeEventListener("bufferedamountlow", onLow);
          resolve();
        }
      };
      dataChannel.addEventListener("bufferedamountlow", onLow, { once: true });

      // Poll every 2 ms – nearly zero delay
      const interval = setInterval(() => {
        if (dataChannel.bufferedAmount <= HIGH_WATER) {
          clearInterval(interval);
          if (!resolved) {
            resolved = true;
            dataChannel.removeEventListener("bufferedamountlow", onLow);
            resolve();
          }
        }
      }, 2);

      // Safety net: resolve after 2 seconds
      setTimeout(() => {
        clearInterval(interval);
        if (!resolved) {
          resolved = true;
          dataChannel.removeEventListener("bufferedamountlow", onLow);
          resolve();
        }
      }, 2000);
    });
  }
}

// ─── SEND FILE – TURBO ─────────────────────────────────────
async function sendFile(file) {
  const fileId = crypto.randomUUID();
  createProgress(fileId, file.name);

  conn.send({
    type: "file-meta",
    fileId,
    name: file.name,
    size: file.size,
    mime: file.type
  });

  let offset = 0;
  let sent = 0;
  const dataChannel = conn.dataChannel || null;

  // adaptive chunk size
  let chunkSize = CHUNK_SIZE;
  if (file.size > 500 * 1024 * 1024) chunkSize = 64 * 1024 * 1024;
  else if (file.size > 100 * 1024 * 1024) chunkSize = 32 * 1024 * 1024;

  while (offset < file.size) {
    const slice = file.slice(offset, offset + chunkSize);
    const buffer = await slice.arrayBuffer();

    await waitForBuffer(dataChannel);

    conn.send({
      type: "file-chunk",
      fileId,
      chunk: buffer
    });

    sent += buffer.byteLength;
    offset += chunkSize;
    updateSpeedDisplay(buffer.byteLength);

    const percent = Math.floor((sent / file.size) * 100);
    // update every 2% to keep UI responsive
    if (percent % 2 === 0 || percent >= 100) {
      updateProgress(fileId, percent);
    }
  }
  updateProgress(fileId, 100);
}

// ─── Send multiple files ──────────────────────────────────
sendFilesBtn.onclick = async () => {
  const files = [...fileInput.files];
  if (!files.length || !conn) return;
  speedBytes = 0;
  speedLastUpdate = performance.now();
  for (const file of files) {
    await sendFile(file);
  }
};

// ─── Download UI ───────────────────────────────────────────
function showDownload(name, blob, mime) {
  const url = URL.createObjectURL(blob);
  const div = document.createElement("div");
  div.className = "download-item";
  let preview = "";
  if (mime.startsWith("image/")) {
    preview = `<img src="${url}">`;
  }
  if (mime.startsWith("video/")) {
    preview = `<video controls><source src="${url}"></video>`;
  }
  div.innerHTML = `
    <b>${name}</b><br><br>
    <a href="${url}" download="${name}">Download</a>
    ${preview}
  `;
  downloadsDiv.appendChild(div);
}

downloadAllBtn.onclick = async () => {
  const zip = new JSZip();
  receivedFiles.forEach((file) => zip.file(file.name, file.blob));
  const content = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(content);
  a.download = "PeerDropFiles.zip";
  a.click();
};

// ─── Drag & Drop ───────────────────────────────────────────
dropzone.addEventListener("dragover", (e) => e.preventDefault());
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  fileInput.files = e.dataTransfer.files;
});

// ─── QR Scanner ────────────────────────────────────────────
document.getElementById("scanBtn").onclick = async () => {
  const scanner = new Html5Qrcode("reader");
  scanner.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: 250 },
    (decodedText) => {
      peerInput.value = decodedText;
      scanner.stop();
    }
  );
};

// ─── Service Worker ────────────────────────────────────────
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
}

console.log("⚡ PeerDrop Ultra – turbo mode active");
