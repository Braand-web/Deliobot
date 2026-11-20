import type { ServerResponse } from "node:http";
import { z } from "zod";

import type { json } from "../harness/http.ts";
import { withoutMediaHost } from "../media-label.ts";
import { botFileSource, PageBundleError, type BotFolders } from "../pages/bundle.ts";
import { speechAudio, transcribe, transcriptText, type Transcript } from "../transcribe.ts";
import { PASS } from "./table.ts";

const schema = z.object({
  path: z.string().trim().min(1).max(1000),
  language: z.string().trim().regex(/^[a-z]{2,3}(-[a-z]{2})?$/i).optional(),
  words: z.boolean().optional(),
});

export interface TranscribeRouteContext {
  method: string;
  path: string;
  res: ServerResponse;
  json: typeof json;
  readBody: () => Promise<unknown>;
  botId: string;
  folders: BotFolders;
  requireActive: () => void;
}

export function createTranscribeToolRoute(deps: {
  config: () => { fal?: { key?: string; url?: string } };
  ready: () => boolean;
  keep: (botId: string, transcript: Transcript) => string | undefined;
  ffmpegMissing: () => void;
  fetchImpl?: typeof fetch;
}) {
  return {
    async internal(ctx: TranscribeRouteContext): Promise<typeof PASS | void> {
      if (ctx.method !== "POST" || ctx.path !== "/api/internal/audio/transcribe") return PASS;
      ctx.requireActive();
      const parsed = schema.safeParse(await ctx.readBody());
      if (!parsed.success) return ctx.json(ctx.res, 400, { error: "transcribe_audio takes the path of a video or audio file, an optional two-letter language and an optional words flag." });
      if (!deps.ready()) return ctx.json(ctx.res, 409, { error: "Transcription needs media to be set up. Ask the person to connect their Deliobot account or add a media key in Settings → AI → Images." });
      let file: string;
      try {
        file = await botFileSource(parsed.data.path, ctx.folders);
      } catch (error) {
        if (!(error instanceof PageBundleError)) throw error;
        return ctx.json(ctx.res, 400, { error: error.status === 403 ? "Only files in your folders can be read. Save it there first." : `Nothing was found at ${parsed.data.path.slice(0, 200)}.` });
      }
      const call = new AbortController();
      ctx.res.once("close", () => { if (!ctx.res.writableEnded) call.abort(); });
      try {
        const audio = await speechAudio(file, { ffmpegMissing: deps.ffmpegMissing });
        const transcript = await transcribe(deps.config(), audio, parsed.data, { fetchImpl: deps.fetchImpl, signal: call.signal });
        const saved = deps.keep(ctx.botId, transcript);
        return ctx.json(ctx.res, 200, { text: `${transcriptText(transcript)}${saved ? `\n\nSaved with every timestamp at ${JSON.stringify(saved)}.` : ""}` });
      } catch (error) {
        const status = (error as { status?: unknown }).status;
        return ctx.json(ctx.res, typeof status === "number" ? status : 500, { error: typeof status === "number" ? withoutMediaHost((error as Error).message) : "The recording could not be transcribed. Try again shortly." });
      }
    },
  };
}
