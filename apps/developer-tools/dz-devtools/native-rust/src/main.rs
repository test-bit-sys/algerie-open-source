//! DZ-DevTools Native — Sovereign Developer CLI & 58 Wilayas SDK in Pure Rust
//! -------------------------------------------------------------------------
//! Part of DZ Open Suite (المنظومة الجزائرية للبرمجيات المفتوحة المصدر).
//! Provides instant offline validation, postal keys, Luhn card checks, and 58 Wilayas queries.

use std::env;

#[derive(Debug, Clone)]
pub struct Wilaya {
    pub code: u8,
    pub name_ar: &'static str,
    pub name_fr: &'static str,
    pub postal_code: &'static str,
    pub area_code: &'static str,
}

pub const WILAYAS_58: &[Wilaya] = &[
    Wilaya { code: 1, name_ar: "أدرار", name_fr: "Adrar", postal_code: "01000", area_code: "049" },
    Wilaya { code: 2, name_ar: "الشلف", name_fr: "Chlef", postal_code: "02000", area_code: "027" },
    Wilaya { code: 3, name_ar: "الأغواط", name_fr: "Laghouat", postal_code: "03000", area_code: "029" },
    Wilaya { code: 4, name_ar: "أم البواقي", name_fr: "Oum El Bouaghi", postal_code: "04000", area_code: "032" },
    Wilaya { code: 5, name_ar: "باتنة", name_fr: "Batna", postal_code: "05000", area_code: "033" },
    Wilaya { code: 6, name_ar: "بجاية", name_fr: "Béjaïa", postal_code: "06000", area_code: "034" },
    Wilaya { code: 7, name_ar: "بسكرة", name_fr: "Biskra", postal_code: "07000", area_code: "033" },
    Wilaya { code: 8, name_ar: "بشار", name_fr: "Béchar", postal_code: "08000", area_code: "049" },
    Wilaya { code: 9, name_ar: "البليدة", name_fr: "Blida", postal_code: "09000", area_code: "025" },
    Wilaya { code: 10, name_ar: "البويرة", name_fr: "Bouira", postal_code: "10000", area_code: "026" },
    Wilaya { code: 11, name_ar: "تمنراست", name_fr: "Tamanrasset", postal_code: "11000", area_code: "029" },
    Wilaya { code: 12, name_ar: "تبسة", name_fr: "Tébessa", postal_code: "12000", area_code: "037" },
    Wilaya { code: 13, name_ar: "تلمسان", name_fr: "Tlemcen", postal_code: "13000", area_code: "043" },
    Wilaya { code: 14, name_ar: "تيارت", name_fr: "Tiaret", postal_code: "14000", area_code: "046" },
    Wilaya { code: 15, name_ar: "تيزي وزو", name_fr: "Tizi Ouzou", postal_code: "15000", area_code: "026" },
    Wilaya { code: 16, name_ar: "الجزائر", name_fr: "Alger", postal_code: "16000", area_code: "021" },
    Wilaya { code: 17, name_ar: "الجلفة", name_fr: "Djelfa", postal_code: "17000", area_code: "027" },
    Wilaya { code: 18, name_ar: "جيجل", name_fr: "Jijel", postal_code: "18000", area_code: "034" },
    Wilaya { code: 19, name_ar: "سطيف", name_fr: "Sétif", postal_code: "19000", area_code: "036" },
    Wilaya { code: 20, name_ar: "سعيدة", name_fr: "Saïda", postal_code: "20000", area_code: "048" },
    Wilaya { code: 21, name_ar: "سكيكدة", name_fr: "Skikda", postal_code: "21000", area_code: "038" },
    Wilaya { code: 22, name_ar: "سيدي بلعباس", name_fr: "Sidi Bel Abbès", postal_code: "22000", area_code: "048" },
    Wilaya { code: 23, name_ar: "عنابة", name_fr: "Annaba", postal_code: "23000", area_code: "038" },
    Wilaya { code: 24, name_ar: "قالمة", name_fr: "Guelma", postal_code: "24000", area_code: "037" },
    Wilaya { code: 25, name_ar: "قسنطينة", name_fr: "Constantine", postal_code: "25000", area_code: "031" },
    Wilaya { code: 26, name_ar: "المدية", name_fr: "Médéa", postal_code: "26000", area_code: "025" },
    Wilaya { code: 27, name_ar: "مستغانم", name_fr: "Mostaganem", postal_code: "27000", area_code: "045" },
    Wilaya { code: 28, name_ar: "المسيلة", name_fr: "M'Sila", postal_code: "28000", area_code: "035" },
    Wilaya { code: 29, name_ar: "معسكر", name_fr: "Mascara", postal_code: "29000", area_code: "045" },
    Wilaya { code: 30, name_ar: "ورقلة", name_fr: "Ouargla", postal_code: "30000", area_code: "029" },
    Wilaya { code: 31, name_ar: "وهران", name_fr: "Oran", postal_code: "31000", area_code: "041" },
    Wilaya { code: 32, name_ar: "البيض", name_fr: "El Bayadh", postal_code: "32000", area_code: "049" },
    Wilaya { code: 33, name_ar: "إليزي", name_fr: "Illizi", postal_code: "33000", area_code: "029" },
    Wilaya { code: 34, name_ar: "برج بوعريريج", name_fr: "Bordj Bou Arréridj", postal_code: "34000", area_code: "035" },
    Wilaya { code: 35, name_ar: "بومرداس", name_fr: "Boumerdès", postal_code: "35000", area_code: "024" },
    Wilaya { code: 36, name_ar: "الطارف", name_fr: "El Tarf", postal_code: "36000", area_code: "038" },
    Wilaya { code: 37, name_ar: "تندوف", name_fr: "Tindouf", postal_code: "37000", area_code: "049" },
    Wilaya { code: 38, name_ar: "تيسمسيلت", name_fr: "Tissemsilt", postal_code: "38000", area_code: "046" },
    Wilaya { code: 39, name_ar: "الوادي", name_fr: "El Oued", postal_code: "39000", area_code: "032" },
    Wilaya { code: 40, name_ar: "خنشلة", name_fr: "Khenchela", postal_code: "40000", area_code: "032" },
    Wilaya { code: 41, name_ar: "سوق أهراس", name_fr: "Souk Ahras", postal_code: "41000", area_code: "037" },
    Wilaya { code: 42, name_ar: "تيبازة", name_fr: "Tipaza", postal_code: "42000", area_code: "024" },
    Wilaya { code: 43, name_ar: "ميلة", name_fr: "Mila", postal_code: "43000", area_code: "031" },
    Wilaya { code: 44, name_ar: "عين الدفلى", name_fr: "Aïn Defla", postal_code: "44000", area_code: "027" },
    Wilaya { code: 45, name_ar: "النعامة", name_fr: "Naâma", postal_code: "45000", area_code: "049" },
    Wilaya { code: 46, name_ar: "عين تموشنت", name_fr: "Aïn Témouchent", postal_code: "46000", area_code: "043" },
    Wilaya { code: 47, name_ar: "غرداية", name_fr: "Ghardaïa", postal_code: "47000", area_code: "029" },
    Wilaya { code: 48, name_ar: "غليزان", name_fr: "Relizane", postal_code: "48000", area_code: "046" },
    Wilaya { code: 49, name_ar: "تيميمون", name_fr: "Timimoun", postal_code: "49000", area_code: "049" },
    Wilaya { code: 50, name_ar: "برج باجي مختار", name_fr: "Bordj Badji Mokhtar", postal_code: "50000", area_code: "049" },
    Wilaya { code: 51, name_ar: "أولاد جلال", name_fr: "Ouled Djellal", postal_code: "51000", area_code: "033" },
    Wilaya { code: 52, name_ar: "بني عباس", name_fr: "Béni Abbès", postal_code: "52000", area_code: "049" },
    Wilaya { code: 53, name_ar: "عين صالح", name_fr: "In Salah", postal_code: "53000", area_code: "029" },
    Wilaya { code: 54, name_ar: "عين قزام", name_fr: "In Guezzam", postal_code: "54000", area_code: "029" },
    Wilaya { code: 55, name_ar: "توقرت", name_fr: "Touggourt", postal_code: "55000", area_code: "029" },
    Wilaya { code: 56, name_ar: "جانت", name_fr: "Djanet", postal_code: "56000", area_code: "029" },
    Wilaya { code: 57, name_ar: "المغير", name_fr: "El M'Ghair", postal_code: "57000", area_code: "032" },
    Wilaya { code: 58, name_ar: "المنيعة", name_fr: "El Menia", postal_code: "58000", area_code: "029" },
];

