# Profil navigateur persistant

## Principe

Un **profil de navigateur** est un dossier qui contient les cookies, le stockage local et l'état de session d'un navigateur. Si ce dossier est **persistant** (il survit aux redémarrages de la machine et aux fermetures du navigateur), alors une connexion faite une fois reste valable pour toutes les sessions suivantes. Toute la méthode repose là-dessus : on ne « se reconnecte » jamais, on **rouvre le même profil**.

## Méthode pas à pas

1. **Choisir l'emplacement du profil.** Un dossier dédié, sur un stockage durable, par exemple `<DOSSIER_PROFILS>/<PROFIL>`. Jamais un dossier temporaire : un profil en mémoire ou en `/tmp` disparaît au premier redémarrage.
2. **Lancer le navigateur avec ce profil.** Toutes les fenêtres et toutes les tâches de l'agent doivent pointer sur le même dossier de profil (option `--user-data-dir` ou équivalent selon le navigateur).
3. **Se connecter une seule fois.** L'humain (ou un flux sécurisé, voir le skill 04) effectue le sign-in sur `<PLATEFORME>` pour `<COMPTE>`. L'agent ne saisit jamais un mot de passe en clair.
4. **Vérifier que la session est établie.** Ouvrir une page réservée aux connectés (page de compte, studio, tableau de bord) et confirmer qu'aucun écran de connexion n'apparaît.
5. **Enregistrer dans le registre.** Noter `<COMPTE>`, `<PROFIL>`, `<PLATEFORME>`, état « connecté », date de vérification (modèle : `REGISTRE-MODELE.md`).
6. **Réutiliser partout.** Chaque tâche ultérieure — action immédiate, job programmé, reprise après incident — rouvre le navigateur **avec le même profil**. Un seul sign-in sert toutes les tâches et tous les jobs programmés.

## Règles

- **Ne jamais se déconnecter.** Ne jamais cliquer « Se déconnecter », « Déconnexion », « Sign out », ni « Révoquer les sessions ». La déconnexion détruit exactement ce que ce skill construit.
- **Ne jamais vider les cookies** ni le stockage du profil, ni lancer le navigateur en mode navigation privée pour une tâche connectée.
- **Un profil = un état de session.** Ne pas copier un profil pendant que le navigateur tourne (risque de corruption) ; les copies se font navigateur fermé.
- **Toujours vérifier avant d'agir.** Au début d'une tâche sur `<PLATEFORME>`, confirmer que la session est vivante (page de compte accessible). Si elle ne l'est pas, passer au skill 04 — ne pas tenter un sign-in improvisé.
- **Séparer navigateur et connecteurs.** Être connecté dans le navigateur ne connecte pas un connecteur API/OAuth, et inversement (voir le skill 05).

## Pièges

- **Profil éphémère par défaut** : beaucoup d'outils d'automatisation créent un profil neuf à chaque lancement. Symptôme : « l'agent redemande le mot de passe à chaque tâche ». Correctif : forcer le même dossier de profil partout.
- **Deux navigateurs, deux profils** : si l'agent utilise tantôt un navigateur intégré, tantôt un autre, chacun a son profil et ses sessions. Un seul navigateur de référence pour les tâches connectées.
- **Nettoyage automatique** : certains systèmes purgent les dossiers « temporaires ». Vérifier que le dossier du profil est hors de toute zone purgée automatiquement.

## Contrôles

- [ ] Le dossier du profil est sur un stockage durable et hors zone de purge.
- [ ] Toutes les tâches pointent sur le même dossier de profil.
- [ ] La session de `<COMPTE>` sur `<PLATEFORME>` est vérifiée vivante.
- [ ] Le registre est à jour (état + date de vérification).
- [ ] Aucune action de déconnexion n'a été effectuée.
