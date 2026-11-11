// Auto for media: the fal.ai model that suits a request, chosen from what it asks for. Each list starts with the cheap,
// fast default; a request asking for text in the picture, photographic or cinematic quality, lyrics or a sound effect
// moves to the model built for it.
export const MEDIA_AUTO = "auto";

const TYPOGRAPHY = /\b(logo|poster|affiche|flyer|banni[eè]re|banner|menu|infographi\w*|diagram\w*|sch[ée]ma|typograph\w*|lettering|text|texte|title|titre|slogan|caption|l[ée]gende|sign|panneau)\b/i;
const PHOTOGRAPHIC = /\b(photo\w*|realistic|r[ée]alist\w*|portrait|product shot|packshot|hdr|dslr|35mm|8k|4k|studio lighting)\b/i;
const CINEMATIC = /\b(cin[ée]mati\w*|cinema|film|movie|realistic|r[ée]alist\w*|4k|haute qualit[ée]|high quality|commercial|publicit[ée]|trailer|bande[- ]annonce)\b/i;
const SONG = /\b(song|chanson|lyrics|paroles|sing\w*|chant\w*|vocal\w*|voix|rap|refrain|chorus|couplet|verse)\b/i;
const SOUND_EFFECT = /\b(sound effects?|sfx|effets? sonores?|bruit\w*|bruitage|whoosh|explosion|footsteps?|pas|door|porte|applause|applaudissements?|notification|ding|jingle court)\b/i;

export const IMAGE_AUTO_MODELS = { fast: "fal-ai/flux/schnell", typography: "fal-ai/nano-banana-pro", photographic: "fal-ai/flux-2-pro" } as const;
export const VIDEO_AUTO_MODELS = { fast: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video", cinematic: "fal-ai/kling-video/v3/pro/text-to-video" } as const;
export const MUSIC_AUTO_MODELS = { instrumental: "elevenlabs/music/v2.5", song: "fal-ai/minimax-music/v2.6", soundEffect: "elevenlabs/sound-effects/v3" } as const;

export function autoImageModel(prompt: string): string {
  if (TYPOGRAPHY.test(prompt)) return IMAGE_AUTO_MODELS.typography;
  if (PHOTOGRAPHIC.test(prompt)) return IMAGE_AUTO_MODELS.photographic;
  return IMAGE_AUTO_MODELS.fast;
}

export function autoVideoModel(prompt: string): string {
  return CINEMATIC.test(prompt) ? VIDEO_AUTO_MODELS.cinematic : VIDEO_AUTO_MODELS.fast;
}

export function autoMusicModel(request: { prompt: string; lyrics?: string }): string {
  if (request.lyrics?.trim() || SONG.test(request.prompt)) return MUSIC_AUTO_MODELS.song;
  if (SOUND_EFFECT.test(request.prompt)) return MUSIC_AUTO_MODELS.soundEffect;
  return MUSIC_AUTO_MODELS.instrumental;
}
