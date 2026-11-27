---
name: media-routing
description: "Décider comment produire chaque image, vidéo, musique ou voix au meilleur rapport qualité-prix : fabriquer en code (motion design, texte exact, séries), générer avec un modèle (réalisme), ou mélanger les deux ; choisir le modèle, plafonner le coût, prévoir un repli et tenir un journal. À utiliser avant toute demande de média, surtout une vidéo."
---

# Routage médias

## Dans Delio

- Route GÉNÉRATION : `generate_image`, `edit_image`, `generate_video`, `generate_music` (musique, effets, voix). Laisse `model` vide pour qu'Auto choisisse, ou nomme le modèle retenu (ex. « GPT Image 2 », « Nano Banana Pro », « FLUX.2 [pro] »). Ces outils sont payés en crédits Delio, sans clé de la personne.
- Route CODE : fabrique la vidéo toi-même avec les compétences de motion design (`hyperframes`, `motion-design-ad`, `video-montage`) : texte, prix, logo et sous-titres exacts.
- Route HYBRIDE : génère les ingrédients (portrait, fond, voix), puis anime et assemble en code.
- Plafonds : demande-les une fois à la personne (image, vidéo, audio, en crédits) et garde-les en mémoire ; sans plafond donné, reste au niveau « équilibré » et annonce le coût avant une vidéo longue ou une série.
- Catalogue : `references/catalogue-modeles.md` donne la structure des fiches ; les modèles réellement proposés sont ceux des outils ci-dessus. Exemples de décisions : `references/exemples.md`.
- Journal : `<sharedBotFolder>/medias/journal-routage.md`.

Tu sais générer des médias via fal.ai (vidéo, image, son, voix) et, si ton environnement le permet, fabriquer des vidéos en code. Ton travail n'est pas seulement de générer : c'est de **décider** comment produire chaque demande, au meilleur rapport qualité-coût. Tu suis la procédure ci-dessous pour TOUTE demande de média, sans exception.

## Étape 1 — CLASSIFIER la demande

Avant tout appel, détermine :

**a) Le type de média** : image, vidéo, son (musique/effets), voix (parole).

**b) L'intention de production** — c'est la distinction la plus importante :

- **Motion design** : graphisme animé — texte, chiffres, prix, logo, formes, icônes, schémas qui bougent. Mots-signaux : « motion design », « présente mon produit », « avec le prix affiché », « explique », « tutoriel », « statistiques », « réseaux sociaux » au format répétitif.
- **Réel / filmé** : une scène qui pourrait être tournée avec une caméra. Mots-signaux : noms d'êtres vivants en action, paysages, « réaliste », « comme un film », « drone », « au coucher du soleil ».
- **Animer un existant** : l'utilisateur fournit une image (ou un média) et veut la faire bouger ou la transformer.
- **Asset seul** : un ingrédient (un portrait, un fond, une voix off, une musique) destiné à être utilisé dans une production plus large.

**c) Les contraintes**, extraites de la demande ou déduites prudemment :

- Du **texte doit-il apparaître** à l'écran ou dans l'image ? Lequel, exactement ?
- Un **logo**, une marque, des couleurs imposées ?
- **Durée** visée, **format** (vertical 9:16, horizontal 16:9, carré), **résolution** attendue.
- **Langue** et type de voix (pour la parole).
- **Budget** ou plafond mentionné ; **délai** (urgent ou non).
- **Quantité** : pièce unique ou série (combien par jour/semaine) ?

Si une contrainte déterminante est absente, applique les défauts de l'étape 3 — ne bloque pas la demande pour des détails (voir étape 5 pour les vraies ambiguïtés).

## Étape 2 — CHOISIR LA ROUTE

Trois routes possibles. Tranche avec ces critères, dans cet ordre :

**Route CODE (tu fabriques)** si UN de ces critères est rempli :
- du texte, des chiffres, un prix, un logo ou des sous-titres doivent apparaître **exactement** ;
- la production doit être **reproductible** ou déclinée en série (même format, contenu variable) ;
- le coût doit être minimal ou le volume élevé ;
- chaque élément doit être contrôlé au pixel et à la seconde près.
Tu construis alors les scènes par programme, tu rends, tu ajoutes la voix et tu assembles. Aucun modèle de génération vidéo.

**Route GÉNÉRATION (tu appelles un modèle)** si :
- le réalisme ou le mouvement organique est le cœur de la demande (êtres vivants, nature, plans filmés) ;
- c'est une pièce unique où le contrôle exact n'est pas requis ;
- aucun texte précis ne doit être rendu PAR le modèle.

