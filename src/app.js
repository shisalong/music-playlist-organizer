// ============================================
// APPLICATION LOGIC - CONNECTING UI WITH DSA
// ============================================

// Initialize DSA structures
const songCatalog = new DSA.BTree();
const songIndex = new DSA.SortedSongIndex(songCatalog);
let catalogSongs = [];
let songGraph = null;
let playlistGenerator = null;
const playlist = new DSA.CircularQueue(100);
const SAVED_PLAYLISTS_STORAGE_KEY = 'genmixSavedPlaylists';
const SONG_CSV_FILE = 'songs_deduped.csv';
const SONG_CSV_PATH = `data/${SONG_CSV_FILE}`;
const RECOMMENDATION_COUNT = 12;
const LOADING_DURATION_MS = 2500;
const GENERATION_SAFETY_TIMEOUT_MS = 10000;
const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_STAGGER_LIMIT = 12;
const UNDO_DURATION_MS = 5000;
const PLAYLIST_ADD_SEARCH_LIMIT = 30;
let searchDebounceTimer = null;
let searchReturnSection = null;
let openPlaylistId = null;
let pendingUndo = null;
let undoToastTimer = null;
let dragSourceIndex = null;
let lastGeneratedPlaylist = null;
window.lastGeneratedPlaylist = null;
let wizardState = PlaylistWizard.createWizardState();
let generationRequestToken = 0;
let generationInProgress = false;
let loadingMessageInterval = null;
let activeSection = 'home';
let previousBodyOverflow = '';
let catalogLoadMessage = `Song library is empty. Could not load ${SONG_CSV_FILE}.`;
let youtubeAuth = null;
let youtubeExportUI = null;
const GENERATOR_SEARCH_LIMIT = 30;
const GENERATOR_FEATURES = [
    ['danceability', 'Danceability'],
    ['energy', 'Energy'],
    ['acousticness', 'Acousticness'],
    ['valence', 'Valence'],
    ['tempo', 'Tempo']
];

// Load the catalog dataset without adding its songs to playback or recommendations.
async function loadCSVSongs() {
    try {
        const response = await fetch(SONG_CSV_PATH);
        if (!response.ok) {
            throw new Error(`Could not load ${SONG_CSV_FILE}: ${response.status}`);
        }

        const csvText = await response.text();
        const stats = DSA.loadSongsFromCSV(csvText, songCatalog);
        songIndex.rebuild();
        catalogSongs = songIndex.songs;
        songGraph = new DSA.SongGraph().buildFromSongs(songCatalog.inorderTraversal());
        playlistGenerator = new PlaylistGenerator(songCatalog, songGraph);
        window.songGraph = songGraph;
        window.playlistGenerator = playlistGenerator;
        updateGeneratorAvailability();
        if (songCatalog.size === 0 || songGraph.nodeCount() === 0) {
            catalogLoadMessage = `Song library is empty. No usable songs were loaded from ${SONG_CSV_FILE}.`;
            console.warn(catalogLoadMessage);
        } else {
            catalogLoadMessage = '';
        }
        renderHome();
        updateLibraryDisplay();
        addVisualizationStep(
            `Loaded ${stats.songsInserted} CSV songs into the B-Tree catalog`
        );
    } catch (error) {
        console.error('Failed to load the song CSV:', error);
        updateGeneratorAvailability();
        catalogLoadMessage = `Song library is empty. Could not load ${SONG_CSV_FILE}.`;
        renderHome();
        updateLibraryDisplay();
        showNotification(`Could not load ${SONG_CSV_FILE}.`, 'error');
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

// Bind the menu toggle, outside-click close button, and keyboard controls.
function setupMenu() {
    document.getElementById('menuToggle').addEventListener('click', toggleMenu);
    document.getElementById('menuOverlay').addEventListener('click', closeMenu);
    document.addEventListener('keydown', handleMenuKeydown);
}

// Open the navigation panel, lock the page behind it, and move focus into it.
function openMenu() {
    const menu = document.getElementById('mainMenu');
    const overlay = document.getElementById('menuOverlay');
    const menuToggle = document.getElementById('menuToggle');

    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    menu.inert = false;
    menu.setAttribute('aria-hidden', 'false');
    menu.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    overlay.classList.add('open');
    menuToggle.setAttribute('aria-expanded', 'true');
    menuToggle.setAttribute('aria-label', 'Close menu');
    document.getElementById('appHeader').inert = true;
    document.getElementById('mainContent').inert = true;
    document.getElementById('mainContent').classList.add('menu-blurred');

    const currentItem = menu.querySelector('[aria-current="page"]') || menu.querySelector('.nav-item');
    if (currentItem) {
        currentItem.focus();
    }
}

// Close the menu, restore page scrolling, and return focus to the menu button.
function closeMenu() {
    const menu = document.getElementById('mainMenu');
    if (!menu.classList.contains('open')) {
        return;
    }

    const menuToggle = document.getElementById('menuToggle');
    menu.classList.remove('open');
    menu.inert = true;
    menu.setAttribute('aria-hidden', 'true');
    const overlay = document.getElementById('menuOverlay');
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Open menu');
    document.getElementById('appHeader').inert = false;
    document.getElementById('mainContent').inert = false;
    document.getElementById('mainContent').classList.remove('menu-blurred');
    document.body.style.overflow = previousBodyOverflow;
    menuToggle.focus();
}

// Toggle the menu based on its current expanded state.
function toggleMenu() {
    const menuToggle = document.getElementById('menuToggle');
    if (menuToggle.getAttribute('aria-expanded') === 'true') {
        closeMenu();
    } else {
        openMenu();
    }
}

// Close on Escape and keep keyboard focus within the open navigation menu.
function handleMenuKeydown(event) {
    const menu = document.getElementById('mainMenu');
    if (!menu.classList.contains('open')) {
        return;
    }
    if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
        return;
    }
    if (event.key !== 'Tab') {
        return;
    }

    const menuItems = menu.querySelectorAll('.nav-item');
    if (menuItems.length === 0) {
        return;
    }
    const firstItem = menuItems[0];
    const lastItem = menuItems[menuItems.length - 1];
    if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
    } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
    }
}

// Navigation
function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const section = item.getAttribute('data-section');
            switchSection(section);
            closeMenu();
        });
    });
}

// Show one content section and keep the matching menu item accessible.
// Global search passes preserveWizard so a detour to Search keeps wizard progress.
function switchSection(section, options = {}) {
    if (activeSection === 'generator' && section !== 'generator' && !options.preserveWizard) {
        cancelPlaylistWizard();
    }
    const sections = document.querySelectorAll('.content-section');
    sections.forEach(sec => sec.classList.remove('active'));
    
    switch(section) {
        case 'home':
            document.getElementById('homeSection').classList.add('active');
            renderHome();
            break;
        case 'search':
            document.getElementById('searchSection').classList.add('active');
            break;
        case 'library':
            document.getElementById('librarySection').classList.add('active');
            updateLibraryDisplay();
            break;
        case 'playlist':
            document.getElementById('playlistDetailSection').classList.add('active');
            renderPlaylistDetail();
            break;
        case 'generator':
            document.getElementById('generatorSection').classList.add('active');
            updateGeneratorAvailability();
            renderWizardStep(wizardState.step);
            break;
    }
    activeSection = section;

    // The playlist detail view belongs to the Library menu item.
    const navSection = section === 'playlist' ? 'library' : section;
    document.querySelectorAll('.nav-item').forEach((item) => {
        const isCurrent = item.getAttribute('data-section') === navSection;
        item.classList.toggle('active', isCurrent);
        if (isCurrent) {
            item.setAttribute('aria-current', 'page');
        } else {
            item.removeAttribute('aria-current');
        }
    });
}

