# Multi-comptes, multi-profils

## Principe

Deux niveaux à ne pas confondre :

- **Plusieurs comptes différents** (identifiants différents) → **un profil de navigateur nommé par compte**. Chaque profil porte sa propre session ; ils ne se mélangent jamais.
- **Plusieurs chaînes, pages ou espaces sous un même compte** (par exemple plusieurs chaînes rattachées au même compte d'une plateforme vidéo) → **un seul profil** : la session du compte donne accès à toutes ses chaînes, on bascule de l'une à l'autre **dans l'interface**, sans reconnexion.

## Méthode pas à pas

1. **Nommer les profils.** Convention : `<PROFIL>` = nom court et stable du compte, par exemple `compte-principal`, `compte-association`. Un dossier par profil : `<DOSSIER_PROFILS>/<PROFIL>`.
2. **Connecter chaque compte dans son profil.** Suivre le skill 01 pour chaque `<COMPTE>` : lancer le navigateur avec le bon dossier, sign-in unique, vérification, enregistrement.
3. **Cartographier dans le registre.** Remplir le registre (modèle : `REGISTRE-MODELE.md`) : pour chaque ligne, `<COMPTE>` → `<PROFIL>` → `<PLATEFORME>` → chaînes/pages rattachées → état → dernière vérification.
4. **Choisir le bon profil avant chaque tâche.** La tâche nomme le compte ou la chaîne visée ; l'agent lit le registre, en déduit le profil, et lance le navigateur avec ce dossier. Jamais de profil « par défaut » choisi au hasard.
5. **Basculer de chaîne sous un même compte.** Ouvrir le sélecteur de chaîne/compte de la plateforme (menu avatar, « Changer de compte », « Switch account » selon la plateforme), choisir la chaîne cible, vérifier le nom affiché avant d'agir. Aucune reconnexion n'est demandée pour une bascule interne.
6. **Créer une nouvelle chaîne sous un compte existant.** Utiliser la fonction de création de la plateforme **dans la session déjà ouverte** : la nouvelle chaîne hérite de la session du compte, elle est immédiatement gérable. L'ajouter au registre dès sa création.

## Règles

- **Jamais deux comptes dans un même profil** : les sessions se percuteraient et l'agent agirait sous la mauvaise identité.
- **Toujours vérifier l'identité active avant une action irréversible** (publication, suppression, envoi) : lire le nom de la chaîne/du compte affiché à l'écran et le comparer à la cible de la tâche.
- **Le registre fait foi.** Si le registre et l'écran se contredisent, s'arrêter, vérifier, corriger le registre — ne pas continuer « au jugé ».
- **Un compte nouveau = une ligne de registre avant la première action**, pas après.

## Pièges

- **Bascule silencieuse** : certaines plateformes reviennent à la chaîne « principale » après certaines pages. Revérifier l'identité active après chaque navigation profonde.
- **Profils qui se ressemblent** : deux comptes aux noms proches. La convention de nommage du registre doit les distinguer sans ambiguïté.
- **Session partagée entre plateformes** : un même compte peut ouvrir plusieurs plateformes liées (connexion via un fournisseur d'identité unique). Le registre le note plateforme par plateforme : la session peut être vivante sur l'une et expirée sur l'autre.

## Contrôles

- [ ] Chaque `<COMPTE>` a son `<PROFIL>` nommé et son dossier propre.
- [ ] Le registre liste chaque chaîne/page rattachée à son compte.
- [ ] L'identité active affichée correspond à la cible avant chaque action.
- [ ] Toute nouvelle chaîne créée est inscrite au registre le jour même.
