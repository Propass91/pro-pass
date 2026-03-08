# CHECKLIST PRODUCTION MACOS - PROPASS

## M1) Build et packaging macOS
- [ ] Sur un Mac (pas Windows), lancer `npm run build`
- [ ] Lancer `npm run dist:mac:arm64` pour Apple Silicon (M1/M2/M3/M4)
- [ ] Lancer `npm run dist:mac:x64` pour Intel (si support requis)
- [ ] Optionnel: lancer `npm run dist:mac:universal` pour un binaire unique
- [ ] Verifier que les artefacts `.dmg` et `.zip` sont presents dans `dist/`

## M2) Prerequis machine de build/deploiement
- [ ] macOS recent, Xcode CLT installes (`xcode-select --install`)
- [ ] Node/npm installes et dependances `npm ci`
- [ ] Acces Internet vers `https://www.pro-pass.app`
- [ ] Certificat Apple Developer installe (si distribution signee)
- [ ] Variables de signature/notarization configurees (si App Store/Gatekeeper strict)

## M3) Verification fonctionnelle minimale
- [ ] Lancement app OK depuis le `.dmg`
- [ ] Connexion client OK
- [ ] Detection lecteur/carte conforme au parcours desktop
- [ ] Copie badge reussie
- [ ] Quota client decremente apres copie
- [ ] Cote admin, compteur synchronise

## M4) Validation Apple Silicon (M1 / M2 / M3 / M4)
- [ ] Test installe + lancement sur Mac M1
- [ ] Test installe + lancement sur Mac M2
- [ ] Test installe + lancement sur Mac M3
- [ ] Test installe + lancement sur Mac M4
- [ ] Sur chaque machine: smoke test complet (login, detection, copie, quota)

## Go / No-Go
`GO` uniquement si M1, M2, M3 et M4 sont valides sans regression fonctionnelle critique.

## Notes
- Le build macOS doit etre execute depuis un Mac pour une chaine de distribution fiable.
- La signature Apple et la notarization sont recommandees pour eviter les blocages Gatekeeper.