// Bind wizard controls and build mood choices from the generator's exported keys.
function setupPlaylistGeneratorUI() {
    const moodOptions = document.getElementById('wizardMoodOptions');
    (Array.isArray(window.MOOD_NAMES) ? window.MOOD_NAMES : []).forEach((moodName) => {
        const label = document.createElement('label');
        label.className = 'wizard-mood-option';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'wizardMood';
        input.value = moodName;
        input.addEventListener('change', () => {
            wizardState = { ...wizardState, mood: moodName };
            updateWizardGenerateButtons();
        });
        const text = document.createElement('span');
        text.textContent = PlaylistUI.formatMoodName(moodName, window.MOOD_PROFILES);
        label.appendChild(input);
        label.appendChild(text);
        moodOptions.appendChild(label);
    });

    document.getElementById('createPlaylistButton').addEventListener('click', startPlaylistWizard);
    document.getElementById('wizardNameForm').addEventListener('submit', advancePlaylistName);
    document.getElementById('wizardNameInput').addEventListener('input', () => {
        document.getElementById('wizardNameError').textContent = '';
    });
    document.getElementById('wizardNameCancel').addEventListener('click', cancelPlaylistWizard);
    document.getElementById('wizardSongMethod').addEventListener('click', () => selectWizardMethod('song'));
    document.getElementById('wizardMoodMethod').addEventListener('click', () => selectWizardMethod('mood'));
    document.getElementById('wizardMethodBack').addEventListener('click', () => moveWizardBack('name'));
    document.getElementById('wizardMethodCancel').addEventListener('click', cancelPlaylistWizard);
    document.getElementById('wizardSongSearch').addEventListener('input', searchWizardSeeds);
    document.getElementById('wizardSongGenerate').addEventListener('click', runPlaylistGeneration);
    document.getElementById('wizardSongBack').addEventListener('click', () => moveWizardBack('method'));
    document.getElementById('wizardSongCancel').addEventListener('click', cancelPlaylistWizard);
    document.getElementById('wizardMoodGenerate').addEventListener('click', runPlaylistGeneration);
    document.getElementById('wizardMoodBack').addEventListener('click', () => moveWizardBack('method'));
    document.getElementById('wizardMoodCancel').addEventListener('click', cancelPlaylistWizard);
    document.getElementById('wizardLoadingCancel').addEventListener('click', cancelPlaylistWizard);
    document.getElementById('wizardSaveButton').addEventListener('click', saveGeneratedPlaylist);
    document.getElementById('wizardYouTubeExport').addEventListener('click', () => {
        openYouTubeExport({ name: wizardState.name, songs: wizardState.result && wizardState.result.songs || [] });
    });
    document.getElementById('wizardDeleteButton').addEventListener('click', showDeleteConfirmation);
    document.getElementById('wizardDeleteConfirm').addEventListener('click', discardGeneratedPlaylist);
    document.getElementById('wizardDeleteKeep').addEventListener('click', hideDeleteConfirmation);
    document.getElementById('wizardViewLibrary').addEventListener('click', () => switchSection('library'));
    document.getElementById('wizardCreateAnother').addEventListener('click', cancelPlaylistWizard);
    document.getElementById('wizardEmptyBack').addEventListener('click', backFromEmptyResult);
    document.getElementById('wizardEmptyTryAgain').addEventListener('click', runPlaylistGeneration);
    document.getElementById('wizardRetryButton').addEventListener('click', runPlaylistGeneration);
    document.getElementById('wizardErrorStartButton').addEventListener('click', cancelPlaylistWizard);
    document.addEventListener('keydown', handlePlaylistWizardKeydown);
    document.getElementById('refreshRecommendationsButton').addEventListener('click', renderRecommendations);
    updateGeneratorAvailability();
    renderWizardStep(wizardState.step);
}

// Bind the existing queue-save and Home recommendation controls.
function setupPlaylistSavingUI() {
    document.getElementById('saveQueuePlaylistButton').addEventListener('click', saveCurrentQueue);
}

// Build the optional browser-only YouTube integration without blocking the core app.
function setupYouTubeExportUI() {
    const required = [
        window.YouTubeAuth,
        window.YouTubeApiClient,
        window.YouTubeMatchCache,
        window.YouTubeExporter,
        window.YouTubeExportUI,
        window.estimateYouTubeQuota
    ];
    if (required.some((value) => typeof value !== 'function')) {
        console.warn('YouTube export modules are unavailable.');
        return;
    }
    const configuration = window.GENMIX_CONFIG || {};
    youtubeAuth = new window.YouTubeAuth({
        clientId: configuration.googleClientId,
        google: window.google
    });
    const cache = new window.YouTubeMatchCache(window.localStorage);
    const browserFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
    const api = new window.YouTubeApiClient({ auth: youtubeAuth, fetch: browserFetch });
    const exporter = new window.YouTubeExporter({ api, cache });
    youtubeExportUI = new window.YouTubeExportUI({
        document,
        exporter,
        cache,
        estimateQuota: window.estimateYouTubeQuota
    });
    youtubeExportUI.setup();
}

// Open one shared export panel and refresh the late-loading Google library reference.
function openYouTubeExport(playlistToExport) {
    if (!youtubeExportUI || !youtubeAuth) {
        showNotification('YouTube export could not initialize. Refresh the page and try again.', 'error');
        return false;
    }
    youtubeAuth.google = window.google;
    youtubeExportUI.open(playlistToExport);
    return true;
}

// Check that both the cached catalog and graph contain usable songs.
function isGeneratorAvailable() {
    return Boolean(
        playlistGenerator &&
        songGraph &&
        typeof songGraph.nodeCount === 'function' &&
        songGraph.nodeCount() > 0
    );
}

// Disable method choices and explain the existing catalog failure when needed.
function updateGeneratorAvailability() {
    const available = isGeneratorAvailable();
    document.getElementById('wizardSongMethod').disabled = !available;
    document.getElementById('wizardMoodMethod').disabled = !available;
    const message = document.getElementById('wizardMethodEmptyMessage');
    message.hidden = available;
    if (!available) {
        message.textContent = catalogLoadMessage || 'Song library is empty.';
    }
}

// Show one step panel, synchronize its inputs, and move keyboard focus.
// The direction picks which side the entering panel slides in from.
function renderWizardStep(step, direction = 'forward') {
    document.getElementById('generatorWizard').classList.toggle('wizard-going-back', direction === 'back');
    const panels = {
        start: 'wizardStartPanel',
        name: 'wizardNamePanel',
        method: 'wizardMethodPanel',
        song: 'wizardSongPanel',
        mood: 'wizardMoodPanel',
        loading: 'wizardLoadingPanel',
        result: 'wizardResultPanel',
        error: 'wizardErrorPanel'
    };
    Object.entries(panels).forEach(([panelStep, panelId]) => {
        document.getElementById(panelId).hidden = panelStep !== step;
    });
    if (step === 'name') {
        document.getElementById('wizardNameInput').value = wizardState.name;
    } else if (step === 'method') {
        document.getElementById('wizardChosenName').textContent = wizardState.name;
        updateGeneratorAvailability();
    } else if (step === 'song') {
        document.getElementById('wizardSongSearch').value = wizardState.searchQuery;
        renderWizardSeedSearch(wizardState.searchQuery);
        updateWizardGenerateButtons();
    } else if (step === 'mood') {
        document.querySelectorAll('input[name="wizardMood"]').forEach((input) => {
            input.checked = input.value === wizardState.mood;
        });
        updateWizardGenerateButtons();
    } else if (step === 'result') {
        renderGeneratedPlaylist();
    } else if (step === 'error') {
        document.getElementById('wizardErrorMessage').textContent = wizardState.error;
    }

    const focusIds = {
        start: 'createPlaylistButton',
        name: 'wizardNameInput',
        method: 'wizardSongMethod',
        song: 'wizardSongSearch',
        loading: 'wizardLoadingHeading',
        result: 'wizardResultHeading',
        error: 'wizardRetryButton'
    };
    let focusTarget = document.getElementById(focusIds[step] || 'wizardMoodHeading');
    if (step === 'mood') {
        focusTarget = document.querySelector('input[name="wizardMood"]') || focusTarget;
    }
    if (focusTarget) {
        focusTarget.focus();
    }
}

