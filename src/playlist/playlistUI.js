// Find title or artist matches and return only the requested visible results.
function findSongsByName(songs, query, limit = 30) {
    if (!Array.isArray(songs)) {
        throw new TypeError('Songs must be provided as an array');
    }
    if (!Number.isInteger(limit) || limit < 1) {
        throw new RangeError('Search result limit must be a positive integer');
    }
    if (typeof query !== 'string' || query.trim() === '') {
        return { songs: [], totalMatches: 0, shown: 0 };
    }

    const normalizedQuery = query.trim().toLocaleLowerCase();
    const matches = songs.filter((song) => {
        if (!song || typeof song !== 'object') {
            return false;
        }
        const searchableText = [
            song.title,
            song.track_name,
            song.artist,
            song.artists
        ]
            .filter((value) => typeof value === 'string')
            .join(' ')
            .toLocaleLowerCase();
        return searchableText.includes(normalizedQuery);
    });
    const visibleSongs = matches.slice(0, limit);
    return {
        songs: visibleSongs,
        totalMatches: matches.length,
        shown: visibleSongs.length
    };
}

// Select distinct songs from a copy with partial Fisher-Yates; keep catalog order untouched.
function sampleSongs(songs, count, random = Math.random) {
    if (!Array.isArray(songs)) {
        throw new TypeError('Songs to sample must be provided as an array');
    }
    if (!Number.isInteger(count) || count < 0) {
        throw new RangeError('Sample size must be a non-negative integer');
    }
    if (typeof random !== 'function') {
        throw new TypeError('Sample random source must be a function');
    }

    const sample = [...songs];
    const sampleSize = Math.min(count, sample.length);
    for (let index = 0; index < sampleSize; index++) {
        const value = random();
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) {
            throw new RangeError('Sample random source must return a number in [0, 1)');
        }
        const swapIndex = index + Math.floor(value * (sample.length - index));
        [sample[index], sample[swapIndex]] = [sample[swapIndex], sample[index]];
    }
    return sample.slice(0, sampleSize);
}

// Format audio features consistently for the generated playlist table.
function formatAudioFeature(feature, value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return '—';
    }
    return feature === 'tempo' ? String(Math.round(value)) : value.toFixed(2);
}

// Use an exported profile label when present, otherwise capitalize the mood key.
function formatMoodName(moodName, moodProfiles = {}) {
    const profile = moodProfiles[moodName];
    if (profile && typeof profile.name === 'string') {
        return profile.name;
    }
    if (typeof moodName !== 'string' || moodName.trim() === '') {
        return '';
    }
    return moodName
        .trim()
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const PlaylistUI = {
    findSongsByName,
    sampleSongs,
    formatAudioFeature,
    formatMoodName
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PlaylistUI;
}
if (typeof window !== 'undefined') {
    window.PlaylistUI = PlaylistUI;
}
