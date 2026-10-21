// Built-in workspace layouts (see dock.js for the tree format). The app picks
// the phone or tablet layout automatically on narrow screens; on desktop the
// user chooses a workspace and may save their own.

const g = (tabs, a = tabs[0]) => ({ t: 'group', tabs, a });
const row = (c, s) => ({ t: 'row', c, s: s || c.map(() => 1) });
const col = (c, s) => ({ t: 'col', c, s: s || c.map(() => 1) });

// Listed alphabetically, as in Window > Workspace.
export const WORKSPACES = {
  'Advanced Mixing': () =>
    row(
      [
        col([g(['tracks', 'files']), g(['trackPanner', 'properties'])], [1.1, 1]),
        col([g(['editor', 'mixer'], 'mixer'), row([g(['levels']), g(['time']), g(['transport'])], [3, 1.1, 1.2])], [5, 1]),
        col([g(['effects', 'assistant']), g(['history', 'events'])], [1.6, 1]),
      ],
      [1, 3.6, 1.1],
    ),
  Classic: () =>
    row(
      [
        col([g(['files', 'effects', 'favorites']), g(['history', 'markers', 'playlist'])], [1.3, 1]),
        col([g(['editor', 'mixer']), row([g(['transport']), g(['zoom']), g(['time']), g(['selection'])], [1.1, 1.2, 1, 1.3]), g(['levels'])], [6, 1, 0.9]),
      ],
      [1, 4],
    ),
  // Files and browsers on the left, the editor with the sound assistant beside
  // it, and the meters along the bottom next to Selection/View.
  Default: () =>
    row(
      [
        col([g(['files', 'favorites']), g(['media', 'effects', 'markers', 'properties']), g(['history', 'video'])], [295, 457, 160]),
        col(
          [
            row([g(['editor', 'mixer']), g(['assistant'])], [980, 482]),
            row([g(['levels']), g(['selection'])], [1100, 365]),
          ],
          [5.6, 1],
        ),
      ],
      [427, 1473],
    ),
  // The picture above the full-width editor, media and details beside it.
  'Edit Audio to Video': () =>
    col(
      [
        row([g(['files', 'media', 'markers']), g(['video']), g(['properties', 'history', 'effects'])], [1.1, 2.4, 1.1]),
        g(['editor', 'mixer']),
        row([g(['levels']), g(['selection', 'time'])], [3.4, 1]),
      ],
      [2.3, 2.8, 0.6],
    ),
  // Mixing dialogue, music and effects to picture with the sound assistant.
  'Essential Video Mixing': () =>
    row(
      [
        col([g(['files', 'media']), g(['video'])], [1, 1.1]),
        col([g(['editor', 'mixer']), g(['levels'])], [6, 1]),
        col([g(['assistant', 'properties']), g(['history', 'markers'])], [2.4, 1]),
      ],
      [1.3, 3.2, 1.2],
    ),
  Loudness: () =>
    row(
      [
        col([g(['files', 'effects', 'favorites']), g(['amplitude', 'history'])], [1.4, 1]),
        col([g(['editor', 'mixer']), row([g(['loudness']), g(['phaseAnalysis', 'phase', 'frequency']), col([g(['time']), g(['selection'])])], [1.6, 1.2, 1])], [2.2, 1]),
        col([g(['levels'])]),
      ],
      [1, 3.4, 0.4],
    ),
  'Mastering and Analysis': () =>
    row(
      [
        col([g(['effects', 'files']), g(['amplitude', 'history', 'events'])], [1.6, 1]),
        col([g(['editor', 'mixer']), row([g(['frequency']), g(['phaseAnalysis', 'loudness'])], [1.6, 1]), g(['phase'])], [2.4, 1, 0.22]),
        col([g(['levels'])]),
      ],
      [1, 3.4, 0.35],
    ),
  // Meant for a second window: here, the editor gets nearly all of the space
  // and the browsers fold into one narrow column.
  'Maximum Editing (Dual Monitor)': () =>
    row(
      [
        col([g(['editor', 'mixer']), row([g(['levels']), g(['selection'])], [4, 1])], [9, 1]),
        col([g(['files', 'media', 'favorites']), g(['effects', 'markers', 'properties']), g(['history', 'video'])], [1, 1.2, 0.7]),
      ],
      [5, 1],
    ),
  'Radio Production': () =>
    row(
      [
        col([g(['files', 'media', 'tracks']), g(['favorites', 'markers', 'playlist'])], [1, 1]),
        col([g(['editor', 'mixer']), row([g(['levels']), g(['selection'])], [3, 1])], [5, 1]),
        col([g(['assistant', 'properties', 'effects']), g(['trackPanner', 'time'])], [2.6, 1]),
      ],
      [1, 3.6, 1.1],
    ),
  Restoration: () =>
    row(
      [
        col([g(['diagnostics', 'effects']), g(['history', 'markers'])], [1.6, 1]),
        col([g(['editor', 'mixer']), row([g(['levels']), g(['zoom']), g(['selection'])], [2.4, 1.3, 1])], [5, 1]),
        col([g(['frequency', 'amplitude']), g(['properties', 'events'])], [1.3, 1]),
      ],
      [1.1, 3.6, 1.2],
    ),
  'Simple Editing': () =>
    row(
      [
        col([g(['files', 'markers']), g(['history'])], [1.6, 1]),
        col([g(['editor', 'mixer']), row([g(['transport']), g(['time']), g(['levels'])], [1, 1, 2])], [5, 1]),
      ],
      [1, 4],
    ),
};

/** Layout for tablets in portrait or narrow windows (about 700 to 1100 px). */
export const TABLET = () =>
  row(
    [
      col([g(['editor', 'mixer']), g(['levels'])], [6, 1]),
      col([g(['files', 'effects', 'favorites', 'media', 'tracks']), g(['properties', 'assistant', 'markers', 'history', 'selection', 'trackPanner'])], [1, 1]),
    ],
    [3, 1.15],
  );

/** Layout for phones: the editor on top, every other panel as tabs below. */
export const PHONE = () =>
  col(
    [
      g(['editor', 'mixer']),
      g(['levels', 'files', 'effects', 'markers', 'history', 'properties', 'selection', 'favorites', 'assistant', 'media', 'tracks', 'trackPanner']),
    ],
    [3, 1.5],
  );

export const DEFAULT_WORKSPACE = 'Default';

/** Workspaces shown as toolbar tabs until the user picks their own. */
export const DEFAULT_TABS = ['Default', 'Edit Audio to Video', 'Radio Production'];

/**
 * Bumped when the built-in layouts change, so panels a user moved around
 * under the old arrangement do not keep the new one from showing.
 */
export const LAYOUT_VERSION = 2;
