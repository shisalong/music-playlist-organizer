# 🚀 Quick Start Guide

Get your Music Playlist Organizer running in 30 seconds!

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
The application will automatically open at **http://localhost:3000**

The catalog loads up to the first 5,000 data rows from `songs_cleaned.csv` in the project root. Run the standalone data-structure tests with:

```bash
node btree.test.js
```

---

## 🎯 Try These Features

### 1. Add a Song
- Enter song details in the left panel
- Click "Add Song"
- Watch the visualization update!

### 2. Search Songs
- Type in the search box
- See the B-Tree catalog's title-search compatibility scan
- Click results to add to playlist

### 3. Play Music
- Click ▶️ to play
- Use ⏭️ / ⏮️ to navigate circularly
- See circular queue operations

### 4. Shuffle Playlist
- Click "Shuffle" button
- Watch heap sort organize songs by rating

### 5. View Recommendations
- Check the right panel
- See top-rated songs from Max Heap

---

## 📊 What You'll Learn

| Algorithm | What It Does | Where to See It |
|-----------|--------------|-----------------|
| **B-Tree** | Indexes songs by track ID | Load the catalog, then search |
| **Circular Queue** | Loops through playlist | Use Next/Previous buttons |
| **Max Heap** | Prioritizes by rating | Recommendations panel |
| **Heap Sort** | Sorts by rating | Shuffle button |

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
- **Watch statistics** update in real-time
- **Try loading the catalog** to see B-Tree height change
- **Test circular navigation** by playing through the playlist
- **Shuffle multiple times** to see consistent sorting

---

## 🎨 Features to Explore

- 📱 Responsive design (try resizing your browser!)
- 🎨 Modern UI with animations
- ⚡ Fast search and operations
- 📊 Real-time statistics
- 🔄 Seamless circular playback
- ⭐ Smart recommendations

---

**Enjoy exploring DSA in action!** 🎉
