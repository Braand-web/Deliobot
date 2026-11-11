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
