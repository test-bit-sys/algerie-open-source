import { it, expect, beforeEach } from 'vitest';
import { showMenu, closeMenu } from '../src/ui/menu.js';
import { showPopover, closePopover } from '../src/ui/popover.js';

beforeEach(() => {
  closeMenu();
  closePopover();
  document.body.replaceChildren();
});

it('returns focus to the menu button after an item runs', () => {
  const anchor = document.createElement('button');
  document.body.append(anchor);
  anchor.focus();
  let focusedDuringRun = null;
  showMenu([{ label: 'Rename', run: () => (focusedDuringRun = document.activeElement) }], { anchor });
  document.querySelector('[role=menuitem]').click();
  expect(focusedDuringRun).toBe(anchor);
  expect(document.activeElement).toBe(anchor);
});

it('returns focus to what had it after a context menu item runs', () => {
  const row = document.createElement('div');
  row.tabIndex = 0;
  document.body.append(row);
  row.focus();
  showMenu([{ label: 'Rename', run() {} }], { rect: { left: 0, right: 0, top: 0, bottom: 0 } });
  document.querySelector('[role=menuitem]').click();
  expect(document.activeElement).toBe(row);
});

it('starts on the checked item when disabled items come before it', () => {
  const anchor = document.createElement('button');
  document.body.append(anchor);
  showMenu([{ label: 'Off', disabled: true, checked: false }, { label: 'A', checked: false }, { label: 'B', checked: true }, { label: 'Help' }], { anchor });
  expect(document.activeElement.textContent).toBe('B');
});

it('returns focus to the menu button on Tab so the browser moves on from there', () => {
  const anchor = document.createElement('button');
  document.body.append(anchor);
  anchor.focus();
  showMenu([{ label: 'A' }, { label: 'B' }], { anchor });
  const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  document.activeElement.dispatchEvent(e);
  expect(document.querySelector('.menu')).toBe(null);
  expect(document.activeElement).toBe(anchor);
  expect(e.defaultPrevented).toBe(false);
});

it('does not let a menu closed right away close later menus', async () => {
  const anchor = document.createElement('button');
  document.body.append(anchor);
  showMenu([{ label: 'A' }], { anchor });
  closeMenu();
  await new Promise((r) => setTimeout(r));
  const el = showMenu([{ label: 'B' }], { anchor });
  el.querySelector('[role=menuitem]').dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(el.isConnected).toBe(true);
});

it('does not let a popover closed right away close later popovers', async () => {
  const a = document.createElement('button');
  const b = document.createElement('button');
  document.body.append(a, b);
  showPopover(a, document.createElement('input'));
  closePopover();
  await new Promise((r) => setTimeout(r));
  const el = showPopover(b, document.createElement('input'));
  el.querySelector('input').dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(el.isConnected).toBe(true);
});
