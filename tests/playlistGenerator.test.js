const fs = require('fs');
const path = require('path');
const {
    BTree,
    SONG_FEATURES,
    NEIGHBOR_COUNT,
    SongGraph,
    hasValidFeatures,
    computeSimilarity,
    loadSongsFromCSV
} = require('../src/core/dsa.js');
const {
    PLAYLIST_SIZE,
    MOOD_NAMES,
    MOOD_PROFILES,
    shuffleSongs,
    PlaylistGenerator
} = require('../src/playlist/playlistGenerator.js');

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

// Run one test and retain the existing repository's PASS/FAIL output format.
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

// Create a song with all five audio features for small hand-made cases.
function makeSong(trackId, features = [0, 0, 0, 0, 0], extras = {}) {
    const song = {
        id: trackId,
        track_id: trackId,
        title: trackId,
        artist: 'Test Artist',
        duration: 180,
        rating: 5,
        danceability: features[0],
        energy: features[1],
        acousticness: features[2],
        valence: features[3],
        tempo: features[4],
        ...extras
    };
    return song;
}

// Insert songs into a B-Tree and build the same graph used by the application.
function makeGenerator(songs, k = NEIGHBOR_COUNT) {
    const catalog = new BTree();
    for (const song of songs) {
        catalog.insert(song.track_id, song);
    }
    const graph = new SongGraph(k).buildFromSongs(catalog.inorderTraversal());
    return {
        catalog,
        graph,
        generator: new PlaylistGenerator(catalog, graph)
    };
}

// Produce repeatable feature vectors without depending on Math.random().
function makeSeededSongs(count) {
    let state = 92741;
    return Array.from({ length: count }, (_, index) => {
        const values = SONG_FEATURES.map(() => {
            state = (state * 16807) % 2147483647;
            return state / 2147483647;
        });
        return makeSong(
            `synthetic-${String(index).padStart(5, '0')}`,
            [values[0], values[1], values[2], values[3], values[4] * 220]
        );
    });
}

// Make a deterministic random source for repeatable Fisher-Yates tests.
function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

// Independently collect the same bounded breadth of candidates for ranking assertions.
function collectExpectedCandidatePool(graph, seedId, depth, requestedCount) {
    const candidates = new Set();
    let frontier = [seedId];
    const expanded = new Set([seedId]);
    for (let currentDepth = 1; currentDepth <= depth && frontier.length > 0; currentDepth++) {
        const nextFrontier = [];
        for (const currentId of frontier) {
            for (const edge of graph.getNeighbors(currentId)) {
                if (edge.to !== seedId && graph.hasNode(edge.to)) {
                    candidates.add(edge.to);
                }
                if (
                    currentDepth < depth &&
                    !expanded.has(edge.to) &&
                    graph.hasNode(edge.to)
                ) {
                    expanded.add(edge.to);
                    nextFrontier.push(edge.to);
                }
            }
            if (candidates.size >= requestedCount) {
                break;
            }
        }
        if (candidates.size >= requestedCount) {
            break;
        }
        frontier = nextFrontier;
    }
    return candidates;
}

const syntheticSongs = makeSeededSongs(5000);
const synthetic = makeGenerator(syntheticSongs);
const syntheticSeed = syntheticSongs[0];
const syntheticSeedId = syntheticSeed.track_id;

runTest('exports a 20-song limit and the five expected mood keys', () => {
    assertEqual(PLAYLIST_SIZE, 20, 'Playlist size should be the named constant 20');
    assertEqual(
        MOOD_NAMES,
        ['happy', 'energetic', 'chill', 'melancholic', 'acoustic'],
        'All five mood keys should be exported for later UI use'
    );
    assertEqual(NEIGHBOR_COUNT, 10, 'The graph neighbor count should remain unchanged');
    assert(Object.isFrozen(MOOD_PROFILES), 'Mood profile configuration should be immutable');
});

runTest('seed playlist puts the seed first exactly once and returns the documented shape', () => {
    const result = synthetic.generator.generateFromSeed(syntheticSeedId, {
        random: seededRandom(12)
    });
    assertEqual(result.type, 'seed', 'Result type should identify seed generation');
    assert(result.seed === syntheticSeed, 'The result should explicitly identify the catalog seed');
    assert(result.songs[0] === syntheticSeed, 'The seed must remain at index zero');
    assertEqual(result.requested, 20, 'Result should report the requested playlist size');
    assertEqual(result.songs.filter((song) => song.track_id === syntheticSeedId).length, 1, 'The seed must occur once');
});

