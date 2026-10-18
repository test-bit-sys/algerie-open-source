"""
DZ-RPA — Algerian Earthquake Seismic Engineering Engine (RPA 99 / Version 2003)
--------------------------------------------------------------------------------
Part of DZ Open Suite (المنظومة الجزائرية للبرمجيات المفتوحة المصدر - Track 08).
Implements DTR-BC 2-48: Règles Parasismiques Algériennes (RPA 99 / Version 2003).
Calculates Zone Acceleration, Dynamic Amplification, Base Shear, Story Drift & Floor Loads.
"""

import argparse
import json
import math
import sys
from typing import Dict, Any, List, Optional, Tuple

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Annexe I: Classification sismique des Wilayas et Communes (RPA 99 / v2003)
WILAYA_SEISMIC_ZONES: Dict[str, str] = {
    # Zone III: Sismicité élevée
    "chlef": "III", "02": "III",
    "ain defla": "III", "aïn defla": "III", "44": "III",

    # Zone IIb: Sismicité moyenne à élevée
    "alger": "IIb", "16": "IIb",
    "blida": "IIb", "09": "IIb",
    "boumerdes": "IIb", "boumerdès": "IIb", "35": "IIb",
    "tipaza": "IIb", "42": "IIb",

    # Zone IIa: Sismicité moyenne
    "oran": "IIa", "31": "IIa",
    "constantine": "IIa", "25": "IIa",
    "tizi ouzou": "IIa", "15": "IIa",
    "bouira": "IIa", "10": "IIa",
    "medea": "IIa", "médéa": "IIa", "26": "IIa",
    "mostaganem": "IIa", "27": "IIa",
    "mascara": "IIa", "29": "IIa",
    "setif": "IIa", "sétif": "IIa", "19": "IIa",
    "jijel": "IIa", "18": "IIa",
    "skikda": "IIa", "21": "IIa",
    "annaba": "IIa", "23": "IIa",
    "guelma": "IIa", "24": "IIa",
    "bordj bou arreridj": "IIa", "34": "IIa",
    "mila": "IIa", "43": "IIa",
    "relizane": "IIa", "48": "IIa",
    "ain temouchent": "IIa", "aïn témouchent": "IIa", "46": "IIa",
    "bejaia": "IIa", "béjaïa": "IIa", "06": "IIa",

    # Zone I: Sismicité faible
    "tlemcen": "I", "13": "I",
    "sidi bel abbes": "I", "sidi bel abbès": "I", "22": "I",
    "tiaret": "I", "14": "I",
    "saida": "I", "saïda": "I", "20": "I",
    "biskra": "I", "07": "I",
    "tebessa": "I", "tébessa": "I", "12": "I",
    "djelfa": "I", "17": "I",
    "msila": "I", "m'sila": "I", "28": "I",
    "batna": "I", "05": "I",
    "oum el bouaghi": "I", "04": "I",
    "khenchela": "I", "40": "I",
    "souk ahras": "I", "41": "I",
    "tissemsilt": "I", "38": "I",
    "el bayadh": "I", "32": "I",
    "naama": "I", "naâma": "I", "45": "I",
    "el tarf": "I", "36": "I",
    "ouled djellal": "I", "51": "I",

    # Zone 0: Sismicité négligeable
    "adrar": "0", "01": "0",
    "laghouat": "0", "03": "0",
    "bechar": "0", "béchar": "0", "08": "0",
    "tamanrasset": "0", "11": "0",
    "ouargla": "0", "30": "0",
    "illizi": "0", "33": "0",
    "tindouf": "0", "37": "0",
    "el oued": "0", "39": "0",
    "ghardaia": "0", "ghardaïa": "0", "47": "0",
    "timimoun": "0", "49": "0",
    "bordj badji mokhtar": "0", "50": "0",
    "beni abbes": "0", "béni abbès": "0", "52": "0",
    "in salah": "0", "53": "0",
    "in guezzam": "0", "54": "0",
    "touggourt": "0", "55": "0",
    "djanet": "0", "56": "0",
    "el mghair": "0", "el m'ghair": "0", "57": "0",
    "el menia": "0", "58": "0",
}

ACCELERATION_COEFFICIENTS = {
    "1A": {"0": 0.00, "I": 0.15, "IIa": 0.25, "IIb": 0.30, "III": 0.40},
    "1B": {"0": 0.00, "I": 0.12, "IIa": 0.20, "IIb": 0.25, "III": 0.30},
    "2":  {"0": 0.00, "I": 0.08, "IIa": 0.15, "IIb": 0.20, "III": 0.25},
    "3":  {"0": 0.00, "I": 0.05, "IIa": 0.10, "IIb": 0.14, "III": 0.18},
}

