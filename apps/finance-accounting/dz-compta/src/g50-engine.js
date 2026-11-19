/**
 * DZ-Compta — Official Algerian G50 Tax Declaration Engine (DGI Algérie)
 * ---------------------------------------------------------------------
 * Computes the monthly/quarterly tax declaration "Série G N° 50" according to
 * the Algerian Tax Code (Code des Impôts Directs et Taxes Assimilées & Code des Taxes sur le CA).
 * 
 * Complies with Finance Laws (LF 2024 / LF 2025):
 * - TAP (Taxe sur l'Activité Professionnelle): 0% Exonérée générale (sauf canalisation hydrocarbures).
 * - TVA (Taxe sur la Valeur Ajoutée): Taux normal 19%, Taux réduit 9%.
 * - Timbre Fiscal: 1% sur règlements en espèces (min 5 DA, max 10,000 DA par quittance).
 * - IRG / Salaires: Retenue à la source mensuelle sur les rémunérations des employés.
 * - IBS: Acomptes provisionnels de 30% le cas échéant.
 */

export const G50_DEFAULT_ENTERPRISE = {
  raisonSociale: 'SARL ATLAS TECH ALGER',
  nif: '001616012345678',
  nis: '00161601234567800010',
  rc: '16/00-1234567B22',
  articleImposition: '16012345678',
  centreDesImpots: 'CDI Bab Ezzouar (Direction des Grandes Entreprises / CDI Alger)',
  activite: 'Développement de logiciels et solutions informatiques (Code 6201)',
  regime: 'Régime Réel (Normal)',
  wilaya: '16 - الجزائر (Alger)'
};

/**
 * Computes G50 numbers from double-entry journal items and optional parameters.
 * @param {Array} journalEntries - Array of { date, piece, debitAccount, creditAccount, amount, label }
 * @param {Object} options - { period: '2026-01', creditTvaAnterieur: 0, acomptesIbs: 0 }
 */
