---
name: marketplace-listing-images
description: "Listing image sets for Amazon, Jumia, Etsy, Shopify or any marketplace: a compliant main image, infographic, angles, details, lifestyle, what's in the box, and A+ style modules. Use whenever the person asks for this, in any language."
---

# Marketplace listing images

A full set of pictures for a product page, built from a photo of the real product.

## The set

| Picture | What it shows | Rules |
|---|---|---|
| main | the product alone, filling about 85% of the frame | pure white background (#FFFFFF), no text, no logo added, no props that are not sold, 1:1 |
| infographic | 3 to 5 benefits with icons or callouts around the product | true claims only, large readable text |
| angles | front, back, side, top, in one picture or several | same light on each |
| detail | the material, texture, stitching, ingredient or mechanism up close | macro, sharp |
| lifestyle | the product in use by the right customer, in the right place | the product stays recognisable |
| in the box | everything delivered, laid out flat | only what is really included |
| size | the product next to a familiar object or a hand, with dimensions | real dimensions only |

A+ modules (wide 16:9 or 970×600 style banners): hero, the problem it solves, features, ingredients or materials, how to
use it in steps, results, comparison with the person's other products.

Each marketplace has its own rules (sizes, background, text on the main image): check the person's marketplace and say
which rules you followed.

## Make it

1. Ask which marketplace, the category, the product's key facts (benefits, materials, dimensions, contents) and brand
   colours, in one message. Facts come from the person; never invent a claim, a certification or a number.
2. Product pictures: `edit_image` on the person's photo, keeping the product exact ("Keep the product and its label
   unchanged; place it on a pure white seamless background, soft even studio light, centred, filling 85% of the frame").
   Without a photo, `generate_image` and say they are illustrations.
3. Text layers (infographic, size, A+): lay the text over the picture in an HTML page you write (the brand fonts, large
   sizes, high contrast), then screenshot it with headless Chrome at the marketplace's size. Text written this way is
   exact; text written by an image model often is not.
4. Keep the set in `<sharedBotFolder>/listings/<product>/`, named in order (01-main.png, 02-infographic.png…).

Every image and video tool answers with the path of a saved copy: keep it, show the result with `attach_file` when
it is not already attached, and reuse the file for the next edit.
