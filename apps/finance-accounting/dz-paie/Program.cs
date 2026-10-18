using System;
using System.Text;

namespace DZPaieRH
{
    /// <summary>
    /// DZ-Paie RH — Algerian National Payroll & CNAS Social Security Engine in C# (.NET 10)
    /// Part of DZ Open Suite (المنظومة الجزائرية للبرمجيات المفتوحة المصدر - Track 03).
    /// Replaces PC Paie with 100% legal compliance with Algerian labor and tax laws.
    /// </summary>
    
    public record Employee(string Matricule, string FullNameAr, string FullNameFr, string Post, decimal BaseSalary);

    public record PaySlip(
        Employee Employee,
        DateTime Period,
        decimal BaseSalary,
        decimal PrimesCotisables,    // IEP, PRI, PRC...
        decimal PrimesNonCotisables, // Panier, Transport...
        decimal SalaireBrut,
        decimal CnasOuvriere,        // 9%
        decimal CnasPatronale,       // 26%
        decimal SalaireImposable,
        decimal IrgBareme,
        decimal SalaireNet
    );

    public static class AlgerianFiscalEngine
    {
        public const decimal CNAS_OUVRIER_RATE = 0.09m;   // 9%
        public const decimal CNAS_PATRONAL_RATE = 0.26m;  // 26%

        /// <summary>
        /// Calculates monthly IRG Salaires according to Algerian Tax Scale (Barème DGI actualisé).
        /// Total exemption for taxable salaries <= 30 000 DZD.
        /// Progressive tax brackets with 40% abattement.
        /// </summary>
        public static decimal CalculateIRG(decimal taxableSalary)
        {
            if (taxableSalary <= 30_000m)
            {
                return 0.00m; // Exonération totale pour salaires <= 30 000 DZD
            }

            decimal tax = 0m;

            // Tranche 1: 0 - 20 000 @ 0%
            // Tranche 2: 20 000 - 40 000 @ 23%
            if (taxableSalary > 20_000m)
            {
                decimal portion = Math.Min(taxableSalary, 40_000m) - 20_000m;
                tax += portion * 0.23m;
            }

            // Tranche 3: 40 000 - 80 000 @ 27%
            if (taxableSalary > 40_000m)
            {
                decimal portion = Math.Min(taxableSalary, 80_000m) - 40_000m;
                tax += portion * 0.27m;
            }

            // Tranche 4: 80 000 - 160 000 @ 30%
            if (taxableSalary > 80_000m)
            {
                decimal portion = Math.Min(taxableSalary, 160_000m) - 80_000m;
                tax += portion * 0.30m;
            }

            // Tranche 5: 160 000 - 320 000 @ 33%
            if (taxableSalary > 160_000m)
            {
                decimal portion = Math.Min(taxableSalary, 320_000m) - 160_000m;
                tax += portion * 0.33m;
            }

            // Tranche 6: > 320 000 @ 35%
            if (taxableSalary > 320_000m)
            {
                decimal portion = taxableSalary - 320_000m;
                tax += portion * 0.35m;
            }

            // Abattement de 40% (min 1000 DZD, max 1500 DZD)
            decimal abattement = tax * 0.40m;
            if (abattement < 1000m) abattement = 1000m;
            if (abattement > 1500m) abattement = 1500m;

            decimal netTax = Math.Max(0m, tax - abattement);

            // Régime dérogatoire pour salaires entre 30 001 et 35 000 DZD
            if (taxableSalary > 30_000m && taxableSalary < 35_000m)
            {
                decimal irgStandard = netTax;
                decimal reduction = irgStandard * ((35_000m - taxableSalary) / 5_000m);
                netTax = Math.Max(0m, irgStandard - reduction);
            }

            return Math.Round(netTax, 2);
        }

        public static PaySlip GeneratePaySlip(Employee emp, DateTime period, decimal primeRendement, decimal indemnitéTransport, decimal indemnitéPanier)
        {
            decimal primesCotisables = primeRendement;
            decimal baseCotisable = emp.BaseSalary + primesCotisables;

            decimal cnasOuvriere = Math.Round(baseCotisable * CNAS_OUVRIER_RATE, 2);
            decimal cnasPatronale = Math.Round(baseCotisable * CNAS_PATRONAL_RATE, 2);

            decimal primesNonCotisables = indemnitéTransport + indemnitéPanier;
            decimal salaireBrut = baseCotisable + primesNonCotisables;

            decimal salaireImposable = Math.Round(salaireBrut - cnasOuvriere, 2);
            decimal irg = CalculateIRG(salaireImposable);

            decimal salaireNet = Math.Round(salaireBrut - cnasOuvriere - irg, 2);

            return new PaySlip(
                Employee: emp,
                Period: period,
                BaseSalary: emp.BaseSalary,
                PrimesCotisables: primesCotisables,
                PrimesNonCotisables: primesNonCotisables,
                SalaireBrut: salaireBrut,
                CnasOuvriere: cnasOuvriere,
                CnasPatronale: cnasPatronale,
                SalaireImposable: salaireImposable,
                IrgBareme: irg,
                SalaireNet: salaireNet
            );
        }
    }