export function computeG50FromJournal(journalEntries = [], options = {}) {
  const period = options.period || new Date().toISOString().slice(0, 7);
  const creditTvaAnterieur = Number(options.creditTvaAnterieur) || 0;
  const acomptesIbs = Number(options.acomptesIbs) || 0;

  let caNormal19 = 0;
  let tvaCollectee19 = 0;
  let caReduit9 = 0;
  let tvaCollectee9 = 0;
  let caExonere = 0;

  let tvaDeductibleAchats = 0;
  let tvaDeductibleServices = 0;

  let droitsTimbre = 0;
  let irgSalaires = 0;

  // Scan journal lines
  journalEntries.forEach(entry => {
    const dAcc = String(entry.debitAccount || '');
    const cAcc = String(entry.creditAccount || '');
    const amt = Number(entry.amount) || 0;
    const lbl = (entry.label || '').toLowerCase();

    // 1. Sales & Output TVA (Credit 700 series)
    if (cAcc.startsWith('70')) {
      if ((lbl.includes('9%') && !lbl.includes('19%')) || lbl.includes('réduit') || lbl.includes('مخفض')) {
        caReduit9 += amt;
      } else if (lbl.includes('0%') || lbl.includes('exonéré') || lbl.includes('معفى')) {
        caExonere += amt;
      } else {
        caNormal19 += amt;
      }
    }

    // 2. TVA Collectée (Credit 4457)
    if (cAcc.startsWith('4457')) {
      if ((lbl.includes('9%') && !lbl.includes('19%')) || lbl.includes('réduit') || lbl.includes('مخفض')) {
        tvaCollectee9 += amt;
      } else {
        tvaCollectee19 += amt;
      }
    }

    // 3. TVA Déductible (Debit 4456)
    if (dAcc.startsWith('4456')) {
      if (lbl.includes('service') || lbl.includes('loyer') || lbl.includes('maintenance')) {
        tvaDeductibleServices += amt;
      } else {
        tvaDeductibleAchats += amt;
      }
    }

    // 4. Timbre Fiscal (Credit 447 with timbre label)
    if (cAcc.startsWith('447') && (lbl.includes('timbre') || lbl.includes('طابع'))) {
      droitsTimbre += amt;
    }

    // 5. IRG / Salaires (Credit 447 or 442 with IRG label)
    if ((cAcc.startsWith('447') || cAcc.startsWith('442')) && (lbl.includes('irg') || lbl.includes('ضريبة'))) {
      irgSalaires += amt;
    }
  });

  // If TVA was not booked in separate 4457 lines, estimate from CA
  if (tvaCollectee19 === 0 && caNormal19 > 0) {
    tvaCollectee19 = Math.round(caNormal19 * 0.19 * 100) / 100;
  }
  if (tvaCollectee9 === 0 && caReduit9 > 0) {
    tvaCollectee9 = Math.round(caReduit9 * 0.09 * 100) / 100;
  }

  const totalTvaBrute = Math.round((tvaCollectee19 + tvaCollectee9) * 100) / 100;
  const totalTvaDeductible = Math.round((tvaDeductibleAchats + tvaDeductibleServices) * 100) / 100;

  const tvaNetDifference = Math.round((totalTvaBrute - totalTvaDeductible - creditTvaAnterieur) * 100) / 100;

  let tvaNetteAPayer = 0;
  let nouveauCreditTva = 0;

  if (tvaNetDifference >= 0) {
    tvaNetteAPayer = tvaNetDifference;
    nouveauCreditTva = 0;
  } else {
    tvaNetteAPayer = 0;
    nouveauCreditTva = Math.abs(tvaNetDifference);
  }

  // TAP (Exempted under LF 2024 for commercial/services/production)
  const caTotal = caNormal19 + caReduit9 + caExonere;
  const tapTaux = 0; // 0%
  const tapDues = 0;

  const totalDroitsDus = Math.round((tvaNetteAPayer + droitsTimbre + irgSalaires + acomptesIbs + tapDues) * 100) / 100;

  // Compute payment deadline (20th of following month)
  const parts = period.split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  const deadlineStr = `20/${String(nextMonth).padStart(2, '0')}/${nextYear}`;

  return {
    period,
    deadlineStr,
    tva: {
      caNormal19: Math.round(caNormal19 * 100) / 100,
      tvaCollectee19: Math.round(tvaCollectee19 * 100) / 100,
      caReduit9: Math.round(caReduit9 * 100) / 100,
      tvaCollectee9: Math.round(tvaCollectee9 * 100) / 100,
      caExonere: Math.round(caExonere * 100) / 100,
      caTotal: Math.round(caTotal * 100) / 100,
      totalTvaBrute,
      tvaDeductibleAchats: Math.round(tvaDeductibleAchats * 100) / 100,
      tvaDeductibleServices: Math.round(tvaDeductibleServices * 100) / 100,
      totalTvaDeductible,
      creditTvaAnterieur,
      tvaNetteAPayer,
      nouveauCreditTva
    },
    timbre: {
      droitsTimbre: Math.round(droitsTimbre * 100) / 100
    },
    irg: {
      irgSalaires: Math.round(irgSalaires * 100) / 100
    },
    tap: {
      caSoumisTap: caTotal,
      taux: tapTaux,
      tapDues,
      exoneree: true,
      referenceLegale: 'Loi de Finances 2024 (Abrogation générale de la TAP)'
    },
    ibs: {
      acomptesIbs: Math.round(acomptesIbs * 100) / 100
    },
    totaux: {
      totalDroitsDus
    }
  };
}

/**
 * Validates G50 input fields and checks compliance.
 */
export function validateG50Form(data = {}) {
  const errors = [];
  const nif = String(data.nif || '').replace(/\D/g, '');
  if (nif.length !== 15) {
    errors.push('الرقم التعريفي الجبائي NIF يجب أن يتكون من 15 رقماً بالضبط.');
  }

  const ai = String(data.articleImposition || '').trim();
  if (!ai) {
    errors.push('رقم المادة الضريبية (Article d\'imposition) مطلوب للتصريح الجبائي.');
  }

  if (!data.raisonSociale) {
    errors.push('اسم الشركة أو التسمية التجارية مطلوب.');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}
