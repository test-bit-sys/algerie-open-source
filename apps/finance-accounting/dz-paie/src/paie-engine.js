/**
 * DZ-Paie RH Pro — Algerian Payroll & Social Contributions Engine
 * Conforming to Algerian Labor Code (Loi 90-11), CNAS regulations,
 * and Official Barème IRG 2024 / 2025 (Art. 104 du CID).
 */

export function round2(num) {
  return Math.round((Number(num || 0) + Number.EPSILON) * 100) / 100;
}

/**
 * Algerian Barème IRG 2024 (Art. 104 Code des Impôts Directs)
 * Imposable <= 30,000 DA: Exonéré (0 DA)
 * 20,001 - 40,000: 23%
 * 40,001 - 80,000: 27%
 * 80,001 - 160,000: 30%
 * > 160,000: 35%
 * Abattement légal de 40% (min 1,000 DA, max 1,500 DA)
 * Dégrèvement transitoire pour la tranche 30,001 - 34,999 DA
 */
export function calculateIRG(imposableAmount) {
  const imposable = Math.max(0, Math.round(Number(imposableAmount) || 0));
  if (imposable <= 30000) return 0;

  let tax = 0;
  if (imposable > 20000) {
    tax += (Math.min(imposable, 40000) - 20000) * 0.23;
  }
  if (imposable > 40000) {
    tax += (Math.min(imposable, 80000) - 40000) * 0.27;
  }
  if (imposable > 80000) {
    tax += (Math.min(imposable, 160000) - 80000) * 0.30;
  }
  if (imposable > 160000) {
    tax += (imposable - 160000) * 0.35;
  }

  // 40% legal rebate (min 1,000 DA, max 1,500 DA)
  let abattement = tax * 0.40;
  if (abattement < 1000) abattement = 1000;
  if (abattement > 1500) abattement = 1500;

  tax = Math.max(0, tax - abattement);

  // Transitional relief for 30,000 - 35,000 bracket
  if (imposable > 30000 && imposable < 35000) {
    const factor = (35000 - imposable) / 5000;
    tax = tax * (1 - factor * 0.8);
  }

  return Math.round(tax);
}

/**
 * Computes complete Algerian payslip figures for an employee
 */
export function computePayslip(employee = {}) {
  const baseSalary = Math.max(0, Number(employee.baseSalary) || 0);
  const iep = Math.max(0, Number(employee.iepPrime) || 0);
  const pri = Math.max(0, Number(employee.priPrime) || 0);
  const nuisance = Math.max(0, Number(employee.nuisancePrime) || 0);
  const overtime = Math.max(0, Number(employee.overtimePay) || 0);

  // Primes cotisables CNAS (Salaire de poste)
  const primesCotisables = round2(iep + pri + nuisance + overtime);
  const salairePoste = round2(baseSalary + primesCotisables);

  // CNAS Salarié 9%
  const cnasSalarie = round2(salairePoste * 0.09);

  // CNAS Patronale 26%
  const cnasPatronale = round2(salairePoste * 0.26);

  // Indemnités non cotisables et non imposables (frais professionnels)
  const panier = Math.max(0, Number(employee.panierPrime) || 0);
  const transport = Math.max(0, Number(employee.transportPrime) || 0);
  const indemnitesFrais = round2(panier + transport);

  // Salaire Brut = Salaire de Poste + Indemnités de frais
  const salaireBrut = round2(salairePoste + indemnitesFrais);

  // Salaire Imposable = Brut - CNAS 9% - Indemnités non imposables (Panier + Transport) = Salaire de Poste - CNAS 9%
  const salaireImposable = round2(salairePoste - cnasSalarie);

  // Retenue IRG
  const irg = calculateIRG(salaireImposable);

  // Retenues diverses (avances, prêts...)
  const retenuesDiverses = Math.max(0, Number(employee.retenues) || 0);

  // Total Retenues Salarié
  const totalRetenues = round2(cnasSalarie + irg + retenuesDiverses);

  // Net à Payer
  const netAPayer = round2(salaireBrut - totalRetenues);

  // Coût Global pour l'Employeur
  const coutEmployeur = round2(salaireBrut + cnasPatronale);

  return {
    matricule: employee.matricule || 'EMP-001',
    name: employee.name || 'موظف',
    post: employee.post || 'إطار',
    wilaya: employee.wilaya || '16 - الجزائر',
    ssNumber: employee.ssNumber || '1990160012345678',
    paymentMethod: employee.paymentMethod || 'VIREMENT_CCP',
    ccpOrRib: employee.ccpOrRib || '007 99999 0012345678 45',

    // Amounts
    baseSalary,
    iep,
    pri,
    nuisance,
    overtime,
    primesCotisables,
    salairePoste,
    cnasSalarie,
    cnasPatronale,
    panier,
    transport,
    indemnitesFrais,
    salaireBrut,
    salaireImposable,
    irg,
    retenuesDiverses,
    totalRetenues,
    netAPayer,
    coutEmployeur
  };
}

