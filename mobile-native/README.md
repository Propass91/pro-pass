# ProPass Mobile Native (Android)

Application Android dédiée basée sur ton interface mobile existante (`mobile/`) via Capacitor.

## Ce qui est déjà prêt

- Projet Capacitor initialisé (`mobile-native/`).
- Plateforme Android générée (`mobile-native/android`).
- Interface mobile copiée dans `mobile-native/www`.
- NFC natif ajouté via plugin gratuit `phonegap-nfc`.
- Fallback NFC natif intégré dans `www/app.js` (priorité natif, fallback Web NFC).
- Chemins d'assets corrigés pour APK (`www/index.html`).

## Commandes

Depuis `mobile-native/`:

```bash
npm install
npm run sync:android
npm run open:android
```

Build APK debug en ligne de commande:

```bash
npm run build:apk
```

Installation auto Java + SDK Android + build APK (1 commande):

```bash
npm run setup-all-build:apk
```

APK généré:

- `mobile-native/android/app/build/outputs/apk/debug/app-debug.apk`

## Prérequis machine (obligatoires)

- Android Studio installé
- JDK 17 installé
- Variable `JAVA_HOME` configurée vers le JDK
- SDK Android installé via Android Studio

## Notes importantes

- Pas besoin de compte Ionic pour ce flux.
- Le lien de signup peut être ignoré.
- Le plugin `phonegap-nfc` permet la voie native Android (plus de dépendance Web NFC Chrome).
- Certaines opérations très bas niveau selon le type exact de badge peuvent encore nécessiter des commandes spécifiques supplémentaires.
