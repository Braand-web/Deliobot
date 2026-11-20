---
name: deploy-to-cloudflare
description: "Deploy a site or a full-stack app to the person's own Cloudflare account with wrangler: Pages for sites (a preview branch first, then production), Workers for server code, D1 for a database with its migrations, secrets and live logs. Use when the person asks for Cloudflare, Workers, Pages or D1, or the project has a wrangler config."
---

# Deploy to Cloudflare

You deploy from the project folder to the person's own Cloudflare account with `wrangler`, Cloudflare's command line.
The account, its limits and its bill are theirs (the free plan covers small apps).

Where to deploy, when the person has not said: static files go to `publish_app` when you have it (included in their
plan); a server side goes to their Cloudflare or Vercel account (the deploy-to-vercel skill); a project that already
has a `wrangler` config, `.vercel-deploy.json` or `.netlify-site.json` keeps going where it went.

## The token, once

Call `request_credential` with label `Cloudflare API token`, delivery `file`, and a reason such as: "To deploy your app
on your Cloudflare account. Create one at https://dash.cloudflare.com/profile/api-tokens with the template Edit
Cloudflare Workers (add D1 Edit and Cloudflare Pages Edit if the app needs them) and paste it here." End your turn; you
resume when they save it. If Cloudflare answers 401 or 403, ask again with `replace: true`.

Only ever pass the file's path. Every command reads the token from it in its own environment, never on the command
line or in your reply:

```sh
CLOUDFLARE_API_TOKEN="$(cat <the token file's path>)" npx --yes wrangler@4.125.0 <command>
```

Below, `wrangler …` means exactly that prefix. Give each call a 5-minute `timeout`. The first `npx` call downloads
wrangler; on a small machine say so first. If the token reaches more than one account, `wrangler whoami` lists them:
ask which one, then add `CLOUDFLARE_ACCOUNT_ID=<id>` to the same environment.

Never write the token into `wrangler.toml`, `wrangler.jsonc`, `.dev.vars` or any file, and never commit it.

## A site: Cloudflare Pages, preview first

```sh
wrangler pages project create <name> --production-branch main     # once
wrangler pages deploy <output folder> --project-name <name> --branch preview
```

The `--branch preview` deploy gets its own link (`https://preview.<name>.pages.dev`) and leaves the live site as it
is. Show it to the person; when they approve, deploy the same folder with `--branch main`: that is production
(`https://<name>.pages.dev`). Functions in a `functions/` folder deploy with it.

## Server code: Workers

A Worker project has a `wrangler.jsonc` (or `wrangler.toml`) with its `name`, `main` and `compatibility_date`. Write it
with the person's app name. Preview before production:

```sh
wrangler versions upload          # a preview: prints a version URL, production untouched
wrangler deploy                   # production, once the person approved the preview
```

`wrangler versions upload` needs `"preview_urls": true` in the config; without it, say that production is the only
place it can run and ask before `wrangler deploy`.

## A database: D1 and its migrations

```sh
wrangler d1 create <name>-db                       # once; put the binding it prints in the config
wrangler d1 migrations create <name>-db <change>   # writes migrations/NNNN_<change>.sql: put the SQL there
wrangler d1 migrations apply <name>-db --local     # try it on the local copy first
wrangler d1 migrations apply <name>-db --remote    # then the real database, before deploying the code that needs it
```

A migration changes real data. Before `--remote`, say what it changes; never drop a table or a column with data in
it unless the person asked for exactly that. If a migration fails, stop: don't deploy the code that needs it, and say
what Cloudflare answered.

## Secrets

Get each value with `request_credential` (delivery `file`, a label naming the variable), then feed the file in, so you
never see the value:

```sh
wrangler secret put <NAME> < <that secret file's path>                               # a Worker
wrangler pages secret put <NAME> --project-name <name> < <that secret file's path>   # a Pages project
```

Never put a secret in `vars`, in the config or in the code.

## When something is wrong in production

```sh
timeout 30 wrangler tail <worker name> --format json --status error
timeout 30 wrangler pages deployment tail --project-name <name> --format json
```

Each listens for 30 seconds and prints the requests that failed with their errors (ask the person to open the page
meanwhile if nothing comes). Read them, fix the cause, check it, and deploy a preview again before production.

## Delete

Only when the person asks for that project by name and confirms its links stop working for everyone:
`wrangler delete <worker name>` or `wrangler pages project delete <name>`. A D1 database is deleted only on its own,
explicit request (`wrangler d1 delete <name>-db`): its data is gone for good.
