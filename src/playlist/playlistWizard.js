// Keep wizard transitions and saved-playlist shaping independent of the DOM.
(function (global) {
    const MAX_PLAYLIST_NAME_LENGTH = 60;
    const WIZARD_STEPS = Object.freeze([
        'start',
        'name',
        'method',
        'song',
        'mood',
        'loading',
        'result',
        'error'
    ]);
    const STEP_TRANSITIONS = Object.freeze({
        start: ['name'],
        name: ['method', 'start'],
        method: ['name', 'song', 'mood', 'start'],
        song: ['method', 'loading', 'start'],
        mood: ['method', 'loading', 'start'],
        loading: ['result', 'error', 'start'],
        result: ['loading', 'song', 'mood', 'start'],
        error: ['loading', 'start']
    });

    // Create a fresh wizard state without touching catalog or saved-playlist data.
    function createWizardState() {
        return {
            step: 'start',
            name: '',
            method: null,
            seedTrackId: null,
            seedTitle: '',
            mood: null,
            searchQuery: '',
            result: null,
            saved: false,
            saving: false,
            saveError: '',
            error: '',
            confirmDelete: false
        };
    }

    // Trim and validate the user-provided name before advancing the wizard.
    function validatePlaylistName(value, maxLength = MAX_PLAYLIST_NAME_LENGTH) {
        const name = typeof value === 'string' ? value.trim() : '';
        if (name === '') {
            return { valid: false, name, message: 'Please enter a playlist name.' };
        }
        if (name.length > maxLength) {
            return {
                valid: false,
                name,
                message: `Playlist names must be ${maxLength} characters or fewer.`
            };
        }
        return { valid: true, name, message: '' };
    }

    // Move between known wizard steps while preserving all selected inputs.
    function goToStep(state, step) {
        if (!state || !WIZARD_STEPS.includes(step)) {
            throw new TypeError('A valid wizard state and step are required');
        }
        if (!STEP_TRANSITIONS[state.step].includes(step)) {
            throw new RangeError(`Cannot move from ${state.step} to ${step}`);
        }
        return { ...state, step };
    }

    // Prevent generation until the current method has a valid selection.
    function canGenerate(state) {
        if (!state || state.step === 'loading') {
            return false;
        }
        if (state.method === 'song') {
            return typeof state.seedTrackId === 'string' && state.seedTrackId.trim() !== '';
        }
        if (state.method === 'mood') {
            return typeof state.mood === 'string' && state.mood.trim() !== '';
        }
        return false;
    }

    // Allow one non-empty generated result to be saved exactly once.
    function canSaveGenerated(state) {
        return Boolean(
            state &&
            !state.saved &&
            !state.saving &&
            state.result &&
            Array.isArray(state.result.songs) &&
            state.result.songs.length > 0
        );
    }

    // Shape a generated result like existing saved playlists, copying each song record.
    function buildSavedPlaylist(state, id, createdAt) {
        if (!canSaveGenerated(state)) {
            throw new Error('Only an unsaved, non-empty generated playlist can be saved');
        }
        const validation = validatePlaylistName(state.name);
        if (!validation.valid) {
            throw new Error(validation.message);
        }
        if (typeof id !== 'string' || id.trim() === '') {
            throw new TypeError('A playlist ID is required');
        }
        if (typeof createdAt !== 'string' || createdAt.trim() === '') {
            throw new TypeError('A playlist creation date is required');
        }
        return {
            id,
            name: validation.name,
            createdAt,
            songs: state.result.songs.map((song) => ({ ...song }))
        };
    }

    // Add a playlist immutably unless its ID has already been saved.
    function addPlaylistOnce(savedPlaylists, playlist) {
        if (!Array.isArray(savedPlaylists) || !playlist || typeof playlist.id !== 'string') {
            throw new TypeError('A saved-playlist array and playlist ID are required');
        }
        if (savedPlaylists.some((savedPlaylist) => savedPlaylist.id === playlist.id)) {
            return { added: false, playlists: savedPlaylists };
        }
        return { added: true, playlists: [...savedPlaylists, playlist] };
    }

    // Calculate the remaining UI-only loading time without delaying generation logic.
    function getRemainingLoadingTime(startedAt, now, minimumDuration) {
        if (![startedAt, now, minimumDuration].every(Number.isFinite) || minimumDuration < 0) {
            throw new TypeError('Loading times must be finite non-negative numbers');
        }
        return Math.max(0, minimumDuration - (now - startedAt));
    }

    const PlaylistWizard = {
        MAX_PLAYLIST_NAME_LENGTH,
        createWizardState,
        validatePlaylistName,
        goToStep,
        canGenerate,
        canSaveGenerated,
        buildSavedPlaylist,
        addPlaylistOnce,
        getRemainingLoadingTime
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PlaylistWizard;
    }
    if (typeof window !== 'undefined') {
        window.PlaylistWizard = PlaylistWizard;
    }
})(typeof window !== 'undefined' ? window : globalThis);
