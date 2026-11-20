---
name: deploy-to-vercel
description: "Deploy a web app or site to the person's own Vercel account: a preview link first, then production when they approve, with its secret settings, build and server logs. Use when the person asks for Vercel, or for a framework app with a server side (Next.js, Nuxt, SvelteKit, Remix, Astro with SSR, API routes) that included hosting can't run."
---

# Deploy to Vercel

You deploy from the project folder to the person's own Vercel account. Vercel builds the app on its side (Next.js,
Nuxt, SvelteKit, Remix, Astro, Vite and plain sites are detected), so server code and API routes work. The account,
its limits and its bill are theirs.

## Where to deploy

Before a first deploy, say where it will go and why, in one line, and let the person choose when there is a choice:

| The app | Where |
|---|---|
| Static files only (HTML, a Vite or Astro build without a server) | `publish_app` when you have it: included in their plan, nothing to set up. |
| A server side, API routes, SSR, or the person asked for Vercel | Vercel, as below. |
| The person asked for Netlify, or the project already has `.netlify-site.json` | The publish-to-netlify skill. |
| The person asked for Cloudflare, or the project already has a `wrangler` config | The deploy-to-cloudflare skill. |

A project already deployed somewhere keeps going there: look for `.vercel-deploy.json`, `.netlify-site.json` or a
`wrangler` config before you choose.

## The token, once

Call `request_credential` with label `Vercel token`, delivery `file`, and a reason such as: "To deploy your app on your
Vercel account. Create one at https://vercel.com/account/settings/tokens (Create Token, scope: your account or team,
any expiry) and paste it here." End your turn; you resume when they save it. Later, ask again with the same label: the
saved token comes back with no card. If Vercel answers 401 or 403, ask again with `replace: true`.

You get the path of a private file. Only ever pass that path. Never print the token, put it in a command's text, write
it into the project, or commit it.

## Deploy: preview first

`deploy.mjs` sits next to this guide, in this skill's `root`. It needs Node 18 or later and nothing installed. From the
project folder (give the call an 8-minute `timeout`):

```sh
node "<root>/deploy.mjs" --dir . --token-file <the token file's path> --title "<what it is>" --bot-name "<your name>"
```

- `--dir` is what Vercel receives: the project's source (Vercel builds it), or a built folder for a static site. It
  never sends `node_modules`, `.git`, dotfiles, env files, keys or links, and stops if a file contains the token.
- Without `--prod` it makes a **preview**: its own link, the live site untouched. Show the preview to the person.
- When they approve, run the same command with `--prod`: the production link (`url`) is updated.
- The first run creates the project (`--name` picks its name, else the folder's) and writes `.vercel-deploy.json` in
  the project folder; keep it, so later runs update the same project. `--team <team id>` deploys to a team.

It prints one line of JSON:

- `"live": true`: reply with `url`, what changed in a line or two, and whether it is the preview or production.
- `"pending": true`: still building. Run `node "<root>/deploy.mjs" --check --token-file <path>` once, a minute later.
- `"ok": false`: the build failed or Vercel refused. Read why with `--logs`, fix the cause, deploy again. Don't retry
  the same thing more than once.

## Secret settings

Keys the app needs at run time (a database URL, an API key) go in Vercel's environment, never in the files. Get each
value with `request_credential` (delivery `file`, a label naming the variable), then:

```sh
node "<root>/deploy.mjs" --env DATABASE_URL --value-file <that secret file's path> --token-file <token path>
```

It is saved encrypted for production and previews, and applies from the next deploy. You never see the value.

## When something is wrong in production

```sh
node "<root>/deploy.mjs" --logs --token-file <path>
```

It returns the last deployment's build log (`build`) and the last minutes of server logs (`runtime`, with `errors`
counting failed requests). Read them, find the cause in the code, fix it, check it, and deploy a preview again before
production.

## Delete

Only when the person asks for that project by name and confirms that its links stop working for everyone:
`node "<root>/deploy.mjs" --delete --token-file <path>` removes the Vercel project and `.vercel-deploy.json`. Your
files stay.
