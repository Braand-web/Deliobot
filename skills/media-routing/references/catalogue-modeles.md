# Catalogue de modèles fal.ai — structure à maintenir

> **Avertissement permanent.** Les identifiants de modèles, leurs capacités et leurs prix sur fal.ai **changent régulièrement**. Ce fichier fournit la **structure** du catalogue et **une fiche d'exemple par catégorie**. Chaque fiche d'exemple est marquée « EXEMPLE — à vérifier » : les noms de modèles et les ordres de grandeur de coût y sont **illustratifs**, à confirmer sur la documentation officielle fal.ai avant tout usage. Ne copiez jamais une fiche d'exemple dans un système en production sans l'avoir vérifiée et datée.

## La fiche modèle (structure obligatoire)

Chaque modèle utilisé par l'agent doit avoir une fiche complète. Un modèle sans fiche ne doit pas être appelé.

```markdown
### <identifiant-exact-du-modele-sur-fal.ai>
- **Catégorie** : text-to-video | image-to-video | text-to-image | retouche image | TTS-voix | musique-effets
- **Niveau** : éco | équilibré | qualité max
- **Forces** : ce qu'il fait mieux que les autres (réalisme, vitesse, style, langues…)
- **Limites connues** : durées max, formats supportés, faiblesses (mains, foules, texte…)
- **Rend le texte ?** : oui proprement | approximatif | non — ne jamais lui confier de texte précis
- **Unité de prix** : par seconde de vidéo | par image | par 1 000 caractères | par génération…
- **Ordre de grandeur de coût** : <valeur indicative> — vérifié le <date> sur <source>
- **Vitesse habituelle** : rapide | moyenne | lente (ordre de grandeur)
- **Quand l'utiliser** : le cas d'usage où il est le meilleur choix
- **Quand l'éviter** : les demandes où il déçoit ou coûte trop
- **Modèle de repli** : <identifiant du modèle de remplacement en cas d'échec>
- **Dernière vérification** : <date> — par <qui>
```

## Fiches d'exemple (une par catégorie)

### Catégorie text-to-video

### EXEMPLE — « modele-video-realiste-premium » — à vérifier sur la doc fal.ai
- **Catégorie** : text-to-video
- **Niveau** : qualité max
- **Forces** : réalisme élevé, mouvements de caméra crédibles, bonne cohérence des personnages sur quelques secondes.
- **Limites connues** : coût élevé, génération lente, durées courtes par appel, texte à l'écran illisible.
- **Rend le texte ?** : non — ne jamais lui confier de texte précis.
- **Unité de prix** : par seconde de vidéo.
- **Ordre de grandeur de coût** : élevé (plusieurs dizaines de centimes par seconde) — EXEMPLE, à vérifier.
- **Vitesse habituelle** : lente.
- **Quand l'utiliser** : pièce unique importante où le réalisme est le critère n° 1.
- **Quand l'éviter** : séries, brouillons, budgets serrés, tout contenu avec texte.
- **Modèle de repli** : le modèle text-to-video de niveau équilibré du catalogue.
- **Dernière vérification** : EXEMPLE — à compléter.

### EXEMPLE — « modele-video-rapide-eco » — à vérifier sur la doc fal.ai
- **Catégorie** : text-to-video
- **Niveau** : éco
- **Forces** : rapide et bon marché, correct pour des plans simples et des aperçus.
- **Limites connues** : réalisme moyen, artefacts sur les mouvements complexes, texte illisible.
- **Rend le texte ?** : non.
- **Unité de prix** : par seconde de vidéo.
- **Ordre de grandeur de coût** : faible — EXEMPLE, à vérifier.
- **Vitesse habituelle** : rapide.
- **Quand l'utiliser** : brouillons, tests de concept, arrière-plans simples, quantité.
- **Quand l'éviter** : livrable final exposé, visages en gros plan.
- **Modèle de repli** : le modèle text-to-video de niveau équilibré du catalogue.
- **Dernière vérification** : EXEMPLE — à compléter.

### Catégorie image-to-video

### EXEMPLE — « modele-anime-image » — à vérifier sur la doc fal.ai
- **Catégorie** : image-to-video
- **Niveau** : équilibré
- **Forces** : anime une image fournie (zoom, mouvement de caméra, micro-mouvements du sujet) en gardant son style.
- **Limites connues** : déformations si le mouvement demandé est ample ; le sujet peut « fondre » sur les longues durées.
- **Rend le texte ?** : sans objet — le texte éventuel vient de l'image source (à préparer en code avant).
- **Unité de prix** : par seconde de vidéo produite.
- **Ordre de grandeur de coût** : moyen — EXEMPLE, à vérifier.
- **Vitesse habituelle** : moyenne.
- **Quand l'utiliser** : animer un portrait, une couverture, une photo produit fournis par l'utilisateur.
- **Quand l'éviter** : actions complexes (courir, parler longtemps), transformations de scène.
- **Modèle de repli** : animation en code (zoom/panoramique programmé) si le mouvement simple suffit.
- **Dernière vérification** : EXEMPLE — à compléter.

### Catégorie text-to-image

