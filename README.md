# GenMix - DSA Project

A comprehensive music playlist management system demonstrating **Data Structures and Algorithms (DSA)** in a working prototype. This project showcases several structures and algorithms with practical applications.

## 📋 Project Overview

This project is a **working web application** that allows users to:
- Search and browse songs in a CSV-backed catalog
- ✅ Save named copies of the current queue in browser storage
- ✅ View saved playlists on Home and in Library
- ✅ Navigate a simulated playlist queue in a circular manner
- ✅ Get random, distinct recommendations from the loaded catalog
- ✅ Visualize DSA operations in real-time
- Generate a seed-based or mood-based playlist

## 🎯 DSA Algorithms Implemented

### 1. **B-Tree** 🌳
**Purpose:** Balanced song catalog management indexed by `track_id`

**Operations Implemented:**
- `insert(trackId, song)` - Add a unique song to the B-Tree
- `search(trackId)` - Find a song by its trimmed track ID
- `inorderTraversal()` - Return songs in ascending track ID order
- `height()` - Return the number of B-Tree levels
- `searchByTitle(query)` - Keep the existing title search using a simple traversal scan

**Use Case:** 
- Catalog songs are stored by `track_id`; the B-Tree remains balanced as it grows
- The existing partial-title search is retained as a compatibility scan
- Tree traversal is by track ID; the UI sorts displayed library and search results by title
- The catalog is loaded from `data/songs_deduped.csv` (4,428 unique songs; the loader caps input at 5,000 data rows)

**Complexity:**
- Insert and track ID lookup: O(log n) for fixed minimum degree
- Title substring search and full traversal: O(n)
- Space: O(n)

---

### Binary Search by Track ID 🔎
**Purpose:** Compare searching a sorted song array with looking up the same song in the B-Tree.

**Where It Lives:**
- `binarySearchIndexByTrackId()` and `binarySearchByTrackId()` are implemented in `src/core/dsa.js`
- `SortedSongIndex` builds one verified snapshot from `BTree.inorderTraversal()`
- `compareRetrievalMethods(trackId)` in `src/app.js` returns both results for a console demo; the UI search remains B-Tree-based

**How It Works:**
- Binary search checks the middle track ID and discards the half that cannot contain the requested ID
- The array must be sorted by `track_id` first; the index uses the B-Tree's in-order traversal, so it starts sorted and contains the same unique songs
- The B-Tree stays balanced while songs are inserted; inserting into a sorted array can require shifting many entries
- `SortedSongIndex.rebuild()` refreshes the snapshot after catalog changes; a search does not sort the array again

**Complexity:**

| Operation | Data Structure | Time | Extra Space |
|-----------|----------------|------|-------------|
| Search track ID | Sorted array (iterative binary search) | O(log n) | O(1) |
| Build array from B-Tree traversal | Sorted array | O(n) | O(n) for the snapshot |
| Build array from unsorted raw songs | Sorted array | O(n log n) | O(n) for the copy |
| Insert into a sorted array | Sorted array | O(n) due to shifting | O(1) additional |
| Search track ID | B-Tree | O(t * log_t n) | O(1) |
| Insert song | B-Tree | O(t * log_t n), O(log n) for fixed t | O(1) auxiliary |

**Example:**
```javascript
const tree = new DSA.BTree();
tree.insert('track-b', { track_id: 'track-b', title: 'Second Song' });
tree.insert('track-a', { track_id: 'track-a', title: 'First Song' });

const songIndex = new DSA.SortedSongIndex(tree);
const song = songIndex.search('track-a');
console.log(song ? song.title : 'Not found');
```

Run the B-Tree and binary search tests with:
```bash
node tests/btree.test.js
```

No timing benchmark is included by default. Any optional timing comparison should be treated as approximate: results depend on the machine, runtime, and repetition count.

---

### Song Similarity Graph 🎧
**Purpose:** Find songs with similar audio features using a directed, weighted adjacency-list graph.

**How It Works:**
- After the CSV catalog loads, `src/app.js` builds a `SongGraph` from the B-Tree's unique in-order song traversal. The existing loader, retrieval, playlist, playback, and UI search behavior are unchanged.
- CSV songs with finite numeric `danceability`, `energy`, `acousticness`, `valence`, and `tempo` values become graph nodes. Songs without these values are recorded in `skippedSongs`.
- Each feature is min-max normalized across valid songs; constant-valued features normalize to zero. Pairwise Euclidean distance across the five normalized features becomes a similarity weight: `1 - distance / sqrt(5)`.
- Each node stores up to 10 outgoing edges by default. Edges are directed: a song may choose another song without being chosen in return. Neighbors are ordered by descending similarity, then ascending `track_id`.
- `bfs(trackId, { limit })` and `dfs(trackId, { limit })` iteratively traverse reachable outgoing edges and return track IDs. Unknown starts return an empty array; `getNeighbors()` also returns an empty array for unknown IDs, while `getSong()` returns `null`.

