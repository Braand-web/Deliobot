import type { BotRecord } from "../store.ts";

type Coder = NonNullable<BotRecord["coder"]>;
const COMMAND = /^[^\0\r\n]{1,300}$/;

/** A bot's coder settings from a request; null clears them, an invalid value is refused. */
export function coderPatch(raw: unknown): { value: BotRecord["coder"] } | { error: string } {
  if (raw === null) return { value: undefined };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "coder must be an object or null" };
  const body = raw as Record<string, unknown>;
  if (typeof body.enabled !== "boolean") return { error: "coder.enabled must be true or false" };
  const value: Coder = { enabled: body.enabled };
  if (body.verify !== undefined) {
    const verify = Array.isArray(body.verify) ? body.verify.map((one) => (typeof one === "string" ? one.trim() : "\0")).filter(Boolean) : null;
    if (!verify || verify.length > 8 || !verify.every((one) => COMMAND.test(one))) return { error: "coder.verify must be up to 8 commands of one line each" };
    if (verify.length) value.verify = verify;
  }
  if (body.maxRounds !== undefined) {
    if (!Number.isInteger(body.maxRounds) || (body.maxRounds as number) < 1 || (body.maxRounds as number) > 6) return { error: "coder.maxRounds must be 1 to 6" };
    value.maxRounds = body.maxRounds as number;
  }
  if (body.review !== undefined && body.review !== null) {
    const review = body.review as Record<string, unknown>;
    if (typeof review.instanceId !== "string" || !review.instanceId || typeof review.model !== "string" || !review.model) {
      return { error: "coder.review must be { instanceId, model }" };
    }
    value.review = { instanceId: review.instanceId.slice(0, 200), model: review.model.slice(0, 200) };
  }
  if (body.planFirst !== undefined) {
    if (typeof body.planFirst !== "boolean") return { error: "coder.planFirst must be true or false" };
    if (body.planFirst) value.planFirst = true;
  }
  if (body.previewUrl !== undefined && body.previewUrl !== null && body.previewUrl !== "") {
    let url: URL;
    try { url = new URL(String(body.previewUrl)); } catch { return { error: "coder.previewUrl must be an http(s) address" }; }
    if (url.protocol !== "http:" && url.protocol !== "https:") return { error: "coder.previewUrl must be an http(s) address" };
    value.previewUrl = url.toString();
  }
  return { value };
}
