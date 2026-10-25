(function (global, factory) {
    const exported = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = exported;
    }
    global.YouTubeExportUI = exported.YouTubeExportUI;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    class YouTubeExportUI {
        // Connect the isolated exporter to the existing GenMix modal markup.
        constructor(options = {}) {
            this.document = options.document;
            this.exporter = options.exporter;
            this.cache = options.cache;
            this.estimateQuota = options.estimateQuota;
            this.currentPlaylist = null;
            this.inProgress = false;
            this.controller = null;
        }

        // Bind controls once at application startup.
        setup() {
            this.document.getElementById('youtubeExportClose').addEventListener('click', () => this.close());
            this.document.getElementById('youtubeExportCancel').addEventListener('click', () => this.close());
            this.document.getElementById('youtubeExportStart').addEventListener('click', () => this.start());
            this.document.getElementById('youtubeExportModal').addEventListener('click', (event) => {
                if (event.target === this.document.getElementById('youtubeExportModal')) {
                    this.close();
                }
            });
        }

        // Open the shared confirmation panel for a generated or saved playlist.
        open(playlist) {
            this.currentPlaylist = playlist;
            const songs = playlist && Array.isArray(playlist.songs) ? playlist.songs : [];
            this.document.getElementById('youtubePlaylistName').value = playlist && playlist.name || 'GenMix Playlist';
            this.document.getElementById('youtubePrivacy').value = 'private';
            this.document.getElementById('youtubeExportStatus').textContent = '';
            this.document.getElementById('youtubeExportResult').replaceChildren();
            const estimate = this.estimateQuota(songs, this.cache);
            this.document.getElementById('youtubeExportEstimate').textContent =
                `${songs.length} songs · ${estimate.searchRequests} uncached YouTube searches · ` +
                `up to ${estimate.generalUnitsMaximum} general quota units`;
            const modal = this.document.getElementById('youtubeExportModal');
            modal.classList.add('active');
            modal.setAttribute('aria-hidden', 'false');
            this.document.getElementById('youtubePlaylistName').focus();
        }

        // Close the panel when idle; an active export must finish to avoid hidden side effects.
        close() {
            if (this.inProgress) {
                return false;
            }
            const modal = this.document.getElementById('youtubeExportModal');
            modal.classList.remove('active');
            modal.setAttribute('aria-hidden', 'true');
            this.currentPlaylist = null;
            return true;
        }

        // Render state-machine progress without exposing tokens or raw API responses.
        showProgress(progress) {
            const labels = {
                matching: `Matching song ${progress.current} of ${progress.total}...`,
                creating_playlist: 'Creating your YouTube playlist...',
                adding_videos: `Adding video ${progress.current} of ${progress.total}...`
            };
            this.document.getElementById('youtubeExportStatus').textContent = labels[progress.state] || '';
        }

        // Start one guarded export and keep failures visible in the same panel.
        async start() {
            if (this.inProgress || !this.currentPlaylist) {
                return null;
            }
            const name = this.document.getElementById('youtubePlaylistName').value.trim();
            if (!name) {
                this.document.getElementById('youtubeExportStatus').textContent = 'Enter a playlist name.';
                return null;
            }
            this.inProgress = true;
            this.controller = typeof AbortController === 'function' ? new AbortController() : null;
            const startButton = this.document.getElementById('youtubeExportStart');
            startButton.disabled = true;
            this.document.getElementById('youtubeExportCancel').disabled = true;
            this.document.getElementById('youtubeExportClose').disabled = true;
            this.document.getElementById('youtubeExportStatus').textContent = 'Authorizing your Google account...';
            try {
                const result = await this.exporter.exportPlaylist(this.currentPlaylist, {
                    name,
                    privacyStatus: this.document.getElementById('youtubePrivacy').value,
                    signal: this.controller && this.controller.signal,
                    onProgress: (progress) => this.showProgress(progress)
                });
                this.renderResult(result);
                return result;
            } catch (error) {
                this.document.getElementById('youtubeExportStatus').textContent =
                    error.message || 'YouTube export failed.';
                return null;
            } finally {
                this.inProgress = false;
                this.controller = null;
                startButton.disabled = false;
                this.document.getElementById('youtubeExportCancel').disabled = false;
                this.document.getElementById('youtubeExportClose').disabled = false;
            }
        }

        // Show the playlist link and every song that was unmatched or failed.
        renderResult(result) {
            const container = this.document.getElementById('youtubeExportResult');
            container.replaceChildren();
            const summary = this.document.createElement('p');
            const attempted = result.matched.length + result.unmatched.length + result.failed.length;
            summary.textContent = `${result.matched.length}/${attempted} songs added to YouTube.`;
            container.appendChild(summary);
            if (result.playlistUrl) {
                const link = this.document.createElement('a');
                link.href = result.playlistUrl;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = 'Open YouTube playlist';
                link.className = 'youtube-playlist-link';
                container.appendChild(link);
            }
            const problems = [...result.unmatched, ...result.failed];
            if (problems.length > 0) {
                const list = this.document.createElement('ul');
                list.className = 'youtube-export-problems';
                problems.forEach((problem) => {
                    const item = this.document.createElement('li');
                    const song = problem.song || {};
                    const title = song.title || song.track_name || 'Untitled';
                    const artist = song.artist || song.artists || 'Unknown artist';
                    item.textContent = `${title} — ${artist}: ${problem.reason}`;
                    list.appendChild(item);
                });
                container.appendChild(list);
            }
            this.document.getElementById('youtubeExportStatus').textContent = result.error ||
                (result.status === 'done' ? 'YouTube playlist created successfully.' : 'YouTube playlist created with some skipped songs.');
        }
    }

    return { YouTubeExportUI };
});