// Start a new, empty wizard and focus its playlist-name field.
function startPlaylistWizard() {
    invalidatePlaylistGeneration();
    wizardState = PlaylistWizard.createWizardState();
    wizardState = PlaylistWizard.goToStep(wizardState, 'name');
    lastGeneratedPlaylist = null;
    window.lastGeneratedPlaylist = null;
    document.getElementById('wizardNameError').textContent = '';
    renderWizardStep(wizardState.step);
}

// Validate and retain the playlist name before advancing to generation choices.
function advancePlaylistName(event) {
    event.preventDefault();
    const validation = PlaylistWizard.validatePlaylistName(
        document.getElementById('wizardNameInput').value
    );
    document.getElementById('wizardNameError').textContent = validation.message;
    if (!validation.valid) {
        return false;
    }
    wizardState = { ...wizardState, name: validation.name };
    wizardState = PlaylistWizard.goToStep(wizardState, 'method');
    renderWizardStep(wizardState.step);
    return true;
}

// Remember the chosen method and show the matching selection step.
function selectWizardMethod(method) {
    if (!isGeneratorAvailable() || !['song', 'mood'].includes(method)) {
        return;
    }
    wizardState = { ...wizardState, method };
    wizardState = PlaylistWizard.goToStep(wizardState, method);
    renderWizardStep(wizardState.step);
}

// Return to a prior step without clearing the name or chosen song and mood.
function moveWizardBack(step) {
    wizardState = PlaylistWizard.goToStep(wizardState, step);
    renderWizardStep(wizardState.step, 'back');
}

// Search the cached sorted catalog with the shared capped title/artist helper.
function searchWizardSeeds(event) {
    wizardState = {
        ...wizardState,
        searchQuery: event.target.value,
        seedTrackId: null,
        seedTitle: ''
    };
    renderWizardSeedSearch(wizardState.searchQuery);
    updateWizardGenerateButtons();
}

// Render safe, bounded seed matches and their "showing X of Y" status.
function renderWizardSeedSearch(query) {
    const resultList = document.getElementById('wizardSongResults');
    const status = document.getElementById('wizardSongSearchStatus');
    resultList.replaceChildren();
    if (query.trim() === '') {
        status.textContent = 'Enter a title or artist to find a seed song.';
        updateWizardSeedStatus();
        return;
    }
    const results = PlaylistUI.findSongsByName(songIndex.songs, query, GENERATOR_SEARCH_LIMIT);
    status.textContent = results.totalMatches === 0
        ? 'No songs match that title or artist.'
        : `Showing ${results.shown} of ${results.totalMatches} matches.`;
    results.songs.forEach((song) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'generator-seed-option';
        button.textContent = `${song.title || song.track_name || 'Untitled'} — ${song.artist || song.artists || 'Unknown artist'}`;
        prependMusicNoteTile(button);
        button.addEventListener('click', () => selectWizardSeed(song.track_id));
        resultList.appendChild(button);
    });
    updateWizardSeedStatus();
}

// Select a seed only when the song is present in both the catalog and graph.
function selectWizardSeed(trackId) {
    const song = songCatalog.search(trackId);
    if (!song || !songGraph || !songGraph.hasNode(trackId)) {
        wizardState = { ...wizardState, seedTrackId: null, seedTitle: '' };
        document.getElementById('wizardSelectedSeed').textContent =
            'That song is not available as a seed.';
        updateWizardGenerateButtons();
        return;
    }
    wizardState = {
        ...wizardState,
        seedTrackId: String(trackId),
        seedTitle: song.title || song.track_name || 'Untitled'
    };
    updateWizardSeedStatus();
    updateWizardGenerateButtons();
}

// Keep the selected seed visible while navigating backward and forward.
function updateWizardSeedStatus() {
    const status = wizardState.seedTrackId
        ? `Selected: ${wizardState.seedTitle}`
        : 'No seed song selected.';
    document.getElementById('wizardSelectedSeed').textContent = status;
}

// Enable Generate only after a valid seed or exported mood is selected.
function updateWizardGenerateButtons() {
    const canGenerate = PlaylistWizard.canGenerate(wizardState) && isGeneratorAvailable();
    document.getElementById('wizardSongGenerate').disabled =
        !(wizardState.method === 'song' && canGenerate);
    document.getElementById('wizardMoodGenerate').disabled =
        !(wizardState.method === 'mood' && canGenerate);
}

// Handle Escape in the wizard without interfering with the open navigation menu.
function handlePlaylistWizardKeydown(event) {
    if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        activeSection === 'generator' &&
        !document.getElementById('mainMenu').classList.contains('open') &&
        wizardState.step !== 'start'
    ) {
        event.preventDefault();
        cancelPlaylistWizard();
    }
}

// Invalidate pending results and return the wizard to its clean start screen.
function cancelPlaylistWizard() {
    invalidatePlaylistGeneration();
    wizardState = PlaylistWizard.createWizardState();
    lastGeneratedPlaylist = null;
    window.lastGeneratedPlaylist = null;
    document.getElementById('wizardNameError').textContent = '';
    renderWizardStep('start', 'back');
}

// Invalidate a running request so a late result cannot overwrite the new state.
function invalidatePlaylistGeneration() {
    generationRequestToken++;
    generationInProgress = false;
    if (loadingMessageInterval !== null) {
        clearInterval(loadingMessageInterval);
        loadingMessageInterval = null;
    }
}

// Show a short loading transition and call the selected generator exactly once.
async function runPlaylistGeneration() {
    if (
        generationInProgress ||
        !isGeneratorAvailable() ||
        !PlaylistWizard.canGenerate(wizardState)
    ) {
        return false;
    }

    generationInProgress = true;
    const requestToken = ++generationRequestToken;
    const startedAt = Date.now();
    const request = { ...wizardState };
    wizardState = {
        ...wizardState,
        result: null,
        saved: false,
        saving: false,
        saveError: '',
        error: '',
        confirmDelete: false
    };
    wizardState = PlaylistWizard.goToStep(wizardState, 'loading');
    renderWizardStep(wizardState.step);

    const messages = request.method === 'song'
        ? ['Analysing audio features...', 'Finding similar songs...', 'Building your playlist...']
        : ['Reviewing your selected mood...', 'Finding matching songs...', 'Building your playlist...'];
    let messageIndex = 0;
    document.getElementById('wizardLoadingStatus').textContent = messages[messageIndex];
    loadingMessageInterval = setInterval(() => {
        messageIndex = (messageIndex + 1) % messages.length;
        document.getElementById('wizardLoadingStatus').textContent = messages[messageIndex];
    }, 800);

    let safetyTimeout = null;
    try {
        const generationPromise = Promise.resolve().then(() => {
            return request.method === 'song'
                ? playlistGenerator.generateFromSeed(request.seedTrackId)
                : playlistGenerator.generateFromMood(request.mood);
        });
        const protectedGeneration = Promise.race([
            generationPromise,
            new Promise((resolve, reject) => {
                safetyTimeout = setTimeout(() => {
                    reject(new Error('Playlist generation took too long. Please try again.'));
                }, GENERATION_SAFETY_TIMEOUT_MS);
            })
        ]).then(
            (result) => ({ result }),
            (error) => ({ error })
        );
        const remainingTime = PlaylistWizard.getRemainingLoadingTime(
            startedAt,
            Date.now(),
            LOADING_DURATION_MS
        );
        const minimumDisplay = new Promise((resolve) => {
            setTimeout(resolve, remainingTime);
        });
        const [outcome] = await Promise.all([protectedGeneration, minimumDisplay]);
        if (outcome.error) {
            throw outcome.error;
        }
        if (
            !outcome.result ||
            !Array.isArray(outcome.result.songs) ||
            typeof outcome.result.type !== 'string'
        ) {
            throw new Error('The playlist generator returned an invalid result.');
        }
        if (requestToken !== generationRequestToken) {
            return false;
        }
        lastGeneratedPlaylist = outcome.result;
        window.lastGeneratedPlaylist = outcome.result;
        wizardState = {
            ...wizardState,
            result: outcome.result,
            saved: false,
            saving: false
        };
        wizardState = PlaylistWizard.goToStep(wizardState, 'result');
        renderWizardStep(wizardState.step);
        return outcome.result;
    } catch (error) {
        if (requestToken === generationRequestToken) {
            console.error('Playlist generation failed:', error);
            wizardState = {
                ...wizardState,
                error: 'Playlist generation failed. Check the catalog and try again.',
                result: null
            };
            wizardState = PlaylistWizard.goToStep(wizardState, 'error');
            renderWizardStep(wizardState.step);
        }
        return false;
    } finally {
        if (safetyTimeout !== null) {
            clearTimeout(safetyTimeout);
        }
        if (requestToken === generationRequestToken) {
            if (loadingMessageInterval !== null) {
                clearInterval(loadingMessageInterval);
                loadingMessageInterval = null;
            }
            generationInProgress = false;
        }
    }
}

