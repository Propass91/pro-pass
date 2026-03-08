# Handoff Copilot Mac (VS Code)

Ce document sert a transmettre l'etat exact du projet a Copilot dans VS Code sur Mac.

## Peut-on communiquer directement entre Copilot Windows et Copilot Mac ?
Non. Les agents ne partagent pas automatiquement l'historique entre machines.
Tu dois transmettre le contexte via un fichier (celui-ci) ou un copier-coller dans le chat Mac.

## Prompt a coller tel quel dans VS Code Mac
```text
Tu reprends un projet ProPass deja avance. Lis d'abord MAC_COPILOT_HANDOFF.md puis execute exactement les etapes macOS.
Contexte important:
1) Mobile NFC Android: patch v16 deja publie avec verification reelle post-ecriture (read-back) + delais d'ecriture + logs tech NFC.
2) APK de reference: https://www.pro-pass.app/mobile/propass-mobile-debug-v16.apk
3) SHA256 APK v16: B7B8D1AADA31ACF00CD6A78CBA058669940036C5674E0E2025FBD2659DAB65D8
4) Objectif actuel: chantier Mac desktop M1/M2/M3/M4, build/package electron sur macOS.
5) Scripts deja ajoutes dans package.json: dist:mac:arm64, dist:mac:x64, dist:mac:universal.
6) Checklist macOS: CHECKLIST_MAC_PRODUCTION.md.
7) Script de packaging rapide: scripts/pack_macos.sh.
8) main.js deja adapte pour icone cross-platform (ico windows, png mac/linux).

Taches:
- Verifier prerequis macOS (Xcode CLT, node/npm, dependances natives).
- Faire npm ci, npm run build, npm run dist:mac:arm64.
- Donner les chemins d'artefacts dist (.dmg/.zip) + checksums SHA256.
- Si echec native module (better-sqlite3/pcsclite), corriger proprement pour Apple Silicon.
- Optionnel: produire aussi dist:mac:universal.
- Ne rien casser cote Windows.
```

## Etat technique deja fait
1. package.json
- Ajout scripts:
- dist:mac:arm64
- dist:mac:x64
- dist:mac:universal
- Ajout bloc build.mac (targets dmg, zip, nom artefact explicite).

2. main.js
- Selection d'icone conditionnelle plateforme:
- Windows: build/icon.ico
- macOS/Linux: build/icon.round.png

3. CHECKLIST_MAC_PRODUCTION.md
- M1 Build/package
- M2 Prerequis machine
- M3 Verification fonctionnelle
- M4 Validation Apple Silicon M1/M2/M3/M4

4. scripts/pack_macos.sh
- Build UI
- Dist mac arm64

## Prerequis a installer sur Mac
Ouvrir terminal VS Code (Mac) et executer:

```bash
xcode-select --install || true
```

Si Homebrew absent:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Installer outils principaux:
```bash
brew install node@20 python@3.11 pkg-config
```

Optionnel mais recommande pour modules natifs:
```bash
brew install cmake
```

Verifier:
```bash
node -v
npm -v
python3 --version
xcode-select -p
```

## Build desktop macOS (Apple Silicon)
Depuis la racine du repo:

```bash
npm ci
npm run build
npm run dist:mac:arm64
```

Verifier artefacts:
```bash
ls -lh dist | grep -E "mac|dmg|zip"
shasum -a 256 dist/*mac-arm64*.dmg dist/*mac-arm64*.zip
```

## Build universal (optionnel)
```bash
npm run dist:mac:universal
ls -lh dist | grep universal
shasum -a 256 dist/*universal*.dmg dist/*universal*.zip
```

## Si erreur sur modules natifs (cas frequent Mac)
1. Nettoyage:
```bash
rm -rf node_modules package-lock.json
npm cache verify
npm ci
```

2. Rebuild natif:
```bash
npm rebuild better-sqlite3
npm rebuild pcsclite
```

3. Relancer build:
```bash
npm run build
npm run dist:mac:arm64
```

## Signature / notarization Apple (si distribution externe)
Non configuree dans ce repo pour le moment.
Si necessaire, ajouter plus tard:
- certificat Apple Developer ID
- variables d'environnement APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / CSC_LINK / CSC_KEY_PASSWORD
- config electron-builder pour notarization.

## Rappel mobile (a ne pas perdre)
- Android NFC v16 implemente verification read-back bloc par bloc.
- En cas d'echec mobile a la reprise test: recuperer message exact (AUTH_FAILED / VERIFY_FAILED / etc.) + logcat `ProPassNfc`.

## Resultat attendu cote Mac
1. Un .dmg arm64 installable sur Mac Apple Silicon.
2. Un .zip arm64 de secours.
3. SHA256 de chaque artefact.
4. Compte-rendu des tests M1/M2/M3/M4 selon CHECKLIST_MAC_PRODUCTION.md.
