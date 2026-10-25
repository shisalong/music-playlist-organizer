const fs = require('fs');
const path = require('path');
const {
    BTree,
    SONG_LIMIT,
    parseCSVRows,
    loadSongsFromCSV,
    binarySearchIndexByTrackId,
    binarySearchByTrackId,
    isSortedByTrackId,
    buildSortedSongArray,
    SortedSongIndex
} = require('../src/core/dsa.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function assertEqual(actual, expected, message) {
    assert(
        JSON.stringify(actual) === JSON.stringify(expected),
        `${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`
    );
}

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

function makeSong(trackId) {
    return {
        id: trackId,
        track_id: trackId,
        title: trackId,
        artist: 'Test Artist',
        duration: 0,
        rating: 0
    };
}

function insertIds(ids) {
    const tree = new BTree(3);
    ids.forEach((trackId) => {
        tree.insert(trackId, makeSong(trackId));
    });
    return tree;
}

function sortedIds(count) {
    return Array.from({ length: count }, (_, index) => {
        return `track-${String(index).padStart(5, '0')}`;
    });
}

runTest('inorder traversal sorts ordered, reversed, and shuffled inserts', () => {
    const expected = sortedIds(80);
    const ordered = insertIds(expected);
    const reversed = insertIds([...expected].reverse());
    const shuffledIds = [...expected];
    let seed = 341;
    for (let index = shuffledIds.length - 1; index > 0; index--) {
        seed = (seed * 16807) % 2147483647;
        const swapIndex = seed % (index + 1);
        [shuffledIds[index], shuffledIds[swapIndex]] =
            [shuffledIds[swapIndex], shuffledIds[index]];
    }
    const shuffled = insertIds(shuffledIds);

    [ordered, reversed, shuffled].forEach((tree) => {
        assertEqual(
            tree.inorderTraversal().map((song) => song.track_id),
            expected,
            'Traversal must be in ascending track_id order'
        );
        assert(tree.validate(), 'Tree invariants must hold after insertion');
    });
});

runTest('search finds existing keys and returns null for missing keys', () => {
    const tree = insertIds(['track-a', 'track-c', 'track-b']);
    assertEqual(tree.search(' track-b '), makeSong('track-b'), 'Search should trim keys');
    assert(tree.search('track-missing') === null, 'Missing keys should return null');
    assert(tree.contains('track-a'), 'contains should find inserted keys');
    assert(!tree.contains('track-missing'), 'contains should reject missing keys');
});

runTest('title search fallback preserves case-insensitive partial matching', () => {
    const tree = new BTree();
    const firstSong = { ...makeSong('id-1'), title: 'A Bright Song' };
    const secondSong = { ...makeSong('id-2'), title: 'Bright Morning' };
    tree.insert(firstSong.track_id, firstSong);
    tree.insert(secondSong.track_id, secondSong);

    assertEqual(
        tree.searchByTitle('BRIGHT').map((song) => song.track_id),
        ['id-1', 'id-2'],
        'Title search should keep the old partial, case-insensitive behavior'
    );
});

runTest('splitting preserves B-Tree node rules and equal leaf depth', () => {
    const tree = new BTree(2);
    sortedIds(300).forEach((trackId) => tree.insert(trackId, makeSong(trackId)));
    assert(tree.height() > 1, 'Inserting 300 ordered keys should split the root');
    assert(tree.validate(), 'All nodes must satisfy B-Tree invariants');
});

runTest('duplicate track IDs are skipped and counted', () => {
    const tree = new BTree(3);
    const firstSong = makeSong('same-id');
    const secondSong = { ...makeSong('same-id'), title: 'Later copy' };

    assert(tree.insert('same-id', firstSong), 'First insert should succeed');
    assert(!tree.insert(' same-id ', secondSong), 'Duplicate insert should fail');
    assertEqual(tree.size, 1, 'A duplicate must not increase tree size');
    assertEqual(tree.duplicateCount, 1, 'Duplicate counter should increase');
    assert(tree.search('same-id') === firstSong, 'First occurrence must be retained');
});