// Render result details in generator order with safe text nodes and no playback controls.
function renderGeneratedPlaylist() {
    const result = wizardState.result;
    if (!result) {
        return;
    }
    const heading = document.getElementById('wizardResultHeading');
    const summary = document.getElementById('wizardResultSummary');
    const message = document.getElementById('wizardResultMessage');
    const tableContainer = document.getElementById('wizardResultsTable');
    const songs = result.songs;
    const method = wizardState.method === 'song'
        ? `Seed song: ${wizardState.seedTitle}`
        : `Mood: ${PlaylistUI.formatMoodName(wizardState.mood, window.MOOD_PROFILES)}`;
    heading.textContent = wizardState.name;
    summary.textContent = `${method} · ${songs.length} of ${result.requested || 20} songs`;
    message.textContent = result.message || '';
    tableContainer.replaceChildren();
    if (songs.length > 0) {
        const table = document.createElement('table');
        table.className = 'generator-table';
        const head = document.createElement('thead');
        const headerRow = document.createElement('tr');
        ['#', 'Track', 'Artist', 'Genre', ...GENERATOR_FEATURES.map(([, label]) => label)]
            .forEach((label) => {
                const cell = document.createElement('th');
                cell.scope = 'col';
                cell.textContent = label;
                headerRow.appendChild(cell);
            });
        head.appendChild(headerRow);
        table.appendChild(head);
        const body = document.createElement('tbody');
        songs.forEach((song, index) => {
            const row = document.createElement('tr');
            const values = [
                String(index + 1),
                `${index === 0 && result.type === 'seed' ? 'Seed: ' : ''}${song.title || song.track_name || 'Untitled'}`,
                song.artist || song.artists || 'Unknown artist',
                song.track_genre || '—',
                ...GENERATOR_FEATURES.map(([feature]) => {
                    return PlaylistUI.formatAudioFeature(feature, song[feature]);
                })
            ];
            values.forEach((value, valueIndex) => {
                const cell = document.createElement('td');
                cell.textContent = value;
                if (valueIndex === 1) {
                    cell.className = 'generator-track-cell';
                    prependMusicNoteTile(cell);
                }
                row.appendChild(cell);
            });
            body.appendChild(row);
        });
        table.appendChild(body);
        tableContainer.appendChild(table);
    } else {
        const emptyResult = document.createElement('p');
        emptyResult.className = 'empty-state';
        emptyResult.textContent = result.message || 'No songs were returned for this playlist.';
        tableContainer.appendChild(emptyResult);
    }

    const hasSongs = songs.length > 0;
    document.getElementById('wizardResultActions').hidden = !hasSongs || wizardState.saved;
    document.getElementById('wizardExportActions').hidden = !hasSongs;
    document.getElementById('wizardYouTubeExport').disabled = !hasSongs || !youtubeExportUI;
    document.getElementById('wizardEmptyResultActions').hidden = hasSongs;
    document.getElementById('wizardSavedActions').hidden = !wizardState.saved;
    document.getElementById('wizardDeleteConfirmation').hidden =
        !hasSongs || wizardState.saved || !wizardState.confirmDelete;
    document.getElementById('wizardSaveButton').disabled =
        !PlaylistWizard.canSaveGenerated(wizardState);
    document.getElementById('wizardSaveStatus').textContent = wizardState.saved
        ? 'Saved to your Library.'
        : wizardState.saveError;
}

// Save the generated result through the same localStorage path as queue snapshots.
function saveGeneratedPlaylist() {
    if (!PlaylistWizard.canSaveGenerated(wizardState)) {
        return false;
    }
    const savedPlaylist = PlaylistWizard.buildSavedPlaylist(
        wizardState,
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
        new Date().toISOString()
    );
    wizardState = { ...wizardState, saving: true, saveError: '' };
    const outcome = persistSavedPlaylist(savedPlaylist);
    if (!outcome.success) {
        wizardState = { ...wizardState, saving: false, saveError: outcome.message };
        renderGeneratedPlaylist();
        return false;
    }
    wizardState = { ...wizardState, saving: false, saved: true };
    renderSavedPlaylistCards(document.getElementById('homePlaylistsDisplay'));
    updateLibraryDisplay();
    renderGeneratedPlaylist();
    return true;
}

// Reveal a lightweight inline discard confirmation without using a browser modal.
function showDeleteConfirmation() {
    wizardState = { ...wizardState, confirmDelete: true };
    renderGeneratedPlaylist();
    document.getElementById('wizardDeleteConfirm').focus();
}

// Close the discard confirmation and retain the generated result.
function hideDeleteConfirmation() {
    wizardState = { ...wizardState, confirmDelete: false };
    renderGeneratedPlaylist();
    document.getElementById('wizardDeleteButton').focus();
}

// Discard only the in-memory generated result and return to the wizard start.
function discardGeneratedPlaylist() {
    cancelPlaylistWizard();
}

// Return from an empty result to its selection step without saving anything.
function backFromEmptyResult() {
    const selectionStep = wizardState.method === 'song' ? 'song' : 'mood';
    wizardState = PlaylistWizard.goToStep(wizardState, selectionStep);
    renderWizardStep(wizardState.step, 'back');
}

// Open the DSA operation visualizer.
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

// Bind the header search so typing on any screen opens Search after a short pause.
function setupGlobalSearch() {
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', () => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            searchDebounceTimer = null;
            handleGlobalSearch(searchInput.value);
        }, SEARCH_DEBOUNCE_MS);
    });
}

// Move to Search for a query, or return to the previous screen once it is cleared.
function handleGlobalSearch(rawQuery) {
    const query = rawQuery.trim();
    if (query === '') {
        renderSearchResults('');
        if (activeSection === 'search' && searchReturnSection) {
            const returnSection = searchReturnSection;
            searchReturnSection = null;
            switchSection(returnSection);
        }
        return;
    }
    if (activeSection !== 'search') {
        searchReturnSection = activeSection;
        switchSection('search', { preserveWizard: true });
    }
    renderSearchResults(query);
}

