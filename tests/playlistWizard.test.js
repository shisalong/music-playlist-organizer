const Wizard = require('../src/playlist/playlistWizard.js');
const DSA = require('../src/core/dsa.js');
const { PlaylistGenerator, MOOD_NAMES } = require('../src/playlist/playlistGenerator.js');

let passed = 0;
let failed = 0;

// Fail a test immediately with a readable reason.
function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

// Compare JSON-compatible values and show both sides when they differ.
function assertEqual(actual, expected, message) {
    assert(
        JSON.stringify(actual) === JSON.stringify(expected),
        `${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`
    );
}

// Run one test and retain the repository's PASS/FAIL output format.
function runTest(name, test) {
    try {
        test();
        passed++;
        console.log(`PASS: ${name}`);
    } catch (error) {
        failed++;
        console.error(`FAIL: ${name} — ${error.message}`);
    }
}

// Build a valid selected-song wizard state for save and transition assertions.
function selectedSongState() {
    return {
        ...Wizard.createWizardState(),
        step: 'song',
        name: '  Study Mix  ',
        method: 'song',
        seedTrackId: 'track-1',
        seedTitle: 'Track One'
    };
}

runTest('playlist names reject empty and whitespace-only values', () => {
    assert(!Wizard.validatePlaylistName('').valid, 'Empty names should be rejected');
    assert(!Wizard.validatePlaylistName('   ').valid, 'Whitespace-only names should be rejected');
});

runTest('playlist names trim valid input and reject over-limit names', () => {
    assertEqual(
        Wizard.validatePlaylistName('  Focus  ').name,
        'Focus',
        'Valid names should be trimmed'
    );
    assert(
        !Wizard.validatePlaylistName('x'.repeat(Wizard.MAX_PLAYLIST_NAME_LENGTH + 1)).valid,
        'Names longer than the limit should be rejected'
    );
});

runTest('wizard transitions cover start, name, method, song, and mood paths', () => {
    let state = Wizard.createWizardState();
    state = Wizard.goToStep(state, 'name');
    state = { ...state, name: 'Focus', method: 'song' };
    state = Wizard.goToStep(state, 'method');
    state = Wizard.goToStep(state, 'song');
    state = Wizard.goToStep(state, 'method');
    state = { ...state, method: 'mood' };
    state = Wizard.goToStep(state, 'mood');
    assertEqual(state.step, 'mood', 'Method selection should lead to its matching step');
    assertEqual(state.name, 'Focus', 'Back navigation should preserve the name');
    assertEqual(state.method, 'mood', 'Back navigation should preserve the selected method');
});

runTest('generation requires a selected seed or mood', () => {
    const state = { ...Wizard.createWizardState(), method: 'song' };
    assert(!Wizard.canGenerate(state), 'Song generation should wait for a seed');
    assert(
        Wizard.canGenerate({ ...state, seedTrackId: 'track-1' }),
        'Song generation should allow a selected seed'
    );
    assert(
        Wizard.canGenerate({ ...state, method: 'mood', mood: 'happy' }),
        'Mood generation should allow a selected mood'
    );
});

runTest('cancel starts a fresh wizard with no retained choices or generated result', () => {
    const previous = {
        ...selectedSongState(),
        result: { songs: [{ track_id: 'track-1' }] },
        saved: true
    };
    const fresh = Wizard.createWizardState();
    assertEqual(fresh.step, 'start', 'Cancel should return to the start step');
    assertEqual(fresh.name, '', 'Cancel should clear the playlist name');
    assertEqual(fresh.seedTrackId, null, 'Cancel should clear the selected seed');
    assertEqual(fresh.mood, null, 'Cancel should clear the selected mood');
    assertEqual(fresh.result, null, 'Cancel should discard an unsaved result');
    assert(previous.result, 'Reset should not mutate the prior state object');
});

