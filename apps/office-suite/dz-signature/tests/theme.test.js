import { describe, it, expect, beforeEach } from 'vitest';
import { applyTheme, currentTheme } from '../src/ui/theme.js';

describe('theme', () => {
  beforeEach(() => {
    delete document.documentElement.dataset.theme;
    localStorage.clear();
    document.head.innerHTML = '<meta name="theme-color" content="">';
  });

  it('defaults to system when nothing is stamped', () => {
    expect(currentTheme()).toBe('system');
  });

  it('stamps explicit light/dark on the root and persists it', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('signatures:theme')).toBe('dark');
    expect(currentTheme()).toBe('dark');

    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(currentTheme()).toBe('light');
  });

  it('system removes the stamp so the OS preference decides', () => {
    applyTheme('dark');
    applyTheme('system');
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem('signatures:theme')).toBe(null);
    expect(currentTheme()).toBe('system');
  });

  it('updates the theme-color meta for the browser chrome', () => {
    applyTheme('dark');
    expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe('#101013');
    applyTheme('light');
    expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe('#f6f6f4');
  });
});
