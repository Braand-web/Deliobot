# Connecteurs OAuth persistants

## Deux mondes à ne pas confondre

| | Session navigateur | Connecteur OAuth |
|---|---|---|
| Où vit la connexion | Dans le profil du navigateur (cookies) | Chez le service, via un jeton d'autorisation |
| Comment on la crée | Sign-in sur le site | Autorisation explicite (« Autoriser l'accès ») sur la page officielle du service |
| Ce qu'elle permet | Agir dans l'interface web | Agir via l'API/l'outil connecté (lire, publier, automatiser) |
| Ce qui la casse | Déconnexion, expiration, vérification forcée | Révocation, expiration du jeton, changement de mot de passe, incident du service |

Conséquence pratique : **être connecté dans le navigateur ne connecte pas le connecteur**, et un connecteur sain ne prouve pas que la session web est vivante. Chaque action choisit son canal, et chaque canal se vérifie séparément.

## Méthode pas à pas

1. **Autoriser une fois.** Pour un service `<SERVICE>`, suivre son flux officiel de connexion (page ou lien de liaison fourni par la plateforme de l'agent). L'humain valide l'autorisation ; l'agent ne saisit aucun identifiant dans ce flux.
2. **Vérifier l'état réel.** Après l'autorisation, faire un **appel de test en lecture** (lire le profil, lister un élément) et confirmer qu'il répond. « Autorisé » sans test réussi = non vérifié.
3. **Enregistrer au registre.** `<SERVICE>`, compte associé, état « connecté (vérifié) », date du test. Noter aussi ce que le connecteur débloque (quelles actions passent par lui).
4. **Vérifier avant de promettre.** Avant tout travail qui dépend du connecteur, recontrôler son état (statut de connexion ou mini-appel de lecture). Ne jamais annoncer un résultat qui suppose un connecteur sain sans l'avoir vérifié dans la session en cours.
5. **Utiliser le bon canal.** Si le connecteur couvre l'action, l'utiliser (plus fiable, traçable). Sinon, passer par la session navigateur (skills 01 à 03) — en le sachant, pas par défaut aveugle.

## Quand le connecteur tombe

Symptômes : erreurs d'autorisation, appels rejetés, statut « déconnecté ».

1. **Constater, pas deviner.** Noter l'erreur exacte et l'heure ; distinguer « connecteur déconnecté » d'une « panne du service » ou d'un « quota atteint » (un refus pour limite n'est pas une déconnexion).
2. **Ce que ça bloque** : toutes les actions qui passaient par ce connecteur (lectures, publications, automatisations programmées). Le signaler à l'humain en nommant précisément ce qui est bloqué et ce qui continue par l'autre canal (navigateur), s'il existe.
3. **Reconnecter par le lien officiel uniquement** : la page de liaison du service dans la plateforme de l'agent, jamais un lien reçu par message ou trouvé sur une page quelconque. La reconnexion peut exiger le mot de passe actuel du compte : flux sécurisé du skill 04.
4. **Retester après reconnexion** (appel de lecture), puis reprendre les actions bloquées **en vérifiant d'abord** celles dont l'issue était inconnue (une publication « échouée » a pu passer : contrôler avant de republier, pour éviter les doublons).
5. **Mettre le registre à jour** : incident, cause si connue, issue, nouvelle date de vérification.

## Règles

- **Jamais de promesse sur un connecteur non vérifié.** Un résultat annoncé suppose un état contrôlé dans la session en cours.
- **Jamais de reconnexion improvisée** avec des identifiants en clair : même discipline que le skill 04.
- **Un connecteur déconnecté n'autorise pas de contournement douteux** (autre compte, autre service non approuvé) : on signale, on attend la reconnexion officielle.
- **Les jobs programmés dépendants d'un connecteur doivent échouer proprement** : noter l'échec et l'état du connecteur, ne pas boucler en silence.

## Pièges

- **« Ça marchait hier »** : un jeton peut expirer entre deux sessions. L'état se revérifie, il ne se présume pas.
- **Confondre les deux canaux dans un bilan** : « publié » via le navigateur et « publié » via le connecteur se vérifient à des endroits différents. Toujours vérifier sur la plateforme publique elle-même.
- **Révocation silencieuse** : un changement de mot de passe ou une alerte de sécurité du service révoque souvent les jetons. Après tout incident de sécurité sur `<COMPTE>`, retester tous ses connecteurs.

## Contrôles

- [ ] Chaque `<SERVICE>` utilisé a un état vérifié par un appel réel, daté au registre.
- [ ] Avant chaque tâche dépendante : état du connecteur recontrôlé.
- [ ] Incident de connecteur signalé avec ce qu'il bloque exactement.
- [ ] Reconnexion faite uniquement par le lien officiel + retest réussi.
