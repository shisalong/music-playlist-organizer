// Keep saved-playlist edits pure so the Library UI and tests share one implementation.
(function () {
    const MAX_PLAYLIST_NAME_LENGTH = 80;

    // Report a rejected edit while returning the original playlist unchanged.
    function rejectEdit(playlist, error) {
        return { ok: false, error, playlist };
    }

    // Read a comparable track ID from either supported song shape.
    function getTrackId(song) {
        if (!song || typeof song !== 'object') {
            return '';
        }
        const trackId = song.track_id === undefined || song.track_id === null ? '' : song.track_id;
        return String(trackId).trim();
    }

    // Check whether a playlist already contains a track.
    function hasSong(playlist, trackId) {
        const normalizedId = String(trackId === undefined || trackId === null ? '' : trackId).trim();
        return normalizedId !== '' && playlist.songs.some((song) => getTrackId(song) === normalizedId);
    }

    // Check that an index points at an existing playlist entry.
    function isValidIndex(playlist, index) {
        return Number.isInteger(index) && index >= 0 && index < playlist.songs.length;
    }

    // Append a copy of a song unless it is invalid or already present.
    function addSong(playlist, song) {
        if (getTrackId(song) === '') {
            return rejectEdit(playlist, 'invalid-song');
        }
        if (hasSong(playlist, getTrackId(song))) {
            return rejectEdit(playlist, 'duplicate');
        }
        return { ok: true, error: '', playlist: { ...playlist, songs: [...playlist.songs, { ...song }] } };
    }

    // Remove one entry and return it with its index so the UI can offer undo.
    function removeSong(playlist, index) {
        if (!isValidIndex(playlist, index)) {
            return rejectEdit(playlist, 'out-of-range');
        }
        const songs = [...playlist.songs];
        const [removed] = songs.splice(index, 1);
        return { ok: true, error: '', playlist: { ...playlist, songs }, removed, index };
    }

    // Put a removed song back at its old position, clamped to the current list.
    function restoreSong(playlist, song, index) {
        if (getTrackId(song) === '') {
            return rejectEdit(playlist, 'invalid-song');
        }
        if (hasSong(playlist, getTrackId(song))) {
            return rejectEdit(playlist, 'duplicate');
        }
        const position = Number.isInteger(index)
            ? Math.min(Math.max(index, 0), playlist.songs.length)
            : playlist.songs.length;
        const songs = [...playlist.songs];
        songs.splice(position, 0, { ...song });
        return { ok: true, error: '', playlist: { ...playlist, songs } };
    }

    // Rename with a trimmed, non-empty name of bounded length.
    function renamePlaylist(playlist, name) {
        const trimmedName = typeof name === 'string' ? name.trim() : '';
        if (trimmedName === '') {
            return rejectEdit(playlist, 'empty-name');
        }
        if (trimmedName.length > MAX_PLAYLIST_NAME_LENGTH) {
            return rejectEdit(playlist, 'name-too-long');
        }
        return { ok: true, error: '', playlist: { ...playlist, name: trimmedName } };
    }

    // Move one entry so it ends up at toIndex in the resulting list.
    function moveSong(playlist, fromIndex, toIndex) {
        if (!isValidIndex(playlist, fromIndex) || !isValidIndex(playlist, toIndex)) {
            return rejectEdit(playlist, 'out-of-range');
        }
        if (fromIndex === toIndex) {
            return { ok: true, error: '', playlist };
        }
        const songs = [...playlist.songs];
        const [moved] = songs.splice(fromIndex, 1);
        songs.splice(toIndex, 0, moved);
        return { ok: true, error: '', playlist: { ...playlist, songs } };
    }

    // Replace one saved playlist by ID without changing the others or their order.
    function replacePlaylist(playlists, updatedPlaylist) {
        const index = playlists.findIndex((saved) => saved.id === updatedPlaylist.id);
        if (index === -1) {
            return { replaced: false, playlists };
        }
        const updated = [...playlists];
        updated[index] = updatedPlaylist;
        return { replaced: true, playlists: updated };
    }

    // Remove one saved playlist by ID and report it, leaving the others in order.
    function deletePlaylist(playlists, playlistId) {
        const index = playlists.findIndex((saved) => saved.id === playlistId);
        if (index === -1) {
            return { deleted: false, playlists, removed: null };
        }
        const updated = [...playlists];
        const [removed] = updated.splice(index, 1);
        return { deleted: true, playlists: updated, removed };
    }

    const PlaylistEditor = {
        MAX_PLAYLIST_NAME_LENGTH,
        getTrackId,
        hasSong,
        addSong,
        removeSong,
        restoreSong,
        renamePlaylist,
        moveSong,
        replacePlaylist,
        deletePlaylist
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PlaylistEditor;
    }
    if (typeof window !== 'undefined') {
        window.PlaylistEditor = PlaylistEditor;
    }
})();
