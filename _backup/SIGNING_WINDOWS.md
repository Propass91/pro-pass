# Signature Windows (code-signing)

Objectif: réduire les alertes SmartScreen/antivirus (faux positifs) en signant l’installateur et les binaires.

## 1) Pré-requis

- Un certificat **Code Signing** (idéalement **EV** pour SmartScreen) au format `PFX`.
- Le mot de passe du PFX.

## 2) Méthode recommandée (electron-builder)

Electron Builder signe automatiquement si tu fournis ces variables d’environnement **avant** `npm run dist`:

- `CSC_LINK` : chemin vers ton `.pfx` (ex: `C:\certs\propass.pfx`) ou URL/base64 selon ton setup.
- `CSC_KEY_PASSWORD` : mot de passe du `.pfx`.

Exemple PowerShell:

```powershell
$env:CSC_LINK = 'C:\certs\propass.pfx'
$env:CSC_KEY_PASSWORD = 'TON_MDP_PFX'
cd "$env:USERPROFILE\Documents\PPC"
npm run dist
```

## 3) Vérifier la signature

Si tu as Windows SDK:

```powershell
signtool verify /pa /v .\dist\"PPC Setup 1.0.0.exe"
```

## 4) Icône / métadonnées (recommandé)

- Mets une icône `.ico` (256x256) dans `build/icon.ico`.
- Puis ajoute dans `package.json`:

```json
"build": {
  "win": { "icon": "build/icon.ico" }
}
```

## Notes

- Je ne peux pas aider à contourner un antivirus.
- La signature + publisher/author + une build stable sont ce qui améliore le plus la “réputation”.
