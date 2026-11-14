import { describe, expect, it, vi } from "vitest";
import { createPublicWebRoutes, type PublicWebContext } from "./public-web.ts";
import { PASS } from "./table.ts";

function fixture() {
  const sent: { status?: number; body?: unknown } = {};
  const context: PublicWebContext = {
    method: "POST", path: "/api/internal/public-web/read", res: {} as PublicWebContext["res"],
    json: ((_res: unknown, status: number, body: unknown) => { Object.assign(sent, { status, body }); }) as PublicWebContext["json"],
    readBody: async () => ({ url: "https://public.example.test" }), requireActive: vi.fn(), toolScope: () => undefined,
  };
  const read = vi.fn(async () => ({ ok: true as const, url: "https://public.example.test", text: "Public page", untrusted: true, offset: 0, truncated: false, contentType: "text/plain" }));
  return { context, sent, read, route: createPublicWebRoutes(read) };
}

describe("the native URL reader route", () => {
  it("reads under the owning capability with bounded defaults", async () => {
    const f = fixture(); await f.route(f.context);
    expect(f.sent.status).toBe(200);
    expect(f.read).toHaveBeenCalledWith({ url: "https://public.example.test", offset: 0, max_chars: 12000 }, { beforeRequest: expect.any(Function) });
  });
  it("refuses a denied tool before making a network call", async () => {
    const f = fixture(); f.context.toolScope = () => ({ deny: ["mcp:agents:read_public_url"] });
    await expect(f.route(f.context)).rejects.toMatchObject({ status: 403 });
    expect(f.read).not.toHaveBeenCalled();
  });
  it("rechecks permissions after reading the body", async () => {
    const f = fixture(); f.context.readBody = async () => { f.context.toolScope = () => ({ allow: [] }); return { url: "https://public.example.test" }; };
    await expect(f.route(f.context)).rejects.toMatchObject({ status: 403 });
    expect(f.read).not.toHaveBeenCalled();
  });
  it("rejects a stale turn before reading", async () => {
    const f = fixture(); f.context.requireActive = () => { throw Object.assign(new Error("Turn ended"), { status: 401 }); };
    await expect(f.route(f.context)).rejects.toMatchObject({ status: 401 });
    expect(f.read).not.toHaveBeenCalled();
  });
  it.each([{ url: "https://example.com", max_chars: 1000000 }, { url: "https://example.com", headers: { authorization: "secret" } }, { url: "" }, { url: "https://example.com", offset: -1 }])("rejects invalid input %j", async input => {
    const f = fixture(); f.context.readBody = async () => input; await f.route(f.context);
    expect(f.sent.status).toBe(400); expect(f.read).not.toHaveBeenCalled();
  });
  it("passes other routes on", async () => {
    const f = fixture(); f.context.path = "/api/internal/other";
    expect(await f.route(f.context)).toBe(PASS);
  });
});
