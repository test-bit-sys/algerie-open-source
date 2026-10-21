/**
 * DZ-Boards — Kanban Engine
 * High-performance, offline-first state engine for columns, tasks, drag-and-drop, and metrics.
 */

import { ALGERIAN_TEMPLATES } from './templates.js';

const STORAGE_KEY = 'dz_boards_state_v1';

export class BoardEngine {
  constructor(onChange) {
    this.onChange = onChange || (() => {});
    this.board = this.loadFromStorage();
  }

  loadFromStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.columns && Array.isArray(parsed.columns)) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to load board from storage, falling back to PFE template:', e);
    }
    // Default to Algerian PFE template
    return JSON.parse(JSON.stringify(ALGERIAN_TEMPLATES.pfe));
  }

  saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.board));
    } catch (e) {
      console.error('Failed to save board to localStorage:', e);
    }
    this.onChange();
  }

  loadTemplate(templateKey) {
    if (ALGERIAN_TEMPLATES[templateKey]) {
      this.board = JSON.parse(JSON.stringify(ALGERIAN_TEMPLATES[templateKey]));
      this.saveToStorage();
    }
  }

  getBoard() {
    return this.board;
  }

  setBoardTitle(title) {
    this.board.title = title;
    this.saveToStorage();
  }

  addColumn(title, color = '#64748b') {
    const colId = 'col-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
    this.board.columns.push({
      id: colId,
      title: title || 'عمود جديد',
      color: color,
      cards: []
    });
    this.saveToStorage();
    return colId;
  }

  updateColumn(columnId, patch) {
    const col = this.board.columns.find(c => c.id === columnId);
    if (col) {
      Object.assign(col, patch);
      this.saveToStorage();
    }
  }

  deleteColumn(columnId) {
    const idx = this.board.columns.findIndex(c => c.id === columnId);
    if (idx !== -1) {
      this.board.columns.splice(idx, 1);
      this.saveToStorage();
      return true;
    }
    return false;
  }

  addCard(columnId, cardData) {
    const col = this.board.columns.find(c => c.id === columnId);
    if (!col) return null;

    const newCard = {
      id: 'card-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
      title: cardData.title || 'مهمة جديدة',
      description: cardData.description || '',
      priority: cardData.priority || 'medium', // low, medium, high, urgent
      dueDate: cardData.dueDate || '',
      tags: Array.isArray(cardData.tags) ? cardData.tags : [],
      checklist: Array.isArray(cardData.checklist) ? cardData.checklist : [],
      createdAt: new Date().toISOString()
    };

    col.cards.push(newCard);
    this.saveToStorage();
    return newCard;
  }

  updateCard(columnId, cardId, patch) {
    const col = this.board.columns.find(c => c.id === columnId);
    if (!col) return;
    const card = col.cards.find(c => c.id === cardId);
    if (card) {
      Object.assign(card, patch);
      this.saveToStorage();
    }
  }

  deleteCard(columnId, cardId) {
    if (columnId) {
      const col = this.board.columns.find(c => c.id === columnId);
      if (col) {
        const idx = col.cards.findIndex(c => c.id === cardId);
        if (idx !== -1) {
          col.cards.splice(idx, 1);
          this.saveToStorage();
          return true;
        }
      }
    }
    // Fallback: search across all columns
    for (const col of this.board.columns) {
      const idx = col.cards.findIndex(c => c.id === cardId);
      if (idx !== -1) {
        col.cards.splice(idx, 1);
        this.saveToStorage();
        return true;
      }
    }
    return false;
  }

  moveCard(cardId, fromColumnId, toColumnId, targetIndex = -1) {
    const fromCol = this.board.columns.find(c => c.id === fromColumnId);
    const toCol = this.board.columns.find(c => c.id === toColumnId);
    if (!fromCol || !toCol) return;

    const cardIdx = fromCol.cards.findIndex(c => c.id === cardId);
    if (cardIdx === -1) return;

    const [card] = fromCol.cards.splice(cardIdx, 1);

    if (targetIndex >= 0 && targetIndex <= toCol.cards.length) {
      toCol.cards.splice(targetIndex, 0, card);
    } else {
      toCol.cards.push(card);
    }

    this.saveToStorage();
  }

  toggleChecklist(columnId, cardId, checkId) {
    const col = this.board.columns.find(c => c.id === columnId);
    if (!col) return;
    const card = col.cards.find(c => c.id === cardId);
    if (!card || !card.checklist) return;
    const item = card.checklist.find(i => i.id === checkId);
    if (item) {
      item.done = !item.done;
      this.saveToStorage();
    }
  }

  addChecklistItem(columnId, cardId, text) {
    const col = this.board.columns.find(c => c.id === columnId);
    if (!col) return;
    const card = col.cards.find(c => c.id === cardId);
    if (!card) return;
    if (!card.checklist) card.checklist = [];

    card.checklist.push({
      id: 'chk-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 3),
      text: text,
      done: false
    });
    this.saveToStorage();
  }

  deleteChecklistItem(columnId, cardId, checkId) {
    const col = this.board.columns.find(c => c.id === columnId);
    if (!col) return;
    const card = col.cards.find(c => c.id === cardId);
    if (!card || !card.checklist) return;
    const idx = card.checklist.findIndex(i => i.id === checkId);
    if (idx !== -1) {
      card.checklist.splice(idx, 1);
      this.saveToStorage();
    }
  }

  getStatistics() {
    let totalCards = 0;
    let completedCards = 0;
    let inProgressCards = 0;
    let urgentCards = 0;
    let totalCheckItems = 0;
    let doneCheckItems = 0;

    const lastCol = this.board.columns[this.board.columns.length - 1];

    this.board.columns.forEach((col, idx) => {
      const isDoneColumn = (idx === this.board.columns.length - 1) || 
                           col.title.toLowerCase().includes('done') || 
                           col.title.includes('مكتمل') || 
                           col.title.includes('منجز');

      col.cards.forEach(card => {
        totalCards++;
        if (card.priority === 'urgent') urgentCards++;

        if (isDoneColumn) {
          completedCards++;
        } else if (idx > 0) {
          inProgressCards++;
        }

        if (card.checklist && card.checklist.length > 0) {
          card.checklist.forEach(chk => {
            totalCheckItems++;
            if (chk.done) doneCheckItems++;
          });
        }
      });
    });

    const completionRate = totalCards > 0 ? Math.round((completedCards / totalCards) * 100) : 0;
    const checkRate = totalCheckItems > 0 ? Math.round((doneCheckItems / totalCheckItems) * 100) : 0;

    return {
      totalCards,
      completedCards,
      inProgressCards,
      urgentCards,
      completionRate,
      totalCheckItems,
      doneCheckItems,
      checkRate
    };
  }

  exportJSON() {
    return JSON.stringify(this.board, null, 2);
  }

  importJSON(jsonInput) {
    try {
      const data = typeof jsonInput === 'string' ? JSON.parse(jsonInput) : jsonInput;
      if (data && data.columns && Array.isArray(data.columns)) {
        this.board = data;
        this.saveToStorage();
        return true;
      }
    } catch (e) {
      console.error('Invalid board JSON:', e);
    }
    return false;
  }

  exportCSV() {
    const headers = ['Column', 'Card ID', 'Title', 'Priority', 'Due Date', 'Tags', 'Checklist Progress', 'Description'];
    const rows = [headers.join(',')];

    this.board.columns.forEach(col => {
      col.cards.forEach(card => {
        const totalChecks = card.checklist ? card.checklist.length : 0;
        const doneChecks = card.checklist ? card.checklist.filter(c => c.done).length : 0;
        const checkStr = totalChecks > 0 ? `"${doneChecks}/${totalChecks}"` : '"N/A"';
        const tagsStr = `"${(card.tags || []).join('; ')}"`;
        const descStr = `"${(card.description || '').replace(/"/g, '""')}"`;
        const titleStr = `"${(card.title || '').replace(/"/g, '""')}"`;

        rows.push([
          `"${col.title.replace(/"/g, '""')}"`,
          `"${card.id}"`,
          titleStr,
          `"${card.priority}"`,
          `"${card.dueDate || ''}"`,
          tagsStr,
          checkStr,
          descStr
        ].join(','));
      });
    });

    return '\uFEFF' + rows.join('\r\n');
  }
}
