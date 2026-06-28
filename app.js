lucide.createIcons(); // Initialize Icons

let videos = JSON.parse(localStorage.getItem('studyStream_videos')) || [];
let player;
let currentVideoId = null;
let progressInterval;

// -- NAVIGATION --
function switchTab(tabId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    
    document.getElementById(`view-${tabId}`).classList.add('active');
    event.currentTarget.classList.add('active');
    renderUI();
}

// -- DATA MANAGEMENT --
function saveToStorage() {
    localStorage.setItem('studyStream_videos', JSON.stringify(videos));
    renderUI();
}

// -- UI RENDERING --
function renderUI() {
    let phy = [], chem = [], bio = [], inProgress = [];
    
    videos.forEach(v => {
        if (v.category === 'physics') phy.push(v);
        if (v.category === 'chemistry') chem.push(v);
        if (v.category === 'biology') bio.push(v);
        if (v.status === 'In Progress') inProgress.push(v);
    });

    document.getElementById('stat-phy').innerText = `${phy.length} Videos`;
    document.getElementById('stat-chem').innerText = `${chem.length} Videos`;
    document.getElementById('stat-bio').innerText = `${bio.length} Videos`;

    inProgress.sort((a, b) => b.lastWatched - a.lastWatched); // Smart sorting

    renderList('continue-watching-list', inProgress);
    renderList('physics-list', phy);
    renderList('chemistry-list', chem);
    renderList('biology-list', bio);
}

function renderList(elementId, list) {
    const container = document.getElementById(elementId);
    container.innerHTML = '';
    
    if(list.length === 0) {
        container.innerHTML = '<p style="color: var(--secondary-text); text-align: center;">No videos found.</p>';
        return;
    }

    list.forEach(v => {
        let percent = v.duration ? (v.progress / v.duration) * 100 : 0;
        const card = document.createElement('div');
        card.className = 'video-card';
        card.innerHTML = `
            <img src="https://img.youtube.com/vi/${v.ytId}/hqdefault.jpg" class="thumb" onclick="openPlayer('${v.id}')">
            <div class="card-info">
                <span class="status-badge">${v.status}</span>
                <h4>${v.title}</h4>
                <div class="progress-container"><div class="progress-bar" style="width: ${percent}%"></div></div>
                <button class="delete-btn" onclick="deleteVideo('${v.id}')"><i data-lucide="trash-2" style="width:16px;"></i></button>
            </div>
        `;
        container.appendChild(card);
    });
    lucide.createIcons();
}

// -- ADD & DELETE VIDEO --
document.getElementById('add-video-btn').onclick = () => document.getElementById('add-modal').style.display = 'flex';
function closeModal() { document.getElementById('add-modal').style.display = 'none'; }

function extractYTId(url) {
    let match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^&?\n]{11})/);
    return match ? match[1] : null;
}

async function saveVideo() {
    const link = document.getElementById('yt-link').value;
    const category = document.getElementById('video-category').value;
    const ytId = extractYTId(link);

    if (!ytId) return alert('Invalid YouTube URL');
    if (videos.some(v => v.ytId === ytId)) return alert('Video is already in your library!');

    // Fetch Title using oEmbed
    let title = "Unknown Title";
    try {
        const res = await fetch(`https://www.youtube.com/oembed?url=http://www.youtube.com/watch?v=${ytId}&format=json`);
        const data = await res.json();
        title = data.title;
    } catch(e) {} // Fallback to unknown if API fails due to CORS

    videos.unshift({
        id: Date.now().toString(),
        ytId, title, category,
        progress: 0, duration: 0,
        status: 'New',
        addedAt: Date.now(),
        lastWatched: Date.now()
    });

    document.getElementById('yt-link').value = '';
    closeModal();
    saveToStorage();
}

function deleteVideo(id) {
    if(confirm("Are you sure you want to remove this video?")) {
        videos = videos.filter(v => v.id !== id);
        saveToStorage();
    }
}

// -- YOUTUBE PLAYER & TRACKING --
function onYouTubeIframeAPIReady() {
    player = new YT.Player('youtube-player', {
        height: '100%', width: '100%',
        playerVars: { 'autoplay': 1, 'controls': 1, 'playsinline': 1 },
        events: { 'onStateChange': onPlayerStateChange }
    });
}

function openPlayer(id) {
    const video = videos.find(v => v.id === id);
    if (!video) return;
    
    currentVideoId = id;
    document.getElementById('player-overlay').style.display = 'flex';
    
    if (player && player.loadVideoById) {
        player.loadVideoById({videoId: video.ytId, startSeconds: video.progress});
    }
}

function onPlayerStateChange(event) {
    if (event.data == YT.PlayerState.PLAYING) {
        progressInterval = setInterval(updateProgress, 1000);
    } else {
        clearInterval(progressInterval);
    }
    
    if (event.data == YT.PlayerState.ENDED) {
        let v = videos.find(v => v.id === currentVideoId);
        if(v) { v.status = 'Completed'; v.progress = v.duration; saveToStorage(); }
        closePlayer();
    }
}

function updateProgress() {
    if (!currentVideoId || !player) return;
    let v = videos.find(v => v.id === currentVideoId);
    if(v) {
        v.progress = player.getCurrentTime();
        v.duration = player.getDuration();
        v.lastWatched = Date.now();
        if(v.status === 'New') v.status = 'In Progress';
        // Auto mark complete if > 98%
        if(v.progress / v.duration > 0.98) v.status = 'Completed';
        saveToStorage();
    }
}

function closePlayer() {
    if (player && player.pauseVideo) player.pauseVideo();
    clearInterval(progressInterval);
    document.getElementById('player-overlay').style.display = 'none';
    currentVideoId = null;
    renderUI();
}

function toggleFullscreen() {
    const overlay = document.getElementById('player-overlay');
    if (!document.fullscreenElement) {
        overlay.requestFullscreen().catch(err => alert("Fullscreen unsupported"));
    } else {
        document.exitFullscreen();
    }
}

// -- EXPORT & IMPORT --
function exportData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(videos));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", "StudyStream_Backup.json");
    dlAnchorElem.click();
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            videos = JSON.parse(e.target.result);
            saveToStorage();
            alert("Data imported successfully!");
        } catch(err) { alert("Invalid Backup File!"); }
    };
    reader.readAsText(file);
}

// Initialize
renderUI();

// Service worker registration
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(() => console.log("Service Worker Registered"));
          }