**Example:**
```javascript
const graph = new DSA.SongGraph().buildFromSongs(songCatalog.inorderTraversal());
const neighbors = graph.getNeighbors('some-track-id');
console.log(neighbors); // [{ to: 'another-track-id', weight: 0.98 }, ...]
console.log(graph.bfs('some-track-id', { limit: 20 }));
```

**Complexity and Limitations:**
- Building the graph currently compares every valid song pair: O(n² × 5) time. Only the best `k` outgoing edges per node are retained, so graph storage is O(nk); this is suitable for the existing 5,000-row CSV load but not the full ~80,000-row dataset.
- Traversals take O(V + E) time and O(V) auxiliary space.
- The existing CSV loader converts missing or malformed numeric values to `0`. Per the chosen behavior, graph validation treats those resulting zeros as valid values; it cannot distinguish them from true zero-valued source data without changing the loader.
- Run graph tests with `node tests/graph.test.js`; run the existing B-Tree, CSV, and binary-search tests with `node tests/btree.test.js`.

---

### Smart Playlist Generator 🎼
**Purpose:** Generate a 20-song playlist from a seed track or an audio-feature mood profile.

**Logic and API:**
- `PlaylistGenerator` is implemented in `src/playlist/playlistGenerator.js`, receives the existing B-Tree catalog and SongGraph, and does not load CSV data itself.
- `generateFromSeed(trackId, options)` puts the valid seed first, collects direct graph neighbors and then expands through outgoing neighbors-of-neighbors up to `expansionDepth` (default 2). Similarity is re-calculated against the seed using `DSA.computeSimilarity`; candidates are ranked by similarity then `track_id`. It takes up to 19 and shuffles only those similar songs with Fisher-Yates.
- The local expansion is an approximation: an expanded song may not be among the seed's globally closest songs, and the bounded pool may miss better candidates. A full-catalog scan would be required for an exact global top-19.
- `generateFromMood(moodName, options)` filters graph songs using all rules in a mood profile, ranks matches by average normalized margin beyond the rule thresholds (then `track_id`), keeps the best 20, and shuffles them.
- `getMatchingSongs(moodName)` returns every valid match without shuffling; `matchesMood(song, moodName)` checks the profile. Mood keys are exported in `MOOD_NAMES`; matching accepts keys or display names case-insensitively.
- Both modes return `{ type, seed, mood, songs, requested, message }`. An optional `random` function enables repeatable shuffle tests. The generator is exposed as `window.playlistGenerator` after the CSV catalog and graph finish loading.
- The Generate page uses a multi-step wizard: name the playlist, choose Pick a Song or Pick a Mood, select a catalog seed or exported mood, then review the returned songs in their generated order.
- The wizard calls the existing `generateFromSeed(trackId)` or `generateFromMood(moodName)` method once per run. A UI-only 2.5-second loading screen shows progress messages without delaying or changing generator or DSA logic.
- Results stay temporary and do not appear on Home or in Library until **Save to Library** is chosen. Saving writes a copied song snapshot to `genmixSavedPlaylists` in the existing `{ id, name, createdAt, songs }` format. **Delete Playlist** discards only the current unsaved result.
- Leaving Generate resets the wizard. Duplicate playlist names are allowed, but the same generated result can only be saved once.

**Mood thresholds:** Rules use empirical quartiles from the first 5,000 CSV songs after the graph's min-max normalization. High thresholds are normalized P75; low thresholds are normalized P25: valence 0.677638, danceability 0.681725, energy 0.822211 (high) / 0.312949 (low), tempo 0.635812, acousticness 0.791164 (high). A song can match multiple profiles.

| Mood | Rules | Matches in first 5,000 CSV songs |
|------|-------|---------------------------------:|
| Happy / Upbeat | valence ≥ 0.677638 and danceability ≥ 0.681725 | 643 |
| Energetic | energy ≥ 0.822211 and normalized tempo ≥ 0.635812 | 413 |
| Chill | energy ≤ 0.312949 and acousticness ≥ 0.791164 | 1,012 |
| Melancholic | valence ≤ 0.217085 and energy ≤ 0.312949 | 752 |
| Acoustic | acousticness ≥ 0.791164 | 1,255 |

