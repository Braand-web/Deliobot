import { describe, expect, it } from "vitest";

import { SIGNED_OUT_NOTICE_EVERY_MS, createAppSignedOutNotice } from "./app-signed-out-notice.ts";

const answer = (text: string, isError = false) => new TextEncoder().encode(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { isError, content: [{ type: "text", text }] } }));
const signedOut = answer(JSON.stringify({ successful: false, error: "Connected account is not active" }));

function notices() {
  const clock = { at: 1_000 };
  const told: Array<{ threadId: string; tool: { name: string; reconnectApp: string; nameCode: string } }> = [];
  const notice = createAppSignedOutNotice({ append: (threadId, tool) => told.push({ threadId, tool }), now: () => clock.at });
  const call = (threadId: string, slug: string, bytes = signedOut) => notice.observe({ threadId, slugs: [slug], status: 200, bytes, contentType: "application/json" });
  return { clock, told, call };
}

describe("telling a conversation an app signed out", () => {
  it("posts one notice that offers to reconnect the app", () => {
    const { told, call } = notices();
    call("t1", "GMAIL_SEND_EMAIL");
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ threadId: "t1", tool: { reconnectApp: "gmail", nameCode: "chat.notice.appSignedOut" } });
    expect(told[0]!.tool.name).toMatch(/^notice: Gmail is signed out/);
  });

  it("does not repeat itself in the same conversation for a while, but tells another conversation", () => {
    const { clock, told, call } = notices();
    call("t1", "GMAIL_SEND_EMAIL");
    call("t1", "GMAIL_FETCH_EMAILS");
    call("t2", "GMAIL_SEND_EMAIL");
    expect(told.map((row) => row.threadId)).toEqual(["t1", "t2"]);
    clock.at += SIGNED_OUT_NOTICE_EVERY_MS;
    call("t1", "GMAIL_SEND_EMAIL");
    expect(told).toHaveLength(3);
  });

  it("stays quiet when the call worked or failed for another reason", () => {
    const { told, call } = notices();
    call("t1", "GMAIL_SEND_EMAIL", answer(JSON.stringify({ successful: true, data: {} })));
    call("t1", "GMAIL_SEND_EMAIL", answer(JSON.stringify({ successful: false, error: "Rate limit exceeded" })));
    expect(told).toEqual([]);
  });
});
