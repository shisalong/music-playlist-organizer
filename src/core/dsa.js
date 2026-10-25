// ============================================
// DSA IMPLEMENTATIONS FOR MUSIC PLAYLIST ORGANIZER
// ============================================

// ============================================
// 1. B-TREE FOR SONG CATALOG
// ============================================
class BTreeNode {
    // Create a node that stores sorted key-song entries and child links.
    constructor(isLeaf = true) {
        this.isLeaf = isLeaf;
        this.entries = [];
        this.children = [];
    }
}

class BTree {
    // Start with an empty root and the selected minimum degree.
    constructor(t = 3) {
        if (!Number.isInteger(t) || t < 2) {
            throw new RangeError('B-Tree minimum degree must be an integer of at least 2');
        }

        this.t = t;
        this.root = new BTreeNode(true);
        this.size = 0;
        this.duplicateCount = 0;
    }

    // Compare track IDs as strings in one consistent place.
    compareKeys(firstKey, secondKey) {
        if (firstKey < secondKey) {
            return -1;
        }
        if (firstKey > secondKey) {
            return 1;
        }
        return 0;
    }

    // Insert a song once; split a full root before descending into it.
    insert(trackId, song) {
        const key = String(trackId === null || trackId === undefined ? '' : trackId).trim();
        if (key === '') {
            throw new TypeError('A non-empty track_id is required');
        }
        if (!song || typeof song !== 'object') {
            throw new TypeError('A song object is required');
        }

        if (this.contains(key)) {
            this.duplicateCount++;
            return false;
        }

        if (this.root.entries.length === 2 * this.t - 1) {
            const newRoot = new BTreeNode(false);
            newRoot.children.push(this.root);
            this.splitChild(newRoot, 0);
            this.root = newRoot;
        }

        this.insertNonFull(this.root, key, song);
        this.size++;
        return true;
    }

    // Split a full child and move its middle entry into its parent.
    splitChild(parentNode, childIndex) {
        const fullChild = parentNode.children[childIndex];
        const rightChild = new BTreeNode(fullChild.isLeaf);
        const medianEntry = fullChild.entries[this.t - 1];

        rightChild.entries = fullChild.entries.splice(this.t);
        fullChild.entries.splice(this.t - 1, 1);

        if (!fullChild.isLeaf) {
            rightChild.children = fullChild.children.splice(this.t);
        }

        parentNode.entries.splice(childIndex, 0, medianEntry);
        parentNode.children.splice(childIndex + 1, 0, rightChild);
    }

    // Add a key to a node that is known to have room.
    insertNonFull(node, key, value) {
        let entryIndex = node.entries.length - 1;

        if (node.isLeaf) {
            while (
                entryIndex >= 0 &&
                this.compareKeys(key, node.entries[entryIndex].key) < 0
            ) {
                entryIndex--;
            }
            node.entries.splice(entryIndex + 1, 0, { key, value });
            return;
        }

        while (
            entryIndex >= 0 &&
            this.compareKeys(key, node.entries[entryIndex].key) < 0
        ) {
            entryIndex--;
        }
        entryIndex++;

        if (node.children[entryIndex].entries.length === 2 * this.t - 1) {
            this.splitChild(node, entryIndex);
            if (this.compareKeys(key, node.entries[entryIndex].key) > 0) {
                entryIndex++;
            }
        }

        this.insertNonFull(node.children[entryIndex], key, value);
    }

    // Find a song by its trimmed track ID, or return null when it is absent.
    search(trackId) {
        const key = String(trackId === null || trackId === undefined ? '' : trackId).trim();
        if (key === '') {
            return null;
        }

        let node = this.root;
        while (node) {
            let entryIndex = 0;
            while (
                entryIndex < node.entries.length &&
                this.compareKeys(key, node.entries[entryIndex].key) > 0
            ) {
                entryIndex++;
            }

            if (
                entryIndex < node.entries.length &&
                this.compareKeys(key, node.entries[entryIndex].key) === 0
            ) {
                return node.entries[entryIndex].value;
            }
            if (node.isLeaf) {
                return null;
            }
            node = node.children[entryIndex];
        }

        return null;
    }