runTest('default depth expansion fills 19 candidates beyond the seed direct neighbors', () => {
    assertEqual(NEIGHBOR_COUNT, 10, 'Default graph k must be less than the 19 requested similar tracks');
    const directIds = new Set(synthetic.graph.getNeighbors(syntheticSeedId).map((edge) => edge.to));
    const candidatePool = collectExpectedCandidatePool(
        synthetic.graph,
        syntheticSeedId,
        2,
        PLAYLIST_SIZE - 1
    );
    const result = synthetic.generator.generateFromSeed(syntheticSeedId, {
        random: seededRandom(21)
    });
    const similarIds = result.songs.slice(1).map((song) => song.track_id);

    assertEqual(result.songs.length, 20, 'A large catalog should yield the seed plus 19 songs');
    assert(candidatePool.size > directIds.size, 'The expanded candidate pool should exceed direct neighbors');
    assert(
        similarIds.some((trackId) => !directIds.has(trackId)),
        'At least one selected track should be beyond the ten direct neighbors'
    );

    const poolRanking = [...candidatePool]
        .map((trackId) => ({
            trackId,
            similarity: computeSimilarity(
                syntheticSeed,
                synthetic.graph.getSong(trackId),
                synthetic.graph.featureStats
            )
        }))
        .sort((first, second) => {
            if (first.similarity !== second.similarity) {
                return second.similarity - first.similarity;
            }
            return first.trackId.localeCompare(second.trackId);
        })
        .slice(0, PLAYLIST_SIZE - 1)
        .map((item) => item.trackId);
    assertEqual(
        [...similarIds].sort(),
        [...poolRanking].sort(),
        'Generator must select the best 19 seed similarities within the independently collected pool'
    );
    assertEqual(new Set(similarIds).size, similarIds.length, 'Expanded recommendations must be unique');
    assert(similarIds.every((trackId) => hasValidFeatures(synthetic.graph.getSong(trackId))), 'All selected songs must have valid features');

    const globalTopIds = syntheticSongs
        .filter((song) => song.track_id !== syntheticSeedId)
        .map((song) => ({
            trackId: song.track_id,
            similarity: computeSimilarity(syntheticSeed, song, synthetic.graph.featureStats)
        }))
        .sort((first, second) => {
            if (first.similarity !== second.similarity) {
                return second.similarity - first.similarity;
            }
            return first.trackId.localeCompare(second.trackId);
        })
        .slice(0, PLAYLIST_SIZE - 1)
        .map((item) => item.trackId);
    const globalMatches = similarIds.filter((trackId) => globalTopIds.includes(trackId)).length;
    console.log(`Seed expansion approximation: ${globalMatches}/19 recommendations match the global brute-force top-19.`);
});

runTest('seed shuffle is repeatable and only changes order with a different seed', () => {
    const first = synthetic.generator.generateFromSeed(syntheticSeedId, {
        random: seededRandom(88)
    });
    const repeat = synthetic.generator.generateFromSeed(syntheticSeedId, {
        random: seededRandom(88)
    });
    const changed = synthetic.generator.generateFromSeed(syntheticSeedId, {
        random: seededRandom(92)
    });
    assertEqual(
        first.songs.map((song) => song.track_id),
        repeat.songs.map((song) => song.track_id),
        'Same injected random sequence should reproduce the playlist order'
    );
    assertEqual(
        [...first.songs.slice(1).map((song) => song.track_id)].sort(),
        [...changed.songs.slice(1).map((song) => song.track_id)].sort(),
        'Changing the random seed must preserve the selected set'
    );
    assert(
        first.songs.slice(1).some((song, index) => song.track_id !== changed.songs[index + 1].track_id),
        'Different random seeds should change similar-song order'
    );
    assert(first.songs[0] === changed.seed, 'The seed must stay first after shuffling');
});