runTest('5,000 shuffled songs insert, traverse, search, and validate', () => {
    const ids = sortedIds(5000);
    let seed = 987654321;
    for (let index = ids.length - 1; index > 0; index--) {
        seed = (seed * 16807) % 2147483647;
        const swapIndex = seed % (index + 1);
        [ids[index], ids[swapIndex]] = [ids[swapIndex], ids[index]];
    }

    const tree = new BTree();
    ids.forEach((trackId) => {
        const song = makeSong(trackId);
        tree.insert(trackId, song);
    });

    assertEqual(tree.size, 5000, 'Tree should contain all unique songs');
    assertEqual(
        tree.inorderTraversal().map((song) => song.track_id),
        sortedIds(5000),
        'All songs should traverse in sorted order'
    );
    ids.forEach((trackId) => {
        const foundSong = tree.search(trackId);
        assert(
            foundSong && foundSong.track_id === trackId && foundSong.title === trackId,
            `Search should return the original song for ${trackId}`
        );
    });
    assert(tree.validate(), 'Scale-test tree must pass validation');
});

runTest('CSV parser supports quoted commas and escaped quotes', () => {
    const rows = parseCSVRows(
        'track_id,track_name,artists\r\n' +
        'id-1,"Song, with a comma","Artist ""A"", Artist B"\r\n'
    );
    assertEqual(rows[1][1], 'Song, with a comma', 'Quoted commas should stay in one field');
    assertEqual(rows[1][2], 'Artist "A", Artist B', 'Escaped quotes should be decoded');
});

runTest('CSV loader reports duplicates, skips empty IDs, and defaults invalid numbers', () => {
    const csvText = [
        'track_id,track_name,artists,track_genre,danceability,energy,acousticness,valence,tempo',
        'id-1,"Song, One","Artist ""A"", Artist B",genre,0.5,invalid,0.2,0.4,98',
        'id-1,Duplicate,Later Artist,genre,0.1,0.2,0.3,0.4,100',
        ',Missing ID,No Artist,genre,0.1,0.2,0.3,0.4,100'
    ].join('\n');
    const tree = new BTree();
    const stats = loadSongsFromCSV(csvText, tree);
    const firstSong = tree.search('id-1');

    assertEqual(stats.rowsRead, 3, 'Loader should count each nonblank data row');
    assertEqual(stats.songsInserted, 1, 'Only the first copy should be inserted');
    assertEqual(stats.duplicatesSkipped, 1, 'Loader should count the duplicate');
    assertEqual(stats.skippedRows, 1, 'Loader should count the row without a track ID');
    assertEqual(firstSong.title, 'Song, One', 'The first duplicate should be retained');
    assertEqual(firstSong.artist, 'Artist "A", Artist B', 'CSV values should be parsed');
    assertEqual(firstSong.energy, 0, 'Invalid numeric fields should default to zero');
    assert(tree.validate(), 'Loader output should satisfy B-Tree invariants');
});

const csvPath = path.join(__dirname, '..', 'data', 'songs_deduped.csv');
const DEDUPED_CSV_SONG_COUNT = 4428;
if (fs.existsSync(csvPath)) {
    runTest('real CSV loads up to the configured limit and validates', () => {
        const csvText = fs.readFileSync(csvPath, 'utf8');
        const tree = new BTree();
        const stats = loadSongsFromCSV(csvText, tree);

        assert(DEDUPED_CSV_SONG_COUNT <= SONG_LIMIT, 'The deduplicated CSV should fit within the row limit');
        assertEqual(stats.rowsRead, DEDUPED_CSV_SONG_COUNT, 'Loader should process every deduplicated data row');
        assertEqual(stats.songsInserted, DEDUPED_CSV_SONG_COUNT, 'Every deduplicated row should be inserted');
        assertEqual(stats.duplicatesSkipped, 0, 'The deduplicated CSV should contain no repeated track IDs');
        assertEqual(
            stats.songsInserted + stats.duplicatesSkipped + stats.skippedRows,
            stats.rowsRead,
            'Every processed data row should be inserted, counted as duplicate, or skipped'
        );
        assertEqual(tree.size, stats.songsInserted, 'Tree size should match inserted-song count');
        assert(tree.validate(), 'CSV-loaded tree must pass validation');
    });
} else {
    console.log('SKIP: real CSV load — songs_deduped.csv is not present');
}

