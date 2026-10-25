(function (global, factory) {
    const matcher = typeof module !== 'undefined' && module.exports
        ? require('./youtubeMatcher.js')
        : global.YouTubeMatcher;
    const exported = factory(matcher);
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = exported;
    }
    global.YouTubeExporter = exported.YouTubeExporter;
    global.estimateYouTubeQuota = exported.estimateQuota;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (matcher) {
    const PRIVACY_OPTIONS = ['private', 'unlisted', 'public'];

    // Estimate both current YouTube quota dimensions before network calls begin.
    function estimateQuota(songs, cache) {
        const validSongs = (Array.isArray(songs) ? songs : []).filter((song) => matcher.buildSearchQuery(song));
        const uniqueKeys = new Set();
        let searches = 0;
        validSongs.forEach((song) => {
            const key = matcher.normalizeText(matcher.buildSearchQuery(song));
            if (!uniqueKeys.has(key)) {
                uniqueKeys.add(key);
                if (!cache || !cache.get(song)) {
                    searches++;
                }
            }
        });
        return {
            searchRequests: searches,
            generalUnitsMaximum: validSongs.length * 50 + 50
        };
    }

    class YouTubeExporter {
        // Orchestrate matching and playlist writes without depending on application DSA state.
        constructor(options = {}) {
            this.api = options.api;
            this.cache = options.cache || null;
            this.matchThreshold = options.matchThreshold;
        }

        // Match one song, using only accepted cached video IDs when available.
        async matchSong(song, signal) {
            const query = matcher.buildSearchQuery(song);
            if (!query) {
                return { song, matched: false, reason: 'Song title or artist is missing.' };
            }
            const cached = this.cache && this.cache.get(song);
            if (cached) {
                return { song, matched: true, ...cached, source: 'cache' };
            }
            const response = await this.api.searchVideos(query, signal);
            const selected = matcher.selectBestCandidate(song, response.items, this.matchThreshold);
            if (!selected.candidate) {
                return { song, matched: false, reason: selected.reason };
            }
            const snippet = selected.candidate.snippet || {};
            const match = {
                song,
                matched: true,
                videoId: selected.candidate.id.videoId,
                title: snippet.title || '',
                channelTitle: snippet.channelTitle || '',
                score: selected.score,
                source: 'search'
            };
            if (this.cache) {
                this.cache.set(song, match);
            }
            return match;
        }

        // Export sequentially so playlist insertion order always matches GenMix order.
        async exportPlaylist(playlist, options = {}) {
            const songs = playlist && Array.isArray(playlist.songs) ? playlist.songs : [];
            const name = String(options.name || playlist && playlist.name || 'GenMix Playlist').trim();
            const privacyStatus = PRIVACY_OPTIONS.includes(options.privacyStatus)
                ? options.privacyStatus
                : 'private';
            const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
            const signal = options.signal;
            const matchesByKey = new Map();
            const seenVideoIds = new Set();
            const matched = [];
            const unmatched = [];

            await this.api.auth.getAccessToken();
            for (let index = 0; index < songs.length; index++) {
                if (signal && signal.aborted) {
                    throw new Error('YouTube export was cancelled.');
                }
                onProgress({ state: 'matching', current: index + 1, total: songs.length });
                const song = songs[index];
                const key = matcher.normalizeText(matcher.buildSearchQuery(song));
                let result;
                if (key && matchesByKey.has(key)) {
                    result = { ...matchesByKey.get(key), song, source: 'same-export' };
                } else {
                    try {
                        result = await this.matchSong(song, signal);
                    } catch (error) {
                        if (error.code === 'quotaExceeded' || error.code === 'rateLimitExceeded') {
                            unmatched.push({ song, reason: error.message });
                            songs.slice(index + 1).forEach((remainingSong) => {
                                unmatched.push({ song: remainingSong, reason: 'Not searched because YouTube quota was reached.' });
                            });
                            return {
                                status: 'error',
                                playlistId: null,
                                playlistUrl: null,
                                matched,
                                unmatched,
                                failed: [],
                                error: error.message
                            };
                        }
                        unmatched.push({ song, reason: error.message || 'YouTube search failed.' });
                        continue;
                    }
                    if (key) {
                        matchesByKey.set(key, result);
                    }
                }
                if (!result.matched) {
                    unmatched.push({ song, reason: result.reason });
                } else if (seenVideoIds.has(result.videoId)) {
                    unmatched.push({ song, reason: 'The matched YouTube video is already in this export.' });
                } else {
                    seenVideoIds.add(result.videoId);
                    matched.push(result);
                }
            }

            if (matched.length === 0) {
                return {
                    status: 'error',
                    playlistId: null,
                    playlistUrl: null,
                    matched,
                    unmatched,
                    failed: [],
                    error: 'No songs had a confident YouTube match, so no playlist was created.'
                };
            }

            onProgress({ state: 'creating_playlist', current: 0, total: matched.length });
            const created = await this.api.createPlaylist(name, privacyStatus, signal);
            const playlistId = created.id;
            const added = [];
            const failed = [];
            for (let index = 0; index < matched.length; index++) {
                const match = matched[index];
                onProgress({ state: 'adding_videos', current: index + 1, total: matched.length });
                try {
                    await this.api.addPlaylistItem(playlistId, match.videoId, index, signal);
                    added.push(match);
                } catch (error) {
                    failed.push({ song: match.song, videoId: match.videoId, reason: error.message || 'Video could not be added.' });
                    if (error.code === 'videoNotFound' && this.cache) {
                        this.cache.remove(match.song);
                    }
                    if (error.code === 'quotaExceeded' || error.code === 'rateLimitExceeded') {
                        matched.slice(index + 1).forEach((remaining) => {
                            failed.push({
                                song: remaining.song,
                                videoId: remaining.videoId,
                                reason: 'Not added because YouTube quota was reached.'
                            });
                        });
                        break;
                    }
                }
            }

            return {
                status: unmatched.length || failed.length ? 'partial' : 'done',
                playlistId,
                playlistUrl: `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`,
                matched: added,
                unmatched,
                failed,
                error: ''
            };
        }
    }

    return { PRIVACY_OPTIONS, estimateQuota, YouTubeExporter };
});
