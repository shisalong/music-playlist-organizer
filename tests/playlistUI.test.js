const {
    findSongsByName,
    sampleSongs,
    formatAudioFeature,
    formatMoodName
} = require('../src/playlist/playlistUI.js');

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

// Run one helper test and print the project's PASS/FAIL format.
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

// Create minimal song objects for name-search tests.
function makeSong(trackId, title, artist) {
    return { track_id: trackId, title, artist };
}

const songs = [
    makeSong('1', 'Blue Monday', 'New Order'),
    makeSong('2', 'Blue Train', 'John Coltrane'),
    makeSong('3', 'Song Three', 'Blue Artist'),
    makeSong('4', 'Fourth Song', 'Other Artist')
];

runTest('name search matches title and artist text', () => {
    assertEqual(
        findSongsByName(songs, 'Monday').songs.map((song) => song.track_id),
        ['1'],
        'Title substring should match'
    );
    assertEqual(
        findSongsByName(songs, 'Coltrane').songs.map((song) => song.track_id),
        ['2'],
        'Artist substring should match'
    );
});

runTest('name search is case-insensitive and returns no-match counts', () => {
    const caseInsensitive = findSongsByName(songs, 'bLuE');
    assertEqual(caseInsensitive.totalMatches, 3, 'Query should match titles and artists without case sensitivity');
    const noMatch = findSongsByName(songs, 'not present');
    assertEqual(noMatch, { songs: [], totalMatches: 0, shown: 0 }, 'Unmatched query should return an empty result');
});

runTest('name search caps visible results and reports total matches', () => {
    const result = findSongsByName(songs, 'blue', 2);
    assertEqual(result.songs.map((song) => song.track_id), ['1', '2'], 'Only the first two matches should be visible');
    assertEqual(result.totalMatches, 3, 'Total matching count should not be capped');
    assertEqual(result.shown, 2, 'Shown count should reflect rendered matches');
});

runTest('name search handles empty input without scanning or returning songs', () => {
    assertEqual(findSongsByName(songs, '   '), { songs: [], totalMatches: 0, shown: 0 }, 'Whitespace query should be empty');
    assertEqual(findSongsByName(songs, null), { songs: [], totalMatches: 0, shown: 0 }, 'Non-string query should be empty');
});

runTest('song sampling returns the requested number of distinct items', () => {
    const result = sampleSongs(songs, 3, () => 0);
    assertEqual(result.length, 3, 'Sample should contain the requested number of songs');
    assertEqual(new Set(result).size, 3, 'Sample should contain distinct songs');
});

runTest('song sampling does not mutate the catalog array', () => {
    const original = [...songs];
    sampleSongs(songs, 3, () => 0.5);
    assertEqual(songs, original, 'Sampling must leave the input array unchanged');
});

runTest('song sampling returns every available item when the request is larger', () => {
    const result = sampleSongs(songs, 10, () => 0);
    assertEqual(result.length, songs.length, 'Sample should be limited to available songs');
    assertEqual(
        result.map((song) => song.track_id).sort(),
        songs.map((song) => song.track_id).sort(),
        'Sample should include every available song'
    );
});

runTest('song sampling returns an empty array for an empty catalog', () => {
    assertEqual(sampleSongs([], 10), [], 'An empty catalog should produce no recommendations');
});

runTest('audio feature formatter uses whole BPM and two decimal places', () => {
    assertEqual(formatAudioFeature('tempo', 119.73), '120', 'Tempo should round to whole BPM');
    assertEqual(formatAudioFeature('danceability', 0.5267), '0.53', 'Other features should show two decimals');
    assertEqual(formatAudioFeature('energy', NaN), '—', 'Invalid value should render as a dash');
});

runTest('mood label helper uses exported display names or formats keys', () => {
    const profiles = { happy: { name: 'Happy / Upbeat' } };
    assertEqual(formatMoodName('happy', profiles), 'Happy / Upbeat', 'Existing profile label should be reused');
    assertEqual(formatMoodName('low_energy', {}), 'Low Energy', 'Unknown profile key should be capitalized');
});

console.log(`\nTest summary: ${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exitCode = 1;
}
