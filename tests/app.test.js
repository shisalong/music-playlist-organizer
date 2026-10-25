const fs = require('fs');
const path = require('path');
const vm = require('vm');
const DSA = require('../src/core/dsa.js');
const { PlaylistGenerator, MOOD_NAMES, MOOD_PROFILES } = require('../src/playlist/playlistGenerator.js');
const PlaylistUI = require('../src/playlist/playlistUI.js');
const PlaylistWizard = require('../src/playlist/playlistWizard.js');
const PlaylistEditor = require('../src/playlist/playlistEditor.js');

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

// Run one asynchronous app test and retain the project's PASS/FAIL output format.
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

// Provide the small DOM surface app.js needs without introducing a browser dependency.
class FakeElement {
    constructor() {
        this.innerHTML = '';
        this.textContent = '';
        this.value = '';
        this.firstChild = null;
        this.children = [];
        this.style = {};
        this.hidden = false;
        this.disabled = false;
        this.checked = false;
        this.attributes = new Map();
        this.listeners = new Map();
        this.classList = {
            classes: new Set(),
            add(...names) {
                names.forEach((name) => this.classes.add(name));
            },
            remove(...names) {
                names.forEach((name) => this.classes.delete(name));
            },
            contains(name) {
                return this.classes.has(name);
            },
            toggle(name, force) {
                const shouldAdd = force === undefined ? !this.classes.has(name) : force;
                if (shouldAdd) {
                    this.classes.add(name);
                } else {
                    this.classes.delete(name);
                }
                return shouldAdd;
            }
        };
    }

    addEventListener(eventName, listener) {
        this.listeners.set(eventName, listener);
    }

    click() {
        const listener = this.listeners.get('click');
        if (listener) {
            return listener({ target: this });
        }
    }

    focus() {}

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    getAttribute(name) {
        return this.attributes.get(name) || null;
    }

    appendChild(element) {
        this.children.push(element);
        this.firstChild = this.children[0] || null;
    }

    replaceChildren(...elements) {
        this.children = [...elements];
        this.firstChild = this.children[0] || null;
    }

    querySelector() {
        return null;
    }

    querySelectorAll() {
        return [];
    }

    insertBefore(element) {
        this.firstChild = element;
    }

    remove() {}
}

function createMemoryStorage() {
    const values = new Map();
    return {
        getItem(key) {
            return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
            values.set(key, String(value));
        }
    };
}

// Evaluate the existing app script with injected CSV and DOM stubs.
function createApp(fetchImplementation, localStorage = createMemoryStorage()) {
    const elements = new Map();
    const listeners = new Map();
    const loggedErrors = [];
    const loggedWarnings = [];
    const document = {
        head: new FakeElement(),
        body: new FakeElement(),
        addEventListener(eventName, listener) {
            listeners.set(eventName, listener);
        },
        createElement() {
            return new FakeElement();
        },
        getElementById(id) {
            if (!elements.has(id)) {
                elements.set(id, new FakeElement());
            }
            return elements.get(id);
        },
        querySelector(selector) {
            if (selector === 'input[name="wizardMood"]') {
                return elements.get('wizardMoodOptions')?.children[0]?.children[0] || null;
            }
            return null;
        },
        querySelectorAll(selector) {
            if (selector === 'input[name="wizardMood"]') {
                const options = elements.get('wizardMoodOptions');
                return options ? options.children.map((label) => label.children[0]) : [];
            }
            return [];
        }
    };
    const context = {
        DSA,
        PlaylistGenerator,
        PlaylistUI,
        PlaylistWizard,
        PlaylistEditor,
        MOOD_NAMES,
        MOOD_PROFILES,
        document,
        window: { MOOD_NAMES, MOOD_PROFILES, PlaylistUI, PlaylistWizard, localStorage },
        fetch: fetchImplementation,
        console: {
            log() {},
            warn(...args) {
                loggedWarnings.push(args.join(' '));
            },
            error(...args) {
                loggedErrors.push(args.join(' '));
            }
        },
        setTimeout(callback) {
            return global.setTimeout(callback, 0);
        },
        clearTimeout(timer) {
            global.clearTimeout(timer);
        },
        clearInterval() {},
        setInterval() {
            return 0;
        },
        Date,
        Math
    };
    vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8'),
        context,
        { filename: 'app.js' }
    );
    return {
        context,
        elements,
        localStorage,
        loggedErrors,
        loggedWarnings,
        startup() {
            return listeners.get('DOMContentLoaded')();
        },
        evaluate(expression) {
            return vm.runInNewContext(expression, context);
        }
    };
}

