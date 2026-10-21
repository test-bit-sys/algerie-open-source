// Custom dialog editors chosen by a definition's `display` key. Definitions
// stay plain data (they also load in the offline worker), so the editors are
// looked up here by name when a dialog opens.

import { autoEditor } from './editors.js';
import { dynamicsProcessingEditor, deesserEditor, multibandEditor } from './dyn-editors.js';
import { scientificEditor } from './filter-editors.js';

const DISPLAYS = {
  dynamicsProcessing: () => dynamicsProcessingEditor(),
  deesser: () => deesserEditor(),
  multiband: () => multibandEditor(),
  scientific: () => scientificEditor(),
  none: () => null,
};

/** The editor for a definition: its `display`, else the automatic choice (editors.js). */
export function editorFor(def) {
  if (def.editor) return def.editor;
  const make = DISPLAYS[def.display];
  return make ? make() : autoEditor(def);
}
