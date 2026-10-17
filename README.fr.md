# 🇩🇿 Écosystème Logiciel Open Source Algérien
## DZ Open Suite — Algerian Open Source Ecosystem

[English](README.md) • [العربية](README.ar.md) • [Français](README.fr.md)

---

> **Initiative 100% Open Source** visant à bâtir des alternatives modernes, gratuites, sécurisées et locales aux logiciels de bureautique, gestion commerciale et administrative les plus utilisés en Algérie.

---

### 🌟 Vision et Objectifs
1. **Éradiquer les logiciels piratés :** Remplacer les logiciels obsolètes ou piratés (Delphi/Access) par des solutions fiables, auditables et pérennes.
2. **Conformité totale avec les normes algériennes :**
   * Réglementation fiscale (TVA 9% / 19%, Droit de Timbre Fiscal 1%, IRG, IBS).
   * Mentions légales obligatoires sur les factures (NIF 15 chiffres, NIS 20 chiffres, RC, AI, RIB).
   * Prise en charge native et intégrale de trois langues : **Arabe (RTL)**, **Français (LTR)** et **Anglais (LTR)**.
   * Architecture **Offline-First** (fonctionne sans connexion Internet requise).

---

### 🏛️ Structure du Monorepo

```
algerie-open-source/
│
├── 📁 docs/                     # Documentation légale, fiscale et architecturale
├── 📁 packages/                 # Paquets partagés et moteurs de calcul
│   ├── dz-tafqit/               # Conversion des chiffres en lettres (Arabe, Français, Anglais)
│   ├── dz-geo/                  # Base de données des 58 Wilayas et codes postaux
│   ├── dz-fiscal/               # Validateurs NIF/NIS/RC/CCP et moteur de calcul fiscal
│   └── dz-ui/                   # Système de conception graphique trilingue RTL/LTR
│
└── 📁 apps/                     # Applications
    ├── dz-facture/              # Application de facturation et gestion commerciale
    ├── dz-paie/                 # Fiches de paie et conformité CNAS
    └── dz-idara/                # Générateur de documents administratifs
```

---

### 🚀 Démarrage Rapide

```bash
# Cloner le dépôt
git clone https://github.com/dz-open-suite/algerie-open-source.git

# Lancer la suite de tests
npm test

# Démarrer le studio de facturation DZ-Facture
npm start
```
Accédez ensuite à `http://localhost:3000` dans votre navigateur.
