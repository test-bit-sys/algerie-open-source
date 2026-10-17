# Contributing to DZ Open Suite
## Guidelines for Contributors

[English](CONTRIBUTING.md) • [العربية](../README.ar.md) • [Français](../README.fr.md)

Thank you for your interest in contributing to the **Algerian Open Source Ecosystem (DZ Open Suite)**! This document outlines our conventions, development workflow, and community standards.

---

### Ways to Contribute
You don't need to be a software engineer to contribute. We actively seek contributions in:
1. **Legal & Fiscal Auditing:** Reviewing tax brackets, VAT rates, and invoice rules against official gazette publications (Journal Officiel de la République Algérienne) and DGI updates.
2. **Translations & Localization:** Translating and verifying terms across **Arabic**, **French**, and **English**.
3. **UI/UX Design:** Designing clean, responsive, and accessible layouts optimized for bidirectional RTL/LTR.
4. **Code & Unit Tests:** Developing new modules, fixing bugs, and improving test coverage.

---

### ️ Development Standards

* **Code Language:** Code identifiers (classes, functions, variables) must be written in standard English (e.g., `calculateLineItem`, `validateNIF`).
* **Trilingual Requirements:** Any user-facing feature or application MUST support all three languages:
  * Arabic (`ar`) with RTL layout
  * French (`fr`) with LTR layout
  * English (`en`) with LTR layout
* **Unit Testing:** All new core logic must include unit tests using Node.js's built-in test runner (`node --test`).

---

### Git & Pull Request Workflow

1. Fork and clone the repository.
2. Create a feature branch:
   ```bash
   git checkout -b feat/package-name-feature-description
   ```
3. Run the full test suite before committing:
   ```bash
   npm test
   ```
4. Submit a Pull Request with a clear description of your changes.
