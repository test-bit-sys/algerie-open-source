/**
 * @dz-suite/fiscal
 * Algerian Fiscal Calculations & Validators
 * Conforms to Algerian tax legislation (DGI, Code des Impôts Directs, Code du Timbre).
 */

/**
 * Standard Algerian TVA Rates
 */
export const TVA_RATES = {
  NORMAL: 19,
  REDUIT: 9,
  EXONERE: 0
};

/**
 * Payment Methods in Algeria
 */
export const PAYMENT_METHODS = {
  ESPECES: 'ESPECES',       // Subject to Timbre Fiscal
  CHEQUE: 'CHEQUE',         // Exempt from Timbre Fiscal
  VIREMENT: 'VIREMENT',     // Exempt from Timbre Fiscal
  TRAITE: 'TRAITE',         // Effet de commerce
  CARTE_CIB: 'CARTE_CIB',   // Paiement électronique (exempte de timbre)
  A_TERME: 'A_TERME'        // Crédit
};

/**
 * Validates Algerian NIF (Numéro d'Identification Fiscale - 15 digits)
 * @param {string|number} nif
 * @returns {boolean}
 */
export function validateNIF(nif) {
  if (!nif) return false;
  const str = String(nif).trim().replace(/\s/g, '');
  return /^\d{15}$/.test(str);
}

/**
 * Validates Algerian NIS (Numéro d'Identification Statistique - 20 digits)
 * @param {string|number} nis
 * @returns {boolean}
 */
export function validateNIS(nis) {
  if (!nis) return false;
  const str = String(nis).trim().replace(/\s/g, '');
  return /^\d{20}$/.test(str);
}

/**
 * Validates Algerian Registre de Commerce (RC) format
 * Typical formats:
 * - 16/00-1234567A20
 * - 16B0123456
 * - 09/00-9876543B19
 * @param {string} rc
 * @returns {boolean}
 */
export function validateRC(rc) {
  if (!rc) return false;
  const str = String(rc).trim().toUpperCase().replace(/\s/g, '');
  // Matches typical WilayaCode (01-58) and sequence with A (Physique) or B (Morale)
  return /^(0[1-9]|[1-4][0-9]|5[0-8])[\/\-A-Z0-9]{5,20}$/.test(str);
}

/**
 * Calculates Algerian CCP Key (Clé CCP Algérie Poste)
 * Standard formula used by Algérie Poste:
 * Clé = (Compte * 100) % 97. If Clé is 0, Clé becomes 97 or 0.
 * In practice: Clé is between 01 and 97.
 * @param {string|number} ccpAccount - CCP account number without key
 * @returns {string} 2-digit key string (e.g. "85")
 */
export function calculateCCPKey(ccpAccount) {
  const accountNum = parseInt(String(ccpAccount).replace(/\D/g, ''), 10);
  if (isNaN(accountNum) || accountNum <= 0) return '';
  const remainder = (accountNum * 100) % 97;
  const key = remainder === 0 ? 97 : remainder;
  return key < 10 ? `0${key}` : `${key}`;
}

/**
 * Calculates Timbre Fiscal for Cash (Espèces) payments in Algeria
 * Legal rate: 1% on the total including taxes, with min 5 DZD and max 10,000 DZD (or 2,500 DZD).
 * @param {number} totalTTC - Total before timbre
 * @param {object} options - Options { minTimbre: 5, maxTimbre: 10000, rate: 0.01 }
 * @returns {number} Timbre amount rounded
 */
export function calculateTimbreFiscal(totalTTC, options = {}) {
  const { minTimbre = 5, maxTimbre = 10000, rate = 0.01 } = options;
  if (totalTTC <= 0) return 0;

  // 1% rate rounded to nearest unit
  let timbre = Math.ceil(totalTTC * rate);
  if (timbre < minTimbre) timbre = minTimbre;
  if (timbre > maxTimbre) timbre = maxTimbre;
  return timbre;
}

/**
 * Calculates a single line item
 * @param {object} line - { quantity, unitPriceHT, discountPercent, tvaRate }
 * @returns {object} Calculated line metrics
 */
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
 * Calculates invoice totals, TVA breakdown, and Timbre Fiscal
 * @param {object} params - { items, paymentMethod, timbreOptions }
 * @returns {object} Full fiscal breakdown
 */
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

    return calc;
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

function round2(num) {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}