runTest('seed playlist returns only available songs when the catalog has fewer than 20', () => {
    const small = makeGenerator(Array.from({ length: 5 }, (_, index) => {
        return makeSong(`small-${index}`, [index, index, index, index, index]);
    }));
    const result = small.generator.generateFromSeed('small-0', { random: seededRandom(1) });
    assertEqual(result.songs.length, 5, 'A five-song catalog should return five songs, not pad');
    assert(
        result.message && result.message.includes('Only 4 similar songs'),
        'A short seed playlist should explain the available similar-song count'
    );
});

runTest('seed playlist returns clear empty results for every invalid seed form', () => {
    const invalidSongs = [
        makeSong('invalid-seed', [0, 0, 0, 0, 0], { energy: NaN })
    ];
    const sample = makeGenerator([makeSong('only-valid'), ...invalidSongs]);
    const invalidInputs = ['unknown-id', '', null, undefined, 123, 'invalid-seed'];
    for (const input of invalidInputs) {
        const result = sample.generator.generateFromSeed(input);
        assertEqual(result.songs, [], `Invalid seed ${String(input)} should return no songs`);
        assert(result.message, `Invalid seed ${String(input)} should explain the failure`);
    }
});

runTest('empty catalog returns empty results for seed and mood generation', () => {
    const empty = makeGenerator([]);
    const seedResult = empty.generator.generateFromSeed('missing');
    const moodResult = empty.generator.generateFromMood('happy');
    assertEqual(seedResult.songs, [], 'Empty graph should not produce a seed playlist');
    assertEqual(moodResult.songs, [], 'Empty graph should not produce a mood playlist');
    assert(seedResult.message && moodResult.message, 'Empty results should explain their reason');
});

const moodFixtureSongs = [
    makeSong('anchor-low', [0, 0, 0, 0, 0]),
    makeSong('anchor-high', [1, 1, 1, 1, 1]),
    makeSong('happy-only', [0.8, 0.5, 0.1, 0.8, 0.5]),
    makeSong('energetic-only', [0.5, 0.9, 0.1, 0.5, 0.8]),
    makeSong('chill-and-acoustic', [0.3, 0.2, 0.9, 0.5, 0.5]),
    makeSong('another-chill-and-acoustic', [0.2, 0.25, 0.95, 0.4, 0.45]),
    makeSong('melancholic-only', [0.4, 0.2, 0.1, 0.1, 0.4]),
    makeSong('acoustic-only', [0.3, 0.7, 0.9, 0.5, 0.4]),
    makeSong('happy-and-energetic', [0.9, 0.9, 0.1, 0.9, 0.9]),
    makeSong('no-mood', [0.5, 0.5, 0.5, 0.5, 0.5])
];
const moodFixture = makeGenerator(moodFixtureSongs);

runTest('mood matching uses all intended features and allows overlapping moods', () => {
    const expected = {
        'happy-only': { happy: true, energetic: false, chill: false, melancholic: false, acoustic: false },
        'energetic-only': { happy: false, energetic: true, chill: false, melancholic: false, acoustic: false },
        'chill-and-acoustic': { happy: false, energetic: false, chill: true, melancholic: false, acoustic: true },
        'another-chill-and-acoustic': { happy: false, energetic: false, chill: true, melancholic: false, acoustic: true },
        'melancholic-only': { happy: false, energetic: false, chill: false, melancholic: true, acoustic: false },
        'acoustic-only': { happy: false, energetic: false, chill: false, melancholic: false, acoustic: true },
        'happy-and-energetic': { happy: true, energetic: true, chill: false, melancholic: false, acoustic: false },
        'no-mood': { happy: false, energetic: false, chill: false, melancholic: false, acoustic: false }
    };
    for (const [trackId, moods] of Object.entries(expected)) {
        const song = moodFixture.catalog.search(trackId);
        for (const moodName of MOOD_NAMES) {
            assertEqual(
                moodFixture.generator.matchesMood(song, moodName),
                moods[moodName],
                `${trackId} should have the expected ${moodName} match`
            );
        }
    }
});