Run generator, UI helper, and wizard helper tests with `node tests/playlistGenerator.test.js`, `node tests/playlistUI.test.js`, and `node tests/playlistWizard.test.js`; app startup and generator integration checks use `node tests/app.test.js`. `npm test` runs every suite.

---

### 2. **Circular Queue** 🔄
**Purpose:** Playlist playback management

**Operations Implemented:**
- `enqueue()` - Add songs to playlist
- `dequeue()` - Remove songs from playlist
- `next()` - Move to next song (circular)
- `previous()` - Move to previous song (circular)
- `getCurrent()` - Get currently playing song
- `isEmpty()` - Check if queue is empty
- `clear()` - Empty the entire queue

**Use Case:**
- Playlist uses circular queue for seamless looping
- Next/Previous buttons navigate circularly through songs
- No need to restart when reaching the end of playlist

**Complexity:**
- All operations: O(1)
- Space: O(n) where n is capacity

**Special Feature:**
- Automatically handles wrapping around when reaching queue boundaries
- Tracks current song position separately from front/rear pointers

---

### 3. **Priority Queue (Max Heap)** ⭐
**Purpose:** Demonstrate priority-based song retrieval from a max heap

**Operations Implemented:**
- `insert()` - Add songs with priority based on rating
- `extractMax()` - Get highest rated song
- `getTopRecommendations(n)` - Get top N recommendations
- `heapifyUp()` - Maintain heap property when inserting
- `heapifyDown()` - Maintain heap property when extracting

**Use Case:**
- Songs are prioritized by their rating (1-10 scale)
- `getTopRecommendations(n)` returns a copy of the highest-rated songs
- Home recommendations are sampled randomly from the catalog, independently of this heap
- Efficient prioritization

**Complexity:**
- Insert: O(log n)
- ExtractMax: O(log n)
- getTopRecommendations: O(k log n) where k is number of recommendations
- Space: O(n)

---

### 4. **Heap Sort** 🔀
**Purpose:** Sort songs by rating

**Operations:**
- `heapSort()` - Sort songs by rating using heap
- Builds max heap and extracts elements in sorted order

**Use Case:**
- Demonstrates sorting songs from highest to lowest rating
- Demonstrates in-place sorting algorithm

**Complexity:**
- Time: O(n log n)
- Space: O(1) (in-place sorting)

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn package manager

### Installation

1. **Clone or download the project**
   ```bash
   cd Music\ Playlist\ Organizer
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Run the application**
   ```bash
   npm run dev
   ```

4. **Open in browser**
   - The application will automatically open at `http://localhost:3010`
   - Or manually navigate to the provided URL

   Run all standalone suites with:
   ```bash
   npm test
   ```

### Usage

#### Adding Songs to the Playlist
1. Search the existing catalog by title
2. Click a matching result to add it to the current playlist

#### Saving and Viewing Playlists
1. Add one or more songs to the queue from Search
2. On Home, enter a playlist name and choose **Save playlist**
3. Saved playlist snapshots are stored under `genmixSavedPlaylists` in this browser's localStorage
4. Home and Library display saved playlists and their song counts; generated results remain separate and unsaved

#### Generating Playlists
1. Open **Generate** from the navigation menu
2. Choose **Create Playlist**, enter a name, then select **Pick a Song** or **Pick a Mood**
3. Select a catalog seed or one of the exported moods and generate the playlist
4. Choose **Save to Library** to keep it, or **Delete Playlist** to discard it without saving

#### Exporting to YouTube
1. Complete the one-time Google Cloud and local configuration in [docs/YOUTUBE_EXPORT_SETUP.md](docs/YOUTUBE_EXPORT_SETUP.md)
2. Generate a playlist or use **Export to YouTube** on a saved-playlist card
3. Confirm the name, privacy, and estimated quota use, then authorize your own Google account
4. GenMix preserves song order, reports unmatched or failed songs, and links to the created YouTube playlist

OAuth tokens stay in memory only. Accepted song-to-video matches are cached separately in localStorage to reduce later YouTube searches.

#### Searching Songs
1. Type in the search box
2. Matching song titles from the B-Tree catalog will appear
3. Click any result to add it to the playlist

#### Using the Simulated Queue
1. Use the existing play/pause control to start or pause the queue simulation
2. Use Next or Previous to move through the circular queue
3. No real audio is played
4. Save the current queue from Home to keep a named snapshot in this browser

#### Recommendations
- Home samples up to 12 distinct songs from the cached CSV catalog index
- Refresh or revisit Home for a new sample; recommendations do not alter the catalog or queue

---

