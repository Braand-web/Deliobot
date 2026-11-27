---
name: permanent-logins
description: "Garder les comptes de la personne connectés pour de bon dans le navigateur intégré : se connecter une seule fois, ne jamais se déconnecter, un profil par compte, plusieurs chaînes sous un même compte, un registre des connexions, reprise après redémarrage, codes et vérifications par la personne, connecteurs OAuth vérifiés. À utiliser dès qu'une tâche dépend d'un compte connecté (réseaux sociaux, YouTube, outils métier) ou qu'une session semble perdue."
---

# Connexions permanentes

## Dans Delio

- Ton navigateur intégré garde déjà son profil entre les tâches, les conversations, les tâches programmées et les redémarrages : c'est lui, « le profil persistant ». Ne le vide jamais, ne passe jamais en navigation privée pour une tâche connectée.
- Un mot de passe ou une clé ne passe jamais par le chat : demande-le avec `request_credential` (carte sécurisée de Delio) ou laisse la personne se connecter elle-même en prenant la main sur ton navigateur.
- Un code ou une confirmation sur le téléphone de la personne : demande l'action exacte, puis attends sa réponse.
- Les connecteurs (Gmail, Google Drive, Slack…) passent par les connexions d'apps de Delio : vérifie-les par un appel de lecture avant de promettre un résultat.
- Le registre des connexions vit dans `<sharedBotFolder>/connexions/registre.md`, partagé entre tes conversations ; le modèle est `references/registre-modele.md`. Jamais aucun secret dedans.
- Fiches de détail, à lire au besoin : `references/01-profil-navigateur-persistant.md`, `02-multi-comptes-multi-profils.md`, `03-sessions-sans-blocage.md`, `04-reconnexion-et-verifications.md`, `05-connecteurs-oauth-persistants.md`.


Préalable : ces instructions supposent un modèle de langage de capacité au
moins équivalente à celle de l'agent de référence. Un modèle plus faible
appliquera la procédure avec moins de jugement — notamment sur les cas
limites de vérification (session ambiguë, défi inhabituel, plateforme qui a
changé son interface) — et un modèle plus fort l'appliquera avec davantage
de fiabilité. La procédure ne compense pas un modèle faible.

## Ton environnement de travail

Tu travailles dans un navigateur dont le profil est PERSISTANT : le dossier
ton profil de navigateur survit aux redémarrages et conserve les cookies et les
sessions. Toutes tes tâches — immédiates, programmées, reprises après
incident — utilisent ce navigateur et ces profils. Il n'existe pas d'autre
navigateur pour tes tâches connectées.

## Règles de connexion (absolues)

1. CONNEXION UNIQUE. Chaque compte est connecté UNE SEULE FOIS, dans son
   profil. Après ce sign-in initial, tu ne te reconnectes jamais « au cas
   où » : tu rouvres le profil et tu vérifies que la session est vivante.
2. UN PROFIL PAR COMPTE. Le compte principal vit dans le profil par défaut
   (ton profil principal). Chaque compte supplémentaire a son propre profil nommé
   distinct, dans un profil distinct. Tu ne mélanges
   jamais deux comptes dans un même profil.
3. JAMAIS DE DÉCONNEXION. Tu ne cliques jamais « Se déconnecter », « Sign
   out » ou équivalent, sur aucune plateforme. Tu ne vides jamais les
   cookies ni le stockage d'un profil. Tu n'utilises jamais la navigation
   privée pour une tâche connectée.
4. PLUSIEURS CHAÎNES, UNE SESSION. Quand un même compte porte plusieurs
   chaînes, pages ou espaces sur une plateforme, tu bascules de l'un à
   l'autre avec le sélecteur interne de la plateforme, SANS te reconnecter.
   Tu peux créer une nouvelle chaîne ou page sous un compte existant
   directement dans sa session ouverte. Avant toute action irréversible,
   tu vérifies le nom de la chaîne/du compte actif affiché à l'écran.
5. VÉRIFICATION AVANT ACTION. Au début de chaque tâche sur une plateforme,
   tu confirmes que la session est vivante (page de compte ou tableau de
   bord accessible, sans écran de connexion). Si elle ne l'est pas, tu
   appliques la procédure de reprise ci-dessous — jamais de sign-in
   improvisé.
6. REPRISE APRÈS REDÉMARRAGE. Après un redémarrage de la machine, tu
   relances le navigateur avec le même profil et tu VÉRIFIES la session
   avant de conclure qu'elle est perdue. La plupart du temps, elle est
   toujours là : c'est une reprise, pas une reconnexion. Toute action dont
   le résultat est inconnu se vérifie sur la plateforme avant d'être
   répétée.

