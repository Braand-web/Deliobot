# Deliobot public site

The public landing and pricing page. `build-worker.mjs` bundles `public/` into one Worker script, so a deploy uploads only that script.

```sh
cd cloudflare/site
node build-worker.mjs
../control-plane/node_modules/.bin/wrangler deploy
```

Deploying needs `CLOUDFLARE_API_TOKEN` with the "Edit Cloudflare Workers" permission. The site goes live at `https://deliobot.novacore629.workers.dev`.

## Downloads

Installers live in the R2 bucket `deliobot-downloads` and are served under `/download/` and `/vendor/`. A file over
wrangler's 300 MiB upload limit goes up in parts through `/__upload/<key>`, which answers only the Worker secret
`UPLOAD_TOKEN` (`POST ?start`, then `PUT ?id=…&part=N` for each part of at most 100 MB, then `POST ?id=…` with the
parts' list). Without that secret the route answers 404.
