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

// Optimized block chunks for high-throughput browser data transfer
const CHUNK_SIZE = 256 * 1024; 
let conn;
let reconnectId = "";
let receivedFiles = [];
let incomingFiles = {};

// Unified Speed Counter Engine
let speedBytes = 0;
let speedLastUpdate = performance.now();

function calcLiveSpeed(bytesRead) {
  speedBytes += bytesRead;
  const now = performance.now();
  if (now - speedLastUpdate >= 1000) {
    const mbs = (speedBytes / (1024 * 1024)) / ((now - speedLastUpdate) / 1000);
    if (speedDisplay) speedDisplay.innerText = `⚡ ${mbs.toFixed(1)} MB/s`;
    speedBytes = 0;
    speedLastUpdate = now;
  }
}

dropzone.onclick = () => fileInput.click();

const peer = new Peer({
  config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }
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
    statusDiv.className = "status-online";
  });

  conn.on("close", () => {
    statusDiv.innerText = "Disconnected";
    statusDiv.className = "status-offline";
    autoReconnect();
  });

  conn.on("error", () => { autoReconnect(); });

  conn.on("data", data => {
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
      speedBytes = 0;
      speedLastUpdate = performance.now();
    }

    if (data.type === "file-chunk") {
      const file = incomingFiles[data.fileId];
      if (!file) return;

      file.chunks.push(data.chunk);
      file.received += data.chunk.byteLength;

      // FIX: Call live speed counter inside incoming data block for the Receiver side
      calcLiveSpeed(data.chunk.byteLength);

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

function autoReconnect() {
  if (!reconnectId) return;
  statusDiv.innerText = "Reconnecting...";
  statusDiv.className = "status-offline";
  setTimeout(() => {
    // FIX: Removed {reliable: true} wrapper to unleash hardware-accelerated connection speeds
    const connection = peer.connect(reconnectId);
    setupConnection(connection);
  }, 2000);
}

connectBtn.onclick = () => {
  const id = peerInput.value.trim();
  if (!id) return;
  // FIX: Removed {reliable: true} to fully open WebRTC throughput pipeline
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
  div.innerHTML = `<p>${name}</p><div class="progress"><div class="progress-bar" id="bar-${id}"></div></div>`;
  transfersDiv.appendChild(div);
  transfersDiv.scrollTop = transfersDiv.scrollHeight;
}

function updateProgress(id, percent) {
  const bar = document.getElementById(`bar-${id}`);
  if (bar) bar.style.width = percent + "%";
}

async function waitForBuffer(dataChannel) {
  const HIGH_WATER = 4 * 1024 * 1024;
  const LOW_WATER = 512 * 1024;
  if (!dataChannel) return;
  while (dataChannel.bufferedAmount > HIGH_WATER) {
    await new Promise(resolve => {
      if (dataChannel.bufferedAmountLowThreshold !== undefined) {
        dataChannel.bufferedAmountLowThreshold = LOW_WATER;
        dataChannel.addEventListener("bufferedamountlow", resolve, { once: true });
      } else {
        setTimeout(resolve, 30);
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

    calcLiveSpeed(buffer.byteLength);

    const percent = Math.floor((sent / file.size) * 100);
    updateProgress(fileId, percent);
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

  div.innerHTML = `<b>${name}</b><br><br><a href="${url}" download="${name}">Download</a>${preview}`;
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
  );
};

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
}
