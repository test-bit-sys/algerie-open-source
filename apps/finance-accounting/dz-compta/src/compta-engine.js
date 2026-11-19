/**
 * DZ-Compta Pro — Core Financial Accounting Engine (SCF 2007)
 * Implements double-entry validation, Grand Livre, Balance Générale (6 columns),
 * Bilan Actif/Passif, and Compte de Résultat (TCR).
 */

import { getAccountName, SCF_ACCOUNTS } from './scf-plan.js';

export function round2(num) {
  return Math.round((Number(num || 0) + Number.EPSILON) * 100) / 100;
}

export function validateDoubleEntry(entry) {
  if (!entry) return { isValid: false, error: 'العملية المحاسبية فارغة' };
  if (!entry.date) return { isValid: false, error: 'تاريخ العملية المحاسبية إلزامي' };
  if (!entry.piece) return { isValid: false, error: 'رقم وثيقة الإثبات (Pièce justificative) إلزامي' };
  if (!entry.debitAccount) return { isValid: false, error: 'رقم حساب المدين إلزامي' };
  if (!entry.creditAccount) return { isValid: false, error: 'رقم حساب الدائن إلزامي' };
  if (entry.debitAccount === entry.creditAccount) {
    return { isValid: false, error: 'لا يمكن أن يكون حساب المدين وحساب الدائن متطابقين في نفس القيد' };
  }
  const amount = Number(entry.amount);
  if (isNaN(amount) || amount <= 0) {
    return { isValid: false, error: 'مبلغ العملية يجب أن يكون رقماً موجباً أكبر من الصفر' };
  }

  return { isValid: true };
}

/**
 * Computes the General Ledger (Le Grand Livre) for all accounts
 */
export function computeGrandLivre(journal = [], lang = 'ar') {
  const ledger = {};

  journal.forEach((entry, idx) => {
    const amt = round2(entry.amount);
    const dAcc = String(entry.debitAccount);
    const cAcc = String(entry.creditAccount);

    if (!ledger[dAcc]) {
      ledger[dAcc] = {
        code: dAcc,
        name: getAccountName(dAcc, lang),
        totalDebit: 0,
        totalCredit: 0,
        balance: 0,
        lines: []
      };
    }
    ledger[dAcc].totalDebit = round2(ledger[dAcc].totalDebit + amt);
    ledger[dAcc].lines.push({
      entryIndex: idx + 1,
      date: entry.date,
      piece: entry.piece,
      label: entry.label,
      counterAccount: cAcc,
      debit: amt,
      credit: 0
    });

    if (!ledger[cAcc]) {
      ledger[cAcc] = {
        code: cAcc,
        name: getAccountName(cAcc, lang),
        totalDebit: 0,
        totalCredit: 0,
        balance: 0,
        lines: []
      };
    }
    ledger[cAcc].totalCredit = round2(ledger[cAcc].totalCredit + amt);
    ledger[cAcc].lines.push({
      entryIndex: idx + 1,
      date: entry.date,
      piece: entry.piece,
      label: entry.label,
      counterAccount: dAcc,
      debit: 0,
      credit: amt
    });
  });

  Object.values(ledger).forEach(acc => {
    acc.balance = round2(acc.totalDebit - acc.totalCredit);
  });

  return ledger;
}

/**
 * Computes the official 6-column Trial Balance (Balance Générale des Comptes)
 */
export function computeBalance(journal = [], lang = 'ar') {
  const ledger = computeGrandLivre(journal, lang);
  const rows = [];
  let sumDebit = 0;
  let sumCredit = 0;
  let sumSoldeDebiteur = 0;
  let sumSoldeCrediteur = 0;

  const sortedCodes = Object.keys(ledger).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  sortedCodes.forEach(code => {
    const acc = ledger[code];
    const totalD = round2(acc.totalDebit);
    const totalC = round2(acc.totalCredit);

    let soldeD = 0;
    let soldeC = 0;

    if (totalD > totalC) {
      soldeD = round2(totalD - totalC);
    } else if (totalC > totalD) {
      soldeC = round2(totalC - totalD);
    }

    sumDebit = round2(sumDebit + totalD);
    sumCredit = round2(sumCredit + totalC);
    sumSoldeDebiteur = round2(sumSoldeDebiteur + soldeD);
    sumSoldeCrediteur = round2(sumSoldeCrediteur + soldeC);

    rows.push({
      code,
      name: acc.name,
      totalDebit: totalD,
      totalCredit: totalC,
      soldeDebiteur: soldeD,
      soldeCrediteur: soldeC
    });
  });

  const isBalanced = Math.abs(sumDebit - sumCredit) < 0.01 && Math.abs(sumSoldeDebiteur - sumSoldeCrediteur) < 0.01;

  return {
    rows,
    totals: {
      totalDebit: sumDebit,
      totalCredit: sumCredit,
      totalSoldeDebiteur: sumSoldeDebiteur,
      totalSoldeCrediteur: sumSoldeCrediteur,
      isBalanced,
      diff: round2(sumDebit - sumCredit)
    }
  };
}

