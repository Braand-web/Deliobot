# Deploy Deliobot on deliobot.fun

The production layout: the public site on Cloudflare, and one Linux server that
runs the Delio Admin portal and every customer's workspace.

| Address | What answers | Where |
| --- | --- | --- |
| `deliobot.fun`, `www.deliobot.fun` | the public site (`cloudflare/site`) | Cloudflare Worker `deliobot` |
| `admin.deliobot.fun` | Delio Admin: sign-up, sign-in, billing, AI gateway | the server, port 8790 behind Caddy |
| `<slug>.deliobot.fun` | one customer's workspace | the server, created by the fleet agent |

## 1. DNS

The domain is registered at Hostinger and its zone is on Cloudflare. In
Hostinger's panel, **Domains → deliobot.fun → DNS / Nameservers → Change
nameservers**, set exactly:

```
martha.ns.cloudflare.com
stanley.ns.cloudflare.com
```

Cloudflare activates the zone once it sees them (minutes to a few hours). Then,
in the zone's DNS records:

| Type | Name | Content | Proxy |
| --- | --- | --- | --- |
| A | `admin` | the server's public IPv4 | DNS only |
| A | `*` | the server's public IPv4 | DNS only |

`DNS only` lets Caddy on the server obtain each certificate itself. The site's
own records are created by the Worker's custom domains: add

```jsonc
"routes": [
  { "pattern": "deliobot.fun", "custom_domain": true },
  { "pattern": "www.deliobot.fun", "custom_domain": true }
]
```

to `cloudflare/site/wrangler.jsonc` and deploy it again.

## 2. The server

Ubuntu 24.04, x86-64. Count about 1 GB of memory per active workspace on top of
2 GB for the portal and the system: 4 CPUs and 8 GB hold a first handful of
customers. As root:

1. Install Node 24, pnpm, Caddy and nftables, and clone this repository to
   `/opt/deliobot` (`pnpm install`, then `pnpm build`).
2. Create the portal's user: `useradd --system --create-home delio`.
3. Install the fleet with that user as its operator, so only the portal may
   open the fleet socket:

   ```sh
   node --experimental-strip-types /opt/deliobot/server/cli.ts fleet init --domain deliobot.fun --operator delio
   ```

4. Run the portal as `delio` (a systemd unit running
   `node /opt/deliobot/apps/admin/src/main.ts`) with the environment below, and
   add to `/etc/caddy/Caddyfile`:

   ```
   admin.deliobot.fun {
     reverse_proxy 127.0.0.1:8790
   }
   ```

## 3. The portal's environment

| Variable | Value |
| --- | --- |
| `DELIO_ADMIN_URL` | `https://admin.deliobot.fun` |
| `DELIO_ADMIN_SECRET` | 48 random characters (`openssl rand -base64 48`) |
| `DELIO_ADMIN_DB` | `/home/delio/data/delio-admin.db` |
| `DELIO_ADMIN_OPERATORS` | your own email address |
| `DELIO_ADMIN_WORKSPACE_DOMAIN` | `deliobot.fun` |
| `DELIO_ADMIN_MAIL_API_KEY`, `DELIO_ADMIN_MAIL_FROM` | a Resend key and `Delio <hello@deliobot.fun>` (the domain verified at Resend) |
| `DELIO_ADMIN_OPENROUTER_KEY`, `DELIO_ADMIN_FAL_KEY`, `DELIO_ADMIN_BOAT_KEY` | the operator's provider keys |
| `DELIO_ADMIN_SASPAY_KEY`, `DELIO_ADMIN_SASPAY_WEBHOOK_SECRET` | SasPay's secret key and the webhook's signing secret |
| `DELIO_ADMIN_XOF_PER_USD` | today's rate, for example `600` |

Keep the keys in a root-owned file (`EnvironmentFile=` with mode 600), never in
the repository. In SasPay's dashboard, point the webhook at
`https://admin.deliobot.fun/api/saspay/webhook` for `transaction.success`.

## 4. Check it

1. `https://admin.deliobot.fun/api/health` answers `ok`, and
   `https://admin.deliobot.fun/api/public/plans` lists the plans.
2. Sign up at `https://admin.deliobot.fun/signup` with a test address, pay the
   trial with SasPay in test mode, and watch **Billing** go from *Being created*
   to *Ready*; `https://<slug>.deliobot.fun` then asks for a sign-in code.
3. `node --experimental-strip-types /opt/deliobot/server/cli.ts fleet list` (as root) shows the workspace running; the audit
   log is `/var/log/opendeliobot/fleet.jsonl`.

The steps on a real server (Caddy certificates, nftables, systemd) are not run
in this repository's tests; see [`docs/verification/fleet.md`](verification/fleet.md).
