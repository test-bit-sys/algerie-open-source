/**
 * DZ-Boards (DZ-Kanban / استوديو إدارة المهام والمشاريع) — Application Logic
 * 100% Offline-First, Zero-Dependency, Pure ES Modules, Sovereign Algerian Workspace
 */

import { BoardEngine } from './board-engine.js';
import { ALGERIAN_TEMPLATES } from './templates.js';

const I18N = {
  ar: {
    appTitle: 'لوحات وإدارة المهام — DZ-Boards Pro',
    brandBadge: 'سيادي حر',
    templates: 'نماذج المشاريع الجزائرية',
    newColumn: 'إضافة عمود',
    exportBoard: 'تصدير اللوحة',
    importBoard: 'استيراد لوحة',
    searchPlaceholder: 'بحث في المهام والوسوم...',
    filterAll: 'كافة الأولويات',
    filterUrgent: 'عاجل جداً',
    filterHigh: 'أولوية عالية',
    filterMedium: 'أولوية متوسطة',
    filterLow: 'أولوية منخفضة',
    statTotal: 'إجمالي المهام:',
    statProgress: 'قيد التنفيذ:',
    statUrgent: 'مهام عاجلة:',
    statDone: 'مكتملة:',
    addCard: 'إضافة مهمة جديدة',
    editCardTitle: 'تفاصيل ومتابعة المهمة',
    newCardTitle: 'إنشاء مهمة جديدة',
    titleLabel: 'عنوان المهمة:',
    descLabel: 'الوصف والتفاصيل:',
    priorityLabel: 'درجة الأولوية:',
    dueDateLabel: 'تاريخ الاستحقاق:',
    tagsLabel: 'الوسوم (مفصولة بفواصل):',
    checklistTitle: 'قائمة التحقق الفرعية (Checklist):',
    addCheckitem: 'إضافة بند...',
    save: 'حفظ التعديلات',
    cancel: 'إلغاء',
    delete: 'حذف',
    aboutTitle: 'عن منصة DZ-Boards',
    aboutDesc: 'منصة إدارة مهام ومشاريع كانبان سيادية حرة ومفتوحة المصدر 100% جزائرية، بديل كامل لـ Trello و Jira و Focalboard مع قوالب جاهزة لمشاريع التخرج والشركات الناشئة الوطنية.',
    close: 'إغلاق'
  },
  fr: {
    appTitle: 'DZ-Boards — Plateforme Kanban Souveraine',
    brandBadge: 'Souverain',
    templates: 'Modèles Algériens',
    newColumn: 'Ajouter une colonne',
    exportBoard: 'Exporter le tableau',
    importBoard: 'Importer un tableau',
    searchPlaceholder: 'Rechercher tâches, tags...',
    filterAll: 'Toutes les priorités',
    filterUrgent: 'Très urgent',
    filterHigh: 'Priorité haute',
    filterMedium: 'Priorité moyenne',
    filterLow: 'Priorité basse',
    statTotal: 'Total tâches :',
    statProgress: 'En cours :',
    statUrgent: 'Urgentes :',
    statDone: 'Terminées :',
    addCard: 'Ajouter une tâche',
    editCardTitle: 'Détails de la tâche',
    newCardTitle: 'Créer une tâche',
    titleLabel: 'Titre de la tâche :',
    descLabel: 'Description & détails :',
    priorityLabel: 'Priorité :',
    dueDateLabel: 'Date d\'échéance :',
    tagsLabel: 'Tags (séparés par virgules) :',
    checklistTitle: 'Sous-tâches (Checklist) :',
    addCheckitem: 'Ajouter un sous-élément...',
    save: 'Enregistrer',
    cancel: 'Annuler',
    delete: 'Supprimer',
    aboutTitle: 'À propos de DZ-Boards',
    aboutDesc: 'Plateforme Kanban et de gestion de projets souveraine, 100% open-source algérienne, alternative complète à Trello et Jira avec modèles PFE et Startups.',
    close: 'Fermer'
  },
  en: {
    appTitle: 'DZ-Boards — Sovereign Kanban Studio',
    brandBadge: 'Sovereign',
    templates: 'Algerian Templates',
    newColumn: 'Add Column',
    exportBoard: 'Export Board',
    importBoard: 'Import Board',
    searchPlaceholder: 'Search tasks, tags...',
    filterAll: 'All Priorities',
    filterUrgent: 'Urgent',
    filterHigh: 'High Priority',
    filterMedium: 'Medium Priority',
    filterLow: 'Low Priority',
    statTotal: 'Total Tasks:',
    statProgress: 'In Progress:',
    statUrgent: 'Urgent Tasks:',
    statDone: 'Completed:',
    addCard: 'Add New Task',
    editCardTitle: 'Task Details',
    newCardTitle: 'Create New Task',
    titleLabel: 'Task Title:',
    descLabel: 'Description & Notes:',
    priorityLabel: 'Priority Level:',
    dueDateLabel: 'Due Date:',
    tagsLabel: 'Tags (comma separated):',
    checklistTitle: 'Subtasks Checklist:',
    addCheckitem: 'Add checklist item...',
    save: 'Save Changes',
    cancel: 'Cancel',
    delete: 'Delete',
    aboutTitle: 'About DZ-Boards',
    aboutDesc: '100% offline-first sovereign Kanban & project management suite, Trello & Jira alternative tailored with Algerian graduation and startup blueprints.',
    close: 'Close'
  }
};

