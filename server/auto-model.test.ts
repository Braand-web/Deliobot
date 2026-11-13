import { describe, expect, it } from "vitest";

import { AUTO_MODEL, autoEligible, autoModelFor, autoTier, withAutoCatalog, withAutoModel } from "./auto-model.ts";
import { TurnNotStartedError, type ModelCatalog, type ProviderInstance, type SendTurnInput } from "./contracts.ts";
import { autoImageModel, autoMusicModel, autoVideoModel, IMAGE_AUTO_MODELS, MUSIC_AUTO_MODELS, VIDEO_AUTO_MODELS } from "./media-auto.ts";
import { resolveAutoVoice, voiceReady } from "./tts/index.ts";
import type { AppConfig } from "./config.ts";

const CATALOG: ModelCatalog = {
  default: "openai/gpt-5",
  options: [
    "google/gemini-2.5-flash", "google/gemini-3-flash", "google/gemini-3-flash-image", "openai/gpt-5-mini", "openai/gpt-5", "openai/gpt-5.2",
    "anthropic/claude-sonnet-4.5", "anthropic/claude-sonnet-5", "anthropic/claude-opus-4.5", "anthropic/claude-opus-5:free", "meta/llama-4",
  ].map((id) => ({ id, label: id })),
};

describe("Auto for text", () => {
  it("rates a message light, standard or power from what it asks", () => {
    expect(autoTier({ text: "Merci, à demain !" })).toBe("light");
    expect(autoTier({ text: "Résume ce mail en trois points pour l'équipe commerciale, avec les dates importantes et les personnes concernées, puis propose une réponse courte et polie au client." })).toBe("standard");
    expect(autoTier({ text: "salut", images: 1 }), "a picture needs a model that sees").toBe("standard");
    expect(autoTier({ text: "ok", transcriptChars: 20_000 }), "a long conversation needs more context").toBe("standard");
    expect(autoTier({ text: "Debug this:\n```ts\nconst x = y.z;\n```" })).toBe("power");
    expect(autoTier({ text: "x".repeat(3000) })).toBe("power");
    expect(autoTier({ text: "Publie ce post sur LinkedIn" }), "acting on a site takes a model that plans").toBe("standard");
    expect(autoTier({ text: "va sur deliobot.fun" })).toBe("standard");
    expect(autoTier({ text: "oui vas-y", previous: "power" }), "a go-ahead continues the work before it").toBe("power");
    expect(autoTier({ text: "ok", previous: "standard" })).toBe("standard");
    expect(autoTier({ text: "Merci, à demain !", previous: "power" }), "small talk stays light").toBe("light");
  });

  it("picks the newest model of the tier's family the catalog carries, never a free or image variant", () => {
    expect(autoModelFor("light", CATALOG)).toBe("google/gemini-3-flash");
    expect(autoModelFor("standard", CATALOG)).toBe("anthropic/claude-sonnet-5");
    expect(autoModelFor("power", CATALOG)).toBe("anthropic/claude-opus-4.5");
    expect(autoModelFor("light", CATALOG, { light: "openai/gpt-5-mini" }), "the operator's choice wins").toBe("openai/gpt-5-mini");
    expect(autoModelFor("light", CATALOG, { light: "not/in-catalog" })).toBe("google/gemini-3-flash");
    expect(autoModelFor("power", { default: "solo", options: [{ id: "solo", label: "Solo" }] }), "nothing matches: the catalog default").toBe("solo");
  });

  it("offers Auto first, and only on engines whose catalog spans several vendors", () => {
    expect(withAutoCatalog(CATALOG).options[0]).toEqual({ id: AUTO_MODEL, label: "Auto" });
    const single = { default: "claude-sonnet-5", options: [{ id: "claude-sonnet-5", label: "Sonnet" }, { id: "claude-opus-5", label: "Opus" }] };
    expect(autoEligible(single)).toBe(false);
    expect(withAutoCatalog(single)).toBe(single);
  });

  function engine(refuse: string[] = []) {
    const sent: SendTurnInput[] = [];
    const instance = {
      instanceId: "openrouter", driverKind: "openai-compat", displayName: "OpenRouter", enabled: true, models: CATALOG,
      adapter: { sendTurn: async (input: SendTurnInput) => {
        sent.push(input);
        if (input.model && refuse.includes(input.model)) throw new TurnNotStartedError("t", "refused");
        return { turnId: "t" };
      } },
      snapshot: async () => ({ state: "available" }),
      generateText: async (_prompt: string, options?: { model?: string }) => options?.model ?? "default",
      dispose: async () => {},
    } as unknown as ProviderInstance;
    return { instance, sent };
  }

  it("runs a turn on Auto with the tier's model, and moves up one tier when that model refuses before starting", async () => {
    const choices: unknown[] = [];
    const { instance, sent } = engine(["google/gemini-3-flash"]);
    const auto = withAutoModel(instance, { onChoice: (choice) => choices.push(choice) });
    expect(auto.models.options[0]!.id).toBe(AUTO_MODEL);
    await auto.adapter.sendTurn({ threadId: "t1", text: "Bonjour", model: AUTO_MODEL, effort: "high" } as SendTurnInput);
    expect(sent.map((input) => input.model)).toEqual(["google/gemini-3-flash", "anthropic/claude-sonnet-5"]);
    expect(sent[1]!.effort, "a tier model gets its own default effort").toBeUndefined();
    expect(choices).toEqual([{ threadId: "t1", tier: "light", model: "google/gemini-3-flash" }, { threadId: "t1", tier: "standard", model: "anthropic/claude-sonnet-5" }]);
    await auto.adapter.sendTurn({ threadId: "t2", text: "hi", model: "openai/gpt-5" } as SendTurnInput);
    expect(sent.at(-1)!.model, "a named model passes through").toBe("openai/gpt-5");
    expect(await auto.generateText!("title", { model: AUTO_MODEL })).toBe("google/gemini-3-flash");
    expect(auto.snapshot).toBe(instance.snapshot);
  });
});

