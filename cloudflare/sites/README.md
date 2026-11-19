# Sites Worker

Serves the static apps bots publish through Deliobot's included hosting. The
portal (`apps/admin/src/app-hosting.ts`) writes each app to the
`deliobot-sites` R2 bucket; this Worker serves it at
`https://<label>-app.deliobot.fun/`.

The names stay one level under the zone so Cloudflare's free certificate for
`*.deliobot.fun` covers them. DNS: a proxied `*` record (`AAAA 100::`) in the
`deliobot.fun` zone; named records such as `compte` and `www` keep their own
targets.

```bash
CLOUDFLARE_API_TOKEN=… ../control-plane/node_modules/.bin/wrangler deploy
```

## Custom domains (Cloudflare for SaaS)

A person can point their own domain at an app (`publish_app` action `domain`).
The portal creates a custom hostname on the `deliobot.fun` zone and writes
`domains/<hostname>.json` in the bucket; this Worker serves that hostname as
the app it names. It stays off until these are done once:

1. In the `deliobot.fun` zone: SSL/TLS → Custom Hostnames → enable Cloudflare
   for SaaS (the first 100 hostnames are free).
2. Fallback origin: `domains.deliobot.fun` (the proxied `*` record already
   covers it).
3. A Worker route `*/*` on the zone for `deliobot-sites`, so custom hostnames
   reach this Worker. Hostnames with their own route or custom domain
   (`compte`, `admin`, `www`, the apex) keep theirs.
4. An API token with Zone → SSL and Certificates → Edit on `deliobot.fun`,
   saved as the portal's `DELIO_SAAS_TOKEN` secret.
