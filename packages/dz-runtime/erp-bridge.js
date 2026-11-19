/**
 * DZ-Runtime — Algerian Sovereign ERP Bridge
 * Inter-Application Integration between DZ-Facture, DZ-Paie, and DZ-Compta.
 * Converts commercial invoices, POS closures, and payroll batches into
 * compliant double-entry accounting records (Système Comptable Financier - SCF 2007).
 */

export function round2(num) {
  return Math.round((Number(num || 0) + Number.EPSILON) * 100) / 100;
}

/**
 * Converts a commercial invoice from DZ-Facture into balanced SCF journal entries.
 * Accounts used:
 * - 411: Clients (Ventes à crédit)
 * - 512: Banques (Chèques, virements, cartes CIB/Edahabia)
 * - 530: Caisse (Paiements en espèces)
 * - 700: Ventes de marchandises (Total HT)
 * - 4457: État - TVA collectée (Total TVA)
 * - 447: Droits de timbre fiscal (Si paiement en espèces)
 */
export function convertInvoiceToSCF(invoice = {}) {
  const date = invoice.date || new Date().toISOString().slice(0, 10);
  const piece = invoice.docNumber || invoice.invoiceNumber || 'FAC-' + Date.now();
  const clientName = invoice.clientName || 'زبون عام';
  const totalHT = round2(invoice.totalHT || invoice.subtotalHT || 0);
  const totalTVA = round2(invoice.totalTVA || 0);
  const timbreFiscal = round2(invoice.timbreFiscal || 0);
  const totalTTC = round2(invoice.totalTTC || invoice.grandTotalTTC || (totalHT + totalTVA + timbreFiscal));
  const paymentMethod = (invoice.paymentMethod || 'ESPECES').toUpperCase();

  // Determine Treasury / Client Account
  let debitAccount = '530'; // Caisse
  let debitLabel = 'تحصيل نقدي بالصندوق';
  if (paymentMethod === 'A_TERME' || paymentMethod === 'CREDIT') {
    debitAccount = '411'; // Clients
    debitLabel = `ذمم عملاء (${clientName})`;
  } else if (['CHEQUE', 'VIREMENT', 'CARTE_CIB', 'EDAHABIA'].includes(paymentMethod)) {
    debitAccount = '512'; // Banque
    debitLabel = `تحصيل بنكي (${paymentMethod})`;
  }

  const entries = [];

  // 1. Sales revenue entry: Debit Treasury/Client, Credit 700 Sales (HT)
  if (totalHT > 0) {
    entries.push({
      id: `inv-${piece}-rev`,
      date,
      piece,
      debitAccount,
      creditAccount: '700',
      amount: totalHT,
      label: `مبيعات بضائع - فاتورة ${piece} (${clientName})`
    });
  }

  // 2. TVA collected entry: Debit Treasury/Client, Credit 4457 TVA Collectée
  if (totalTVA > 0) {
    entries.push({
      id: `inv-${piece}-tva`,
      date,
      piece,
      debitAccount,
      creditAccount: '4457',
      amount: totalTVA,
      label: `رسم TVA محصل 19%/9% - فاتورة ${piece}`
    });
  }

  // 3. Timbre Fiscal entry: Debit Treasury (530), Credit 447 Droits de timbre
  if (timbreFiscal > 0) {
    entries.push({
      id: `inv-${piece}-timbre`,
      date,
      piece,
      debitAccount,
      creditAccount: '447',
      amount: timbreFiscal,
      label: `طابع جبائي نقدي (Timbre Fiscal) - فاتورة ${piece}`
    });
  }

  return {
    piece,
    clientName,
    date,
    totalTTC,
    entries,
    isBalanced: true
  };
}

/**
 * Converts a POS daily closing report (Rapport Z) into balanced SCF entries.
 */
export function convertZReportToSCF(zReport = {}) {
  const date = zReport.date || new Date().toISOString().slice(0, 10);
  const piece = zReport.zNumber || `Z-${date.replace(/-/g, '')}`;
  const totalCash = round2(zReport.totalCash || 0);
  const totalElectronic = round2(zReport.totalElectronic || 0);
  const totalHT = round2(zReport.totalHT || 0);
  const totalTVA = round2(zReport.totalTVA || 0);
  const totalTimbre = round2(zReport.totalTimbre || 0);

  const entries = [];

  if (totalCash > 0) {
    entries.push({
      id: `${piece}-cash-rev`,
      date,
      piece,
      debitAccount: '530',
      creditAccount: '700',
      amount: round2(totalCash - totalTimbre),
      label: `إيراد مبيعات الصندوق اليومية - تقرير ${piece}`
    });
    if (totalTimbre > 0) {
      entries.push({
        id: `${piece}-cash-timbre`,
        date,
        piece,
        debitAccount: '530',
        creditAccount: '447',
        amount: totalTimbre,
        label: `طابع جبائي محصل نقداً - تقرير ${piece}`
      });
    }
  }

  if (totalElectronic > 0) {
    entries.push({
      id: `${piece}-elec-rev`,
      date,
      piece,
      debitAccount: '512',
      creditAccount: '700',
      amount: totalElectronic,
      label: `إيراد مبيعات الدفع الإلكتروني CIB/ذهبية - تقرير ${piece}`
    });
  }

  return {
    piece,
    date,
    entries
  };
}

