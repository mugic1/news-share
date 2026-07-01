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

// ─── UNLOCKED BUFFER CHUNKS FOR MAXIMUM SPEED OVER NATIVE SCTP ───
const CHUNK_SIZE = 256 * 1024;                 // 256 KB Chunks
const HIGH_WATER = 8 * 1024 * 1024;           // 8 MB Max Buffer
const LOW_WATER = 4 * 1024 * 1024;            // 4 MB Min Buffer

let conn;
let reconnectId = "";
let receivedFiles = [];
let incomingFiles = {};

// Universal Bi-directional Speed tracking
let speedBytes = 0;
let speedLastUpdate = performance.now();

function updateSpeedDisplay(bytesProcessed) {
  if (!speedDisplay) return;
  speedBytes += bytesProcessed;
  const now = performance.now();
  if (now - speedLastUpdate > 1000) { 
    const mbs = (speedBytes / (now - speedLastUpdate) * 1e3 / (1024 * 1024));
    speedDisplay.textContent = `⚡ ${mbs.toFixed(1)} MB/s`;
    speedBytes = 0;
    speedLastUpdate = now;
  }
}

dropzone.onclick = () => fileInput.click();

const peer = new Peer({
  config: {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  }
});

peer.on("open", id => {
  peerIdDiv.innerText = id;
  QRCode.toCanvas(document.getElementById("qrCanvas"), id, { width: 150 });
});

peer.on("connection", connection => {
  setupConnection(connection);
});

function setupConnection(connection) {
  conn = connection;
  reconnectId = connection.peer;

  conn.on("open", () => {
    statusDiv.innerText = "Connected";
    statusDiv.className = "status-pill connected";
  });

  conn.on("close", () => {
    statusDiv.innerText = "Disconnected";
    statusDiv.className = "status-pill disconnected";
    autoReconnect();
  });

  conn.on("error", () => {
    autoReconnect();
  });

  let lastReceivedPercent = -1;

  conn.on("data", data => {
    if (data.type === "message") {
      addMessage("Partner: " + data.text);
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
      lastReceivedPercent = -1;
      
      // Reset speed counters on incoming metadata
      speedBytes = 0;
      speedLastUpdate = performance.now();
    }

    if (data.type === "file-chunk") {
      const file = incomingFiles[data.fileId];
      if (!file) return;

      file.chunks.push(data.chunk);
      file.received += data.chunk.byteLength;

      // FIX: Call speedometer on receiver side so it displays speed actively too!
      updateSpeedDisplay(data.chunk.byteLength);

      const percent = Math.floor((file.received / file.size) * 100);
      if (percent !== lastReceivedPercent) {
        updateProgress(data.fileId, percent);
        lastReceivedPercent = percent;
      }

      if (file.received >= file.size) {
        const blob = new Blob(file.chunks, { type: file.mime });
        receivedFiles.push({ name: file.name, blob });
        showDownload(file.name, blob, file.mime);
        delete incomingFiles[data.fileId];
      }
    }
  });
}

function autoReconnect() {
  if (!reconnectId) return;
  statusDiv.innerText = "Reconnecting...";
  statusDiv.className = "status-pill disconnected";
  setTimeout(() => {
    // FIX: Removed {reliable: true} to unlock direct native browser performance
    const connection = peer.connect(reconnectId);
    setupConnection(connection);
  }, 2000);
}

connectBtn.onclick = () => {
  const id = peerInput.value.trim();
  if (!id) return;
  // FIX: Removed {reliable: true} to allow raw WebRTC data pipeline acceleration
  const connection = peer.connect(id);
  setupConnection(connection);
};

function addMessage(text, self = false) {
  const div = document.createElement("div");
  div.className = "message";
  if (self) div.classList.add("self");
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
  transfersDiv.scrollTop = transfersDiv.scrollHeight;
}

function updateProgress(id, percent) {
  const bar = document.getElementById(`bar-${id}`);
  if (bar) bar.style.width = percent + "%";
}

async function waitForBuffer(dataChannel) {
  if (!dataChannel) return;
  while (dataChannel.bufferedAmount > HIGH_WATER) {
    await new Promise(resolve => {
      if (dataChannel.bufferedAmountLowThreshold !== undefined) {
        dataChannel.bufferedAmountLowThreshold = LOW_WATER;
        dataChannel.addEventListener("bufferedamountlow", resolve, { once: true });
      } else {
        setTimeout(resolve, 1);
      }
    });
  }
}

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
  let lastSentPercent = -1;
  const dataChannel = conn.dataChannel || null;

  speedBytes = 0;
  speedLastUpdate = performance.now();

  while (offset < file.size) {
    const slice = file.slice(offset, offset + CHUNK_SIZE);
    const buffer = await slice.arrayBuffer();

    await waitForBuffer(dataChannel);

    conn.send({ type: "file-chunk", fileId, chunk: buffer });

    sent += buffer.byteLength;
    offset += CHUNK_SIZE;

    updateSpeedDisplay(buffer.byteLength);

    const percent = Math.floor((sent / file.size) * 100);
    if (percent !== lastSentPercent) {
      updateProgress(fileId, percent);
      lastSentPercent = percent;
    }
  }
}

sendFilesBtn.onclick = async () => {
  const files = [...fileInput.files];
  if (!files.length || !conn) return;
  for (const file of files) {
    await sendFile(file);
  }
};

function showDownload(name, blob, mime) {
  const url = URL.createObjectURL(blob);
  const div = document.createElement("div");
  div.className = "download-item";
  let preview = "";

  if (mime.startsWith("image/")) preview = `<img src="${url}">`;
  if (mime.startsWith("video/")) preview = `<video controls><source src="${url}"></video>`;

  div.innerHTML = `
    <b>${name}</b><br><br>
    <a href="${url}" download="${name}">Download File</a>
    ${preview}
  `;
  downloadsDiv.appendChild(div);
  downloadsDiv.scrollTop = downloadsDiv.scrollHeight;
}

downloadAllBtn.onclick = async () => {
  if (!receivedFiles.length) return;
  const zip = new JSZip();
  receivedFiles.forEach(file => zip.file(file.name, file.blob));
  const content = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(content);
  a.download = "PeerDropFiles.zip";
  a.click();
};

dropzone.addEventListener("dragover", e => e.preventDefault());
dropzone.addEventListener("drop", e => {
  e.preventDefault();
  fileInput.files = e.dataTransfer.files;
});

document.getElementById("scanBtn").onclick = async () => {
  const scanner = new Html5Qrcode("reader");
  scanner.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: 250 },
    decodedText => {
      peerInput.value = decodedText;
      scanner.stop();
    }
  ).catch(err => console.log("Scanner error: ", err));
};

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
}
