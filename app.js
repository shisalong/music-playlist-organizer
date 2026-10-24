// ============================================
// APPLICATION LOGIC - CONNECTING UI WITH DSA
// ============================================

// Initialize DSA structures
const songCatalog = new DSA.BTree();
const songIndex = new DSA.SortedSongIndex(songCatalog);
let songGraph = null;
const playlist = new DSA.CircularQueue(100);
const recommendations = new DSA.MaxHeap();
let isPlaying = false;
let currentTime = 0;
let totalTime = 0;
let progressInterval = null;

// Initialize with some sample songs
function initializeSampleSongs() {
    const sampleSongs = [
        { title: 'Bohemian Rhapsody', artist: 'Queen', duration: 355, rating: 10 },
        { title: 'Hotel California', artist: 'Eagles', duration: 391, rating: 9 },
        { title: 'Stairway to Heaven', artist: 'Led Zeppelin', duration: 482, rating: 10 },
        { title: 'Imagine', artist: 'John Lennon', duration: 183, rating: 8 },
        { title: 'Billie Jean', artist: 'Michael Jackson', duration: 294, rating: 9 },
        { title: 'Like a Rolling Stone', artist: 'Bob Dylan', duration: 366, rating: 8 },
        { title: 'Smells Like Teen Spirit', artist: 'Nirvana', duration: 301, rating: 9 }
    ];

    sampleSongs.forEach(song => {
        const trackId = `sample-${Date.now()}-${Math.random()}`;
        const songWithId = { ...song, id: trackId, track_id: trackId };
        songCatalog.insert(trackId, songWithId);
        recommendations.insert(songWithId);
        playlist.enqueue(songWithId);
    });

    songIndex.rebuild();
    updateStatistics();
    updateRecommendations();
    updatePlaylistDisplay();
    updateLibraryDisplay();
    updateQueueStatus();
    updateNowPlaying();
}

// Load the catalog dataset without adding its songs to playback or recommendations.
async function loadCSVSongs() {
    try {
        const response = await fetch('songs_cleaned.csv');
        if (!response.ok) {
            throw new Error(`Could not load songs_cleaned.csv: ${response.status}`);
        }

        const csvText = await response.text();
        const stats = DSA.loadSongsFromCSV(csvText, songCatalog);
        songIndex.rebuild();
        songGraph = new DSA.SongGraph().buildFromSongs(songCatalog.inorderTraversal());
        window.songGraph = songGraph;
        updateStatistics();
        updateLibraryDisplay();
        addVisualizationStep(
            `🎵 Loaded ${stats.songsInserted} CSV songs into the B-Tree catalog`
        );
    } catch (error) {
        console.error('Failed to load the song CSV:', error);
        showNotification('Could not load songs_cleaned.csv; sample songs are still available.', 'error');
    }
}

// Compare both O(log n) lookups against the same catalog song without changing UI search.
function compareRetrievalMethods(trackId) {
    const btreeResult = songCatalog.search(trackId);
    const binaryResult = DSA.binarySearchByTrackId(songIndex.songs, trackId);
    return {
        trackId: String(trackId === null || trackId === undefined ? '' : trackId).trim(),
        btreeResult,
        binaryResult,
        match: btreeResult === binaryResult
    };
}
window.compareRetrievalMethods = compareRetrievalMethods;

// Navigation
function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const section = item.getAttribute('data-section');
            switchSection(section);
            
            // Update active state
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
        });
    });
}

function switchSection(section) {
    const sections = document.querySelectorAll('.content-section');
    sections.forEach(sec => sec.classList.remove('active'));
    
    switch(section) {
        case 'home':
            document.getElementById('homeSection').classList.add('active');
            break;
        case 'search':
            document.getElementById('searchSection').classList.add('active');
            break;
        case 'library':
            document.getElementById('librarySection').classList.add('active');
            break;
    }
}

// Modal functions
function showAddSongModal() {
    const modal = document.getElementById('addSongModal');
    modal.classList.add('active');
}

function closeAddSongModal() {
    const modal = document.getElementById('addSongModal');
    modal.classList.remove('active');
}

function showVisualizer() {
    const modal = document.getElementById('visualizerModal');
    modal.classList.add('active');
}

function closeVisualizer() {
    const modal = document.getElementById('visualizerModal');
    modal.classList.remove('active');
}

// Close modals on outside click
document.addEventListener('click', (e) => {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        if (e.target === modal) {
            modal.classList.remove('active');
        }
    });
});

