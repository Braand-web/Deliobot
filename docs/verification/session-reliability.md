# Session reliability and integrated billing

Use only disposable fixtures. The local session review was read-only; no
customer conversation, provider credential or raw report belongs in Git.

The regression tests cover:

- an approved sign-in arriving after a newer attempt or sign-out;
- an active Max account with a stalled pending SasPay checkout;
- an annual credit grant whose schedule write fails, then retries;
- local file and bot alerts while a web probe remains pending;
- a generated image encountering a transient Windows publication lock;
- shared Codex settings on Windows without file symlink privileges;
- rejected OpenRouter output budgets, one bounded reduction, a provider outage,
  and the customer's unchanged balance on rejection;
- actionable MCP schema diagnostics and bounded tool repair, preserving denials;
- menus, top-ups and bot limits opening the existing plans sheet in the app;
- legacy customer billing URLs and checkout returns opening that same sheet,
  while SasPay verification, workspace authorization and credit idempotency remain.

Run the relevant unit suites and the real isolated harness:

```sh
pnpm exec vitest run server/delio-account-races.test.ts apps/admin/src/plans-atomic.test.ts apps/admin/src/payments.test.ts apps/admin/src/devices.test.ts apps/admin/src/gateway.test.ts server/waits.test.ts server/attachments.test.ts
pnpm exec vitest run server/drivers/chat-mcp-tools.test.ts server/drivers/openai-chat-tools.test.ts server/host/loop-guard.test.ts src/components/UsageBudget.test.ts src/components/BotLimitPopup.test.ts
pnpm exec vitest run server/openai-tools.e2e.test.ts
```

The harness recipe is [OpenAI-compatible structured tools](openai-tools.md).
It records approval, execution, continuation, denial and cancellation with fake
providers. It establishes protocol behavior, not universal model reliability or
availability of a real provider's quota.
