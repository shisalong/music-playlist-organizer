const { YouTubeExporter, estimateQuota } = require('../../src/integrations/youtube/youtubeExporter.js');
const { YouTubeMatchCache } = require('../../src/integrations/youtube/youtubeCache.js');
const { YouTubeApiClient } = require('../../src/integrations/youtube/youtubeApi.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
    assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
}

async function runTest(name, test) {
    try {
        await test();
        passed++;
        console.log(`PASS: ${name}`);
    } catch (error) {
        failed++;
        console.error(`FAIL: ${name} — ${error.message}`);
    }
}

function song(id, title = `Song ${id}`, artist = `Artist ${id}`) {
    return { track_id: id, title, artist };
}

function responseFor(item) {
    return {
        items: [{
            id: { videoId: `video-${item.track_id}` },
            snippet: { title: `${item.title} Official Audio`, channelTitle: `${item.artist} - Topic` }
        }]
    };
}

function memoryStorage() {
    const values = new Map();
    return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); }
    };
}

function createApi(overrides = {}) {
    const calls = { searches: [], adds: [], creates: [] };
    return {
        calls,
        auth: { async getAccessToken() { return 'token'; } },
        async searchVideos(query) {
            calls.searches.push(query);
            const id = query.match(/Song ([^ ]+)/)?.[1] || 'unknown';
            return responseFor(song(id));
        },
        async createPlaylist(name, privacyStatus) {
            calls.creates.push({ name, privacyStatus });
            return { id: 'playlist-1' };
        },
        async addPlaylistItem(playlistId, videoId, position) {
            calls.adds.push({ playlistId, videoId, position });
            return { id: `item-${position}` };
        },
        ...overrides
    };
}