/**
 * Computes the SCF Balance Sheet (Bilan Comptable Actif / Passif)
 */
export function generateBilan(journal = [], lang = 'ar') {
  const balance = computeBalance(journal, lang);
  const rows = balance.rows;

  const findNet = (prefix) => {
    return rows
      .filter(r => r.code.startsWith(prefix))
      .reduce((acc, r) => acc + (r.soldeDebiteur - r.soldeCrediteur), 0);
  };

  const findCreditNet = (prefix) => {
    return rows
      .filter(r => r.code.startsWith(prefix))
      .reduce((acc, r) => acc + (r.soldeCrediteur - r.soldeDebiteur), 0);
  };

  // ACTIF
  // Actif Non-Courant
  const immoIncorporelles = Math.max(0, findNet('20'));
  const immoCorporelles = Math.max(0, findNet('21'));
  const amortissements = Math.abs(Math.min(0, findNet('28')));
  const totalActifNonCourant = round2(immoIncorporelles + immoCorporelles - amortissements);

  // Actif Courant
  const stocks = Math.max(0, findNet('3'));
  const creancesClients = Math.max(0, findNet('41'));
  const disponibilites = Math.max(0, findNet('5'));
  const totalActifCourant = round2(stocks + creancesClients + disponibilites);

  const totalActif = round2(totalActifNonCourant + totalActifCourant);

  // PASSIF
  // Capitaux Propres
  const capitalSocial = Math.max(0, findCreditNet('101'));
  const reserves = Math.max(0, findCreditNet('106'));
  const reportNouveau = findCreditNet('110');

  // Compute Current Year Result (Produits Cl. 7 - Charges Cl. 6)
  const totalProduits = rows.filter(r => r.code.startsWith('7')).reduce((acc, r) => acc + r.soldeCrediteur, 0);
  const totalCharges = rows.filter(r => r.code.startsWith('6')).reduce((acc, r) => acc + r.soldeDebiteur, 0);
  const resultatNetExercice = round2(totalProduits - totalCharges);

  const totalCapitauxPropres = round2(capitalSocial + reserves + reportNouveau + resultatNetExercice);

  // Passif Non Courant
  const emprunts = Math.max(0, findCreditNet('16'));

  // Passif Courant
  const dettesFournisseurs = Math.max(0, findCreditNet('40'));
  const dettesFiscalesSociales = Math.max(0, findCreditNet('42') + findCreditNet('43') + findCreditNet('44'));
  const totalPassifCourant = round2(dettesFournisseurs + dettesFiscalesSociales);

  const totalPassif = round2(totalCapitauxPropres + emprunts + totalPassifCourant);

  return {
    actif: {
      nonCourant: {
        immoIncorporelles,
        immoCorporelles,
        amortissements,
        total: totalActifNonCourant
      },
      courant: {
        stocks,
        creancesClients,
        disponibilites,
        total: totalActifCourant
      },
      totalActif
    },
    passif: {
      capitauxPropres: {
        capitalSocial,
        reserves,
        reportNouveau,
        resultatNetExercice,
        total: totalCapitauxPropres
      },
      nonCourant: {
        emprunts,
        total: emprunts
      },
      courant: {
        dettesFournisseurs,
        dettesFiscalesSociales,
        total: totalPassifCourant
      },
      totalPassif
    },
    isBalanced: Math.abs(totalActif - totalPassif) < 0.05
  };
}

/**
 * Computes the SCF Income Statement (Compte de Résultat - TCR)
 */