    // Return every song in ascending track_id order.
    inorderTraversal() {
        const songs = [];
        const visit = (node) => {
            for (let index = 0; index < node.entries.length; index++) {
                if (!node.isLeaf) {
                    visit(node.children[index]);
                }
                songs.push(node.entries[index].value);
            }
            if (!node.isLeaf) {
                visit(node.children[node.entries.length]);
            }
        };

        if (this.size > 0) {
            visit(this.root);
        }
        return songs;
    }

    // Keep the old catalog traversal name available to existing callers.
    getAllSongs() {
        return this.inorderTraversal();
    }

    // Check whether a trimmed track ID is present in the tree.
    contains(trackId) {
        return this.search(trackId) !== null;
    }

    // Return the number of B-Tree levels, using zero for an empty tree.
    height() {
        if (this.size === 0) {
            return 0;
        }

        let levels = 1;
        let node = this.root;
        while (!node.isLeaf) {
            levels++;
            node = node.children[0];
        }
        return levels;
    }

    // Keep the old statistics method name available to existing callers.
    getHeight() {
        return this.height();
    }

    // Preserve title search with a simple scan because the tree is keyed by track_id.
    searchByTitle(query) {
        const normalizedQuery = String(query).toLowerCase();
        return this.inorderTraversal().filter((song) => {
            return String(song.title || '').toLowerCase().includes(normalizedQuery);
        });
    }

    // Check key order, node limits, child counts, leaf depth, and total size.
    validate() {
        if (this.size === 0) {
            return this.root.entries.length === 0 &&
                this.root.isLeaf &&
                this.root.children.length === 0;
        }

        let leafDepth = null;
        let countedEntries = 0;
        const minimumKeys = this.t - 1;
        const maximumKeys = 2 * this.t - 1;

        const checkNode = (node, isRoot, depth, lowerBound, upperBound) => {
            const keyCount = node.entries.length;
            if (keyCount > maximumKeys) {
                return false;
            }
            if (isRoot ? keyCount < 1 : keyCount < minimumKeys) {
                return false;
            }

            for (let index = 0; index < keyCount; index++) {
                const key = node.entries[index].key;
                if (
                    index > 0 &&
                    this.compareKeys(node.entries[index - 1].key, key) >= 0
                ) {
                    return false;
                }
                if (
                    (lowerBound !== null && this.compareKeys(key, lowerBound) <= 0) ||
                    (upperBound !== null && this.compareKeys(key, upperBound) >= 0)
                ) {
                    return false;
                }
            }

            countedEntries += keyCount;
            if (node.isLeaf) {
                if (node.children.length !== 0) {
                    return false;
                }
                if (leafDepth === null) {
                    leafDepth = depth;
                }
                return leafDepth === depth;
            }

            if (node.children.length !== keyCount + 1) {
                return false;
            }

            for (let index = 0; index < node.children.length; index++) {
                const childLowerBound = index === 0
                    ? lowerBound
                    : node.entries[index - 1].key;
                const childUpperBound = index === keyCount
                    ? upperBound
                    : node.entries[index].key;
                if (
                    !checkNode(
                        node.children[index],
                        false,
                        depth + 1,
                        childLowerBound,
                        childUpperBound
                    )
                ) {
                    return false;
                }
            }
            return true;
        };

        return checkNode(this.root, true, 0, null, null) &&
            countedEntries === this.size;
    }
}

// Compare trimmed track IDs with the same string ordering used by the B-Tree.
function compareTrackIds(firstTrackId, secondTrackId) {
    const firstKey = String(firstTrackId === null || firstTrackId === undefined ? '' : firstTrackId).trim();
    const secondKey = String(secondTrackId === null || secondTrackId === undefined ? '' : secondTrackId).trim();
    if (firstKey < secondKey) {
        return -1;
    }
    if (firstKey > secondKey) {
        return 1;
    }
    return 0;
}

