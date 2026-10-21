import { el } from './dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { syncEvents, pendingWrites, lastSyncError, flushQueue } from '../lib/cloud.js';

export function setupOfflineBanner() {
  /* Registered once, before it has anything to say, and only ever
     hidden — the same rule the toast root follows: a live region
     inserted together with its first message is routinely not
     announced at all. role="status" reads the offline/syncing state
     to screen readers, which changes what saving actually means. */
  const message = el('span');
  const banner = el('div.offline-banner', { role: 'status', hidden: true, html: icon('wifiOff', 15, 2) }, message);
  const retry = el('button', { type: 'button', onclick: () => flushQueue().catch(() => {}) }, 'Retry sync');
  banner.append(retry);
  document.body.append(banner);

  const bannerText = () => {
    const pending = pendingWrites();
    if (!navigator.onLine) {
      return pending
        ? ` You’re offline. ${pending} change${pending === 1 ? '' : 's'} saved here, syncing when you reconnect`
        : ' You’re offline. Changes are saved on this device and sync when you reconnect';
    }
    if (pending && lastSyncError()) return ` ${pending} change${pending === 1 ? '' : 's'} could not sync. Changes are kept on this device; retry or export a backup from Settings.`;
    return pending ? ` Syncing ${pending} change${pending === 1 ? '' : 's'}…` : null;
  };

  const update = () => {
    const text = bannerText();
    banner.hidden = !text;
    message.textContent = text || '';
    retry.hidden = !navigator.onLine || !pendingWrites();
  };

  const online = () => { update(); flushQueue().catch(() => {}); };
  window.addEventListener('online', online);
  window.addEventListener('offline', update);
  syncEvents.addEventListener('change', update);
  syncEvents.addEventListener('error', update);
  const flushed = () => {
    update();
    toast('All changes synced', { icon: 'cloud' });
  };
  syncEvents.addEventListener('flushed', flushed);
  update();
  return () => {
    window.removeEventListener('online', online);
    window.removeEventListener('offline', update);
    syncEvents.removeEventListener('change', update);
    syncEvents.removeEventListener('error', update);
    syncEvents.removeEventListener('flushed', flushed);
    banner.remove();
  };
}