describe("Auto for media", () => {
  it("picks an image, video and music model from what is asked", () => {
    expect(autoImageModel("a fox in the snow, watercolor")).toBe(IMAGE_AUTO_MODELS.fast);
    expect(autoImageModel("une affiche avec le titre « Soldes d'hiver »")).toBe(IMAGE_AUTO_MODELS.typography);
    expect(autoImageModel("photorealistic product shot of a watch")).toBe(IMAGE_AUTO_MODELS.photographic);
    expect(autoVideoModel("a cat jumping")).toBe(VIDEO_AUTO_MODELS.fast);
    expect(autoVideoModel("plan cinématique d'une voiture sous la pluie")).toBe(VIDEO_AUTO_MODELS.cinematic);
    expect(autoMusicModel({ prompt: "calm lo-fi piano for studying" })).toBe(MUSIC_AUTO_MODELS.instrumental);
    expect(autoMusicModel({ prompt: "pop", lyrics: "la la la" })).toBe(MUSIC_AUTO_MODELS.song);
    expect(autoMusicModel({ prompt: "une chanson d'anniversaire" })).toBe(MUSIC_AUTO_MODELS.song);
    expect(autoMusicModel({ prompt: "sound effect of a door creaking" })).toBe(MUSIC_AUTO_MODELS.soundEffect);
  });
});

describe("Auto for voice", () => {
  const cfg = (patch: Partial<AppConfig>): AppConfig => patch as AppConfig;

  it("uses the best voice service set up here, with a voice that service has", () => {
    expect(resolveAutoVoice(cfg({ tts: { provider: "auto" }, openai: { key: "k" } })).tts).toMatchObject({ provider: "openai", voice: "marin" });
    expect(resolveAutoVoice(cfg({ tts: { provider: "auto", voice: "coral" }, openai: { key: "k" } })).tts).toMatchObject({ provider: "openai", voice: "coral" });
    expect(resolveAutoVoice(cfg({ tts: { provider: "auto", geminiKey: "g", voice: "eleven-voice-id" } })).tts).toMatchObject({ provider: "gemini", voice: "Kore" });
    expect(resolveAutoVoice(cfg({ tts: { provider: "auto", key: "e", voice: "eleven-voice-id" }, openai: { key: "k" } })).tts).toMatchObject({ provider: "elevenlabs", voice: "eleven-voice-id" });
    const fixed = cfg({ tts: { provider: "fish", fishKey: "f", voice: "v" } });
    expect(resolveAutoVoice(fixed), "a chosen provider is left alone").toBe(fixed);
  });

  it("is ready on Auto with only a built-in voice service, and ignores a bot voice that service lacks", () => {
    expect(voiceReady(cfg({ tts: { provider: "auto" }, openai: { key: "k" } }), "some-elevenlabs-id")).toBe(true);
    expect(voiceReady(cfg({ tts: { provider: "auto" } }))).toBe(false);
  });
});
