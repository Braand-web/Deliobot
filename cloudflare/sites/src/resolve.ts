export interface SiteManifest { workspace: string; key: string; files: Record<string, { sha1: string; type: string }> }

/** The file a request path serves: the file itself, its folder's index.html, the .html beside it, then the site's own
 * 404.html; an extension-less path with none of those serves index.html, as a single-page app expects. */
export function resolveSitePath(manifest: SiteManifest, pathname: string): { file: { sha1: string; type: string }; status: number } | null {
  const path = pathname.replace(/^\/+/, "");
  if (path.split("/").some((part) => part === "..")) return null;
  const files = manifest.files;
  const candidates = path === "" || path.endsWith("/") ? [`${path}index.html`] : [path, `${path}/index.html`, `${path}.html`];
  for (const candidate of candidates) if (Object.hasOwn(files, candidate)) return { file: files[candidate]!, status: 200 };
  if (Object.hasOwn(files, "404.html")) return { file: files["404.html"]!, status: 404 };
  const last = path.split("/").pop() ?? "";
  return !last.includes(".") && Object.hasOwn(files, "index.html") ? { file: files["index.html"]!, status: 200 } : null;
}
