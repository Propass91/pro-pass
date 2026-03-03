# CHECKLIST PRODUCTION WINDOWS — PROPASS

## 1) Build et packaging
- [ ] Lancer `npm --prefix "C:\Users\Wack\Desktop\pro-pass" run build`
- [ ] Lancer `npm --prefix "C:\Users\Wack\Desktop\pro-pass" run dist`
- [ ] Vérifier que l'installateur `.exe` est présent dans `dist/`

## 2) Prérequis poste client (obligatoires)
- [ ] Windows 10/11 à jour
- [ ] Lecteur ACR122U installé (pilote PC/SC actif)
- [ ] Service **Smart Card (SCardSvr)** démarré
- [ ] Python disponible sur le poste (`python` en PATH)
- [ ] Dépendances Python NFC installées (`pyscard`)
- [ ] Accès Internet vers `https://www.pro-pass.app`

## 3) Vérification fonctionnelle minimale
- [ ] Connexion client OK
- [ ] Étape 1: lecteur détecté quand branché, non détecté quand débranché
- [ ] Étape 2: badge détecté / retiré correctement
- [ ] Étape 3: copie badge réussie
- [ ] Quota client décrémenté après copie réussie
- [ ] En admin, le compteur de copies reflète la copie faite

## 4) Vérification robustesse
- [ ] Test hors-ligne: message d'erreur propre, pas de crash
- [ ] Reconnexion réseau: récupération dump/quota OK
- [ ] Redémarrage app: session, quota et synchro toujours cohérents
- [ ] Test sur au moins 2 PC Windows différents

## 5) Distribution entreprise
- [ ] Signer numériquement l'installateur (sinon SmartScreen avertit)
- [ ] Fournir guide d'installation utilisateur (`INSTALLATION.txt`)
- [ ] Vérifier droits utilisateur standard (pas admin local requis)

## 6) Critère Go/No-Go
**GO** uniquement si tous les points 1→5 sont validés sur plusieurs machines.

## Important
On peut viser une version très stable, mais il n'existe pas de garantie absolue “sans bug” sur 100% des PC Windows (drivers, antivirus, politiques IT, versions système). Cette checklist réduit fortement le risque en production.
