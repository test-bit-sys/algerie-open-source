/**
 * DZ-Facture: Fiscal & Tax Engine
 * Algerian Value-Added Tax (TVA 19%/9%), Cash Stamp Duty (Timbre Fiscal 1%),
 * NIF, NIS, RC, AI, RIB/RIP algorithms.
 */

export const TVA_RATES = {
  NORMAL: 19,
  REDUIT: 9,
  EXONERE: 0
};

export const PAYMENT_METHODS = {
  ESPECES: 'ESPECES',       // Subject to Timbre Fiscal (1%)
  CHEQUE: 'CHEQUE',         // Exempt from Timbre Fiscal
  VIREMENT: 'VIREMENT',     // Exempt from Timbre Fiscal
  CARTE_CIB: 'CARTE_CIB',   // Electronic payment exempt from Timbre
  A_TERME: 'A_TERME'        // Credit / Deferred
};

export function validateNIF(nif) {
  if (!nif) return false;
  const str = String(nif).trim().replace(/\s/g, '');
  return /^\d{15}$/.test(str);
}

export function validateNIS(nis) {
  if (!nis) return false;
  const str = String(nis).trim().replace(/\s/g, '');
  return /^\d{20}$/.test(str);
}

export function validateRC(rc) {
  if (!rc) return false;
  const str = String(rc).trim().toUpperCase().replace(/\s/g, '');
  return /^(0[1-9]|[1-4][0-9]|5[0-8])[\/\-A-Z0-9]{5,20}$/.test(str);
}

export function calculateCCPKey(ccpAccount) {
  const accountNum = parseInt(String(ccpAccount).replace(/\D/g, ''), 10);
  if (isNaN(accountNum) || accountNum <= 0) return '';
  const remainder = (accountNum * 100) % 97;
  const key = remainder === 0 ? 97 : remainder;
  return key < 10 ? `0${key}` : `${key}`;
}

export function calculateTimbreFiscal(totalTTC, options = {}) {
  const { minTimbre = 5, maxTimbre = 10000, rate = 0.01 } = options;
  if (totalTTC <= 0) return 0;
  let timbre = Math.ceil(totalTTC * rate);
  if (timbre < minTimbre) timbre = minTimbre;
  if (timbre > maxTimbre) timbre = maxTimbre;
  return timbre;
}

