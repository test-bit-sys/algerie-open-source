/**
 * DZ-Boards — Engine & Templates Unit Tests
 * 100% Offline-First, Zero-Dependency Test Suite (node:test)
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// In-memory localStorage mock for headless Node.js testing
class MemoryStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

globalThis.localStorage = new MemoryStorage();

// Import BoardEngine after mocking localStorage
const { BoardEngine } = await import('../src/board-engine.js');
const { ALGERIAN_TEMPLATES } = await import('../src/templates.js');

describe('DZ-Boards Engine & Workflow Tests', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  test('Initializes with default Algerian PFE template when storage is empty', () => {
    const engine = new BoardEngine();
    const board = engine.getBoard();

    assert.ok(board);
    assert.strictEqual(board.id, 'pfe');
    assert.ok(board.columns.length >= 3);
    assert.ok(board.title.includes('PFE'));
  });

  test('Can switch between Algerian national templates (PFE, Startup, Sprint)', () => {
    const engine = new BoardEngine();

    engine.loadTemplate('startup');
    assert.strictEqual(engine.getBoard().id, 'startup');
    assert.ok(engine.getBoard().title.includes('ناشئة') || engine.getBoard().title.includes('E-Commerce'));

    engine.loadTemplate('sprint');
    assert.strictEqual(engine.getBoard().id, 'sprint');
    assert.ok(engine.getBoard().title.includes('Sprint'));

    engine.loadTemplate('pfe');
    assert.strictEqual(engine.getBoard().id, 'pfe');
  });

  test('Column CRUD operations work and trigger storage save', () => {
    let changeNotified = false;
    const engine = new BoardEngine(() => {
      changeNotified = true;
    });

    // Add Column
    const colId = engine.addColumn('عمود المراجعة القانونية', '#10b981');
    assert.ok(colId.startsWith('col-'));
    assert.strictEqual(changeNotified, true);

    const board = engine.getBoard();
    const added = board.columns.find(c => c.id === colId);
    assert.ok(added);
    assert.strictEqual(added.title, 'عمود المراجعة القانونية');
    assert.strictEqual(added.color, '#10b981');
    assert.deepStrictEqual(added.cards, []);

    // Update Column
    engine.updateColumn(colId, { title: 'المراجعة الجبائية والمالية', color: '#f59e0b' });
    assert.strictEqual(added.title, 'المراجعة الجبائية والمالية');
    assert.strictEqual(added.color, '#f59e0b');

    // Delete Column
    const deleted = engine.deleteColumn(colId);
    assert.strictEqual(deleted, true);
    assert.strictEqual(board.columns.some(c => c.id === colId), false);
  });

  test('Card CRUD operations within columns', () => {
    const engine = new BoardEngine();
    const firstCol = engine.getBoard().columns[0];
    const initialCount = firstCol.cards.length;

    // Add Card
    const newCard = engine.addCard(firstCol.id, {
      title: 'استخراج وثيقة السجل التجاري CNRC',
      description: 'إيداع الملف بالمركز الوطني للسجل التجاري والحصول على الرمز 607001',
      priority: 'urgent',
      dueDate: '2026-11-20',
      tags: ['CNRC', 'قانوني'],
      checklist: [{ id: 'chk-1', text: 'دفع الرسوم', done: true }]
    });

    assert.ok(newCard);
    assert.ok(newCard.id.startsWith('card-'));
    assert.strictEqual(newCard.priority, 'urgent');
    assert.strictEqual(firstCol.cards.length, initialCount + 1);

    // Update Card
    engine.updateCard(firstCol.id, newCard.id, {
      title: 'استخراج السجل التجاري مع الرمز الإلكتروني',
      priority: 'high'
    });
    assert.strictEqual(newCard.title, 'استخراج السجل التجاري مع الرمز الإلكتروني');
    assert.strictEqual(newCard.priority, 'high');

    // Delete Card with fallback across columns
    const deleted = engine.deleteCard(null, newCard.id);
    assert.strictEqual(deleted, true);
    assert.strictEqual(firstCol.cards.length, initialCount);
  });

  test('Card Movement and Drag-and-Drop between columns', () => {
    const engine = new BoardEngine();
    const colA = engine.getBoard().columns[0];
    const colB = engine.getBoard().columns[1];

    const card = engine.addCard(colA.id, { title: 'مهمة متنقلة' });
    assert.ok(colA.cards.some(c => c.id === card.id));
    assert.ok(!colB.cards.some(c => c.id === card.id));

    // Move to colB
    engine.moveCard(card.id, colA.id, colB.id);
    assert.ok(!colA.cards.some(c => c.id === card.id));
    assert.ok(colB.cards.some(c => c.id === card.id));

    // Move back to colA at position 0
    engine.moveCard(card.id, colB.id, colA.id, 0);
    assert.strictEqual(colA.cards[0].id, card.id);
  });

  test('Checklist toggle and modification', () => {
    const engine = new BoardEngine();
    const col = engine.getBoard().columns[0];
    const card = engine.addCard(col.id, { title: 'مهمة مع قائمة تحقق' });

    engine.addChecklistItem(col.id, card.id, 'البند الأول');
    assert.strictEqual(card.checklist.length, 1);
    assert.strictEqual(card.checklist[0].done, false);

    const checkId = card.checklist[0].id;
    engine.toggleChecklist(col.id, card.id, checkId);
    assert.strictEqual(card.checklist[0].done, true);

    engine.deleteChecklistItem(col.id, card.id, checkId);
    assert.strictEqual(card.checklist.length, 0);
  });

  test('Statistics and completion rate metrics calculation', () => {
    const engine = new BoardEngine();
    engine.loadTemplate('pfe');

    const stats = engine.getStatistics();
    assert.ok(stats.totalCards > 0);
    assert.ok(typeof stats.completionRate === 'number');
    assert.ok(stats.completionRate >= 0 && stats.completionRate <= 100);
    assert.ok(typeof stats.urgentCards === 'number');
    assert.ok(typeof stats.totalCheckItems === 'number');
  });

  test('JSON export and import round-trip', () => {
    const engine1 = new BoardEngine();
    engine1.setBoardTitle('لوحة اختبار السيادة الوطنية');
    const jsonStr = engine1.exportJSON();
    assert.ok(jsonStr.includes('لوحة اختبار السيادة الوطنية'));

    const engine2 = new BoardEngine();
    const imported = engine2.importJSON(jsonStr);
    assert.strictEqual(imported, true);
    assert.strictEqual(engine2.getBoard().title, 'لوحة اختبار السيادة الوطنية');
  });

  test('CSV export contains UTF-8 BOM, headers, and Algerian card details', () => {
    const engine = new BoardEngine();
    const csv = engine.exportCSV();

    // Check UTF-8 BOM
    assert.ok(csv.startsWith('\uFEFF'));
    // Check Headers
    assert.ok(csv.includes('Column,Card ID,Title,Priority,Due Date,Tags,Checklist Progress,Description'));
  });
});
