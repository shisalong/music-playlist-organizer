const Editor = require('../src/playlist/playlistEditor.js');

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

// Build a saved playlist in the shape stored by the Library.
function samplePlaylist() {
    return {
        id: 'playlist-1',
        name: 'Road Trip',
        createdAt: '2026-01-01T00:00:00.000Z',
        songs: [
            { track_id: 'a', title: 'Alpha' },
            { track_id: 'b', title: 'Bravo' },
            { track_id: 'c', title: 'Charlie' }
        ]
    };
}

// Return the playlist's track IDs in order.
function trackIds(playlist) {
    return playlist.songs.map((song) => song.track_id);
}

runTest('addSong appends a copy without mutating the original', () => {
    const original = samplePlaylist();
    const song = { track_id: 'd', title: 'Delta' };
    const result = Editor.addSong(original, song);
    assert(result.ok, 'Adding a new song should succeed');
    assertEqual(trackIds(result.playlist), ['a', 'b', 'c', 'd'], 'The song should be appended');
    assertEqual(trackIds(original), ['a', 'b', 'c'], 'The original playlist must not change');
    assert(result.playlist.songs[3] !== song, 'The stored song should be a copy');
});

runTest('addSong blocks duplicates, including padded track IDs', () => {
    const original = samplePlaylist();
    const result = Editor.addSong(original, { track_id: ' b ', title: 'Bravo again' });
    assert(!result.ok, 'A duplicate must be rejected');
    assertEqual(result.error, 'duplicate', 'The rejection should name the duplicate');
    assert(result.playlist === original, 'A rejected edit should return the original playlist');
    assert(Editor.hasSong(original, 'b'), 'hasSong should find an existing track');
    assert(!Editor.hasSong(original, 'z'), 'hasSong should not find a missing track');
});

runTest('addSong rejects songs without a track ID', () => {
    assertEqual(Editor.addSong(samplePlaylist(), { title: 'No ID' }).error, 'invalid-song', 'Missing ID');
    assertEqual(Editor.addSong(samplePlaylist(), null).error, 'invalid-song', 'Null song');
});

runTest('removeSong removes one entry and reports it for undo', () => {
    const original = samplePlaylist();
    const result = Editor.removeSong(original, 1);
    assert(result.ok, 'Removing an existing index should succeed');
    assertEqual(trackIds(result.playlist), ['a', 'c'], 'Bravo should be removed');
    assertEqual(result.removed.track_id, 'b', 'The removed song should be returned');
    assertEqual(result.index, 1, 'The removed index should be returned');
    assertEqual(trackIds(original), ['a', 'b', 'c'], 'The original playlist must not change');

    const restored = Editor.restoreSong(result.playlist, result.removed, result.index);
    assert(restored.ok, 'Undo should succeed');
    assertEqual(trackIds(restored.playlist), ['a', 'b', 'c'], 'Undo should restore the old position');
});

runTest('restoreSong clamps a stale index and still blocks duplicates', () => {
    const shortened = { ...samplePlaylist(), songs: [{ track_id: 'a' }] };
    const restored = Editor.restoreSong(shortened, { track_id: 'b' }, 5);
    assertEqual(trackIds(restored.playlist), ['a', 'b'], 'A stale index should clamp to the end');
    assertEqual(
        Editor.restoreSong(samplePlaylist(), { track_id: 'a' }, 0).error,
        'duplicate',
        'Undo must not create a duplicate'
    );
});

runTest('removeSong rejects out-of-range and non-integer indexes', () => {
    const original = samplePlaylist();
    [-1, 3, 1.5, '1', undefined].forEach((index) => {
        const result = Editor.removeSong(original, index);
        assert(!result.ok, `Index ${String(index)} should be rejected`);
        assertEqual(result.error, 'out-of-range', `Index ${String(index)} should report out-of-range`);
        assert(result.playlist === original, 'A rejected removal should return the original playlist');
    });
    assertEqual(
        Editor.removeSong({ ...original, songs: [] }, 0).error,
        'out-of-range',
        'An empty playlist has no removable index'
    );
});