runTest('binary search finds several existing IDs in a sorted array', () => {
    const songs = ['id-001', 'id-004', 'id-008', 'id-012', 'id-020'].map(makeSong);
    assert(binarySearchByTrackId(songs, 'id-001') === songs[0], 'First ID should be found');
    assert(binarySearchByTrackId(songs, 'id-008') === songs[2], 'Middle ID should be found');
    assert(binarySearchByTrackId(songs, ' id-020 ') === songs[4], 'Input ID should be trimmed');
});

runTest('binary search returns null for IDs below, above, and between keys', () => {
    const songs = ['id-010', 'id-020', 'id-030'].map(makeSong);
    assert(binarySearchByTrackId(songs, 'id-001') === null, 'ID below the first should miss');
    assert(binarySearchByTrackId(songs, 'id-999') === null, 'ID above the last should miss');
    assert(binarySearchByTrackId(songs, 'id-025') === null, 'ID between keys should miss');
});

runTest('binary search finds the first array element', () => {
    const songs = ['id-a', 'id-b', 'id-c'].map(makeSong);
    assert(binarySearchByTrackId(songs, 'id-a') === songs[0], 'First element should be found');
    assertEqual(binarySearchIndexByTrackId(songs, 'id-a'), 0, 'First index should be zero');
});

runTest('binary search finds the last array element', () => {
    const songs = ['id-a', 'id-b', 'id-c'].map(makeSong);
    assert(binarySearchByTrackId(songs, 'id-c') === songs[2], 'Last element should be found');
    assertEqual(binarySearchIndexByTrackId(songs, 'id-c'), 2, 'Last index should be two');
});

runTest('empty binary searches return null and index -1 without throwing', () => {
    assert(binarySearchByTrackId([], 'id-a') === null, 'Empty array should return null');
    assertEqual(binarySearchIndexByTrackId([], 'id-a'), -1, 'Empty array index should be -1');
});

runTest('single-element binary search handles found and missing keys', () => {
    const songs = [makeSong('only-id')];
    assert(binarySearchByTrackId(songs, 'only-id') === songs[0], 'Matching key should be found');
    assert(binarySearchByTrackId(songs, 'other-id') === null, 'Other key should miss');
});

runTest('binary search handles two-element and three-element arrays', () => {
    const twoSongs = ['id-a', 'id-c'].map(makeSong);
    const threeSongs = ['id-a', 'id-b', 'id-c'].map(makeSong);
    assert(binarySearchByTrackId(twoSongs, 'id-a') === twoSongs[0], 'Two-element first key');
    assert(binarySearchByTrackId(twoSongs, 'id-c') === twoSongs[1], 'Two-element last key');
    assert(binarySearchByTrackId(threeSongs, 'id-b') === threeSongs[1], 'Three-element middle key');
});

runTest('sorted check and sorted-copy helper preserve the original array', () => {
    const sortedSongs = ['id-a', 'id-b', 'id-c'].map(makeSong);
    const unsortedSongs = ['id-c', 'id-a', 'id-b'].map(makeSong);
    const originalIds = unsortedSongs.map((song) => song.track_id);
    const sortedCopy = buildSortedSongArray(unsortedSongs);

    assert(isSortedByTrackId(sortedSongs), 'Sorted input should pass the check');
    assert(!isSortedByTrackId(unsortedSongs), 'Unsorted input should fail the check');
    assert(isSortedByTrackId(sortedCopy), 'Sorted copy should pass the check');
    assert(sortedCopy !== unsortedSongs, 'Helper should return a new array');
    assertEqual(
        sortedCopy.map((song) => song.track_id),
        ['id-a', 'id-b', 'id-c'],
        'Sorted copy should be ordered by track ID'
    );
    assertEqual(
        unsortedSongs.map((song) => song.track_id),
        originalIds,
        'Original array should not be mutated'
    );
});

