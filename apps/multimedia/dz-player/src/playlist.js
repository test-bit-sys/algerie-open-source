/**
 * DZ-Player: Playlist Manager
 * Handles multi-file queuing, sequential playback, repeat (off/all/one),
 * shuffle, and duration metadata.
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

  addFiles(files) {
    const added = [];
    for (const file of Array.from(files)) {
      const isVideo = file.type.startsWith('video/') || /\.(mp4|mkv|webm|avi|mov|ts|m4v|wmv)$/i.test(file.name);
      const isAudio = file.type.startsWith('audio/') || /\.(mp3|wav|ogg|flac|aac|m4a|wma)$/i.test(file.name);

      if (!isVideo && !isAudio) continue;

      const url = URL.createObjectURL(file);
      const item = {
        id: 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        name: file.name,
        file,
        url,
        isVideo,
        isAudio,
        size: file.size,
        sizeFormatted: this.formatSize(file.size),
        duration: 0
      };

      this.items.push(item);
      added.push(item);
    }

    if (this.isShuffle) {
      this.rebuildShuffleList();
    }

    if (this.currentIndex === -1 && this.items.length > 0) {
      this.currentIndex = 0;
    }

    return added;
  }

  formatSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  getCurrentItem() {
    if (this.currentIndex >= 0 && this.currentIndex < this.items.length) {
      return this.items[this.currentIndex];
    }
    return null;
  }

  setIndex(index) {
    if (index >= 0 && index < this.items.length) {
      this.currentIndex = index;
      return this.items[this.currentIndex];
    }
    return null;
  }

  next() {
    if (this.items.length === 0) return null;

    if (this.repeatMode === 'one') {
      return this.getCurrentItem();
    }

    if (this.isShuffle) {
      if (this.shufflePointer < this.shuffleIndices.length - 1) {
        this.shufflePointer++;
        this.currentIndex = this.shuffleIndices[this.shufflePointer];
        return this.items[this.currentIndex];
      } else if (this.repeatMode === 'all') {
        this.rebuildShuffleList();
        this.shufflePointer = 0;
        this.currentIndex = this.shuffleIndices[0];
        return this.items[this.currentIndex];
      }
      return null;
    }

    if (this.currentIndex < this.items.length - 1) {
      this.currentIndex++;
      return this.items[this.currentIndex];
    } else if (this.repeatMode === 'all') {
      this.currentIndex = 0;
      return this.items[0];
    }

    return null;
  }

  prev() {
    if (this.items.length === 0) return null;

    if (this.isShuffle) {
      if (this.shufflePointer > 0) {
        this.shufflePointer--;
        this.currentIndex = this.shuffleIndices[this.shufflePointer];
        return this.items[this.currentIndex];
      }
      return this.getCurrentItem();
    }

    if (this.currentIndex > 0) {
      this.currentIndex--;
      return this.items[this.currentIndex];
    } else if (this.repeatMode === 'all') {
      this.currentIndex = this.items.length - 1;
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

  remove(index) {
    if (index >= 0 && index < this.items.length) {
      const removed = this.items.splice(index, 1)[0];
      if (removed && removed.url) {
        URL.revokeObjectURL(removed.url);
      }
      if (this.currentIndex >= this.items.length) {
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
      if (item.url) URL.revokeObjectURL(item.url);
    }
    this.items = [];
    this.currentIndex = -1;
    this.shuffleIndices = [];
    this.shufflePointer = -1;
  }
}