runTest('renamePlaylist trims names and rejects empty ones', () => {
    const original = samplePlaylist();
    const renamed = Editor.renamePlaylist(original, '  Night Drive  ');
    assert(renamed.ok, 'A non-empty name should be accepted');
    assertEqual(renamed.playlist.name, 'Night Drive', 'The name should be trimmed');
    assertEqual(original.name, 'Road Trip', 'The original playlist must not change');
    ['', '   ', null, undefined, 42].forEach((name) => {
        const result = Editor.renamePlaylist(original, name);
        assert(!result.ok, `Name ${JSON.stringify(name)} should be rejected`);
        assertEqual(result.error, 'empty-name', 'Empty names should report empty-name');
    });
    assertEqual(
        Editor.renamePlaylist(original, 'x'.repeat(Editor.MAX_PLAYLIST_NAME_LENGTH + 1)).error,
        'name-too-long',
        'Overlong names should be rejected'
    );
});

runTest('moveSong reorders forward, backward, and to the same position', () => {
    const original = samplePlaylist();
    assertEqual(trackIds(Editor.moveSong(original, 0, 2).playlist), ['b', 'c', 'a'], 'Move first to last');
    assertEqual(trackIds(Editor.moveSong(original, 2, 0).playlist), ['c', 'a', 'b'], 'Move last to first');
    assertEqual(trackIds(Editor.moveSong(original, 1, 2).playlist), ['a', 'c', 'b'], 'Move down one');
    const same = Editor.moveSong(original, 1, 1);
    assert(same.ok && same.playlist === original, 'Moving to the same index should be a no-op');
    assertEqual(trackIds(original), ['a', 'b', 'c'], 'The original playlist must not change');
});

runTest('moveSong rejects out-of-range source and target indexes', () => {
    const original = samplePlaylist();
    [[-1, 0], [0, -1], [3, 0], [0, 3], [0.5, 1], [0, '1']].forEach(([from, to]) => {
        const result = Editor.moveSong(original, from, to);
        assert(!result.ok, `Move ${from} -> ${to} should be rejected`);
        assertEqual(result.error, 'out-of-range', `Move ${from} -> ${to} should report out-of-range`);
        assert(result.playlist === original, 'A rejected move should return the original playlist');
    });
});

runTest('replacePlaylist swaps one playlist by ID and keeps order', () => {
    const first = samplePlaylist();
    const second = { ...samplePlaylist(), id: 'playlist-2', name: 'Second' };
    const updated = { ...first, name: 'Renamed' };
    const result = Editor.replacePlaylist([first, second], updated);
    assert(result.replaced, 'An existing ID should be replaced');
    assertEqual(result.playlists.map((saved) => saved.name), ['Renamed', 'Second'], 'Order should be kept');
    const missing = Editor.replacePlaylist([second], updated);
    assert(!missing.replaced, 'An unknown ID should not be replaced');
    assertEqual(missing.playlists.length, 1, 'An unknown ID should not add a playlist');
});

runTest('deletePlaylist removes one playlist by ID and keeps the rest in order', () => {
    const first = samplePlaylist();
    const second = { ...samplePlaylist(), id: 'playlist-2', name: 'Second' };
    const third = { ...samplePlaylist(), id: 'playlist-3', name: 'Third' };
    const original = [first, second, third];
    const result = Editor.deletePlaylist(original, 'playlist-2');
    assert(result.deleted, 'An existing ID should be deleted');
    assert(result.removed === second, 'The deleted playlist should be returned');
    assertEqual(result.playlists.map((saved) => saved.id), ['playlist-1', 'playlist-3'], 'Others should keep their order');
    assertEqual(original.length, 3, 'The original list must not change');

    const missing = Editor.deletePlaylist(result.playlists, 'playlist-2');
    assert(!missing.deleted, 'Deleting an unknown ID should report no deletion');
    assert(missing.playlists === result.playlists, 'A missed delete should return the same list');
    assert(missing.removed === null, 'A missed delete should not report a removed playlist');
});

console.log(`\nTest summary: ${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exitCode = 1;
}
