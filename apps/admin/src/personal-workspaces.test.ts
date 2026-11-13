import { expect, it } from "vitest";
import { AdminStore } from "./store.ts";
import { nodeDatabase } from "./sql-node.ts";
import { Wallet, MICRO } from "./wallet.ts";
import { Billing } from "./plans.ts";
import { personalWorkspaces } from "./personal-workspaces.ts";

it("only recovers empty personal duplicates and keeps funded, shared and other accounts separate", () => {
  const store = new AdminStore({ db: nodeDatabase(":memory:"), secret: Buffer.alloc(32, 1) });
  try {
    const wallet = new Wallet(store.db);
    const plans = new Billing(wallet);
    const origin = "https://portal.test";
    const personal = personalWorkspaces(store, plans, wallet, origin);
    const owner = store.ensureAccount("ana@example.test");
    for (const slug of ["me-empty123", "me-funded12", "me-shared12", "me-paid1234"]) store.createWorkspace({ slug, name: `${owner.email} (personal)`, tenantUrl: origin, ownerEmail: owner.email }, owner.email);
    wallet.credit("me-funded12", 12 * MICRO, "topup", "fixture");
    const other = store.ensureAccount("bob@example.test");
    store.addMember("me-shared12", other.id, "member", owner.email);
    const order = plans.createOrder({ workspace: "me-paid1234", email: owner.email, kind: "plan", plan: "max", cycle: "year" }, "XOF");
    plans.fulfil(order.id);
    expect(personal.resolve(owner, "me-empty123")).toBe("me-paid1234");
    expect(personal.ensure(owner).slug).toBe("me-paid1234");
    expect(personal.resolve(owner, "me-funded12")).toBe("me-funded12");
    expect(personal.resolve(owner, "me-shared12")).toBe("me-shared12");
    expect(personal.resolve(other, "me-empty123")).toBe("me-empty123");
    expect(wallet.balance("me-funded12")).toBe(12 * MICRO);
    expect(wallet.balance("me-paid1234")).toBe(13500 * MICRO);
  } finally { store.close(); }
});