## Secrets et vérifications

7. AUCUN SECRET EN CLAIR. Tu ne reçois, ne demandes, n'écris et ne stockes
   jamais un mot de passe dans un chat, un fichier, un journal ou ta
   mémoire. Les identifiants transitent uniquement par le coffre-fort
   sécurisé (les cartes sécurisées de Delio : request_credential) (carte de capture sécurisée ou gestionnaire de
   secrets), qui les transmet directement au champ de connexion. Tu ne
   rapportes que le RÉSULTAT (« session rétablie »), jamais une valeur.
8. CODES À USAGE UNIQUE. Un code de vérification (SMS, e-mail,
   authentificateur) ne sert qu'au défi qui l'a déclenché : le bon compte,
   la bonne plateforme, la session en cours, dans sa fenêtre de validité.
   Tu ne conserves aucun code, tu ne réutilises aucun code, tu ne devines
   aucun code.
9. QUAND L'HUMAIN SEUL PEUT DÉBLOQUER. Certaines plateformes exigent une
   action sur l'appareil personnel de l'humain : confirmation d'identité
   dans leur application, validation d'une notification, vérification
   documentaire. Dans ces cas, tu t'arrêtes, tu prépares tout ce qui peut
   l'être, et tu demandes à l'humain l'action minimale exacte (quelle
   application, quel compte, quel geste). Tu ne contournes jamais ces
   vérifications.
10. MOT DE PASSE REJETÉ. Si un mot de passe est refusé, tu t'arrêtes après
    le premier échec — jamais d'essais en boucle, qui verrouillent le
    compte — et tu signales le fait à l'humain. Tu ne lances jamais une
    réinitialisation de mot de passe ou une récupération de compte sans sa
    demande explicite pour cette action précise.

## Connecteurs OAuth

11. AUTORISER UNE FOIS, VÉRIFIER À CHAQUE FOIS. Les connecteurs (API,
    OAuth) sont un canal distinct du navigateur : être connecté dans le
    navigateur ne connecte pas un connecteur. Chaque connecteur est
    autorisé une fois par le flux officiel du service, puis tu vérifies son
    état réel (appel de test en lecture) avant de t'appuyer dessus ou de
    promettre un résultat. Si un connecteur est déconnecté, tu le signales
    en nommant ce qu'il bloque, et tu ne reconnectes que par le lien
    officiel du service.

## Rythme et prudence

12. USAGE NATUREL. Tu espaces tes actions comme un humain, tu respectes
    les quotas connus de chaque plateforme (comptés par compte, pas par
    chaîne), et après deux refus consécutifs d'une même action, tu
    t'arrêtes : un refus est un signal, pas un obstacle à forcer.

## Registre des connexions

13. REGISTRE À JOUR. Tu tiens le registre `<sharedBotFolder>/connexions/registre.md` : pour chaque
    compte, son profil, ses plateformes, ses chaînes/pages, l'état de
    chaque session et la date de dernière vérification ; plus le journal
    des incidents (expiration, vérification forcée, connecteur tombé) et
    les moyens de validation à ne plus utiliser (numéro saturé, etc.). Tu
    mets le registre à jour le jour même de tout changement d'état, et tu
    n'y écris jamais aucun secret.

## Mise en place et évolution : ajouter seulement ce qui manque

14. AUDIT D'ABORD, AJOUT MINIMAL. Quand ce comportement doit être mis en
    place ou étendu dans ton environnement (nouvelle plateforme, nouveau
    canal, pièce d'architecture absente), tu commences par AUDITER ce qui
    existe déjà : profils et leur durabilité, stockage des sessions,
    correspondance compte → profil, coffre-fort, registre, connecteurs. Tu
    dresses la liste « présent / manquant », puis tu n'ajoutes QUE les
    pièces manquantes. Tu ne réécris jamais ce qui fonctionne déjà, tu ne
    remplaces pas une pièce en place par une équivalente, et tu ne mets
    jamais en danger une session vivante pendant les travaux. Chaque ajout
    se fait par petit incrément vérifié : après l'ajout, tu confirmes que
    l'existant fonctionne toujours et que la pièce nouvelle tient son
    rôle, avant de passer à la suivante.

En cas de doute entre « me reconnecter » et « vérifier la session
existante », tu choisis toujours : vérifier la session existante.
