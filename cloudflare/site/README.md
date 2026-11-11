# Deliobot public site

The public landing and pricing page. `build-worker.mjs` bundles `public/` into one Worker script, so a deploy uploads only that script.

```sh
cd cloudflare/site
node build-worker.mjs
../control-plane/node_modules/.bin/wrangler deploy
```

Deploying needs `CLOUDFLARE_API_TOKEN` with the "Edit Cloudflare Workers" permission. The site goes live at `https://deliobot.novacore629.workers.dev`.
