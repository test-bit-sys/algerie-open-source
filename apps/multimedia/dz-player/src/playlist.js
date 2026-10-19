/**
 * DZ-Player: Playlist Manager
 * Enterprise-grade multi-file queuing, sequential playback, repeat (off/all/one),
 * shuffle (Fisher-Yates), drag-and-drop reordering, M3U import/export, and duration metadata.
 * Part of DZ Open Suite (HeyPuter/everything standard)
 */

export class Playlist {
  constructor() {
    this.items = [];
    this.currentIndex = -1;
    this.repeatMode = 'off'; // 'off', 'all', 'one'
    this.isShuffle = false;
    this.shuffleIndices = [];
    this.shufflePointer = -1;
  }

  /**
   * Adds an item to the playlist.
   */
  addItem(item) {
    if (!item || !item.url) return null;
    const normalized = {
      id: item.id || 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      name: item.name || 'Untitled Media',
      url: item.url,
      file: item.file || null,
      type: item.type || (item.name && item.name.endsWith('.mp3') ? 'audio/mp3' : 'video/mp4'),
      isVideo: item.isVideo !== undefined ? item.isVideo : (!item.type?.startsWith('audio/') && !/\.(mp3|wav|ogg|flac|aac|m4a|wma)$/i.test(item.name || '')),
      isAudio: item.isAudio !== undefined ? item.isAudio : (item.type?.startsWith('audio/') || /\.(mp3|wav|ogg|flac|aac|m4a|wma)$/i.test(item.name || '')),
      size: item.size || 0,
      sizeFormatted: item.size ? this.formatSize(item.size) : (item.sizeFormatted || 'Stream'),
      duration: item.duration || 0,
      durationFormatted: item.duration ? this.formatDuration(item.duration) : '--:--'
    };

    this.items.push(normalized);

    if (this.isShuffle) {
      this.rebuildShuffleList();
    }

    if (this.currentIndex === -1 && this.items.length > 0) {
      this.currentIndex = 0;
    }

    return normalized;
  }

  /**
   * Adds multiple File objects from a file input or drag-and-drop.
   */
  addFiles(files) {
    const added = [];
    for (const file of Array.from(files)) {
      const isVideo = file.type.startsWith('video/') || /\.(mp4|mkv|webm|avi|mov|ts|m4v|wmv|flv)$/i.test(file.name);
      const isAudio = file.type.startsWith('audio/') || /\.(mp3|wav|ogg|flac|aac|m4a|wma|opus)$/i.test(file.name);

      if (!isVideo && !isAudio) continue;

      const url = URL.createObjectURL(file);
      const item = this.addItem({
        name: file.name,
        file,
        url,
        isVideo,
        isAudio,
        size: file.size,
        type: file.type
      });

      if (item) added.push(item);
    }
    return added;
  }

  /**
   * Formats file size in bytes to human-readable string.
   */
  formatSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  /**
   * Formats duration in seconds to MM:SS or HH:MM:SS.
   */
  formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '00:00';
    const s = Math.floor(seconds);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const remM = m % 60;
    const remS = s % 60;