// Search song titles using the B-Tree's compatibility scan and render animated cards.
function renderSearchResults(query) {
    const searchResults = document.getElementById('searchResults');
    searchResults.replaceChildren();

    if (query === '') {
        searchResults.appendChild(createEmptySearchState('Search for your favorite songs'));
        return;
    }

    const results = songCatalog.searchByTitle(query).sort((firstSong, secondSong) => {
        return firstSong.title.toLowerCase().localeCompare(secondSong.title.toLowerCase());
    });
    addVisualizationStep(`Searched for "${query}" in B-Tree - Found ${results.length} result(s)`);

    if (results.length === 0) {
        searchResults.appendChild(createEmptySearchState(`No results found for "${query}".`));
        return;
    }

    const grid = document.createElement('div');
    grid.className = 'search-results-grid';
    results.forEach((song, index) => {
        const card = document.createElement('article');
        card.className = 'search-result-card';
        // Only the first cards are staggered so long result lists still appear quickly.
        card.style.setProperty('--card-index', String(Math.min(index, SEARCH_STAGGER_LIMIT)));

        const title = document.createElement('h3');
        title.className = 'search-result-title';
        title.textContent = song.title || song.track_name || 'Untitled';
        card.appendChild(title);

        const artist = document.createElement('p');
        artist.className = 'search-result-artist';
        artist.textContent = song.artist || song.artists || 'Unknown artist';
        card.appendChild(artist);

        const genre = document.createElement('p');
        genre.className = 'search-result-genre';
        genre.textContent = song.track_genre || 'Genre not available';
        card.appendChild(genre);

        const addButton = document.createElement('button');
        addButton.className = 'btn-secondary btn-small search-result-add';
        addButton.type = 'button';
        addButton.textContent = 'Add to queue';
        addButton.addEventListener('click', () => addSongToPlaylist(song.track_id));
        card.appendChild(addButton);
        prependMusicNoteTile(card);
        grid.appendChild(card);
    });
    searchResults.appendChild(grid);
}

// Return the shared rounded music-note icon markup used on every song row and card.
function musicNoteIconMarkup() {
    return '<svg class="music-note-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
        '<path d="M9 17.5V5.8a1 1 0 0 1 .8-1l9-1.7a1 1 0 0 1 1.2 1v11.4"></path>' +
        '<path d="M9 9.2l11-2.1"></path>' +
        '<circle cx="6.5" cy="17.5" r="2.5"></circle>' +
        '<circle cx="17.5" cy="15.5" r="2.5"></circle>' +
        '</svg>';
}

// Build the decorative tile that holds the music-note icon.
function createMusicNoteTile() {
    const tile = document.createElement('span');
    tile.className = 'song-icon-tile';
    tile.setAttribute('aria-hidden', 'true');
    tile.innerHTML = musicNoteIconMarkup();
    return tile;
}

// Put the music-note tile before a song element's existing content.
function prependMusicNoteTile(element) {
    element.insertBefore(createMusicNoteTile(), element.firstChild);
}

// Build the centered message used for empty and no-match search states.
function createEmptySearchState(text) {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-search-state';
    const message = document.createElement('p');
    message.textContent = text;
    emptyState.appendChild(message);
    return emptyState;
}

// Add searched song to playlist
function addSongToPlaylist(songId) {
    const song = songCatalog.search(songId);

    if (song) {
        playlist.enqueue(song);
        updateQueueStatus();
        addVisualizationStep(`✓ Added "${song.title}" to playlist from search`);
        showNotification(`Added "${song.title}" to playlist!`);
    }
}

// Read saved playlist records without masking storage or data-format failures.
function readSavedPlaylists() {
    let storedValue;
    try {
        storedValue = window.localStorage.getItem(SAVED_PLAYLISTS_STORAGE_KEY);
    } catch (error) {
        console.error('Could not read saved playlists from localStorage:', error);
        return null;
    }
    if (storedValue === null) {
        return [];
    }

    let savedPlaylists;
    try {
        savedPlaylists = JSON.parse(storedValue);
    } catch (error) {
        console.error('Saved playlist data is not valid JSON:', error);
        return null;
    }
    if (
        !Array.isArray(savedPlaylists) ||
        savedPlaylists.some((savedPlaylist) => {
            return !savedPlaylist ||
                typeof savedPlaylist.id !== 'string' ||
                typeof savedPlaylist.name !== 'string' ||
                !Array.isArray(savedPlaylist.songs);
        })
    ) {
        console.error('Saved playlist data has an unsupported format.');
        return null;
    }
    return savedPlaylists;
}

// Create one text-safe playlist card shared by Home and Library.
// Library cards are openable and lead to the playlist detail view.
function renderPlaylistCard(savedPlaylist, openable = false) {
    const card = document.createElement('article');
    card.className = 'saved-playlist-card';

    const name = document.createElement('h3');
    name.className = 'saved-playlist-name';
    name.textContent = savedPlaylist.name;
    card.appendChild(name);

    const count = document.createElement('p');
    count.className = 'saved-playlist-count';
    count.textContent = `${savedPlaylist.songs.length} song${savedPlaylist.songs.length === 1 ? '' : 's'}`;
    card.appendChild(count);

    if (openable) {
        card.classList.add('saved-playlist-card-openable');
        card.addEventListener('click', (event) => {
            if (!event.target.closest('button')) {
                openPlaylistDetail(savedPlaylist.id);
            }
        });
        const openButton = document.createElement('button');
        openButton.className = 'btn-secondary saved-playlist-open';
        openButton.type = 'button';
        openButton.textContent = 'Open';
        openButton.setAttribute('aria-label', `Open playlist ${savedPlaylist.name}`);
        openButton.addEventListener('click', () => openPlaylistDetail(savedPlaylist.id));
        card.appendChild(openButton);
    }

    const exportButton = document.createElement('button');
    exportButton.className = 'btn-youtube saved-playlist-export';
    exportButton.type = 'button';
    exportButton.textContent = 'Export to YouTube';
    exportButton.disabled = !youtubeExportUI;
    exportButton.addEventListener('click', () => openYouTubeExport(savedPlaylist));
    card.appendChild(exportButton);

    if (openable) {
        const deleteButton = document.createElement('button');
        deleteButton.className = 'btn-secondary btn-delete saved-playlist-delete';
        deleteButton.type = 'button';
        deleteButton.textContent = 'Delete';
        deleteButton.setAttribute('aria-label', `Delete playlist ${savedPlaylist.name}`);
        card.appendChild(deleteButton);

        const confirmation = document.createElement('div');
        confirmation.className = 'wizard-confirmation saved-playlist-confirm';
        confirmation.hidden = true;
        const question = document.createElement('span');
        question.textContent = 'Delete this playlist?';
        const confirmButton = document.createElement('button');
        confirmButton.className = 'btn-secondary btn-delete';
        confirmButton.type = 'button';
        confirmButton.textContent = 'Yes, delete';
        const keepButton = document.createElement('button');
        keepButton.className = 'btn-secondary';
        keepButton.type = 'button';
        keepButton.textContent = 'Cancel';
        confirmation.appendChild(question);
        confirmation.appendChild(confirmButton);
        confirmation.appendChild(keepButton);
        card.appendChild(confirmation);

        deleteButton.addEventListener('click', () => {
            deleteButton.hidden = true;
            confirmation.hidden = false;
            confirmButton.focus();
        });
        keepButton.addEventListener('click', () => {
            confirmation.hidden = true;
            deleteButton.hidden = false;
            deleteButton.focus();
        });
        confirmButton.addEventListener('click', () => deleteSavedPlaylist(savedPlaylist.id));
    }
    prependMusicNoteTile(card);
    return card;
}

// Render saved playlists or the shared empty/error state into either page.
function renderSavedPlaylistCards(container, openable = false) {
    const savedPlaylists = readSavedPlaylists();
    container.replaceChildren();
    if (savedPlaylists === null) {
        const message = document.createElement('p');
        message.className = 'empty-state saved-playlist-error';
        message.textContent = 'Saved playlists could not be loaded from this browser.';
        container.appendChild(message);
        return;
    }
    if (savedPlaylists.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'playlist-empty-state';

        const message = document.createElement('p');
        message.textContent = 'No playlists yet. Create one now!';
        emptyState.appendChild(message);

        const createButton = document.createElement('button');
        createButton.className = 'btn-primary';
        createButton.type = 'button';
        createButton.textContent = 'Create one now';
        createButton.addEventListener('click', () => switchSection('generator'));
        emptyState.appendChild(createButton);
        container.appendChild(emptyState);
        return;
    }

    savedPlaylists.forEach((savedPlaylist) => {
        container.appendChild(renderPlaylistCard(savedPlaylist, openable));
    });
}

