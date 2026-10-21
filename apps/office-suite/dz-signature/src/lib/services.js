/** App-wide singletons wired to the store. Views import these; tests build
 *  their own instances with injected fakes. */

import { store } from './store.js';
import { createSignLinks } from './signlinks.js';
import { createEmailer } from './emailer.js';

export const signlinks = createSignLinks({ store });
export const emailer = createEmailer({ store });
