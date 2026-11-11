// Auto: a model ID an engine with a many-vendor catalog (OpenRouter, a Delio-hosted gateway) answers by choosing, per
// message, a light, standard or power model from that same catalog.
import { TurnNotStartedError, type ModelCatalog, type ProviderInstance, type SendTurnInput, type TextGenerationOptions } from "./contracts.ts";

export const AUTO_MODEL = "auto";
export const AUTO_TIERS = ["light", "standard", "power"] as const;
export type AutoTier = (typeof AUTO_TIERS)[number];
export type AutoTierModels = Partial<Record<AutoTier, string>>;

/** Families tried in order for each tier; the newest version of the first family the catalog carries wins. */
const TIER_FAMILIES: Record<AutoTier, readonly RegExp[]> = {
  light: [/^google\/gemini-[\d.]+-flash(-lite)?$/, /^openai\/gpt-[\d.]+-mini$/, /^anthropic\/claude-(haiku-[\d.-]+|[\d.-]+-haiku)$/, /^deepseek\/deepseek-chat/, /^mistralai\/mistral-small/],
  standard: [/^anthropic\/claude-(sonnet-[\d.-]+|[\d.-]+-sonnet)$/, /^openai\/gpt-[\d.]+$/, /^google\/gemini-[\d.]+-pro$/, /^x-ai\/grok-[\d.]+$/, /^deepseek\/deepseek/],
  power: [/^anthropic\/claude-(opus-[\d.-]+|[\d.-]+-opus)$/, /^openai\/gpt-[\d.]+-pro$/, /^google\/gemini-[\d.]+-pro$/, /^anthropic\/claude-(sonnet-[\d.-]+|[\d.-]+-sonnet)$/],
};
const UNSUITED = /image|audio|tts|embed|moderation|:free|preview|-exp|guard/i;
const WORK = /\b(r[ée]sum\w*|summari[sz]\w*|r[ée]dige\w*|write|draft|traduis\w*|tradui\w*|translate|explique\w*|explain\w*|compare\w*|propose\w*|corrige\w*|rewrite|r[ée][ée]cri\w*|liste\w*|list)\b/i;
const HEAVY = /\b(code|coding|debug|bug|refactor|architect\w*|algorithm\w*|analy[sz]\w*|strat[eé]g\w*|contrat|contract|legal|juridique|proof|prove|d[ée]montr\w*|optimi[sz]\w*|step by step|[ée]tape par [ée]tape|think (hard|carefully)|r[ée]fl[ée]chis)\b/i;

function version(id: string): number[] {
  return (id.match(/\d+(?:\.\d+)*/g) ?? []).flatMap((part) => part.split(".").map(Number));
}

function newer(a: string, b: string): number {
  const left = version(a), right = version(b);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const diff = (right[index] ?? -1) - (left[index] ?? -1);
    if (diff) return diff;
  }
  return a.localeCompare(b);
}

/** How demanding a message looks: short and plain is light, code or analysis is power, everything else standard. */
export function autoTier(input: { text: string; images?: number; transcriptChars?: number }): AutoTier {
  const text = input.text.trim();
  const code = /```|^\s{4}\S/m.test(text);
  const heavy = HEAVY.test(text);
  if (text.length > 2500 || (code && heavy) || (heavy && text.length > 600)) return "power";
  if (!code && !heavy && !WORK.test(text) && !input.images && text.length <= 220 && (input.transcriptChars ?? 0) <= 6000) return "light";
  return "standard";
}

/** The catalog's model for a tier: the operator's choice when the catalog has it, else the newest of the first family found. */
export function autoModelFor(tier: AutoTier, catalog: ModelCatalog, chosen: AutoTierModels = {}): string {
  const ids = catalog.options.map((option) => option.id).filter((id) => id !== AUTO_MODEL);
  const pinned = chosen[tier];
  if (pinned && ids.includes(pinned)) return pinned;
  const usable = ids.filter((id) => !UNSUITED.test(id));
  for (const family of TIER_FAMILIES[tier]) {
    const found = usable.filter((id) => family.test(id)).sort(newer);
    if (found[0]) return found[0];
  }
  return catalog.default !== AUTO_MODEL && ids.includes(catalog.default) ? catalog.default : ids[0] ?? catalog.default;
}

/** Engines whose catalog spans several vendors, where choosing per message pays off. */
export function autoEligible(catalog: ModelCatalog): boolean {
  const routed = catalog.options.map((option) => option.id).filter((id) => id.includes("/"));
  return routed.length >= 3 && new Set(routed.map((id) => id.split("/")[0])).size >= 2;
}

export function withAutoCatalog(catalog: ModelCatalog): ModelCatalog {
  if (!autoEligible(catalog) || catalog.options.some((option) => option.id === AUTO_MODEL)) return catalog;
  return { ...catalog, options: [{ id: AUTO_MODEL, label: "Auto" }, ...catalog.options] };
}

const transcriptChars = (input: SendTurnInput) => (input.transcript ?? []).reduce((total, line) => total + line.text.length, 0);
const NEXT: Record<AutoTier, AutoTier | null> = { light: "standard", standard: "power", power: null };

/** Adds Auto to an engine. A turn on Auto runs on the tier's model; when that model refuses before starting, the next tier up is tried once. */
export function withAutoModel(instance: ProviderInstance, options: { tiers?: () => AutoTierModels; onChoice?: (choice: { threadId: string; tier: AutoTier; model: string }) => void } = {}): ProviderInstance {
  const pick = (tier: AutoTier) => autoModelFor(tier, instance.models, options.tiers?.());
  const decorated: ProviderInstance = Object.create(instance, {
    models: { get: () => withAutoCatalog(instance.models), enumerable: true },
    adapter: {
      value: {
        ...instance.adapter,
        sendTurn: async (input: SendTurnInput) => {
          if (input.model !== AUTO_MODEL) return instance.adapter.sendTurn(input);
          let tier = autoTier({ text: input.text, images: input.images?.length, transcriptChars: transcriptChars(input) });
          for (;;) {
            const model = pick(tier);
            options.onChoice?.({ threadId: input.threadId, tier, model });
            try {
              return await instance.adapter.sendTurn({ ...input, model, variant: undefined, effort: undefined });
            } catch (error) {
              const next = NEXT[tier];
              if (!(error instanceof TurnNotStartedError) || !next || pick(next) === model) throw error;
              tier = next;
            }
          }
        },
      },
      enumerable: true,
    },
    ...(instance.generateText ? {
      generateText: {
        value: (prompt: string, call?: TextGenerationOptions) => instance.generateText!(prompt, call?.model === AUTO_MODEL ? { ...call, model: pick("light") } : call),
        enumerable: true,
      },
    } : {}),
  });
  return decorated;
}
