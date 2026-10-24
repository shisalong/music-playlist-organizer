# 🎵 Music Playlist Organizer - DSA Project

A comprehensive music playlist management system demonstrating **Data Structures and Algorithms (DSA)** in a working prototype. This project showcases three fundamental data structures with practical applications.

## 📋 Project Overview

This project is a **working web application** that allows users to:
- ✅ Add and search songs in a catalog
- ✅ Create and manage playlists
- ✅ Play, pause, skip songs in a circular manner
- ✅ Get personalized recommendations
- ✅ Visualize DSA operations in real-time

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
- The supplied `songs_cleaned.csv` file is loaded from the project root, up to the first 5,000 data rows

**Complexity:**
- Insert and track ID lookup: O(log n) for fixed minimum degree
- Title substring search and full traversal: O(n)
- Space: O(n)

---

### Binary Search by Track ID 🔎
**Purpose:** Compare searching a sorted song array with looking up the same song in the B-Tree.

**Where It Lives:**
- `binarySearchIndexByTrackId()` and `binarySearchByTrackId()` are implemented in `dsa.js`
- `SortedSongIndex` builds one verified snapshot from `BTree.inorderTraversal()`
- `compareRetrievalMethods(trackId)` in `app.js` returns both results for a console demo; the UI search remains B-Tree-based

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
node btree.test.js
```

No timing benchmark is included by default. Any optional timing comparison should be treated as approximate: results depend on the machine, runtime, and repetition count.

---

### Song Similarity Graph 🎧
**Purpose:** Find songs with similar audio features using a directed, weighted adjacency-list graph.

**How It Works:**
- After the CSV catalog loads, `app.js` builds a `SongGraph` from the B-Tree's unique in-order song traversal. The existing loader, retrieval, playlist, playback, and UI search behavior are unchanged.
- Songs with finite numeric `danceability`, `energy`, `acousticness`, `valence`, and `tempo` values become graph nodes. Songs without these values (including the seven sample songs) are recorded in `skippedSongs`.
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
- Run graph tests with `node graph.test.js`; run the existing B-Tree, CSV, and binary-search tests with `node btree.test.js`.

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
**Purpose:** Generate top-rated song recommendations

**Operations Implemented:**
- `insert()` - Add songs with priority based on rating
- `extractMax()` - Get highest rated song
- `getTopRecommendations(n)` - Get top N recommendations
- `heapifyUp()` - Maintain heap property when inserting
- `heapifyDown()` - Maintain heap property when extracting

**Use Case:**
- Songs are prioritized by their rating (1-10 scale)
- Recommendations always show highest-rated songs first
- Efficient sorting and prioritization

**Complexity:**
- Insert: O(log n)
- ExtractMax: O(log n)
- getTopRecommendations: O(k log n) where k is number of recommendations
- Space: O(n)

---

### 4. **Heap Sort** 🔀
**Purpose:** Shuffle playlist by rating

**Operations:**
- `heapSort()` - Sort songs by rating using heap
- Builds max heap and extracts elements in sorted order

**Use Case:**
- Shuffle feature organizes songs from highest to lowest rating
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
   - The application will automatically open at `http://localhost:3000`
   - Or manually navigate to the provided URL

   Run the standalone B-Tree and CSV tests with:
   ```bash
   node btree.test.js
   ```

### Usage

#### Adding Songs
1. Fill in the song details:
   - Song Title
   - Artist Name
   - Duration (in seconds)
   - Rating (1-10 scale)
2. Click "Add Song"
3. The song is automatically added to:
   - Song catalog (B-Tree)
   - Current playlist (Circular Queue)
   - Recommendations (Max Heap)

#### Searching Songs
1. Type in the search box
2. Matching song titles from the B-Tree catalog will appear
3. Click any result to add it to the playlist

#### Managing Playlist
1. **Shuffle**: Click "Shuffle" to sort playlist by rating using heap sort
2. **Clear**: Remove all songs from playlist
3. View visualizations in the algorithm panel

#### Playing Songs
1. Click ▶️ to start/pause playback
2. Click ⏭️ to play next song (circular)
3. Click ⏮️ to play previous song (circular)

#### Recommendations
- Top 5 highest-rated songs automatically displayed
- Updates when new songs are added

---

## 📊 Algorithm Visualization

The application includes **real-time visualization** of DSA operations:
- See when songs are added to different structures
- Track search operations in the B-Tree catalog
- Monitor circular queue navigation
- Watch heap operations during shuffle

Visualizations appear in the center panel's "Algorithm Visualization" section.

---

## 🏗️ Project Structure

```
Music Playlist Organizer/
├── index.html          # Main HTML structure
├── styles.css          # Modern UI styling
├── dsa.js             # DSA implementations (B-Tree, Queue, Heap)
├── app.js             # Application logic and UI interactions
├── songs_cleaned.csv  # Song catalog dataset (first 5,000 rows loaded)
├── btree.test.js      # Standalone Node.js B-Tree tests
├── package.json       # Project configuration
└── README.md          # This file
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
- 🎨 **Modern Premium Design** with gradient colors
- 📱 **Mobile-Responsive** layout
- 🌙 **Dark Theme** optimized for extended use
- ✨ **Smooth Animations** and transitions
- 📊 **Real-time Statistics** display

### Functionality
- ✅ Full CRUD operations on songs
- 🔍 Track ID lookup with B-Tree and title search compatibility scan
- 🔄 Seamless circular playback
- ⭐ Smart recommendations
- 📈 Live statistics tracking
- 🎬 Visual algorithm execution

---

## 🔬 Technical Details

### Data Structures Comparison

| Structure | Use Case | Insert | Search | Extract Max | Space |
|-----------|----------|--------|--------|-------------|-------|
| **B-Tree** | Song catalog | O(log n) | O(log n) by track ID | - | O(n) |
| **Circular Queue** | Playlist | O(1) | - | O(1) | O(n) |
| **Max Heap** | Recommendations | O(log n) | - | O(log n) | O(n) |

### Sample Songs Included
- Bohemian Rhapsody - Queen (Rating: 10)
- Hotel California - Eagles (Rating: 9)
- Stairway to Heaven - Led Zeppelin (Rating: 10)
- Imagine - John Lennon (Rating: 8)
- Billie Jean - Michael Jackson (Rating: 9)
- Like a Rolling Stone - Bob Dylan (Rating: 8)
- Smells Like Teen Spirit - Nirvana (Rating: 9)

---

## 📝 Future Enhancements

Potential additions for extended learning:
- [ ] B-Tree deletion as a separate extension
- [ ] Graph algorithms for music recommendation engine
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
