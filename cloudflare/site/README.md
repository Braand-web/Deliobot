# Deliobot public site

The public landing and pricing page, served as static assets by a Cloudflare Worker.

```sh
cd cloudflare/site
../control-plane/node_modules/.bin/wrangler deploy
```

Deploying needs `CLOUDFLARE_API_TOKEN` with the "Edit Cloudflare Workers" permission. The site goes live at `https://deliobot.<account-subdomain>.workers.dev`.
