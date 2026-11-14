import { fetchPublicPage, pageText, type PageFetchOptions } from "./wait-probes.ts";

export interface PublicUrlRead {
  url: string;
  offset: number;
  max_chars: number;
}

export async function readPublicUrl(input: PublicUrlRead, options: PageFetchOptions = {}) {
  const page = await fetchPublicPage(input.url, options);
  if (!page.ok) return page;
  const type = String(page.headers["content-type"] ?? "").split(";", 1)[0]!.trim().toLowerCase();
  if (!/^(?:text\/(?:html|plain|markdown|xml)|application\/(?:json|xml|xhtml\+xml))$/.test(type)) {
    return { ok: false as const, refused: false, error: "This URL does not return a supported text page. Use the browser for this document." };
  }
  const body = page.body.toString("utf8");
  const text = /html/.test(type) ? pageText(body) : body;
  const end = Math.min(text.length, input.offset + input.max_chars);
  return {
    ok: true as const, url: page.url.href, contentType: type, text: text.slice(input.offset, end),
    offset: input.offset, ...(end < text.length ? { next_offset: end } : {}),
    truncated: page.body.byteLength >= (options.maxBytes ?? 2 * 1024 * 1024),
    untrusted: true,
    ...(text.trim() ? {} : { note: "No readable text was returned. Use the browser if the page needs JavaScript." }),
  };
}
