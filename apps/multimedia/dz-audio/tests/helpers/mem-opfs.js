/** In-memory stand-in for the origin private file system. */
export class MemFile {
  constructor(name) {
    this.kind = 'file';
    this.name = name;
    this.parts = [];
    this.lastModified = Date.now();
  }
  async getFile() {
    const f = new Blob(this.parts);
    f.lastModified = this.lastModified;
    f.text = async () => new TextDecoder().decode(await f.arrayBuffer());
    return f;
  }
  async createWritable() {
    const staged = [];
    return {
      write: async (data) => staged.push(typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice()),
      close: async () => {
        this.parts = staged;
        this.lastModified = Date.now();
      },
      abort: async () => {},
    };
  }
}

export class MemDir {
  constructor(name = '') {
    this.kind = 'directory';
    this.name = name;
    this.children = new Map();
  }
  async getDirectoryHandle(name, { create } = {}) {
    if (!this.children.has(name)) {
      if (!create) throw Object.assign(new Error('NotFound'), { name: 'NotFoundError' });
      this.children.set(name, new MemDir(name));
    }
    return this.children.get(name);
  }
  async getFileHandle(name, { create } = {}) {
    if (!this.children.has(name)) {
      if (!create) throw Object.assign(new Error('NotFound'), { name: 'NotFoundError' });
      this.children.set(name, new MemFile(name));
    }
    return this.children.get(name);
  }
  async removeEntry(name) {
    if (!this.children.delete(name)) throw new Error('NotFound');
  }
  async *entries() {
    for (const e of [...this.children]) yield e;
  }
}

