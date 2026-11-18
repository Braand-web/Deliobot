import { afterEach, describe, expect, it, vi } from "vitest";

import { setBrokerRelink } from "./composio-broker-access.ts";
import { listToolkits, setManagedBrokerAccess } from "./composio.ts";
import type { AppConfig } from "./config.ts";

afterEach(() => {
  setBrokerRelink(null);
  setManagedBrokerAccess(null);
  vi.unstubAllGlobals();
});

describe("the connected-apps catalog through the managed service", () => {
  it("links the Deliobot account again when the service refuses the catalog, then lists every app", async () => {
    setManagedBrokerAccess({ url: "https://apps.delio.test", token: "a".repeat(64) });
    let linked = false;
    setBrokerRelink(async () => { linked = true; });
    const items = Array.from({ length: 120 }, (_, index) => ({ slug: `app${index}`, name: `App ${index}` }));
    vi.stubGlobal("fetch", vi.fn(async () => linked
      ? new Response(JSON.stringify({ items, total_items: 120 }), { headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify({ code: "delio_account_required" }), { status: 403 })));
    const { cards, source } = await listToolkits({} as AppConfig);
    expect(linked).toBe(true);
    expect(source).toBe("api");
    expect(cards).toHaveLength(120);
  });
});