runTest('sorted index from B-Tree traversal contains unique duplicate IDs only', () => {
    const tree = new BTree();
    const firstSong = makeSong('id-a');
    tree.insert('id-a', firstSong);
    tree.insert('id-b', makeSong('id-b'));
    tree.insert('id-a', { ...firstSong, title: 'Duplicate song' });

    const sortedArray = buildSortedSongArray(tree.inorderTraversal());
    assertEqual(sortedArray.length, tree.size, 'Sorted array length should match tree size');
    assertEqual(
        sortedArray.map((song) => song.track_id),
        ['id-a', 'id-b'],
        'Traversal-based array should contain unique sorted IDs'
    );
    assert(sortedArray[0] === firstSong, 'First occurrence should be retained');
});

runTest('binary search matches B-Tree for 5,000 shuffled synthetic songs', () => {
    const ids = sortedIds(5000);
    let seed = 246813579;
    for (let index = ids.length - 1; index > 0; index--) {
        seed = (seed * 16807) % 2147483647;
        const swapIndex = seed % (index + 1);
        [ids[index], ids[swapIndex]] = [ids[swapIndex], ids[index]];
    }

    const tree = new BTree();
    ids.forEach((trackId) => tree.insert(trackId, makeSong(trackId)));
    const songIndex = new SortedSongIndex(tree);
    assertEqual(songIndex.songs.length, tree.size, 'Index should hold all unique songs');
    assert(isSortedByTrackId(songIndex.songs), 'Index snapshot should be sorted');

    ids.forEach((trackId) => {
        assert(
            songIndex.search(trackId) === tree.search(trackId),
            `Both methods should return the same song for ${trackId}`
        );
    });

    for (let index = 0; index < 500; index++) {
        seed = (seed * 16807) % 2147483647;
        const missingId = `missing-${String(seed).padStart(10, '0')}`;
        assert(tree.search(missingId) === null, 'B-Tree should miss synthetic missing ID');
        assert(songIndex.search(missingId) === null, 'Binary search should miss synthetic missing ID');
    }
});

const binarySearchCsvPath = path.join(__dirname, '..', 'data', 'songs_deduped.csv');
if (fs.existsSync(binarySearchCsvPath)) {
    runTest('binary search matches B-Tree for every real CSV row', () => {
        const csvText = fs.readFileSync(binarySearchCsvPath, 'utf8');
        const tree = new BTree();
        const stats = loadSongsFromCSV(csvText, tree);
        const songIndex = new SortedSongIndex(tree);

        assertEqual(stats.rowsRead, DEDUPED_CSV_SONG_COUNT, 'Loader should process every deduplicated CSV row');
        assertEqual(songIndex.songs.length, tree.size, 'Sorted array length should match tree size');
        assert(isSortedByTrackId(songIndex.songs), 'CSV index should be sorted');
        songIndex.songs.forEach((song) => {
            assert(
                songIndex.search(song.track_id) === tree.search(song.track_id),
                `Both methods should return the same CSV song for ${song.track_id}`
            );
        });

        ['missing-csv-id-1', 'zzzz-missing-csv-id', '0000-missing-csv-id'].forEach((trackId) => {
            assert(tree.search(trackId) === null, 'B-Tree should miss CSV test ID');
            assert(songIndex.search(trackId) === null, 'Binary search should miss CSV test ID');
        });
    });
} else {
    console.log('SKIP: binary search real CSV comparison — songs_deduped.csv is not present');
}

console.log(`\nTest summary: ${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exitCode = 1;
}
