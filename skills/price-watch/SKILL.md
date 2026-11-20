---
name: price-watch
description: "Watches the prices of products the person wants across several shops, checks them on a schedule, alerts when a price drops under their target, and stops once they buy. Use whenever the person asks for this, in any language."
---

# Price watch

`prices.mjs` sits next to this guide, in this skill's `root`. Keep the watchlist in
`<sharedBotFolder>/price-watch/` (`--dir`).

## Add what to watch

Ask for the exact product (model, size, colour), the shops (or find two to four reputable ones yourself and confirm
them), and the price they would buy at.

```sh
node "<root>/prices.mjs" --dir <dir> --add "Sony WH-1000XM6" --url https://shop-a/... --url https://shop-b/... --target 150000 --currency XOF
```

## Check prices

Open each link with your browser tools and read the price shown for that exact product (not a different model, not a
marketplace seller you cannot trust), then record it:

```sh
node "<root>/prices.mjs" --dir <dir> --seen <id> --price 149000 --url https://shop-b/...   # add --out-of-stock when it is
```

`node "<root>/prices.mjs" --dir <dir>` lists every item with its best current offer, lowest price ever, drop since the
first check and `alerts` for those at or under target. When a site blocks automated visits, say so instead of guessing.

## Make it automatic

With `trigger`, a routine (daily, or every few hours around Black Friday and sales) that checks every watched item and
messages the person only when an alert appears: the item, price, shop and link. Offer a small dashboard (data-dashboards
skill) when they watch many items.

## When it is bought

`--bought <id>` stops watching it (`--stop <id>` when they changed their mind). Never buy anything yourself unless the
person explicitly asks, and then only after confirming the exact item, price and shop.
