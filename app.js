const peerIdDiv =
document.getElementById("peerId");

const peerInput =
document.getElementById("peerInput");

const connectBtn =
document.getElementById("connectBtn");

const statusDiv =
document.getElementById("status");

const sendBtn =
document.getElementById("sendBtn");

const messageInput =
document.getElementById("messageInput");

const messagesDiv =
document.getElementById("messages");

const fileInput =
document.getElementById("fileInput");

const sendFilesBtn =
document.getElementById("sendFilesBtn");

const transfersDiv =
document.getElementById("transfers");

const downloadsDiv =
document.getElementById("downloads");

const downloadAllBtn =
document.getElementById("downloadAllBtn");

const dropzone =
document.getElementById("dropzone");

const CHUNK_SIZE = 1024 * 1024;

let conn;

let reconnectId = "";

let receivedFiles = [];

let incomingFiles = {};

const peer = new Peer({

config:{
iceServers:[
{
urls:"stun:stun.l.google.com:19302"
}
]
}

});

peer.on("open", id=>{

peerIdDiv.innerText = id;

QRCode.toCanvas(
document.getElementById("qrCanvas"),
id,
{
width:220
}
);

});

peer.on("connection", connection=>{

setupConnection(connection);

});

function setupConnection(connection){

conn = connection;

reconnectId = connection.peer;

conn.on("open", ()=>{

statusDiv.innerText =
"Connected";

});

conn.on("close", ()=>{

statusDiv.innerText =
"Disconnected";

autoReconnect();

});

conn.on("error", ()=>{

autoReconnect();

});

conn.on("data", data=>{

if(data.type==="message"){

addMessage(
"Peer: " + data.text
);

}

if(data.type==="file-meta"){

incomingFiles[data.fileId]={
name:data.name,
size:data.size,
mime:data.mime,
chunks:[],
received:0
};

createProgress(
data.fileId,
data.name
);

}

if(data.type==="file-chunk"){

const file =
incomingFiles[data.fileId];

file.chunks.push(data.chunk);

file.received +=
data.chunk.byteLength;

const percent =
Math.floor(
(file.received / file.size)
* 100
);

updateProgress(
data.fileId,
percent
);

if(file.received >= file.size){

const blob = new Blob(
file.chunks,
{
type:file.mime
}
);

receivedFiles.push({
name:file.name,
blob
});

showDownload(
file.name,
blob,
file.mime
);

delete incomingFiles[
data.fileId
];

}

}

});

}

function autoReconnect(){

if(!reconnectId) return;

statusDiv.innerText =
"Reconnecting...";

setTimeout(()=>{

const connection =
peer.connect(reconnectId,{
reliable:true
});

setupConnection(connection);

},2000);

}

connectBtn.onclick = ()=>{

const id =
peerInput.value.trim();

if(!id) return;

const connection =
peer.connect(id,{
reliable:true
});

setupConnection(connection);

};

function addMessage(text,self=false){

const div =
document.createElement("div");

div.className = "message";

if(self){
div.classList.add("self");
}

div.innerText = text;

messagesDiv.appendChild(div);

messagesDiv.scrollTop =
messagesDiv.scrollHeight;

}

sendBtn.onclick = ()=>{

const text =
messageInput.value.trim();

if(!text || !conn) return;

conn.send({
type:"message",
text
});

addMessage(
"You: " + text,
true
);

messageInput.value = "";

};

function createProgress(id,name){

const div =
document.createElement("div");

div.className =
"progress-wrap";

div.innerHTML = `
<p>${name}</p>

<div class="progress">
<div
class="progress-bar"
id="bar-${id}">
</div>
</div>
`;

transfersDiv.appendChild(div);

}

function updateProgress(id,percent){

const bar =
document.getElementById(
`bar-${id}`
);

if(bar){

bar.style.width =
percent + "%";

}

}

