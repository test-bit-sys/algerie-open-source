/**
 * DZ-Facture: Local Database & Storage Engine (Enterprise Offline-First)
 * Handles Products, Clients, Invoices, Sales, Held Carts, Debt Payments,
 * Daily Expenses, and End-of-Day Z-Report Closings.
 */

const STORAGE_KEYS = {
  PRODUCTS: 'dz_facture_products',
  CLIENTS: 'dz_facture_clients',
  INVOICES: 'dz_facture_invoices',
  COMPANY: 'dz_facture_company_profile',
  SETTINGS: 'dz_facture_settings',
  HELD_CARTS: 'dz_facture_held_carts',
  PAYMENTS: 'dz_facture_payments',
  EXPENSES: 'dz_facture_expenses',
  CLOSINGS: 'dz_facture_closings'
};

const DEFAULT_COMPANY = {
  name: 'مؤسسة الأوراس للتجارة والتوزيع',
  address: '14 شارع ديدوش مراد، الجزائر الوسطى',
  wilaya: '16',
  nif: '001616012345678',
  nis: '00161601234567890123',
  rc: '16/00-1234567B22',
  ai: '16120456789',
  rib: '002 00012 1234567890 45',
  phone: '021 74 12 34 / 0550 12 34 56',
  email: 'contact@el-awras-dz.com',
  stampImage: ''
};

const DEFAULT_PRODUCTS = [
  { id: 'p1', barcode: '6131234567890', name: 'حاسوب محمول مكتبي HP ProBook G9', category: 'إلكترونيات', buyPrice: 72000, sellPrice: 85000, tvaRate: 19, stock: 12, minStock: 3 },
  { id: 'p2', barcode: '6131234567891', name: 'طابعة فواتير ليزر A4 متعددة المهام', category: 'إلكترونيات', buyPrice: 28000, sellPrice: 34000, tvaRate: 19, stock: 8, minStock: 2 },
  { id: 'p3', barcode: '6131234567892', name: 'طابعة تذاكر حرارية 80mm USB/Ethernet', category: 'نقاط البيع', buyPrice: 14500, sellPrice: 18500, tvaRate: 19, stock: 15, minStock: 4 },
  { id: 'p4', barcode: '6131234567893', name: 'قارئ باركود ليزري لاسلكي 2D/QR', category: 'نقاط البيع', buyPrice: 6500, sellPrice: 8900, tvaRate: 19, stock: 20, minStock: 5 },
  { id: 'p5', barcode: '6131234567894', name: 'حزمة ورق طباعة مقاس A4 (صندوق 5 حزم)', category: 'لوازم مكتبية', buyPrice: 3600, sellPrice: 4200, tvaRate: 9, stock: 45, minStock: 10 },
  { id: 'p6', barcode: '6131234567895', name: 'رول ورق حراري لطابعة الكاشير 80mm (علبة 50)', category: 'لوازم مكتبية', buyPrice: 4500, sellPrice: 5500, tvaRate: 19, stock: 30, minStock: 8 }
];

const DEFAULT_CLIENTS = [
  { id: 'c1', name: 'مؤسسة السلام للخدمات والترقية', phone: '0551 23 45 67', address: 'حي الياسمين، وهران', nif: '003116098765432', rc: '31/00-9876543B20', balance: 0 },
  { id: 'c2', name: 'شركة التاج للتجهيزات المكتبية', phone: '0560 98 76 54', address: 'المنطقة الصناعية، سطيف', nif: '001916055555555', rc: '19/00-5555555B21', balance: 45000 },
  { id: 'c3', name: 'مكتب الهضاب للاستشارات', phone: '0661 11 22 33', address: 'شارع فلسطين، قسنطينة', nif: '002516033333333', rc: '25/00-3333333A18', balance: 0 }
];

