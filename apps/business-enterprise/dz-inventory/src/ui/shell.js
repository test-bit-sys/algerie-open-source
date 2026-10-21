import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { store } from '../lib/store.js';
import { onOrderQty, reorderAlerts } from '../lib/reorder.js';
import { demandRates } from '../lib/demand.js';
import { wipeSampleData } from '../lib/sample.js';
import { openOnboarding } from './onboarding.js';
import { openProductForm } from './productform.js';
import { initPalette, openPalette } from './palette.js';
import { confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { openModal } from './modal.js';
import { dashboardView } from '../views/dashboard.js';
import { productsView } from '../views/products.js';
import { reorderView } from '../views/reorder.js';
import { stocktakeView } from '../views/stocktake.js';
import { takeoutView } from '../views/takeout.js';
import { productView, productIdFromHash } from '../views/product.js';
import { historyView } from '../views/history.js';
import { reportsView } from '../views/reports.js';
import { suppliersView } from '../views/suppliers.js';
import { locationsView } from '../views/locations.js';
import { settingsView, confirmSignOut } from '../views/settings.js';

/**
 * Every route shows in the desktop sidebar. `tab: true` also earns a
 * slot in the mobile tab bar; the rest live behind its "More" sheet, so
 * the bar keeps thumb-sized targets however many views we add.
 *
 * A route with `match` is a detail page: it isn't in either navigation
 * (it belongs to no menu — it belongs to an object), it claims the hash
 * itself, and it says which nav item should read as current while it's
 * open.
 */
const ROUTES = [
  { hash: '#/', label: 'Overview', icon: 'dashboard', view: dashboardView, tab: true },
  { hash: '#/products', label: 'Products', icon: 'package', view: productsView, tab: true },
  { hash: '#/takeout', label: 'Take out', icon: 'packageMinus', view: takeoutView },
  { hash: '#/reorder', label: 'Reorder', icon: 'cart', view: reorderView, tab: true },
  { hash: '#/stocktake', label: 'Stocktake', icon: 'clipboard', view: stocktakeView },
  { hash: '#/history', label: 'History', icon: 'history', view: historyView, tab: true },
  { hash: '#/reports', label: 'Reports', icon: 'chart', view: reportsView },
  { hash: '#/locations', label: 'Locations', icon: 'pin', view: locationsView },
  { hash: '#/suppliers', label: 'Suppliers', icon: 'truck', view: suppliersView },
  { hash: '#/settings', label: 'Settings', icon: 'gear', view: settingsView },
  /* The app's one deep-linkable object URL: the thing an owner
     bookmarks, and where a scanned code that resolves to a known
     product can land. */
  {
    hash: '#/product',
    label: 'Product',
    icon: 'package',
    view: productView,
    detail: true,
    parent: '#/products',
    match: (hash) => !!productIdFromHash(hash),
    title: () => store.productById(productIdFromHash())?.name || 'Product',
  },
];

export function mountShell(appRoot) {
  const sampleBanner = el('div');
  const viewWrap = el('div');
  /* tabindex -1: navigation moves focus here — see renderRoute. */
  const main = el('main.main', { id: 'main', tabindex: -1 }, sampleBanner, viewWrap);
  let currentView = null;

  /* Sample-data banner: always visible while exploring, one-tap wipe. */
  function renderSampleBanner() {
    clear(sampleBanner);
    if (!store.settings.sampleData) return;
    sampleBanner.append(el('div.main-inner', {}, el('div.sample-banner', {},
      el('span.sample-banner-ic', { html: icon('sparkle', 14, 2.2) }),
      el('span.grow', {}, 'Sample data: explore freely, nothing here is yours'),
      el('button', {
        onclick: async () => {
          const ok = await confirmDialog({
            title: 'Start fresh?',
            message: 'All sample data is removed and you set up your own inventory from scratch.',
            confirmLabel: 'Wipe sample data',
          });
          if (!ok) return;
          try {
            await wipeSampleData(store);
          } catch (err) {
            console.error(err);
            toast('Couldn’t wipe. Check your connection', { icon: 'wifiOff' });
            return;
          }
          openOnboarding();
        },
      }, 'Start fresh')
    )));
  }
  store.addEventListener('change', renderSampleBanner);
  renderSampleBanner();

  function routeFor(hash) {
    const clean = (hash || '#/').split('?')[0];
    return ROUTES.find((r) => (r.match ? r.match(clean) : r.hash === clean)) || ROUTES[0];
  }

  /** The nav item that should read as current for this route. */
  function navRouteFor(route) {
    return (route.parent && ROUTES.find((r) => r.hash === route.parent)) || route;
  }

  /* Attention badge on Reorder: products that are low or out and whose
     shortfall open orders don't already cover — the ones still needing
     a decision. Stocktake shows a dot while a count is in progress. */
  function navBadge(route) {
    if (route.hash === '#/stocktake') {
      if (!store.stocktake) return null;
      const label = 'Count in progress';
      return el('span.nav-badge', { role: 'img', 'aria-label': label, title: label }, '…');
    }
    if (route.hash === '#/takeout') {
      const n = store.takeout?.lines.length || 0;
      if (!store.takeout) return null;
      const label = n
        ? `${n} line${n === 1 ? '' : 's'} in the basket`
        : 'Basket started, nothing in it yet';
      return el('span.nav-badge', { role: 'img', 'aria-label': label, title: label },
        n ? (n > 99 ? '99+' : String(n)) : '…');
    }
    if (route.hash !== '#/reorder') return null;
    // Counted the way the Reorder page builds its list, options and
    // all: a badge that worked the number out for itself drifted from
    // the page — it counted kits, which you build rather than buy, and
    // ignored the coverage horizon the suggested quantities use.
    const n = reorderAlerts(store.products, {
      defaultLow: store.settings.defaultLowStock,
      incoming: onOrderQty(store.orders),
      rates: demandRates(store.activity).rates,
      coverageDays: store.settings.coverageDays,
    }).length;
    if (!n) return null;
    const label = `${n} product${n === 1 ? '' : 's'} to reorder`;
    return el('span.nav-badge', { role: 'img', 'aria-label': label, title: label },
      n > 99 ? '99+' : String(n));
  }

  /* Sidebar (desktop) */
  const username = store.user?.username || 'Puter user';
  const isPuterApp = typeof puter !== 'undefined' && puter.env === 'app';
  const sidebarNav = el('div', { style: { display: 'contents' } });
  const isMac = /Mac|iP/.test(navigator.platform || '');
  const sidebar = el('nav.sidebar', { 'aria-label': 'Main navigation' },
    el('div.brand', {},
      el('img', { src: './icon-192.png', width: 30, height: 30, alt: '' }),
      'Inventory'
    ),
    el('button.sidebar-search', {
      type: 'button',
      html: icon('search', 16, 2),
      onclick: () => openPalette(),
    },
      el('span.grow', {}, 'Search'),
      el('kbd', {}, isMac ? '⌘K' : 'Ctrl K')
    ),
    sidebarNav,
    el('div.sidebar-spacer'),
    el('button.btn.btn-primary.sidebar-add', {
      html: icon('plus', 17, 2.2),
      onclick: () => openProductForm(),
    }, ' New product'),
    el('div.sidebar-user', {},
      el('span.user-avatar', {}, username.charAt(0).toUpperCase()),
      el('span.name', { title: username }, username),
      !isPuterApp && el('button.icon-btn', {
        html: icon('logout', 18, 2),
        'aria-label': 'Sign out',
        title: 'Sign out',
        onclick: confirmSignOut,
      })
    )
  );

  /* Tab bar (mobile) */
  const tabbar = el('nav.tabbar', { 'aria-label': 'Main navigation' });

  function renderNav() {
    const active = navRouteFor(routeFor(location.hash));
    clear(sidebarNav);
    clear(tabbar);
    for (const r of ROUTES) {
      if (r.detail) continue;
      sidebarNav.append(el('a.nav-item', {
        href: r.hash,
        className: `nav-item${r === active ? ' active' : ''}`,
        html: icon(r.icon, 21, 1.8),
        'aria-current': r === active ? 'page' : null,
      }, el('span', {}, r.label), navBadge(r)));
      if (!r.tab) continue;
      tabbar.append(el('a.tab-item', {
        href: r.hash,
        className: `tab-item${r === active ? ' active' : ''}`,
        html: icon(r.icon, 22, 1.8),
        'aria-current': r === active ? 'page' : null,
      }, el('span', {}, r.label), navBadge(r)));
    }
    /* The palette is the mobile search: one tap from any view. */
    tabbar.append(el('button.tab-item', {
      type: 'button',
      html: icon('search', 22, 1.8),
      'aria-haspopup': 'dialog',
      onclick: () => openPalette(),
    }, el('span', {}, 'Search')));
    const overflow = ROUTES.filter((r) => !r.tab && !r.detail);
    if (!overflow.length) return;
    const inMore = overflow.includes(active);
    tabbar.append(el('button.tab-item', {
      type: 'button',
      className: `tab-item${inMore ? ' active' : ''}`,
      html: icon('more', 22, 1.8),
      'aria-haspopup': 'dialog',
      onclick: () => openMoreSheet(overflow, active),
    }, el('span', {}, 'More')));
  }

  /* Mobile overflow: the routes the tab bar has no room for. */
  function openMoreSheet(routes, active) {
    const content = el('div.item-list', {}, routes.map((r) => el('a.item-row', {
      href: r.hash,
      'aria-current': r === active ? 'page' : null,
      onclick: () => modal.close(),
    },
      el('span.item-ic', { className: `item-ic${r === active ? ' accent' : ''}`, html: icon(r.icon, 18) }),
      el('div.grow', {}, el('div.title', {}, r.label)),
      navBadge(r),
      el('span', { html: icon('chevR', 18), style: { color: 'var(--ink-3)' } })
    )));
    const modal = openModal({ title: 'More', content });
  }

  function renderRoute({ moveFocus = false } = {}) {
    renderNav();
    const route = routeFor(location.hash);
    /* The tab (and the screen reader's page announcement) names where
       the user is; the Overview keeps the app's plain name, and a detail
       page names the object it is showing. */
    const label = route.title ? route.title(location.hash) : route.label;
    document.title = route.hash === '#/' ? 'Inventory' : `${label} | Inventory`;
    currentView?.destroy?.();
    clear(viewWrap);
    currentView = route.view();
    viewWrap.append(currentView);
    window.scrollTo({ top: 0 });
    /* renderNav just rebuilt the link the user activated, so focus fell
       to <body>: a keyboard user would restart Tabbing from the top of
       the document, and nothing would announce that the view changed.
       Focus the freshly filled main region instead — only on real
       navigation; the initial mount must not steal focus. */
    if (moveFocus) main.focus({ preventScroll: true });
  }

  const fab = el('button.fab', {
    html: icon('plus', 26, 2.2),
    'aria-label': 'Add product',
    onclick: () => openProductForm(),
  });

  clear(appRoot);
  appRoot.append(el('div.shell', {}, sidebar, main), tabbar, fab);

  window.addEventListener('hashchange', () => renderRoute({ moveFocus: true }));
  renderRoute();
  initPalette();

  /* Badge counts follow the data: refresh (debounced) after any change. */
  let badgeTimer;
  store.addEventListener('change', () => {
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(renderNav, 300);
  });
}