/**
 * Converts a monthly payroll summary from DZ-Paie into balanced SCF journal entries.
 * Accounts used:
 * - 631: Rémunérations du personnel (Salaire Brut)
 * - 635: Cotisations aux organismes sociaux (CNAS Patronale 26%)
 * - 421: Personnel - Rémunérations dues (Net à payer)
 * - 431: Sécurité Sociale - CNAS (9% Salarié + 26% Patronale = 35%)
 * - 447: État - Impôts et taxes retenus (IRG)
 */
export function convertPayrollMonthToSCF(payrollSummary = {}) {
  const month = payrollSummary.month || new Date().toISOString().slice(0, 7);
  const piece = `PAIE-${month.replace(/-/g, '')}`;
  const date = payrollSummary.date || `${month}-28`;

  const totalBrut = round2(payrollSummary.totalBrut || 0);
  const totalNet = round2(payrollSummary.totalNet || 0);
  const totalCnasSalarie = round2(payrollSummary.totalCnasSalarie || 0);
  const totalCnasPatronale = round2(payrollSummary.totalCnasPatronale || 0);
  const totalIRG = round2(payrollSummary.totalIRG || 0);

  const entries = [];

  // 1. Gross Salaries & Deductions:
  // Debit 631 (Brut) vs Credit 421 (Net), Credit 431 (CNAS 9%), Credit 447 (IRG)
  if (totalNet > 0) {
    entries.push({
      id: `${piece}-net`,
      date,
      piece,
      debitAccount: '631',
      creditAccount: '421',
      amount: totalNet,
      label: `أجور المستخدمين الصافية للدفع - شهر ${month}`
    });
  }

  if (totalCnasSalarie > 0) {
    entries.push({
      id: `${piece}-cnas-sal`,
      date,
      piece,
      debitAccount: '631',
      creditAccount: '431',
      amount: totalCnasSalarie,
      label: `اشتراكات الضمان الاجتماعي CNAS (9% عمال) - شهر ${month}`
    });
  }

  if (totalIRG > 0) {
    entries.push({
      id: `${piece}-irg`,
      date,
      piece,
      debitAccount: '631',
      creditAccount: '447',
      amount: totalIRG,
      label: `الضريبة على الدخل الإجمالي IRG مقتطعة - شهر ${month}`
    });
  }

  // 2. Employer Social Charges (CNAS Patronale 26%):
  // Debit 635 vs Credit 431
  if (totalCnasPatronale > 0) {
    entries.push({
      id: `${piece}-cnas-pat`,
      date,
      piece,
      debitAccount: '635',
      creditAccount: '431',
      amount: totalCnasPatronale,
      label: `حصة المستخدم في اشتراكات الضمان الاجتماعي CNAS (26%) - شهر ${month}`
    });
  }

  return {
    piece,
    month,
    date,
    totalBrut,
    totalNet,
    entries,
    isBalanced: true
  };
}

/**
 * Direct sync helper: merges entries into localStorage['dz_compta_journal_v2']
 * and returns the updated count.
 */
export function syncEntriesToLocalCompta(newEntries = []) {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { success: false, error: 'LocalStorage unavailable' };
  }

  const STORAGE_KEY = 'dz_compta_journal_v2';
  let existing = [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) existing = JSON.parse(raw);
  } catch (e) {
    existing = [];
  }

  // Deduplicate by entry ID or piece+accounts
  const existingKeys = new Set(existing.map(e => e.id || `${e.piece}-${e.debitAccount}-${e.creditAccount}-${e.amount}`));
  let addedCount = 0;

  newEntries.forEach(entry => {
    const key = entry.id || `${entry.piece}-${entry.debitAccount}-${entry.creditAccount}-${entry.amount}`;
    if (!existingKeys.has(key)) {
      existing.push({
        id: entry.id || 'imp-' + Date.now() + Math.random().toString(36).slice(2, 6),
        date: entry.date,
        piece: entry.piece,
        debitAccount: String(entry.debitAccount),
        creditAccount: String(entry.creditAccount),
        amount: Number(entry.amount),
        label: entry.label
      });
      existingKeys.add(key);
      addedCount++;
    }
  });

  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  return { success: true, addedCount, totalCount: existing.length };
}

/**
 * Downloads entries as a portable .dzcompta.json file
 */
export function downloadComptaBatch(entries = [], filename = 'dz-compta-batch.json') {
  if (typeof window === 'undefined') return;
  const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
