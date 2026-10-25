(function (global, factory) {
    const matcher = typeof module !== 'undefined' && module.exports
        ? require('./youtubeMatcher.js')
        : global.YouTubeMatcher;
    const exported = factory(matcher);
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = exported;
    }
    global.YouTubeMatchCache = exported.YouTubeMatchCache;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (matcher) {
    const CACHE_KEY = 'genmixYouTubeMatchCache';
    const CACHE_VERSION = 1;

    // Build a stable key without storing access tokens or account information.
    function buildCacheKey(song) {
        return matcher.normalizeText(matcher.buildSearchQuery(song));
    }

    class YouTubeMatchCache {
        // Keep accepted song-to-video mappings in the supplied browser storage.
        constructor(storage, key = CACHE_KEY) {
            this.storage = storage;
            this.key = key;
        }

        // Read only the current schema and recover safely from malformed storage.
        read() {
            if (!this.storage || typeof this.storage.getItem !== 'function') {
                return { version: CACHE_VERSION, matches: {} };
            }
            try {
                const parsed = JSON.parse(this.storage.getItem(this.key) || 'null');
                if (parsed && parsed.version === CACHE_VERSION && parsed.matches) {
                    return parsed;
                }
            } catch (error) {
                // A broken cache should never block an export.
            }
            return { version: CACHE_VERSION, matches: {} };
        }

        // Return a copied accepted match or null when a search is still needed.
        get(song) {
            const key = buildCacheKey(song);
            const match = key && this.read().matches[key];
            return match && match.videoId ? { ...match } : null;
        }

        // Store only successful matches; unmatched searches are allowed to improve later.
        set(song, match) {
            const key = buildCacheKey(song);
            if (!key || !match || !match.videoId || !this.storage) {
                return false;
            }
            const cache = this.read();
            cache.matches[key] = {
                videoId: match.videoId,
                title: String(match.title || ''),
                channelTitle: String(match.channelTitle || ''),
                cachedAt: new Date().toISOString()
            };
            try {
                this.storage.setItem(this.key, JSON.stringify(cache));
                return true;
            } catch (error) {
                return false;
            }
        }

        // Remove a stale video mapping after YouTube rejects it.
        remove(song) {
            const key = buildCacheKey(song);
            const cache = this.read();
            if (!key || !cache.matches[key]) {
                return false;
            }
            delete cache.matches[key];
            try {
                this.storage.setItem(this.key, JSON.stringify(cache));
                return true;
            } catch (error) {
                return false;
            }
        }
    }

    return { CACHE_KEY, CACHE_VERSION, buildCacheKey, YouTubeMatchCache };
});
