# Registre des connexions — MODÈLE VIERGE

Copiez ce fichier sous le nom `REGISTRE.md`, remplissez-le avec vos propres valeurs, et tenez-le à jour : c'est la carte de toutes les sessions permanentes de l'agent. Aucun mot de passe, aucun code, aucun jeton ne s'écrit ici — jamais.

## Comptes et profils

| Compte `<COMPTE>` | Profil `<PROFIL>` | Dossier du profil | Fournisseur d'identité | Dernière vérification |
|---|---|---|---|---|
|  |  |  |  |  |
|  |  |  |  |  |
|  |  |  |  |  |

## Plateformes et chaînes rattachées

| Plateforme `<PLATEFORME>` | Compte | Chaîne / page / espace | Canal utilisé (navigateur / connecteur) | État | Dernière vérification |
|---|---|---|---|---|---|
|  |  |  |  | connecté / déconnecté / vérification demandée |  |
|  |  |  |  | connecté / déconnecté / vérification demandée |  |
|  |  |  |  | connecté / déconnecté / vérification demandée |  |

## Connecteurs OAuth

| Service `<SERVICE>` | Compte associé | État (vérifié par appel réel) | Ce qu'il débloque | Dernière vérification |
|---|---|---|---|---|
|  |  |  |  |  |
|  |  |  |  |  |

## Numéros et moyens à ne plus utiliser

| Moyen (numéro, e-mail, appareil) | Plateforme concernée | Raison (saturé, refusé, compromis) | Date |
|---|---|---|---|
|  |  |  |  |

## Journal des incidents

| Date | Plateforme / service | Compte | Incident (expiration, mot de passe rejeté, vérification forcée, connecteur tombé) | Issue et action de reprise |
|---|---|---|---|---|
|  |  |  |  |  |
|  |  |  |  |  |

## Règles de tenue du registre

1. Une ligne se met à jour **le jour même** de tout changement d'état (connexion, perte, vérification, reconnexion).
2. L'état « connecté » n'est écrit qu'après vérification réelle (page de compte accessible ou appel de test réussi), jamais par présomption.
3. Aucun secret ici : ni mot de passe, ni code, ni jeton, ni lien de récupération.