## 📊 Algorithm Visualization

The application includes **real-time visualization** of DSA operations:
- See when songs are queued and when DSA operations run
- Track search operations in the B-Tree catalog
- Monitor circular queue navigation
- Watch heap operations during shuffle

Visualizations appear in the center panel's "Algorithm Visualization" section.

---

## 🏗️ Project Structure

```
GenMix/
├── index.html                  # Main HTML structure (served from the project root)
├── css/
│   └── styles.css              # UI styling
├── src/
│   ├── app.js                  # Application logic and UI interactions
│   ├── core/
│   │   └── dsa.js              # DSA implementations (B-Tree, binary search, Circular Queue, Max Heap, SongGraph)
│   ├── playlist/
│   │   ├── playlistGenerator.js  # Seed- and mood-based playlist logic
│   │   ├── playlistWizard.js     # Pure wizard state and saved-record helpers
│   │   ├── playlistEditor.js     # Pure saved-playlist edit helpers (add, remove, rename, move, delete)
│   │   └── playlistUI.js         # Pure UI search and display helpers
│   └── integrations/
│       └── youtube/            # YouTube auth, API client, matcher, cache, exporter, and export UI
├── data/
│   ├── songs_deduped.csv       # Song catalog loaded by the app (4,428 unique songs)
│   └── songs_cleaned.csv       # Original full dataset (kept for reference)
├── tests/                      # Standalone Node.js test suites (run with npm test)
│   └── youtube/                # YouTube integration tests
├── docs/                       # Quick start, project summary, YouTube setup, and project report
├── scripts/
│   ├── generate-config.js      # Builds config.local.js from .env
│   └── convert_to_word.py      # Converts docs/PROJECT_REPORT.md to Word
├── config.local.js             # Generated, git-ignored browser configuration
├── package.json                # Project configuration and npm scripts
└── README.md                   # This file
```

---

## 💡 Key Learning Outcomes

This project demonstrates:

1. **Real-world DSA applications**
   - How data structures solve practical problems
   - Trade-offs between different algorithms

2. **Time and Space Complexity**
   - Understanding Big-O notation in action
   - Optimal algorithm selection

3. **Data Structure Integration**
   - Multiple structures working together
   - Efficient data management strategies

4. **Algorithm Visualization**
   - Visual understanding of operations
   - Debugging and comprehension aid

---

## 🎨 Features

### User Interface
- Responsive blue theme with a sliding navigation menu
- Keyboard-accessible navigation with focus states
- Subtle blue gradients and restrained glass surfaces
- Seed- and mood-based playlist generation

### Functionality
- CSV-backed catalog search and browsing
- Saved-playlist collections on Home and Library
- 🔍 Track ID lookup with B-Tree and title search compatibility scan
- 🔄 Circular queue navigation simulation (no audio playback)
- ⭐ Random catalog recommendations
- 🎬 Visual algorithm execution

---

## 🔬 Technical Details

### Data Structures Comparison

| Structure | Use Case | Insert | Search | Extract Max | Space |
|-----------|----------|--------|--------|-------------|-------|
| **B-Tree** | Song catalog | O(log n) | O(log n) by track ID | - | O(n) |
| **Circular Queue** | Playlist | O(1) | - | O(1) | O(n) |
| **Max Heap** | Recommendations | O(log n) | - | O(log n) | O(n) |

### Catalog Data
- The startup library is loaded from `data/songs_deduped.csv` (4,428 unique songs).
- If the CSV cannot be loaded or yields no usable songs, the library displays an empty-state message; no demo songs are inserted.

---

## 📝 Future Enhancements

Potential additions for extended learning:
- [ ] B-Tree deletion as a separate extension
- [ ] Connect playlist generator to future UI controls
- [ ] Hash table for O(1) artist lookup
- [ ] Trie for autocomplete search
- [ ] Merge sort comparison
- [ ] Dijkstra's algorithm for playlist generation

---

## 🎓 Educational Value

This project serves as an excellent resource for:
- **Students** learning DSA
- **Developers** understanding algorithm applications
- **Educators** demonstrating concepts visually
- **Interview preparation** for DSA questions

---

## 📄 License

MIT License - Feel free to use this project for learning and education.

---

## 👨‍💻 Author

Created as a DSA project demonstrating practical implementations of fundamental data structures and algorithms.

---

## 🙏 Acknowledgments

- Algorithms and data structures based on standard computer science textbooks
- UI inspired by modern music streaming applications
- Educational resources from various DSA courses

---

**Built with ❤️ for DSA Learning**

*"The best way to learn algorithms is to implement them in a real project!"*
