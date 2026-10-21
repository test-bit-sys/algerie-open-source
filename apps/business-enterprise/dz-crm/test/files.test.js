import { describe, it, expect } from 'vitest';
import { safeFileName, formatBytes, isAppFilePath } from '../src/lib/files.js';

describe('safeFileName', () => {
  it('slugs the base name and keeps a sane extension', () => {
    expect(safeFileName('Q3 Proposal (final).PDF')).toBe('q3-proposal-final.pdf');
    expect(safeFileName('résumé.docx')).toBe('resume.docx');
  });

  it('survives extensionless, dotfile, and empty names', () => {
    expect(safeFileName('README')).toBe('readme');
    expect(safeFileName('.env')).toBe('env');
    expect(safeFileName('')).toBe('file');
    expect(safeFileName('!!!.???')).toBe('file');
  });

  it('bounds absurdly long names', () => {
    const name = safeFileName(`${'x'.repeat(200)}.pdf`);
    expect(name.length).toBeLessThanOrEqual(71);
    expect(name.endsWith('.pdf')).toBe(true);
  });
});

describe('isAppFilePath', () => {
  it('accepts the paths uploadFile writes', () => {
    expect(isAppFilePath('attachments/8f14e45f-q3-proposal.pdf')).toBe(true);
    expect(isAppFilePath('attachments/id-abc123-readme')).toBe(true);
  });

  it('rejects anything outside the attachments directory', () => {
    expect(isAppFilePath('backups/crm-backup-2026-08-01T00-00-00Z.json')).toBe(false);
    expect(isAppFilePath('attachments/../backups/latest.json')).toBe(false);
    expect(isAppFilePath('attachments/nested/file.pdf')).toBe(false);
    expect(isAppFilePath('/absolute/attachments/file.pdf')).toBe(false);
    expect(isAppFilePath('attachments/')).toBe(false);
    expect(isAppFilePath('')).toBe(false);
    expect(isAppFilePath(null)).toBe(false);
    expect(isAppFilePath(42)).toBe(false);
  });
});

describe('formatBytes', () => {
  it('reads like a human wrote it', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(2.4 * 1024 * 1024)).toBe('2.4 MB');
    expect(formatBytes(null)).toBe('0 B');
  });
});
