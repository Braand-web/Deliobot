# Pack « Prompt Système Complet — Agent Autonome »

## Ce que c'est

Ce pack contient un **prompt système complet, prêt à coller**, qui donne à n'importe quel agent d'IA une manière de travailler complète et autonome : prendre en charge une demande jusqu'au résultat, vérifier les faits avant d'affirmer, retenir ce qu'il apprend, déléguer les travaux longs, garder ses connexions ouvertes, produire et contrôler la qualité avant de livrer, publier avec mandat, et communiquer dans la langue et le ton de son utilisateur.

Ce n'est **pas** un skill à charger à la demande, ni un module optionnel. C'est un texte fondateur : une fois installé dans la configuration de base d'un agent, ces règles deviennent son comportement natif, celui qu'il applique à chaque tâche sans qu'on ait à le lui rappeler.

Le pack est **universel** : il ne contient aucun nom, aucun compte, aucun lien, aucun montant réels. Tout ce qui dépend de l'utilisateur final est écrit sous forme de variables à remplir, entre `<…>` (voir `VARIABLES.md`).

## Contenu du pack

| Fichier | Rôle |
|---|---|
| `PROMPT-SYSTEME-COMPLET.md` | Le livrable principal : le prompt système complet, structuré en sections, à coller tel quel (après remplissage des variables). |
| `METHODE-INSTALLATION.md` | Comment installer le prompt dans un agent existant, comment le tester, et comment un développeur peut s'en servir comme spécification fonctionnelle pour construire une application d'agent. |
| `BRIEF-CLAUDE-CODE.md` | Un brief prêt à coller dans une session **Claude Code** ouverte sur le projet cible : il lui ordonne d'auditer le code existant et d'implémenter uniquement les pièces manquantes du pack. |
| `VARIABLES.md` | La liste de toutes les variables `<…>` utilisées, leur signification, un exemple fictif de remplissage, et si elles sont obligatoires ou optionnelles. |
| `README.md` | Ce fichier. |

## La règle qui gouverne tout le pack : ajouter seulement ce qui manque

Ce pack ne remplace jamais un agent ou un projet qui fonctionne déjà. Quelle que soit la voie choisie, on commence par **auditer l'existant**, on liste **les manques**, et on n'implémente **que les manques** — par petits incréments vérifiés, sans casser ce qui marche. Cette règle est écrite trois fois, à dessein : dans le prompt système (sa section 13, pour que l'agent l'applique lui-même), comme étape 0 de la méthode d'installation, et comme contrainte maîtresse du brief Claude Code. Le rapport de fin d'installation suit toujours le même format : **déjà présent / ajouté / restant**.

## Les voies d'usage

### Voie 1 — Coller le prompt dans un agent existant

Vous disposez déjà d'un agent (assistant configurable, agent de votre plateforme, agent que vous hébergez). Vous ouvrez son champ « instructions système » / « prompt système » / « comportement de base », vous remplissez les variables du prompt avec vos propres informations, et vous le collez en entier. L'agent adopte alors cette méthode de travail comme capacité native. Le détail pas à pas est dans `METHODE-INSTALLATION.md`.

### Voie 2 — Le faire implémenter par Claude Code dans un projet existant

C'est la voie prévue si vous codez vos projets avec **Claude Code**. Ouvrez une session Claude Code à la racine du projet cible, placez les fichiers du pack à sa portée, remplissez les variables du brief, et collez `BRIEF-CLAUDE-CODE.md`. Claude Code auditera le code existant, listera ce qui est déjà présent et ce qui manque, puis implémentera **uniquement les manques**, composant par composant, avec tests ou build après chaque pièce, et un rapport final « présent / ajouté / restant ».

### Voie 3 — S'en servir comme spécification pour développer une application

Vous (ou un développeur) construisez une application d'agent. Le prompt devient alors la **spécification fonctionnelle** du comportement attendu : chaque section décrit un composant à implémenter (mémoire durable, navigateur à profil persistant, coffre-fort d'identifiants, planificateur de tâches, délégation à des sous-agents, contrôle qualité avant livraison…). `METHODE-INSTALLATION.md` liste ces composants un par un.

## Ce que ce pack fait — et ce qu'il ne fait pas

**Ce qu'il fait :**

- Il transmet une **méthode de travail** complète : diligence, vérification, mémoire, planification, délégation, production, publication, sécurité, communication.
- Il donne des **règles de comportement** précises et actionnables, pas des intentions vagues.
- Il rend un agent **cohérent dans la durée** : mêmes réflexes à chaque tâche, sans réapprentissage.

**Ce qu'il ne fait pas :**

- Il ne donne à aucun agent **les outils** d'un autre agent : pas d'accès à un navigateur, à des comptes, à des connecteurs, à des fichiers ou à des services tiers. Un prompt décrit un comportement ; il ne fournit ni les mains, ni les clés.
- Il ne transfère **aucune donnée** : aucun compte connecté, aucune session ouverte, aucun historique. Chaque installation repart de zéro, avec les comptes et les autorisations de son propre utilisateur.
- Il ne garantit **aucun résultat commercial** (vues, abonnés, ventes) : il améliore la rigueur et l'autonomie du travail, pas les performances d'une plateforme.
- Il ne transfère **pas l'intelligence** : l'intelligence vient du modèle de langage sous-jacent, le pack donne la méthode. L'agent cible doit donc fonctionner avec un modèle de capacité au moins équivalente à celle de l'agent de référence ; avec un modèle nettement plus faible, la même méthode donnera des résultats inférieurs, et avec un modèle plus fort, elle peut le dépasser.

En résumé : ce pack clone une **façon de travailler**, pas une installation. Pour que l'agent puisse réellement exécuter ce que le prompt décrit, il faut lui fournir les capacités correspondantes (voir la liste des composants requis dans `METHODE-INSTALLATION.md`).

## Pack complémentaire

La section « navigateur et connexions permanentes » du prompt est un résumé natif. Pour le détail complet de cette seule capacité (profils persistants, un profil par compte, reprise de session, vérifications), il existe un pack dédié séparé : **« Connexions Permanentes »**. Les deux packs sont indépendants et peuvent être utilisés ensemble ou séparément.

## Licence d'usage

Vous pouvez donner ce pack, l'installer sur vos propres agents, l'adapter à vos besoins et le revendre, à condition de conserver ce fichier README dans la copie transmise.