// Render a fresh sample from the cached B-Tree index without changing catalog data.
function renderRecommendations() {
    const recommendationsDisplay = document.getElementById('recommendationsDisplay');
    recommendationsDisplay.replaceChildren();
    if (catalogSongs.length === 0) {
        const message = document.createElement('p');
        message.className = 'empty-state';
        message.textContent = catalogLoadMessage || 'Song library is empty.';
        recommendationsDisplay.appendChild(message);
        return;
    }

    PlaylistUI.sampleSongs(catalogSongs, RECOMMENDATION_COUNT).forEach((song) => {
        const card = document.createElement('article');
        card.className = 'recommendation-song-card';

        const title = document.createElement('h3');
        title.className = 'recommendation-title';
        title.textContent = song.title || song.track_name || 'Untitled';
        card.appendChild(title);

        const artist = document.createElement('p');
        artist.className = 'recommendation-artist';
        artist.textContent = song.artists || song.artist || 'Unknown artist';
        card.appendChild(artist);

        const genre = document.createElement('p');
        genre.className = 'recommendation-genre';
        genre.textContent = song.track_genre || 'Genre not available';
        card.appendChild(genre);
        prependMusicNoteTile(card);
        recommendationsDisplay.appendChild(card);
    });
}

// Refresh both Home sections from their current sources.
function renderHome() {
    renderRecommendations();
    renderSavedPlaylistCards(document.getElementById('homePlaylistsDisplay'));
}

// Keep the Library focused on saved playlists while retaining CSV-load status.
function updateLibraryDisplay() {
    const libraryStatus = document.getElementById('libraryStatus');
    libraryStatus.textContent = catalogLoadMessage;
    libraryStatus.hidden = catalogLoadMessage === '';
    renderSavedPlaylistCards(document.getElementById('libraryDisplay'), true);
}

// Persist one playlist through the shared saved-playlist format and storage key.
function persistSavedPlaylist(savedPlaylist) {
    const savedPlaylists = readSavedPlaylists();
    if (savedPlaylists === null) {
        return { success: false, message: 'Saved playlists could not be accessed.' };
    }
    const updated = PlaylistWizard.addPlaylistOnce(savedPlaylists, savedPlaylist);
    if (!updated.added) {
        return { success: false, message: 'This playlist has already been saved.' };
    }
    try {
        window.localStorage.setItem(
            SAVED_PLAYLISTS_STORAGE_KEY,
            JSON.stringify(updated.playlists)
        );
    } catch (error) {
        console.error('Could not save playlist to localStorage:', error);
        return { success: false, message: 'Playlist could not be saved in this browser.' };
    }
    return { success: true, message: '' };
}

// Save a named snapshot of the temporary search queue without saving generator results.
function saveCurrentQueue() {
    const nameInput = document.getElementById('playlistNameInput');
    const name = nameInput.value.trim();
    const queuedSongs = playlist.getAllSongs().map(({ song }) => song);
    if (queuedSongs.length === 0) {
        showNotification('Add songs to the queue before saving a playlist.', 'error');
        return false;
    }
    if (name === '') {
        showNotification('Enter a name for this playlist.', 'error');
        nameInput.focus();
        return false;
    }

    const savedPlaylist = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
        name,
        createdAt: new Date().toISOString(),
        songs: queuedSongs.map((song) => ({ ...song }))
    };
    const outcome = persistSavedPlaylist(savedPlaylist);
    if (!outcome.success) {
        showNotification(outcome.message, 'error');
        return false;
    }

    nameInput.value = '';
    renderSavedPlaylistCards(document.getElementById('homePlaylistsDisplay'));
    updateLibraryDisplay();
    showNotification(`Saved playlist "${name}".`);
    return true;
}

// Save an edited playlist in place under the same storage key the Library reads.
function updateSavedPlaylist(updatedPlaylist) {
    const savedPlaylists = readSavedPlaylists();
    if (savedPlaylists === null) {
        return { success: false, message: 'Saved playlists could not be accessed.' };
    }
    const updated = PlaylistEditor.replacePlaylist(savedPlaylists, updatedPlaylist);
    if (!updated.replaced) {
        return { success: false, message: 'This playlist no longer exists.' };
    }
    try {
        window.localStorage.setItem(
            SAVED_PLAYLISTS_STORAGE_KEY,
            JSON.stringify(updated.playlists)
        );
    } catch (error) {
        console.error('Could not update playlist in localStorage:', error);
        return { success: false, message: 'Playlist changes could not be saved in this browser.' };
    }
    return { success: true, message: '' };
}

// Delete one saved playlist by ID and refresh every view that lists playlists.
function deleteSavedPlaylist(playlistId) {
    const savedPlaylists = readSavedPlaylists();
    if (savedPlaylists === null) {
        showNotification('Saved playlists could not be accessed.', 'error');
        return false;
    }
    const result = PlaylistEditor.deletePlaylist(savedPlaylists, playlistId);
    if (!result.deleted) {
        showNotification('That playlist no longer exists.', 'error');
        updateLibraryDisplay();
        return false;
    }
    try {
        window.localStorage.setItem(
            SAVED_PLAYLISTS_STORAGE_KEY,
            JSON.stringify(result.playlists)
        );
    } catch (error) {
        console.error('Could not delete playlist from localStorage:', error);
        showNotification('Playlist could not be deleted in this browser.', 'error');
        return false;
    }

    // A pending song-removal undo for this playlist can no longer apply.
    if (pendingUndo && pendingUndo.playlistId === playlistId) {
        hideUndoToast();
    }
    if (openPlaylistId === playlistId) {
        openPlaylistId = null;
        if (activeSection === 'playlist') {
            switchSection('library');
        }
    }
    renderSavedPlaylistCards(document.getElementById('homePlaylistsDisplay'));
    updateLibraryDisplay();
    showNotification(`Deleted playlist "${result.removed.name}".`);
    return true;
}

// Find one saved playlist by ID, or null when storage or the ID is unavailable.
function findSavedPlaylist(playlistId) {
    const savedPlaylists = readSavedPlaylists();
    if (savedPlaylists === null) {
        return null;
    }
    return savedPlaylists.find((savedPlaylist) => savedPlaylist.id === playlistId) || null;
}

// Bind the playlist detail controls once; rows and search results bind their own buttons.
function setupPlaylistDetailUI() {
    document.getElementById('playlistDetailBack').addEventListener('click', closePlaylistDetail);
    document.getElementById('playlistRenameButton').addEventListener('click', showRenameForm);
    document.getElementById('playlistRenameForm').addEventListener('submit', submitPlaylistRename);
    document.getElementById('playlistRenameCancel').addEventListener('click', hideRenameForm);
    document.getElementById('playlistRenameInput').addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            hideRenameForm();
        }
    });
    document.getElementById('playlistAddSongsToggle').addEventListener('click', toggleAddSongsPanel);
    document.getElementById('playlistAddSearch').addEventListener('input', renderPlaylistAddResults);
    document.getElementById('undoToastButton').addEventListener('click', undoLastRemoval);
    document.getElementById('playlistDeleteButton').addEventListener('click', () => {
        document.getElementById('playlistDeleteConfirmation').hidden = false;
        document.getElementById('playlistDeleteConfirm').focus();
    });
    document.getElementById('playlistDeleteCancel').addEventListener('click', () => {
        document.getElementById('playlistDeleteConfirmation').hidden = true;
        document.getElementById('playlistDeleteButton').focus();
    });
    document.getElementById('playlistDeleteConfirm').addEventListener('click', () => {
        if (openPlaylistId) {
            deleteSavedPlaylist(openPlaylistId);
        }
    });
}

