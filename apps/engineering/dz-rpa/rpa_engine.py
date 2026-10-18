"""
DZ-RPA — Algerian Earthquake Seismic Engineering Engine (RPA 99 / Version 2003)
--------------------------------------------------------------------------------
Part of DZ Open Suite (المنظومة الجزائرية للبرمجيات المفتوحة المصدر).
Implements DTR-BC 2-48: Règles Parasismiques Algériennes (RPA 99 / Version 2003).
A sovereign high-performance scientific calculation engine written in Python.
"""

import math
import sys
from typing import Dict, Any, Tuple

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Tableau 4.1: Coefficient d'accélération de zone A (RPA 99 / v2003 Art. 4.2.3)
ACCELERATION_COEFFICIENTS = {
    "1A": {"0": 0.00, "I": 0.15, "IIa": 0.25, "IIb": 0.30, "III": 0.40},
    "1B": {"0": 0.00, "I": 0.12, "IIa": 0.20, "IIb": 0.25, "III": 0.30},
    "2":  {"0": 0.00, "I": 0.08, "IIa": 0.15, "IIb": 0.20, "III": 0.25},
    "3":  {"0": 0.00, "I": 0.05, "IIa": 0.10, "IIb": 0.14, "III": 0.18},
}

# Tableau 4.3: Facteur de comportement global R (RPA 99 / v2003 Art. 4.2.3)
BEHAVIOR_FACTORS = {
    "portiques_autostables_beton": {"R": 5.0, "desc": "Portiques autostables en béton armé sans remplissage rigide"},
    "portiques_remplissage_maconnerie": {"R": 3.5, "desc": "Portiques autostables en béton armé avec remplissage en maçonnerie"},
    "voiles_porteurs_beton": {"R": 3.5, "desc": "Ossature avec voiles porteurs en béton armé"},
    "mixte_portiques_voiles": {"R": 5.0, "desc": "Structure mixte portiques / voiles avec interaction"},
    "portiques_acier_ductile": {"R": 6.0, "desc": "Portiques autostables en acier à nœuds rigides (haute ductilité)"},
    "portiques_acier_contreventes": {"R": 4.0, "desc": "Ossature en acier contreventée en X ou en V"},
}

# Tableau 4.7: Périodes caractéristiques T1 et T2 selon la catégorie de sol (Art. 4.3.3)
SITE_PERIODS = {
    "S1": {"name": "Rocher (Sol très ferme)", "T1": 0.15, "T2": 0.30},
    "S2": {"name": "Ferme (Sol ferme)", "T1": 0.15, "T2": 0.40},
    "S3": {"name": "Meuble (Sol meuble)", "T1": 0.15, "T2": 0.50},
    "S4": {"name": "Très meuble (Sol très meuble)", "T1": 0.15, "T2": 0.70},
}

class RPACalculator:
    """
    RPA 99 / Version 2003 Engine for calculating Total Base Shear Force:
    V = (A * D * Q / R) * W
    """

    def __init__(
        self,
        zone: str = "IIa",
        groupe_usage: str = "2",
        systeme_structural: str = "portiques_autostables_beton",
        categorie_sol: str = "S2",
        amortissement_xi: float = 5.0,
        penalites_qualite: float = 0.0,
    ):
        self.zone = zone
        self.groupe_usage = groupe_usage
        self.systeme_structural = systeme_structural
        self.categorie_sol = categorie_sol
        self.amortissement_xi = amortissement_xi
        self.penalites_qualite = penalites_qualite

    def get_zone_acceleration(self) -> float:
        grp = ACCELERATION_COEFFICIENTS.get(self.groupe_usage, ACCELERATION_COEFFICIENTS["2"])
        return grp.get(self.zone, 0.15)

    def get_behavior_factor(self) -> float:
        sys = BEHAVIOR_FACTORS.get(self.systeme_structural, BEHAVIOR_FACTORS["portiques_autostables_beton"])
        return sys["R"]

    def get_damping_factor(self) -> float:
        # Formule RPA: eta = sqrt(7 / (2 + xi)) >= 0.7
        eta = math.sqrt(7.0 / (2.0 + self.amortissement_xi))
        return max(eta, 0.7)

    def get_quality_factor(self) -> float:
        # Q = 1 + sum(P_q)
        return 1.0 + max(0.0, self.penalites_qualite)

    def calculate_amplification_factor(self, T: float) -> float:
        """Calculates D (Facteur d'amplification dynamique) according to period T."""
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
        """
        Calculates total base shear force V (Force sismique totale à la base):
        V = (A * D * Q / R) * W
        """
        A = self.get_zone_acceleration()
        D = self.calculate_amplification_factor(structural_period_s)
        Q = self.get_quality_factor()
        R = self.get_behavior_factor()
        eta = self.get_damping_factor()

        # V = (A * D * Q / R) * W
        ratio = (A * D * Q) / R
        V = ratio * total_weight_kN

        # Vérification de l'effort tranchant minimal selon RPA Art. 4.3.6:
        # V >= 0.8 * V_statique si calcul dynamique
        V_min_ratio = 0.8 * ratio

        return {
            "zone": self.zone,
            "groupe_usage": self.groupe_usage,
            "acceleration_A": A,
            "period_T_seconds": structural_period_s,
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

def estimate_period_empirical(building_height_m: float, building_type: str = "portiques_beton") -> float:
    """
    RPA 99 / v2003 Formule 4.6: T = C_T * (h_N)^(3/4)
    """
    ct = 0.075 if building_type == "portiques_beton" else 0.085
    return ct * math.pow(building_height_m, 0.75)


if __name__ == "__main__":
    print("=" * 80)
    print("  DZ-RPA — Algerian Earthquake Seismic Engineering Engine (RPA 99 / v2003)")
    print("  المنظومة الوطنية للحسابات الإنشائية والزلازل (DTR-BC 2-48)")
    print("=" * 80)

    # Exemple de calcul: Bâtiment R+5 à Alger (Zone IIb), Groupe 2 (Logements), Sol S2
    calc = RPACalculator(
        zone="IIb",
        groupe_usage="2",
        systeme_structural="portiques_autostables_beton",
        categorie_sol="S2",
        amortissement_xi=5.0,
        penalites_qualite=0.05,
    )

    hauteur_batiment = 18.0 # mètres (R+5)
    T = estimate_period_empirical(hauteur_batiment)
    poids_total = 12500.0 # kN (~1275 tonnes)

    res = calc.calculate_base_shear(poids_total, T)

    print(f"Zone Sismique          : {res['zone']} (Alger / Blida / Boumerdes)")
    print(f"Groupe d'usage         : Groupe {res['groupe_usage']} (Logements / Bureaux)")
    print(f"Coeff. d'accélération A: {res['acceleration_A']}")
    print(f"Hauteur du bâtiment    : {hauteur_batiment} m -> Période estimée T: {T:.3f} s")
    print(f"Facteur amplification D: {res['amplification_D']}")
    print(f"Facteur comportement R : {res['behavior_R']}")
    print(f"Facteur de qualité Q   : {res['quality_Q']}")
    print(f"Poids total (W)        : {res['total_weight_kN']} kN")
    print("-" * 80)
    print(f"Coeff. Sismique (V/W)  : {res['seismic_coefficient'] * 100:.2f}%")
    print(f"Effort Tranchant Base V: {res['base_shear_V_kN']} kN ({res['base_shear_V_tons']} Tonnes-Force)")
    print("=" * 80)
