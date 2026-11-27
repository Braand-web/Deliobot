# Exemples de routage — 6 demandes traitées de bout en bout

> Chaque exemple suit la procédure du `PROMPT-ROUTAGE.md` : **classification → route → modèle/niveau → pourquoi**. Les noms de modèles renvoient aux fiches d'exemple du `CATALOGUE-MODELES.md` (« EXEMPLE — à vérifier sur la doc fal.ai ») : remplacez-les par vos modèles réels vérifiés. Ces exemples servent aussi de **tests** : un agent (ou une implémentation) qui route ces 6 demandes autrement doit pouvoir justifier pourquoi.

---

## Exemple 1 — « Fais-moi une vidéo motion design qui présente mon produit, avec le prix affiché »

- **Classification** : vidéo ; intention = **motion design** (présentation produit, texte et prix à afficher exactement) ; contraintes : prix précis à l'écran, probablement logo/couleurs du produit, format réseau social.
- **Route** : **CODE**. Le prix et le nom du produit doivent apparaître sans une seule faute : aucun modèle de génération ne rend un prix de façon fiable. La présentation suit une structure répétable (accroche → bénéfices → prix → appel à l'action) que l'agent fabrique par scènes programmées.
- **Modèle** : aucun modèle vidéo. Éventuellement, en appoint : un modèle **text-to-image niveau équilibré** pour un fond ou une image d'ambiance, et un **TTS niveau équilibré** pour la voix off — le reste (texte, prix, animation, assemblage) est fait en code.
- **Pourquoi** : coût quasi nul par vidéo, texte garanti exact, format reproductible pour les prochains produits. Générer cette vidéo coûterait plus cher, avec un prix probablement illisible ou faux à l'écran.

## Exemple 2 — « Une vidéo d'un lion qui court dans la savane au coucher du soleil »

- **Classification** : vidéo ; intention = **réel/filmé** (animal en mouvement, paysage, lumière naturelle) ; contraintes : aucun texte, pièce unique, réalisme central.
- **Route** : **GÉNÉRATION**. Aucune fabrication en code ne rend un lion qui court de façon crédible.
- **Modèle** : **text-to-video niveau équilibré** (défaut). Passer en **qualité max** seulement si l'utilisateur destine la vidéo à un usage vitrine et accepte le coût ; rester en équilibré pour un usage ordinaire.
- **Pourquoi** : le réalisme et le mouvement organique sont exactement ce que les modèles vidéo font et que le code ne fait pas. Aucun texte n'est demandé, donc la faiblesse majeure des modèles ne joue pas. Prompt du modèle : décrire le lion, la savane, la lumière du couchant, un mouvement de caméra de suivi — sans aucun texte.

## Exemple 3 — « Anime ce portrait pour qu'il sourie »

- **Classification** : vidéo courte à partir d'un média fourni ; intention = **animer un existant** ; contraintes : conserver l'identité du portrait, mouvement facial léger (sourire).
- **Route** : **GÉNÉRATION (image-to-video)**. Un sourire est un micro-mouvement organique du visage : le code peut zoomer ou déplacer l'image, pas faire naître un sourire crédible.
- **Modèle** : **image-to-video niveau équilibré**, prompt de mouvement minimal (« léger sourire, mouvement subtil, caméra fixe ») pour limiter les déformations.
- **Pourquoi** : la demande porte sur le visage, pas sur un déplacement d'image. **Repli prévu** : si le modèle déforme le visage après 2 essais, proposer l'alternative en code (léger zoom + fondu) en expliquant la limite, plutôt que de brûler des crédits.

## Exemple 4 — « Une voix off féminine pour lire ce texte »

- **Classification** : voix (parole) ; intention = **asset seul** (une narration à produire à partir d'un texte fourni) ; contraintes : voix féminine, langue = celle du texte.
- **Route** : **GÉNÉRATION (TTS)**. Pas de vidéo à fabriquer à ce stade ; la voix est l'ingrédient demandé.
- **Modèle** : **TTS-voix niveau équilibré**, voix féminine de la bonne langue. Avant l'appel : vérifier le texte (ponctuation = prosodie), signaler les noms propres à risque de mauvaise prononciation.
- **Pourquoi** : demande simple et univoque ; le niveau équilibré suffit pour une voix off propre. Coût faible et prévisible (unité : les caractères). Si l'agent dispose d'une synthèse vocale locale de qualité équivalente, elle est un repli légitime à coût nul.

## Exemple 5 — « Il me faut 30 vidéos courtes par jour pour une chaîne »

- **Classification** : vidéo courte en **série quotidienne** (30/jour) ; intention : à confirmer selon le contenu, mais le volume est la contrainte dominante.
- **Route** : **CODE** (ou HYBRIDE avec ingrédients générés en masse). À 30 vidéos par jour, la génération vidéo par modèle coûterait une fortune et serait ingérable en délais ; un format fabriqué en code, décliné automatiquement avec des contenus variables, coûte presque zéro par unité et sort à heure fixe.
- **Modèle** : aucun modèle vidéo. En appoint HYBRIDE éventuel : **text-to-image niveau éco/équilibré** pour produire les ingrédients visuels variables (fonds, portraits) une fois, réutilisés par le moteur de fabrication.
- **Pourquoi** : c'est le critère « série + reproductibilité + coût » de l'étape 2, dans sa forme extrême. **Ambiguïté à lever** : si l'utilisateur exigeait du réaliste filmé pour les 30 vidéos quotidiennes, le signaler immédiatement : le budget exploserait — proposer le plafond chiffré avant de lancer quoi que ce soit (c'est le cas « erreur coûteuse » de l'étape 5 : une question, chiffres à l'appui).

## Exemple 6 — « Une belle image de couverture avec le titre en gros »

- **Classification** : image ; intention = **asset de couverture** ; contraintes : un **titre précis en gros caractères** EST le message de l'image.
- **Route** : **HYBRIDE**. Générer l'image de fond (sans texte), puis composer le titre en code par-dessus (typographie nette, taille et contraste contrôlés).
- **Modèle** : **text-to-image niveau équilibré** pour le fond/portrait, avec un prompt qui réserve un espace dégagé pour le titre (« composition avec zone sombre unie en haut »). Le titre n'apparaît PAS dans le prompt du modèle.
- **Pourquoi** : confié à un modèle, le titre ressortirait avec des fautes ou des lettres déformées — rédhibitoire pour une couverture. Le code garantit un titre exact, lisible en miniature, et permet de produire des variantes (autre titre, autre fond) à coût faible.

---

## Récapitulatif

| # | Demande (résumé) | Route | Modèle / niveau |
|---|---|---|---|
| 1 | Motion design produit + prix affiché | CODE | (appoint : image + TTS équilibrés) |
| 2 | Lion dans la savane, réaliste | GÉNÉRATION | text-to-video équilibré |
| 3 | Animer un portrait, sourire | GÉNÉRATION | image-to-video équilibré |
| 4 | Voix off féminine d'un texte | GÉNÉRATION | TTS équilibré |
| 5 | 30 vidéos courtes par jour | CODE / HYBRIDE | (appoint : image éco/équilibré) |
| 6 | Couverture avec titre en gros | HYBRIDE | text-to-image équilibré + titre en code |
