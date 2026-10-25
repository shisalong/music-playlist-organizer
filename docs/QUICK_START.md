# 🚀 Quick Start Guide

Get GenMix running in 30 seconds!

## Step 1: Install Dependencies
```bash
npm install
```

## Step 2: Run the Application
```bash
npm run dev
```

or

```bash
npm start
```

## Step 3: Open in Browser
The application will automatically open at **http://localhost:3010**

The startup catalog loads the 4,428 unique songs in `data/songs_deduped.csv`. If the file cannot be loaded or contains no usable songs, the library stays empty and displays a message; no demo songs are inserted. Run the standalone test suites with:

```bash
npm test
```

---

## 🎯 Try These Features

### 1. Search the Catalog
- Type a song title in the search box
- Click a matching result to add it to the playlist queue
- Home shows a fresh sample of 12 real catalog songs; use Refresh for another sample
- Library lists saved playlists, not catalog songs

### 2. Generate a Playlist
- Open Generate from the hamburger menu
- Choose **Create Playlist** and enter a name
- Pick a song by title/artist or select one of the exported moods
- Review the result, then save it to Library or discard it

### Save a Playlist
- Add songs to the queue from Search
- On Home, enter a name under "Save current queue" and choose "Save playlist"
- Saved playlists are stored in this browser and appear on Home and in Library

### 3. Navigate the Simulated Queue
- Use the queue controls to start or pause the playback simulation
- Use Next and Previous to navigate circularly
- No real audio is played

### 4. View Recommendations
- Browse the real-catalog sample in Home
- Refresh recommendations without changing the queue or catalog

---

## 📊 What You'll Learn

| Algorithm | What It Does | Where to See It |
|-----------|--------------|-----------------|
| **B-Tree** | Indexes songs by track ID | Load the catalog, then search |
| **Circular Queue** | Loops through playlist | Use Next/Previous buttons |
| **Max Heap** | Prioritizes songs by rating | Max Heap tests |
| **Heap Sort** | Sorts by rating | DSA implementation |
| **Song Graph** | Connects songs by audio-feature similarity | Graph tests |
| **Playlist Generator** | Builds seed-based or mood-filtered song arrays | Generator tests |

---

## 🎓 DSA Concepts Demonstrated

✅ **B-Tree**
- Insert and track ID search: O(log n) for fixed minimum degree
- In-order traversal by track ID
- Title substring search: O(n) compatibility scan

✅ **Circular Queue**
- O(1) enqueue/dequeue
- Circular navigation
- Efficient memory usage

✅ **Priority Queue (Max Heap)**
- O(log n) insert
- O(log n) extract max
- Heap property maintenance

✅ **Heap Sort**
- O(n log n) sorting
- In-place algorithm
- Stable performance

---

## 💡 Tips

- **Check the visualization panel** to see algorithms in action
- **Watch the visualizer** report data-structure operations
- **Search the catalog** to inspect B-Tree title matching
- **Test circular navigation** by playing through the playlist
- **Run the focused tests** to verify the data-structure implementations

---

## 🎨 Features to Explore

- Responsive blue design and a sliding accessible menu
- Fast search and data-structure operations
- Circular queue navigation simulation
- Smart recommendations and playlist generation

---

**Enjoy exploring DSA in action!** 🎉
