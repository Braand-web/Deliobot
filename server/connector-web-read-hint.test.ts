import { describe, expect, it } from "vitest";
import { withPublicWebReadHint } from "./connector-web-read-hint.ts";

const encode = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
const decode = (value: Uint8Array) => new TextDecoder().decode(value);
const message = "Execution of tool 'COMPOSIO_SEARCH_FETCH_URL_CONTENT' is temporarily disabled by the administrator.";
const frame = (result: unknown) => ({ jsonrpc: "2.0", id: 7, result });

describe("a disabled Composio URL reader", () => {
  it.each(["'", '"'])("keeps the %s-quoted refusal and points at the independently permitted browser", quote => {
    const original = { content: [{ type: "text", text: message.replaceAll("'", quote) }], isError: true };
    const result = JSON.parse(decode(withPublicWebReadHint(encode(frame(original)), "application/json"))).result;
    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual(original.content[0]);
    expect(result.content[1].text).toContain("agent_browser_open and agent_browser_read");
    expect(result.content[1].text).toContain("when those tools are mounted and permitted");
    expect(result.content[1].text).toContain("Do not retry that tool");
    expect(result.content[1].text).toContain("Respect a disabled browser, denied tool permissions");
  });

  it("recognizes a failed nested MULTI_EXECUTE result without changing its successful sibling", () => {
    const data = { successful: false, data: { results: [
      { tool_slug: "COMPOSIO_SEARCH_FETCH_URL_CONTENT", response: { successful: false, error: message } },
      { tool_slug: "COMPOSIO_SEARCH_WEB", response: { successful: true, data: { title: "Found" } } },
    ] } };
    const original = { content: [{ type: "text", text: JSON.stringify(data) }] };
    const result = JSON.parse(decode(withPublicWebReadHint(encode(frame(original)), "application/json"))).result;
    expect(result.content[0]).toEqual(original.content[0]);
    expect(result.content[1].text).toContain("does not establish");
  });

  it("preserves the SSE event envelope", () => {
    const original = frame({ isError: true, content: [{ type: "text", text: message }] });
    const result = decode(withPublicWebReadHint(encode(`event: message\ndata: ${JSON.stringify(original)}\n\n`), "text/event-stream"));
    expect(result.startsWith("event: message\n")).toBe(true);
    expect(JSON.parse(result.split("\n")[1]!.slice(5)).result.content).toHaveLength(2);
  });

  it.each([
    { content: [{ type: "text", text: JSON.stringify({ successful: true, data: { known_pitfalls: message } }) }] },
    { isError: true, content: [{ type: "text", text: "The browser is disabled by its owner." }] },
    { isError: true, content: [{ type: "text", text: "Execution of tool 'GMAIL_SEND_EMAIL' is temporarily disabled by the administrator." }] },
    { isError: true, content: [{ type: "text", text: "COMPOSIO_SEARCH_FETCH_URL_CONTENT: user denied permission" }] },
  ])("leaves documentation and other refusals unchanged: %j", result => {
    const bytes = encode(frame(result));
    expect(withPublicWebReadHint(bytes, "application/json")).toBe(bytes);
  });
});