runTest('saved-playlist building validates results and copies full song records', () => {
    const song = { track_id: 'track-1', title: 'Track One' };
    const state = {
        ...selectedSongState(),
        result: { songs: [song] }
    };
    const saved = Wizard.buildSavedPlaylist(state, 'generated-1', '2026-10-24T00:00:00.000Z');
    assertEqual(saved.name, 'Study Mix', 'Saved names should be trimmed');
    assertEqual(saved.id, 'generated-1', 'Existing ID field should be retained');
    assertEqual(saved.createdAt, '2026-10-24T00:00:00.000Z', 'Existing date field should be retained');
    assertEqual(saved.songs[0].track_id, 'track-1', 'Full song fields should be retained');
    assert(saved.songs !== state.result.songs, 'Saved playlist should copy the songs array');
    assert(saved.songs[0] !== song, 'Saved records should not alias mutable catalog records');
    let rejectedEmptyResult = false;
    try {
        Wizard.buildSavedPlaylist({ ...state, result: { songs: [] } }, 'generated-2', 'now');
    } catch {
        rejectedEmptyResult = true;
    }
    assert(rejectedEmptyResult, 'An empty generated result must not be saveable');
});

runTest('duplicate generated saves are rejected without mutating existing playlists', () => {
    const existing = [{ id: 'generated-1', name: 'Existing', songs: [] }];
    const duplicate = Wizard.addPlaylistOnce(existing, { id: 'generated-1', name: 'Duplicate' });
    assert(!duplicate.added, 'A matching generated ID should be refused');
    assertEqual(duplicate.playlists, existing, 'Duplicate detection should preserve the original list');
    const added = Wizard.addPlaylistOnce(existing, { id: 'generated-2', name: 'New' });
    assert(added.added, 'A new ID should be added');
    assertEqual(existing.length, 1, 'Adding a playlist must not mutate the original list');
});

runTest('loading duration helper returns only the remaining minimum display time', () => {
    assertEqual(Wizard.getRemainingLoadingTime(100, 150, 250), 200, 'Fast generation should wait the remainder');
    assertEqual(Wizard.getRemainingLoadingTime(100, 400, 250), 0, 'Slow generation should not wait extra');
});

runTest('real generator handles small seeded song and exported mood requests', () => {
    const catalog = new DSA.BTree();
    const songs = Array.from({ length: 4 }, (_, index) => {
        const value = 0.8 + index * 0.05;
        const song = {
            track_id: `wizard-fixture-${index}`,
            title: `Wizard Fixture ${index}`,
            artist: 'Fixture Artist',
            track_genre: 'fixture',
            danceability: value,
            energy: 0.2 + index * 0.2,
            acousticness: 0.9 - index * 0.2,
            valence: value,
            tempo: 80 + index * 30
        };
        catalog.insert(song.track_id, song);
        return song;
    });
    const graph = new DSA.SongGraph().buildFromSongs(catalog.inorderTraversal());
    const generator = new PlaylistGenerator(catalog, graph);
    const seedResult = generator.generateFromSeed(songs[0].track_id, { random: () => 0.5 });
    assertEqual(seedResult.songs[0].track_id, songs[0].track_id, 'Seed generation should return the seed first');
    assertEqual(
        new Set(seedResult.songs.map((song) => song.track_id)).size,
        seedResult.songs.length,
        'Seed result should contain no duplicate tracks'
    );
    const moodResult = generator.generateFromMood(MOOD_NAMES[0], { random: () => 0.5 });
    assertEqual(moodResult.mood, MOOD_NAMES[0], 'Mood generation should use an exported mood key');
    assert(moodResult.songs.length > 0, 'The fixture should produce a non-empty matching mood result');
    const unknownSeed = generator.generateFromSeed('missing-seed', { random: () => 0.5 });
    assertEqual(unknownSeed.songs.length, 0, 'Unknown seeds should produce a safe empty result');
});

console.log(`\nTest summary: ${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exitCode = 1;
}
