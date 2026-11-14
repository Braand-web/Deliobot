import { noManagedAuthToolkit, withNoManagedAuthNote } from "./connector-auth-config-hint.ts";
import { withPublicWebReadHint } from "./connector-web-read-hint.ts";
import type { ToolkitSession } from "./composio-session.ts";

export async function withConnectorResponseHints(bytes: Uint8Array, contentType: string, toolCall: boolean, ready: ((toolkit: string) => Promise<ToolkitSession>) | null): Promise<Uint8Array> {
  if (!toolCall) return bytes;
  const toolkit = noManagedAuthToolkit(new TextDecoder().decode(bytes));
  const annotated = toolkit ? await withNoManagedAuthNote(bytes, contentType, toolkit, ready ? () => ready(toolkit) : null) : bytes;
  return withPublicWebReadHint(annotated, contentType);
}
