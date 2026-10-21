// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authView } from '../src/views/auth.js';

beforeEach(() => { document.body.replaceChildren(); });
afterEach(() => { vi.unstubAllGlobals(); });

function mount(onSignedIn = vi.fn()) {
  const view = authView({ onSignedIn });
  document.body.append(view);
  return { view, buttons: [...view.querySelectorAll('[data-sign-in]')], status: view.querySelector('[role="status"]'), onSignedIn };
}

describe('public landing sign-in', () => {
  it('opens only one sign-in window across all calls to action and boots after success', async () => {
    let complete;
    const signIn = vi.fn(() => new Promise((resolve) => { complete = resolve; }));
    vi.stubGlobal('puter', { auth: { signIn } });
    const { buttons, onSignedIn, status } = mount();
    buttons[1].querySelector('svg').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    buttons[0].click();
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(status.textContent).toContain('Puter window');
    expect(onSignedIn).not.toHaveBeenCalled();
    complete();
    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
  });

  it('allows retry after a canceled or blocked popup', async () => {
    const signIn = vi.fn().mockRejectedValueOnce(new Error('Closed')).mockResolvedValueOnce();
    vi.stubGlobal('puter', { auth: { signIn } });
    const { buttons, onSignedIn, status } = mount();
    buttons[1].click();
    await vi.waitFor(() => expect(status.textContent).toContain('wasn’t completed'));
    expect(buttons.every((button) => !button.disabled)).toBe(true);
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(status);
    buttons[2].click();
    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
  });

  it('keeps the introduction usable when the SDK is unavailable', () => {
    vi.stubGlobal('puter', undefined);
    const { buttons, status, onSignedIn, view } = mount();
    buttons[0].click();
    expect(status.textContent).toContain('reload this page');
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(view.querySelectorAll('details')).toHaveLength(7);
    for (const link of view.querySelectorAll('a[href^="#"]')) {
      expect(document.getElementById(link.hash.slice(1))).not.toBeNull();
    }
  });
});

describe('More Apps disclosure', () => {
  it('toggles, closes on outside click, and restores focus on Escape', () => {
    const { view } = mount();
    const toggle = view.querySelector('.lp-dropdown-toggle');
    const dropdown = view.querySelector('[data-dropdown]');
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(dropdown.classList.contains('open')).toBe(true);
    view.querySelector('h1').click();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    dropdown.querySelector('a').focus();
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });
});

describe('mobile public navigation', () => {
  it('opens the navigation and restores focus after Escape', () => {
    const { view } = mount();
    const toggle = view.querySelector('.lp-nav-toggle');
    const header = view.querySelector('.lp-header');
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(header.hasAttribute('data-nav-open')).toBe(true);
    const link = view.querySelector('.lp-nav-links a');
    link.focus();
    link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(header.hasAttribute('data-nav-open')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });

  it('closes on selection and moves focus to the selected section', () => {
    const { view } = mount();
    view.querySelector('.lp-nav-toggle').click();
    view.querySelector('.lp-nav-links a[href="#features"]').click();
    expect(view.querySelector('.lp-header').hasAttribute('data-nav-open')).toBe(false);
    expect(document.activeElement).toBe(view.querySelector('#features'));
  });

  it('closes a nested disclosure before closing the navigation', () => {
    const { view } = mount();
    const toggle = view.querySelector('.lp-nav-toggle');
    const more = view.querySelector('.lp-dropdown-toggle');
    toggle.click();
    more.click();
    more.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    more.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    view.querySelector('h1').click();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes when keyboard focus leaves the header', () => {
    const { view } = mount();
    view.querySelector('.lp-nav-toggle').click();
    view.querySelector('.lp-nav-links a').focus();
    view.querySelector('.lp-hero button').focus();
    expect(view.querySelector('.lp-nav-toggle').getAttribute('aria-expanded')).toBe('false');
  });
});
