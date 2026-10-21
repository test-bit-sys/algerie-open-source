/**
 * Store-screenshot driver. Launches headless Chrome, drives the app over CDP,
 * and writes exact-pixel PNGs. No dependencies (Node 24 has a global WebSocket).
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const BASE = 'http://localhost:5173/store/capture.html';
const OUT = new URL('./screenshots', import.meta.url).pathname;
const PROFILE = '/tmp/calendar-store-capture-profile';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- minimal CDP client ----------
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    return new CDP(ws);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    this.ws.send(JSON.stringify(msg));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

/** Evaluate in the page and return the JS value (throws page-side errors). */
async function evaluate(cdp, sessionId, expression) {
  const r = await cdp.send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  );
  if (r.exceptionDetails) throw new Error('page error: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

/** Poll a page-side boolean expression until true. */
async function waitFor(cdp, sessionId, expression, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, `!!(${expression})`)) return;
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${label}`);
}

// ---------- scenes ----------
// Each scene: switch the app into a state, then settle. `click` helpers use the
// app's real controls so nothing is faked.
const clickView = (v) => `document.querySelector('[data-view="${v}"]').click()`;

const openEditorFor = (title) => `
  (async () => {
    const chip = [...document.querySelectorAll('.chip, .tevent, .allday-chip, .agenda__event')]
      .find((n) => n.textContent.includes(${JSON.stringify(title)}));
    if (!chip) throw new Error('chip not found: ' + ${JSON.stringify(title)});
    chip.click();
    await new Promise((r) => setTimeout(r, 400));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    // Editors open focused; blur so no caret/focus ring sits in the screenshot.
    if (document.activeElement) document.activeElement.blur();
    return !!document.querySelector('.modal');
  })()
`;

const openSearch = (query) => `
  (async () => {
    document.querySelector('[aria-label="Search events"]').click();
    await new Promise((r) => setTimeout(r, 300));
    const input = document.querySelector('.search__input');
    if (!input) throw new Error('search input not found');
    input.focus();
    const setter0 = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter0.call(input, ${JSON.stringify(query)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    return document.querySelectorAll('.search__result, .search__item, [role=option]').length;
  })()
`;

/** Open an event's details card (view mode, not the editor). */
const openCardFor = (title) => `
  (async () => {
    const chip = [...document.querySelectorAll('.chip, .tevent, .allday-chip, .agenda__event')]
      .find((n) => n.textContent.includes(${JSON.stringify(title)}));
    if (!chip) throw new Error('chip not found: ' + ${JSON.stringify(title)});
    chip.click();
    await new Promise((r) => setTimeout(r, 800));
    if (document.activeElement) document.activeElement.blur();
    return !!document.querySelector('.modal--view');
  })()
`;

const DESKTOP = { width: 1920, height: 1080, dpr: 1, mobile: false };
const TABLET = { width: 1024, height: 768, dpr: 1, mobile: false };
// 432 x 912 CSS at 2.5x = 1080 x 2280 device pixels, matching a real phone.
const PHONE = { width: 432, height: 912, dpr: 2.5, mobile: true };

const SCENES = [
  // --- 1920x1080 desktop ---
  { dir: '1920x1080', file: '01-month-view.png', vp: DESKTOP, ready: '.month' },
  { dir: '1920x1080', file: '02-week-view.png', vp: DESKTOP, script: clickView('week'), ready: '.timegrid' },
  {
    dir: '1920x1080',
    file: '03-event-editor.png',
    vp: DESKTOP,
    script: clickView('week') + ';',
    then: openEditorFor('Sprint planning'),
    ready: '.modal',
  },
  {
    dir: '1920x1080',
    file: '04-search.png',
    vp: DESKTOP,
    then: openSearch("review"),
    ready: '.search__panel',
  },
  // --- 1024x768 tablet ---
  { dir: '1024x768', file: '01-day-view.png', vp: TABLET, script: clickView('day'), ready: '.timegrid' },
  { dir: '1024x768', file: '02-agenda-list.png', vp: TABLET, script: clickView('agenda'), ready: '.agenda' },
  {
    dir: '1024x768',
    file: '03-guest-rsvp.png',
    vp: TABLET,
    script: clickView('day') + ';',
    then: openCardFor('Onboarding review'),
    ready: '.modal--view',
  },
  {
    dir: '1024x768',
    file: '04-year-view.png',
    vp: TABLET,
    // Scroll the current month's row to the top: the year opens on January,
    // and a store shot should lead with the months around today.
    script:
      clickView('year') +
      `; setTimeout(() => { const cards=[...document.querySelectorAll('.year__month')];` +
      ` const cur=cards[new Date().getMonth()]; const s=document.querySelector('.year');` +
      ` if (cur && s) s.scrollTop = cur.offsetTop - s.offsetTop - 12; }, 300)`,
    ready: '.year',
  },
  // --- 1080x2280 phone ---
  { dir: '1080x2280', file: '01-agenda-list.png', vp: PHONE, script: clickView('agenda'), ready: '.agenda' },
  { dir: '1080x2280', file: '02-day-view.png', vp: PHONE, script: clickView('day'), ready: '.timegrid' },
  {
    dir: '1080x2280',
    file: '03-event-editor.png',
    vp: PHONE,
    script: clickView('agenda') + ';',
    then: openEditorFor('Sprint planning'),
    ready: '.modal',
  },
  { dir: '1080x2280', file: '04-month-view.png', vp: PHONE, script: clickView('month'), ready: '.month' },
];

// ---------- run ----------
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--hide-scrollbars',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--force-color-profile=srgb',
  '--disable-features=DialMediaRouteProvider,Translate',
  'about:blank',
]);
chrome.stderr.on('data', () => {});

async function chromeReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/json/version`);
      return (await r.json()).webSocketDebuggerUrl;
    } catch {
      await sleep(250);
    }
  }
  throw new Error('chrome did not start');
}