runTest('mood rules include their exact high and low boundary values', () => {
    const thresholds = {
        valence: MOOD_PROFILES.happy.rules[0].threshold,
        danceability: MOOD_PROFILES.happy.rules[1].threshold,
        energyHigh: MOOD_PROFILES.energetic.rules[0].threshold,
        tempoHigh: MOOD_PROFILES.energetic.rules[1].threshold,
        energyLow: MOOD_PROFILES.chill.rules[0].threshold,
        acousticHigh: MOOD_PROFILES.chill.rules[1].threshold,
        valenceLow: MOOD_PROFILES.melancholic.rules[0].threshold,
        melancholicEnergyLow: MOOD_PROFILES.melancholic.rules[1].threshold
    };
    const exactBoundarySongs = [
        makeSong('boundary-happy', [thresholds.danceability, 0.5, 0.1, thresholds.valence, 0.5]),
        makeSong('boundary-energetic', [0.5, thresholds.energyHigh, 0.1, 0.5, thresholds.tempoHigh]),
        makeSong('boundary-chill', [0.5, thresholds.energyLow, thresholds.acousticHigh, 0.5, 0.5]),
        makeSong('boundary-melancholic', [0.5, thresholds.melancholicEnergyLow, 0.1, thresholds.valenceLow, 0.5]),
        makeSong('boundary-acoustic', [0.5, 0.5, thresholds.acousticHigh, 0.5, 0.5]),
        makeSong('range-low', [0, 0, 0, 0, 0]),
        makeSong('range-high', [1, 1, 1, 1, 1])
    ];
    const boundary = makeGenerator(exactBoundarySongs);
    assert(boundary.generator.matchesMood(boundary.catalog.search('boundary-happy'), 'happy'), '>= high rules should include exact threshold');
    assert(boundary.generator.matchesMood(boundary.catalog.search('boundary-energetic'), 'energetic'), 'Both energetic >= rules should include exact thresholds');
    assert(boundary.generator.matchesMood(boundary.catalog.search('boundary-chill'), 'chill'), '<= energy and >= acousticness should include exact thresholds');
    assert(boundary.generator.matchesMood(boundary.catalog.search('boundary-melancholic'), 'melancholic'), '<= melancholic rules should include exact thresholds');
    assert(boundary.generator.matchesMood(boundary.catalog.search('boundary-acoustic'), 'acoustic'), 'Acoustic >= rule should include its exact threshold');
});

runTest('mood playlists do not pad short results and explain the match count', () => {
    const result = moodFixture.generator.generateFromMood('acoustic', {
        random: seededRandom(8)
    });
    assertEqual(result.songs.length, 4, 'Only songs with normalized acousticness >= P75 should match in the fixture');
    assert(result.message && result.message.includes('Only 4 songs matched'), 'Short mood playlist should explain its count');
    assert(result.songs.every((song) => moodFixture.generator.matchesMood(song, 'acoustic')), 'Every result should pass the acoustic rules');
});

runTest('mood results are unique and shuffle only changes order when matches are at most 20', () => {
    const first = moodFixture.generator.generateFromMood('CHILL', { random: () => 0 });
    const second = moodFixture.generator.generateFromMood('chill', { random: () => 0.999999 });
    const firstIds = first.songs.map((song) => song.track_id);
    const secondIds = second.songs.map((song) => song.track_id);
    assertEqual(new Set(firstIds).size, firstIds.length, 'Mood result must not contain duplicate IDs');
    assertEqual([...firstIds].sort(), [...secondIds].sort(), 'Shuffle seed must not change the selected set');
    assert(
        firstIds.some((trackId, index) => trackId !== secondIds[index]),
        'Different random seeds should change the order for a multi-song match set'
    );
    for (const song of first.songs) {
        assert(moodFixture.generator.matchesMood(song, 'chill'), 'Every selected song must match all chill rules');
    }
});

runTest('mood selection uses score then track ID before the final shuffle', () => {
    const result = synthetic.generator.generateFromMood('happy', { random: seededRandom(111) });
    assert(result.songs.length <= PLAYLIST_SIZE, 'Mood playlist must not exceed 20 songs');
    assertEqual(new Set(result.songs.map((song) => song.track_id)).size, result.songs.length, 'Mood results must be unique');
    assert(result.songs.every((song) => synthetic.generator.matchesMood(song, 'happy')), 'All returned songs must satisfy all mood rules');
    const allMatches = synthetic.generator.getMatchingSongs('happy');
    const bestSongs = allMatches
        .map((song) => ({ song, score: synthetic.generator.scoreMoodMatch(song, 'happy') }))
        .sort((first, second) => {
            if (first.score !== second.score) {
                return second.score - first.score;
            }
            return first.song.track_id.localeCompare(second.song.track_id);
        })
        .slice(0, PLAYLIST_SIZE)
        .map((item) => item.song.track_id);
    assertEqual(
        [...result.songs.map((song) => song.track_id)].sort(),
        [...bestSongs].sort(),
        'Selected mood set should be the best-scoring matches before shuffle'
    );
});