### EXEMPLE — « modele-image-qualite » — à vérifier sur la doc fal.ai
- **Catégorie** : text-to-image
- **Niveau** : équilibré
- **Forces** : images détaillées, bons portraits et fonds, styles variés.
- **Limites connues** : texte dans l'image souvent fautif ; mains et petits objets imparfaits.
- **Rend le texte ?** : approximatif — courts mots parfois, jamais un titre précis à confier tel quel.
- **Unité de prix** : par image.
- **Ordre de grandeur de coût** : faible à moyen — EXEMPLE, à vérifier.
- **Vitesse habituelle** : rapide.
- **Quand l'utiliser** : portraits, fonds, illustrations, couvertures (sans le texte, ajouté ensuite en code).
- **Quand l'éviter** : affiches dont le texte EST le message (générer le fond, composer le texte en code).
- **Modèle de repli** : le modèle text-to-image éco du catalogue.
- **Dernière vérification** : EXEMPLE — à compléter.

### Catégorie retouche / édition d'image

### EXEMPLE — « modele-retouche-image » — à vérifier sur la doc fal.ai
- **Catégorie** : retouche image
- **Niveau** : équilibré
- **Forces** : modifications localisées d'une image existante (remplacer un fond, retirer/ajouter un élément) à partir d'une instruction.
- **Limites connues** : peut altérer des zones non visées ; résultat variable selon la complexité de l'instruction.
- **Rend le texte ?** : approximatif — ne pas lui confier la correction d'un texte précis.
- **Unité de prix** : par image traitée.
- **Ordre de grandeur de coût** : faible à moyen — EXEMPLE, à vérifier.
- **Vitesse habituelle** : rapide.
- **Quand l'utiliser** : adapter une image existante plutôt que régénérer de zéro.
- **Quand l'éviter** : retouches pixel-près (détourage net, texte) — préférer le code.
- **Modèle de repli** : régénération complète via le modèle text-to-image du catalogue.
- **Dernière vérification** : EXEMPLE — à compléter.

### Catégorie TTS / voix

### EXEMPLE — « modele-voix-multilingue » — à vérifier sur la doc fal.ai
- **Catégorie** : TTS-voix
- **Niveau** : équilibré
- **Forces** : voix naturelles en plusieurs langues, choix de voix féminines/masculines, bon rendu des textes longs.
- **Limites connues** : prononciation parfois fautive sur les noms propres et les nombres ; émotions limitées.
- **Rend le texte ?** : sans objet (il le LIT) — vérifier l'orthographe et la ponctuation du texte source, elles commandent la prosodie.
- **Unité de prix** : par 1 000 caractères (ou par minute, selon le modèle).
- **Ordre de grandeur de coût** : faible — EXEMPLE, à vérifier.
- **Vitesse habituelle** : rapide.
- **Quand l'utiliser** : voix off de vidéos, narration, messages vocaux.
- **Quand l'éviter** : textes bourrés de noms propres non vérifiés ; considérer alors une voix produite localement si l'agent en dispose.
- **Modèle de repli** : le second modèle TTS du catalogue, ou la synthèse vocale locale de l'agent.
- **Dernière vérification** : EXEMPLE — à compléter.

### Catégorie musique / effets

### EXEMPLE — « modele-musique-ambiance » — à vérifier sur la doc fal.ai
- **Catégorie** : musique-effets
- **Niveau** : éco
- **Forces** : boucles d'ambiance et fonds sonores générés sur description (style, humeur, durée).
- **Limites connues** : structure musicale simple ; droits et conditions d'usage à vérifier selon le modèle et votre offre.
- **Rend le texte ?** : sans objet.
- **Unité de prix** : par génération ou par minute produite.
- **Ordre de grandeur de coût** : faible — EXEMPLE, à vérifier.
- **Vitesse habituelle** : moyenne.
- **Quand l'utiliser** : fond sonore original pour une vidéo, ambiance d'attente, jingle simple.
- **Quand l'éviter** : quand une bibliothèque de musiques libres déjà disponible suffit — générer coûte plus cher que réutiliser.
- **Modèle de repli** : bibliothèque sonore existante du projet.
- **Dernière vérification** : EXEMPLE — à compléter.

## Tableau de synthèse (à remplir avec VOS modèles vérifiés)

| Catégorie | Éco | Équilibré (défaut) | Qualité max |
|---|---|---|---|
| text-to-video | | | |
| image-to-video | | | |
| text-to-image | | | |
| retouche image | | | |
| TTS-voix | | | |
| musique-effets | | | |

## Procédure de mise à jour du catalogue

1. **Quand** : à chaque nouvel usage d'une catégorie, après tout échec répété d'un modèle, et au minimum une fois par mois.
2. **Vérifier** sur la documentation officielle fal.ai : identifiant exact, capacités, limites, unité de prix et prix actuel de chaque modèle utilisé.
3. **Mettre à jour** la fiche : corriger, dater (« Dernière vérification »), et noter le changement en bas de ce fichier (journal des modifications).
4. **Tester** chaque modèle modifié ou nouveau sur une petite demande réelle avant de le déclarer « équilibré » ou « qualité max ».
5. **Retirer** les modèles dépréciés ou devenus trop chers ; mettre à jour les champs « Modèle de repli » qui pointaient vers eux.
6. **Relire le journal de routage** de l'agent : un modèle souvent contourné ou souvent en échec doit être rétrogradé ou remplacé dans le tableau de synthèse.

### Journal des modifications du catalogue
- <date> — création du catalogue à partir des structures d'exemple du pack ; fiches réelles à vérifier et compléter avant production.