/**
 * Computes company-wide monthly payroll ledger summary
 */
export function computePayrollJournal(employees = []) {
  const slips = employees.map(computePayslip);

  let totalBase = 0;
  let totalPoste = 0;
  let totalBrut = 0;
  let totalCnasSalarie = 0;
  let totalCnasPatronale = 0;
  let totalCnasGlobal = 0;
  let totalIRG = 0;
  let totalNet = 0;
  let totalCoutEmployeur = 0;

  slips.forEach(s => {
    totalBase = round2(totalBase + s.baseSalary);
    totalPoste = round2(totalPoste + s.salairePoste);
    totalBrut = round2(totalBrut + s.salaireBrut);
    totalCnasSalarie = round2(totalCnasSalarie + s.cnasSalarie);
    totalCnasPatronale = round2(totalCnasPatronale + s.cnasPatronale);
    totalIRG = round2(totalIRG + s.irg);
    totalNet = round2(totalNet + s.netAPayer);
    totalCoutEmployeur = round2(totalCoutEmployeur + s.coutEmployeur);
  });

  totalCnasGlobal = round2(totalCnasSalarie + totalCnasPatronale);

  return {
    slips,
    count: employees.length,
    totals: {
      totalBase,
      totalPoste,
      totalBrut,
      totalCnasSalarie,
      totalCnasPatronale,
      totalCnasGlobal,
      totalIRG,
      totalNet,
      totalCoutEmployeur
    }
  };
}

/**
 * Computes official CNAS teledeclaration (Déclaration d'Assiette de Cotisations - DAC)
 * Conforming to CNAS teledeclaration standards (35% total = 9% ouvrière + 26% patronale).
 */
export function computeCnasDeclaration(employees = [], options = {}) {
  const journal = computePayrollJournal(employees);
  const period = options.period || new Date().toISOString().slice(0, 7);
  const adherentNumber = options.adherentNumber || '16-9876543-21';
  const agency = options.agency || 'Agence CNAS Bab Ezzouar / Alger';

  const assiette = journal.totals.totalPoste;
  const partOuvriere9 = round2(assiette * 0.09);
  const partPatronale26 = round2(assiette * 0.26);
  const totalCotisations35 = round2(partOuvriere9 + partPatronale26);

  const abattementPct = Number(options.abattementPct) || 0;
  const montantAbattement = round2(partPatronale26 * (abattementPct / 100));
  const netAVerser = round2(totalCotisations35 - montantAbattement);

  const parts = period.split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  const deadlineStr = `30/${String(nextMonth).padStart(2, '0')}/${nextYear}`;

  return {
    period,
    deadlineStr,
    adherentNumber,
    agency,
    effectifDeclare: employees.length,
    assiette,
    partOuvriere9,
    partPatronale26,
    totalCotisations35,
    abattementPct,
    montantAbattement,
    netAVerser
  };
}

/**
 * Computes an official collective salary transfer order (Ordre de Virement de Masse)
 * for submission to Algérie Poste (CCP) or Algerian Commercial Banks.
 */
export function computeOrdreDeVirement(options = {}) {
  const month = options.month || new Date().toISOString().slice(0, 7);
  const emittorName = options.emittorName || 'شركة أطلس للتكنولوجيا (SARL ATLAS TECH)';
  const emittorRib = options.emittorRib || '007 99999 0001234567 89';
  const emittorBank = options.emittorBank || 'بريد الجزائر (Algérie Poste - CCP)';
  const channel = options.channel || 'ALL'; // 'ALL' | 'CCP' | 'BANQUE'
  const allEmployees = options.employees || DEMO_EMPLOYEES;

  const beneficiaries = [];
  let totalMontant = 0;

  for (const emp of allEmployees) {
    const method = String(emp.paymentMethod || 'VIREMENT_CCP').toUpperCase();
    const isVirement = method.startsWith('VIREMENT');
    if (!isVirement) continue;

    const isCcp = method === 'VIREMENT_CCP' || String(emp.ccpOrRib || '').replace(/\s/g, '').startsWith('007');
    if (channel === 'CCP' && !isCcp) continue;
    if (channel === 'BANQUE' && isCcp) continue;

    const slip = computePayslip(emp);
    const net = slip.netAPayer;
    totalMontant += net;

    beneficiaries.push({
      matricule: emp.matricule,
      name: emp.name,
      post: emp.post,
      bankType: isCcp ? 'بريد الجزائر (CCP)' : 'بنك تجاري (Banque)',
      isCcp,
      accountNumber: emp.ccpOrRib,
      amount: net
    });
  }

  totalMontant = round2(totalMontant);

  return {
    month,
    emittorName,
    emittorRib,
    emittorBank,
    channel,
    count: beneficiaries.length,
    beneficiaries,
    totalMontant
  };
}

