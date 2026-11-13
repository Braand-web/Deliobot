# Auto

Auto chooses the model for each request, so people get a fast, cheap answer to a
simple message and a strong model when the work needs it.

## Text

An engine whose catalog spans several vendors (OpenRouter, or a Delio-hosted
gateway) offers **Auto** first in the model picker. A turn on Auto is rated:

| Tier | When | Picked from the catalog |
| --- | --- | --- |
| light | short and plain: no code, no picture, no work verb (summarise, draft, translate, explain…), nothing to do with a tool (post, send, open, search, book, a site or an app by name, a web address), short conversation | newest Gemini Flash, GPT mini, Claude Haiku… |
| standard | everything else, a picture, a long conversation | newest Claude Sonnet, GPT, Gemini Pro… |
| power | code with a hard task, analysis or strategy at length, very long messages | newest Claude Opus, GPT Pro, Gemini Pro… |

A short go-ahead ("oui vas-y", "ok", "continue") runs on the tier of the turn before it in that thread, so
the model that started a piece of work is the one that carries it on.

The model is the newest of the first family the catalog carries; free, preview,
image and audio variants are skipped. An operator can pin a model per tier in
`config.json` (`auto: { light, standard, power }`); a pinned model the catalog
lacks is ignored. When the chosen model refuses before starting, the next tier
up is tried once. The usage ledger records the model that actually ran. Titles
and other background calls on Auto use the light model. A Delio-hosted engine
still refuses any model outside its allowed list: Auto chooses within it.

Code: `server/auto-model.ts`, wrapped around every engine by
`decorateHostedProvider` in `server/index.ts`.

## Images, video, music

`auto` is the default model for fal.ai images, video and music
(`server/media-auto.ts`):

- **Images**: FLUX.1 schnell; Nano Banana Pro when the picture carries text (a
  poster, a logo, a title); FLUX.2 Pro for photographic requests.
- **Video**: Kling 2.5 Turbo Pro; Kling 3 Pro for cinematic or realistic requests.
- **Music**: ElevenLabs Music for instrumentals; MiniMax Music when there are
  lyrics or a song is asked for; ElevenLabs Sound Effects for a sound effect.

Any other fal.ai model can still be chosen in Settings.

## Music

`generate_music { prompt, seconds?, lyrics? }` makes background music, a jingle,
a song or a sound effect on fal.ai with the fal.ai key. It is off until an admin
turns it on under **Settings → Image generation → Music and sound**, with a
longest track (default 60 s, at most 180), tracks per reply (1) and tracks per
day (20). The track is saved as audio and plays in the chat; its list price is
booked in the usage ledger like images and videos.

## Voice

**Auto** in a bot's voice settings uses the best voice service set up here:
ElevenLabs when a voice is chosen, then OpenAI, Gemini, Fish Audio, Grok,
Chatterbox, then the Mac's voices. Voices belong to one service, so a voice that
service lacks is never sent to it: OpenAI then speaks with `marin` and Gemini
with `Kore`. Switching to or from Auto keeps the chosen voice.
