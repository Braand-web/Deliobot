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

Every validated release must update the landing's download buttons. Publish the
versioned artifacts and stable objects, verify the versioned files' public digests,
then publish the matching update feed and verify the stable links it selects.
Windows uses `download/Deliobot-Setup.exe`,
`download/Deliobot-Windows.zip`, and `download/latest/latest.yml`; Linux keeps
its latest validated build until a newer Linux build is available. Never put
another platform's version number on an older binary.

Stable links resolve each platform's versioned artifacts from its update feed,
and both links and feeds revalidate their cache. The landing reads each platform's
feed and adds its version to download URLs so an older browser cache cannot
keep returning the previous installer.
