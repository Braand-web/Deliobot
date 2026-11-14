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
