import { describe, it, expect } from 'vitest';
import {
  VIEW_KINDS, MAX_VIEWS, MAX_VIEW_NAME, viewKind,
  normalizeFilters, emptyFilters, isEmptyFilters, sameFilters, DEFAULT_DEAL_SORT,
  normalizeView, normalizeViewList, normalizeViews, viewsOf, viewById,
  defaultView, matchingView, applyFilters, describeFilters,
  reorderViews, withDefault, DEAL_SORT_COLUMNS, dealSortLabel,
} from '../src/lib/views.js';

describe('the lists that carry views', () => {
  it('is the three with filter machinery', () => {
    expect(VIEW_KINDS.map((k) => k.key)).toEqual(['contacts', 'companies', 'deals']);
    expect(viewKind('deals').hash).toBe('#/pipeline');
    expect(viewKind('activities')).toBeNull();
  });
});

describe('filter sets', () => {
  it('shapes each list around what it actually offers', () => {
    expect(normalizeFilters('contacts', {})).toEqual({
      query: '', tags: [], fields: {}, status: 'all',
    });
    expect(normalizeFilters('companies', {})).toEqual({ query: '', tags: [], fields: {} });
    expect(normalizeFilters('deals', {})).toEqual({
      query: '', tags: [], fields: {}, stage: 'open', closeWindow: 'any', sort: null,
    });
  });

  it('keeps what it is given, cleaned up', () => {
    expect(normalizeFilters('deals', {
      query: '  acme ', tags: ['vip', '', 7], fields: { plan: 'Pro', bad: '' },
      stage: 'proposal', closeWindow: 'month', sort: { key: 'value', dir: 'asc' },
    })).toEqual({
      query: 'acme', tags: ['vip'], fields: { plan: 'Pro' },
      stage: 'proposal', closeWindow: 'month', sort: { key: 'value', dir: 'asc' },
    });
    // A sort with no column is no sort at all.
    expect(normalizeFilters('deals', { sort: { dir: 'asc' } }).sort).toBeNull();
  });

  it('knows an unfiltered list from a filtered one', () => {
    expect(isEmptyFilters('contacts', {})).toBe(true);
    expect(isEmptyFilters('contacts', emptyFilters('contacts'))).toBe(true);
    expect(isEmptyFilters('contacts', { status: 'cold' })).toBe(false);
    expect(isEmptyFilters('deals', { tags: ['vip'] })).toBe(false);
  });

  it('reads the deals list opening sort as no sort at all', () => {
    // The deals list always carries a sort, so the set it hands over on a
    // page nobody has touched has to still count as unfiltered.
    const untouched = {
      query: '', tags: [], fields: {}, stage: 'open', closeWindow: 'any',
      sort: { ...DEFAULT_DEAL_SORT },
    };
    expect(isEmptyFilters('deals', untouched)).toBe(true);
    expect(sameFilters('deals', untouched, {})).toBe(true);
    // A sort the user actually chose is a filter set worth saving.
    expect(isEmptyFilters('deals', { ...untouched, sort: { key: 'value', dir: 'desc' } })).toBe(false);
    expect(sameFilters('deals', { sort: { key: 'value', dir: 'desc' } }, {})).toBe(false);
  });

  it('compares two sets without caring about tag order', () => {
    expect(sameFilters('contacts', { tags: ['a', 'b'] }, { tags: ['b', 'a'] })).toBe(true);
    expect(sameFilters('contacts', { tags: ['a'] }, { tags: ['a', 'b'] })).toBe(false);
    expect(sameFilters('deals', { stage: 'won' }, { stage: 'open' })).toBe(false);
  });

  it('compares two sets without caring about the order field filters were picked in', () => {
    expect(sameFilters('contacts',
      { fields: { plan: 'Pro', icp: 'Strong' } },
      { fields: { icp: 'Strong', plan: 'Pro' } })).toBe(true);
    expect(sameFilters('contacts',
      { fields: { plan: 'Pro', icp: 'Strong' } },
      { fields: { icp: 'Weak', plan: 'Pro' } })).toBe(false);
  });
});