export class DZBoardsApp {
  constructor() {
    this.currentLang = localStorage.getItem('dz_boards_lang') || 'ar';
    this.searchQuery = '';
    this.priorityFilter = 'all';

    this.activeEditingColumnId = null;
    this.activeEditingCardId = null;

    this.engine = new BoardEngine(() => {
      this.render();
    });

    this.init();
  }

  init() {
    this.bindEvents();
    this.applyLanguage(this.currentLang);
    this.render();
  }

  bindEvents() {
    // Search input
    const searchInput = document.getElementById('searchQueryInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.toLowerCase().trim();
        this.render();
      });
    }

    // Priority filter
    const prioritySelect = document.getElementById('priorityFilterSelect');
    if (prioritySelect) {
      prioritySelect.addEventListener('change', (e) => {
        this.priorityFilter = e.target.value;
        this.render();
      });
    }

    // Add Column Button
    document.getElementById('btnAddColumn')?.addEventListener('click', () => {
      const title = prompt('أدخل اسم العمود الجديد:', 'قيد المراجعة');
      if (title && title.trim()) {
        this.engine.addColumn(title.trim());
      }
    });

    // Templates Dropdown triggers
    document.querySelectorAll('[data-template]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-template');
        if (confirm('هل ترغب في استبدال اللوحة الحالية بنموذج المشروع الجزائري المحدد؟')) {
          this.engine.loadTemplate(key);
        }
      });
    });

    // Language switcher
    document.querySelectorAll('[data-lang]').forEach(btn => {
      btn.addEventListener('click', () => this.setLanguage(btn.getAttribute('data-lang')));
    });

    // Export JSON
    document.getElementById('btnExportJson')?.addEventListener('click', () => {
      const json = this.engine.exportJSON();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dz-board-${Date.now()}.dzboard`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    // Export CSV
    document.getElementById('btnExportCsv')?.addEventListener('click', () => {
      const csv = this.engine.exportCSV();
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dz-board-tasks-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    // Import JSON File
    const importInput = document.getElementById('boardFileInput');
    document.getElementById('btnImportBoard')?.addEventListener('click', () => importInput?.click());
    importInput?.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          if (this.engine.importJSON(evt.target.result)) {
            alert('تم استيراد اللوحة بنجاح.');
          } else {
            alert('خطأ في استيراد ملف اللوحة.');
          }
        };
        reader.readAsText(e.target.files[0]);
      }
      importInput.value = '';
    });

    // Card Modal Save / Delete / Close
    document.getElementById('btnSaveCardModal')?.addEventListener('click', () => this.saveCardModal());
    document.getElementById('btnDeleteCardModal')?.addEventListener('click', () => {
      if (confirm('هل أنت متأكد من حذف هذه المهمة نهائياً؟')) {
        this.engine.deleteCard(this.activeEditingColumnId, this.activeEditingCardId);
        this.closeModals();
      }
    });

    // Add Checklist item inside modal
    const handleAddChecklist = () => {
      const inp = document.getElementById('newChecklistInput');
      if (inp && inp.value.trim()) {
        this.addModalChecklistItem(inp.value.trim());
        inp.value = '';
      }
    };
    document.getElementById('btnAddChecklistInputBtn')?.addEventListener('click', handleAddChecklist);
    document.getElementById('newChecklistInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddChecklist();
      }
    });

    // Modal Closers
    document.querySelectorAll('.modal-close, .modal-backdrop').forEach(el => {
      el.addEventListener('click', () => this.closeModals());
    });

    // About modal
    document.getElementById('btnOpenAbout')?.addEventListener('click', () => {
      document.getElementById('modalAbout')?.classList.add('active');
    });
  }

  closeModals() {
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
    this.activeEditingColumnId = null;
    this.activeEditingCardId = null;
  }

  render() {
    this.renderStats();
    this.renderBoardTitle();
    this.renderColumns();
  }

  renderBoardTitle() {
    const titleEl = document.getElementById('boardTitleDisplay');
    if (titleEl) {
      titleEl.textContent = this.engine.board.title || 'لوحة المهام والمشاريع';
    }
  }

  renderStats() {
    const stats = this.engine.getStatistics();
    document.getElementById('statTotalVal').textContent = stats.totalCards;
    document.getElementById('statProgressVal').textContent = stats.inProgressCards;
    document.getElementById('statUrgentVal').textContent = stats.urgentCards;
    document.getElementById('statDoneVal').textContent = stats.completedCards;
    document.getElementById('statPercentageVal').textContent = `${stats.completionRate}%`;

    const progressFill = document.getElementById('statProgressBarFill');
    if (progressFill) {
      progressFill.style.width = `${stats.completionRate}%`;
    }
  }

  renderColumns() {
    const boardEl = document.getElementById('kanbanBoard');
    if (!boardEl) return;
    boardEl.innerHTML = '';

    const board = this.engine.getBoard();

    board.columns.forEach((col) => {
      const colEl = document.createElement('div');
      colEl.className = 'kanban-column';
      colEl.setAttribute('data-column-id', col.id);

      // Filter cards
      const visibleCards = col.cards.filter(c => {
        if (this.priorityFilter !== 'all' && c.priority !== this.priorityFilter) {
          return false;
        }
        if (this.searchQuery) {
          const matchTitle = (c.title || '').toLowerCase().includes(this.searchQuery);
          const matchDesc = (c.description || '').toLowerCase().includes(this.searchQuery);
          const matchTags = (c.tags || []).some(t => t.toLowerCase().includes(this.searchQuery));
          return matchTitle || matchDesc || matchTags;
        }
        return true;
      });

      colEl.innerHTML = `
        <div class="column-header">
          <div class="col-title-group">
            <span class="col-color-dot" style="background-color: ${col.color || '#64748b'};"></span>
            <span class="col-title">${col.title}</span>
            <span class="col-counter">${visibleCards.length}</span>
          </div>
          <div class="col-actions">
            <button class="col-btn-action btn-add-card" title="إضافة مهمة">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
            <button class="col-btn-action btn-del-col" title="حذف العمود">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </div>

        <div class="column-cards-container" data-droptarget="true">
          <!-- Cards injected below -->
        </div>

        <button class="btn-col-bottom-add">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          <span data-i18n="addCard">إضافة مهمة جديدة</span>
        </button>
      `;

      // Column events
      colEl.querySelector('.btn-add-card').addEventListener('click', () => this.openAddCardModal(col.id));
      colEl.querySelector('.btn-col-bottom-add').addEventListener('click', () => this.openAddCardModal(col.id));
      colEl.querySelector('.btn-del-col').addEventListener('click', () => {
        if (confirm(`هل أنت متأكد من حذف العمود "${col.title}" وما يحتويه من مهام؟`)) {
          this.engine.deleteColumn(col.id);
        }
      });

      // Cards list
      const cardsContainer = colEl.querySelector('.column-cards-container');

      // Drag and Drop listeners on the column container
      cardsContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        cardsContainer.classList.add('drag-over');
      });

      cardsContainer.addEventListener('dragleave', () => {
        cardsContainer.classList.remove('drag-over');
      });

      cardsContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        cardsContainer.classList.remove('drag-over');
        try {
          const raw = e.dataTransfer.getData('text/plain');
          if (raw) {
            const data = JSON.parse(raw);
            if (data.cardId && data.fromColumnId) {
              this.engine.moveCard(data.cardId, data.fromColumnId, col.id);
            }
          }
        } catch (err) {
          console.error('Drop error:', err);
        }
      });

      visibleCards.forEach(card => {
        const cardEl = this.createCardElement(col.id, card);
        cardsContainer.appendChild(cardEl);
      });

      boardEl.appendChild(colEl);
    });
  }

  createCardElement(columnId, card) {
    const cardEl = document.createElement('div');
    cardEl.className = 'kanban-card';
    cardEl.draggable = true;
    cardEl.setAttribute('data-card-id', card.id);

    // Checklist progress calculation
    const totalChecks = card.checklist ? card.checklist.length : 0;
    const doneChecks = card.checklist ? card.checklist.filter(c => c.done).length : 0;
    const hasChecklist = totalChecks > 0;
    const checkPct = hasChecklist ? Math.round((doneChecks / totalChecks) * 100) : 0;

    // Priority badge class and label
    const priorityClasses = {
      urgent: 'priority-urgent',
      high: 'priority-high',
      medium: 'priority-medium',
      low: 'priority-low'
    };
    const priorityLabels = {
      urgent: 'عاجل جداً',
      high: 'أولوية عالية',
      medium: 'متوسطة',
      low: 'منخفضة'
    };

    // Render tags
    const tagsHtml = (card.tags || []).map(t => `<span class="card-tag">${t}</span>`).join('');

    cardEl.innerHTML = `
      <div class="card-top-row">
        <span class="card-priority ${priorityClasses[card.priority] || 'priority-medium'}">
          ${priorityLabels[card.priority] || card.priority}
        </span>
        ${card.dueDate ? `
          <span class="card-due-date">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            ${card.dueDate}
          </span>
        ` : ''}
      </div>

      <div class="card-title">${card.title}</div>
      ${card.description ? `<div class="card-description">${card.description}</div>` : ''}

      ${tagsHtml ? `<div class="card-tags-list">${tagsHtml}</div>` : ''}

      ${hasChecklist ? `
        <div class="card-checklist-summary">
          <div class="checklist-header-row">
            <span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
              ${doneChecks}/${totalChecks} مكتملة
            </span>
            <span>${checkPct}%</span>
          </div>
          <div class="checklist-mini-bar">
            <div class="checklist-mini-bar-fill" style="width: ${checkPct}%;"></div>
          </div>
        </div>
      ` : ''}
    `;

    // Drag start
    cardEl.addEventListener('dragstart', (e) => {
      cardEl.classList.add('dragging');
      e.dataTransfer.setData('text/plain', JSON.stringify({
        cardId: card.id,
        fromColumnId: columnId
      }));
    });

    // Drag end
    cardEl.addEventListener('dragend', () => {
      cardEl.classList.remove('dragging');
    });

    // Click to open edit modal
    cardEl.addEventListener('click', () => {
      this.openEditCardModal(columnId, card.id);
    });

    return cardEl;
  }

  openAddCardModal(columnId) {
    this.activeEditingColumnId = columnId;
    this.activeEditingCardId = null;

    document.getElementById('modalCardHeading').textContent = 'إنشاء مهمة جديدة';
    document.getElementById('cardModalTitle').value = '';
    document.getElementById('cardModalDesc').value = '';
    document.getElementById('cardModalPriority').value = 'medium';
    document.getElementById('cardModalDueDate').value = '';
    document.getElementById('cardModalTags').value = '';

    const list = document.getElementById('modalChecklistItems');
    if (list) list.innerHTML = '';

    document.getElementById('btnDeleteCardModal').style.display = 'none';
    document.getElementById('modalCard')?.classList.add('active');
  }

  openEditCardModal(columnId, cardId) {
    this.activeEditingColumnId = columnId;
    this.activeEditingCardId = cardId;

    const col = this.engine.board.columns.find(c => c.id === columnId);
    if (!col) return;
    const card = col.cards.find(c => c.id === cardId);
    if (!card) return;

    document.getElementById('modalCardHeading').textContent = 'تفاصيل ومتابعة المهمة';
    document.getElementById('cardModalTitle').value = card.title || '';
    document.getElementById('cardModalDesc').value = card.description || '';
    document.getElementById('cardModalPriority').value = card.priority || 'medium';
    document.getElementById('cardModalDueDate').value = card.dueDate || '';
    document.getElementById('cardModalTags').value = (card.tags || []).join(', ');

    // Render checklist inside modal
    this.renderModalChecklist(card.checklist || []);

    document.getElementById('btnDeleteCardModal').style.display = 'inline-flex';
    document.getElementById('modalCard')?.classList.add('active');
  }

  renderModalChecklist(checklist) {
    const list = document.getElementById('modalChecklistItems');
    if (!list) return;
    list.innerHTML = '';

    checklist.forEach(chk => {
      const itemEl = document.createElement('div');
      itemEl.className = 'modal-chk-row';
      itemEl.innerHTML = `
        <input type="checkbox" class="chk-modal-box" ${chk.done ? 'checked' : ''}>
        <span class="chk-modal-text ${chk.done ? 'done' : ''}">${chk.text}</span>
        <button class="btn-del-chk" title="حذف">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      `;

      itemEl.querySelector('.chk-modal-box').addEventListener('change', (e) => {
        chk.done = e.target.checked;
        itemEl.querySelector('.chk-modal-text').classList.toggle('done', chk.done);
      });

      itemEl.querySelector('.btn-del-chk').addEventListener('click', () => {
        const idx = checklist.indexOf(chk);
        if (idx !== -1) checklist.splice(idx, 1);
        itemEl.remove();
      });

      list.appendChild(itemEl);
    });
  }

  addModalChecklistItem(text) {
    const list = document.getElementById('modalChecklistItems');
    if (!list) return;

    const itemEl = document.createElement('div');
    itemEl.className = 'modal-chk-row';
    itemEl.innerHTML = `
      <input type="checkbox" class="chk-modal-box">
      <span class="chk-modal-text">${text}</span>
      <button class="btn-del-chk" title="حذف">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    `;

    itemEl.querySelector('.chk-modal-box').addEventListener('change', (e) => {
      itemEl.querySelector('.chk-modal-text').classList.toggle('done', e.target.checked);
    });

    itemEl.querySelector('.btn-del-chk').addEventListener('click', () => {
      itemEl.remove();
    });

    list.appendChild(itemEl);
  }

  saveCardModal() {
    const title = document.getElementById('cardModalTitle').value.trim();
    if (!title) {
      alert('يرجى إدخال عنوان المهمة.');
      return;
    }

    const desc = document.getElementById('cardModalDesc').value.trim();
    const priority = document.getElementById('cardModalPriority').value;
    const dueDate = document.getElementById('cardModalDueDate').value;
    const rawTags = document.getElementById('cardModalTags').value;
    const tags = rawTags.split(',').map(t => t.trim()).filter(Boolean);

    // Extract checklist from DOM rows
    const checklist = [];
    document.querySelectorAll('#modalChecklistItems .modal-chk-row').forEach(row => {
      const box = row.querySelector('.chk-modal-box');
      const txt = row.querySelector('.chk-modal-text');
      checklist.push({
        id: 'chk-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 3),
        text: txt.textContent.trim(),
        done: box.checked
      });
    });

    if (this.activeEditingCardId) {
      // Update existing
      this.engine.updateCard(this.activeEditingColumnId, this.activeEditingCardId, {
        title,
        description: desc,
        priority,
        dueDate,
        tags,
        checklist
      });
    } else {
      // Add new
      this.engine.addCard(this.activeEditingColumnId, {
        title,
        description: desc,
        priority,
        dueDate,
        tags,
        checklist
      });
    }

    this.closeModals();
  }

  setLanguage(lang) {
    if (!I18N[lang]) return;
    this.currentLang = lang;
    localStorage.setItem('dz_boards_lang', lang);
    this.applyLanguage(lang);
  }

  applyLanguage(lang) {
    const t = I18N[lang];
    const isAr = lang === 'ar';
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('dir', isAr ? 'rtl' : 'ltr');

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (t[key]) el.textContent = t[key];
    });

    document.querySelectorAll('[data-lang]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
    });

    const searchInput = document.getElementById('searchQueryInput');
    if (searchInput && t.searchPlaceholder) {
      searchInput.setAttribute('placeholder', t.searchPlaceholder);
    }
  }
}

// Global Launch
window.dzBoardsApp = new DZBoardsApp();
