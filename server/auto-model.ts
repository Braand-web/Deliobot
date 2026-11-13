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
/** Work done with tools: acting on a site, an app, a file or an inbox takes a model that plans and recovers. */
const ACTION = /\b(publi\w*|post\w*|envoi\w*|envoy\w*|send|r[ée]pond\w*|reply|commente\w*|comment|partage\w*|share|connecte\w*|sign in|log ?in|ouvr\w*|open|navig\w*|browse|va sur|go to|cherche\w*|recherche\w*|search|find|trouve\w*|t[ée]l[ée]charge\w*|download|upload|remplis\w*|fill|r[ée]serve\w*|book|ach[eè]te\w*|buy|programme\w*|planifie\w*|schedule|cr[ée]e\w*|create|g[ée]n[èe]re\w*|generate|pr[ée]pare\w*|prepare|[ée]cri\w*|fais\w*|make|build|installe\w*|install|lance\w*|run|supprime\w*|delete|modifie\w*|update|edit|v[ée]rifie\w*|check|surveille\w*|monitor|rapport|report|facture|invoice|devis|quote|e-?mail|mail|agenda|calendar|facebook|instagram|linkedin|tiktok|twitter|youtube|whatsapp|telegram|reddit|pinterest|snapchat|discord|slack|notion|gmail|drive|sheets?|excel)\b|https?:\/\/|\b[\w-]+\.(com|fr|io|net|org|app|ai|co)\b/i;
/** A go-ahead that continues the work before it, so it runs on that work's model. */
const GO_AHEAD = /^\W*(oui|ok(ay)?|d'accord|vas[- ]y|allez|go|continue\w*|poursuis|fais[- ]le|encore|r[ée]essa\w*|suivant|la suite|yes|yep|sure|do it|go ahead|proceed|carry on|keep going|retry|try again|next)\b/i;
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

const RANK: Record<AutoTier, number> = { light: 0, standard: 1, power: 2 };

/** How demanding a message looks: short and plain is light, code or analysis is power, everything else standard.
 * `previous` is the tier of the thread's turn before it. */
export function autoTier(input: { text: string; images?: number; transcriptChars?: number; previous?: AutoTier }): AutoTier {
  const text = input.text.trim();
  const rated = ratedTier({ ...input, text });
  const previous = input.previous;
  return previous && RANK[previous] > RANK[rated] && text.length <= 80 && GO_AHEAD.test(text) ? previous : rated;
}

function ratedTier(input: { text: string; images?: number; transcriptChars?: number }): AutoTier {
  const { text } = input;
  const code = /```|^\s{4}\S/m.test(text);
  const heavy = HEAVY.test(text);
  if (text.length > 2500 || (code && heavy) || (heavy && text.length > 600)) return "power";
  if (!code && !heavy && !WORK.test(text) && !ACTION.test(text) && !input.images && text.length <= 220 && (input.transcriptChars ?? 0) <= 6000) return "light";
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
const REMEMBERED_THREADS = 2000;

/** Adds Auto to an engine. A turn on Auto runs on the tier's model; when that model refuses before starting, the next tier up is tried once. */
export function withAutoModel(instance: ProviderInstance, options: { tiers?: () => AutoTierModels; onChoice?: (choice: { threadId: string; tier: AutoTier; model: string }) => void } = {}): ProviderInstance {
  const pick = (tier: AutoTier) => autoModelFor(tier, instance.models, options.tiers?.());
  const lastTier = new Map<string, AutoTier>();
  const remember = (threadId: string, tier: AutoTier) => {
    lastTier.delete(threadId);
    lastTier.set(threadId, tier);
    if (lastTier.size > REMEMBERED_THREADS) lastTier.delete(lastTier.keys().next().value!);
  };
  const decorated: ProviderInstance = Object.create(instance, {
    models: { get: () => withAutoCatalog(instance.models), enumerable: true },
    adapter: {
      value: {
        ...instance.adapter,
        sendTurn: async (input: SendTurnInput) => {
          if (input.model !== AUTO_MODEL) return instance.adapter.sendTurn(input);
          let tier = autoTier({ text: input.text, images: input.images?.length, transcriptChars: transcriptChars(input), previous: lastTier.get(input.threadId) });
          for (;;) {
            const model = pick(tier);
            remember(input.threadId, tier);
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