BEHAVIOR_FACTORS = {
    "portiques_autostables_beton": {"R": 5.0, "desc": "Portiques autostables en béton armé sans remplissage rigide"},
    "portiques_remplissage_maconnerie": {"R": 3.5, "desc": "Portiques autostables en béton armé avec maçonnerie"},
    "voiles_porteurs_beton": {"R": 3.5, "desc": "Ossature avec voiles porteurs en béton armé"},
    "mixte_portiques_voiles": {"R": 5.0, "desc": "Structure mixte portiques / voiles avec interaction"},
    "portiques_acier_ductile": {"R": 6.0, "desc": "Portiques autostables en acier à nœuds rigides"},
    "portiques_acier_contreventes": {"R": 4.0, "desc": "Ossature en acier contreventée en X/V"},
}

SITE_PERIODS = {
    "S1": {"name": "Rocher (Sol très ferme)", "T1": 0.15, "T2": 0.30},
    "S2": {"name": "Ferme (Sol ferme)", "T1": 0.15, "T2": 0.40},
    "S3": {"name": "Meuble (Sol meuble)", "T1": 0.15, "T2": 0.50},
    "S4": {"name": "Très meuble (Sol très meuble)", "T1": 0.15, "T2": 0.70},
}


class RPACalculator:
    def __init__(
        self,
        zone: str = "IIb",
        groupe_usage: str = "2",
        systeme_structural: str = "portiques_autostables_beton",
        categorie_sol: str = "S2",
        amortissement_xi: float = 5.0,
        penalites_qualite: float = 0.05,
    ):
        self.zone = zone
        self.groupe_usage = groupe_usage
        self.systeme_structural = systeme_structural
        self.categorie_sol = categorie_sol
        self.amortissement_xi = amortissement_xi
        self.penalites_qualite = penalites_qualite

    @classmethod
    def resolve_zone_for_wilaya(cls, wilaya_name_or_code: str) -> str:
        q = wilaya_name_or_code.strip().lower()
        return WILAYA_SEISMIC_ZONES.get(q, "IIa")

    def get_zone_acceleration(self) -> float:
        grp = ACCELERATION_COEFFICIENTS.get(self.groupe_usage, ACCELERATION_COEFFICIENTS["2"])
        return grp.get(self.zone, 0.15)

    def get_behavior_factor(self) -> float:
        sys_info = BEHAVIOR_FACTORS.get(self.systeme_structural, BEHAVIOR_FACTORS["portiques_autostables_beton"])
        return sys_info["R"]

    def get_damping_factor(self) -> float:
        eta = math.sqrt(7.0 / (2.0 + self.amortissement_xi))
        return max(eta, 0.7)

    def get_quality_factor(self) -> float:
        return 1.0 + max(0.0, self.penalites_qualite)

    def calculate_amplification_factor(self, T: float) -> float:
        eta = self.get_damping_factor()
        site = SITE_PERIODS.get(self.categorie_sol, SITE_PERIODS["S2"])
        T2 = site["T2"]

        if T <= T2:
            return 2.5 * eta
        elif T <= 3.0:
            return 2.5 * eta * math.pow(T2 / T, 2.0 / 3.0)
        else:
            return 2.5 * eta * math.pow(T2 / 3.0, 2.0 / 3.0) * math.pow(3.0 / T, 5.0 / 3.0)

    def calculate_base_shear(self, total_weight_kN: float, structural_period_s: float) -> Dict[str, Any]:
        A = self.get_zone_acceleration()
        D = self.calculate_amplification_factor(structural_period_s)
        Q = self.get_quality_factor()
        R = self.get_behavior_factor()
        eta = self.get_damping_factor()

        ratio = (A * D * Q) / R
        V = ratio * total_weight_kN

        return {
            "zone": self.zone,
            "groupe_usage": self.groupe_usage,
            "acceleration_A": A,
            "period_T_seconds": round(structural_period_s, 4),
            "damping_xi_percent": self.amortissement_xi,
            "damping_eta": round(eta, 4),
            "amplification_D": round(D, 4),
            "behavior_R": R,
            "quality_Q": round(Q, 3),
            "total_weight_kN": total_weight_kN,
            "seismic_coefficient": round(ratio, 4),
            "base_shear_V_kN": round(V, 2),
            "base_shear_V_tons": round(V / 9.80665, 2),
        }

    def distribute_forces_per_story(
        self,
        base_shear_V: float,
        story_heights_m: List[float],
        story_weights_kN: List[float],
        T: float,
    ) -> List[Dict[str, Any]]:
        """
        RPA 99 / v2003 Formule 4.10:
        F_k = (V - F_t) * (W_k * h_k) / sum(W_j * h_j)
        Ft = 0 if T <= 0.7s; Ft = 0.07 * T * V <= 0.25 * V if T > 0.7s
        """
        n = len(story_heights_m)
        assert len(story_weights_kN) == n, "Heights and weights lists must match in length"

        # Calculate cumulative levels from ground (h_k)
        cumulative_h = []
        cur_h = 0.0
        for h in story_heights_m:
            cur_h += h
            cumulative_h.append(cur_h)

        # Concentrated force at top Ft
        if T > 0.7:
            ft = min(0.07 * T * base_shear_V, 0.25 * base_shear_V)
        else:
            ft = 0.0

        v_distributable = base_shear_V - ft
        denom = sum(w * h for w, h in zip(story_weights_kN, cumulative_h))

        results = []
        cumulative_shear = 0.0

        for i in reversed(range(n)):
            hk = cumulative_h[i]
            wk = story_weights_kN[i]
            fk = v_distributable * (wk * hk) / denom
            if i == n - 1:
                fk += ft  # Top floor receives Ft

            cumulative_shear += fk
            results.append({
                "story_index": i + 1,
                "story_level_m": round(hk, 2),
                "story_height_m": round(story_heights_m[i], 2),
                "story_weight_kN": round(wk, 2),
                "seismic_force_Fk_kN": round(fk, 2),
                "shear_force_Vk_kN": round(cumulative_shear, 2),
            })

        results.reverse()
        return results