/// Algérie Poste CCP Key (Mod-97 standard postal algorithm)
pub fn calculate_ccp_key(account: u64) -> u8 {
    let remainder = (account * 100) % 97;
    let key = if remainder == 0 { 0 } else { 97 - remainder };
    key as u8
}

/// Standard Luhn algorithm for CIB & Edahabia card validation
pub fn validate_luhn(card_number: &str) -> bool {
    let digits: Vec<u32> = card_number
        .chars()
        .filter(|c| c.is_ascii_digit())
        .filter_map(|c| c.to_digit(10))
        .collect();

    if digits.len() < 13 || digits.len() > 19 {
        return false;
    }

    let mut sum = 0;
    let len = digits.len();
    for (i, &d) in digits.iter().enumerate() {
        let is_even_from_right = (len - i) % 2 == 0;
        if is_even_from_right {
            let doubled = d * 2;
            sum += if doubled > 9 { doubled - 9 } else { doubled };
        } else {
            sum += d;
        }
    }

    sum % 10 == 0
}

/// Identifies card network
pub fn identify_card_network(card_number: &str) -> &'static str {
    let clean: String = card_number.chars().filter(|c| c.is_ascii_digit()).collect();
    if clean.starts_with("603578") || clean.starts_with("628045") {
        "Edahabia (Algérie Poste)"
    } else if clean.starts_with("5399") || clean.starts_with("52") || clean.starts_with("51") {
        "CIB Mastercard (Banques Algériennes)"
    } else if clean.starts_with('4') {
        "CIB Visa (Banques Algériennes)"
    } else {
        "Carte Bancaire Inconnue"
    }
}

