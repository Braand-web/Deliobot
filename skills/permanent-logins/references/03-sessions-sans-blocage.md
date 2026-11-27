# Sessions sans blocage

## Principe

Une session meurt rarement « toute seule » : elle meurt parce qu'on se déconnecte, parce qu'on la maltraite (rafales d'actions qui déclenchent les protections anti-automatisation), ou parce qu'un redémarrage mal géré fait croire qu'elle a disparu. Ce skill couvre la vie quotidienne de la session.

## Méthode pas à pas

### Garder la session vivante

1. **Ne jamais cliquer « se déconnecter »**, sous aucun prétexte, sur aucune plateforme (règle absolue, voir skill 01).
2. **Réutiliser la même fenêtre/session** plutôt que d'ouvrir des sessions parallèles : une tâche reprend le navigateur et le profil existants (skills 01 et 02).
3. **Fermer proprement** : quand le navigateur doit s'arrêter, le fermer normalement (pas de kill sauvage répété) pour que le profil écrive son état à jour sur le disque.
4. **Vérifier régulièrement** : à chaque tâche, le contrôle de session vivante du skill 01 ; mettre à jour la date de dernière vérification dans le registre.

### Rythmes d'usage naturels

5. **Espacer les actions** comme le ferait un humain : pas de rafales de publications, d'envois ou de modifications à la seconde. Étaler les lots dans le temps (par exemple une action toutes les quelques minutes plutôt que vingt d'un coup).
6. **Respecter les limites connues de `<PLATEFORME>`** : quotas d'envois par fenêtre de 24 h, nombre maximal d'actions par session, seuils de vérification supplémentaires au-delà d'un certain volume. Quand un quota est atteint, **s'arrêter** et reprendre à la fenêtre suivante — ne jamais contourner.
7. **Arrêter après les premiers refus** : si la plateforme refuse deux fois de suite la même action (quota, vérification demandée), stopper la série, noter l'incident au registre et passer au skill 04 si une vérification est exigée.
8. **Éviter les signaux d'automatisation grossiers** : mêmes gestes à intervalles mécaniquement identiques, connexions depuis des adresses IP qui changent sans cesse, allers-retours frénétiques entre comptes. Stabilité et régularité valent mieux que vitesse.

### Après un redémarrage de la machine

9. **Reprendre la session, pas se reconnecter.** Au redémarrage, relancer le navigateur **avec le même dossier de profil** : dans l'immense majorité des cas, la session est toujours là. Vérifier (page de compte) avant de conclure à une perte.
10. **Reprendre les tâches interrompues depuis leur dernier état confirmé**, pas depuis le début : une action dont le résultat est inconnu se **vérifie** (l'élément est-il en ligne ?) avant d'être répétée.
11. **Ne déclarer une session perdue qu'après vérification réelle** : écran de connexion affiché ou page de compte inaccessible. Sinon, c'est une reprise, pas une reconnexion.

## Règles

- Un refus de la plateforme est un **signal d'arrêt**, pas un obstacle à forcer.
- Ne jamais multiplier les tentatives après un blocage : chaque essai supplémentaire aggrave le risque (verrouillage, vérification renforcée).
- Toute perte de session confirmée est notée au registre avec la date et le contexte (redémarrage, expiration, demande de vérification).

## Pièges

- **Confondre navigateur fermé et session fermée** : fermer le navigateur n'efface pas la session si le profil est persistant.
- **Le redémarrage qui « casse tout »** : souvent faux — vérifier d'abord, conclure ensuite.
- **Les quotas partagés** : plusieurs chaînes sous un même compte partagent souvent le même quota. Compter les actions **au niveau du compte**, pas de la chaîne.

## Contrôles

- [ ] Aucune déconnexion effectuée, aucune session parallèle ouverte inutilement.
- [ ] Les actions du jour respectent les quotas connus de `<PLATEFORME>`, comptés par compte.
- [ ] Après tout redémarrage : session vérifiée avant toute conclusion.
- [ ] Incidents et refus notés au registre.