export function round2(num) {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

export function calculateLineItem({ quantity = 1, unitPriceHT = 0, discountPercent = 0, tvaRate = TVA_RATES.NORMAL }) {
  const qty = Number(quantity) || 0;
  const price = Number(unitPriceHT) || 0;
  const discPct = Math.max(0, Math.min(100, Number(discountPercent) || 0));
  const tva = Number(tvaRate) || 0;

  const rawHT = qty * price;
  const discountAmount = round2(rawHT * (discPct / 100));
  const totalHT = round2(rawHT - discountAmount);
  const totalTVA = round2(totalHT * (tva / 100));
  const totalTTC = round2(totalHT + totalTVA);

  return {
    quantity: qty,
    unitPriceHT: price,
    discountPercent: discPct,
    discountAmount,
    totalHT,
    tvaRate: tva,
    totalTVA,
    totalTTC
  };
}

/**
 * Splits a set of TTC (tax-inclusive retail) line amounts into exact HT and
 * TVA components, grouped by TVA rate. Guarantees totalHT + totalTVA ===
 * totalTTC to the cent, so the POS always charges exactly the shelf prices.
 *
 * This is the retail (POS) model — the printed shelf price is authoritative.
 * The inverse model (HT-first, used for A4 B2B invoices) lives in
 * `calculateInvoiceTotals` below.
 *
 * items: [{ quantity, unitPriceTTC, tvaRate }]
 */
export function splitTTCByRates(items = []) {
  const groups = {};
  let totalTTC = 0;

  items.forEach((item) => {
    const qty = Number(item.quantity) || 0;
    const lineTTC = round2((Number(item.unitPriceTTC) || 0) * qty);
    const rate = Number(item.tvaRate) || 0;
    const key = String(rate);

    totalTTC = round2(totalTTC + lineTTC);
    groups[key] = round2((groups[key] || 0) + lineTTC);
  });

  const tvaBreakdown = {};
  let totalHT = 0;
  let totalTVA = 0;

  Object.keys(groups).forEach((key) => {
    const rate = Number(key);
    const groupTTC = groups[key];
    const groupTVA = rate > 0 ? round2((groupTTC * rate) / (100 + rate)) : 0;
    const groupHT = round2(groupTTC - groupTVA);

    tvaBreakdown[key] = { baseHT: groupHT, amountTVA: groupTVA };
    totalHT = round2(totalHT + groupHT);
    totalTVA = round2(totalTVA + groupTVA);
  });

  return { totalTTC, totalHT, totalTVA, tvaBreakdown };
}

export function calculateInvoiceTotals({ items = [], paymentMethod = PAYMENT_METHODS.VIREMENT, timbreOptions = {} }) {
  let totalHT = 0;
  let totalDiscount = 0;
  let totalTVA = 0;

  const tvaBreakdown = {
    '19': { baseHT: 0, amountTVA: 0 },
    '9': { baseHT: 0, amountTVA: 0 },
    '0': { baseHT: 0, amountTVA: 0 }
  };

  const processedItems = items.map(item => {
    const calc = calculateLineItem(item);
    totalHT += calc.totalHT;
    totalDiscount += calc.discountAmount;
    totalTVA += calc.totalTVA;

    const rateKey = String(calc.tvaRate);
    if (!tvaBreakdown[rateKey]) {
      tvaBreakdown[rateKey] = { baseHT: 0, amountTVA: 0 };
    }
    tvaBreakdown[rateKey].baseHT = round2(tvaBreakdown[rateKey].baseHT + calc.totalHT);
    tvaBreakdown[rateKey].amountTVA = round2(tvaBreakdown[rateKey].amountTVA + calc.totalTVA);

    return { ...item, ...calc };
  });

  totalHT = round2(totalHT);
  totalTVA = round2(totalTVA);
  totalDiscount = round2(totalDiscount);
  const subtotalTTC = round2(totalHT + totalTVA);

  let timbreFiscal = 0;
  if (paymentMethod === PAYMENT_METHODS.ESPECES) {
    timbreFiscal = calculateTimbreFiscal(subtotalTTC, timbreOptions);
  }

  const grandTotalTTC = round2(subtotalTTC + timbreFiscal);

  return {
    items: processedItems,
    paymentMethod,
    totalHT,
    totalDiscount,
    totalTVA,
    tvaBreakdown,
    subtotalTTC,
    timbreFiscal,
    grandTotalTTC
  };
}

/**
 * Computes the official Algerian annual sales summary by client
 * (État 104 des Clients - Article 224 du CIDTA).
 */
export function computeEtat104(invoices = [], options = {}) {
  const selectedYear = options.year ? String(options.year) : 'ALL';
  const minAmountHT = Number(options.minAmountHT) || 0;

  // Filter invoices: only commercial sales (FACTURE or POS)
  const filteredInvoices = invoices.filter(inv => {
    if (inv.docType === 'PROFORMA' || inv.docType === 'BL') return false;
    if (selectedYear !== 'ALL') {
      const dateStr = inv.docDate || inv.date || inv.createdAt || '';
      if (!dateStr.startsWith(selectedYear)) return false;
    }
    return true;
  });

  // Group by client
  const clientMap = new Map();

  for (const inv of filteredInvoices) {
    const key = (inv.clientNif && inv.clientNif.trim()) || (inv.clientName && inv.clientName.trim()) || 'CLIENT_COMPTOIR';
    if (!clientMap.has(key)) {
      clientMap.set(key, {
        clientKey: key,
        clientName: inv.clientName || 'زبون عام',
        clientAddress: inv.clientAddress || '-',
        clientNif: inv.clientNif || '-',
        clientNis: inv.clientNis || '-',
        clientRc: inv.clientRc || '-',
        clientAi: inv.clientAi || '-',
        invoicesCount: 0,
        totalHT: 0,
        totalTVA: 0,
        totalTimbre: 0,
        totalTTC: 0,
        paymentMethods: {}
      });
    }

    const rec = clientMap.get(key);
    rec.invoicesCount += 1;
    const ht = round2(inv.totalHT || inv.subtotalHT || 0);
    const tva = round2(inv.totalTVA || 0);
    const timbre = round2(inv.timbreFiscal || 0);
    const ttc = round2(inv.totalTTC || inv.grandTotalTTC || (ht + tva + timbre));

    rec.totalHT = round2(rec.totalHT + ht);
    rec.totalTVA = round2(rec.totalTVA + tva);
    rec.totalTimbre = round2(rec.totalTimbre + timbre);
    rec.totalTTC = round2(rec.totalTTC + ttc);

    const pm = inv.paymentMethod || 'ESPECES';
    rec.paymentMethods[pm] = (rec.paymentMethods[pm] || 0) + 1;
  }

  // Filter by minAmountHT
  const clientsList = Array.from(clientMap.values()).filter(c => c.totalHT >= minAmountHT);

  // Determine predominant payment method
  clientsList.forEach(c => {
    let bestMethod = 'VIREMENT';
    let maxCount = -1;
    for (const [method, count] of Object.entries(c.paymentMethods)) {
      if (count > maxCount) {
        maxCount = count;
        bestMethod = method;
      }
    }
    c.mainPaymentMethod = bestMethod;
  });

  const totals = {
    clientsCount: clientsList.length,
    invoicesCount: clientsList.reduce((sum, c) => sum + c.invoicesCount, 0),
    totalHT: round2(clientsList.reduce((sum, c) => sum + c.totalHT, 0)),
    totalTVA: round2(clientsList.reduce((sum, c) => sum + c.totalTVA, 0)),
    totalTimbre: round2(clientsList.reduce((sum, c) => sum + c.totalTimbre, 0)),
    totalTTC: round2(clientsList.reduce((sum, c) => sum + c.totalTTC, 0))
  };

  return {
    year: selectedYear,
    generatedAt: new Date().toISOString(),
    clients: clientsList,
    totals
  };
}

/**
 * Exports État 104 data to CSV format conforming to DGI requirements
 */
export function exportEtat104ToCSV(etat104Data) {
  const headers = [
    'N°',
    'Raison Sociale / Nom Client',
    'NIF (15 chiffres)',
    'Registre Commerce (RC)',
    'Article Imposition',
    'Adresse / Wilaya',
    'Nombre Factures',
    'Montant Total HT (DZD)',
    'Montant TVA (DZD)',
    'Droits de Timbre (DZD)',
    'Montant Total TTC (DZD)',
    'Mode de Règlement'
  ];

  const rows = etat104Data.clients.map((c, idx) => [
    idx + 1,
    `"${c.clientName.replace(/"/g, '""')}"`,
    `"${c.clientNif}"`,
    `"${c.clientRc}"`,
    `"${c.clientAi}"`,
    `"${c.clientAddress.replace(/"/g, '""')}"`,
    c.invoicesCount,
    c.totalHT.toFixed(2),
    c.totalTVA.toFixed(2),
    c.totalTimbre.toFixed(2),
    c.totalTTC.toFixed(2),
    `"${c.mainPaymentMethod}"`
  ]);

  rows.push([
    'TOTAL',
    `"TOTAL GENERAL (${etat104Data.totals.clientsCount} CLIENTS)"`,
    '""',
    '""',
    '""',
    '""',
    etat104Data.totals.invoicesCount,
    etat104Data.totals.totalHT.toFixed(2),
    etat104Data.totals.totalTVA.toFixed(2),
    etat104Data.totals.totalTimbre.toFixed(2),
    etat104Data.totals.totalTTC.toFixed(2),
    '""'
  ]);

  return [headers.join(';'), ...rows.map(r => r.join(';'))].join('\r\n');
}