const browserWs = await chromeReady();
const cdp = await CDP.connect(browserWs);
const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

await cdp.send('Page.enable', {}, sessionId);
await cdp.send('Runtime.enable', {}, sessionId);

const results = [];
for (const scene of SCENES) {
  const { width, height, dpr, mobile } = scene.vp;

  await cdp.send(
    'Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor: dpr, mobile, screenWidth: width, screenHeight: height },
    sessionId,
  );
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 }, sessionId);
  // Force the light scheme and kill transitions so nothing is captured mid-animation.
  await cdp.send(
    'Emulation.setEmulatedMedia',
    {
      features: [
        { name: 'prefers-color-scheme', value: 'light' },
        { name: 'prefers-reduced-motion', value: 'reduce' },
      ],
    },
    sessionId,
  );

  await cdp.send('Page.navigate', { url: BASE }, sessionId);
  await waitFor(cdp, sessionId, `document.querySelector('.view')`, 'app mount');
  await sleep(500);

  if (scene.script) {
    await evaluate(cdp, sessionId, scene.script);
    await sleep(600);
  }
  if (scene.then) {
    const r = await evaluate(cdp, sessionId, scene.then);
    results.push(`${scene.file}: then -> ${JSON.stringify(r)}`);
    await sleep(500);
  }
  await waitFor(cdp, sessionId, `document.querySelector('${scene.ready}')`, scene.ready);
  // Drop focus rings / caret from the shot.
  await evaluate(cdp, sessionId, `document.activeElement && document.activeElement.blur(); 1`);
  await sleep(400);

  const { data } = await cdp.send(
    'Page.captureScreenshot',
    { format: 'png', captureBeyondViewport: false, fromSurface: true },
    sessionId,
  );
  const dest = path.join(OUT, scene.dir, scene.file);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(data, 'base64'));
  console.log(`wrote ${scene.dir}/${scene.file}`);
}

console.log(results.join('\n'));
await cdp.send('Browser.close').catch(() => {});
chrome.kill();
process.exit(0);
