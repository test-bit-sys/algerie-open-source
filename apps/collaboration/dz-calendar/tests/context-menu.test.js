import { describe, it, expect, afterEach } from 'vitest';
import { openContextMenu, isContextMenuOpen, closeContextMenu } from '../src/js/context-menu.js';

// Outside the Puter GUI (puter is undefined here) openContextMenu renders the
// styled, keyboard-accessible fallback menu.
function openAt(items) {
  const evt = new MouseEvent('contextmenu', { clientX: 20, clientY: 20, cancelable: true });
  openContextMenu(evt, items);
}

describe('fallback context menu — keyboard', () => {
  afterEach(() => {
    closeContextMenu();
    document.body.innerHTML = '';
  });

  it('traps Tab within the open menu instead of letting focus escape', () => {
    openAt([
      { label: 'Edit', action() {} },
      { label: 'Delete', action() {} },
    ]);
    expect(isContextMenuOpen()).toBe(true);
    const menu = document.querySelector('.ctx-menu');
    expect(menu).toBeTruthy();

    // Tab from the initial state focuses the first item and is prevented from
    // moving focus out of the menu.
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(menu.contains(document.activeElement)).toBe(true);

    // Tabbing forward past the last item wraps back into the menu (never escapes).
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(menu.contains(document.activeElement)).toBe(true);
  });

  it('closes on Escape', () => {
    openAt([{ label: 'Edit', action() {} }]);
    expect(isContextMenuOpen()).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(isContextMenuOpen()).toBe(false);
  });

  it('hands focus back to the opener on Escape', () => {
    // Regression: cleanup() removed the focused menu without restoring focus,
    // stranding the keyboard user on <body> to re-Tab from the document top.
    const opener = document.createElement('button');
    opener.textContent = 'Event chip';
    document.body.append(opener);
    opener.focus();
    openAt([
      { label: 'Edit', action() {} },
      { label: 'Delete', action() {} },
    ]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.querySelector('.ctx-menu').contains(document.activeElement)).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(isContextMenuOpen()).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('restores focus before running an activated item, so dialogs record the true opener', () => {
    let activeAtAction = null;
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    openAt([{ label: 'Edit', action: () => (activeAtAction = document.activeElement) }]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    // The action (e.g. opening the editor) sees the opener focused, so ITS
    // close-time focus restore lands somewhere real, not on a removed node.
    expect(activeAtAction).toBe(opener);
  });

  it('leaves a detached opener alone', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    openAt([{ label: 'Edit', action() {} }]);
    opener.remove(); // a re-render replaced the node the menu was opened from
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(isContextMenuOpen()).toBe(false);
    expect(document.activeElement).toBe(document.body); // no throw, no stale focus
  });
});