**Route HYBRIDE** si :
- la demande mélange les deux : des ingrédients qui gagnent à être générés (portrait, fond, texture, voix) ET une animation, un texte ou un assemblage qui exigent le contrôle du code.
Tu génères les ingrédients, puis tu animes et assembles en code.

Règle absolue : **un modèle de génération ne doit jamais être chargé de rendre du texte précis** (titre, prix, nom, chiffres). Si du texte doit figurer dans une image ou une vidéo générée, génère SANS le texte et ajoute le texte en code par-dessus.

## Étape 3 — CHOISIR LE MODÈLE (routes GÉNÉRATION et HYBRIDE)

Dans le catalogue (`references/catalogue-modeles.md`) :

1. Sélectionne la **catégorie** qui correspond : text-to-video, image-to-video, text-to-image, retouche/édition d'image, TTS/voix, musique/effets.
2. Élimine tout modèle dont une **limite connue contredit la demande** (durée max trop courte, pas de format vertical, texte mal rendu alors que l'image doit en porter en natif, langue de voix non supportée, etc.).
3. Choisis le **niveau** :
   - **Équilibré (défaut)** : le bon rapport qualité-coût de la catégorie. C'est ton choix sauf raison contraire.
   - **Éco** : brouillon, aperçu, test, ou quantité élevée où le coût unitaire domine.
   - **Qualité max** : seulement si la demande le justifie explicitement (livrable final important, exigence de réalisme élevée, utilisateur qui demande « le meilleur »). Jamais par défaut.
4. Vérifie le **plafond de coût** : estime le coût de l'appel (unité de prix × quantité : secondes, images, caractères…). S'il dépasse le plafond du type de média — `plafond image`, `plafond vidéo`, `plafond audio` (valeurs fixées par la personne) — descends d'un niveau ou change de modèle. Ne dépasse jamais un plafond sans l'accord de l'utilisateur.
5. Prépare le prompt du modèle : décris la scène, le style, le format ; pour une vidéo réaliste, précise le mouvement de caméra et la durée ; **exclus le texte** des prompts de génération (voir étape 2).

## Étape 4 — REPLIS

- Si le modèle choisi **échoue** (erreur, timeout, file d'attente excessive) : bascule sur le **modèle de repli** indiqué dans sa fiche catalogue, même catégorie, niveau égal ou inférieur.
- Si le résultat est **hors plafond** ou manifestement raté (déformé, hors sujet) : un nouvel essai maximum avec le modèle de repli, prompt corrigé.
- Après **2 échecs** au total : change de route si c'est possible (par exemple GÉNÉRATION → HYBRIDE ou CODE), sinon **arrête et demande à l'utilisateur** en expliquant ce qui a échoué et ce que tu proposes. Ne brûle jamais de crédits en boucle.

## Étape 5 — AMBIGUÏTÉ

- Si la demande est ambiguë **et** que l'erreur coûterait cher (génération longue, niveau qualité max, grosse quantité) : pose **UNE** question courte qui tranche l'essentiel (par exemple : « Tu la veux en motion design avec ton texte, ou en vidéo réaliste générée ? »). Une seule question, pas un questionnaire.
- Dans tous les autres cas : **décide avec les défauts** (route selon l'étape 2, niveau équilibré) et dis en une phrase ce que tu as choisi et pourquoi. L'utilisateur peut toujours corriger.

## Étape 6 — JOURNALISER

Pour chaque demande, ajoute une ligne au journal de routage (`<sharedBotFolder>/medias/journal-routage.md`) :

`date | demande (résumé) | type + intention classifiés | route | modèle + niveau (ou « code ») | coût estimé | coût réel | résultat (ok / repli / échec / question posée)`

Ce journal sert à améliorer les règles : relis-le périodiquement, repère les replis fréquents et les dépassements, et propose d'ajuster les défauts et le catalogue. Un choix non journalisé est un choix perdu.

## Interdits permanents

- Ne présente jamais un prix ou une disponibilité de modèle comme garanti : les identifiants et tarifs fal.ai changent ; en cas de doute, vérifie la documentation officielle ou dis que le catalogue doit être mis à jour.
- N'utilise jamais un modèle absent du catalogue sans l'y ajouter d'abord (fiche minimale : forces, limites, niveau, repli).
- Ne lance jamais une génération de niveau qualité max ou une grosse quantité sans avoir vérifié le plafond correspondant.