// Open a Library playlist in the detail view with its editors reset.
function openPlaylistDetail(playlistId) {
    if (!findSavedPlaylist(playlistId)) {
        showNotification('That playlist could not be found.', 'error');
        updateLibraryDisplay();
        return false;
    }
    openPlaylistId = playlistId;
    document.getElementById('playlistRenameForm').hidden = true;
    document.getElementById('playlistNameView').hidden = false;
    document.getElementById('playlistAddPanel').hidden = true;
    document.getElementById('playlistAddSongsToggle').setAttribute('aria-expanded', 'false');
    document.getElementById('playlistAddSongsToggle').textContent = 'Add songs';
    document.getElementById('playlistAddSearch').value = '';
    document.getElementById('playlistDeleteConfirmation').hidden = true;
    setPlaylistDetailMessage('');
    switchSection('playlist');
    document.getElementById('playlistDetailBack').focus();
    return true;
}

// Leave the detail view and show the refreshed Library.
function closePlaylistDetail() {
    openPlaylistId = null;
    switchSection('library');
}

// Show a short inline status or validation message in the detail view.
function setPlaylistDetailMessage(message) {
    document.getElementById('playlistDetailMessage').textContent = message;
}

// Render the open playlist's header, song rows, and add-song results from storage.
function renderPlaylistDetail() {
    const savedPlaylist = openPlaylistId ? findSavedPlaylist(openPlaylistId) : null;
    const songList = document.getElementById('playlistDetailSongs');
    songList.replaceChildren();
    if (!savedPlaylist) {
        document.getElementById('playlistDetailName').textContent = 'Playlist not found';
        document.getElementById('playlistDetailCount').textContent = '';
        document.getElementById('playlistRenameButton').disabled = true;
        document.getElementById('playlistAddSongsToggle').disabled = true;
        document.getElementById('playlistDeleteButton').disabled = true;
        return;
    }
    document.getElementById('playlistRenameButton').disabled = false;
    document.getElementById('playlistAddSongsToggle').disabled = false;
    document.getElementById('playlistDeleteButton').disabled = false;
    document.getElementById('playlistDetailName').textContent = savedPlaylist.name;
    const songCount = savedPlaylist.songs.length;
    const missingCount = savedPlaylist.songs.filter(isMissingFromCatalog).length;
    document.getElementById('playlistDetailCount').textContent =
        `${songCount} song${songCount === 1 ? '' : 's'}` +
        (missingCount > 0 ? ` · ${missingCount} not in the current song catalog` : '');

    if (songCount === 0) {
        const emptyState = document.createElement('li');
        emptyState.className = 'empty-state playlist-detail-empty';
        emptyState.textContent = 'This playlist is empty. Use "Add songs" to find tracks.';
        songList.appendChild(emptyState);
    }
    savedPlaylist.songs.forEach((song, index) => {
        songList.appendChild(renderPlaylistSongRow(song, index, songCount));
    });
    if (!document.getElementById('playlistAddPanel').hidden) {
        renderPlaylistAddResults();
    }
}

// Build one draggable song row with move up/down and remove controls.
function renderPlaylistSongRow(savedSong, index, songCount) {
    const song = savedSong && typeof savedSong === 'object' ? savedSong : {};
    const title = song.title || song.track_name || 'Untitled';
    const row = document.createElement('li');
    row.className = 'playlist-song-row';
    row.draggable = true;

    const handle = document.createElement('span');
    handle.className = 'playlist-song-handle';
    handle.setAttribute('aria-hidden', 'true');
    handle.textContent = '⋮⋮';
    row.appendChild(handle);

    const position = document.createElement('span');
    position.className = 'playlist-song-position';
    position.textContent = String(index + 1);
    row.appendChild(position);

    const info = document.createElement('div');
    info.className = 'playlist-song-info';
    const titleText = document.createElement('span');
    titleText.className = 'playlist-song-title';
    titleText.textContent = title;
    const artistText = document.createElement('span');
    artistText.className = 'playlist-song-artist';
    artistText.textContent = song.artist || song.artists || 'Unknown artist';
    info.appendChild(titleText);
    info.appendChild(artistText);
    if (isMissingFromCatalog(song)) {
        row.classList.add('playlist-song-missing');
        const missingNote = document.createElement('span');
        missingNote.className = 'playlist-song-missing-note';
        missingNote.textContent = 'Not in the current song catalog';
        info.appendChild(missingNote);
    }
    row.appendChild(createMusicNoteTile());
    row.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'playlist-song-actions';
    [
        ['move-up', '↑', `Move ${title} up`, index === 0, () => moveSongInOpenPlaylist(index, index - 1, 'move-up')],
        ['move-down', '↓', `Move ${title} down`, index === songCount - 1, () => moveSongInOpenPlaylist(index, index + 1, 'move-down')],
        ['remove', '✕', `Remove ${title}`, false, () => removeSongFromOpenPlaylist(index)]
    ].forEach(([action, label, ariaLabel, disabled, handler]) => {
        const button = document.createElement('button');
        button.className = `playlist-song-btn playlist-song-${action}`;
        button.type = 'button';
        button.textContent = label;
        button.title = ariaLabel;
        button.setAttribute('aria-label', ariaLabel);
        button.disabled = disabled;
        button.addEventListener('click', handler);
        actions.appendChild(button);
    });
    row.appendChild(actions);

    row.addEventListener('dragstart', (event) => {
        dragSourceIndex = index;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(index));
        row.classList.add('dragging');
    });
    row.addEventListener('dragover', (event) => {
        if (dragSourceIndex === null) {
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', (event) => {
        if (!row.contains(event.relatedTarget)) {
            row.classList.remove('drag-over');
        }
    });
    row.addEventListener('drop', (event) => {
        event.preventDefault();
        row.classList.remove('drag-over');
        const fromIndex = dragSourceIndex;
        dragSourceIndex = null;
        if (fromIndex !== null && fromIndex !== index) {
            moveSongInOpenPlaylist(fromIndex, index);
        }
    });
    row.addEventListener('dragend', () => {
        dragSourceIndex = null;
        row.classList.remove('dragging');
        document.querySelectorAll('.playlist-song-row.drag-over').forEach((overRow) => {
            overRow.classList.remove('drag-over');
        });
    });
    return row;
}

// Flag a saved song whose track ID is absent from the loaded catalog; saved copies still display.
function isMissingFromCatalog(song) {
    if (songCatalog.size === 0) {
        return false;
    }
    const trackId = PlaylistEditor.getTrackId(song);
    return trackId === '' || songCatalog.search(trackId) === null;
}

// Persist a pure edit result and refresh every view that shows the playlist.
function commitPlaylistEdit(result, errorMessages = {}) {
    if (!result.ok) {
        setPlaylistDetailMessage(errorMessages[result.error] || 'That change could not be made.');
        return false;
    }
    const outcome = updateSavedPlaylist(result.playlist);
    if (!outcome.success) {
        setPlaylistDetailMessage(outcome.message);
        return false;
    }
    setPlaylistDetailMessage('');
    renderPlaylistDetail();
    renderSavedPlaylistCards(document.getElementById('homePlaylistsDisplay'));
    return true;
}

// Reorder the open playlist and keep focus on the moved song's matching control.
function moveSongInOpenPlaylist(fromIndex, toIndex, focusAction = '') {
    const savedPlaylist = findSavedPlaylist(openPlaylistId);
    if (!savedPlaylist) {
        renderPlaylistDetail();
        return false;
    }
    const moved = commitPlaylistEdit(PlaylistEditor.moveSong(savedPlaylist, fromIndex, toIndex));
    if (moved && focusAction) {
        const rows = document.querySelectorAll('#playlistDetailSongs .playlist-song-row');
        const button = rows[toIndex] && rows[toIndex].querySelector(`.playlist-song-${focusAction}`);
        const fallback = rows[toIndex] && rows[toIndex].querySelector('.playlist-song-remove');
        const target = button && !button.disabled ? button : fallback;
        if (target) {
            target.focus();
        }
    }
    return moved;
}