runTest('invalid feature values are excluded from every mood result', () => {
    const invalidValues = [NaN, null, undefined, '', 'not-a-number'];
    const songs = [
        makeSong('range-low', [0, 0, 0, 0, 0]),
        makeSong('valid-acoustic', [1, 1, 1, 1, 1])
    ];
    invalidValues.forEach((value, index) => {
        songs.push(makeSong(`invalid-${index}`, [0.5, 0.5, 1, 0.5, 0.5], {
            acousticness: value
        }));
    });
    const invalidFixture = makeGenerator(songs);
    const result = invalidFixture.generator.generateFromMood('acoustic', {
        random: seededRandom(3)
    });
    assertEqual(result.songs.map((song) => song.track_id), ['valid-acoustic'], 'Only the valid acoustic song should be selected');
    for (const song of songs.filter((item) => !hasValidFeatures(item))) {
        assert(!invalidFixture.generator.matchesMood(song, 'acoustic'), 'Invalid song must not match a mood');
    }
});

runTest('unknown and empty moods return valid choices and accept display-name casing', () => {
    for (const moodName of ['', 'unlisted-mood']) {
        const result = moodFixture.generator.generateFromMood(moodName);
        assertEqual(result.songs, [], 'Unknown or empty mood should not produce songs');
        assert(result.message.includes(MOOD_NAMES.join(', ')), 'Error message should list every valid mood key');
    }
    assertEqual(
        moodFixture.generator.getMatchingSongs('Happy / Upbeat').map((song) => song.track_id).sort(),
        moodFixture.generator.getMatchingSongs('HAPPY').map((song) => song.track_id).sort(),
        'Mood keys and display names should be matched case-insensitively'
    );
});

runTest('5,000-song synthetic mood playlists remain bounded and correctly filtered', () => {
    for (const moodName of MOOD_NAMES) {
        const result = synthetic.generator.generateFromMood(moodName, {
            random: seededRandom(moodName.length)
        });
        assert(result.songs.length <= 20, `${moodName} playlist should be bounded at 20`);
        assert(result.songs.every((song) => synthetic.generator.matchesMood(song, moodName)), `${moodName} results should match every configured rule`);
    }
});

const csvPath = path.join(__dirname, '..', 'data', 'songs_deduped.csv');
const csvText = fs.readFileSync(csvPath, 'utf8');
const csvCatalog = new BTree();
const csvLoadStats = loadSongsFromCSV(csvText, csvCatalog);
const csvSongs = csvCatalog.inorderTraversal();
const csvGraph = new SongGraph().buildFromSongs(csvSongs);
const csvGenerator = new PlaylistGenerator(csvCatalog, csvGraph);

runTest('real CSV seed playlist returns 19 unique songs from the CSV catalog', () => {
    const seed = csvSongs[0];
    const result = csvGenerator.generateFromSeed(seed.track_id, {
        random: seededRandom(612)
    });
    const csvIds = new Set(csvSongs.map((song) => song.track_id));
    assertEqual(result.songs.length, 20, 'Real CSV graph should supply a full seed playlist');
    assert(result.songs.every((song) => csvIds.has(song.track_id)), 'Every selected song must be a real CSV catalog record');
    assertEqual(new Set(result.songs.map((song) => song.track_id)).size, 20, 'Real CSV seed playlist must be unique');
    assert(result.songs[0] === seed, 'CSV seed must remain first');
});

