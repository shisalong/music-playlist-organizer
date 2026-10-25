(function (global, factory) {
    const exported = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = exported;
    }
    global.YouTubeMatcher = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const DEFAULT_MATCH_THRESHOLD = 2;
    const PENALIZED_TERMS = ['live', 'cover', 'remix', 'reaction', 'karaoke', 'instrumental'];

    // Convert user and YouTube text into comparable lowercase word tokens.
    function normalizeText(value) {
        return String(value || '')
            .replace(/&amp;/gi, ' and ')
            .replace(/&#39;|&apos;/gi, "'")
            .replace(/&quot;/gi, '"')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    // Read the repository's supported song title fields.
    function getSongTitle(song) {
        return String(song && (song.title || song.track_name) || '').trim();
    }

    // Read the repository's supported song artist fields.
    function getSongArtist(song) {
        return String(song && (song.artist || song.artists) || '').trim();
    }

    // Build one predictable YouTube search query from a catalog song.
    function buildSearchQuery(song) {
        const title = getSongTitle(song);
        const artist = getSongArtist(song);
        return title && artist ? `${title} ${artist}` : '';
    }

    // Return unique non-empty words for overlap scoring.
    function tokenize(value) {
        const normalized = normalizeText(value);
        return normalized ? [...new Set(normalized.split(' '))] : [];
    }

    // Score a YouTube candidate without making network or DOM calls.
    function scoreCandidate(song, candidate) {
        const songTitle = normalizeText(getSongTitle(song));
        const songArtist = normalizeText(getSongArtist(song));
        const snippet = candidate && candidate.snippet || {};
        const candidateTitle = normalizeText(snippet.title);
        const channelTitle = normalizeText(snippet.channelTitle);
        if (!songTitle || !songArtist || !candidateTitle) {
            return Number.NEGATIVE_INFINITY;
        }

        const titleTokens = tokenize(songTitle);
        const artistTokens = tokenize(songArtist);
        const candidateTokens = new Set(tokenize(`${candidateTitle} ${channelTitle}`));
        const titleMatches = titleTokens.filter((token) => candidateTokens.has(token)).length;
        const artistMatches = artistTokens.filter((token) => candidateTokens.has(token)).length;
        let score = titleMatches * 2 + artistMatches * 2.5;
        score += titleTokens.length > 0 ? titleMatches / titleTokens.length : 0;
        score += artistTokens.length > 0 ? artistMatches / artistTokens.length : 0;

        PENALIZED_TERMS.forEach((term) => {
            if (candidateTitle.includes(term) && !songTitle.includes(term)) {
                score -= 3;
            }
        });
        if (candidateTitle.includes('official')) {
            score += 0.75;
        }
        if (channelTitle.includes('vevo') || channelTitle.endsWith(' topic')) {
            score += 1;
        }
        return score;
    }

    // Select only a candidate that clears the documented confidence threshold.
    function selectBestCandidate(song, candidates, threshold = DEFAULT_MATCH_THRESHOLD) {
        if (!buildSearchQuery(song)) {
            return { candidate: null, score: null, reason: 'Song title or artist is missing.' };
        }
        const usable = (Array.isArray(candidates) ? candidates : []).filter((candidate) => {
            return Boolean(candidate && candidate.id && candidate.id.videoId);
        });
        if (usable.length === 0) {
            return { candidate: null, score: null, reason: 'No YouTube search results were found.' };
        }
        const ranked = usable.map((candidate) => ({
            candidate,
            score: scoreCandidate(song, candidate)
        })).sort((left, right) => right.score - left.score);
        if (!Number.isFinite(ranked[0].score) || ranked[0].score < threshold) {
            return {
                candidate: null,
                score: ranked[0].score,
                reason: 'No YouTube result was a confident match.'
            };
        }
        return { ...ranked[0], reason: '' };
    }

    return {
        DEFAULT_MATCH_THRESHOLD,
        PENALIZED_TERMS,
        normalizeText,
        getSongTitle,
        getSongArtist,
        buildSearchQuery,
        scoreCandidate,
        selectBestCandidate
    };
});
