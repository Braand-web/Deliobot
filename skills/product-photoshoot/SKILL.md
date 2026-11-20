---
name: product-photoshoot
description: "Brand-quality product pictures without a photographer: studio packshots, lifestyle scenes, hands and models using the product, Pinterest pins, banners, carousels, ad packs, surreal CGI shots and seasonal restyles. Use whenever the person asks for this, in any language."
---

# Product photoshoot

Turn a product into pictures that sell. With a photo of the real product, keep the product exact and change everything
around it; without one, describe it precisely and say the pictures are illustrations.

## Pick the mode

| Mode | When the person wants… | Shape |
|---|---|---|
| packshot | the product alone on white, neutral or studio background (catalogue, Shopify, marketplace) | 1:1 |
| lifestyle | the product in a real place, in use, with atmosphere (kitchen, café, gym, street) | 1:1 or 9:16 |
| hands and close-up | hands holding or applying it, partial face, a demonstration | 1:1 |
| pin | a vertical, airy, mood-board picture for Pinterest | 9:16 |
| banner | a wide header for a website, an e-mail or a campaign, with calm space for text | 16:9 |
| carousel | 3 to 10 slides of one visual system for Instagram, LinkedIn or Facebook | 1:1 |
| ad pack | several static ad variants for Meta, TikTok, Pinterest or Google, one idea each | 1:1 and 9:16 |
| on a model | worn or used by a person: fashion, accessories, beauty | 9:16 |
| conceptual | levitating, splash, frozen motion, sculptural, surreal CGI | 1:1 |
| restyle | the same picture in another season, mood or aesthetic | as the source |

When two fit, the more specific wins: "a Pinterest pin of my product in a kitchen" is a pin; "a carousel of my product in
different scenes" is a carousel.

## Ask at most four short questions

Only what the request leaves open, each with choices: how many (1, 3 or 5), which style (clean studio, lifestyle,
conceptual, with a model), where they will be used (shop, Instagram, Pinterest, ads, website), brand colours. With no
product photo, ask for one first: the result is far more faithful.

## Make them

- **With the person's photo:** `edit_image` on that file. The prompt names what stays and what changes: "Keep the bottle,
  its label and its exact colours unchanged. Place it on a sunlit marble kitchen counter beside fresh lemons, soft morning
  window light from the left, shallow depth of field, premium lifestyle photograph." Repeat on the same source file for
  each variant, never on a previous result, so the product does not drift.
- **Without a photo:** `generate_image` with a full description: the product (shape, material, colour, label, size), the
  setting, the light, the lens and the finish.
- Write prompts in English, concrete and visual: subject, surface, props, light (direction, softness, time of day),
  camera (85 mm, macro, top-down, three-quarter), depth of field, colour palette, finish (editorial, catalogue, glossy
  ad). Phrase positively: "tack sharp" rather than "no blur".
- Variants differ for real: change the setting, angle, light and palette between them, not just the words.
- Carousel and ad pack: fix one visual system first (palette, light, background family, type of props) and keep it on
  every slide; one message per slide.
- Restyle: `edit_image` on the source with only the change: "same composition and product, winter holiday mood, warm
  fairy lights, pine branches, soft snow outside the window".
- Banners and ads: leave clean space where text will go, and add the text afterwards in HTML or an image editor rather
  than asking the model to write it, unless the person wants it in the picture.

Every image and video tool answers with the path of a saved copy: keep it, show the result with `attach_file` when
it is not already attached, and reuse the file for the next edit.

## Never

Invent a label, a certification, an award or a claim the product does not have; show a real person or a brand the
person does not own; change the product itself in a lifestyle or restyle picture.
