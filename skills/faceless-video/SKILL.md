---
name: faceless-video
description: "Finished narrated videos with nobody on camera: explainers, stories, mini-documentaries, top-10s, picture stories and children's songs, from a topic, a script or a document, in any language. Use whenever the person asks for this, in any language."
---

# Faceless video

One finished video with a single visual style and a narration, built from a topic, a script or a document.

## Agree on the brief first

Topic or source, length (30 s, 60 s, 3 min…), shape (9:16 for Shorts, Reels and TikTok; 16:9 for YouTube), language,
style (illustrated, photoreal, 3D, paper cut-out, watercolour…), voice (gender, age, tone), music or not, captions or
not, and which mode:

- **motion:** a generated clip per block, for most explainers and stories;
- **picture story:** still pictures with a slow push-in, cheaper and calmer, good for long pieces and children;
- **song:** a children's song or a sung explainer: the song first, then pictures cut to it.

Tell the person roughly how many images, clips and audio tracks it takes before generating, since each one costs.

## Make it

1. **Script.** For factual topics, check reliable sources and keep a short source list. Write one narration line per
   block of about 8 to 10 seconds (about 20 to 25 words), never cutting a sentence across blocks. For a picture story,
   one beat per picture of 3 to 5 seconds.
2. **Style key.** One `generate_image` that fixes the look (palette, medium, light, characters). Copy its style
   description word for word into every later prompt, and keep any recurring character's description identical (see
   the consistent-character skill).
3. **Voice.** One `generate_music` with `kind: "voice"` and the whole narration, or one per block for long pieces, always
   with the same voice description. Read the real length with `ffprobe`; when it is far from the plan, rewrite the text
   rather than speeding the voice.
4. **Pictures or clips.** One per block or beat, in order: a still with `generate_image` in the style key, then, in
   motion mode, that still passed as `image` to `generate_video` (`seconds` up to 10, describing motion and camera, never
   the spoken words), so every clip keeps the style and the characters. Look at the first one before making the rest.
5. **Music.** For a song, `generate_music` with `kind: "song"` and the lyrics; otherwise optional background music.
6. **Captions.** When asked, write the cues as JSON (`start`, `end`, `text`) timed to the narration: about 2.5 words a
   second, two short lines per cue.
7. **Edit** with the video-montage skill: the clips or `picture.png:seconds` in order, `--voice`, `--music`,
   `--captions`, the agreed `--aspect`. Fit the pictures' seconds to the voice's real length.
8. **Check** three moments against the script (picture matches the words, captions in sync), then attach the video and
   give its length, shape, language and the sources.

Keep the project in `<sharedBotFolder>/videos/<title>/` so it can be edited later: change one block, regenerate only
that block, edit again.
