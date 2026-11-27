# Checklist — Déploiement propre

> À suivre point par point à **chaque** mise en ligne, première publication comme mise à jour. Ne cochez un point que s'il est réellement fait. « Déployé » ne se dit qu'à la fin, après la vérification en ligne.

## Avant le déploiement

- [ ] La dernière version du code est **commitée** dans git (rien d'important ne vit hors du dépôt).
- [ ] L'application **tourne en local** sans erreur visible.
- [ ] Les **tests** disponibles passent ; à défaut de tests automatisés, les fonctions clés ont été essayées à la main en local.
- [ ] Le **build de production** réussit localement (pas seulement le mode développement).
- [ ] Aucun **secret** dans le code ni dans le dépôt : clés et jetons uniquement en variables d'environnement.
- [ ] Les **variables d'environnement** nécessaires sont configurées sur `<PLATEFORME_DEPLOIEMENT>`.
- [ ] Une **sauvegarde** de l'état actuel est faite (code, et données s'il y en a) — surtout si le déploiement touche à la production ou à une base de données.
- [ ] Si l'action est **irréversible** (migration de données, suppression, changement de domaine) : l'utilisateur a confirmé explicitement.

## Déploiement

- [ ] Déploiement lancé sur `<PLATEFORME_DEPLOIEMENT>` et **terminé sans erreur** (lire la sortie jusqu'au bout, pas seulement le début).
- [ ] La version déployée est bien la version prévue (bon commit, bon build).
- [ ] Le moyen de **revenir en arrière** est identifié en cas de problème (déploiement précédent restaurable).

## Vérification en ligne (obligatoire)

- [ ] La **vraie adresse** publique est ouverte dans un navigateur.
- [ ] La page principale **charge complètement** (pas d'écran blanc, pas d'erreur serveur).
- [ ] Les **fonctions clés** sont testées une par une, comme un utilisateur final (navigation, formulaire, compte, paiement fictif si applicable).
- [ ] L'**affichage mobile** est vérifié (la majorité des utilisateurs sont sur téléphone).
- [ ] Les liens et boutons principaux répondent ; aucune ressource évidente ne manque (images, styles).

## Livraison

- [ ] Le **lien réel et vérifié** est remis à l'utilisateur.
- [ ] Le **récapitulatif** accompagne le lien : ce qui a été construit ou changé, en langage simple.
- [ ] L'utilisateur sait **comment demander des modifications**.
- [ ] Les **notes de projet** sont mises à jour (état, choix, prochain pas) pour la session suivante.
- [ ] Le déploiement est **inscrit au journal** : date, cible, version, résultat de la vérification.

## Si quelque chose casse en production

1. Restaurer d'abord la dernière version qui marchait (retour en arrière), **avant** de déboguer.
2. Informer l'utilisateur simplement : ce qui se passe, ce qui est fait.
3. Corriger en local, re-tester, puis redéployer en suivant cette checklist depuis le début.