const DEFAULT_INVOICES = [
  {
    id: 'inv_101',
    docType: 'FACTURE',
    docNumber: 'FAC-2026-0001',
    docDate: new Date(Date.now() - 86400000 * 2).toISOString().split('T')[0],
    clientName: 'مؤسسة السلام للخدمات والترقية',
    clientNif: '003116098765432',
    clientRc: '31/00-9876543B20',
    clientAddress: 'وهران',
    paymentMethod: 'VIREMENT',
    totalHT: 170000,
    totalTVA: 32300,
    timbreFiscal: 0,
    totalTTC: 202300,
    grossProfit: 26000,
    items: [
      { description: 'حاسوب محمول مكتبي HP ProBook G9', quantity: 2, unitPriceHT: 85000, tvaRate: 19, totalHT: 170000, totalTTC: 202300, buyPrice: 72000 }
    ],
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString()
  },
  {
    id: 'inv_102',
    docType: 'POS',
    docNumber: 'TKT-2026-0012',
    docDate: new Date(Date.now() - 86400000).toISOString().split('T')[0],
    clientName: 'عميل نقدي (Comptoir)',
    paymentMethod: 'ESPECES',
    totalHT: 27400,
    totalTVA: 4236,
    timbreFiscal: 317,
    totalTTC: 31953,
    grossProfit: 6400,
    items: [
      { description: 'طابعة تذاكر حرارية 80mm USB/Ethernet', quantity: 1, unitPriceHT: 18500, tvaRate: 19, totalHT: 18500, totalTTC: 22015, buyPrice: 14500 },
      { description: 'قارئ باركود ليزري لاسلكي 2D/QR', quantity: 1, unitPriceHT: 8900, tvaRate: 19, totalHT: 8900, totalTTC: 10591, buyPrice: 6500 }
    ],
    createdAt: new Date(Date.now() - 86400000).toISOString()
  }
];

const DEFAULT_EXPENSES = [
  { id: 'exp_1', date: new Date().toISOString().split('T')[0], title: 'فاتورة الكهرباء والغاز (سونلغاز)', category: 'فواتير ومرافق', amount: 8500, paymentMethod: 'ESPECES' },
  { id: 'exp_2', date: new Date().toISOString().split('T')[0], title: 'شراء لوازم تغليف وتعبئة وأكياس', category: 'مستلزمات', amount: 3200, paymentMethod: 'ESPECES' }
];

