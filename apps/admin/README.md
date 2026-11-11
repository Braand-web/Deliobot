# Delio Admin

Delio Admin is the account portal for hosted Deliobot workspaces. It handles:

- **Accounts.** People sign in with an 8-digit code sent by email. Codes are stored only as HMACs. Each code allows five tries and lasts ten minutes. Sending is rate-limited per address and per IP.
- **Workspaces.** Each workspace has a slug, a name and its own HTTPS address. Only the operators listed in `DELIO_ADMIN_OPERATORS` can create one.
- **Members and roles.**
  - Roles are `admin` and `member`.
  - Invitations go out by email and expire after seven days. Only the invited address can accept one.
  - Admins can change roles and remove people.
  - A workspace always keeps at least one admin.
  - Every change is recorded in an audit log.
- **Workspace sign-in.**
  - The portal implements the hosted contract in [`docs/verification/hosted-workspaces.md`](../../docs/verification/hosted-workspaces.md): `/connect`, `POST /api/handoff/consume` and `POST /api/handoff/check`.
  - Handoff codes are single-use, PKCE S256, bound to the workspace's registered callback, and expire after one minute.
  - Grants are stored hashed.
  - Removing someone or changing their role reaches their open workspace sessions within 15 seconds.
- **Single sign-on.**
  - Works with any OpenID Connect provider: Google Workspace, Microsoft Entra ID, Okta, Auth0 and others.
  - Uses the authorization code flow with PKCE. ID tokens are verified against the provider's JWKS (RS256 or ES256), and the portal checks issuer, audience, expiry, nonce and `email_verified`.
  - Each workspace claims one email domain. Optionally, people from that domain are added as members on their first sign-in.

It runs on Node 24 and has no dependencies. Storage is SQLite through the built-in `node:sqlite`.

## Run it locally

```sh
cd apps/admin
DELIO_ADMIN_OPERATORS=you@example.com node src/main.ts
```

Open http://localhost:8790. In development, sign-in codes and invitation links are printed in the terminal instead of being emailed.

## Configuration

| Variable | Meaning |
| --- | --- |
| `DELIO_ADMIN_URL` | The portal's public origin, such as `https://admin.deliobot.com`. An `https` origin switches on production checks. |
| `DELIO_ADMIN_SECRET` | At least 32 random characters. Required in production. Keys the HMAC of codes and rate-limit buckets. |
| `DELIO_ADMIN_OPERATORS` | Comma-separated emails allowed to create workspaces. |
| `DELIO_ADMIN_DB` | SQLite file path. Default: `data/delio-admin.db`. |
| `DELIO_ADMIN_MAIL_API_KEY`, `DELIO_ADMIN_MAIL_FROM` | Email sending. Required in production. |
| `DELIO_ADMIN_MAIL_ENDPOINT` | A JSON mail API that accepts `{from,to,subject,text}` with a bearer key. Default: Resend's `https://api.resend.com/emails`. |
| `DELIO_ADMIN_MAIL=console` | Prints mail instead of sending it, even in production. Never use this on a public deployment. |
| `DELIO_ADMIN_OPENROUTER_KEY` | The operator's OpenRouter key, used only by the AI gateway. |
| `DELIO_ADMIN_FAL_KEY` | The operator's fal.ai key, used only by the AI gateway. |
| `DELIO_ADMIN_BOAT_KEY` | The operator's Boat key, used only by the cloud-computer relay. |
| `DELIO_ADMIN_BOAT_USD_PER_HOUR` | What an awake cloud computer costs, charged per minute. Default: `0.10`; set it to your Boat rate. |
| `DELIO_ADMIN_CREDIT_USD` | The provider cost one credit stands for. Default: `0.002` (so 1 USD of provider cost = 500 credits). |
| `PORT`, `HOST` | Listening address. Default: `8790`. Binds `127.0.0.1` in development and `0.0.0.0` in production. |

Put the portal behind a TLS-terminating proxy.

## Connect a workspace

