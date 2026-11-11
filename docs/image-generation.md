# Image generation

Bots can create images in a chat: ask "make an image of…" and the bot calls
its `generate_image` tool, on any engine. Bot avatars use the same providers.
The image is attached to the bot's reply when its turn ends, like a voice note.

## Setup

Open **Settings → Image generation** (an AI page shown in Advanced mode; a
link from the avatar editor opens it in Simple mode too). Choose:

- **Base provider**: used first for every image.
- **Backup provider** (optional): used only when the base could not start.
- **Model** for each: a list with the recommended models first. For
  OpenRouter and fal.ai, the rest of the list is their live image catalog
  (OpenRouter's `/api/v1/models?output_modalities=image`, fal.ai's
  `api.fal.ai/v1/models?category=text-to-image`, both fetched without a key and
  kept for an hour). When the catalog cannot be loaded, the page says so and shows
  only the recommended ones. **Other** opens a field to type any model ID.
  Custom has no list, so its model is always typed.
- **Images per reply**: the most images a bot may create in one turn (1–10,
  default 4). Images still being made count, so parallel calls cannot pass it.
  Images from Codex's own image tool count toward the same limit.
- **A day's images**: bots make at most 50 images a day on one installation,
  counted on disk so a restart does not reset it, starting again at local
  midnight. There is no setting for it. Avatars made in Settings are not
  counted.
- **Only for a person**: `generate_image` makes an image only in a turn a
  person's own message started (or work handed on from one). A routine, a
  webhook, an outside app or a guest's turn is refused with a line the bot
  can pass on, so nothing spends the image key unattended.
- **Keys**: each chosen provider gets a key field on this page. The Grok and
  OpenRouter fields save the same key as **API keys**. A key pasted into a
  model field is refused.
- **Test** (once a key is saved): checks the key with the provider and makes
  no image. For OpenRouter it also checks that the chosen model exists, and
  says when the account has no credit, since image models are paid. For the
  other providers the model is only checked when the first image is made.

Bots are shown `generate_image` only while the base or the backup has what it
needs, so a bot never spends a turn finding out it cannot make images.

| Provider | Key | Default model | Endpoint |
| --- | --- | --- | --- |
| OpenAI | its own, in this section | `gpt-image-2` | `api.openai.com/v1/images/generations` |
| Grok (xAI) | in this section; the same key as under **API keys** | `grok-imagine-image-2.0` | `api.x.ai/v1/images/generations` |
| Gemini | its own (Google AI Studio), in this section | `gemini-2.5-flash-image` | `generativelanguage.googleapis.com/v1beta/openai/images/generations` |
| OpenRouter | in this section; the same key as under **API keys** | `google/gemini-2.5-flash-image` | `openrouter.ai/api/v1/images` |
| fal.ai | in this section; the same key as under **API keys**, also used for videos | `fal-ai/flux/schnell` | `queue.fal.run/<model>` (queued, then downloaded) |
| Custom | optional, in this section | none: enter one | `<base URL>/images/generations` |

Each key goes only to its own provider; a missing key is never borrowed from
another one. Signing in to a ChatGPT, Claude, Gemini, Grok or Copilot
subscription does not give API access, so it does not configure any of these.
Bots on Codex can also use Codex's own image tool, which bills the ChatGPT
plan; it does not use these providers, but its images count toward
**Images per reply**.

## When the backup is used

The backup is tried only when the base confirmed that nothing started, the
same rule the text backups follow:

- the base has no key (or no URL and model, for Custom);
- the connection was refused or the host was not found;
- the base answered HTTP 401, 402, 403 or 429.

A timeout or an HTTP 5xx stays on the base, because the image may already have
been made and billed. A refused request (HTTP 400, including a moderation
block) also stays on the base: OpenDeliobot does not retry a refused prompt
with another provider.

When the backup makes the image, the bot is told why the base did not, such as
`OpenAI image generation failed (HTTP 401, model gpt-image-2)`. When both fail,
the error names both reasons.

When the person names a provider ("make it with Grok"), the bot passes it and
only that provider is tried; it must be the base or the backup. When the base
and the backup are the same provider, naming it keeps the normal base-then-backup
order.

A generation stops when the bot's tool call goes away (the turn is stopped or
the engine gives up on the call), and nothing is attached.

## Custom gateway compatibility

For a local gateway such as OmniRoute, a base URL might be
`http://127.0.0.1:20128/v1`. OpenDeliobot appends `/images/generations`; pasting
that complete endpoint is also accepted. `localhost` and `127.0.0.1` refer to
the machine running the OpenDeliobot server, including when you open the app
remotely. Public endpoints require HTTPS. HTTP is supported for local/private
endpoints. URLs must not contain embedded credentials, query parameters, or
fragments.

The gateway must accept a synchronous OpenAI-style Images API request with
`model`, `prompt`, `size`, `n: 1`, and `response_format: "b64_json"`. Its JSON
response must contain `data[0].b64_json` with raw base64-encoded PNG, JPEG, or
WebP bytes. Chat API compatibility alone is insufficient; URL-only responses,
redirects, and asynchronous job responses are not supported.

## Limits

Each decoded image is limited to 10 MiB, the response to 15 MiB, and
generation to two minutes. Provider error bodies are never shown or stored:
an error names only the provider, the HTTP status and the model ID.

## fal.ai

fal.ai runs each request through its queue: the request is submitted to
`queue.fal.run/<model>`, its status is checked until it is done, then the result
names the file to download. Three rules keep this safe:

- The key goes only to the queue origin. A status or result URL on any other
  host is refused, never followed.
- The file is downloaded only from fal's media hosts (`fal.media` and its
  subdomains) over HTTPS, without the key, without following redirects, with
  its type checked and its size capped (10 MB for an image).
- Each model's own input schema (`api.fal.ai/v1/models?expand=openapi-3.0`,
  kept for a day) decides how the shape and the length are sent: `aspect_ratio`
  or `image_size`, and the nearest `duration` the model allows (`"5"`, `"8s"`
  or a number). Without a schema only the prompt and `aspect_ratio` are sent.

Every image and video a bot makes is written to the usage ledger like a turn,
with no tokens and a `media` field. A fal.ai one carries its list price from
`api.fal.ai/v1/models/pricing` (per output, or per second for a video billed by
the second), marked as estimated, so the monthly spend limit counts it. Images
from the other providers are booked without a price.

## Video

Video generation uses the same fal.ai key and is off until an admin turns it on
under **Settings → Image generation → Video**, since a clip costs far more than
an image. Then bots are shown `generate_video { prompt, seconds?, aspect? }`.

- **Video model**: any text-to-video model on fal.ai; the recommended ones come
  first, then fal.ai's live catalog. Default:
  `fal-ai/kling-video/v2.5-turbo/pro/text-to-video`.
- **Longest clip**: 1 to 10 seconds, default 5. A longer request is held to it,
  then to the nearest length the model supports.
- **Videos per reply**: default 1. **Videos per day**: all bots together,
  default 20, counted on disk until local midnight.
- **Only for a person**: the same rule as images.

The clip is downloaded within the inline preview limit (25 MB), saved as a file
attachment and played in the chat. It waits up to six minutes for fal.ai.