export class LocalDB {
  static init() {
    if (!localStorage.getItem(STORAGE_KEYS.COMPANY)) {
      localStorage.setItem(STORAGE_KEYS.COMPANY, JSON.stringify(DEFAULT_COMPANY));
    }
    if (!localStorage.getItem(STORAGE_KEYS.PRODUCTS)) {
      localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(DEFAULT_PRODUCTS));
    }
    if (!localStorage.getItem(STORAGE_KEYS.CLIENTS)) {
      localStorage.setItem(STORAGE_KEYS.CLIENTS, JSON.stringify(DEFAULT_CLIENTS));
    }
    if (!localStorage.getItem(STORAGE_KEYS.INVOICES)) {
      localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(DEFAULT_INVOICES));
    }
    if (!localStorage.getItem(STORAGE_KEYS.SETTINGS)) {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({ lang: 'ar', theme: 'light', soundMuted: false, currencySymbol: 'دج' }));
    }
    if (!localStorage.getItem(STORAGE_KEYS.HELD_CARTS)) {
      localStorage.setItem(STORAGE_KEYS.HELD_CARTS, JSON.stringify([]));
    }
    if (!localStorage.getItem(STORAGE_KEYS.PAYMENTS)) {
      localStorage.setItem(STORAGE_KEYS.PAYMENTS, JSON.stringify([]));
    }
    if (!localStorage.getItem(STORAGE_KEYS.EXPENSES)) {
      localStorage.setItem(STORAGE_KEYS.EXPENSES, JSON.stringify(DEFAULT_EXPENSES));
    }
    if (!localStorage.getItem(STORAGE_KEYS.CLOSINGS)) {
      localStorage.setItem(STORAGE_KEYS.CLOSINGS, JSON.stringify([]));
    }
  }

  // Company Profile
  static getCompany() {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.COMPANY) || '{}');
  }

  static saveCompany(profile) {
    localStorage.setItem(STORAGE_KEYS.COMPANY, JSON.stringify(profile));
  }

  // Products
  static getProducts() {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.PRODUCTS) || '[]');
  }

  static saveProducts(products) {
    localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
  }

  static addProduct(product) {
    const products = this.getProducts();
    const newProduct = { ...product, id: 'p_' + Date.now() };
    products.unshift(newProduct);
    this.saveProducts(products);
    return newProduct;
  }

  static updateProduct(id, updatedData) {
    const products = this.getProducts();
    const index = products.findIndex(p => p.id === id);
    if (index !== -1) {
      products[index] = { ...products[index], ...updatedData };
      this.saveProducts(products);
      return products[index];
    }
    return null;
  }

  static deleteProduct(id) {
    const products = this.getProducts().filter(p => p.id !== id);
    this.saveProducts(products);
  }

  static deductStock(productId, qty) {
    const products = this.getProducts();
    const item = products.find(p => p.id === productId || p.barcode === productId);
    if (item) {
      item.stock = Math.max(0, item.stock - Number(qty));
      this.saveProducts(products);
    }
  }

  static restoreStock(productId, qty) {
    const products = this.getProducts();
    const item = products.find(p => p.id === productId || p.barcode === productId);
    if (item) {
      item.stock = (Number(item.stock) || 0) + Number(qty);
      this.saveProducts(products);
    }
  }

  // Clients
  static getClients() {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.CLIENTS) || '[]');
  }

  static saveClients(clients) {
    localStorage.setItem(STORAGE_KEYS.CLIENTS, JSON.stringify(clients));
  }

  static addClient(client) {
    const clients = this.getClients();
    const newClient = { ...client, id: 'c_' + Date.now(), balance: Number(client.balance) || 0 };
    clients.unshift(newClient);
    this.saveClients(clients);
    return newClient;
  }

  static updateClient(id, updatedData) {
    const clients = this.getClients();
    const index = clients.findIndex(c => c.id === id);
    if (index !== -1) {
      clients[index] = { ...clients[index], ...updatedData };
      this.saveClients(clients);
      return clients[index];
    }
    return null;
  }

  // Debt Payments
  static getPayments() {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.PAYMENTS) || '[]');
  }

  static addClientPayment(clientId, amount, paymentMethod = 'ESPECES', note = '') {
    const clients = this.getClients();
    const client = clients.find(c => c.id === clientId);
    if (!client) return null;

    const amt = Number(amount) || 0;
    client.balance = Math.max(0, (client.balance || 0) - amt);
    this.saveClients(clients);

    const payments = this.getPayments();
    const paymentRecord = {
      id: 'pay_' + Date.now(),
      clientId,
      clientName: client.name,
      amount: amt,
      paymentMethod,
      note,
      date: new Date().toISOString()
    };
    payments.unshift(paymentRecord);
    localStorage.setItem(STORAGE_KEYS.PAYMENTS, JSON.stringify(payments));

    return { paymentRecord, updatedClient: client };
  }

  // Invoices & Sales
  static getInvoices() {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES) || '[]');
  }

  static saveInvoices(invoices) {
    localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(invoices));
  }

  static addInvoice(invoice) {
    const invoices = this.getInvoices();
    const newInv = {
      ...invoice,
      id: 'inv_' + Date.now(),
      createdAt: new Date().toISOString()
    };
    invoices.unshift(newInv);
    this.saveInvoices(invoices);

    // Auto deduct inventory stock
    if (invoice.items && Array.isArray(invoice.items)) {
      invoice.items.forEach(item => {
        if (item.productId) {
          this.deductStock(item.productId, item.quantity);
        }
      });
    }

    // If sold on credit to an existing client, increase debt balance
    if (invoice.paymentMethod === 'A_TERME' && invoice.clientId) {
      const clients = this.getClients();
      const client = clients.find(c => c.id === invoice.clientId);
      if (client) {
        client.balance = (client.balance || 0) + Number(invoice.totalTTC || 0);
        this.saveClients(clients);
      }
    }

    return newInv;
  }

  // Expenses Tracker
  static getExpenses() {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.EXPENSES) || '[]');
  }

  static saveExpenses(expenses) {
    localStorage.setItem(STORAGE_KEYS.EXPENSES, JSON.stringify(expenses));
  }

  static addExpense(expense) {
    const expenses = this.getExpenses();
    const newExp = {
      ...expense,
      id: 'exp_' + Date.now(),
      date: expense.date || new Date().toISOString().split('T')[0],
      amount: Number(expense.amount) || 0
    };
    expenses.unshift(newExp);
    this.saveExpenses(expenses);
    return newExp;
  }

  static deleteExpense(id) {
    let expenses = this.getExpenses();
    expenses = expenses.filter(e => e.id !== id);
    this.saveExpenses(expenses);
    return expenses;
  }

  // Daily Z-Report Drawer Closings
  static getClosings() {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.CLOSINGS) || '[]');
  }

  static saveClosings(closings) {
    localStorage.setItem(STORAGE_KEYS.CLOSINGS, JSON.stringify(closings));
  }

  static addClosing(closing) {
    const closings = this.getClosings();
    const newClosing = {
      ...closing,
      id: 'cls_' + Date.now(),
      closedAt: new Date().toISOString()
    };
    closings.unshift(newClosing);
    this.saveClosings(closings);
    return newClosing;
  }

  // Held Carts (Paniers en attente)
  static getHeldCarts() {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.HELD_CARTS) || '[]');
  }

  static saveHeldCart(cart, label = '') {
    if (!cart || cart.length === 0) return false;
    const held = this.getHeldCarts();
    const newHeld = {
      id: 'held_' + Date.now(),
      label: label || `سلة رقم ${held.length + 1}`,
      items: cart,
      savedAt: new Date().toLocaleTimeString('fr-DZ', { hour: '2-digit', minute: '2-digit' })
    };
    held.unshift(newHeld);
    localStorage.setItem(STORAGE_KEYS.HELD_CARTS, JSON.stringify(held));
    return held;
  }

  static removeHeldCart(id) {
    let held = this.getHeldCarts();
    held = held.filter(h => h.id !== id);
    localStorage.setItem(STORAGE_KEYS.HELD_CARTS, JSON.stringify(held));
    return held;
  }

  // Settings
  static getSettings() {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS) || '{}');
  }

  static saveSettings(settings) {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  }

  // USB Backup & Restore
  static exportBackupJSON() {
    const backup = {
      version: '1.5.0',
      system: 'DZ-Facture & POS (Algerie Open Source)',
      exportedAt: new Date().toISOString(),
      company: this.getCompany(),
      products: this.getProducts(),
      clients: this.getClients(),
      invoices: this.getInvoices(),
      payments: this.getPayments(),
      expenses: this.getExpenses(),
      closings: this.getClosings(),
      settings: this.getSettings()
    };
    return JSON.stringify(backup, null, 2);
  }

  static importBackupJSON(jsonStr) {
    try {
      const data = JSON.parse(jsonStr);
      if (data.company) localStorage.setItem(STORAGE_KEYS.COMPANY, JSON.stringify(data.company));
      if (data.products) localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(data.products));
      if (data.clients) localStorage.setItem(STORAGE_KEYS.CLIENTS, JSON.stringify(data.clients));
      if (data.invoices) localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(data.invoices));
      if (data.payments) localStorage.setItem(STORAGE_KEYS.PAYMENTS, JSON.stringify(data.payments));
      if (data.expenses) localStorage.setItem(STORAGE_KEYS.EXPENSES, JSON.stringify(data.expenses));
      if (data.closings) localStorage.setItem(STORAGE_KEYS.CLOSINGS, JSON.stringify(data.closings));
      if (data.settings) localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(data.settings));
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}