// Return the matching array position using iterative binary search in O(log n) time.
function binarySearchIndexByTrackId(sortedSongs, trackId) {
    if (!Array.isArray(sortedSongs) || sortedSongs.length === 0) {
        return -1;
    }

    const key = String(trackId === null || trackId === undefined ? '' : trackId).trim();
    if (key === '') {
        return -1;
    }

    let low = 0;
    let high = sortedSongs.length - 1;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const comparison = compareTrackIds(sortedSongs[mid].track_id, key);
        if (comparison === 0) {
            return mid;
        }
        if (comparison < 0) {
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    return -1;
}

// Return a song from a sorted array, using O(log n) comparisons and O(1) extra space.
function binarySearchByTrackId(sortedSongs, trackId) {
    const index = binarySearchIndexByTrackId(sortedSongs, trackId);
    return index === -1 ? null : sortedSongs[index];
}

// Check in O(n) time whether track IDs appear in non-decreasing order.
function isSortedByTrackId(songs) {
    if (!Array.isArray(songs)) {
        return false;
    }

    for (let index = 1; index < songs.length; index++) {
        if (compareTrackIds(songs[index - 1].track_id, songs[index].track_id) > 0) {
            return false;
        }
    }
    return true;
}

// Make and sort a copy of the songs in O(n log n) time without changing the input.
function buildSortedSongArray(songs) {
    if (!Array.isArray(songs)) {
        throw new TypeError('Songs must be provided as an array');
    }
    return songs.slice().sort((firstSong, secondSong) => {
        return compareTrackIds(firstSong.track_id, secondSong.track_id);
    });
}

class SortedSongIndex {
    // Build one sorted snapshot from the B-Tree's unique in-order traversal.
    constructor(tree) {
        if (!tree || typeof tree.inorderTraversal !== 'function') {
            throw new TypeError('A B-Tree with inorderTraversal() is required');
        }
        this.tree = tree;
        this.songs = [];
        this.rebuild();
    }

    // Refresh the O(n) snapshot after catalog changes and confirm its precondition.
    rebuild() {
        this.songs = this.tree.inorderTraversal();
        if (!isSortedByTrackId(this.songs)) {
            throw new Error('B-Tree traversal is not sorted by track_id');
        }
    }

    // Search the existing sorted snapshot in O(log n) without re-sorting it.
    search(trackId) {
        return binarySearchByTrackId(this.songs, trackId);
    }
}

const SONG_LIMIT = 5000;

// Parse CSV records while respecting quoted commas and escaped quote marks.
function parseCSVRows(csvText) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let index = 0; index < csvText.length; index++) {
        const character = csvText[index];

        if (character === '"') {
            if (inQuotes && csvText[index + 1] === '"') {
                field += '"';
                index++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (character === ',' && !inQuotes) {
            row.push(field);
            field = '';
        } else if ((character === '\n' || character === '\r') && !inQuotes) {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
            if (character === '\r' && csvText[index + 1] === '\n') {
                index++;
            }
        } else {
            field += character;
        }
    }

    if (inQuotes) {
        throw new Error('CSV contains an unclosed quoted field');
    }
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

// Load up to SONG_LIMIT data rows, keeping the first song for each track_id.
function loadSongsFromCSV(csvText, tree, limit = SONG_LIMIT) {
    const startedAt = Date.now();
    const rows = parseCSVRows(csvText);
    const header = rows.shift();
    if (!header) {
        throw new Error('CSV is empty and has no header row');
    }

    const columnIndexes = {};
    header.forEach((column, index) => {
        columnIndexes[column.trim()] = index;
    });
    const requiredColumns = [
        'track_id',
        'track_name',
        'artists',
        'track_genre',
        'danceability',
        'energy',
        'acousticness',
        'valence',
        'tempo'
    ];
    const missingColumns = requiredColumns.filter((column) => {
        return columnIndexes[column] === undefined;
    });
    if (missingColumns.length > 0) {
        throw new Error(`CSV is missing required columns: ${missingColumns.join(', ')}`);
    }

    const stats = {
        rowsRead: 0,
        songsInserted: 0,
        duplicatesSkipped: 0,
        skippedRows: 0,
        treeHeight: 0,
        loadTimeMs: 0
    };
    const duplicateCountBefore = tree.duplicateCount;

    for (const row of rows) {
        const isBlankRow = row.every((value) => value.trim() === '');
        if (isBlankRow) {
            continue;
        }
        if (stats.rowsRead >= limit) {
            break;
        }
        stats.rowsRead++;

        const trackId = row[columnIndexes.track_id];
        if (trackId === undefined || trackId.trim() === '') {
            stats.skippedRows++;
            continue;
        }

        const getValue = (column) => {
            return (row[columnIndexes[column]] || '').trim();
        };
        const getNumber = (column) => {
            const parsed = parseFloat(getValue(column));
            return Number.isNaN(parsed) ? 0 : parsed;
        };
        const song = {
            id: trackId.trim(),
            track_id: trackId.trim(),
            title: getValue('track_name'),
            artist: getValue('artists'),
            duration: 0,
            rating: 0,
            track_name: getValue('track_name'),
            artists: getValue('artists'),
            track_genre: getValue('track_genre'),
            danceability: getNumber('danceability'),
            energy: getNumber('energy'),
            acousticness: getNumber('acousticness'),
            valence: getNumber('valence'),
            tempo: getNumber('tempo')
        };

        if (tree.insert(song.track_id, song)) {
            stats.songsInserted++;
        }
    }

    stats.duplicatesSkipped = tree.duplicateCount - duplicateCountBefore;
    stats.treeHeight = tree.height();
    stats.loadTimeMs = Date.now() - startedAt;
    console.log(
        `CSV load: rows read ${stats.rowsRead}, songs inserted ${stats.songsInserted}, ` +
        `duplicates skipped ${stats.duplicatesSkipped}, invalid rows skipped ${stats.skippedRows}, ` +
        `tree height ${stats.treeHeight}, load time ${stats.loadTimeMs} ms`
    );
    return stats;
}

// ============================================
// 2. CIRCULAR QUEUE FOR PLAYLIST PLAYBACK
// ============================================
class CircularQueue {
    constructor(capacity = 100) {
        this.capacity = capacity;
        this.queue = new Array(capacity);
        this.front = 0;
        this.rear = -1;
        this.size = 0;
        this.currentIndex = -1; // Track currently playing song
    }

    // Add song to queue
    enqueue(song) {
        if (this.isFull()) {
            throw new Error('Queue is full');
        }
        
        this.rear = (this.rear + 1) % this.capacity;
        this.queue[this.rear] = song;
        this.size++;
        
        // If this is the first song, set it as current
        if (this.currentIndex === -1) {
            this.currentIndex = this.rear;
        }
    }

    // Remove song from queue
    dequeue() {
        if (this.isEmpty()) {
            throw new Error('Queue is empty');
        }
        
        const song = this.queue[this.front];
        this.queue[this.front] = null;
        this.front = (this.front + 1) % this.capacity;
        this.size--;
        
        return song;
    }

    // Get current song
    getCurrent() {
        if (this.isEmpty()) {
            return null;
        }
        return this.queue[this.currentIndex];
    }

    // Move to next song (circular)
    next() {
        if (this.isEmpty()) {
            return null;
        }
        
        this.currentIndex = (this.currentIndex + 1) % this.capacity;
        
        // Skip to next non-null element
        while (this.queue[this.currentIndex] === null && this.size > 0) {
            this.currentIndex = (this.currentIndex + 1) % this.capacity;
        }
        
        return this.queue[this.currentIndex];
    }

    // Move to previous song (circular)
    previous() {
        if (this.isEmpty()) {
            return null;
        }
        
        this.currentIndex = (this.currentIndex - 1 + this.capacity) % this.capacity;
        
        // Skip to previous non-null element
        while (this.queue[this.currentIndex] === null && this.size > 0) {
            this.currentIndex = (this.currentIndex - 1 + this.capacity) % this.capacity;
        }
        
        return this.queue[this.currentIndex];
    }

    // Check if queue is empty
    isEmpty() {
        return this.size === 0;
    }

    // Check if queue is full
    isFull() {
        return this.size === this.capacity;
    }

    // Get all songs in queue
    getAllSongs() {
        const songs = [];
        for (let i = 0; i < this.capacity; i++) {
            if (this.queue[i] !== null && this.queue[i] !== undefined) {
                songs.push({
                    song: this.queue[i],
                    index: i,
                    isCurrent: i === this.currentIndex
                });
            }
        }
        return songs;
    }

    // Clear the queue
    clear() {
        this.queue = new Array(this.capacity);
        this.front = 0;
        this.rear = -1;
        this.size = 0;
        this.currentIndex = -1;
    }

    // Visualize queue structure
    visualize() {
        const visualization = [];
        visualization.push('Circular Queue Structure:');
        visualization.push(`Front: ${this.front}, Rear: ${this.rear}, Size: ${this.size}`);
        visualization.push(`Current Index: ${this.currentIndex}`);
        
        const songs = this.getAllSongs();
        if (songs.length === 0) {
            visualization.push('Queue is empty');
        } else {
            songs.forEach(({ song, index, isCurrent }) => {
                const marker = isCurrent ? '▶ ' : '  ';
                visualization.push(`${marker}[${index}] ${song.title} - ${song.artist}`);
            });
        }
        
        return visualization;
    }
}

// ============================================
// 3. PRIORITY QUEUE (HEAP) FOR RECOMMENDATIONS
// ============================================
class MaxHeap {
    constructor() {
        this.heap = [];
    }

    // Get parent index
    getParentIndex(index) {
        return Math.floor((index - 1) / 2);
    }

    // Get left child index
    getLeftChildIndex(index) {
        return 2 * index + 1;
    }

    // Get right child index
    getRightChildIndex(index) {
        return 2 * index + 2;
    }

    // Swap two elements
    swap(i, j) {
        [this.heap[i], this.heap[j]] = [this.heap[j], this.heap[i]];
    }

    // Insert a song into heap (priority based on rating)
    insert(song) {
        this.heap.push(song);
        this.heapifyUp();
    }

    // Heapify up to maintain heap property
    heapifyUp() {
        let index = this.heap.length - 1;
        
        while (index > 0) {
            const parentIndex = this.getParentIndex(index);
            
            if (this.heap[parentIndex].rating >= this.heap[index].rating) {
                break;
            }
            
            this.swap(parentIndex, index);
            index = parentIndex;
        }
    }

    // Extract max (get highest rated song)
    extractMax() {
        if (this.heap.length === 0) {
            return null;
        }
        
        if (this.heap.length === 1) {
            return this.heap.pop();
        }
        
        const max = this.heap[0];
        this.heap[0] = this.heap.pop();
        this.heapifyDown();
        
        return max;
    }

    // Heapify down to maintain heap property
    heapifyDown() {
        let index = 0;
        
        while (this.getLeftChildIndex(index) < this.heap.length) {
            let largerChildIndex = this.getLeftChildIndex(index);
            const rightChildIndex = this.getRightChildIndex(index);
            
            if (rightChildIndex < this.heap.length && 
                this.heap[rightChildIndex].rating > this.heap[largerChildIndex].rating) {
                largerChildIndex = rightChildIndex;
            }
            
            if (this.heap[index].rating >= this.heap[largerChildIndex].rating) {
                break;
            }
            
            this.swap(index, largerChildIndex);
            index = largerChildIndex;
        }
    }

    // Get top N recommendations
    getTopRecommendations(n = 5) {
        const tempHeap = [...this.heap];
        const recommendations = [];
        
        while (recommendations.length < n && tempHeap.length > 0) {
            // Find max in temp heap
            let maxIndex = 0;
            for (let i = 1; i < tempHeap.length; i++) {
                if (tempHeap[i].rating > tempHeap[maxIndex].rating) {
                    maxIndex = i;
                }
            }
            recommendations.push(tempHeap[maxIndex]);
            tempHeap.splice(maxIndex, 1);
        }
        
        return recommendations;
    }

    // Visualize heap structure
    visualize() {
        if (this.heap.length === 0) {
            return ['Heap is empty'];
        }
        
        const visualization = [];
        visualization.push('Heap Structure (Priority Queue):');
        
        // Display heap as tree-like structure
        this._visualizeRecursive(0, 0, visualization);
        
        return visualization;
    }

    _visualizeRecursive(index, level, output) {
        if (index >= this.heap.length) {
            return;
        }
        
        const indent = '  '.repeat(level);
        const song = this.heap[index];
        const nodeInfo = `${indent}${level === 0 ? 'ROOT' : ''} Rating: ${song.rating} | "${song.title}"`;
        output.push(nodeInfo);
        
        const leftChild = this.getLeftChildIndex(index);
        const rightChild = this.getRightChildIndex(index);
        
        if (leftChild < this.heap.length) {
            output.push(`${indent}├─ Left:`);
            this._visualizeRecursive(leftChild, level + 1, output);
        }
        
        if (rightChild < this.heap.length) {
            output.push(`${indent}└─ Right:`);
            this._visualizeRecursive(rightChild, level + 1, output);
        }
    }
}

// ============================================
// 4. SORTING ALGORITHM - HEAP SORT (for shuffle)
// ============================================
function heapSort(songs) {
    const sorted = [...songs];
    
    // Build max heap
    const n = sorted.length;
    for (let i = Math.floor(n / 2) - 1; i >= 0; i--) {
        heapify(sorted, n, i);
    }
    
    // Extract elements from heap one by one
    for (let i = n - 1; i > 0; i--) {
        [sorted[0], sorted[i]] = [sorted[i], sorted[0]];
        heapify(sorted, i, 0);
    }
    
    return sorted;
}

function heapify(arr, n, i) {
    let largest = i;
    const left = 2 * i + 1;
    const right = 2 * i + 2;
    
    if (left < n && arr[left].rating > arr[largest].rating) {
        largest = left;
    }
    
    if (right < n && arr[right].rating > arr[largest].rating) {
        largest = right;
    }
    
    if (largest !== i) {
        [arr[i], arr[largest]] = [arr[largest], arr[i]];
        heapify(arr, n, largest);
    }
}

const SONG_FEATURES = Object.freeze(['danceability', 'energy', 'acousticness', 'valence', 'tempo']);
const NEIGHBOR_COUNT = 10;
const MAX_FEATURE_DISTANCE = Math.sqrt(SONG_FEATURES.length);

// Accept only songs with five real, finite numeric audio features.
function hasValidFeatures(song) {
    if (!song || typeof song !== 'object') {
        return false;
    }
    return SONG_FEATURES.every((feature) => {
        return typeof song[feature] === 'number' && Number.isFinite(song[feature]);
    });
}

// Return a clear reason for the first absent or invalid audio feature.
function getFeatureValidationReason(song) {
    if (!song || typeof song !== 'object') {
        return 'invalid song object';
    }
    for (const feature of SONG_FEATURES) {
        if (typeof song[feature] !== 'number' || !Number.isFinite(song[feature])) {
            return `invalid ${feature}`;
        }
    }
    return null;
}

// Measure Euclidean distance between normalized feature vectors.
function computeDistance(vectorA, vectorB) {
    if (
        !Array.isArray(vectorA) ||
        !Array.isArray(vectorB) ||
        vectorA.length !== SONG_FEATURES.length ||
        vectorB.length !== SONG_FEATURES.length ||
        vectorA.some((value) => typeof value !== 'number' || !Number.isFinite(value)) ||
        vectorB.some((value) => typeof value !== 'number' || !Number.isFinite(value))
    ) {
        throw new Error('Distance requires two finite five-feature vectors');
    }

    let squaredDistance = 0;
    for (let index = 0; index < SONG_FEATURES.length; index++) {
        const difference = vectorA[index] - vectorB[index];
        squaredDistance += difference * difference;
    }
    const distance = Math.sqrt(squaredDistance);
    if (!Number.isFinite(distance)) {
        throw new Error('Feature distance is not finite');
    }
    return distance;
}

// Turn normalized-vector distance into a score: 1 - distance / sqrt(5).
function computeSimilarityFromVectors(vectorA, vectorB) {
    const distance = computeDistance(vectorA, vectorB);
    const similarity = 1 - (distance / MAX_FEATURE_DISTANCE);
    if (!Number.isFinite(similarity) || similarity < 0 || similarity > 1) {
        throw new Error('Similarity is outside the valid range [0, 1]');
    }
    return similarity;
}

// Normalize one valid song with precomputed ranges; constant features become zero.
function normalizeSong(song, featureStats) {
    if (!hasValidFeatures(song)) {
        throw new Error(getFeatureValidationReason(song));
    }
    if (!featureStats || typeof featureStats !== 'object') {
        throw new Error('Feature normalization statistics are required');
    }

    return SONG_FEATURES.map((feature) => {
        const stats = featureStats[feature];
        if (!stats || !Number.isFinite(stats.min) || !Number.isFinite(stats.max)) {
            throw new Error(`Missing normalization statistics for ${feature}`);
        }
        if (stats.max === stats.min) {
            return 0;
        }
        return (song[feature] - stats.min) / (stats.max - stats.min);
    });
}

// Compute similarity between two songs after checking their original feature values.
function computeSimilarity(songA, songB, featureStats) {
    if (!hasValidFeatures(songA)) {
        throw new Error(`First song has ${getFeatureValidationReason(songA)}`);
    }
    if (!hasValidFeatures(songB)) {
        throw new Error(`Second song has ${getFeatureValidationReason(songB)}`);
    }
    return computeSimilarityFromVectors(
        normalizeSong(songA, featureStats),
        normalizeSong(songB, featureStats)
    );
}

class SongGraph {
    // Create an empty directed graph with the requested number of neighbours.
    constructor(k = NEIGHBOR_COUNT) {
        this.adjacencyList = new Map();
        this.songs = new Map();
        this.normalizedFeatures = new Map();
        this.featureStats = {};
        this.skippedSongs = [];
        this.k = this.validateNeighborCount(k);
    }

    // Ensure the top-k setting is a non-negative whole number.
    validateNeighborCount(k) {
        if (!Number.isInteger(k) || k < 0) {
            throw new RangeError('Neighbor count must be a non-negative integer');
        }
        return k;
    }

    // Build a directed k-nearest-neighbour graph from valid unique songs.
    buildFromSongs(songs, k = this.k) {
        if (!Array.isArray(songs)) {
            throw new TypeError('Songs must be provided as an array');
        }

        const startedAt = Date.now();
        this.k = this.validateNeighborCount(k);
        this.adjacencyList.clear();
        this.songs.clear();
        this.normalizedFeatures.clear();
        this.featureStats = {};
        this.skippedSongs = [];

        const validSongs = [];
        const seenTrackIds = new Set();
        for (const song of songs) {
            const trackId = String(
                song && song.track_id !== undefined && song.track_id !== null
                    ? song.track_id
                    : ''
            ).trim();
            if (trackId === '') {
                this.skippedSongs.push({
                    track_id: '',
                    reason: 'missing track_id'
                });
                continue;
            }
            if (seenTrackIds.has(trackId)) {
                continue;
            }
            seenTrackIds.add(trackId);

            const reason = getFeatureValidationReason(song);
            if (reason) {
                this.skippedSongs.push({ track_id: trackId, reason });
                continue;
            }
            validSongs.push({ trackId, song });
        }

        for (const feature of SONG_FEATURES) {
            let minimum = Infinity;
            let maximum = -Infinity;
            for (const item of validSongs) {
                minimum = Math.min(minimum, item.song[feature]);
                maximum = Math.max(maximum, item.song[feature]);
            }
            this.featureStats[feature] = validSongs.length === 0
                ? { min: null, max: null }
                : { min: minimum, max: maximum };
        }

        // Normalize once: without this, tempo's larger numeric scale would dominate distance.
        for (const item of validSongs) {
            this.songs.set(item.trackId, item.song);
            this.normalizedFeatures.set(
                item.trackId,
                normalizeSong(item.song, this.featureStats)
            );
            this.adjacencyList.set(item.trackId, []);
        }

        // Brute-force comparison is fine for the 5,000-song subset; 80,000 needs a faster method.
        for (const item of validSongs) {
            const bestNeighbors = [];
            if (this.k === 0) {
                continue;
            }

            for (const candidate of validSongs) {
                if (candidate.trackId === item.trackId) {
                    continue;
                }
                const weight = computeSimilarityFromVectors(
                    this.normalizedFeatures.get(item.trackId),
                    this.normalizedFeatures.get(candidate.trackId)
                );
                const edge = { to: candidate.trackId, weight };

                if (
                    bestNeighbors.length === this.k &&
                    !this.isBetterNeighbor(edge, bestNeighbors[bestNeighbors.length - 1])
                ) {
                    continue;
                }

                let insertionIndex = 0;
                while (
                    insertionIndex < bestNeighbors.length &&
                    !this.isBetterNeighbor(edge, bestNeighbors[insertionIndex])
                ) {
                    insertionIndex++;
                }
                bestNeighbors.splice(insertionIndex, 0, edge);
                if (bestNeighbors.length > this.k) {
                    bestNeighbors.pop();
                }
            }
            this.adjacencyList.set(item.trackId, bestNeighbors);
        }

        const summary = {
            songsReceived: songs.length,
            nodesBuilt: this.nodeCount(),
            skipped: this.skippedSongs.length,
            edges: this.edgeCount(),
            k: this.k,
            buildTimeMs: Date.now() - startedAt
        };
        console.log(
            `Song graph: songs received ${summary.songsReceived}, nodes built ${summary.nodesBuilt}, ` +
            `skipped ${summary.skipped}, edges ${summary.edges}, k ${summary.k}, ` +
            `build time ${summary.buildTimeMs} ms`
        );
        return this;
    }

    // Prefer higher similarity, then lower track ID, for stable top-k ordering.
    isBetterNeighbor(firstEdge, secondEdge) {
        if (firstEdge.weight !== secondEdge.weight) {
            return firstEdge.weight > secondEdge.weight;
        }
        return compareTrackIds(firstEdge.to, secondEdge.to) < 0;
    }

    // Check whether the trimmed track ID is a graph node.
    hasNode(trackId) {
        return this.adjacencyList.has(String(trackId).trim());
    }

    // Return a copy of the outgoing edges, or an empty array for an unknown ID.
    getNeighbors(trackId) {
        const edges = this.adjacencyList.get(String(trackId).trim());
        return edges ? edges.map((edge) => ({ ...edge })) : [];
    }

    // Return the number of valid unique songs in the graph.
    nodeCount() {
        return this.adjacencyList.size;
    }

    // Count all directed edges stored in the adjacency lists.
    edgeCount() {
        let count = 0;
        for (const edges of this.adjacencyList.values()) {
            count += edges.length;
        }
        return count;
    }

    // Return the original song object for a node, or null when the ID is unknown.
    getSong(trackId) {
        return this.songs.get(String(trackId).trim()) || null;
    }

    // Return the similarity between two valid graph songs using precomputed vectors.
    similarityBetween(firstTrackId, secondTrackId) {
        const firstKey = String(firstTrackId).trim();
        const secondKey = String(secondTrackId).trim();
        const firstVector = this.normalizedFeatures.get(firstKey);
        const secondVector = this.normalizedFeatures.get(secondKey);
        if (!firstVector || !secondVector) {
            throw new Error('Similarity requires two valid songs in this graph');
        }
        return computeSimilarityFromVectors(firstVector, secondVector);
    }

    // Visit reachable nodes breadth-first in O(V + E) time and O(V) space.
    bfs(startTrackId, options = {}) {
        const startId = String(startTrackId).trim();
        if (!this.hasNode(startId)) {
            return [];
        }
        const limit = this.getTraversalLimit(options);
        if (limit === 0) {
            return [];
        }

        const visited = new Set([startId]);
        const queue = [startId];
        const order = [];
        let head = 0;
        while (head < queue.length && order.length < limit) {
            const currentId = queue[head++];
            order.push(currentId);
            for (const edge of this.adjacencyList.get(currentId)) {
                if (!visited.has(edge.to)) {
                    visited.add(edge.to);
                    queue.push(edge.to);
                }
            }
        }
        return order;
    }

    // Visit reachable nodes depth-first using an explicit stack in O(V + E) time and O(V) space.
    dfs(startTrackId, options = {}) {
        const startId = String(startTrackId).trim();
        if (!this.hasNode(startId)) {
            return [];
        }
        const limit = this.getTraversalLimit(options);
        if (limit === 0) {
            return [];
        }

        const visited = new Set();
        const stack = [startId];
        const order = [];
        while (stack.length > 0 && order.length < limit) {
            const currentId = stack.pop();
            if (visited.has(currentId)) {
                continue;
            }
            visited.add(currentId);
            order.push(currentId);

            const neighbors = this.adjacencyList.get(currentId);
            for (let index = neighbors.length - 1; index >= 0; index--) {
                if (!visited.has(neighbors[index].to)) {
                    stack.push(neighbors[index].to);
                }
            }
        }
        return order;
    }

    // Validate a traversal limit, with no limit meaning visit the full reachable component.
    getTraversalLimit(options) {
        if (options === undefined || options === null || options.limit === undefined) {
            return Infinity;
        }
        if (!Number.isInteger(options.limit) || options.limit < 0) {
            throw new RangeError('Traversal limit must be a non-negative integer');
        }
        return options.limit;
    }
}

// Export the structures for browser use and direct Node-based testing.
const DSA = {
    BTreeNode,
    BTree,
    compareTrackIds,
    binarySearchIndexByTrackId,
    binarySearchByTrackId,
    isSortedByTrackId,
    buildSortedSongArray,
    SortedSongIndex,
    CircularQueue,
    MaxHeap,
    heapSort,
    parseCSVRows,
    loadSongsFromCSV,
    SONG_LIMIT,
    SONG_FEATURES,
    NEIGHBOR_COUNT,
    MAX_FEATURE_DISTANCE,
    hasValidFeatures,
    getFeatureValidationReason,
    computeDistance,
    computeSimilarity,
    normalizeSong,
    SongGraph
};

if (typeof window !== 'undefined') {
    window.DSA = DSA;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DSA;
}
