import type { Billing } from "./plans.ts";
import { token, type Account, type AdminStore, type Workspace } from "./store.ts";
import type { Wallet } from "./wallet.ts";

export function personalWorkspaces(store: AdminStore, plans: Billing, wallet: Wallet, origin: string) {
  function candidates(user: Account): Workspace[] {
    const priority = (workspace: Workspace) => {
      const sub = plans.subscription(workspace.slug);
      if (sub.status === "active") return 0;
      if (sub.status === "grace" || sub.status === "trialing") return 1;
      return empty(workspace.slug) ? 3 : 2;
    };
    return store.workspacesOf(user.id).filter(workspace => workspace.role === "admin"
      && /^me-[a-z0-9]{8}$/.test(workspace.slug) && workspace.name === `${user.email} (personal)`
      && workspace.tenantUrl === origin && store.members(workspace.slug).length === 1)
      .sort((a, b) => priority(a) - priority(b) || a.createdAt - b.createdAt || a.slug.localeCompare(b.slug));
  }

  function empty(slug: string): boolean {
    return plans.subscription(slug).status === "none" && plans.orders(slug, 1).length === 0 && wallet.ledger(slug, 1).length === 0;
  }

  function existing(user: Account): Workspace | null {
    return candidates(user)[0] ?? null;
  }

  function ensure(user: Account): Workspace {
    return store.db.transaction(() => {
      const found = existing(user);
      if (found) return found;
      let slug: string;
      do { slug = `me-${token(6).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8).padEnd(8, "x")}`; } while (store.workspace(slug));
      return store.createWorkspace({ slug, name: `${user.email} (personal)`, tenantUrl: origin, ownerEmail: user.email }, user.email);
    });
  }

  function resolve(user: Account, slug: string): string {
    const personal = candidates(user);
    if (!personal.some(item => item.slug === slug) || !empty(slug)) return slug;
    return personal[0]?.slug ?? slug;
  }

  return { existing, ensure, resolve };
}