/**
 * Generates an official text file for Algérie Poste or Bank electronic transfer
 */
export function generateVirementBatchText(virementData) {
  const lines = [
    `# BORDEREAU DE VIREMENT DE MASSE DES SALAIRES - MOIS ${virementData.month}`,
    `# EMETTEUR: ${virementData.emittorName} | COMPTE: ${virementData.emittorRib}`,
    `# TOTAL BENEFICIAIRES: ${virementData.count} | MONTANT TOTAL DZD: ${virementData.totalMontant}`,
    `# MATRICULE;NOM_PRENOM;COMPTE_RIP_RIB;MONTANT_DZD;TYPE_COMPTE`
  ];

  for (const b of virementData.beneficiaries) {
    lines.push(`${b.matricule};${b.name.replace(/;/g, ' ')};${b.accountNumber};${b.amount.toFixed(2)};${b.isCcp ? 'CCP' : 'BANQUE'}`);
  }

  return lines.join('\n');
}

/**
 * Preloaded Realistic Algerian Enterprise Employees
 */
export const DEMO_EMPLOYEES = [
  {
    id: '1',
    matricule: 'EMP-001',
    name: 'سفيان بن عبد الله (Sofiane Benabdallah)',
    post: 'مهندس برمجيات أول (Senior Software Engineer)',
    wilaya: '16 - الجزائر (Alger)',
    ssNumber: '1988160012345678',
    paymentMethod: 'VIREMENT_CCP',
    ccpOrRib: '007 99999 0012345678 45',
    baseSalary: 110000,
    iepPrime: 15000,
    priPrime: 10000,
    nuisancePrime: 5000,
    panierPrime: 8000,
    transportPrime: 6000,
    overtimePay: 0,
    retenues: 0
  },
  {
    id: '2',
    matricule: 'EMP-002',
    name: 'أمينة بلقاسم (Amina Belkacem)',
    post: 'محاسبة رئيسية (Comptable Principale SCF)',
    wilaya: '09 - البليدة (Blida)',
    ssNumber: '2199209009876543',
    paymentMethod: 'VIREMENT_BANCAIRE',
    ccpOrRib: '001 00123 0098765432 19',
    baseSalary: 75000,
    iepPrime: 8000,
    priPrime: 6000,
    nuisancePrime: 0,
    panierPrime: 8000,
    transportPrime: 6000,
    overtimePay: 0,
    retenues: 0
  },
  {
    id: '3',
    matricule: 'EMP-003',
    name: 'كريم مرابط (Karim Merabet)',
    post: 'مسؤول مبيعات وتسويق (Responsable Commercial)',
    wilaya: '31 - وهران (Oran)',
    ssNumber: '1199031005544332',
    paymentMethod: 'VIREMENT_CCP',
    ccpOrRib: '007 99999 0055443322 88',
    baseSalary: 60000,
    iepPrime: 5000,
    priPrime: 12000,
    nuisancePrime: 0,
    panierPrime: 8000,
    transportPrime: 6000,
    overtimePay: 5000,
    retenues: 0
  },
  {
    id: '4',
    matricule: 'EMP-004',
    name: 'ياسين حيدر (Yassine Haidar)',
    post: 'تقني شبكات ودعم فني (Technicien Réseaux & IT)',
    wilaya: '35 - بومرداس (Boumerdès)',
    ssNumber: '1199635002233441',
    paymentMethod: 'VIREMENT_CCP',
    ccpOrRib: '007 99999 0022334411 32',
    baseSalary: 45000,
    iepPrime: 3000,
    priPrime: 3000,
    nuisancePrime: 2000,
    panierPrime: 8000,
    transportPrime: 6000,
    overtimePay: 0,
    retenues: 0
  },
  {
    id: '5',
    matricule: 'EMP-005',
    name: 'فاطمة الزهراء قاسمي (Fatima Ghasmi)',
    post: 'مساعدة إدارية واستقبال (Assistante Administrative)',
    wilaya: '16 - الجزائر (Alger)',
    ssNumber: '2199816007788990',
    paymentMethod: 'ESPECES',
    ccpOrRib: 'دفع نقدي بموجب وصل استلام',
    baseSalary: 30000,
    iepPrime: 0,
    priPrime: 2000,
    nuisancePrime: 0,
    panierPrime: 6000,
    transportPrime: 4000,
    overtimePay: 0,
    retenues: 0
  }
];