runTest('real CSV mood counts are printed and playlists stay within 20', () => {
    assertEqual(csvLoadStats.songsInserted, 4428, 'Real CSV fixture should load every unique song in songs_deduped.csv');
    for (const moodName of MOOD_NAMES) {
        const matchingSongs = csvGenerator.getMatchingSongs(moodName);
        const result = csvGenerator.generateFromMood(moodName, {
            random: seededRandom(moodName.length + 100)
        });
        const shortWarning = matchingSongs.length < PLAYLIST_SIZE
            ? ' — FEWER THAN 20 MATCHES'
            : '';
        console.log(`Real CSV mood count — ${moodName}: ${matchingSongs.length}${shortWarning}`);
        assert(result.songs.length <= 20, `${moodName} playlist should not exceed 20`);
        assertEqual(result.songs.length, Math.min(20, matchingSongs.length), `${moodName} should return all matches up to 20`);
        assert(result.songs.every((song) => csvGenerator.matchesMood(song, moodName)), `${moodName} CSV results must match profile rules`);
    }
});

runTest('generator never creates demo records or substitutes for CSV records', () => {
    const csvIds = new Set(csvSongs.map((song) => song.track_id));
    const removedDemoPairs = [
        ['Bohemian Rhapsody', 'Queen'],
        ['Hotel California', 'Eagles'],
        ['Stairway to Heaven', 'Led Zeppelin'],
        ['Imagine', 'John Lennon'],
        ['Billie Jean', 'Michael Jackson'],
        ['Like a Rolling Stone', 'Bob Dylan'],
        ['Smells Like Teen Spirit', 'Nirvana']
    ];
    const result = csvGenerator.generateFromSeed(csvSongs[0].track_id, {
        random: seededRandom(712)
    });
    for (const song of result.songs) {
        assert(csvIds.has(song.track_id), 'Every generated song must be an existing CSV catalog object');
        assert(!song.track_id.startsWith('sample-'), 'Generator must not create old dynamic demo IDs');
        const matchingDemoPair = removedDemoPairs.some(([title, artist]) => {
            return song.title === title && song.artist === artist;
        });
        if (matchingDemoPair) {
            assert(
                csvSongs.some((csvSong) => {
                    return csvSong.track_id === song.track_id &&
                        csvSong.title === song.title &&
                        csvSong.artist === song.artist;
                }),
                'A matching title and artist may only appear when that exact record is in the CSV'
            );
        }
    }
});

runTest('generator leaves catalog, graph, and input song objects unchanged', () => {
    const inputSongs = [...syntheticSongs];
    const songSnapshot = JSON.stringify(inputSongs);
    const catalogSnapshot = JSON.stringify(synthetic.catalog.inorderTraversal());
    const adjacencySnapshot = JSON.stringify([...synthetic.graph.adjacencyList.entries()]);
    const featureSnapshot = JSON.stringify([...synthetic.graph.normalizedFeatures.entries()]);
    const statsSnapshot = JSON.stringify(synthetic.graph.featureStats);

    synthetic.generator.generateFromSeed(syntheticSeedId, {
        random: seededRandom(17)
    });
    synthetic.generator.generateFromMood('energetic', {
        random: seededRandom(31)
    });
    shuffleSongs(inputSongs, seededRandom(59));

    assertEqual(JSON.stringify(inputSongs), songSnapshot, 'Input array and song objects must not change');
    assertEqual(JSON.stringify(synthetic.catalog.inorderTraversal()), catalogSnapshot, 'Catalog must not change');
    assertEqual(JSON.stringify([...synthetic.graph.adjacencyList.entries()]), adjacencySnapshot, 'Graph edges must not change');
    assertEqual(JSON.stringify([...synthetic.graph.normalizedFeatures.entries()]), featureSnapshot, 'Normalized vectors must not change');
    assertEqual(JSON.stringify(synthetic.graph.featureStats), statsSnapshot, 'Graph statistics must not change');
});

runTest('Fisher-Yates shuffle copies input and validates its injected random source', () => {
    const songs = ['a', 'b', 'c', 'd'];
    const snapshot = [...songs];
    const shuffled = shuffleSongs(songs, seededRandom(101));
    assertEqual(songs, snapshot, 'Shuffle must leave the input array unchanged');
    assertEqual([...shuffled].sort(), [...songs].sort(), 'Shuffle must preserve every input item');
    assert(
        (() => {
            try {
                shuffleSongs(songs, () => 1);
                return false;
            } catch (error) {
                return error instanceof RangeError;
            }
        })(),
        'Out-of-range injected random values should fail clearly'
    );
});

console.log(`\nTest summary: ${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exitCode = 1;
}