pub fn validate_nif(nif: &str) -> bool {
    let clean: String = nif.chars().filter(|c| c.is_ascii_digit()).collect();
    clean.len() == 15
}

pub fn validate_nis(nis: &str) -> bool {
    let clean: String = nis.chars().filter(|c| c.is_ascii_digit()).collect();
    clean.len() == 20
}

fn print_wilaya_details(w: &Wilaya) {
    println!("--------------------------------------------------");
    println!("Matricule / Code : {:02}", w.code);
    println!("Nom Arabe        : {}", w.name_ar);
    println!("Nom Français     : {}", w.name_fr);
    println!("Code Postal      : {}", w.postal_code);
    println!("Indicatif Tél    : {}", w.area_code);
    println!("--------------------------------------------------");
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        println!("DZ-DevTools Native CLI -- المنصة السيادية لأدوات المطورين الجزائريين");
        println!("Usage: dz_devtools_native <COMMAND> [OPTIONS]");
        println!();
        println!("Commands:");
        println!("  wilaya <code|name>     Query Algerian Wilaya by code (1-58) or name");
        println!("  ccp <account_number>   Calculate Algérie Poste CCP Key (Mod-97)");
        println!("  card <card_number>     Validate CIB / Edahabia card via Luhn algorithm");
        println!("  nif <nif_number>       Validate Algerian Fiscal Number (NIF 15 digits)");
        println!("  nis <nis_number>       Validate Algerian Statistical Number (NIS 20 digits)");
        println!("  list-wilayas           List all 58 Algerian Wilayas");
        println!("  -h, --help             Display this help information");
        return;
    }

    match args[1].as_str() {
        "ccp" => {
            if args.len() < 3 {
                eprintln!("Usage: dz_devtools_native ccp <account_number>");
                return;
            }
            if let Ok(acc) = args[2].parse::<u64>() {
                let key = calculate_ccp_key(acc);
                let rip = format!("00799999{:010}{:02}", acc, key);
                println!("Algérie Poste CCP Calculation:");
                println!("  Compte CCP       : {}", acc);
                println!("  Clé CCP (Mod-97) : {:02}", key);
                println!("  RIP Postale      : {}", rip);
            } else {
                eprintln!("Error: Invalid CCP account number: {}", args[2]);
            }
        }
        "card" => {
            if args.len() < 3 {
                eprintln!("Usage: dz_devtools_native card <card_number>");
                return;
            }
            let card = &args[2];
            let is_valid = validate_luhn(card);
            let net = identify_card_network(card);
            println!("Algerian Card Verification:");
            println!("  Numéro de carte : {}", card);
            println!("  Réseau / Type   : {}", net);
            println!("  Statut Luhn     : {}", if is_valid { "VALIDE (OK)" } else { "INVALIDE" });
        }
        "nif" => {
            if args.len() < 3 {
                eprintln!("Usage: dz_devtools_native nif <nif_number>");
                return;
            }
            let valid = validate_nif(&args[2]);
            println!("NIF Fiscal Verification: {} -> {}", args[2], if valid { "VALIDE (15 chiffres)" } else { "INVALIDE" });
        }
        "nis" => {
            if args.len() < 3 {
                eprintln!("Usage: dz_devtools_native nis <nis_number>");
                return;
            }
            let valid = validate_nis(&args[2]);
            println!("NIS Statistical Verification: {} -> {}", args[2], if valid { "VALIDE (20 chiffres)" } else { "INVALIDE" });
        }
        "wilaya" => {
            if args.len() < 3 {
                eprintln!("Usage: dz_devtools_native wilaya <code|name>");
                return;
            }
            let query = &args[2];
            if let Ok(code) = query.parse::<u8>() {
                if let Some(w) = WILAYAS_58.iter().find(|w| w.code == code) {
                    print_wilaya_details(w);
                    return;
                }
            }
            let q_lower = query.to_lowercase();
            if let Some(w) = WILAYAS_58.iter().find(|w| w.name_fr.to_lowercase() == q_lower || w.name_ar == query) {
                print_wilaya_details(w);
                return;
            }
            eprintln!("Wilaya not found: '{}'", query);
        }
        "list-wilayas" => {
            println!("{:<4} | {:<20} | {:<22} | {:<8} | {:<5}", "Code", "Nom Français", "الاسم بالعربية", "Postal", "Tél");
            println!("{:-<72}", "");
            for w in WILAYAS_58 {
                println!("{:02}   | {:<20} | {:<22} | {:<8} | {:<5}", w.code, w.name_fr, w.name_ar, w.postal_code, w.area_code);
            }
        }
        other => {
            eprintln!("Unknown command: '{}'. Run 'dz_devtools_native --help' for usage.", other);
        }
    }
}