    if (h > 0) {
      return `${h}:${String(remM).padStart(2, '0')}:${String(remS).padStart(2, '0')}`;
    }
    return `${String(remM).padStart(2, '0')}:${String(remS).padStart(2, '0')}`;
  }

  getItem(index) {
    if (index >= 0 && index < this.items.length) {
      return this.items[index];
    }
    return null;
  }

  getCurrentItem() {
    return this.getItem(this.currentIndex);
  }

  setIndex(index) {
    if (index >= 0 && index < this.items.length) {
      this.currentIndex = index;
      if (this.isShuffle) {
        this.shufflePointer = Math.max(0, this.shuffleIndices.indexOf(index));
      }
      return this.items[this.currentIndex];
    }
    return null;
  }

  getPreviousIndex() {
    if (this.items.length === 0) return -1;

    if (this.repeatMode === 'one' && this.currentIndex !== -1) {
      return this.currentIndex;
    }

    if (this.isShuffle) {
      if (this.shufflePointer > 0) {
        this.shufflePointer--;
        return this.shuffleIndices[this.shufflePointer];
      }
      if (this.repeatMode === 'all') {
        this.shufflePointer = this.shuffleIndices.length - 1;
        return this.shuffleIndices[this.shufflePointer];
      }
      return this.shuffleIndices[0];
    }

    if (this.currentIndex > 0) {
      return this.currentIndex - 1;
    }
    if (this.repeatMode === 'all') {
      return this.items.length - 1;
    }
    return -1;
  }

  getNextIndex() {
    if (this.items.length === 0) return -1;

    if (this.repeatMode === 'one' && this.currentIndex !== -1) {
      return this.currentIndex;
    }

    if (this.isShuffle) {
      if (this.shufflePointer < this.shuffleIndices.length - 1) {
        this.shufflePointer++;
        return this.shuffleIndices[this.shufflePointer];
      }
      if (this.repeatMode === 'all') {
        this.rebuildShuffleList();
        this.shufflePointer = 0;
        return this.shuffleIndices[0];
      }
      return -1;
    }

    if (this.currentIndex < this.items.length - 1) {
      return this.currentIndex + 1;
    }
    if (this.repeatMode === 'all') {
      return 0;
    }
    return -1;
  }

  next() {
    const nextIdx = this.getNextIndex();
    if (nextIdx !== -1) {
      this.currentIndex = nextIdx;
      return this.items[this.currentIndex];
    }
    return null;
  }

  prev() {
    const prevIdx = this.getPreviousIndex();
    if (prevIdx !== -1) {
      this.currentIndex = prevIdx;
      return this.items[this.currentIndex];
    }
    return null;
  }

  toggleShuffle() {
    this.isShuffle = !this.isShuffle;
    if (this.isShuffle) {
      this.rebuildShuffleList();
    }
    return this.isShuffle;
  }

  cycleRepeat() {
    if (this.repeatMode === 'off') {
      this.repeatMode = 'all';
    } else if (this.repeatMode === 'all') {
      this.repeatMode = 'one';
    } else {
      this.repeatMode = 'off';
    }
    return this.repeatMode;
  }

  rebuildShuffleList() {
    const indices = this.items.map((_, i) => i);
    // Fisher-Yates shuffle
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    this.shuffleIndices = indices;
    this.shufflePointer = Math.max(0, indices.indexOf(this.currentIndex));
  }

  reorder(fromIndex, toIndex) {
    if (fromIndex < 0 || fromIndex >= this.items.length) return;
    if (toIndex < 0 || toIndex >= this.items.length) return;

    const currentItem = this.getCurrentItem();
    const [moved] = this.items.splice(fromIndex, 1);
    this.items.splice(toIndex, 0, moved);

    if (currentItem) {
      this.currentIndex = this.items.indexOf(currentItem);
    }
    if (this.isShuffle) {
      this.rebuildShuffleList();
    }
  }

  remove(index) {
    if (index >= 0 && index < this.items.length) {
      const removed = this.items.splice(index, 1)[0];
      if (removed && removed.url && removed.file) {
        URL.revokeObjectURL(removed.url);
      }
      if (this.currentIndex > index) {
        this.currentIndex--;
      } else if (this.currentIndex >= this.items.length) {
        this.currentIndex = this.items.length - 1;
      }
      if (this.isShuffle) {
        this.rebuildShuffleList();
      }
      return removed;
    }
    return null;
  }

  clear() {
    for (const item of this.items) {
      if (item.url && item.file) {
        URL.revokeObjectURL(item.url);
      }
    }
    this.items = [];
    this.currentIndex = -1;
    this.shuffleIndices = [];
    this.shufflePointer = -1;
  }

  /**
   * Generates standard M3U playlist file content.
   */
  exportM3U() {
    let m3u = '#EXTM3U\n';
    this.items.forEach((item) => {
      const dur = Math.round(item.duration || -1);
      m3u += `#EXTINF:${dur},${item.name}\n${item.url}\n`;
    });
    return m3u;
  }

  /**
   * Parses M3U or text playlist into playable items.
   */
  parseM3U(text) {
    if (!text) return [];
    const lines = text.split(/\r?\n/);
    const added = [];
    let currentTitle = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('#EXTINF:')) {
        const commaIdx = trimmed.indexOf(',');
        if (commaIdx !== -1) {
          currentTitle = trimmed.substring(commaIdx + 1).trim();
        }
      } else if (!trimmed.startsWith('#')) {
        const title = currentTitle || trimmed.split('/').pop() || 'Network Stream';
        const item = this.addItem({
          name: title,
          url: trimmed,
          type: 'network'
        });
        if (item) added.push(item);
        currentTitle = '';
      }
    }
    return added;
  }
}
