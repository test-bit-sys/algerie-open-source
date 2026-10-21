/**
 * A space is one tree of pages with one storage and one set of people:
 * your private pages, or a shared space that lives on a collaboration
 * server. Both expose the same documents (Y.Doc) to the editor:
 *
 *   'tree'            the page tree (titles, icons, order)
 *   '<pageId>'        a page's blocks, or a database's schema and rows
 *   '<pageId>.c'      a page's comments
 */
import { Emitter } from '../lib/emitter.js';

export const ROLE_LABELS = { owner: 'Owner', editor: 'Can edit', commenter: 'Can comment', viewer: 'Can view' };
export const canEdit = (role) => role === 'owner' || role === 'editor';
export const canComment = (role) => canEdit(role) || role === 'commenter';
export const canManage = (role) => role === 'owner';

export const DOC_ID = /^(tree|[a-z0-9]{1,40}(\.c)?)$/;

export class Space extends Emitter {
  constructor({ id, kind, role = 'owner' }) {
    super();
    this.id = id;
    this.kind = kind;
    this.role = role;
    this.status = 'saved';
    this.tree = null;
  }

  get canEdit() {
    return canEdit(this.role);
  }

  get canComment() {
    return canComment(this.role);
  }

  get canManage() {
    return canManage(this.role);
  }

  setStatus(status, detail = null) {
    if (this.status === status && !detail) return;
    this.status = status;
    this.emit('status', status, detail);
  }

  /** Documents on screen; others need not be kept up to date. */
  hold(id) {
    this.held ||= new Map();
    this.held.set(id, (this.held.get(id) || 0) + 1);
  }

  release(id) {
    const n = (this.held?.get(id) || 0) - 1;
    if (n > 0) this.held.set(id, n);
    else this.held?.delete(id);
  }

  isHeld(id) {
    return id === 'tree' || !!this.held?.has(id);
  }

  setRole(role) {
    if (role === this.role) return;
    this.role = role;
    this.emit('role', role);
  }
}