export function generateTCR(journal = [], lang = 'ar') {
  const balance = computeBalance(journal, lang);
  const rows = balance.rows;

  // Chiffre d'Affaires (Ventes 70)
  const ventesMarchandises = rows.filter(r => r.code.startsWith('700')).reduce((s, r) => s + r.soldeCrediteur, 0);
  const prestationsServices = rows.filter(r => r.code.startsWith('704') || r.code.startsWith('706')).reduce((s, r) => s + r.soldeCrediteur, 0);
  const chiffreAffaires = round2(ventesMarchandises + prestationsServices);

  // Consommation de l'exercice (Achats 60)
  const achatsConsommes = rows.filter(r => r.code.startsWith('60')).reduce((s, r) => s + r.soldeDebiteur, 0);

  // Valeur Ajoutée d'exploitation
  const valeurAjoutee = round2(chiffreAffaires - achatsConsommes);

  // Services extérieurs et autres (61, 62)
  const servicesExterieurs = rows.filter(r => r.code.startsWith('61') || r.code.startsWith('62')).reduce((s, r) => s + r.soldeDebiteur, 0);

  // Charges de personnel (63)
  const chargesPersonnel = rows.filter(r => r.code.startsWith('63')).reduce((s, r) => s + r.soldeDebiteur, 0);

  // Impôts et taxes (64)
  const impotsTaxes = rows.filter(r => r.code.startsWith('64')).reduce((s, r) => s + r.soldeDebiteur, 0);

  // Excédent Brut d'Exploitation (EBE)
  const ebe = round2(valeurAjoutee - servicesExterieurs - chargesPersonnel - impotsTaxes);

  // Dotations aux amortissements (68)
  const dotationsAmortissements = rows.filter(r => r.code.startsWith('68')).reduce((s, r) => s + r.soldeDebiteur, 0);

  // Résultat Opérationnel (Résultat d'Exploitation)
  const resultatExploitation = round2(ebe - dotationsAmortissements);

  // Produits financiers (76) & Charges financières (66)
  const produitsFinanciers = rows.filter(r => r.code.startsWith('76')).reduce((s, r) => s + r.soldeCrediteur, 0);
  const chargesFinancieres = rows.filter(r => r.code.startsWith('66')).reduce((s, r) => s + r.soldeDebiteur, 0);
  const resultatFinancier = round2(produitsFinanciers - chargesFinancieres);

  // Résultat Ordinaire Avant Impôt
  const resultatAvantImpot = round2(resultatExploitation + resultatFinancier);

  // Impôt sur les Bénéfices des Sociétés (IBS 19% if profit > 0)
  const impotIBS = resultatAvantImpot > 0 ? round2(resultatAvantImpot * 0.19) : 0;

  // Résultat Net de l'Exercice
  const resultatNet = round2(resultatAvantImpot - impotIBS);

  return {
    chiffreAffaires,
    achatsConsommes,
    valeurAjoutee,
    servicesExterieurs,
    chargesPersonnel,
    impotsTaxes,
    ebe,
    dotationsAmortissements,
    resultatExploitation,
    produitsFinanciers,
    chargesFinancieres,
    resultatFinancier,
    resultatAvantImpot,
    impotIBS,
    resultatNet
  };
}

/**
 * Authentic Algerian Demo Company Journal Entries
 */
export const DEMO_JOURNAL = [
  { id: '1', date: '2026-01-02', piece: 'NOT-001', debitAccount: '512', creditAccount: '101', label: 'إيداع رأس المال الاجتماعي التأسيسي في بنك BNA', amount: 5000000 },
  { id: '2', date: '2026-01-05', piece: 'FAC-012', debitAccount: '218', creditAccount: '512', label: 'شراء أجهزة كمبيوتر وخوادم المؤسسة بشيك بنكي', amount: 650000 },
  { id: '3', date: '2026-01-10', piece: 'FAC-089', debitAccount: '600', creditAccount: '401', label: 'فاتورة شراء بضائع ومعدات من المورد SARL El Bahia', amount: 1200000 },
  { id: '4', date: '2026-01-12', piece: 'CHQ-504', debitAccount: '401', creditAccount: '512', label: 'تسديد مستحقات المورد SARL El Bahia بتحويل BNA', amount: 1200000 },
  { id: '5', date: '2026-01-18', piece: 'FAC-V01', debitAccount: '411', creditAccount: '700', label: 'فاتورة بيع بضائع لزبون مؤسسة الأوراس للتجارة', amount: 2400000 },
  { id: '6', date: '2026-01-22', piece: 'VIR-882', debitAccount: '512', creditAccount: '411', label: 'تحصيل مستحقات الفاتورة FAC-V01 في الحساب البنكي', amount: 2400000 },
  { id: '7', date: '2026-01-25', piece: 'REC-301', debitAccount: '530', creditAccount: '512', label: 'سحب نقدي من البنك لتغذية صندوق المؤسسة اليومي', amount: 150000 },
  { id: '8', date: '2026-01-28', piece: 'OD-PAIE', debitAccount: '631', creditAccount: '421', label: 'قيد رواتب وأجور موظفي المؤسسة لشهر جانفي', amount: 850000 },
  { id: '9', date: '2026-01-29', piece: 'VIR-CCP', debitAccount: '421', creditAccount: '512', label: 'تحويل أجور الموظفين إلى حساباتهم البريدية الجارية CCP', amount: 850000 },
  { id: '10', date: '2026-01-30', piece: 'LOYER-01', debitAccount: '613', creditAccount: '530', label: 'دفع إيجار مقر المؤسسة نقداً من الصندوق', amount: 80000 }
];
