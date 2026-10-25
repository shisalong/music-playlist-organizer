(function (global, factory) {
    const exported = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = exported;
    }
    global.YouTubeApiClient = exported.YouTubeApiClient;
    global.YouTubeApiError = exported.YouTubeApiError;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const API_BASE_URL = 'https://www.googleapis.com/youtube/v3';
    const API_FALLBACK_BASE_URL = 'https://youtube.googleapis.com/youtube/v3';

    class YouTubeApiError extends Error {
        constructor(code, message, status, details) {
            super(message);
            this.name = 'YouTubeApiError';
            this.code = code;
            this.status = status;
            this.details = details;
        }
    }

    // Extract the most useful reason from a YouTube error response.
    function getErrorReason(payload, status) {
        const reasons = payload && payload.error && Array.isArray(payload.error.errors)
            ? payload.error.errors.map((error) => error.reason).filter(Boolean)
            : [];
        return reasons[0] || payload && payload.error && payload.error.status || `http_${status}`;
    }

    class YouTubeApiClient {
        // Wrap fetch and authorization so retry behavior stays outside the exporter.
        constructor(options = {}) {
            this.auth = options.auth;
            const fetchImplementation = options.fetch || globalThis.fetch;
            this.fetch = typeof fetchImplementation === 'function'
                ? fetchImplementation.bind(options.fetch ? null : globalThis)
                : null;
            this.sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
            this.maxTransientRetries = options.maxTransientRetries === undefined ? 2 : options.maxTransientRetries;
        }

        // Make one normalized API request with a single authorization retry.
        async request(path, options = {}, retryAuthorization = true) {
            const token = await this.auth.getAccessToken();
            const method = options.method || 'GET';
            let transientAttempt = 0;
            while (true) {
                let response = null;
                let networkError = null;
                const baseUrls = method === 'GET'
                    ? [API_BASE_URL, API_FALLBACK_BASE_URL]
                    : [API_BASE_URL];
                for (const baseUrl of baseUrls) {
                    try {
                        response = await this.fetch(`${baseUrl}${path}`, {
                            method,
                            headers: {
                                Authorization: `Bearer ${token}`,
                                ...(options.body ? { 'Content-Type': 'application/json' } : {})
                            },
                            body: options.body ? JSON.stringify(options.body) : undefined,
                            signal: options.signal
                        });
                        break;
                    } catch (error) {
                        networkError = error;
                    }
                }
                if (!response) {
                    const detail = networkError && networkError.message
                        ? ` Browser detail: ${networkError.message}`
                        : '';
                    throw new YouTubeApiError(
                        'network_error',
                        `The browser blocked or could not reach the YouTube Data API. Check your connection, disable ad/tracker blocking for GenMix, and confirm the YouTube Data API v3 is enabled.${detail}`,
                        0,
                        networkError
                    );
                }

                let payload = null;
                try {
                    payload = await response.json();
                } catch (error) {
                    payload = null;
                }
                if (response.ok) {
                    return payload || {};
                }
                if (response.status === 401 && retryAuthorization) {
                    await this.auth.refreshAccessToken();
                    return this.request(path, options, false);
                }
                const reason = getErrorReason(payload, response.status);
                if ((response.status === 429 || response.status >= 500) && transientAttempt < this.maxTransientRetries) {
                    await this.sleep(250 * (2 ** transientAttempt));
                    transientAttempt++;
                    continue;
                }
                const quotaReason = reason === 'quotaExceeded' || reason === 'rateLimitExceeded';
                const message = quotaReason
                    ? 'Daily YouTube API quota reached. Try again after it resets at midnight Pacific Time.'
                    : payload && payload.error && payload.error.message || `YouTube request failed with status ${response.status}.`;
                throw new YouTubeApiError(reason, message, response.status, payload);
            }
        }

        // Search a small music-only result set for one song.
        searchVideos(query, signal) {
            const params = new URLSearchParams({
                part: 'snippet',
                type: 'video',
                maxResults: '5',
                videoCategoryId: '10',
                videoEmbeddable: 'true',
                q: query
            });
            return this.request(`/search?${params.toString()}`, { signal });
        }

        // Create a playlist owned by the authorized user.
        createPlaylist(name, privacyStatus, signal) {
            const params = new URLSearchParams({ part: 'snippet,status' });
            return this.request(`/playlists?${params.toString()}`, {
                method: 'POST',
                signal,
                body: {
                    snippet: {
                        title: name,
                        description: 'Created by GenMix from a generated or saved playlist.'
                    },
                    status: { privacyStatus }
                }
            });
        }

        // Append one video to the playlist in the exporter's original order.
        addPlaylistItem(playlistId, videoId, position, signal) {
            const params = new URLSearchParams({ part: 'snippet' });
            return this.request(`/playlistItems?${params.toString()}`, {
                method: 'POST',
                signal,
                body: {
                    snippet: {
                        playlistId,
                        position,
                        resourceId: { kind: 'youtube#video', videoId }
                    }
                }
            });
        }
    }

    return { API_BASE_URL, API_FALLBACK_BASE_URL, YouTubeApiError, getErrorReason, YouTubeApiClient };
});