// Add song to catalog and playlist
function addSong() {
    const title = document.getElementById('songTitle').value.trim();
    const artist = document.getElementById('songArtist').value.trim();
    const duration = parseInt(document.getElementById('songDuration').value);
    const rating = parseInt(document.getElementById('songRating').value);

    // Validation
    if (!title || !artist || !duration || !rating) {
        showNotification('Please fill in all fields!', 'error');
        return;
    }

    if (rating < 1 || rating > 10) {
        showNotification('Rating must be between 1 and 10!', 'error');
        return;
    }

    const id = Date.now();
    const trackId = `manual-${id}`;
    const song = {
        title,
        artist,
        duration,
        rating,
        id: trackId,
        track_id: trackId
    };

    try {
        // Add to B-Tree
        songCatalog.insert(trackId, song);
        songIndex.rebuild();
        addVisualizationStep(`✓ Added "${song.title}" to song catalog (B-Tree)`);
        
        // Add to playlist
        playlist.enqueue(song);
        addVisualizationStep(`✓ Added "${song.title}" to playlist queue (Circular Queue)`);
        
        // Add to recommendations
        recommendations.insert(song);
        addVisualizationStep(`✓ Added "${song.title}" to recommendations (Max Heap)`);
        
        // Clear form
        document.getElementById('songTitle').value = '';
        document.getElementById('songArtist').value = '';
        document.getElementById('songDuration').value = '';
        document.getElementById('songRating').value = '';
        
        // Close modal
        closeAddSongModal();
        
        // Update UI
        updatePlaylistDisplay();
        updateLibraryDisplay();
        updateStatistics();
        updateRecommendations();
        updateQueueStatus();
        
        showNotification('Song added successfully!');
    } catch (error) {
        showNotification('Error adding song: ' + error.message, 'error');
    }
}

// Search song titles using the B-Tree's compatibility scan.
function searchSongs(event) {
    const query = event.target.value.trim();
    const searchResults = document.getElementById('searchResults');
    
    if (query === '') {
        searchResults.innerHTML = `
            <div class="empty-search-state">
                <span class="empty-icon">🔍</span>
                <p>Search for your favorite songs</p>
            </div>
        `;
        return;
    }

    const results = songCatalog.searchByTitle(query).sort((firstSong, secondSong) => {
        return firstSong.title.toLowerCase().localeCompare(secondSong.title.toLowerCase());
    });
    addVisualizationStep(`🔍 Searched for "${query}" in B-Tree - Found ${results.length} result(s)`);
    
    if (results.length === 0) {
        searchResults.innerHTML = `
            <div class="empty-search-state">
                <span class="empty-icon">😔</span>
                <p>No results found for "${query}"</p>
            </div>
        `;
        return;
    }

    searchResults.innerHTML = results.map(song => `
        <div class="search-result-item" onclick="addSongToPlaylist('${song.track_id}')">
            <div class="search-result-art">🎵</div>
            <div class="search-result-info">
                <div class="search-result-title">${song.title}</div>
                <div class="search-result-artist">${song.artist}</div>
            </div>
            <div class="search-result-rating">⭐ ${song.rating}</div>
        </div>
    `).join('');
}

// Add searched song to playlist
function addSongToPlaylist(songId) {
    const song = songCatalog.search(songId);
    
    if (song) {
        playlist.enqueue(song);
        updatePlaylistDisplay();
        updateQueueStatus();
        addVisualizationStep(`✓ Added "${song.title}" to playlist from search`);
        showNotification(`Added "${song.title}" to playlist!`);
    }
}

// Update playlist display
function updatePlaylistDisplay() {
    const playlistDisplay = document.getElementById('playlistDisplay');
    const songs = playlist.getAllSongs();
    
    if (songs.length === 0) {
        playlistDisplay.innerHTML = '<p class="empty-state">Your playlist is empty. Add some songs!</p>';
        return;
    }

    playlistDisplay.innerHTML = songs.map(({ song, isCurrent }, index) => `
        <div class="song-item ${isCurrent ? 'active' : ''}" onclick="setCurrentSong(${index})">
            <div class="song-number">${isCurrent ? '▶' : index + 1}</div>
            <div class="song-info">
                <div class="song-title">${song.title}</div>
                <div class="song-artist">${song.artist}</div>
            </div>
            <div class="song-album">Playlist</div>
            <div class="song-duration">${formatDuration(song.duration)}</div>
            <div class="song-rating">⭐ ${song.rating}</div>
        </div>
    `).join('');
    
    updateNowPlaying();
}