// Return a successful fetch response containing the given CSV text.
function csvResponse(csvText) {
    return {
        ok: true,
        status: 200,
        async text() {
            return csvText;
        }
    };
}

// Check that an empty app still guards queue and playlist actions.
function verifyEmptyQueueControls(app) {
    app.context.shufflePlaylist();
    assert(app.evaluate('playlist.isEmpty()'), 'Queue actions must leave an empty queue usable');
    assertEqual(
        app.evaluate('catalogSongs.length'),
        0,
        'An empty CSV startup must not seed recommendations from fake songs'
    );
    assert(
        app.elements.get('recommendationsDisplay').children[0].textContent.includes('Song library is empty'),
        'An empty catalog should retain the empty-library message on Home'
    );
}

// Enter a named wizard session using the actual form submission path.
function enterWizardWithName(app, name) {
    app.context.switchSection('generator');
    app.elements.get('createPlaylistButton').click();
    app.elements.get('wizardNameInput').value = name;
    return app.elements.get('wizardNameForm').listeners.get('submit')({ preventDefault() {} });
}

async function main() {
    const requiredHeader = [
        'track_id',
        'track_name',
        'artists',
        'track_genre',
        'danceability',
        'energy',
        'acousticness',
        'valence',
        'tempo'
    ].join(',');

    await runTest('app catalog starts empty before CSV loading and empty CSV stays empty', async () => {
        const app = createApp(async () => csvResponse(`${requiredHeader}\n`));
        assertEqual(app.evaluate('songCatalog.size'), 0, 'Catalog must start empty without demo initialization');
        assertEqual(app.evaluate('playlist.size'), 0, 'Playback queue must start empty');

        await app.startup();
        assertEqual(app.evaluate('songCatalog.size'), 0, 'Header-only CSV should leave the catalog empty');
        assertEqual(app.evaluate('songIndex.songs.length'), 0, 'Sorted index should remain empty');
        assertEqual(app.evaluate('songGraph.nodeCount()'), 0, 'Empty CSV should create an empty graph');
        assert(app.context.window.playlistGenerator instanceof PlaylistGenerator, 'Generator should still be available for an empty catalog');
        assert(
            app.elements.get('libraryStatus').textContent.includes('Song library is empty'),
            'Empty CSV should display a clear library status'
        );
        assert(app.elements.get('wizardSongMethod').disabled, 'Empty CSV should disable the song option');
        assert(app.elements.get('wizardMoodMethod').disabled, 'Empty CSV should disable the mood option');
        assert(
            app.elements.get('wizardMethodEmptyMessage').textContent.includes('library is empty'),
            'Empty CSV should explain why generation is unavailable'
        );
        assert(app.loggedWarnings.some((message) => message.includes('No usable songs')), 'Empty CSV cause should be logged');
        const createButton = app.elements.get('homePlaylistsDisplay').children[0].children[1];
        createButton.click();
        assert(
            app.elements.get('generatorSection').classList.contains('active'),
            'The empty-playlist action should use the existing switchSection function'
        );
        app.elements.get('createPlaylistButton').click();
        app.elements.get('wizardNameForm').listeners.get('submit')({ preventDefault() {} });
        assertEqual(app.evaluate('wizardState.step'), 'name', 'An empty name should block Next');
        assertEqual(
            app.elements.get('wizardNameError').textContent,
            'Please enter a playlist name.',
            'Empty name validation should be announced inline'
        );
        app.elements.get('wizardNameInput').value = '   ';
        app.elements.get('wizardNameForm').listeners.get('submit')({ preventDefault() {} });
        assertEqual(app.evaluate('wizardState.step'), 'name', 'A whitespace-only name should block Next');
        app.elements.get('wizardNameCancel').click();
        assertEqual(app.evaluate('wizardState.step'), 'start', 'Cancel should reset the wizard state');
        app.elements.get('createPlaylistButton').click();
        app.elements.get('wizardNameInput').value = 'Empty catalog';
        app.elements.get('wizardNameForm').listeners.get('submit')({ preventDefault() {} });
        assert(app.elements.get('wizardSongMethod').disabled, 'Empty catalog options must stay disabled in the wizard');
        verifyEmptyQueueControls(app);
    });

    await runTest('failed CSV fetch leaves no fake catalog songs and reports the failure', async () => {
        const app = createApp(async () => {
            throw new Error('network unavailable');
        });
        await app.startup();
        assertEqual(app.evaluate('songCatalog.size'), 0, 'Failed load must leave the catalog empty');
        assertEqual(app.evaluate('songIndex.songs.length'), 0, 'Failed load must leave the sorted index empty');
        assert(
            app.elements.get('libraryStatus').textContent.includes('Could not load songs_deduped.csv'),
            'Failed load should explain the empty library in Library'
        );
        assert(app.elements.get('wizardSongMethod').disabled, 'Failed CSV load should disable song generation');
        assert(app.elements.get('wizardMoodMethod').disabled, 'Failed CSV load should disable mood generation');
        assert(app.loggedErrors.some((message) => message.includes('network unavailable')), 'Underlying fetch failure should be logged');
        verifyEmptyQueueControls(app);
    });

    await runTest('real CSV startup contains only source records and preserves legitimate title collisions', async () => {
        const csvText = fs.readFileSync(path.join(__dirname, '..', 'data', 'songs_deduped.csv'), 'utf8');
        const app = createApp(async () => csvResponse(csvText));
        await app.startup();
        const sourceTree = new DSA.BTree();
        DSA.loadSongsFromCSV(csvText, sourceTree);
        const sourceIds = new Set(
            sourceTree.inorderTraversal().map((song) => song.track_id)
        );
        const catalogSongs = app.evaluate('songCatalog.inorderTraversal()');
        assertEqual(catalogSongs.length, 4428, 'App should load every unique song in songs_deduped.csv');
        assert(
            catalogSongs.every((song) => sourceIds.has(song.track_id)),
            'Every startup catalog song ID must be present in the source CSV'
        );
        assert(
            catalogSongs.every((song) => !song.track_id.startsWith('sample-')),
            'No demo-generated track IDs may be inserted'
        );
        const legitimateCollision = catalogSongs.find((song) => {
            return song.title === 'Smells Like Teen Spirit' && song.artist === 'Nirvana';
        });
        assert(legitimateCollision, 'Legitimate CSV song with the former demo title/artist must remain');
        assertEqual(
            app.evaluate('playlist.size'),
            0,
            'CSV catalog load should not implicitly populate the playback queue'
        );
        assert(!app.elements.get('wizardSongMethod').disabled, 'Usable CSV should enable the song method');
        assert(!app.elements.get('wizardMoodMethod').disabled, 'Usable CSV should enable the mood method');
        assertEqual(
            app.elements.get('wizardMoodOptions').children.map((option) => option.children[0].value),
            MOOD_NAMES,
            'Mood radio options should use only the generator-exported mood keys'
        );
        assertEqual(
            app.elements.get('recommendationsDisplay').children.length,
            12,
            'Home should display twelve recommendations from the loaded catalog'
        );
        assert(
            app.evaluate('catalogSongs === songIndex.songs'),
            'Home should reuse the sorted catalog snapshot rather than rebuild it'
        );

        const song = app.evaluate(
            'songCatalog.inorderTraversal().find((candidate) => songGraph.hasNode(candidate.track_id))'
        );
        assert(song, 'CSV startup should provide at least one valid song seed');
        app.context.switchSection('generator');
        app.elements.get('createPlaylistButton').click();
        app.elements.get('wizardNameInput').value = '  Similar Songs  ';
        app.elements.get('wizardNameForm').listeners.get('submit')({ preventDefault() {} });
        assertEqual(
            app.evaluate('wizardState.step'),
            'method',
            'A valid trimmed name should advance to method selection'
        );
        assertEqual(app.evaluate('wizardState.name'), 'Similar Songs', 'The wizard should retain the trimmed name');
        app.elements.get('wizardMethodBack').click();
        assertEqual(app.elements.get('wizardNameInput').value, 'Similar Songs', 'Back should refill the chosen name');
        app.elements.get('wizardNameForm').listeners.get('submit')({ preventDefault() {} });
        app.elements.get('wizardSongMethod').click();
        app.context.selectWizardSeed('not-in-the-catalog');
        assertEqual(app.evaluate('wizardState.seedTrackId'), null, 'Unknown seeds should be handled without throwing');
        assert(app.elements.get('wizardSongGenerate').disabled, 'Unknown seeds must not enable generation');
        const searchInput = app.elements.get('wizardSongSearch');
        searchInput.value = song.title;
        searchInput.listeners.get('input')({ target: searchInput });
        assert(
            app.elements.get('wizardSongSearchStatus').textContent.startsWith('Showing'),
            'Song search should report the visible and total match counts'
        );
        const seedOption = app.elements.get('wizardSongResults').children.find((button) => {
            return button.textContent.includes(song.title);
        });
        assert(seedOption, 'Title search should render a matching seed button');
        seedOption.click();
        assert(!app.elements.get('wizardSongGenerate').disabled, 'Generate should enable after seed selection');
        const generator = app.context.window.playlistGenerator;
        const originalSeedGenerator = generator.generateFromSeed;
        let seedCalls = 0;
        generator.generateFromSeed = function (trackId) {
            seedCalls++;
            return originalSeedGenerator.call(this, trackId);
        };
        app.elements.get('wizardSongBack').click();
        app.elements.get('wizardSongMethod').click();
        assertEqual(app.elements.get('wizardSongSearch').value, song.title, 'Back should retain the search query');
        assertEqual(app.evaluate('wizardState.seedTrackId'), song.track_id, 'Back should retain the selected seed');
        const seedResult = await app.elements.get('wizardSongGenerate').click();
        assertEqual(seedCalls, 1, 'One UI submission should call the seed generator once');
        assertEqual(seedResult.type, 'seed', 'Seed action should call the existing seed generator');
        assertEqual(seedResult.seed.track_id, song.track_id, 'Seed result should retain the selected song');
        assertEqual(app.context.window.lastGeneratedPlaylist, seedResult, 'Latest result should be exposed for later phases');
        assertEqual(app.evaluate('wizardState.step'), 'result', 'Seed generation should leave the loading step');
        assert(
            app.elements.get('wizardResultsTable').children[0].children[1].children[0].children[1]
                .textContent.startsWith('Seed: '),
            'The seed should remain first and be marked in the result table'
        );
        assertEqual(app.evaluate('playlist.size'), 0, 'Generator output must not enter playback queue');

        app.context.cancelPlaylistWizard();
        app.elements.get('createPlaylistButton').click();
        app.elements.get('wizardNameInput').value = 'Mood Mix';
        app.elements.get('wizardNameForm').listeners.get('submit')({ preventDefault() {} });
        app.elements.get('wizardMoodMethod').click();
        const moodOption = app.elements.get('wizardMoodOptions').children.find((option) => {
            return option.children[0].value === 'happy';
        });
        const originalMoodGenerator = generator.generateFromMood;
        let moodCalls = 0;
        generator.generateFromMood = function (moodName) {
            moodCalls++;
            return originalMoodGenerator.call(this, moodName);
        };
        moodOption.children[0].checked = true;
        moodOption.children[0].listeners.get('change')();
        assert(!app.elements.get('wizardMoodGenerate').disabled, 'Mood Generate should enable after mood selection');
        app.elements.get('wizardMoodBack').click();
        app.elements.get('wizardMoodMethod').click();
        assert(moodOption.children[0].checked, 'Back should retain the selected mood');
        const moodResult = await app.elements.get('wizardMoodGenerate').click();
        assertEqual(moodCalls, 1, 'One UI submission should call the mood generator once');
        assertEqual(moodResult.type, 'mood', 'Mood action should call the existing mood generator');
        assert(moodResult.songs.length <= 20, 'Mood result should respect the generator playlist size');
        assertEqual(app.context.window.lastGeneratedPlaylist, moodResult, 'Mood generation should replace the last result');
        assertEqual(app.evaluate('playlist.size'), 0, 'Regeneration must not alter playback queue');
        assertEqual(
            app.localStorage.getItem('genmixSavedPlaylists'),
            null,
            'Generated results should not be persisted as saved playlists'
        );
    });

    await runTest('saved queue playlists render in Home and Library and persist across app reloads', async () => {
        const csvText = fs.readFileSync(path.join(__dirname, '..', 'data', 'songs_deduped.csv'), 'utf8');
        const storage = createMemoryStorage();
        const app = createApp(async () => csvResponse(csvText), storage);
        await app.startup();

        const song = app.evaluate('songCatalog.inorderTraversal()[0]');
        app.context.addSongToPlaylist(song.track_id);
        app.context.document.getElementById('playlistNameInput').value = 'Evening Mix';
        assert(app.context.saveCurrentQueue(), 'A named non-empty queue should be saved');

        const savedPlaylists = JSON.parse(storage.getItem('genmixSavedPlaylists'));
        assertEqual(savedPlaylists.length, 1, 'One saved playlist should be stored');
        assertEqual(savedPlaylists[0].name, 'Evening Mix', 'The saved playlist should retain its name');
        assertEqual(savedPlaylists[0].songs.length, 1, 'The saved playlist should snapshot its queue songs');
        assertEqual(
            app.elements.get('homePlaylistsDisplay').children[0].children[0].textContent,
            'Evening Mix',
            'Home should render the saved playlist name as text'
        );
        assertEqual(
            app.elements.get('homePlaylistsDisplay').children[0].children[1].textContent,
            '1 song',
            'Home should show the saved playlist song count'
        );

        const reloadedApp = createApp(async () => csvResponse(csvText), storage);
        await reloadedApp.startup();
        reloadedApp.context.switchSection('library');
        assertEqual(
            reloadedApp.elements.get('libraryDisplay').children.length,
            1,
            'Library should show saved playlists only'
        );
        assertEqual(
            reloadedApp.elements.get('libraryDisplay').children[0].children[0].textContent,
            'Evening Mix',
            'Saved playlists should remain available after a page reload'
        );
        assertEqual(
            reloadedApp.elements.get('libraryDisplay').children[0].children[1].textContent,
            '1 song',
            'Library should show the saved playlist song count'
        );
    });

    await runTest('generated playlists save once, refresh Home and Library, and persist', async () => {
        const csvText = fs.readFileSync(path.join(__dirname, '..', 'data', 'songs_deduped.csv'), 'utf8');
        const storage = createMemoryStorage();
        const existingPlaylist = {
            id: 'preexisting',
            name: 'Existing Mix',
            createdAt: '2026-01-01T00:00:00.000Z',
            songs: [{ track_id: 'existing-track', title: 'Existing Song' }]
        };
        storage.setItem('genmixSavedPlaylists', JSON.stringify([existingPlaylist]));
        const app = createApp(async () => csvResponse(csvText), storage);
        await app.startup();

        assert(enterWizardWithName(app, 'Generated Mix'), 'A valid playlist name should advance');
        app.elements.get('wizardMoodMethod').click();
        const moodOption = app.elements.get('wizardMoodOptions').children.find((option) => {
            return option.children[0].value === MOOD_NAMES[0];
        }).children[0];
        moodOption.checked = true;
        moodOption.listeners.get('change')();
        const generated = await app.elements.get('wizardMoodGenerate').click();
        assert(generated.songs.length > 0, 'The real mood generator should return catalog songs');
        assertEqual(
            JSON.parse(storage.getItem('genmixSavedPlaylists')).length,
            1,
            'Unsaved results must not alter the existing saved list'
        );
        assert(
            !app.elements.get('homePlaylistsDisplay').children.some((card) => {
                return card.children[0].textContent === 'Generated Mix';
            }),
            'An unsaved result must not appear in Home'
        );

        assert(app.elements.get('wizardSaveButton').click(), 'The first save should succeed');
        assert(!app.elements.get('wizardSaveButton').click(), 'A repeated save should be ignored');
        const stored = JSON.parse(storage.getItem('genmixSavedPlaylists'));
        assertEqual(stored.length, 2, 'Repeated Save clicks should store only one new playlist');
        assertEqual(stored[0], existingPlaylist, 'Saving should leave existing saved playlists untouched');
        assertEqual(stored[1].name, 'Generated Mix', 'Saved playlist should use the chosen name');
        assertEqual(stored[1].songs.length, generated.songs.length, 'Saved playlist should contain all result songs');
        assert(typeof stored[1].id === 'string', 'Saved playlist should use the existing ID field');
        assert(typeof stored[1].createdAt === 'string', 'Saved playlist should use the existing date field');
        assert(
            app.elements.get('wizardSaveStatus').textContent.includes('Saved to your Library'),
            'Successful save should report confirmation'
        );
        assert(!app.elements.get('wizardSavedActions').hidden, 'Saved actions should be shown');

        app.context.switchSection('home');
        assertEqual(
            app.elements.get('homePlaylistsDisplay').children[1].children[0].textContent,
            'Generated Mix',
            'Home should display the saved generated playlist'
        );
        app.context.switchSection('library');
        assertEqual(
            app.elements.get('libraryDisplay').children[1].children[0].textContent,
            'Generated Mix',
            'Library should display the saved generated playlist'
        );

        const reloadedApp = createApp(async () => csvResponse(csvText), storage);
        await reloadedApp.startup();
        reloadedApp.context.switchSection('library');
        assertEqual(
            reloadedApp.elements.get('libraryDisplay').children[1].children[0].textContent,
            'Generated Mix',
            'Generated playlists should persist after app reload'
        );
    });

    await runTest('saved playlists with songs missing from the dataset still open and edit', async () => {
        const csvText = fs.readFileSync(path.join(__dirname, '..', 'data', 'songs_deduped.csv'), 'utf8');
        const sourceTree = new DSA.BTree();
        DSA.loadSongsFromCSV(csvText, sourceTree);
        const realSong = sourceTree.inorderTraversal()[0];
        const storage = createMemoryStorage();
        storage.setItem('genmixSavedPlaylists', JSON.stringify([{
            id: 'legacy',
            name: 'Legacy Mix',
            createdAt: '2026-01-01T00:00:00.000Z',
            songs: [
                { ...realSong },
                { track_id: 'removed-from-dataset', title: 'Old Song', artist: 'Old Artist' },
                null
            ]
        }]));
        const app = createApp(async () => csvResponse(csvText), storage);
        await app.startup();

        assert(app.context.openPlaylistDetail('legacy'), 'A playlist with missing songs should still open');
        const rows = app.elements.get('playlistDetailSongs').children;
        assertEqual(rows.length, 3, 'Every saved entry should still render as a row');
        assert(!rows[0].classList.contains('playlist-song-missing'), 'A catalog song should not be flagged');
        assert(rows[1].classList.contains('playlist-song-missing'), 'A song absent from the dataset should be flagged');
        assert(rows[2].classList.contains('playlist-song-missing'), 'A malformed entry should be flagged, not crash');
        assert(
            app.elements.get('playlistDetailCount').textContent.includes('2 not in the current song catalog'),
            'The header should report how many songs are missing'
        );

        assert(app.context.removeSongFromOpenPlaylist(1), 'Missing songs should remain removable');
        const saved = JSON.parse(storage.getItem('genmixSavedPlaylists'))[0];
        assertEqual(saved.songs.length, 2, 'The removal should persist');
        assertEqual(saved.songs[0].track_id, realSong.track_id, 'Remaining songs should keep their order');
    });

    await runTest('Library playlists can be deleted from a card or the detail view and stay deleted', async () => {
        const csvText = fs.readFileSync(path.join(__dirname, '..', 'data', 'songs_deduped.csv'), 'utf8');
        const sourceTree = new DSA.BTree();
        DSA.loadSongsFromCSV(csvText, sourceTree);
        const [songA, songB] = sourceTree.inorderTraversal();
        const storage = createMemoryStorage();
        const makePlaylist = (id, name) => ({
            id,
            name,
            createdAt: '2026-01-01T00:00:00.000Z',
            songs: [{ ...songA }, { ...songB }]
        });
        storage.setItem('genmixSavedPlaylists', JSON.stringify([
            makePlaylist('keep', 'Keep Me'),
            makePlaylist('card', 'Delete From Card'),
            makePlaylist('detail', 'Delete From Detail')
        ]));
        const app = createApp(async () => csvResponse(csvText), storage);
        await app.startup();
        const savedIds = () => JSON.parse(storage.getItem('genmixSavedPlaylists')).map((saved) => saved.id);

        app.context.switchSection('library');
        const findCard = (name) => app.elements.get('libraryDisplay').children.find((card) => {
            return card.children[0].textContent === name;
        });
        const card = findCard('Delete From Card');
        const deleteButton = card.children.find((child) => child.textContent === 'Delete');
        const confirmation = card.children.find((child) => child.className.includes('saved-playlist-confirm'));
        assert(deleteButton && confirmation, 'Library cards should offer Delete with a confirmation');
        assert(confirmation.hidden, 'The confirmation should start hidden');

        deleteButton.click();
        assert(!confirmation.hidden && deleteButton.hidden, 'Delete should ask for confirmation first');
        confirmation.children[2].click();
        assert(confirmation.hidden && !deleteButton.hidden, 'Cancel should close the confirmation');
        assertEqual(savedIds(), ['keep', 'card', 'detail'], 'Cancel must not delete anything');

        deleteButton.click();
        confirmation.children[1].click();
        assertEqual(savedIds(), ['keep', 'detail'], 'Confirming should delete only that playlist');
        assert(!findCard('Delete From Card'), 'The deleted card should leave the Library');
        assert(findCard('Keep Me') && findCard('Delete From Detail'), 'Other cards should remain');

        assert(app.context.openPlaylistDetail('detail'), 'The detail view should open');
        assert(app.context.removeSongFromOpenPlaylist(0), 'A song removal should offer undo');
        assert(!app.elements.get('undoToast').hidden, 'The undo toast should be visible');
        app.elements.get('playlistDeleteButton').click();
        assert(!app.elements.get('playlistDeleteConfirmation').hidden, 'Detail delete should ask for confirmation');
        app.elements.get('playlistDeleteConfirm').click();
        assertEqual(savedIds(), ['keep'], 'Confirming in the detail view should delete the open playlist');
        assertEqual(app.evaluate('activeSection'), 'library', 'Deleting the open playlist should return to the Library');
        assertEqual(app.evaluate('openPlaylistId'), null, 'No deleted playlist should stay open');
        assert(app.elements.get('undoToast').hidden, 'A pending undo for the deleted playlist should be dismissed');
        assertEqual(app.evaluate('pendingUndo'), null, 'The stale undo should be cleared');
        assert(!app.context.openPlaylistDetail('detail'), 'A deleted playlist should not reopen');

        const reloadedApp = createApp(async () => csvResponse(csvText), storage);
        await reloadedApp.startup();
        reloadedApp.context.switchSection('library');
        const reloadedNames = reloadedApp.elements.get('libraryDisplay').children.map((saved) => saved.children[0].textContent);
        assertEqual(reloadedNames, ['Keep Me'], 'Deletions should persist across a reload');
        assertEqual(
            reloadedApp.elements.get('homePlaylistsDisplay').children.map((saved) => saved.children[0].textContent),
            ['Keep Me'],
            'Home should also stop listing deleted playlists'
        );
    });

    await runTest('Delete discards results and empty or failed generation is recoverable', async () => {
        const csvText = fs.readFileSync(path.join(__dirname, '..', 'data', 'songs_deduped.csv'), 'utf8');
        const storage = createMemoryStorage();
        const app = createApp(async () => csvResponse(csvText), storage);
        await app.startup();
        enterWizardWithName(app, 'Temporary');
        app.elements.get('wizardMoodMethod').click();
        const moodInput = app.elements.get('wizardMoodOptions').children[0].children[0];
        moodInput.checked = true;
        moodInput.listeners.get('change')();
        app.context.window.playlistGenerator.generateFromMood = () => ({
            type: 'mood',
            songs: [],
            requested: 20,
            message: 'No songs matched this mood.'
        });
        await app.elements.get('wizardMoodGenerate').click();
        assertEqual(app.evaluate('wizardState.step'), 'result', 'An empty result should leave loading');
        assert(!app.elements.get('wizardEmptyResultActions').hidden, 'Empty result should offer Back and Try again');
        assert(app.elements.get('wizardResultActions').hidden, 'Empty result must not offer Save or Delete');
        assertEqual(storage.getItem('genmixSavedPlaylists'), null, 'An empty result must not be persisted');
        await app.elements.get('wizardEmptyTryAgain').click();
        assertEqual(app.evaluate('wizardState.step'), 'result', 'Retry should be recoverable for empty results');

        enterWizardWithName(app, 'Discard Me');
        app.elements.get('wizardSongMethod').click();
        const song = app.evaluate(
            'songCatalog.inorderTraversal().find((candidate) => songGraph.hasNode(candidate.track_id))'
        );
        const searchInput = app.elements.get('wizardSongSearch');
        searchInput.value = song.title;
        searchInput.listeners.get('input')({ target: searchInput });
        app.elements.get('wizardSongResults').children[0].click();
        const originalSeedGenerator = app.context.window.playlistGenerator.generateFromSeed;
        app.context.window.playlistGenerator.generateFromSeed = () => {
            throw new Error('synthetic generator failure');
        };
        await app.elements.get('wizardSongGenerate').click();
        assertEqual(app.evaluate('wizardState.step'), 'error', 'Thrown generator errors should leave loading');
        assert(!app.elements.get('wizardRetryButton').hidden, 'Error state should provide a retry action');
        assert(
            app.loggedErrors.some((message) => message.includes('synthetic generator failure')),
            'Generation errors should be logged for diagnosis'
        );
        app.context.window.playlistGenerator.generateFromSeed = originalSeedGenerator;
        await app.elements.get('wizardRetryButton').click();
        assertEqual(app.evaluate('wizardState.step'), 'result', 'Retry should recover from a generator error');

        const homeCardCount = app.elements.get('homePlaylistsDisplay').children.length;
        app.context.switchSection('library');
        const libraryCardCount = app.elements.get('libraryDisplay').children.length;
        app.context.switchSection('generator');
        enterWizardWithName(app, 'Discard Me Again');
        assertEqual(app.evaluate('wizardState.step'), 'method', 'A second attempt should start cleanly');
        app.context.cancelPlaylistWizard();
        assertEqual(app.elements.get('homePlaylistsDisplay').children.length, homeCardCount, 'Cancel should not change Home');
        assertEqual(app.elements.get('libraryDisplay').children.length, libraryCardCount, 'Cancel should not change Library');
        enterWizardWithName(app, 'Discard Me');
        app.elements.get('wizardSongMethod').click();
        const retrySearchInput = app.elements.get('wizardSongSearch');
        retrySearchInput.value = song.title;
        retrySearchInput.listeners.get('input')({ target: retrySearchInput });
        app.elements.get('wizardSongResults').children[0].click();
        await app.elements.get('wizardSongGenerate').click();

        app.elements.get('wizardDeleteButton').click();
        assert(
            !app.elements.get('wizardDeleteConfirmation').hidden,
            'Delete should show inline confirmation before discarding'
        );
        app.elements.get('wizardDeleteKeep').click();
        assertEqual(app.evaluate('wizardState.step'), 'result', 'Choosing No should keep the generated result');
        app.elements.get('wizardDeleteButton').click();
        app.elements.get('wizardDeleteConfirm').click();
        assertEqual(app.evaluate('wizardState.step'), 'start', 'Confirmed Delete should reset the wizard');
        assertEqual(storage.getItem('genmixSavedPlaylists'), null, 'Delete must not write generated results to storage');
    });

    console.log(`\nTest summary: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error(`FAIL: app test runner — ${error.message}`);
    process.exitCode = 1;
});
