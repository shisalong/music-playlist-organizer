const fs = require('fs');
const path = require('path');
const {
    BTree,
    SONG_LIMIT,
    SONG_FEATURES,
    NEIGHBOR_COUNT,
    hasValidFeatures,
    computeDistance,
    computeSimilarity,
    SongGraph,
    loadSongsFromCSV
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

function makeSong(trackId, value = 0) {
    return {
        id: trackId,
        track_id: trackId,
        title: trackId,
        danceability: value,
        energy: value,
        acousticness: value,
        valence: value,
        tempo: value
    };
}

function makeGraph(songs, k = NEIGHBOR_COUNT) {
    return new SongGraph(k).buildFromSongs(songs);
}

function makeSeededSongs(count) {
    let seed = 593;
    return Array.from({ length: count }, (_, index) => {
        const values = SONG_FEATURES.map(() => {
            seed = (seed * 16807) % 2147483647;
            return seed / 2147483647;
        });
        return {
            ...makeSong(`generated-${String(index).padStart(5, '0')}`),
            danceability: values[0],
            energy: values[1],
            acousticness: values[2],
            valence: values[3],
            tempo: values[4] * 250
        };
    });
}

runTest('validates five finite numeric features and accepts zero values', () => {
    assert(hasValidFeatures(makeSong('zero', 0)), 'A valid all-zero feature vector must be accepted');
    assert(!hasValidFeatures(null), 'Null is not a valid song');
    assert(
        !hasValidFeatures({ ...makeSong('missing'), valence: undefined }),
        'A missing feature must be rejected'
    );
    assert(
        !hasValidFeatures({ ...makeSong('string'), tempo: '120' }),
        'A numeric string must be rejected'
    );
    assert(
        !hasValidFeatures({ ...makeSong('nan'), energy: NaN }),
        'NaN must be rejected'
    );
    assert(
        !hasValidFeatures({ ...makeSong('infinite'), energy: Infinity }),
        'Infinity must be rejected'
    );
});

runTest('normalizes per feature and maps constant dimensions to zero', () => {
    const songs = [
        { ...makeSong('a'), danceability: 0, energy: 5 },
        { ...makeSong('b'), danceability: 10, energy: 5 }
    ];
    const graph = makeGraph(songs);
    assertEqual(
        graph.normalizedFeatures.get('a'),
        [0, 0, 0, 0, 0],
        'The lower endpoint and constant dimensions should normalize to zero'
    );
    assertEqual(
        graph.normalizedFeatures.get('b'),
        [1, 0, 0, 0, 0],
        'The upper endpoint should normalize to one'
    );
});

runTest('computes five-dimensional Euclidean distance and bounded similarity', () => {
    assertEqual(computeDistance([0, 0, 0, 0, 0], [1, 1, 1, 1, 1]), Math.sqrt(5), 'Distance should use all five features');
    assertEqual(computeDistance([0, 0, 0, 0, 0], [0, 0, 0, 0, 0]), 0, 'Identical vectors have zero distance');

    const songs = [makeSong('a', 0), makeSong('b', 5), makeSong('c', 10)];
    const graph = makeGraph(songs);
    const similarity = computeSimilarity(songs[0], songs[1], graph.featureStats);
    assert(Math.abs(similarity - 0.5) < 1e-12, 'Normalized midpoint similarity should be 0.5');
    assert(graph.similarityBetween('a', 'a') === 1, 'A song should be maximally similar to itself');
    assert(graph.similarityBetween('a', 'c') === 0, 'Opposite normalized endpoints should score zero');
});

runTest('throws a clear error for invalid direct similarity inputs', () => {
    const invalidSong = { ...makeSong('invalid'), energy: 'bad' };
    assert(
        (() => {
            try {
                computeSimilarity(invalidSong, makeSong('valid'), {});
                return false;
            } catch (error) {
                return error instanceof Error && error.message.includes('energy');
            }
        })(),
        'Direct similarity must reject invalid song features with a useful message'
    );
    assert(
        (() => {
            try {
                computeDistance([0, 0], [0, 0]);
                return false;
            } catch (error) {
                return error instanceof Error && error.message.includes('five-feature');
            }
        })(),
        'Distance must reject vectors with the wrong shape'
    );
});

runTest('skips invalid songs with reasons and does not create invalid nodes', () => {
    const graph = makeGraph([
        makeSong('valid', 0),
        { ...makeSong('missing'), tempo: undefined },
        { ...makeSong('bad'), acousticness: '0.2' },
        { title: 'missing id', ...makeSong('', 1) }
    ]);
    assertEqual(graph.nodeCount(), 1, 'Only the valid song should become a node');
    assertEqual(graph.skippedSongs.length, 3, 'All invalid rows should be reported');
    assert(
        graph.skippedSongs.some((item) => item.track_id === 'missing' && item.reason === 'invalid tempo'),
        'Missing feature reason should identify the field'
    );
    assert(
        graph.skippedSongs.some((item) => item.track_id === 'bad' && item.reason === 'invalid acousticness'),
        'Invalid numeric reason should identify the field'
    );
    assert(
        graph.skippedSongs.some((item) => item.reason === 'missing track_id'),
        'Missing IDs should be reported'
    );
});

runTest('uses trimmed unique track IDs without duplicating nodes', () => {
    const original = makeSong('same', 0);
    const duplicate = makeSong(' same ', 1);
    const graph = makeGraph([original, duplicate]);
    assertEqual(graph.nodeCount(), 1, 'Trimmed duplicate IDs should create one node');
    assert(graph.getSong(' same ') === original, 'The first song for an ID should be retained');
    assertEqual(graph.getNeighbors('unknown'), [], 'Unknown neighbors should be empty');
    assert(graph.getSong('unknown') === null, 'Unknown songs should be null');
    assert(!graph.hasNode('unknown'), 'Unknown IDs should not be graph nodes');
});

runTest('builds deterministic top-k neighbors without self-edges', () => {
    const graph = makeGraph([
        makeSong('z'),
        makeSong('b'),
        makeSong('a'),
        makeSong('c')
    ], 2);
    assertEqual(
        graph.getNeighbors('z').map((edge) => edge.to),
        ['a', 'b'],
        'Tied neighbors should be selected in ascending track ID order'
    );
    for (const [trackId, edges] of graph.adjacencyList) {
        assert(edges.length <= 2, `${trackId} must not exceed k outgoing edges`);
        assert(!edges.some((edge) => edge.to === trackId), `${trackId} must not have a self-edge`);
        assert(
            edges.every((edge, index) => index === 0 || (
                edges[index - 1].weight > edge.weight ||
                (edges[index - 1].weight === edge.weight &&
                    edges[index - 1].to < edge.to)
            )),
            `${trackId} outgoing edges must be deterministically sorted`
        );
    }
});

runTest('uses directed top-k edges and returns copied neighbor data', () => {
    const graph = makeGraph([
        makeSong('a', 0),
        makeSong('b', 0.1),
        makeSong('c', 1)
    ], 1);
    assertEqual(graph.getNeighbors('c').map((edge) => edge.to), ['b'], 'C should choose its nearest neighbor B');
    assert(
        !graph.getNeighbors('b').some((edge) => edge.to === 'c'),
        'The graph should not force a reciprocal edge'
    );
    const exposedEdges = graph.getNeighbors('c');
    exposedEdges[0].to = 'changed';
    assertEqual(graph.getNeighbors('c').map((edge) => edge.to), ['b'], 'Returned edges must not mutate the graph');
});

runTest('supports node, edge, song, and neighbor accessors', () => {
    const graph = makeGraph([makeSong('a', 0), makeSong('b', 1)], 1);
    assert(graph.hasNode(' a '), 'Node lookups should trim track IDs');
    assertEqual(graph.nodeCount(), 2, 'Node count should include both valid songs');
    assertEqual(graph.edgeCount(), 2, 'Each node should have one outgoing edge');
    assert(graph.getSong('a').track_id === 'a', 'getSong should return the original song');
    assertEqual(graph.getNeighbors('a').length, 1, 'getNeighbors should return outgoing edges');
});

runTest('provides iterative BFS and DFS with limits, cycles, and directed edges', () => {
    const graph = makeGraph(
        ['a', 'b', 'c', 'd', 'e'].map((id) => makeSong(id)),
        0
    );
    graph.adjacencyList.set('a', [{ to: 'b', weight: 1 }, { to: 'c', weight: 0.9 }]);
    graph.adjacencyList.set('b', [{ to: 'a', weight: 1 }, { to: 'd', weight: 0.8 }]);
    graph.adjacencyList.set('c', [{ to: 'e', weight: 0.7 }]);
    graph.adjacencyList.set('d', []);
    graph.adjacencyList.set('e', []);

    assertEqual(graph.bfs('a'), ['a', 'b', 'c', 'd', 'e'], 'BFS order should follow outgoing edge order');
    assertEqual(graph.dfs('a'), ['a', 'b', 'd', 'c', 'e'], 'DFS should use an explicit stack in neighbor order');
    assertEqual(graph.bfs('a', { limit: 2 }), ['a', 'b'], 'BFS should honor its visit limit');
    assertEqual(graph.dfs('a', { limit: 0 }), [], 'A zero limit should visit nothing');
    assertEqual(graph.bfs('unknown'), [], 'Unknown BFS starts should return an empty list');
    assertEqual(graph.dfs('unknown'), [], 'Unknown DFS starts should return an empty list');
    assertEqual(graph.bfs('c'), ['c', 'e'], 'Traversal should follow direction, not incoming edges');
});

runTest('validates graph input, k, and traversal limits', () => {
    assert(
        (() => {
            try {
                new SongGraph(-1);
                return false;
            } catch (error) {
                return error instanceof RangeError;
            }
        })(),
        'Negative k should be rejected'
    );
    assert(
        (() => {
            try {
                new SongGraph().buildFromSongs({});
                return false;
            } catch (error) {
                return error instanceof TypeError;
            }
        })(),
        'Non-array input should be rejected'
    );
    const graph = makeGraph([makeSong('a')]);
    assert(
        (() => {
            try {
                graph.bfs('a', { limit: -1 });
                return false;
            } catch (error) {
                return error instanceof RangeError;
            }
        })(),
        'Negative traversal limits should be rejected'
    );
});

runTest('stores at most k edges per node on a deterministic 5,000-song set', () => {
    const graph = makeGraph(makeSeededSongs(SONG_LIMIT));
    assertEqual(graph.nodeCount(), SONG_LIMIT, 'Every generated valid song should become a node');
    assertEqual(graph.edgeCount(), SONG_LIMIT * NEIGHBOR_COUNT, 'Sparse graph should retain exactly n*k directed edges');
    for (const edges of graph.adjacencyList.values()) {
        assertEqual(edges.length, NEIGHBOR_COUNT, 'Each node should retain at most k neighbors');
    }
});

runTest('builds a sparse graph from the real CSV dataset', () => {
    const csvPath = path.join(__dirname, '..', 'data', 'songs_deduped.csv');
    const csvText = fs.readFileSync(csvPath, 'utf8');
    const tree = new BTree();
    const loadStats = loadSongsFromCSV(csvText, tree);
    const graph = makeGraph(tree.inorderTraversal());
    assertEqual(loadStats.songsInserted, 4428, 'Loader should insert every unique song in songs_deduped.csv');
    assertEqual(graph.nodeCount(), tree.size, 'Every valid CSV song should be represented');
    assertEqual(graph.edgeCount(), graph.nodeCount() * NEIGHBOR_COUNT, 'CSV graph should retain only k outgoing edges per node');
    assertEqual(graph.skippedSongs.length, 0, 'CSV loader output should have five numeric features per song');
    for (const [trackId, edges] of graph.adjacencyList) {
        assertEqual(edges.length, NEIGHBOR_COUNT, `${trackId} should have k outgoing edges`);
        assert(
            edges.every((edge) => edge.to !== trackId && graph.hasNode(edge.to)),
            `${trackId} edges should refer to other graph nodes`
        );
    }
});

console.log(`\nTest summary: ${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exitCode = 1;
}
