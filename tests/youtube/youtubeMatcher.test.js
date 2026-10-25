const Matcher = require('../../src/integrations/youtube/youtubeMatcher.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (!condition) throw new Error(message);
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

function candidate(videoId, title, channelTitle = 'Artist - Topic') {
    return { id: { videoId }, snippet: { title, channelTitle } };
}

runTest('builds a title and artist query from both supported field shapes', () => {
    assert(Matcher.buildSearchQuery({ title: 'Song', artist: 'Artist' }) === 'Song Artist', 'Primary fields should be used');
    assert(Matcher.buildSearchQuery({ track_name: 'Track', artists: 'Band' }) === 'Track Band', 'CSV fields should be used');
});

runTest('returns an empty query when title or artist is missing', () => {
    assert(Matcher.buildSearchQuery({ title: 'Song' }) === '', 'Missing artist should be rejected');
    assert(Matcher.buildSearchQuery({ artist: 'Artist' }) === '', 'Missing title should be rejected');
});

runTest('prefers strong title and artist overlap', () => {
    const song = { title: 'Blue Sky', artist: 'The Waves' };
    const weak = Matcher.scoreCandidate(song, candidate('weak', 'Blue Monday', 'Other Channel'));
    const strong = Matcher.scoreCandidate(song, candidate('strong', 'Blue Sky Official Audio', 'The Waves - Topic'));
    assert(strong > weak, 'Strong overlap should rank first');
});

runTest('penalizes live cover and remix terms absent from the source title', () => {
    const song = { title: 'Blue Sky', artist: 'The Waves' };
    const clean = Matcher.scoreCandidate(song, candidate('clean', 'Blue Sky', 'The Waves'));
    ['Live', 'Cover', 'Remix'].forEach((term) => {
        const altered = Matcher.scoreCandidate(song, candidate(term, `Blue Sky ${term}`, 'The Waves'));
        assert(clean > altered, `${term} should reduce the score`);
    });
});

runTest('does not penalize a qualifier present in the original song title', () => {
    const song = { title: 'Blue Sky Live', artist: 'The Waves' };
    const score = Matcher.scoreCandidate(song, candidate('live', 'Blue Sky Live', 'The Waves'));
    assert(score > Matcher.DEFAULT_MATCH_THRESHOLD, 'A legitimate live title should remain matchable');
});

runTest('rejects candidates below the confidence threshold', () => {
    const selected = Matcher.selectBestCandidate(
        { title: 'Blue Sky', artist: 'The Waves' },
        [candidate('wrong', 'Completely Different', 'Unknown')]
    );
    assert(selected.candidate === null, 'Unrelated result should be unmatched');
});

runTest('rejects empty candidate lists and incomplete songs', () => {
    assert(Matcher.selectBestCandidate({ title: 'Song', artist: 'Artist' }, []).candidate === null, 'No results should be unmatched');
    assert(Matcher.selectBestCandidate({ title: 'Song' }, [candidate('x', 'Song')]).candidate === null, 'Incomplete song should be unmatched');
});

console.log(`\nTest summary: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
