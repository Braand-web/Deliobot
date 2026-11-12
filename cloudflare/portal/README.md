# Delio's customers' portal on Cloudflare

`https://compte.deliobot.fun`: sign-up, sign-in by emailed code, plans and top-ups through SasPay, Delio credits, the
AI gateway (OpenRouter, fal.ai, Boat) and the desktop app's connection. It is `apps/admin` running in one Durable
Object with its SQLite database; an alarm runs the billing sweep every minute. Customers use the desktop app: no
workspace is hosted here.

```sh
pnpm --dir ../control-plane exec wrangler deploy --config ../portal/wrangler.jsonc
```

Until its settings are complete the portal answers "Bientôt disponible".

## Secrets

Set them in Cloudflare's dashboard (Workers & Pages → deliobot-portal → Settings → Variables and Secrets → Add,
type **Secret**), never in this repository:

| Secret | Value |
| --- | --- |
| `DELIO_ADMIN_SECRET` | already set: 64 random characters signing sessions and codes |
| `DELIO_ADMIN_MAIL_API_KEY` | a Resend API key, with `deliobot.fun` verified at Resend |
| `DELIO_ADMIN_MAIL_FROM` | `Delio <signin@deliobot.fun>` |
| `DELIO_ADMIN_OPENROUTER_KEY`, `DELIO_ADMIN_FAL_KEY`, `DELIO_ADMIN_BOAT_KEY` | the operator's provider keys |
| `DELIO_ADMIN_SASPAY_KEY`, `DELIO_ADMIN_SASPAY_WEBHOOK_SECRET` | SasPay's secret key and the webhook's signing secret |
| `DELIO_ADMIN_OPERATORS` | the Delio team's addresses, separated by commas |

In SasPay's dashboard, point the webhook at `https://compte.deliobot.fun/api/saspay/webhook` for
`transaction.success`. The other settings are in `wrangler.jsonc`.

The operators' console is not served here.
