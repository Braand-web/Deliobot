import { describe, expect, it } from "vitest";

import { falInput } from "./fal.ts";
import { imageSlots } from "./image-generation.ts";
import { autoMusicModel, autoVideoModel, MUSIC_AUTO_MODELS, VIDEO_AUTO_MODELS } from "./media-auto.ts";
import { mediaModelLabel, withoutMediaHost } from "./media-label.ts";
import { musicGenerationReady, musicModel } from "./music-generation.ts";
import { buildSystemPrompt, mediaPrompt } from "./system-prompt.ts";
import { videoGenerationReady } from "./video-generation.ts";

describe("media is on once a media key is present", () => {
  it("makes videos and audio with only a key, until turned off", () => {
    expect(videoGenerationReady({ fal: { key: "k" } })).toBe(true);
    expect(musicGenerationReady({ fal: { key: "k" } })).toBe(true);
    expect(videoGenerationReady({ fal: { key: "k" }, videoGen: { enabled: false } })).toBe(false);
    expect(musicGenerationReady({ fal: { key: "k" }, musicGen: { enabled: false } })).toBe(false);
    expect(videoGenerationReady({ videoGen: { enabled: true } })).toBe(false);
  });

  it("makes images with the media key when no image provider was chosen", () => {
    expect(imageSlots({ fal: { key: "k" } }).primary).toEqual({ provider: "fal", model: "auto" });
    expect(imageSlots({}).primary.provider).toBe("openai");
    expect(imageSlots({ fal: { key: "k" }, imageGen: { primary: { provider: "gemini" } } }).primary.provider).toBe("gemini");
  });
});

describe("Auto picks the model for the request", () => {
  it("films someone speaking to camera with a model that makes speech", () => {
    expect(autoVideoModel("UGC video of a woman holding the phone, she says \"I love it\"")).toBe(VIDEO_AUTO_MODELS.talking);
    expect(autoVideoModel("a drone shot over a forest")).toBe(VIDEO_AUTO_MODELS.fast);
  });

  it("reads a voice-over aloud with a speech model, whatever audio model is saved", () => {
    expect(autoMusicModel({ prompt: "Bonjour et bienvenue", kind: "voice" })).toBe(MUSIC_AUTO_MODELS.voice);
    expect(musicModel({ musicGen: { model: "elevenlabs/music/v2.5" } }, { prompt: "Bonjour", kind: "voice" })).toBe(MUSIC_AUTO_MODELS.voice);
    expect(autoMusicModel({ prompt: "calm piano", kind: "sound_effect" })).toBe(MUSIC_AUTO_MODELS.soundEffect);
  });

  it("sends a speech model the words as text", () => {
    expect(falInput({ text: { type: "string" }, voice: { type: "string" } }, { prompt: "Bonjour", seconds: 5 })).toEqual({ text: "Bonjour" });
    expect(falInput({ prompt: { type: "string" } }, { prompt: "piano" })).toEqual({ prompt: "piano" });
  });
});

describe("the hosting service is never named to the bot", () => {
  it("names the model without its host", () => {
    expect(mediaModelLabel("fal-ai/kling-video/v3/pro/text-to-video")).toBe("Kling 3 Pro");
    expect(mediaModelLabel("fal-ai/flux/schnell")).toBe("FLUX.1 [schnell]");
    expect(mediaModelLabel("fal-ai/some/new-model")).toBe("some new-model");
  });

  it("takes the host out of errors the bot may repeat", () => {
    const text = withoutMediaHost("fal.ai returned no video (model fal-ai/veo3)");
    expect(text).not.toMatch(/fal/i);
    expect(text).toContain("Veo 3");
  });
});

describe("the media prompt", () => {
  it("lists only the media tools this turn has", () => {
    expect(mediaPrompt(undefined)).toBe("");
    const text = mediaPrompt({ env: { ODB_IMAGE_GENERATION: "1", ODB_VIDEO_GENERATION: "1", ODB_MUSIC_GENERATION: "0" } });
    expect(text).toContain("generate_image");
    expect(text).toContain("UGC");
    expect(text).not.toContain("generate_music");
    expect(text).not.toMatch(/fal/i);
  });

  it("is part of the system prompt", () => {
    const built = buildSystemPrompt("You are Delio.", "", [], { env: { ODB_VIDEO_GENERATION: "1" } });
    expect(built.sections.map((section) => section.id)).toContain("media");
  });
});