// FIX: proper back-pressure wait loop so the DataChannel buffer never
// overflows for large binary files (e.g. MP4s).
// The original code used a one-shot setTimeout which did not actually
// pause the loop — chunks kept flooding in, corrupting ordered delivery.
// Also fixed: progress tracking now uses buffer.byteLength (the actual
// bytes sent) instead of slice.size (Blob size), which could differ and
// cause the loop to mis-track completion on binary files.
async function waitForBuffer(dataChannel){

const HIGH_WATER = 4 * 1024 * 1024;  // pause above 4 MB buffered
const LOW_WATER  =     512 * 1024;   // resume below 512 KB buffered

if(!dataChannel) return;

while(dataChannel.bufferedAmount > HIGH_WATER){

await new Promise(resolve=>{

// Use bufferedamountlow event when available for zero-spin waiting
if(
dataChannel.bufferedAmountLowThreshold !== undefined
){

dataChannel.bufferedAmountLowThreshold = LOW_WATER;

dataChannel.addEventListener(
"bufferedamountlow",
resolve,
{ once: true }
);

} else {

// Fallback: poll every 30 ms
setTimeout(resolve, 30);

}

});

}

}

async function sendFile(file){

const fileId =
crypto.randomUUID();

createProgress(
fileId,
file.name
);

conn.send({
type:"file-meta",
fileId,
name:file.name,
size:file.size,
mime:file.type
});

let offset = 0;

let sent = 0;

const dataChannel =
conn.dataChannel || null;

while(offset < file.size){

const slice = file.slice(
offset,
offset + CHUNK_SIZE
);

const buffer =
await slice.arrayBuffer();

// FIX: wait until the DataChannel buffer drains before sending the
// next chunk — this is the key fix that prevents MP4 corruption.
await waitForBuffer(dataChannel);

conn.send({
type:"file-chunk",
fileId,
chunk:buffer
});

// FIX: use buffer.byteLength (actual bytes read into the ArrayBuffer)
// instead of slice.size (Blob byte count) — keeps sent tracking exact.
sent += buffer.byteLength;

offset += CHUNK_SIZE;

const percent =
Math.floor(
(sent / file.size) * 100
);

updateProgress(
fileId,
percent
);

}

}

sendFilesBtn.onclick =
async ()=>{

const files =
[...fileInput.files];

if(!files.length || !conn)
return;

for(const file of files){

await sendFile(file);

}

};

function showDownload(
name,
blob,
mime
){

const url =
URL.createObjectURL(blob);

const div =
document.createElement("div");

div.className =
"download-item";

let preview = "";

if(
mime.startsWith("image/")
){

preview = `
<img src="${url}">
`;

}

if(
mime.startsWith("video/")
){

preview = `
<video controls>
<source src="${url}">
</video>
`;

}

div.innerHTML = `
<b>${name}</b>

<br><br>

<a
href="${url}"
download="${name}">
Download
</a>

${preview}
`;

downloadsDiv.appendChild(div);

}

downloadAllBtn.onclick =
async ()=>{

const zip =
new JSZip();

receivedFiles.forEach(file=>{

zip.file(
file.name,
file.blob
);

});

const content =
await zip.generateAsync({
type:"blob"
});

const a =
document.createElement("a");

a.href =
URL.createObjectURL(content);

a.download =
"PeerDropFiles.zip";

a.click();

};

dropzone.addEventListener(
"dragover",
e=>{
e.preventDefault();
}
);

dropzone.addEventListener(
"drop",
e=>{

e.preventDefault();

fileInput.files =
e.dataTransfer.files;

}
);

document.getElementById(
"scanBtn"
).onclick = async ()=>{

const scanner =
new Html5Qrcode(
"reader"
);

scanner.start(
{
facingMode:"environment"
},
{
fps:10,
qrbox:250
},
decodedText=>{

peerInput.value =
decodedText;

scanner.stop();

}
);

};

if(
"serviceWorker"
in navigator
){

navigator.serviceWorker
.register("sw.js");

}
