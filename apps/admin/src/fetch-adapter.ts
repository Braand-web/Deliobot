// Runs the portal's (req, res) handler on a Fetch API Request, as a Cloudflare Worker receives it, and answers with a
// Response that streams what the handler writes.
import type { IncomingMessage, ServerResponse } from "node:http";

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

const NO_BODY = new Set([101, 204, 205, 304]);

export function serveFetch(handler: Handler, request: Request, remoteAddress: string): Promise<Response> {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => { headers[name] = value; });
  const body = request.body;
  const req = {
    method: request.method,
    url: url.pathname + url.search,
    headers,
    socket: { remoteAddress },
    async *[Symbol.asyncIterator]() {
      if (!body) return;
      const reader = body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield Buffer.from(value);
      }
    },
  } as unknown as IncomingMessage;

  return new Promise<Response>((resolve) => {
    const outgoing = new Headers();
    let stream: { writer: WritableStreamDefaultWriter<Uint8Array> } | null = null;
    const toBytes = (chunk: unknown) => typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk as ArrayBuffer | Uint8Array);
    const res = {
      statusCode: 200,
      headersSent: false,
      setHeader(name: string, value: string | number | readonly string[]) {
        outgoing.delete(name);
        for (const item of Array.isArray(value) ? value : [String(value)]) outgoing.append(name, item);
        return res;
      },
      getHeader: (name: string) => outgoing.get(name) ?? undefined,
      removeHeader: (name: string) => outgoing.delete(name),
      write(chunk: unknown) {
        if (!stream) {
          const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
          stream = { writer: writable.getWriter() };
          res.headersSent = true;
          resolve(new Response(readable, { status: res.statusCode, headers: outgoing }));
        }
        void stream.writer.write(toBytes(chunk)).catch(() => undefined);
        return true;
      },
      end(chunk?: unknown) {
        if (stream) {
          if (chunk !== undefined && chunk !== null) void stream.writer.write(toBytes(chunk)).catch(() => undefined);
          void stream.writer.close().catch(() => undefined);
        } else {
          res.headersSent = true;
          const status = res.statusCode;
          resolve(new Response(NO_BODY.has(status) || chunk === undefined || chunk === null ? null : toBytes(chunk), { status, headers: outgoing }));
        }
        return res;
      },
      destroy() {
        if (stream) void stream.writer.abort().catch(() => undefined);
        else resolve(new Response(null, { status: 502 }));
      },
    } as unknown as ServerResponse & { headersSent: boolean };

    handler(req, res).then(
      () => { if (!res.headersSent) res.end(); },
      () => { if (!res.headersSent) { res.statusCode = 500; res.end("Something went wrong."); } else res.destroy(); },
    );
  });
}
