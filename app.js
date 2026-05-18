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

while(offset < file.size){

const slice = file.slice(
offset,
offset + CHUNK_SIZE
);

const buffer =
await slice.arrayBuffer();

if(conn.dataChannel && conn.dataChannel.bufferedAmount > 16 * 1024 * 1024){

await new Promise(resolve => setTimeout(resolve, 50));

}

conn.send({
type:"file-chunk",
fileId,
chunk:buffer
});

sent += slice.size;

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