describe('stored views', () => {
  const view = (over = {}) => ({ id: 'v1', name: 'Cold leads', filters: { status: 'cold' }, ...over });

  it('needs a name', () => {
    expect(normalizeView('contacts', { filters: {} })).toBeNull();
    expect(normalizeView('contacts', view()).name).toBe('Cold leads');
    expect(normalizeView('contacts', { name: 'x'.repeat(100) }).name).toHaveLength(MAX_VIEW_NAME);
  });

  it('caps a list and drops duplicate ids', () => {
    const many = Array.from({ length: 20 }, (_, i) => view({ id: `v${i}` }));
    expect(normalizeViewList('contacts', many)).toHaveLength(MAX_VIEWS);
    expect(normalizeViewList('contacts', [view(), view()])).toHaveLength(1);
  });

  it('lets only one view be the default', () => {
    const list = normalizeViewList('contacts', [
      view({ id: 'a', default: true }), view({ id: 'b', default: true }),
    ]);
    expect(list.map((v) => v.default)).toEqual([true, false]);
  });

  it('reads one list out of settings', () => {
    const settings = { views: { contacts: [view()], deals: [] } };
    expect(viewsOf(settings, 'contacts')).toHaveLength(1);
    expect(viewById(settings, 'contacts', 'v1').name).toBe('Cold leads');
    expect(viewsOf(settings, 'activities')).toEqual([]);
    expect(normalizeViews(null)).toEqual({ contacts: [], companies: [], deals: [] });
  });

  it('finds the default and the one matching what is on screen', () => {
    const settings = {
      views: {
        contacts: [view({ id: 'a' }), view({ id: 'b', name: 'Customers', filters: { status: 'customer' }, default: true })],
      },
    };
    expect(defaultView(settings, 'contacts').id).toBe('b');
    expect(matchingView(settings, 'contacts', { status: 'cold' }).id).toBe('a');
    expect(matchingView(settings, 'contacts', { status: 'lead' })).toBeNull();
    expect(defaultView({}, 'contacts')).toBeNull();
  });

  it('reorders and re-defaults without touching anything else', () => {
    const list = [view({ id: 'a' }), view({ id: 'b' }), view({ id: 'c' })];
    expect(reorderViews(list, 'c', -1).map((v) => v.id)).toEqual(['a', 'c', 'b']);
    expect(reorderViews(list, 'a', -1).map((v) => v.id)).toEqual(['a', 'b', 'c']);
    expect(withDefault(list, 'b').map((v) => v.default)).toEqual([false, true, false]);
    expect(withDefault(withDefault(list, 'b'), null).some((v) => v.default)).toBe(false);
  });
});

describe('applying a view whose conditions have outlived their subject', () => {
  it('drops a tag that no longer exists, and says so', () => {
    const { filters, dropped } = applyFilters('contacts',
      { status: 'cold', tags: ['vip', 'gone'] },
      { tags: ['VIP'] });
    expect(filters.tags).toEqual(['vip']);
    expect(filters.status).toBe('cold');
    expect(dropped).toEqual(['the tag “gone”']);
  });

  it('drops a stage that was removed, back to the open board', () => {
    const { filters, dropped } = applyFilters('deals',
      { stage: 'demo' }, { stages: ['new', 'won', 'lost'] });
    expect(filters.stage).toBe('open');
    expect(dropped).toEqual(['a stage that was removed']);
  });

  it('keeps the two pseudo-stages every board has', () => {
    for (const stage of ['open', 'all']) {
      expect(applyFilters('deals', { stage }, { stages: ['new'] }).dropped).toEqual([]);
    }
  });

  it('drops a custom field and a sort column that are gone', () => {
    const { filters, dropped } = applyFilters('deals',
      { fields: { plan: 'Pro', ghost: 'x' }, sort: { key: 'seats', dir: 'asc' } },
      { fields: ['plan'], sortKeys: ['name', 'value'] });
    expect(filters.fields).toEqual({ plan: 'Pro' });
    expect(filters.sort).toBeNull();
    expect(dropped).toEqual(['a field that was removed', 'a sort column that no longer exists']);
  });

  it('says each thing once, however many times it applies', () => {
    const { dropped } = applyFilters('deals',
      { fields: { a: '1', b: '2' } }, { fields: [] });
    expect(dropped).toEqual(['a field that was removed']);
  });

  it('checks nothing it wasn’t told about', () => {
    const { filters, dropped } = applyFilters('contacts', { tags: ['vip'] }, {});
    expect(filters.tags).toEqual(['vip']);
    expect(dropped).toEqual([]);
  });
});

describe('describeFilters', () => {
  it('says what a view is, in the words the list uses', () => {
    expect(describeFilters('contacts', { status: 'cold', tags: ['vip'] },
      { statusLabel: () => 'Going cold' })).toBe('Going cold · tag vip');
    expect(describeFilters('deals', { stage: 'proposal', closeWindow: 'month' },
      { stageLabel: () => 'Proposal' })).toBe('Proposal · month');
    expect(describeFilters('companies', { query: 'acme' })).toBe('“acme”');
    expect(describeFilters('contacts', {})).toBe('no filters');
  });

  it('names the close window and the sort column, not their stored values', () => {
    expect(describeFilters('deals',
      { closeWindow: 'month', sort: { key: 'expectedClose', dir: 'asc' } },
      { windowLabel: () => 'Closing this month' }))
      .toBe('Closing this month · sorted by Expected close');
    // No formatter given: the stored value is still all there is to say.
    expect(describeFilters('deals', { closeWindow: 'quarter' })).toBe('quarter');
  });
});

describe('deal sort columns', () => {
  it('names every column the deals table can sort on', () => {
    expect(DEAL_SORT_COLUMNS.map((c) => c.key)).toEqual(
      ['name', 'link', 'stage', 'value', 'expectedClose', 'updatedAt']);
    expect(DEAL_SORT_COLUMNS.some((c) => c.key === DEFAULT_DEAL_SORT.key)).toBe(true);
    expect(dealSortLabel('updatedAt')).toBe('Last updated');
  });

  it('hands back an unknown key rather than nothing', () => {
    expect(dealSortLabel('gone')).toBe('gone');
    expect(dealSortLabel(undefined)).toBe('');
  });
});
