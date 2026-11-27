# Reconnexion et vérifications

## Principe

Même avec un profil persistant parfait, une plateforme peut à tout moment exiger une preuve fraîche : mot de passe redemandé ou rejeté, confirmation d'identité dans son application mobile, validation par téléphone, code à usage unique, code d'authentificateur (TOTP). Ce skill donne le flux pour chaque cas, avec une règle qui prime sur tout : **aucun secret ne transite jamais en clair** — ni dans un chat, ni dans un fichier, ni dans la mémoire de l'agent.

## Règles absolues (avant tout flux)

- **Jamais de mot de passe dans un chat, un fichier, un log ou la mémoire.** Les mots de passe passent uniquement par une **carte de capture sécurisée** ou le **coffre-fort de secrets** de l'environnement, qui les transmet directement au champ de connexion.
- **Ne jamais demander à l'humain de « donner » son mot de passe en texte libre.** S'il le fait spontanément, ne pas le recopier, ne pas le stocker : l'orienter vers le flux sécurisé.
- **Un code à usage unique ne sert qu'au défi qui l'a déclenché** : le bon compte, la bonne plateforme, la session en cours, dans sa fenêtre de validité. Jamais de code « en réserve », jamais de code réutilisé ailleurs.
- **Ne jamais lancer une réinitialisation de mot de passe ou une procédure de récupération de compte** sans demande explicite de l'humain pour cette action précise.
- **Ne jamais utiliser un numéro de téléphone connu comme saturé ou brûlé** pour une plateforme (numéro déjà refusé, déjà associé à trop de comptes) : noter ces numéros comme « à ne plus utiliser » dans le registre.

## Flux par situation

### 1. Mot de passe redemandé (session expirée)

1. Vérifier que c'est bien l'écran officiel de `<PLATEFORME>` (adresse exacte, pas une page imitant la connexion).
2. Déclencher le flux de capture sécurisée : l'humain saisit le mot de passe actuel de `<COMPTE>` sur la carte/le coffre prévu à cet effet.
3. Le secret est transmis au champ de connexion ; l'agent confirme uniquement le **résultat** (« session rétablie »), jamais la valeur.
4. Vérifier la session vivante (skill 01), mettre le registre à jour.

### 2. Mot de passe rejeté

1. **S'arrêter après l'échec.** Ne pas réessayer en boucle : les tentatives répétées verrouillent le compte.
2. Signaler à l'humain : plateforme, compte, fait constaté (« le mot de passe stocké est rejeté »), sans afficher aucune valeur.
3. Attendre un mot de passe actuel via le flux sécurisé (flux 1). Si l'humain ne le connaît plus, la récupération de compte est **son** action, à sa demande explicite.

### 3. Confirmation d'identité dans l'application mobile

1. Certaines plateformes exigent que l'humain confirme « c'est bien moi » dans **son application mobile**. Aucun agent ne peut le faire à sa place.
2. Préparer tout ce qui peut l'être (session ouverte sur l'écran de demande, compte et plateforme identifiés), puis demander à l'humain **l'action minimale exacte** : ouvrir l'appli de `<PLATEFORME>`, valider la notification de confirmation pour `<COMPTE>`.
3. Après sa confirmation, reprendre la session et vérifier qu'elle est débloquée (l'action bloquée — par exemple une publication — doit passer).

### 4. Validation par téléphone / code à usage unique (SMS ou e-mail)

1. Déclencher l'envoi du code **une seule fois**, pour le défi en cours.
2. Récupérer le code par le canal prévu (boîte e-mail ou messages connectés, périmètre limité au message du défi en cours) et le saisir uniquement dans le champ du défi correspondant, sur la bonne origine (adresse HTTPS exacte de `<PLATEFORME>`).
3. Code expiré, ambigu ou introuvable : le signaler, redemander un envoi si l'humain l'approuve — ne pas deviner, ne pas essayer d'anciens codes.

### 5. Code d'authentificateur (TOTP)

1. Le code se génère à la demande, au moment du défi, et se saisit immédiatement (fenêtre de validité courte).
2. Échec : attendre la fenêtre suivante et régénérer ; ne pas enchaîner les codes périmés.

## Quand s'arrêter et demander à l'humain

- Confirmation possible **uniquement** dans son application mobile ou sur son appareil.
- Mot de passe actuel inconnu de l'agent **et** du flux sécurisé.
- Vérification d'identité documentaire (pièce d'identité, selfie) : toujours l'humain, toujours dans l'interface officielle.
- Doute sur l'authenticité d'une demande (e-mail ou page suspecte) : ne rien saisir, vérifier par le site officiel atteint indépendamment, signaler le doute.

## Après la reprise

- Vérifier la session vivante, refaire l'action initialement bloquée **une fois**, noter au registre : date, plateforme, type de vérification, issue.
- Si la même plateforme force des vérifications répétées, le signaler à l'humain avec les faits (dates, fréquence) : c'est un signal de risque sur le compte, pas un problème à « contourner ».

## Contrôles

- [ ] Aucun secret en clair dans les échanges, fichiers ou logs.
- [ ] Chaque code utilisé correspond au défi, au compte et à la session en cours.
- [ ] Aucune réinitialisation ni récupération lancée sans demande explicite.
- [ ] Registre mis à jour (incident + issue + numéros à ne plus utiliser).
