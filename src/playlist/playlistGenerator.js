// Keep playlist recommendations separate from the reusable data-structure implementations.
(function (global) {
    const dsaApi = global.DSA || (
        typeof require === 'function' ? require('../core/dsa.js') : null
    );
    const PLAYLIST_SIZE = 20;

    // Thresholds are normalized quartiles from the first 5,000 CSV songs: valence P25/P75
    // 0.217085/0.677638, danceability P75 0.681725, energy P25/P75 0.312949/0.822211,
    // tempo P75 0.635812, and acousticness P75 0.791164. High/low tails use those percentiles.
    const MOOD_PROFILES = Object.freeze({
        happy: Object.freeze({
            name: 'Happy / Upbeat',
            rules: Object.freeze([
                { feature: 'valence', comparison: '>=', threshold: 0.677638 },
                { feature: 'danceability', comparison: '>=', threshold: 0.681725 }
            ])
        }),
        energetic: Object.freeze({
            name: 'Energetic',
            rules: Object.freeze([
                { feature: 'energy', comparison: '>=', threshold: 0.822211 },
                { feature: 'tempo', comparison: '>=', threshold: 0.635812 }
            ])
        }),
        chill: Object.freeze({
            name: 'Chill',
            rules: Object.freeze([
                { feature: 'energy', comparison: '<=', threshold: 0.312949 },
                { feature: 'acousticness', comparison: '>=', threshold: 0.791164 }
            ])
        }),
        melancholic: Object.freeze({
            name: 'Melancholic',
            rules: Object.freeze([
                { feature: 'valence', comparison: '<=', threshold: 0.217085 },
                { feature: 'energy', comparison: '<=', threshold: 0.312949 }
            ])
        }),
        acoustic: Object.freeze({
            name: 'Acoustic',
            rules: Object.freeze([
                { feature: 'acousticness', comparison: '>=', threshold: 0.791164 }
            ])
        })
    });
    const MOOD_NAMES = Object.freeze(Object.keys(MOOD_PROFILES));

    // Shuffle a copy with Fisher-Yates so callers' song arrays are never reordered.
    function shuffleSongs(songs, random = Math.random) {
        if (!Array.isArray(songs)) {
            throw new TypeError('Songs to shuffle must be an array');
        }
        if (typeof random !== 'function') {
            throw new TypeError('Shuffle random source must be a function');
        }

        const shuffled = [...songs];
        for (let index = shuffled.length - 1; index > 0; index--) {
            const sample = random();
            if (typeof sample !== 'number' || !Number.isFinite(sample) || sample < 0 || sample >= 1) {
                throw new RangeError('Shuffle random source must return a number in [0, 1)');
            }
            const swapIndex = Math.floor(sample * (index + 1));
            [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
        }
        return shuffled;
    }

    // Resolve either a simple mood key or its display name, without case sensitivity.
    function resolveMoodName(moodName) {
        if (typeof moodName !== 'string') {
            return null;
        }
        const normalizedName = moodName.trim().toLowerCase();
        return MOOD_NAMES.find((name) => {
            return name === normalizedName ||
                MOOD_PROFILES[name].name.toLowerCase() === normalizedName;
        }) || null;
    }

    class PlaylistGenerator {
        // Receive the existing catalog and graph; do not load or copy the CSV here.
        constructor(catalog, graph) {
            if (
                !catalog ||
                typeof catalog.search !== 'function' ||
                typeof catalog.inorderTraversal !== 'function'
            ) {
                throw new TypeError('PlaylistGenerator requires a B-Tree catalog');
            }
            if (
                !graph ||
                typeof graph.getNeighbors !== 'function' ||
                typeof graph.getSong !== 'function' ||
                typeof graph.hasNode !== 'function'
            ) {
                throw new TypeError('PlaylistGenerator requires a SongGraph');
            }
            this.catalog = catalog;
            this.graph = graph;
        }

        // Generate a seed-first playlist; ranking the bounded pool costs O(c log c).
        generateFromSeed(seedTrackId, options = {}) {
            const emptyResult = (message) => ({
                type: 'seed',
                seed: null,
                mood: null,
                songs: [],
                requested: PLAYLIST_SIZE,
                message
            });
            if (typeof seedTrackId !== 'string' || seedTrackId.trim() === '') {
                return emptyResult('A non-empty string track_id is required for a seed playlist.');
            }

            const seed = this.catalog.search(seedTrackId);
            if (!seed) {
                return emptyResult(`No catalog song was found for track_id "${seedTrackId.trim()}".`);
            }
            const seedId = String(seed.track_id).trim();
            if (!this.graph.hasNode(seedId)) {
                return emptyResult('The seed song is not available in the similarity graph because its audio features are invalid or missing.');
            }

            const expansionDepth = options && options.expansionDepth !== undefined
                ? options.expansionDepth
                : 2;
            if (!Number.isInteger(expansionDepth) || expansionDepth < 0) {
                throw new RangeError('Expansion depth must be a non-negative integer');
            }
            const random = options && options.random !== undefined
                ? options.random
                : Math.random;
            const candidateIds = this.collectSeedCandidates(seedId, expansionDepth);
            const rankedCandidates = [];
            for (const candidateId of candidateIds) {
                const candidateSong = this.graph.getSong(candidateId);
                if (!candidateSong || !dsaApi.hasValidFeatures(candidateSong)) {
                    continue;
                }
                rankedCandidates.push({
                    song: candidateSong,
                    similarity: dsaApi.computeSimilarity(
                        seed,
                        candidateSong,
                        this.graph.featureStats
                    )
                });
            }

            // Sort the small expanded pool directly; the existing MaxHeap ranks by rating, not similarity.
            rankedCandidates.sort((first, second) => {
                if (first.similarity !== second.similarity) {
                    return second.similarity - first.similarity;
                }
                return dsaApi.compareTrackIds(first.song.track_id, second.song.track_id);
            });

            const bestSimilarSongs = rankedCandidates
                .slice(0, PLAYLIST_SIZE - 1)
                .map((candidate) => candidate.song);
            const songs = [
                seed,
                ...shuffleSongs(bestSimilarSongs, random)
            ];
            const similarCount = songs.length - 1;
            return {
                type: 'seed',
                seed,
                mood: null,
                songs,
                requested: PLAYLIST_SIZE,
                message: similarCount < PLAYLIST_SIZE - 1
                    ? `Only ${similarCount} similar songs were available for this seed.`
                    : null
            };
        }

        // Collect direct neighbors, then expand levels; this visits at most O(k^depth) local IDs.
        collectSeedCandidates(seedId, expansionDepth) {
            const candidateIds = new Set();
            let frontier = [seedId];
            const expandedIds = new Set([seedId]);
            const neededCandidates = PLAYLIST_SIZE - 1;

            for (let depth = 1; depth <= expansionDepth && frontier.length > 0; depth++) {
                const nextFrontier = [];
                for (const currentId of frontier) {
                    for (const edge of this.graph.getNeighbors(currentId)) {
                        const neighborId = String(edge.to).trim();
                        if (
                            neighborId !== seedId &&
                            this.graph.hasNode(neighborId)
                        ) {
                            candidateIds.add(neighborId);
                        }
                        if (
                            depth < expansionDepth &&
                            !expandedIds.has(neighborId) &&
                            this.graph.hasNode(neighborId)
                        ) {
                            expandedIds.add(neighborId);
                            nextFrontier.push(neighborId);
                        }
                    }
                    if (candidateIds.size >= neededCandidates) {
                        break;
                    }
                }
                if (candidateIds.size >= neededCandidates) {
                    break;
                }
                frontier = nextFrontier;
            }

            return candidateIds;
        }

        // Filter the catalog in O(n) time for unique graph songs matching a mood profile.
        getMatchingSongs(moodName) {
            const resolvedMood = resolveMoodName(moodName);
            if (!resolvedMood) {
                return [];
            }
            return this.catalog.inorderTraversal().filter((song) => {
                return this.graph.hasNode(song.track_id) &&
                    this.matchesMood(song, resolvedMood);
            });
        }

        // Match only graph songs with valid features against every normalized mood rule.
        matchesMood(song, moodName) {
            const resolvedMood = resolveMoodName(moodName);
            if (
                !resolvedMood ||
                !dsaApi.hasValidFeatures(song) ||
                typeof song.track_id !== 'string' ||
                !this.graph.hasNode(song.track_id)
            ) {
                return false;
            }

            const vector = this.graph.normalizedFeatures.get(song.track_id.trim());
            if (!vector) {
                return false;
            }
            return MOOD_PROFILES[resolvedMood].rules.every((rule) => {
                const featureIndex = dsaApi.SONG_FEATURES.indexOf(rule.feature);
                const value = vector[featureIndex];
                return rule.comparison === '>='
                    ? value >= rule.threshold
                    : value <= rule.threshold;
            });
        }

        // Score matched songs by their average normalized margin beyond each mood boundary.
        scoreMoodMatch(song, moodName) {
            const resolvedMood = resolveMoodName(moodName);
            if (!resolvedMood || !this.matchesMood(song, resolvedMood)) {
                throw new Error('Mood score requires a valid song that matches the requested mood');
            }
            const vector = this.graph.normalizedFeatures.get(song.track_id.trim());
            const rules = MOOD_PROFILES[resolvedMood].rules;
            const totalMargin = rules.reduce((score, rule) => {
                const featureIndex = dsaApi.SONG_FEATURES.indexOf(rule.feature);
                const value = vector[featureIndex];
                return score + (rule.comparison === '>='
                    ? value - rule.threshold
                    : rule.threshold - value);
            }, 0);
            return totalMargin / rules.length;
        }

        // Score and sort m matches in O(m log m), then shuffle only the selected songs.
        generateFromMood(moodName, options = {}) {
            const resolvedMood = resolveMoodName(moodName);
            if (!resolvedMood) {
                const validMoods = MOOD_NAMES.join(', ');
                return {
                    type: 'mood',
                    seed: null,
                    mood: null,
                    songs: [],
                    requested: PLAYLIST_SIZE,
                    message: `Unknown mood. Valid moods: ${validMoods}.`
                };
            }

            const random = options && options.random !== undefined
                ? options.random
                : Math.random;
            const matches = this.getMatchingSongs(resolvedMood)
                .map((song) => ({
                    song,
                    score: this.scoreMoodMatch(song, resolvedMood)
                }))
                .sort((first, second) => {
                    if (first.score !== second.score) {
                        return second.score - first.score;
                    }
                    return dsaApi.compareTrackIds(first.song.track_id, second.song.track_id);
                });
            const selectedSongs = matches
                .slice(0, PLAYLIST_SIZE)
                .map((match) => match.song);
            const songs = shuffleSongs(selectedSongs, random);
            return {
                type: 'mood',
                seed: null,
                mood: resolvedMood,
                songs,
                requested: PLAYLIST_SIZE,
                message: songs.length < PLAYLIST_SIZE
                    ? `Only ${songs.length} songs matched the ${MOOD_PROFILES[resolvedMood].name} mood.`
                    : null
            };
        }
    }

    const exported = {
        PLAYLIST_SIZE,
        MOOD_NAMES,
        MOOD_PROFILES,
        shuffleSongs,
        PlaylistGenerator
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = exported;
    }
    global.PlaylistGenerator = PlaylistGenerator;
    global.PLAYLIST_SIZE = PLAYLIST_SIZE;
    global.MOOD_NAMES = MOOD_NAMES;
    global.MOOD_PROFILES = MOOD_PROFILES;
})(typeof window !== 'undefined' ? window : globalThis);
