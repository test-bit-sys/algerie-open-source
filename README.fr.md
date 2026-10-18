<p align="center">
  <img src="assets/logo.jpg" alt="Logo DZ Open Suite" width="520">
</p>

<h1 align="center">Écosystème Logiciel Open Source Algérien</h1>
<h3 align="center">DZ Open Suite — Logiciels modernes, libres et souverains pour l'Algérie</h3>

<p align="center">
  <a href="README.md"><b>English</b></a> •
  <a href="README.ar.md"><b>العربية</b></a> •
  <a href="README.fr.md"><b>Français</b></a>
</p>

<p align="center">
  <a href="https://github.com/test-bit-sys/algerie-open-source/blob/main/LICENSE"><img src="https://img.shields.io/badge/Licence-MIT-008744.svg?style=for-the-badge&logo=opensourceinitiative&logoColor=white" alt="Licence: MIT"></a>
  <a href="#"><img src="https://img.shields.io/badge/Domaines-11_Pôles_Spécialisés-blue.svg?style=for-the-badge" alt="Tracks"></a>
  <a href="#"><img src="https://img.shields.io/badge/Langues-Arabe_%7C_Français_%7C_Anglais-d21034.svg?style=for-the-badge" alt="Trilingue"></a>
  <a href="#"><img src="https://img.shields.io/badge/Architecture-Offline--First-0ea5e9.svg?style=for-the-badge&logo=sqlite&logoColor=white" alt="Offline-First"></a>
  <a href="https://github.com/test-bit-sys/algerie-open-source/pulls"><img src="https://img.shields.io/badge/Contributions-Bienvenues-purple.svg?style=for-the-badge&logo=github" alt="PRs Welcome"></a>
</p>

---

> **Initiative 100% Open Source** visant à bâtir des alternatives modernes, gratuites, sécurisées et locales aux logiciels de bureautique, gestion commerciale et administrative les plus utilisés en Algérie.

---

### Applications Réalisées & Prêtes à l'Emploi (1:1 Desktop Alternatives)

Développées selon le standard d'ingénierie **HeyPuter/everything** (Vanilla JS ES Modules, HTML5, CSS moderne, zéro framework externe, 100% hors-ligne, trilingue natif AR/FR/EN) :

| Application | Logiciel Remplacé | Port | Commande de Lancement | Fonctionnalités Clés |
| :--- | :--- | :---: | :--- | :--- |
| **DZ-Disk-Tree** | **WizTree 1:1** | `:3001` | `npm run start:disk-tree` | Fenêtre split synchronisée (Arborescence + Cushioned Treemap), tri interactif des colonnes, navigation clavier complète, rapport d'audit imprimable. |
| **DZ-Archive** | **WinRAR 1:1** | `:3002` | `npm run start:archive` | Interface WinRAR classique, dialogue de compression à 6 onglets, chiffrement AES-256-GCM, visionneuse interne (Text/Hex/Media), benchmark matériel en temps réel. |
| **DZ-Player** | **VLC Media Player 1:1** | `:3003` | `npm run start:player` | Interface classique VLC, amplification du volume jusqu'à 300%, panneau d'effets unifié (Ctrl+E) : égaliseur 10 bandes, compresseur, géométrie/couleurs vidéo, synchronisation. |
| **DZ-PDF Pro** | **Adobe Acrobat Pro 1:1** | `:3004` | `npm run start:pdf` | Menus & barre d'outils Acrobat, tampons administratifs algériens officiels (Cachet Rond de la République, Conforme à l'Original), pavé de signature numérique, numérotation Bates, organiseur de pages. |
| **DZ-Facture & POS** | **Sage / Odoo POS** | `:3000` | `npm run start` | Point de vente conforme au décret 05-468, calcul TVA & Timbre fiscal, tafqit en Dinar Algérien (DZD), base de données locale rapide. |

---

### Vision et Objectifs
1. **Éradiquer les logiciels piratés :** Remplacer les logiciels obsolètes ou piratés (Delphi/Access) par des solutions fiables, auditables et pérennes.
2. **Conformité totale avec les normes algériennes :**
   * Réglementation fiscale (TVA 9% / 19%, Droit de Timbre Fiscal 1%, IRG, IBS).
   * Mentions légales obligatoires sur les factures (NIF 15 chiffres, NIS 20 chiffres, RC, AI, RIB).
   * Prise en charge native et intégrale de trois langues : **Arabe (RTL)**, **Français (LTR)** et **Anglais (LTR)**.
   * Architecture **Offline-First** (fonctionne sans connexion Internet requise).

---

### Structure du Monorepo

```
algerie-open-source/
│
├── docs/                     # Documentation légale, fiscale et architecturale
├── packages/                 # Paquets partagés et moteurs de calcul
│   ├── dz-tafqit/               # Conversion des chiffres en lettres (Arabe, Français, Anglais)
│   ├── dz-geo/                  # Base de données des 58 Wilayas et codes postaux
│   ├── dz-fiscal/               # Validateurs NIF/NIS/RC/CCP et moteur de calcul fiscal
│   └── dz-ui/                   # Système de conception graphique trilingue RTL/LTR
│
└── apps/                     # Applications
    ├── dz-facture/              # Application de facturation et gestion commerciale
    ├── dz-paie/                 # Fiches de paie et conformité CNAS
    └── dz-idara/                # Générateur de documents administratifs
```

---

### Démarrage Rapide

```bash
# Cloner le dépôt
git clone https://github.com/dz-open-suite/algerie-open-source.git

# Lancer la suite de tests
npm test

# Démarrer le studio de facturation DZ-Facture
npm start
```
Accédez ensuite à `http://localhost:3000` dans votre navigateur.