    internal static class Program
    {
        private static void Main()
        {
            Console.OutputEncoding = Encoding.UTF8;

            Console.WriteLine("==========================================================================================");
            Console.WriteLine("  DZ-Paie RH -- المحرك الأصلي لكشوف الرواتب والضمان الاجتماعي بلغة C# (.NET 10)");
            Console.WriteLine("  المنظومة الجزائرية للبرمجيات المفتوحة المصدر (DZ Open Suite - Track 03)");
            Console.WriteLine("==========================================================================================\n");

            var emp1 = new Employee("EMP-2026/001", "أحمد بلقاسم", "Ahmed Belkacem", "Ingénieur Chef de Projet", 65_000.00m);
            var emp2 = new Employee("EMP-2026/002", "سليمان دحماني", "Slimane Dahmani", "Agent Commercial", 32_000.00m);

            var slip1 = AlgerianFiscalEngine.GeneratePaySlip(emp1, DateTime.Now, 15_000m, 4_000m, 6_000m);
            var slip2 = AlgerianFiscalEngine.GeneratePaySlip(emp2, DateTime.Now, 3_000m, 2_000m, 3_000m);

            PrintSlip(slip1);
            PrintSlip(slip2);
        }

        private static void PrintSlip(PaySlip slip)
        {
            Console.WriteLine("------------------------------------------------------------------------------------------");
            Console.WriteLine($"  BULLETIN DE PAIE — {slip.Period:MMMM yyyy} | REPUBLIQUE ALGERIENNE DEMOCRATIQUE ET POPULAIRE");
            Console.WriteLine("------------------------------------------------------------------------------------------");
            Console.WriteLine($"Matricule    : {slip.Employee.Matricule,-20} Nom & Prénom : {slip.Employee.FullNameFr} ({slip.Employee.FullNameAr})");
            Console.WriteLine($"Poste / Rôle : {slip.Employee.Post}");
            Console.WriteLine(new string('-', 90));
            Console.WriteLine($"{"Rubrique de Salaire",-42} | {"Base (DZD)",14} | {"Taux / Formule",14} | {"Montant (DZD)",14}");
            Console.WriteLine(new string('-', 90));
            Console.WriteLine($"{"001 Salaire de Base",-42} | {slip.BaseSalary,14:N2} | {"100.0%",14} | {slip.BaseSalary,14:N2}");
            Console.WriteLine($"{"105 Primes de Rendement (PRI/PRC)",-42} | {slip.PrimesCotisables,14:N2} | {"Cotisable",14} | {slip.PrimesCotisables,14:N2}");
            Console.WriteLine($"{"201 Indemnités Panier & Transport",-42} | {slip.PrimesNonCotisables,14:N2} | {"Non Cotisable",14} | {slip.PrimesNonCotisables,14:N2}");
            Console.WriteLine(new string('.', 90));
            Console.WriteLine($"{"TOTAL SALAIRE BRUT",-42} | {slip.SalaireBrut,14:N2} | {"Gain Total",14} | {slip.SalaireBrut,14:N2}");
            Console.WriteLine($"{"401 Retenue Sécurité Sociale (CNAS)",-42} | {slip.BaseSalary + slip.PrimesCotisables,14:N2} | {"9.00%",14} | {-slip.CnasOuvriere,14:N2}");
            Console.WriteLine($"{"SALAIRE IMPOSABLE (Brut - CNAS 9%)",-42} | {slip.SalaireImposable,14:N2} | {"Assiette IRG",14} | {slip.SalaireImposable,14:N2}");
            Console.WriteLine($"{"501 Impôt sur le Revenu Global (IRG)",-42} | {slip.SalaireImposable,14:N2} | {"Barème DGI",14} | {-slip.IrgBareme,14:N2}");
            Console.WriteLine(new string('=', 90));
            Console.WriteLine($"{"NET A PAYER AU SALARIE (DZD)",-42} | {"VIREMENT CCP/BEA",14} | {"NET FINAL",14} | {slip.SalaireNet,14:N2}");
            Console.WriteLine($"{"Charge Patronale CNAS (26%)",-42} | {slip.BaseSalary + slip.PrimesCotisables,14:N2} | {"26.00%",14} | {slip.CnasPatronale,14:N2}");
            Console.WriteLine("------------------------------------------------------------------------------------------\n");
        }
    }
}