1. Create the workspace in the portal, giving its address (for example `https://acme.deliobot.com`) and its first admin.
2. Start that workspace's server with:

   ```sh
   ODB_ADMIN_URL=https://admin.deliobot.com
   ODB_ADMIN_WORKSPACE=acme
   ODB_PUBLIC_URL=https://acme.deliobot.com
   ODB_ADMIN_MEMBERSHIP=portal
   ```

From then on, anyone who opens the workspace address goes through the portal to sign in.

## AI gateway and credits

Hosted workspaces use Delio's own provider keys through the portal, paying with
prepaid **credits** kept per workspace.

- **Workspace token.** An operator issues it on the workspace's **Billing** page
  (shown once; a new one revokes the old). The workspace's server gets it as
  `ODB_HOSTED_MODEL_TOKEN` and, for fal.ai, `ODB_FAL_KEY` with
  `ODB_FAL_URL=https://<portal>/api/gateway/<slug>/fal`.
- **Gateway.** `/api/gateway/<slug>/openrouter/v1/chat/completions` and `/models`,
  and `/api/gateway/<slug>/fal/<model>` with its queue status, result and cancel
  URLs. Each request is checked against the workspace's token, then **held**
  against its credits (0.05 USD for text; fal.ai's list price × length for
  media), sent with the operator's key, and **settled** at its real cost:
  OpenRouter's `usage.cost` (the gateway asks for it), fal.ai's list price. A
  request that made nothing gets its hold back. At zero credits the gateway
  answers `402` with `credits_exhausted` before calling the provider. A cost
  above what was left is still charged, so the balance can go below zero
  until the next top-up. At most 8 requests run at once per workspace.
- **Isolation.** A fal.ai job is reachable only through the workspace that
  started it. Provider keys never leave the portal.
- **Billing page.** Balance, this month's use and the history for workspace
  admins; operators add credits (or take some back) and issue the token.
  Paid plans and top-ups come with Stripe.
- **Account.** `GET /api/workspace/<slug>/account` (with the token) answers the
  balance; the workspace shows it under **Settings → Usage**.

- **Cloud computers.** `/api/gateway/<slug>/boat/v1/…` is the Boat relay a
  workspace reaches with `ODB_CLOUD_BOAT_URL=https://<portal>/api/gateway/<slug>/boat/v1`
  and `ODB_CLOUD_BOAT_TOKEN=<workspace token>`, with no change on its side.
  Each computer belongs to the workspace that created it; listings show only
  those. Awake minutes are charged once a minute; at zero credits every awake
  computer of the workspace is put to sleep (its disk is kept) and none can
  start or wake. One computer awake at a time per workspace.

- **Desktop apps.** In the app, **Settings → API keys → Delio account →
  Connect** shows a code and opens `https://<portal>/device` (RFC 8628 device
  flow: `POST /api/device/start`, then the app polls `POST /api/device/token`).
  The person, signed in, approves it for a workspace they administer or a new
  personal one. The app then holds its own `odb_device_…` token: a **Delio**
  engine (OpenRouter's catalog through the gateway, Auto first) and, without a
  fal.ai key of its own, images, video and music spend that workspace's
  credits. **Billing → Connected apps** lists and disconnects them.

Claude and Codex company engines are not offered through the gateway yet:
Claude, GPT and the other models are reached through OpenRouter.

## Tests

```sh
pnpm exec vitest run apps/admin
```

The suite covers:

- `admin.test.ts`: sign-in, limits, permissions, invitations, the handoff, the contract version, and single sign-on against a local OpenID provider with a real RSA key.
- `portal-workspace.e2e.test.ts`: runs the portal against a real workspace server, including sign-in, an outsider being refused, demotion, and a removed member's stream closing.

## Known limits

- OIDC client secrets are stored in the SQLite file. Protect the file and its backups like any other credential store.
- The portal runs as a single process. Rate limits and pending sign-ins live in its database, so do not run two portal processes against one file.
