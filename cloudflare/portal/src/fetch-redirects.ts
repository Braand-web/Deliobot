// Workers refuse `redirect: "error"` ("won't be implemented since it does not make sense at the edge; use 'manual' and
// check the response status code"). The portal asks for it on every call that carries a key, so a redirect never
// sends that key elsewhere: here it becomes "manual", and any redirect fails the call as it would on a server.
const workerFetch = globalThis.fetch.bind(globalThis);

export async function fetchRefusingRedirects(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (init?.redirect !== "error") return workerFetch(input, init);
  const response = await workerFetch(input, { ...init, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => undefined);
    throw new TypeError(`fetch failed: ${response.status} redirect refused`);
  }
  return response;
}

globalThis.fetch = fetchRefusingRedirects as typeof fetch;
