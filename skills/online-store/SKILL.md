---
name: online-store
description: "Build a complete online store from a product list: product pages with photos, search, categories, a cart, and orders by WhatsApp, e-mail or a payment link (Wave, Orange Money, Stripe, PayPal), in any currency (FCFA included). Then publish it at a public link and keep it up to date. Use whenever the person wants to sell online, a shop, a store, a catalogue or an e-commerce site."
---

# Online store

`store.mjs` sits next to this guide, in this skill's `root`. It needs Node 18 or later and nothing installed. It turns a
catalogue (`store.json`) into one fast, mobile-first page with every product, a search box, category filters, a cart
kept in the visitor's browser, and an order button that opens WhatsApp (or an e-mail) with the order already written:
each product, quantity, price and the total. A product with its own payment link (Wave, Orange Money, Stripe, PayPal…)
gets a « Payer » button. No server and no database: orders arrive on the seller's phone.

## Where the store lives

Keep each store in your shared bot folder, `<sharedBotFolder>/stores/<name>/`: the catalogue as `store.json`, the
product photos in `images/`, and the built site in `site/`. Every later change (a new product, a new price, sold out)
is an edit of `store.json` and a rebuild.

## Gather the catalogue

Ask, in one message, for what is missing: the shop's name and one-line tagline, the WhatsApp number that takes orders
(with the country code), the currency, how delivery works and costs, how clients pay, and the products. Products can
come as a list in chat, a photo of a price list, a spreadsheet, or an existing page. Never invent a price, a phone
number or a payment link: ask.

Product photos: use the person's photos when they have them. Otherwise make clean product shots with `generate_image`
(1:1, the product alone on a plain light background, soft studio light, no text), say they are illustrations, and
offer to replace them with real photos.

## The catalogue

```json
{
  "name": "Awa Couture",
  "tagline": "Mode africaine faite main à Dakar",
  "about": "One short paragraph about the shop.",
  "currency": "XOF",
  "language": "fr",
  "accent": "#c2410c",
  "whatsapp": "+221 77 123 45 67",
  "email": "commandes@example.com",
  "delivery": "Livraison à Dakar 2 000 F, 24 h.",
  "payment": "Wave ou Orange Money à la livraison.",
  "logo": "images/logo.png",
  "url": "https://awa-couture-app.deliobot.fun",
  "products": [
    { "name": "Boubou brodé", "price": 45000, "compareAt": 55000, "category": "Femme", "image": "images/boubou.jpg",
      "description": "Bazin riche, broderie main.", "payLink": "https://pay.wave.com/…", "soldOut": false }
  ]
}
```

- At least one of `whatsapp`, `email` or a product `payLink` is required, so the visitor can order.
- `compareAt` shows a crossed-out old price. `soldOut` keeps the product visible but not orderable.
- Image paths are relative to `store.json`. `language` is `fr` or `en`. `accent` is the brand colour.
- `url`, once known, fills the link preview shown when the store is shared on WhatsApp or social networks.

## Build and show it

```sh
node "<root>/store.mjs" --catalog <store>/store.json --out <store>/site
```

It answers with one line of JSON (`index`, `products`, `images`) or lists what is wrong in the catalogue; fix those and
run it again. Open `site/index.html` in the browser, take a phone-sized screenshot, and show it with `attach_file`.
Add one product to the cart and check the order message before publishing.

## Publish it

Only once the person has seen it. Publish the `site` folder with `publish_app` (a preview first, then
`action: "promote"` when they approve), or on their own Netlify, Vercel or Cloudflare account when they prefer. Put the
public link in `url`, rebuild, and publish again so shared links show the shop's preview. Offer a custom domain
(`publish_app` with `action: "domain"`) when they have one.

## Keep it alive

- Price, stock or product changes: edit `store.json`, rebuild, publish again.
- Offer the things a shop needs next, when they fit: product posts for social networks, a short video ad, invoices for
  orders, a reminder routine (`trigger`) to update stock every week.