// Remove one song and offer a short-lived undo.
function removeSongFromOpenPlaylist(index) {
    const savedPlaylist = findSavedPlaylist(openPlaylistId);
    if (!savedPlaylist) {
        renderPlaylistDetail();
        return false;
    }
    const result = PlaylistEditor.removeSong(savedPlaylist, index);
    if (!commitPlaylistEdit(result)) {
        return false;
    }
    showUndoToast({ playlistId: savedPlaylist.id, song: result.removed, index: result.index });
    return true;
}

// Show the undo toast for the latest removal; an older pending undo is dropped.
function showUndoToast(removal) {
    clearTimeout(undoToastTimer);
    pendingUndo = removal;
    const title = removal.song.title || removal.song.track_name || 'song';
    document.getElementById('undoToastMessage').textContent = `Removed "${title}".`;
    document.getElementById('undoToast').hidden = false;
    undoToastTimer = setTimeout(hideUndoToast, UNDO_DURATION_MS);
}

// Hide the undo toast and make the last removal permanent.
function hideUndoToast() {
    clearTimeout(undoToastTimer);
    undoToastTimer = null;
    pendingUndo = null;
    document.getElementById('undoToast').hidden = true;
}

// Put the most recently removed song back into its playlist.
function undoLastRemoval() {
    const removal = pendingUndo;
    hideUndoToast();
    if (!removal) {
        return false;
    }
    const savedPlaylist = findSavedPlaylist(removal.playlistId);
    if (!savedPlaylist) {
        showNotification('That playlist no longer exists.', 'error');
        return false;
    }
    const result = PlaylistEditor.restoreSong(savedPlaylist, removal.song, removal.index);
    if (!result.ok) {
        showNotification('The song could not be restored.', 'error');
        return false;
    }
    const outcome = updateSavedPlaylist(result.playlist);
    if (!outcome.success) {
        showNotification(outcome.message, 'error');
        return false;
    }
    if (activeSection === 'playlist' && openPlaylistId === removal.playlistId) {
        renderPlaylistDetail();
    }
    renderSavedPlaylistCards(document.getElementById('homePlaylistsDisplay'));
    return true;
}

// Swap the playlist title for an inline rename field.
function showRenameForm() {
    const savedPlaylist = findSavedPlaylist(openPlaylistId);
    if (!savedPlaylist) {
        return;
    }
    const input = document.getElementById('playlistRenameInput');
    input.value = savedPlaylist.name;
    document.getElementById('playlistNameView').hidden = true;
    document.getElementById('playlistRenameForm').hidden = false;
    input.focus();
    input.select();
}

// Restore the playlist title without saving the rename field.
function hideRenameForm() {
    document.getElementById('playlistRenameForm').hidden = true;
    document.getElementById('playlistNameView').hidden = false;
    document.getElementById('playlistRenameButton').focus();
}

// Save a trimmed, non-empty playlist name.
function submitPlaylistRename(event) {
    event.preventDefault();
    const savedPlaylist = findSavedPlaylist(openPlaylistId);
    if (!savedPlaylist) {
        renderPlaylistDetail();
        return false;
    }
    const renamed = commitPlaylistEdit(
        PlaylistEditor.renamePlaylist(savedPlaylist, document.getElementById('playlistRenameInput').value),
        {
            'empty-name': 'Playlist name cannot be empty.',
            'name-too-long': `Playlist name must be ${PlaylistEditor.MAX_PLAYLIST_NAME_LENGTH} characters or fewer.`
        }
    );
    if (!renamed) {
        document.getElementById('playlistRenameInput').focus();
        return false;
    }
    hideRenameForm();
    return true;
}

// Open or close the add-songs search panel.
function toggleAddSongsPanel() {
    const panel = document.getElementById('playlistAddPanel');
    const toggle = document.getElementById('playlistAddSongsToggle');
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    toggle.textContent = panel.hidden ? 'Add songs' : 'Done adding';
    if (!panel.hidden) {
        renderPlaylistAddResults();
        document.getElementById('playlistAddSearch').focus();
    }
}

// Search the catalog with the shared title/artist helper and mark songs already added.
function renderPlaylistAddResults() {
    const query = document.getElementById('playlistAddSearch').value;
    const resultList = document.getElementById('playlistAddResults');
    const status = document.getElementById('playlistAddStatus');
    const savedPlaylist = findSavedPlaylist(openPlaylistId);
    resultList.replaceChildren();
    if (!savedPlaylist) {
        status.textContent = 'This playlist could not be loaded.';
        return;
    }
    if (query.trim() === '') {
        status.textContent = 'Enter a title or artist to find songs.';
        return;
    }
    const results = PlaylistUI.findSongsByName(songIndex.songs, query, PLAYLIST_ADD_SEARCH_LIMIT);
    status.textContent = results.totalMatches === 0
        ? 'No songs match that title or artist.'
        : `Showing ${results.shown} of ${results.totalMatches} matches.`;
    results.songs.forEach((song) => {
        const isAdded = PlaylistEditor.hasSong(savedPlaylist, song.track_id);
        const item = document.createElement('li');
        item.className = 'playlist-add-result';

        const label = document.createElement('span');
        label.className = 'playlist-add-label';
        label.textContent = `${song.title || song.track_name || 'Untitled'} — ${song.artist || song.artists || 'Unknown artist'}`;
        item.appendChild(label);

        const addButton = document.createElement('button');
        addButton.className = 'btn-secondary btn-small';
        addButton.type = 'button';
        addButton.textContent = isAdded ? 'Added' : 'Add';
        addButton.disabled = isAdded;
        addButton.addEventListener('click', () => addSongToOpenPlaylist(song.track_id));
        item.appendChild(addButton);
        prependMusicNoteTile(item);
        resultList.appendChild(item);
    });
}

// Add one catalog song to the open playlist, refusing duplicates.
function addSongToOpenPlaylist(trackId) {
    const savedPlaylist = findSavedPlaylist(openPlaylistId);
    const song = songCatalog.search(trackId);
    if (!savedPlaylist || !song) {
        setPlaylistDetailMessage('That song could not be added.');
        return false;
    }
    const added = commitPlaylistEdit(PlaylistEditor.addSong(savedPlaylist, song), {
        duplicate: 'That song is already in this playlist.'
    });
    if (added) {
        setPlaylistDetailMessage(`Added "${song.title || song.track_name || 'song'}".`);
        document.getElementById('playlistAddSearch').focus();
    }
    return added;
}

// Shuffle playlist using heap sort
function shufflePlaylist() {
    const songs = playlist.getAllSongs().map(({ song }) => song);
    
    if (songs.length === 0) {
        showNotification('Playlist is empty!', 'error');
        return;
    }

    addVisualizationStep('Starting heap sort shuffle...');
    const sorted = DSA.heapSort(songs);
    addVisualizationStep(`✓ Heap sort completed - ${sorted.length} songs sorted by rating`);
    
    // Clear and rebuild playlist
    playlist.clear();
    sorted.forEach(song => {
        playlist.enqueue(song);
    });
    
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
    updateQueueStatus();
    addVisualizationStep('Cleared playlist');
    showNotification('Playlist cleared!');
}

// Update queue status
function updateQueueStatus() {
    const queueStatus = document.getElementById('queueStatus');
    const size = playlist.size;
    queueStatus.textContent = `Queue: ${size} song${size !== 1 ? 's' : ''}`;
    const saveButton = document.getElementById('saveQueuePlaylistButton');
    if (saveButton) {
        saveButton.disabled = size === 0;
    }
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

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.songGraph = null;
    window.playlistGenerator = null;
    updateLibraryDisplay();
    updateQueueStatus();
    const csvLoadPromise = loadCSVSongs();
    setupMenu();
    setupNavigation();
    setupPlaylistSavingUI();
    setupYouTubeExportUI();
    setupPlaylistGeneratorUI();
    setupPlaylistDetailUI();
    setupGlobalSearch();
    addVisualizationStep('GenMix initialized');
    addVisualizationStep('DSA structures: B-Tree, Circular Queue, Max Heap ready');
    
    // Switch to home section by default
    switchSection('home');
    return csvLoadPromise;
});
