// Effects feature: effect commands and dialogs, the Effects Rack panel,
// Favorites, and the Generate submenu.

import '../styles/effects.css';
import '../styles/effects-content.css';
import { registerIcons } from '../ui/icons.js';
import { installEffectCommands } from '../effects/commands.js';
import { effectsRackPanel, extendFileGraph, addToRack, applyRack, rackFor, setRack, installRackCommands } from '../effects/rack-panel.js';
import { installFavorites } from '../effects/favorites.js';
import { installGenerators } from '../effects/generate-ui.js';
import { restoreImpulses } from '../storage/impulses.js';
import '../effects/views/index.js';

export function installEffects(app) {
  registerIcons({
    // A rack: stacked slots with power dots.
    'fx-rack': [
      ['rect', { x: '3', y: '4', width: '18', height: '4', rx: '1' }],
      ['rect', { x: '3', y: '10', width: '18', height: '4', rx: '1' }],
      ['rect', { x: '3', y: '16', width: '18', height: '4', rx: '1' }],
      ['path', { d: 'M6 6h.01M6 12h.01M6 18h.01' }],
    ],
  });
  installEffectCommands(app);
  installRackCommands(app);
  installGenerators(app);
  installFavorites(app);
  // Impulses loaded into the reverbs in earlier visits; playing slots pick them up.
  restoreImpulses().then((names) => names.length && app.syncGraph?.());
  app.extendFileGraph = extendFileGraph;
  app.addToRack = (id, values) => addToRack(app, id, values);
  app.applyRack = () => applyRack(app);
  // The active audio file's rack (see effects/rack.js for its shape).
  app.effectsRack = {
    get: (doc = app.active) => (doc?.kind === 'audio' ? rackFor(doc) : null),
    set: (rack, doc = app.active) => doc?.kind === 'audio' && setRack(app, doc, rack),
  };
  app.registerPanel({
    id: 'effects',
    title: 'Effects Rack',
    create: effectsRackPanel,
    near: ['media', 'markers'],
    menu: (a) => [
      { type: 'cmd', label: 'Apply Rack', enabled: true, run: () => applyRack(a) },
    ],
  });
}
