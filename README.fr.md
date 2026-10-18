<div align="center">

<img src="assets/logo.jpg" alt="Écosystème Logiciel Open Source Algérien" width="640">

# Écosystème Logiciel Open Source Algérien
## DZ Open Suite

### La Suite Logicielle Nationale de Bureau Souveraine, Libre & 100% Hors-Ligne
**100% Souverain • Respect Total de la Vie Privée • Zéro Dépendance Cloud • Trilingue Natif (AR / FR / EN)**

[![Licence: MIT](https://img.shields.io/badge/Licence-MIT-008744.svg?style=for-the-badge&logo=opensourceinitiative&logoColor=white)](LICENSE)
[![Architecture: HeyPuter Vanilla JS](https://img.shields.io/badge/Architecture-HeyPuter_Vanilla_JS-1e293b.svg?style=for-the-badge&logo=javascript&logoColor=F7DF1E)](#principes-darchitecture-logicielle)
[![Plateformes: Web & Bureau](https://img.shields.io/badge/Plateforme-Web_%7C_Desktop-0284c7.svg?style=for-the-badge&logo=electron&logoColor=white)](#démarrage-rapide-et-déploiement-local)
[![Langues: AR · FR · EN](https://img.shields.io/badge/Langues-Arabe_%7C_Français_%7C_Anglais-dc2626.svg?style=for-the-badge)](#internationalisation-et-bidirectionnalité)
[![Contributions Bienvenues](https://img.shields.io/badge/Contributions-Bienvenues-7c3aed.svg?style=for-the-badge&logo=github&logoColor=white)](docs/CONTRIBUTING.md)

<p align="center">
  <a href="README.fr.md"><b>Français</b></a> •
  <a href="README.ar.md"><b>العربية</b></a> •
  <a href="README.md"><b>English</b></a>
</p>

</div>

---

## Table des Matières

- [Mission et Vision Stratégique](#mission-et-vision-stratégique)
- [Suite Logicielle de Bureau (Alternatives 1:1 Natives)](#suite-logicielle-de-bureau-alternatives-11-natives)
  - [1. DZ-Facture & POS (Alternative Sage / Odoo)](#1-dz-facture--pos-port-3000)
  - [2. DZ-Disk-Tree (Alternative WizTree 1:1)](#2-dz-disk-tree-port-3001)
  - [3. DZ-Archive (Alternative WinRAR 1:1)](#3-dz-archive-port-3002)
  - [4. DZ-Player (Alternative VLC Media Player 1:1)](#4-dz-player-port-3003)
  - [5. DZ-PDF Pro (Alternative Adobe Acrobat Pro 1:1)](#5-dz-pdf-pro-port-3004)
- [Principes d'Architecture Logicielle](#principes-darchitecture-logicielle)
- [Structure du Monorepo (11 Pôles Spécialisés)](#structure-du-monorepo-11-pôles-spécialisés)
- [Conformité Réglementaire et Fiscale Algérienne](#conformité-réglementaire-et-fiscale-algérienne)
- [Démarrage Rapide et Déploiement Local](#démarrage-rapide-et-déploiement-local)
- [Guide de Contribution et Développement](#guide-de-contribution-et-développement)
- [Licence et Souveraineté](#licence-et-souveraineté)

---

## Mission et Vision Stratégique

**DZ Open Suite** est une initiative nationale souveraine conçue pour développer, standardiser et maintenir des alternatives logicielles de bureau 100% gratuites, open source et performantes, destinées à remplacer les outils propriétaires et fréquemment piratés utilisés dans les administrations publiques, entreprises économiques, universités et commerces algériens.

### Objectifs Majeurs
1. **Éradication des Logiciels Piratés et Obsolètes** : Remplacer définitivement les solutions dépassées (Visual Basic 6, Delphi 7, Microsoft Access 2003) et les logiciels sous licences craquées par des applications fiables, auditables et conformes aux standards ouverts du web.
2. **Souveraineté Numérique Nationale** : Garantir que les pièces comptables, actes administratifs, données citoyennes et délibérations internes ne transitent jamais par des serveurs cloud tiers étrangers. Tous les calculs s'effectuent strictement en local (**Offline-First**).
3. **Conformité Rigoureuse aux Normes Algériennes** : Respect scrupuleux du Décret exécutif 05-468 (facturation commerciale), de la Loi 18-05 (commerce électronique), du Système Comptable Financier (SCF), du calcul de la TVA (19% et 9%), du droit de timbre fiscal, du tafqit en Dinars Algériens (DZD) et de l'apposition des tampons administratifs officiels.
4. **Excellence d'Ingénierie (Standard HeyPuter)** : Architecture en Vanilla JavaScript ES Modules, HTML5, CSS moderne, zéro framework externe lourd (ni React, ni Vue, ni Angular en production), zéro télémétrie, zéro emoji, et utilisation exclusive de vecteurs SVG purs.

---

## Suite Logicielle de Bureau (Alternatives 1:1 Natives)

| Logiciel | Logiciel Propriétaire Remplacé | Port Local | Commande de Lancement | Fonctionnalités Clés |
| :--- | :--- | :---: | :--- | :--- |
| **DZ-Facture & POS** | **Sage 100 / Odoo POS** | `:3000` | `npm start` | Facturation conforme décret 05-468, caisse enregistreuse POS, moteur TVA/Timbre, tafqit DZD, base 58 Wilayas. |
| **DZ-Disk-Tree** | **WizTree 1:1** | `:3001` | `npm run start:disk-tree` | Fenêtre split synchronisée (Arborescence + Cushioned Treemap), tri multicritères, navigation au clavier, rapport d'audit imprimable. |
| **DZ-Archive** | **WinRAR 1:1** | `:3002` | `npm run start:archive` | Barre d'outils WinRAR, dialogue d'options à 6 onglets, chiffrement AES-256-GCM, visionneuse (Texte/Hex 16 octets/Média), benchmark matériel. |
| **DZ-Player** | **VLC Media Player 1:1** | `:3003` | `npm run start:player` | Interface VLC authentique, amplification jusqu'à 300%, panneau d'effets (Ctrl+E) : égaliseur 10 bandes, compresseur, géométrie vidéo, synchronisation. |
| **DZ-PDF Pro** | **Adobe Acrobat Pro 1:1** | `:3004` | `npm run start:pdf` | Menus & barre d'outils Acrobat, tampons officiels algériens (Cachet Rond République, Conforme à l'Original), signature numérique, organiseur de pages. |

---

### 1. DZ-Facture & POS (Port :3000)
*Répertoire : [`apps/business-enterprise/dz-facture/`](apps/business-enterprise/dz-facture/)*

La solution nationale open source de facturation commerciale et gestion de point de vente conçue sur mesure pour les réalités du marché algérien :
- **Mentions Légales Obligatoires** : Gestion native des identifiants fiscaux NIF (15 chiffres), NIS (20 chiffres), Registre de Commerce (RC), Article d'Imposition et coordonnées bancaires/postales (RIB/CCP).
- **Moteur de Tafqit Monétaire** : Conversion automatique des montants en toutes lettres en arabe juridique, français et anglais (ex. *Huit cent onze mille sept cents Dinars Algériens et zéro centime*).
- **Double Mode Caisse POS & Facturation Entreprise** : Scan code-barres rapide, impression de tickets de caisse thermiques (58mm/80mm) et émission de factures A4 normalisées.
- **Clôture Journalière (Z-Report)** : Arrêté de caisse journalier, audit des fonds de tiroir et suivi des charges et menues dépenses.

---

### 2. DZ-Disk-Tree (Port :3001)
*Répertoire : [`apps/productivity/dz-disk-tree/`](apps/productivity/dz-disk-tree/)*

Alternative haute performance 1:1 à **WizTree** et TreeSize pour analyser, auditer et optimiser l'espace de stockage sur disques :
- **Affichage Découpé Synchronisé (Split View)** : Arborescence détaillée en volet supérieur et carte treemap biseautée (**Cushioned Treemap Canvas**) en volet inférieur avec séparateur redimensionnable par glisser-déposer.
- **Sélection Bidirectionnelle** : Le clic sur un dossier dans l'arbre zoome instantanément sur la treemap ; le clic sur une case géométrique sélectionne le dossier dans la table.
- **Tri Multicolonne Interactif** : Tri immédiat par Nom, % Espace parent, Taille réelle, Espace alloué sur clusters, Nombre de fichiers et Date de modification.
- **Navigation Intégrale au Clavier** : Prise en charge native des touches fléchées (`ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Enter`, `Backspace`).
- **Rapport d'Audit Exécutif Imprimable** : Génération d'un audit HTML autonome prêt à l'impression avec capture haute résolution du treemap et tableaux statistiques des dossiers les plus volumineux.

---

### 3. DZ-Archive (Port :3002)
*Répertoire : [`apps/productivity/dz-archive/`](apps/productivity/dz-archive/)*

Alternative de bureau 1:1 à **WinRAR** et 7-Zip pour créer, tester, chiffrer et inspecter des archives compressées :
- **Interface Iconique WinRAR** : Barre de menus complète (`Fichier`, `Commandes`, `Outils`, `Options`, `Aide`) et grande barre d'outils classique (`Ajouter`, `Extraire vers`, `Tester`, `Afficher`, `Supprimer`, `Rechercher`, `Assistant`, `Infos`, `Verrouiller`, `Commentaire`, `Benchmark`).
- **Dialogue de Compression à 6 Onglets** : Paramétrage avancé via les onglets `Général`, `Avancé`, `Fichiers`, `Sauvegarde`, `Temps`, et `Commentaire`.
- **Chiffrement Cryptographique Robuste AES-256-GCM** : Sécurisation matérielle par mot de passe via l'API Web Crypto native avec dérivation de clé PBKDF2.
- **Visionneuse Interne Multi-Mode** : Visualisation instantanée de fichiers sans extraction disque via les modes Texte brut, Vidage hexadécimal (**Hex Dump** aligné sur 16 octets avec valeurs ASCII), et Lecteur multimédia.
- **Benchmark Matériel Intégré** : Évaluation des performances du processeur mesurant le débit de compression (Mo/s) et attribuant une note d'indice matériel en temps réel.

---

### 4. DZ-Player (Port :3003)
*Répertoire : [`apps/multimedia/dz-player/`](apps/multimedia/dz-player/)*

Alternative de bureau 1:1 à **VLC Media Player** pour la lecture fluide et le traitement audio/vidéo avancé :
- **Expérience VLC Intégrale** : Menus supérieurs classiques, viewport vidéo sombre avec emblème du cône, et commandes de lecture professionnelles.
- **Super-Amplification Sonore jusqu'à 300%** : Traitement audio via `GainNode` permettant de porter le volume à 300% sans distorsion majeure pour les enregistrements à faible niveau sonore.
- **Panneau Unifié des Effets et Filtres (Ctrl+E)** :
  - **Égaliseur Graphique 10 Bandes** : Fréquences étalonnées de 60Hz à 16kHz avec préréglages (Rock, Pop, Classique, Plat, Pleines Basses, Voix).
  - **Compresseur Dynamique Audio** : Régulation de la dynamique sonore (`DynamicsCompressorNode`) avec réglages de Seuil, Coude, Ratio, Attaque et Relâchement.
  - **Géométrie et Colorimétrie Vidéo** : Rotation en temps réel 90°/180°/270°, inversion miroir, luminosité, contraste, saturation et teinte.
  - **Synchronisation Précise** : Ajustement au millième de seconde des décalages temporels entre les pistes audio et les sous-titres.
- **Contrôle Précis** : Boucle de répétition A-B, capture d'instantanés d'images (Snapshots HD), et flux réseau (HTTP/HTTPS/HLS).

---

### 5. DZ-PDF Pro (Port :3004)
*Répertoire : [`apps/office-suite/dz-pdf/`](apps/office-suite/dz-pdf/)*

Alternative de bureau 1:1 à **Adobe Acrobat Pro** pour annoter, organiser, masquer et signer numériquement les documents administratifs :
- **Palette d'Outils Acrobat Complète** : Outil de sélection (`V`), Outil main de déplacement (`H`), Stylet de tracé libre (`P`), Surligneur coloré (`U`), Machine à écrire / Texte (`T`), Masquage de sécurité / Caviardage (**Redaction Tool** `R`), et Notes adhésives (**Sticky Notes** `N`).
- **Suite Officielle des Tampons Administratifs Algériens** :
  - **Cachet Rond Officiel de la République** : Double anneau réglementaire portant la mention *الجمهورية الجزائرية الديمقراطية الشعبية / RÉPUBLIQUE ALGÉRIENNE DÉMOCRATIQUE ET POPULAIRE*, l'étoile et le croissant nationaux, la Wilaya et la date.
  - **Tampons Rectangulaires Réglementaires** : *Conforme à l'Original*, *Courrier Arrivé / Reçu le*, *Payé Intégralement*, *Strictement Confidentiel*, *Vu et Approuvé*, *Annulé et Non Avenu*, et *Très Urgent*.
- **Module de Signature Numérique Certifiée (Fill & Sign)** : Pavé de signature vectoriel fluide (lissage Bézier), encres officielles (Bleu diplomatique, Noir bureau, Vert ministériel, Violet judiciaire), carte d'authentification nominative avec fonction, Wilaya, date et empreinte de vérification.
- **Organiseur et Trieur de Pages** : Grille visuelle avec réorganisation par glisser-déposer, rotation individuelle ou collective à 90°, duplication, suppression et insertion de pages vierges.
- **Modèles Administratifs et Commerciaux Intégrés** : Chargement immédiat d'une attestation administrative officielle et d'une facture/contrat commercial en DZD.

---

## Principes d'Architecture Logicielle

Tous les modules du monorepo respectent scrupuleusement la charte technique **HeyPuter / everything** :

```
┌────────────────────────────────────────────────────────────────────────┐
│                        DZ Open Suite Monorepo                          │
├────────────────────────────────────────────────────────────────────────┤
│  Couche 1: APIs Web Natives (HTML5 Canvas 2D · Web Audio · Web Crypto) │
│  Couche 2: Modules ES JavaScript purs (Aucune étape de compilation)    │
│  Couche 3: Données et Stockage Local (100% Offline-First)              │
│  Couche 4: Système de Design Bidirectionnel (Arabe RTL natif)          │
│  Couche 5: Discipline Vectorielle (Icônes SVG pures sans aucun emoji)  │
└────────────────────────────────────────────────────────────────────────┘
```

1. **Zéro Framework Externe Lourd** : Aucun framework lourd (ni React, ni Vue, ni Angular) au runtime. L'utilisation directe du DOM natif et des modules ES assure des démarrages instantanés et une pérennité sur plusieurs décennies.
2. **100% Hors-Ligne (Offline-First)** : Autonomie complète vis-à-vis des connexions réseau. Les logiciels fonctionnent sans interruption dans les zones reculées (antennes communales isolées, postes frontières, sites industriels).
3. **Prise en Charge Native de l'Arabe (RTL)** : L'arabe est traité en citoyen de premier ordre avec orientation naturelle de droite à gauche (RTL), complété par le français et l'anglais.
4. **Discipline Vectorielle Épurée** : Tous les symboles visuels et indicateurs sont tracés sous forme de vecteurs mathématiques SVG purs. Aucun emoji n'est toléré dans le code source ou l'interface.

---

## Structure du Monorepo (11 Pôles Spécialisés)

```
algerie-open-source/
├── apps/
│   ├── business-enterprise/      # Pôle 02: Facturation, Caisses POS, Stocks, ERP
│   │   └── dz-facture/           # DZ-Facture & POS (Port 3000)
│   ├── productivity/             # Pôle 07: Utilitaires système & kit citoyen
│   │   ├── dz-disk-tree/         # DZ-Disk-Tree clone WizTree (Port 3001)
│   │   └── dz-archive/           # DZ-Archive clone WinRAR (Port 3002)
│   ├── multimedia/               # Pôle 04: Lecteurs multimédias & montage
│   │   └── dz-player/            # DZ-Player clone VLC (Port 3003)
│   ├── office-suite/             # Pôle 01: PDF, Bureautique, Tableurs
│   │   └── dz-pdf/               # DZ-PDF Pro clone Acrobat (Port 3004)
│   ├── finance-accounting/       # Pôle 03: Comptabilité SCF, Déclarations G50, Paie CNAS
│   ├── creative-tools/           # Pôle 05: Graphisme vectoriel, calligraphie, retouche photo
│   ├── collaboration/            # Pôle 06: Messagerie d'équipe, tableaux kanban locaux
│   ├── engineering/              # Pôle 08: CAO/DAO, Calcul parasismique RPA 99/2003
│   ├── developer-tools/          # Pôle 09: SDK Passerelles SATIM/CIB, CLI 58 Wilayas
│   ├── education-academia/       # Pôle 10: Bulletins scolaires, plannings, thèses
│   └── games-interactive/        # Pôle 11: Jeux du patrimoine, quiz des wilayas, Godot
├── assets/                       # Logos, bannières haute résolution et sceaux vectoriels
├── docs/                         # Références légales, fiscales et spécifications techniques
│   ├── standards/                # Réglementation TVA, timbre fiscal, règles de tafqit
│   ├── architecture/             # Schémas directeurs et architecture
│   └── CONTRIBUTING.md           # Guide d'intégration des développeurs
├── tools/                        # Serveurs statiques légers sans dépendance
│   └── static-server.js          # Serveur HTTP sécurisé
├── server.js                     # Serveur du portail écosystème
└── package.json                  # Orchestration des scripts
```

---

## Conformité Réglementaire et Fiscale Algérienne

DZ Open Suite a été développée en stricte conformité avec le cadre légal algérien :

- **Décret Exécutif 05-468** : Fixe les conditions et modalités d'établissement de la facture, du bon de caisse et des documents commerciaux.
- **Loi 18-05** : Encadre le commerce électronique, la contractualisation numérique et la signature électronique sur le territoire national.
- **Réglementation Fiscale** :
  - Taux normal de TVA : **19%**
  - Taux réduit de TVA : **9%**
  - Droit de Timbre Fiscal : **1%** sur les règlements en espèces (minimum 5 DZD, maximum 10 000 DZD).
- **Découpage Administratif Territorial** : Intégration exhaustive des **58 Wilayas** et **1 541 Communes** avec codes postaux et indicatifs téléphoniques administratifs.

---

## Démarrage Rapide et Déploiement Local

### Prérequis
- [Node.js](https://nodejs.org/) version 18.0.0 ou supérieure.
- Un navigateur web moderne (Chrome, Edge, Firefox, Brave, Safari).

### 1. Cloner le Dépôt
```bash
git clone https://github.com/test-bit-sys/algerie-open-source.git
cd algerie-open-source
```

### 2. Démarrer le Serveur Central de l'Écosystème (Port 3000)
```bash
npm start
```
Accédez à [http://localhost:3000](http://localhost:3000) pour utiliser le portail central et naviguer vers n'importe quelle application via `/apps/<pôle>/<application>/`.

### 3. Démarrer des Applications Dédiées de Manière Autonome
Chaque application peut être exécutée de manière totalement indépendante sur son propre port :

```bash
# DZ-Disk-Tree (Alternative WizTree) sur http://localhost:3001
npm run start:disk-tree

# DZ-Archive (Alternative WinRAR) sur http://localhost:3002
npm run start:archive

# DZ-Player (Alternative VLC) sur http://localhost:3003
npm run start:player

# DZ-PDF Pro (Alternative Adobe Acrobat) sur http://localhost:3004
npm run start:pdf
```

---

## Guide de Contribution et Développement

Nous invitons chaleureusement les développeurs, ingénieurs, designers, comptables et juristes algériens à contribuer :

1. Effectuez un **Fork** du projet et créez une branche dédiée (`git checkout -b feat/votre-fonctionnalite`).
2. Respectez rigoureusement le **standard architectural HeyPuter** (Vanilla JS ES Modules, graphisme SVG pur, aucun emoji).
3. Assurez le support trilingue natif (Arabe RTL prioritaire, Français et Anglais).
4. Validez l'absence d'erreurs de syntaxe (`node --check <fichier>`).
5. Soumettez une **Pull Request** détaillée décrivant vos apports.

Pour plus de précisions, consultez le [Guide de Contribution (CONTRIBUTING.md)](docs/CONTRIBUTING.md).

---

## Licence et Souveraineté

Ce projet est distribué sous **Licence MIT** — consultez le fichier [LICENSE](LICENSE) pour plus d'informations.

*DZ Open Suite est conçue par et pour la communauté algérienne, avec fierté, rigueur et indépendance technologique totale.*
