// Which media model a bot's image, video or music uses: the one the person named in this request, else the bot's own
// choice, else the workspace setting with Auto.
import { MEDIA_AUTO } from "./media-auto.ts";
import { validFalModel } from "./fal.ts";
import type { FalMediaKind, FalModelCatalog, FalModelList } from "./fal-models.ts";

export type BotMedia = Partial<Record<FalMediaKind, string>>;

const words = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9.]+/).filter(Boolean);

/** A model ID from what someone typed: an exact ID, else the first listed model (recommended first) whose name or ID holds every word. */
export function resolveMediaModel(list: FalModelList, asked: string): string | null {
  const wanted = asked.trim();
  if (!wanted) return null;
  const exact = list.models.find((model) => model.id === wanted || model.name.toLowerCase() === wanted.toLowerCase());
  if (exact) return exact.id;
  const tokens = words(wanted);
  const match = tokens.length ? list.models.find((model) => {
    const haystack = new Set([...words(model.name), ...words(model.id.replace(/[/_-]/g, " "))]);
    return tokens.every((token) => [...haystack].some((word) => word === token || word.startsWith(token)));
  }) : undefined;
  if (match) return match.id;
  return wanted.includes("/") && validFalModel(wanted) ? wanted : null;
}

export type MediaChoice = { model: string | null } | { error: string };

/** null model: keep the workspace's setting (Auto unless the person chose one in Settings). */
export async function chooseMediaModel(kind: FalMediaKind, asked: string | undefined, bot: BotMedia | undefined, catalog: FalModelCatalog): Promise<MediaChoice> {
  if (asked?.trim() && asked.trim().toLowerCase() !== MEDIA_AUTO) {
    const list = await catalog.load(kind);
    const model = resolveMediaModel(list, asked);
    if (model) return { model };
    const names = list.models.filter((item) => item.group === "recommended").map((item) => item.name).join(", ");
    return { error: `No ${kind} model matches "${asked.trim()}". Name one of these, or leave the model out to let Auto choose: ${names}.` };
  }
  const own = bot?.[kind]?.trim();
  return { model: own && own !== MEDIA_AUTO && validFalModel(own) ? own : null };
}
