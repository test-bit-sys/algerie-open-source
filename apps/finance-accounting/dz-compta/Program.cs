using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace DZComptaSCF
{
    /// <summary>
    /// DZ-Compta SCF — Algerian Financial Accounting Engine (النظام المحاسبي المالي الجزائري)
    /// Part of DZ Open Suite (المنظومة الجزائرية للبرمجيات المفتوحة المصدر).
    /// Built natively in C# / .NET for enterprise-grade accounting and zero cloud dependency.
    /// </summary>
    
    public record Account(string Code, string LabelAr, string LabelFr, AccountCategory Category);

    public enum AccountCategory
    {
        Capitaux = 1,        // Classe 1
        Immobilisations = 2, // Classe 2
        Stocks = 3,          // Classe 3
        Tiers = 4,           // Classe 4
        Financiers = 5,      // Classe 5
        Charges = 6,         // Classe 6
        Produits = 7         // Classe 7
    }

    public record JournalEntryLine(string AccountCode, string Description, decimal Debit, decimal Credit);

    public class JournalTransaction
    {
        public string RefNumber { get; set; } = string.Empty;
        public DateTime Date { get; set; } = DateTime.UtcNow;
        public string JournalCode { get; set; } = "ACH"; // ACH (Achats), VEN (Ventes), BQ (Banque), OD (Opérations Diverses)
        public string Label { get; set; } = string.Empty;
        public List<JournalEntryLine> Lines { get; } = new();

        public bool IsBalanced => Lines.Sum(l => l.Debit) == Lines.Sum(l => l.Credit);
        public decimal TotalAmount => Lines.Sum(l => l.Debit);
    }

    public class AccountingLedger
    {
        private readonly Dictionary<string, Account> _chartOfAccounts = new();
        private readonly List<JournalTransaction> _transactions = new();

        public AccountingLedger()
        {
            SeedSCFChart();
        }

        private void SeedSCFChart()
        {
            // Plan Comptable SCF Algérien (Sélection des comptes fondamentaux)
            AddAccount("101", "رأس مال الشركة", "Capital social", AccountCategory.Capitaux);
            AddAccount("120", "نتيجة الدورة (ربح)", "Résultat de l'exercice (bénéfice)", AccountCategory.Capitaux);
            AddAccount("215", "المنشآت التقنية والعتاد الصناعي", "Installations techniques et matériel", AccountCategory.Immobilisations);
            AddAccount("300", "مخزونات البضائع", "Stocks de marchandises", AccountCategory.Stocks);
            AddAccount("401", "الموردون (موردو المخزونات والخدمات)", "Fournisseurs de stocks et services", AccountCategory.Tiers);
            AddAccount("411", "الزبائن (العملاء)", "Clients", AccountCategory.Tiers);
            AddAccount("44566", "رسم القيمة المضافة المسترجع على السلع", "TVA déductible sur autres biens et services", AccountCategory.Tiers);
            AddAccount("44571", "رسم القيمة المضافة المحصل", "TVA collectée sur ventes", AccountCategory.Tiers);
            AddAccount("512", "الحساب الجاري البنكي", "Banques comptes courants", AccountCategory.Financiers);
            AddAccount("517", "الحساب البريدي الجاري CCP", "Comptes chèques postaux (CCP)", AccountCategory.Financiers);
            AddAccount("530", "صندوق النقدية الرئيسي", "Caisse centrale", AccountCategory.Financiers);
            AddAccount("607", "مشتريات البضائع المبيعة", "Achats de marchandises vendues", AccountCategory.Charges);
            AddAccount("613", "إيجار المحلات والمكاتب", "Locations immobilières", AccountCategory.Charges);
            AddAccount("631", "أجور ورواتب العمال", "Rémunérations du personnel", AccountCategory.Charges);
            AddAccount("700", "مبيعات البضائع التجارية", "Ventes de marchandises", AccountCategory.Produits);
            AddAccount("706", "تقديم الخدمات الإدارية والاستشارية", "Prestations de services", AccountCategory.Produits);
        }

        public void AddAccount(string code, string labelAr, string labelFr, AccountCategory category)
        {
            _chartOfAccounts[code] = new Account(code, labelAr, labelFr, category);
        }

        public Account? GetAccount(string code) => _chartOfAccounts.GetValueOrDefault(code);

        public void PostTransaction(JournalTransaction tx)
        {
            if (!tx.IsBalanced)
            {
                throw exciting("Écriture déséquilibrée! Total Débit != Total Crédit.");
            }
            _transactions.Add(tx);
        }

        private static Exception exciting(string msg) => new InvalidOperationException(msg);

        public void PrintGeneralJournal()
        {
            Console.WriteLine("==========================================================================================");
            Console.WriteLine("  DZ-Compta SCF -- اليومية العامة للمحاسبة المالية (Journal Général)");
            Console.WriteLine("==========================================================================================");
            Console.WriteLine($"{"Date",-10} | {"Réf",-10} | {"Compte",-8} | {"Libellé d'opération",-32} | {"Débit (DZD)",12} | {"Crédit (DZD)",12}");
            Console.WriteLine(new string('-', 90));

            foreach (var tx in _transactions)
            {
                foreach (var line in tx.Lines)
                {
                    var acc = GetAccount(line.AccountCode);
                    var name = acc != null ? acc.LabelFr : line.AccountCode;
                    Console.WriteLine($"{tx.Date:yyyy-MM-dd} | {tx.RefNumber,-10} | {line.AccountCode,-8} | {name,-32} | {line.Debit,12:N2} | {line.Credit,12:N2}");
                }
                Console.WriteLine(new string('.', 90));
            }
            Console.WriteLine();
        }

        public void PrintBalanceGenerale()
        {
            Console.WriteLine("==========================================================================================");
            Console.WriteLine("  DZ-Compta SCF -- ميزان المراجعة العام (Balance Générale des Comptes)");
            Console.WriteLine("==========================================================================================");
            Console.WriteLine($"{"Compte",-8} | {"Intitulé SCF",-32} | {"Mvmt Débit",14} | {"Mvmt Crédit",14} | {"Solde Déb.",12} | {"Solde Créd.",12}");
            Console.WriteLine(new string('-', 100));

            var accountMovements = _transactions
                .SelectMany(t => t.Lines)
                .GroupBy(l => l.AccountCode)
                .OrderBy(g => g.Key);

            decimal totDebit = 0, totCredit = 0, totSoldeDeb = 0, totSoldeCred = 0;

            foreach (var group in accountMovements)
            {
                var acc = GetAccount(group.Key);
                var label = acc?.LabelFr ?? "Compte personnalisé";
                var debit = group.Sum(x => x.Debit);
                var credit = group.Sum(x => x.Credit);

                totDebit += debit;
                totCredit += credit;

                decimal soldeDeb = 0, soldeCred = 0;
                if (debit >= credit)
                {
                    soldeDeb = debit - credit;
                    totSoldeDeb += soldeDeb;
                }
                else
                {
                    soldeCred = credit - debit;
                    totSoldeCred += soldeCred;
                }

                Console.WriteLine($"{group.Key,-8} | {label,-32} | {debit,14:N2} | {credit,14:N2} | {soldeDeb,12:N2} | {soldeCred,12:N2}");
            }

            Console.WriteLine(new string('=', 100));
            Console.WriteLine($"{"TOTAUX GENERAUX",-43} | {totDebit,14:N2} | {totCredit,14:N2} | {totSoldeDeb,12:N2} | {totSoldeCred,12:N2}");
            Console.WriteLine("==========================================================================================");
            
            bool isBalanced = (totDebit == totCredit) && (totSoldeDeb == totSoldeCred);
            Console.WriteLine(isBalanced 
                ? "  CONFORMITÉ SCF: ميزان المراجعة متطابق تماماً (Équilibre Parfait)" 
                : "  ATTENTION: خلل في التوازن المحاسبي!");
            Console.WriteLine("==========================================================================================");
        }
    }

    internal static class Program
    {
        private static void Main()
        {
            Console.OutputEncoding = Encoding.UTF8;

            Console.WriteLine("==========================================================================================");
            Console.WriteLine("  DZ-Compta SCF -- المحرك الأصلي للمحاسبة المالية والميزانية بلغة C# (.NET)");
            Console.WriteLine("  المنظومة الجزائرية للبرمجيات المفتوحة المصدر (DZ Open Suite - Track 03)");
            Console.WriteLine("==========================================================================================\n");

            var ledger = new AccountingLedger();

            // 1. Écriture d'achat de marchandises avec TVA 19% (Facture F-2026/042)
            // HT: 100 000 DZD | TVA (19%): 19 000 DZD | TTC: 119 000 DZD
            var txAchat = new JournalTransaction
            {
                RefNumber = "FAC-ACH-042",
                Date = DateTime.Now.AddDays(-10),
                JournalCode = "ACH",
                Label = "Achat marchandises auprès du Fournisseur El-Bahdja"
            };
            txAchat.Lines.Add(new JournalEntryLine("607", "Achats de marchandises", 100_000.00m, 0m));
            txAchat.Lines.Add(new JournalEntryLine("44566", "TVA déductible 19%", 19_000.00m, 0m));
            txAchat.Lines.Add(new JournalEntryLine("401", "Dette Fournisseurs El-Bahdja", 0m, 119_000.00m));
            ledger.PostTransaction(txAchat);

            // 2. Écriture de vente de marchandises avec TVA 19% (Facture F-2026/108)
            // HT: 250 000 DZD | TVA (19%): 47 500 DZD | TTC: 297 500 DZD
            var txVente = new JournalTransaction
            {
                RefNumber = "FAC-VEN-108",
                Date = DateTime.Now.AddDays(-5),
                JournalCode = "VEN",
                Label = "Vente marchandises au Client SARL Atlas Tech"
            };
            txVente.Lines.Add(new JournalEntryLine("411", "Créance Client SARL Atlas", 297_500.00m, 0m));
            txVente.Lines.Add(new JournalEntryLine("700", "Ventes de marchandises", 0m, 250_000.00m));
            txVente.Lines.Add(new JournalEntryLine("44571", "TVA collectée 19%", 0m, 47_500.00m));
            ledger.PostTransaction(txVente);

            // 3. Règlement bancaire par virement BNA (Encaissement Client)
            var txReglement = new JournalTransaction
            {
                RefNumber = "VIR-BNA-991",
                Date = DateTime.Now.AddDays(-2),
                JournalCode = "BQ",
                Label = "Encaissement Facture 108 par Virement BNA"
            };
            txReglement.Lines.Add(new JournalEntryLine("512", "Banque BNA Compte Courant", 297_500.00m, 0m));
            txReglement.Lines.Add(new JournalEntryLine("411", "Solde Créance Client Atlas", 0m, 297_500.00m));
            ledger.PostTransaction(txReglement);

            // Affichage des états comptables officiels
            ledger.PrintGeneralJournal();
            ledger.PrintBalanceGenerale();
        }
    }
}