(async () => {
    await runTest('exports matched videos in the original song order', async () => {
        const api = createApi();
        const exporter = new YouTubeExporter({ api });
        const result = await exporter.exportPlaylist({ name: 'Ordered', songs: [song('a'), song('b'), song('c')] });
        assert(result.status === 'done', 'Happy path should finish');
        assertEqual(api.calls.adds.map((call) => call.videoId), ['video-a', 'video-b', 'video-c'], 'Insertion order should match song order');
        assertEqual(api.calls.adds.map((call) => call.position), [0, 1, 2], 'Explicit positions should remain sequential');
    });

    await runTest('reports unmatched songs while exporting confident matches', async () => {
        const api = createApi();
        const originalSearch = api.searchVideos;
        api.searchVideos = async (query) => query.includes('Song bad') ? { items: [] } : originalSearch(query);
        const result = await new YouTubeExporter({ api }).exportPlaylist({ name: 'Partial', songs: [song('a'), song('bad')] });
        assert(result.status === 'partial', 'Unmatched songs should make the export partial');
        assert(result.matched.length === 1 && result.unmatched.length === 1, 'Both outcomes should be reported');
    });

    await runTest('does not create an empty playlist when nothing matches', async () => {
        const api = createApi({ async searchVideos() { return { items: [] }; } });
        const result = await new YouTubeExporter({ api }).exportPlaylist({ name: 'Empty', songs: [song('a')] });
        assert(result.playlistId === null, 'No YouTube playlist should be created');
        assert(api.calls.creates.length === 0, 'Create endpoint should not be called');
    });

    await runTest('deduplicates identical video IDs within one export', async () => {
        const api = createApi({
            async searchVideos(query) {
                const id = query.match(/Song ([^ ]+)/)?.[1];
                return { items: [{ id: { videoId: 'same-video' }, snippet: { title: `Song ${id}`, channelTitle: `Artist ${id}` } }] };
            }
        });
        const result = await new YouTubeExporter({ api }).exportPlaylist({ name: 'No Duplicates', songs: [song('a'), song('b')] });
        assert(api.calls.adds.length === 1, 'Duplicate video should be inserted only once');
        assert(result.unmatched.some((entry) => entry.reason.includes('already')), 'Duplicate reason should be reported');
    });

    await runTest('reports individual playlist insertion failures as partial', async () => {
        const api = createApi();
        api.addPlaylistItem = async (playlistId, videoId, position) => {
            if (position === 1) throw new Error('Video unavailable');
            api.calls.adds.push({ playlistId, videoId, position });
        };
        const result = await new YouTubeExporter({ api }).exportPlaylist({ name: 'Partial Add', songs: [song('a'), song('b')] });
        assert(result.status === 'partial', 'Failed insertion should make result partial');
        assert(result.matched.length === 1 && result.failed.length === 1, 'Success and failure should be retained');
        assert(result.playlistUrl.includes('playlist-1'), 'Created playlist link should remain available');
    });

    await runTest('quota exhaustion during matching stops further calls cleanly', async () => {
        const api = createApi();
        api.searchVideos = async () => {
            const error = new Error('Daily YouTube API quota reached.');
            error.code = 'quotaExceeded';
            throw error;
        };
        const result = await new YouTubeExporter({ api }).exportPlaylist({ name: 'Quota', songs: [song('a'), song('b')] });
        assert(result.status === 'error', 'Quota result should be an error without a created playlist');
        assert(result.unmatched.length === 2, 'Unsearched songs should be reported');
        assert(api.calls.creates.length === 0, 'Playlist should not be created');
    });

    await runTest('a cache hit skips YouTube search', async () => {
        const cache = new YouTubeMatchCache(memoryStorage());
        cache.set(song('a'), { videoId: 'cached-video', title: 'Cached', channelTitle: 'Channel' });
        const api = createApi();
        const result = await new YouTubeExporter({ api, cache }).exportPlaylist({ name: 'Cached', songs: [song('a')] });
        assert(api.calls.searches.length === 0, 'Cached song should not be searched');
        assert(result.matched[0].videoId === 'cached-video', 'Cached video should be inserted');
    });

    await runTest('quota estimate separates uncached searches from general units', async () => {
        const cache = new YouTubeMatchCache(memoryStorage());
        cache.set(song('a'), { videoId: 'cached-a' });
        assertEqual(
            estimateQuota([song('a'), song('b'), song('b')], cache),
            { searchRequests: 1, generalUnitsMaximum: 200 },
            'Repeated and cached songs should not inflate search count'
        );
    });

    await runTest('API client refreshes once after a 401 and then succeeds', async () => {
        let requests = 0;
        let refreshes = 0;
        const auth = {
            async getAccessToken() { return refreshes ? 'new' : 'old'; },
            async refreshAccessToken() { refreshes++; return 'new'; }
        };
        const api = new YouTubeApiClient({
            auth,
            fetch: async () => {
                requests++;
                return requests === 1
                    ? { ok: false, status: 401, async json() { return { error: { errors: [{ reason: 'authError' }] } }; } }
                    : { ok: true, status: 200, async json() { return { items: [] }; } };
            }
        });
        await api.searchVideos('query');
        assert(requests === 2 && refreshes === 1, 'One refresh and one retry should occur');
    });

    await runTest('API client stops after a persistent 401', async () => {
        let requests = 0;
        const auth = {
            async getAccessToken() { return 'token'; },
            async refreshAccessToken() { return 'new-token'; }
        };
        const api = new YouTubeApiClient({
            auth,
            fetch: async () => {
                requests++;
                return { ok: false, status: 401, async json() { return { error: { errors: [{ reason: 'authError' }] } }; } };
            }
        });
        try {
            await api.searchVideos('query');
            throw new Error('Expected persistent authorization failure');
        } catch (error) {
            assert(requests === 2, 'Persistent 401 should be tried only twice');
            assert(error.status === 401, 'Final status should be preserved');
        }
    });

    await runTest('API client retries a failed GET on the alternate Google hostname', async () => {
        const urls = [];
        const api = new YouTubeApiClient({
            auth: { async getAccessToken() { return 'token'; } },
            fetch: async (url) => {
                urls.push(url);
                if (urls.length === 1) throw new TypeError('Failed to fetch');
                return { ok: true, status: 200, async json() { return { items: [] }; } };
            }
        });
        await api.searchVideos('query');
        assert(urls.length === 2, 'A failed search GET should retry once');
        assert(urls[0].startsWith('https://www.googleapis.com/'), 'The documented endpoint should be tried first');
        assert(urls[1].startsWith('https://youtube.googleapis.com/'), 'The alternate Google endpoint should be tried second');
    });

    await runTest('API client does not retry a failed POST that could duplicate data', async () => {
        let requests = 0;
        const api = new YouTubeApiClient({
            auth: { async getAccessToken() { return 'token'; } },
            fetch: async () => {
                requests++;
                throw new TypeError('Failed to fetch');
            }
        });
        try {
            await api.createPlaylist('Name', 'private');
            throw new Error('Expected network failure');
        } catch (error) {
            assert(error.code === 'network_error', 'Network failure should retain its code');
            assert(error.message.includes('ad/tracker blocking'), 'Network failure should be actionable');
            assert(requests === 1, 'A failed create request must not be retried');
        }
    });

    console.log(`\nTest summary: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
})();
