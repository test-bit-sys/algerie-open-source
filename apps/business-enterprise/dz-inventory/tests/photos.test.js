/**
 * Photo path safety. Product ids and imagePaths normally come from the
 * app itself, but a restored backup keeps whatever the file held, and
 * both end up as drive paths — so they must not be able to reach
 * outside the images directory.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { photoPath, savePhoto, deletePhoto, photoURL } from '../src/lib/photos.js';

const drive = {
  write: vi.fn(async (path) => ({ path })),
  read: vi.fn(async () => { throw new Error('no file'); }),
  delete: vi.fn(async () => true),
};
globalThis.puter = { fs: drive };

beforeEach(() => {
  drive.write.mockClear();
  drive.read.mockClear();
  drive.delete.mockClear();
});

describe('photoPath', () => {
  it('builds the usual path for ids the app generates', () => {
    expect(photoPath('m5x0abcd1234')).toBe('inventory/images/m5x0abcd1234.webp');
  });

  it('keeps a crafted id inside the images directory', () => {
    for (const id of ['../../Desktop/report', 'a/b', 'a\\b', '..', 'a?*:x']) {
      const path = photoPath(id);
      expect(path.startsWith('inventory/images/')).toBe(true);
      expect(path.slice('inventory/images/'.length)).not.toMatch(/[/\\]|\.\./);
    }
  });
});

describe('savePhoto', () => {
  it('writes under the images directory even for a hostile id', async () => {
    await savePhoto('../../victim', new Blob(['x']));
    expect(drive.write).toHaveBeenCalledTimes(1);
    const [path] = drive.write.mock.calls[0];
    expect(path).toBe('inventory/images/______victim.webp');
  });
});

describe('deletePhoto and photoURL', () => {
  it('touch only paths the app could have written', async () => {
    await deletePhoto({ imagePath: '../secrets/passwords.txt' });
    await deletePhoto({ imagePath: 'inventory/images/../../file' });
    expect(drive.delete).not.toHaveBeenCalled();
    expect(await photoURL({ imagePath: '../secrets/passwords.txt' })).toBeNull();
    expect(drive.read).not.toHaveBeenCalled();

    await deletePhoto({ imagePath: 'inventory/images/abc.webp' });
    expect(drive.delete).toHaveBeenCalledWith('inventory/images/abc.webp');
  });
});

describe('photo replacement during a read', () => {
  it('does not reuse or cache an older in-flight photo after saving its replacement', async () => {
    const product = { imagePath: photoPath('replacement-race') };
    const oldBlob = new Blob(['old']);
    const newBlob = new Blob(['new']);
    let release;
    drive.read.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }))
      .mockResolvedValueOnce(newBlob);
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => blob === newBlob ? 'blob:new' : 'blob:old');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    try {
      const oldRead = photoURL(product);
      await savePhoto('replacement-race', newBlob);
      const newRead = photoURL(product);
      release(oldBlob);
      await oldRead;
      expect(await newRead).toBe('blob:new');
      expect(await photoURL(product)).toBe('blob:new');
      expect(drive.read).toHaveBeenCalledTimes(2);
    } finally {
      create.mockRestore();
      revoke.mockRestore();
    }
  });
});
