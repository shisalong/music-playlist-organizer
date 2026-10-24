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
const RECOMMENDATION_COUNT = 12;
const LOADING_DURATION_MS = 2500;
const GENERATION_SAFETY_TIMEOUT_MS = 10000;
let isPlaying = false;
let currentTime = 0;
let totalTime = 0;
let progressInterval = null;
let lastGeneratedPlaylist = null;
window.lastGeneratedPlaylist = null;
let wizardState = PlaylistWizard.createWizardState();
let generationRequestToken = 0;
let generationInProgress = false;
let loadingMessageInterval = null;
let activeSection = 'home';
let previousBodyOverflow = '';
let catalogLoadMessage = 'Song library is empty. Could not load songs_cleaned.csv.';
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
        const response = await fetch('songs_cleaned.csv');
        if (!response.ok) {
            throw new Error(`Could not load songs_cleaned.csv: ${response.status}`);
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
            catalogLoadMessage = 'Song library is empty. No usable songs were loaded from songs_cleaned.csv.';
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
        catalogLoadMessage = 'Song library is empty. Could not load songs_cleaned.csv.';
        renderHome();
        updateLibraryDisplay();
        showNotification('Could not load songs_cleaned.csv.', 'error');
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
    document.getElementById('playerBar').inert = true;
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
    document.getElementById('playerBar').inert = false;
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
function switchSection(section) {
    if (activeSection === 'generator' && section !== 'generator') {
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
        case 'generator':
            document.getElementById('generatorSection').classList.add('active');
            updateGeneratorAvailability();
            renderWizardStep(wizardState.step);
            break;
    }
    activeSection = section;

    document.querySelectorAll('.nav-item').forEach((item) => {
        const isCurrent = item.getAttribute('data-section') === section;
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
function renderWizardStep(step) {
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
    renderWizardStep(wizardState.step);
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
    renderWizardStep('start');
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
            values.forEach((value) => {
                const cell = document.createElement('td');
                cell.textContent = value;
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
    renderWizardStep(wizardState.step);
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

// Search song titles using the B-Tree's compatibility scan.
function searchSongs(event) {
    const query = event.target.value.trim();
    const searchResults = document.getElementById('searchResults');
    
    if (query === '') {
        searchResults.innerHTML = `
            <div class="empty-search-state">
                <p>Search for your favorite songs</p>
            </div>
        `;
        return;
    }

    const results = songCatalog.searchByTitle(query).sort((firstSong, secondSong) => {
        return firstSong.title.toLowerCase().localeCompare(secondSong.title.toLowerCase());
    });
    addVisualizationStep(`Searched for "${query}" in B-Tree - Found ${results.length} result(s)`);
    
    if (results.length === 0) {
        searchResults.innerHTML = `
            <div class="empty-search-state">
                <p>No results found for "${query}".</p>
            </div>
        `;
        return;
    }

    searchResults.innerHTML = results.map(song => `
        <div class="search-result-item" onclick="addSongToPlaylist('${song.track_id}')">
            <div class="search-result-info">
                <div class="search-result-title">${song.title}</div>
                <div class="search-result-artist">${song.artist}</div>
            </div>
            <div class="search-result-rating">Rating: ${song.rating}</div>
        </div>
    `).join('');
}

// Add searched song to playlist
function addSongToPlaylist(songId) {
    const song = songCatalog.search(songId);
    
    if (song) {
        playlist.enqueue(song);
        updateNowPlaying();
        updateQueueStatus();
        addVisualizationStep(`✓ Added "${song.title}" to playlist from search`);
        showNotification(`Added "${song.title}" to playlist!`);
    }
}

// Set current song
function setCurrentSong(index) {
    const songs = playlist.getAllSongs();
    if (songs[index]) {
        // Set the current index to the song's queue index
        playlist.currentIndex = songs[index].index;
        currentTime = 0;
        updateNowPlaying();
        if (isPlaying) {
            startProgress();
        }
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
function renderPlaylistCard(savedPlaylist) {
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
    return card;
}

// Render saved playlists or the shared empty/error state into either page.
function renderSavedPlaylistCards(container) {
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
        container.appendChild(renderPlaylistCard(savedPlaylist));
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
    renderSavedPlaylistCards(document.getElementById('libraryDisplay'));
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

    addVisualizationStep('Starting heap sort shuffle...');
    const sorted = DSA.heapSort(songs);
    addVisualizationStep(`✓ Heap sort completed - ${sorted.length} songs sorted by rating`);
    
    // Clear and rebuild playlist
    playlist.clear();
    sorted.forEach(song => {
        playlist.enqueue(song);
    });
    
    updateNowPlaying();
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
    updateNowPlaying();
    updateQueueStatus();
    addVisualizationStep('Cleared playlist');
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
        playPauseBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"></path></svg>';
        playPauseBtn.setAttribute('aria-label', 'Pause');
        addVisualizationStep(`Playing: "${current.title}"`);
        showNotification('Playing: ' + current.title);
        startProgress();
    } else {
        playPauseBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 12 7-12 7z"></path></svg>';
        playPauseBtn.setAttribute('aria-label', 'Play');
        addVisualizationStep(`Paused: "${current.title}"`);
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
        addVisualizationStep(`Next: "${next.title}" (Circular Queue navigation)`);
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
        addVisualizationStep(`Previous: "${previous.title}" (Circular Queue navigation)`);
        updateNowPlaying();
        if (isPlaying) {
            showNotification('Playing: ' + previous.title);
            startProgress();
        }
    }
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
    window.songGraph = null;
    window.playlistGenerator = null;
    updateLibraryDisplay();
    updateQueueStatus();
    updateNowPlaying();
    const csvLoadPromise = loadCSVSongs();
    setupMenu();
    setupNavigation();
    setupPlaylistSavingUI();
    setupPlaylistGeneratorUI();
    setupProgressBar();
    addVisualizationStep('GenMix initialized');
    addVisualizationStep('DSA structures: B-Tree, Circular Queue, Max Heap ready');
    
    // Switch to home section by default
    switchSection('home');
    return csvLoadPromise;
});