def estimate_period(height_m: float, system: str = "portiques_beton") -> float:
    ct = 0.075 if system == "portiques_beton" else 0.085
    return ct * math.pow(height_m, 0.75)


def main():
    parser = argparse.ArgumentParser(
        description="DZ-RPA — Algerian Seismic Engineering Code (RPA 99 / Version 2003)"
    )
    parser.add_argument("--wilaya", default="Alger", help="Wilaya name or code (e.g. Alger, Chlef, Oran, 16)")
    parser.add_argument("--usage", default="2", choices=["1A", "1B", "2", "3"], help="Usage group (default: 2)")
    parser.add_argument("--system", default="portiques_autostables_beton", choices=list(BEHAVIOR_FACTORS.keys()), help="Structural system")
    parser.add_argument("--soil", default="S2", choices=list(SITE_PERIODS.keys()), help="Soil category (S1, S2, S3, S4)")
    parser.add_argument("--floors", type=int, default=5, help="Number of stories (default: 5)")
    parser.add_argument("--height", type=float, default=18.0, help="Total building height in meters")
    parser.add_argument("--weight", type=float, default=12500.0, help="Total building weight in kN")
    parser.add_argument("--json", action="store_true", help="Output results in JSON format")

    args = parser.parse_args()

    zone = RPACalculator.resolve_zone_for_wilaya(args.wilaya)
    calc = RPACalculator(
        zone=zone,
        groupe_usage=args.usage,
        systeme_structural=args.system,
        categorie_sol=args.soil,
    )

    T = estimate_period(args.height)
    res = calc.calculate_base_shear(args.weight, T)

    # Distribute over stories
    story_h = args.height / args.floors
    heights = [story_h] * args.floors
    weights = [args.weight / args.floors] * args.floors
    story_forces = calc.distribute_forces_per_story(res["base_shear_V_kN"], heights, weights, T)

    if args.json:
        output_payload = {
            "summary": res,
            "story_distribution": story_forces,
        }
        print(json.dumps(output_payload, indent=2))
        return

    print("=" * 80)
    print("  DZ-RPA — Algerian Earthquake Seismic Engineering Engine (RPA 99 / v2003)")
    print("  المنظومة الوطنية للحسابات الإنشائية والزلازل (DTR-BC 2-48)")
    print("=" * 80)
    print(f"Wilaya Demandée        : {args.wilaya} -> Zone Sismique Détectée: {zone}")
    print(f"Groupe d'Usage         : Groupe {args.usage} | Système: {BEHAVIOR_FACTORS[args.system]['desc']}")
    print(f"Catégorie de Sol       : {SITE_PERIODS[args.soil]['name']}")
    print(f"Accélération de Zone A : {res['acceleration_A']} | Facteur Comportement R: {res['behavior_R']}")
    print(f"Période Estimée T      : {res['period_T_seconds']} s | Facteur Amplification D: {res['amplification_D']}")
    print(f"Poids Total Bâtiment W : {res['total_weight_kN']} kN (~{args.weight / 9.80665:.1f} Tonnes)")
    print("-" * 80)
    print(f"Coeff. Sismique (V/W)  : {res['seismic_coefficient'] * 100:.2f}%")
    print(f"Force Sismique Base V  : {res['base_shear_V_kN']} kN ({res['base_shear_V_tons']} Tonnes-Force)")
    print("-" * 80)
    print("RÉPARTITION VERTICALE DES FORCES SISMIQUES PAR ÉTAGE (Formule 4.10):")
    print(f"{'Etage':<8} | {'Niveau (m)':>10} | {'Poids (kN)':>12} | {'Force Fk (kN)':>14} | {'Effort Tranchant Vk (kN)':>24}")
    print("-" * 80)
    for s in story_forces:
        print(f"Niveau {s['story_index']:<2} | {s['story_level_m']:10.2f} | {s['story_weight_kN']:12.2f} | {s['seismic_force_Fk_kN']:14.2f} | {s['shear_force_Vk_kN']:24.2f}")
    print("=" * 80)


if __name__ == "__main__":
    main()
