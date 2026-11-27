// Auto for media: the fal.ai model that suits a request, chosen from what it asks for. Each list starts with the cheap,
// fast default; a request asking for text in the picture, photographic or cinematic quality, someone speaking on
// camera, lyrics, a sound effect or a voice moves to the model built for it.
export const MEDIA_AUTO = "auto";

const TYPOGRAPHY = /\b(logo|poster|affiche|flyer|banni[eè]re|banner|menu|infographi\w*|diagram\w*|sch[ée]ma|typograph\w*|lettering|text|texte|title|titre|slogan|caption|l[ée]gende|sign|panneau)\b/i;
const PHOTOGRAPHIC = /\b(photo\w*|realistic|r[ée]alist\w*|portrait|product shot|packshot|hdr|dslr|35mm|8k|4k|studio lighting)\b/i;
const CINEMATIC = /\b(cin[ée]mati\w*|cinema|film|movie|realistic|r[ée]alist\w*|4k|haute qualit[ée]|high quality|commercial|publicit[ée]|trailer|bande[- ]annonce)\b/i;
const SONG = /\b(song|chanson|lyrics|paroles|sing\w*|chant\w*|vocal\w*|voix|rap|refrain|chorus|couplet|verse)\b/i;
const TALKING = /\b(ugc|testimonial|t[ée]moignage|talking|speaks?|speaking|says?|saying|dialogue|voice[- ]?over|voix[- ]off|parle\w*|dit|face (?:cam[ée]ra|camera)|to camera|influenc\w*|avis client|review)\b/i;
const SOUND_EFFECT = /\b(sound effects?|sfx|effets? sonores?|bruit\w*|bruitage|whoosh|explosion|footsteps?|pas|door|porte|applause|applaudissements?|notification|ding|jingle court)\b/i;

export const IMAGE_AUTO_MODELS = { fast: "fal-ai/flux/schnell", typography: "fal-ai/nano-banana-pro", photographic: "fal-ai/flux-2-pro" } as const;
export const VIDEO_AUTO_MODELS = { fast: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video", cinematic: "fal-ai/kling-video/v3/pro/text-to-video", talking: "fal-ai/veo3" } as const;
export const MUSIC_AUTO_MODELS = { instrumental: "elevenlabs/music/v2.5", song: "fal-ai/minimax-music/v2.6", soundEffect: "elevenlabs/sound-effects/v3", voice: "fal-ai/elevenlabs/tts/multilingual-v2" } as const;

/** What a generate_music call asks for; Auto reads the prompt when it is left out. */
export const AUDIO_KINDS = ["music", "song", "sound_effect", "voice"] as const;
export type AudioKind = (typeof AUDIO_KINDS)[number];

/** fal.ai models that change an existing image, each at its own `/edit` endpoint; Auto edits with the first. */
export const IMAGE_EDIT_MODELS = ["fal-ai/nano-banana-pro", "openai/gpt-image-2", "fal-ai/nano-banana-2", "fal-ai/flux-2-pro"] as const;

/** The edit endpoint for a chosen image model; Auto, and a model with no edit endpoint, edit with Auto's. */
export function editImageModel(model: string): string {
  const base = model.replace(/\/edit$/u, "");
  return `${(IMAGE_EDIT_MODELS as readonly string[]).includes(base) ? base : IMAGE_EDIT_MODELS[0]}/edit`;
}

export function autoImageModel(prompt: string): string {
  if (TYPOGRAPHY.test(prompt)) return IMAGE_AUTO_MODELS.typography;
  if (PHOTOGRAPHIC.test(prompt)) return IMAGE_AUTO_MODELS.photographic;
  return IMAGE_AUTO_MODELS.fast;
}

export function autoVideoModel(prompt: string): string {
  if (TALKING.test(prompt)) return VIDEO_AUTO_MODELS.talking;
  return CINEMATIC.test(prompt) ? VIDEO_AUTO_MODELS.cinematic : VIDEO_AUTO_MODELS.fast;
}

export function autoMusicModel(request: { prompt: string; lyrics?: string; kind?: AudioKind }): string {
  if (request.kind === "voice") return MUSIC_AUTO_MODELS.voice;
  if (request.kind === "sound_effect") return MUSIC_AUTO_MODELS.soundEffect;
  if (request.kind === "song") return MUSIC_AUTO_MODELS.song;
  if (request.kind === "music") return MUSIC_AUTO_MODELS.instrumental;
  if (request.lyrics?.trim() || SONG.test(request.prompt)) return MUSIC_AUTO_MODELS.song;
  if (SOUND_EFFECT.test(request.prompt)) return MUSIC_AUTO_MODELS.soundEffect;
  return MUSIC_AUTO_MODELS.instrumental;
}
