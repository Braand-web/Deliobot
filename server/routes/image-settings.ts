// The answer is a verdict, never the key and never the vendor's body; nothing here makes an image.
import { z } from "zod";

import { IMAGE_MODEL_CHOICES, IMAGE_PROVIDERS, type ImageProvider, type ImageProviderTest } from "../../shared/image-generation.ts";
import { VIDEO_MODEL_CHOICES } from "../../shared/video-generation.ts";
import { avatarGenerationRequestSchema, generateAvatarImage } from "../avatar-image.ts";
import { parseBotProfilePatch } from "../bot-profile.ts";
import { createOpenRouterModelCatalog } from "../decider/openrouter-models.ts";
import { FAL_API_URL } from "../fal.ts";
import { createFalModelCatalog } from "../fal-models.ts";
import { customImageUrl, imageProviderKey, imageSlots, type ImageCredentials } from "../image-generation.ts";
import { checkProviderKey, type ProviderKeyKind } from "../provider-key-check.ts";
import { PASS, type RouteHandler } from "./table.ts";

const GEMINI_OPENAI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";
const testSchema = z.object({ provider: z.enum(IMAGE_PROVIDERS) });

/** Every openaiCompat target carries its own URL: without one, the key check would fall back to OpenRouter. */
function keyCheckTarget(cfg: ImageCredentials, provider: Exclude<ImageProvider, "fal">): { provider: ProviderKeyKind; url?: string } | null {
  if (provider === "gemini") return { provider: "openaiCompat", url: GEMINI_OPENAI_BASE };
  if (provider === "custom") {
    const url = customImageUrl(cfg);
    return url ? { provider: "openaiCompat", url } : null;
  }
  return { provider };
}

/** OpenRouter answers 404 for a model ID it does not have; its catalog needs no key. */
async function openrouterHasModel(model: string, fetchImpl: typeof fetch): Promise<boolean | null> {
  const [vendor, ...slug] = model.split("/");
  if (!vendor || slug.length === 0) return false;
  const url = `https://openrouter.ai/api/v1/models/${encodeURIComponent(vendor)}/${slug.map(encodeURIComponent).join("/")}/endpoints`;
  try {
    const response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000), redirect: "error" });
    await response.body?.cancel().catch(() => undefined);
    return response.status === 404 ? false : response.ok ? true : null;
  } catch {
    return null;
  }
}

/** fal.ai's price list needs a valid key and makes nothing, so it answers whether the key works. */
export async function testFalKey(key: string, fetchImpl: typeof fetch = fetch): Promise<ImageProviderTest> {
  if (!key) return { ok: false, reason: "no_key" };
  try {
    const response = await fetchImpl(`${FAL_API_URL}/models/pricing?endpoint_id=fal-ai/flux/schnell`, {
      headers: { authorization: `Key ${key}`, accept: "application/json" }, signal: AbortSignal.timeout(10_000), redirect: "error",
    });
    await response.body?.cancel().catch(() => undefined);
    if (response.ok) return { ok: true, check: "authentication" };
    if (response.status === 401 || response.status === 403) return { ok: false, reason: "rejected", status: response.status };
    return { ok: false, reason: "unexpected", status: response.status };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

export async function testImageProvider(cfg: ImageCredentials, provider: ImageProvider, fetchImpl: typeof fetch = fetch): Promise<ImageProviderTest> {
  if (provider === "fal") return testFalKey(imageProviderKey(cfg, provider), fetchImpl);
  const target = keyCheckTarget(cfg, provider);
  if (!target) return { ok: false, reason: "no_url" };
  const key = imageProviderKey(cfg, provider);
  if (!key) return { ok: false, reason: "no_key" };
  const verdict = await checkProviderKey({ ...target, key }, fetchImpl);
  if (!verdict.ok) return verdict;
  if (provider === "openrouter") {
    const { primary, fallback } = imageSlots(cfg);
    for (const slot of [primary, fallback]) {
      if (slot?.provider !== provider) continue;
      const found = await openrouterHasModel(slot.model, fetchImpl);
      if (found === false) return { ok: false, reason: "model_missing", model: slot.model };
      // A 5xx, a timeout or no network leaves the model unchecked: never answer that it is there.
      if (found === null) return { ok: false, reason: "unreachable" };
    }
  }
  return { ok: true, check: verdict.check, ...(verdict.freeTier !== undefined ? { freeTier: verdict.freeTier } : {}) };
}

export function createImageSettingsRoutes(deps: { config: () => ImageCredentials; fetch?: typeof fetch }): RouteHandler {
  const models = createOpenRouterModelCatalog({ fetch: deps.fetch, output: "image", curated: IMAGE_MODEL_CHOICES.openrouter });
  const falModels = createFalModelCatalog({ fetch: deps.fetch, curated: { image: IMAGE_MODEL_CHOICES.fal, video: VIDEO_MODEL_CHOICES } });
  return async ({ req, res, url, path, method, json, readBody }) => {
    if (method === "POST" && path === "/api/bot-defaults/avatar") {
      const body = await readBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "avatar preview must be a JSON object" });
      const profile = parseBotProfilePatch(body.profile, true);
      if (!profile.ok) return json(res, 400, { error: profile.error });
      const checked = avatarGenerationRequestSchema.safeParse({ prompt: body.prompt });
      if (!checked.success) return json(res, 400, { error: checked.error.message });
      const generated = await generateAvatarImage(deps.config(), {
        name: profile.patch.name ?? "", title: profile.patch.title ?? "", description: profile.patch.description ?? "",
      }, checked.data.prompt, deps.fetch);
      return json(res, 200, { dataUrl: `data:${generated.mime};base64,${generated.bytes.toString("base64")}` });
    }
    if (path === "/api/images/openrouter-models" && method === "GET") {
      res.setHeader("cache-control", "no-store");
      return json(res, 200, await models.load());
    }
    if (path === "/api/media/fal-models" && method === "GET") {
      const kind = url.searchParams.get("kind");
      if (kind !== "image" && kind !== "video") return json(res, 400, { error: "kind must be image or video" });
      res.setHeader("cache-control", "no-store");
      return json(res, 200, await falModels.load(kind));
    }
    if (path !== "/api/images/test" || method !== "POST") return PASS;
    const parsed = testSchema.safeParse(await readBody(req, 8192));
    if (!parsed.success) return json(res, 400, { error: `provider must be one of ${IMAGE_PROVIDERS.join(", ")}` });
    res.setHeader("cache-control", "no-store");
    return json(res, 200, await testImageProvider(deps.config(), parsed.data.provider, deps.fetch));
  };
}
