import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { Billing } from "./plans.ts";
import { durableObjectDatabase, type DurableSqlStorage } from "./sql.ts";
import { AdminStore } from "./store.ts";
import { MICRO, Wallet } from "./wallet.ts";

/** A Durable Object's storage as Cloudflare documents it, over an in-memory SQLite: one statement per exec, no BEGIN. */
function durableStorage(): DurableSqlStorage & { statements: string[] } {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const statements: string[] = [];
  return {
    statements,
    sql: {
      exec(query, ...bindings) {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT)/i.test(query)) throw new Error("Durable Objects refuse transaction statements");
        statements.push(query);
        const statement = db.prepare(query);
        if (statement.columns().length) {
          const rows = statement.all(...(bindings as never[])) as Record<string, unknown>[];
          return { toArray: () => rows, rowsWritten: 0 };
        }
        const { changes } = statement.run(...(bindings as never[]));
        return { toArray: () => [], rowsWritten: Number(changes) };
      },
    },
    transactionSync(body) {
      db.exec("SAVEPOINT durable");
      try { const result = body(); db.exec("RELEASE durable"); return result; } catch (error) { db.exec("ROLLBACK TO durable"); db.exec("RELEASE durable"); throw error; }
    },
  };
}

describe("the portal on a Durable Object's SQLite", () => {
  it("creates its schema one statement at a time, and takes payments and credits atomically", () => {
    const storage = durableStorage();
    const db = durableObjectDatabase(storage);
    const store = new AdminStore({ db, secret: randomBytes(32) });
    store.createWorkspace({ slug: "acme", name: "Acme", tenantUrl: "https://deliobot.fun", ownerEmail: "boss@acme.test" }, "boss@acme.test");
    const wallet = new Wallet(db);
    const billing = new Billing(wallet);
    expect(storage.statements.some((statement) => statement.includes(";")), "no multi-statement exec reaches the storage").toBe(false);

    const order = billing.createOrder({ workspace: "acme", email: "boss@acme.test", kind: "plan", plan: "pro", cycle: "month" }, "XOF");
    expect(billing.fulfil(order.id)).toBe(true);
    expect(billing.fulfil(order.id), "once only").toBe(false);
    expect(wallet.balance("acme") / MICRO).toBe(5500);
    expect(billing.subscription("acme")).toMatchObject({ plan: "pro", status: "active" });

    expect(() => db.transaction(() => { wallet.credit("acme", 100 * MICRO, "grant", null); throw new Error("stop"); })).toThrow("stop");
    expect(wallet.balance("acme") / MICRO, "a failed transaction leaves nothing behind").toBe(5500);
    expect(billing.allowance("acme"), "Pro pays for Delio's AI, not the customer's own").toMatchObject({ gateway: true, plan: "pro", ownAi: false });
    const max = billing.createOrder({ workspace: "acme", email: "boss@acme.test", kind: "plan", plan: "max", cycle: "month" }, "XOF");
    billing.fulfil(max.id);
    expect(billing.allowance("acme")).toMatchObject({ plan: "max", ownAi: true });
  });
});