// Set current song
function setCurrentSong(index) {
    const songs = playlist.getAllSongs();
    if (songs[index]) {
        // Set the current index to the song's queue index
        playlist.currentIndex = songs[index].index;
        currentTime = 0;
        updatePlaylistDisplay();
        updateNowPlaying();
        if (isPlaying) {
            startProgress();
        }
    }
}

// Update library display
function updateLibraryDisplay() {
    const libraryDisplay = document.getElementById('libraryDisplay');
    const allSongs = songCatalog.inorderTraversal().sort((firstSong, secondSong) => {
        return firstSong.title.toLowerCase().localeCompare(secondSong.title.toLowerCase());
    });
    
    if (allSongs.length === 0) {
        libraryDisplay.innerHTML = '<p class="empty-state">No songs in library yet</p>';
        return;
    }

    libraryDisplay.innerHTML = allSongs.map(song => `
        <div class="library-song-card" onclick="addSongToPlaylist('${song.track_id}')">
            <div class="library-song-art">🎵</div>
            <div class="library-song-title">${song.title}</div>
            <div class="library-song-artist">${song.artist} • ⭐ ${song.rating}</div>
        </div>
    `).join('');
}

// Update now playing display
function updateNowPlaying() {
    const current = playlist.getCurrent();
    const nowPlayingSong = document.getElementById('nowPlayingSong');
    const nowPlayingArtist = document.getElementById('nowPlayingArtist');
    const timeTotal = document.getElementById('timeTotal');
    
    if (current) {
        nowPlayingSong.textContent = current.title;
        nowPlayingArtist.textContent = current.artist;
        totalTime = current.duration;
        timeTotal.textContent = formatDuration(current.duration);
        updateProgressBar();
    } else {
        nowPlayingSong.textContent = 'Not playing';
        nowPlayingArtist.textContent = '-';
        totalTime = 0;
        timeTotal.textContent = '0:00';
        document.getElementById('timeCurrent').textContent = '0:00';
        document.getElementById('progressFill').style.width = '0%';
    }
}

// Update progress bar
function updateProgressBar() {
    if (totalTime === 0) return;
    
    const progress = (currentTime / totalTime) * 100;
    document.getElementById('progressFill').style.width = progress + '%';
    document.getElementById('timeCurrent').textContent = formatDuration(currentTime);
}

// Start progress simulation
function startProgress() {
    if (progressInterval) clearInterval(progressInterval);
    
    progressInterval = setInterval(() => {
        if (isPlaying && currentTime < totalTime) {
            currentTime++;
            updateProgressBar();
        } else if (currentTime >= totalTime) {
            // Auto play next song
            playNext();
        }
    }, 1000);
}

// Stop progress simulation
function stopProgress() {
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
}

// Shuffle playlist using heap sort
function shufflePlaylist() {
    const songs = playlist.getAllSongs().map(({ song }) => song);
    
    if (songs.length === 0) {
        showNotification('Playlist is empty!', 'error');
        return;
    }

    addVisualizationStep('🔀 Starting heap sort shuffle...');
    const sorted = DSA.heapSort(songs);
    addVisualizationStep(`✓ Heap sort completed - ${sorted.length} songs sorted by rating`);
    
    // Clear and rebuild playlist
    playlist.clear();
    sorted.forEach(song => {
        playlist.enqueue(song);
    });
    
    updatePlaylistDisplay();
    updateQueueStatus();
    showNotification('Playlist shuffled using heap sort!');
}

// Clear playlist
function clearPlaylist() {
    if (playlist.isEmpty()) {
        showNotification('Playlist is already empty!', 'error');
        return;
    }

    playlist.clear();
    currentTime = 0;
    stopProgress();
    updatePlaylistDisplay();
    updateQueueStatus();
    updateNowPlaying();
    addVisualizationStep('🗑️ Cleared playlist');
    showNotification('Playlist cleared!');
}

// Play/Pause functionality
function playPause() {
    if (playlist.isEmpty()) {
        showNotification('No songs in playlist!', 'error');
        return;
    }

    isPlaying = !isPlaying;
    const current = playlist.getCurrent();
    const playPauseBtn = document.getElementById('playPauseBtn');
    
    if (isPlaying) {
        playPauseBtn.innerHTML = '<span>⏸️</span>';
        addVisualizationStep(`▶️ Playing: "${current.title}"`);
        showNotification('Playing: ' + current.title);
        startProgress();
    } else {
        playPauseBtn.innerHTML = '<span>▶️</span>';
        addVisualizationStep(`⏸️ Paused: "${current.title}"`);
        showNotification('Paused: ' + current.title);
        stopProgress();
    }
}

