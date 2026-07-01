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

// Optimized Chunk Size to reduce network packet overhead
const CHUNK_SIZE = 512 * 1024; // 512 KB Balanced standard
let conn;
let reconnectId = "";
let receivedFiles = [];
let incomingFiles = {};

let speedBytes = 0;
let speedLastUpdate = performance.now();

function calcLiveSpeed(bytesProcessed) {
  speedBytes += bytesProcessed;
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
    handleInterruptedTransfers();
    autoReconnect();
  });

  conn.on("error", () => { 
    handleInterruptedTransfers();
    autoReconnect(); 
  });

  conn.on("data", async data => {
    if (data.type === "message") {
      addMessage("Peer: " + data.text);
    }

    if (data.type === "file-meta") {
      try {
        const root = await navigator.storage.getDirectory();
        const fileHandle = await root.getFileHandle(data.fileId, { create: true });
        const writable = await fileHandle.createWritable();

        // Object system with isolated array queue & active write status flag
        incomingFiles[data.fileId] = {
          name: data.name,
          size: data.size,
          mime: data.mime,
          fileHandle,
          writable,
          received: 0,
          queue: [],
          isWriting: false
        };

        createProgress(data.fileId, data.name);
        speedBytes = 0;
        speedLastUpdate = performance.now();
      } catch (err) {
        console.error("Storage Allocation Blocked", err);
      }
    }

    if (data.type === "file-chunk") {
      const file = incomingFiles[data.fileId];
      if (!file) return;

      // Non-blocking network push: Chunks are stored into array instantly
      file.queue.push(data.chunk);
      
      // Separate task process handler initiated
      processFileQueue(data.fileId);
    }
  });
}

// Sequential Processing Engine: Eliminates overlapping disk writing locks
async function processFileQueue(fileId) {
  const file = incomingFiles[fileId];
  if (!file || file.isWriting) return;

  file.isWriting = true;

  while (file.queue.length > 0) {
    const chunk = file.queue.shift();
    try {
      await file.writable.write(chunk);
      file.received += chunk.byteLength;

      calcLiveSpeed(chunk.byteLength);

      const percent = Math.floor((file.received / file.size) * 100);
      updateProgress(fileId, percent);

      if (file.received >= file.size) {
        await file.writable.close();
        
        const fileData = await file.fileHandle.getFile();
        receivedFiles.push({ name: file.name, blob: fileData });
        
        showDownload(file.name, fileData, file.mime);
        delete incomingFiles[fileId];
        break; // Pipeline successfully processed
      }
    } catch (e) {
      console.error("Queue execution stalled", e);
    }
  }

  if (incomingFiles[fileId]) {
    file.isWriting = false;
  }
}

async function handleInterruptedTransfers() {
  const root = await navigator.storage.getDirectory();
  for (const fileId in incomingFiles) {
    try {
      const file = incomingFiles[fileId];
      file.queue = []; // clear volatile cache queue
      await file.writable.abort();
      await root.removeEntry(fileId);
    } catch (e) {}
    const bar = document.getElementById(`bar-${fileId}`);
    if (bar) bar.style.backgroundColor = "#ef4444";
    delete incomingFiles[fileId];
  }
}

function autoReconnect() {
  if (!reconnectId) return;
  statusDiv.innerText = "Reconnecting...";
  statusDiv.className = "status-offline";
  setTimeout(() => {
    const connection = peer.connect(reconnectId);
    setupConnection(connection);
  }, 2000);
}

connectBtn.onclick = () => {
  const id = peerInput.value.trim();
  if (!id) return;
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
  const text = messageInput.value;
  if (!text.trim() || !conn) return;
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
  const HIGH_WATER = 4 * 1024 * 1024; // 4MB Network pipeline headroom
  const LOW_WATER = 1024 * 1024;
  if (!dataChannel) return;
  while (dataChannel.bufferedAmount > HIGH_WATER) {
    await new Promise(resolve => {
      if (dataChannel.bufferedAmountLowThreshold !== undefined) {
        dataChannel.bufferedAmountLowThreshold = LOW_WATER;
        dataChannel.addEventListener("bufferedamountlow", resolve, { once: true });
      } else {
        setTimeout(resolve, 15);
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