// Play next song
function playNext() {
    if (playlist.isEmpty()) {
        showNotification('No songs in playlist!', 'error');
        return;
    }

    const next = playlist.next();
    if (next) {
        currentTime = 0;
        addVisualizationStep(`⏭️ Next: "${next.title}" (Circular Queue navigation)`);
        updatePlaylistDisplay();
        updateNowPlaying();
        if (isPlaying) {
            showNotification('Playing: ' + next.title);
            startProgress();
        }
    }
}

// Play previous song
function playPrevious() {
    if (playlist.isEmpty()) {
        showNotification('No songs in playlist!', 'error');
        return;
    }

    const previous = playlist.previous();
    if (previous) {
        currentTime = 0;
        addVisualizationStep(`⏮️ Previous: "${previous.title}" (Circular Queue navigation)`);
        updatePlaylistDisplay();
        updateNowPlaying();
        if (isPlaying) {
            showNotification('Playing: ' + previous.title);
            startProgress();
        }
    }
}

// Update statistics
function updateStatistics() {
    const totalSongs = songCatalog.size;
    const btreeHeight = songCatalog.height();
    
    document.getElementById('totalSongs').textContent = totalSongs;
    document.getElementById('btreeHeight').textContent = btreeHeight;
}

// Update recommendations
function updateRecommendations() {
    const topRecommendations = recommendations.getTopRecommendations(5);
    const recommendationsDisplay = document.getElementById('recommendationsDisplay');
    
    if (topRecommendations.length === 0) {
        recommendationsDisplay.innerHTML = '<p class="empty-state">No recommendations yet</p>';
        return;
    }

    recommendationsDisplay.innerHTML = topRecommendations.slice(0, 5).map(song => `
        <div class="recommendation-item" onclick="addSongToPlaylist('${song.track_id}')">
            <div class="recommendation-item-content">
                <div class="recommendation-title">${song.title}</div>
                <div class="recommendation-artist">${song.artist}</div>
            </div>
            <div class="recommendation-rating">⭐ ${song.rating}</div>
        </div>
    `).join('');
}

// Update queue status
function updateQueueStatus() {
    const queueStatus = document.getElementById('queueStatus');
    const playlistCount = document.getElementById('playlistCount');
    const size = playlist.size;
    queueStatus.textContent = `Queue: ${size} song${size !== 1 ? 's' : ''}`;
    playlistCount.textContent = `${size} song${size !== 1 ? 's' : ''}`;
}

// Add visualization step
function addVisualizationStep(message) {
    const visualizerContent = document.getElementById('visualizerContent');
    
    // Remove empty state if exists
    if (visualizerContent.querySelector('.empty-state')) {
        visualizerContent.innerHTML = '';
    }
    
    const step = document.createElement('div');
    step.className = 'visualization-step';
    step.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    
    visualizerContent.insertBefore(step, visualizerContent.firstChild);
    
    // Keep only last 20 steps
    const steps = visualizerContent.querySelectorAll('.visualization-step');
    if (steps.length > 20) {
        steps[steps.length - 1].remove();
    }
    
    // Highlight first step briefly
    setTimeout(() => step.classList.add('highlight'), 50);
    setTimeout(() => step.classList.remove('highlight'), 500);
}

// Show notification
function showNotification(message, type = 'success') {
    // Create notification element
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'error' ? '#e22134' : 'var(--accent)'};
        color: white;
        padding: 14px 20px;
        border-radius: 8px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        z-index: 3000;
        animation: slideIn 0.3s ease-out;
        font-size: 14px;
        font-weight: 500;
        max-width: 300px;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Format duration in seconds to MM:SS
function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// Add animation styles
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Progress bar click handler
function setupProgressBar() {
    const progressBar = document.querySelector('.progress-bar');
    if (progressBar) {
        progressBar.addEventListener('click', (e) => {
            if (totalTime === 0) return;
            
            const rect = progressBar.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const percentage = clickX / rect.width;
            currentTime = Math.floor(totalTime * percentage);
            updateProgressBar();
        });
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initializeSampleSongs();
    loadCSVSongs();
    setupNavigation();
    setupProgressBar();
    addVisualizationStep('🎵 Music Playlist Organizer initialized with sample songs');
    addVisualizationStep('📚 DSA structures: B-Tree, Circular Queue, Max Heap ready');
    
    // Allow Enter key to add song
    document.getElementById('songRating').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addSong();
        }
    });
    
    // Switch to home section by default
    switchSection('home');
});