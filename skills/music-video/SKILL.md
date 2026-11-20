---
name: music-video
description: "Music videos: performance, narrative or abstract visuals cut to the beat. Use whenever the person asks for this kind of image or video, in any language."
---

# Music video

Music videos: performance, narrative or abstract visuals cut to the beat.

## Make it

- Every media tool answers with the path of a saved copy of what it made: keep those paths, they are the material for
  the edit.
- Video shots: `generate_video` with the finished prompt (in English, apart from spoken lines), `seconds` (10 at most per
  shot) and `aspect` (`9:16` for TikTok, Reels, Shorts and stories; `1:1` for the feed; `16:9` for YouTube, websites and
  TV). A plan or example longer than 10 s is several shots: make each one, then join them in order (see below).
- Stills, key frames and mood boards: `generate_image` (`1:1`, `16:9` or `9:16`). To change a photo the person gave (a
  real product, a real place, a real face), use `edit_image` on that file so the real thing stays exact.
- Music, sound effects and voice-over: `generate_music` (`kind` music, sound_effect or voice).
- A video costs much more than an image: show the person the plan (shots, length, shape) and the first prompt, and
  generate once they agree. Make a still of the key frame first when the look is uncertain.
- Describe what is seen, never a trademark the person does not own, a real person's likeness without their consent, or
  copyrighted characters.

## Put it together

A piece longer than one shot, or with a voice-over, music or captions, is edited with the built-in video-montage skill:
read its SKILL.md and run its `montage.mjs` with the saved shots in order. Look at a few stills of the result before
attaching it with `attach_file`.

## Write the prompt

1. **Gather intent** — Confirm: song genre, visual strategy (performance / narrative /
   abstract), target platform, aspect ratio, mood/aesthetic, desired clip duration.

2. **Build the prompt** — Use the craft references below:
   - Beat-sync techniques, energy mapping, hook framework, camera techniques:
     [references/beat-sync.md](references/beat-sync.md)
   - Genre-specific visual language, colors, lighting, trigger words:
     [references/genres.md](references/genres.md)
   - Master template and worked example prompts:
     [references/examples.md](references/examples.md)

3. **Plan segments** — Because each clip is 10 s at most, map the song's structure to
   for multi-segment planning.

4. **Present for review** — Show the assembled prompt and all parameters to the user for
   review and refinement **before** any generation call.

## References

Read the one you need, next to this guide:

| File | Contents |
|---|---|
| `references/beat-sync.md` | Beat-visual synchronization philosophy, 12 music-video hook styles, 7 beat-sync techniques (timing references, energy mapping, frequency-responsive effects, syncopation visuals), energy arc table, performance/narrative/abstract strategies, camera techniques, multi-segment strategy |
| `references/genres.md` | Genre visual language guide for 10 genres (hip-hop, pop, rock/metal, EDM, R&B, lo-fi, classical, jazz, country, K-pop) with color palettes, lighting approaches, trigger words, visual hooks, and example prompts |
| `references/examples.md` | Master template, 5 worked music-video prompts (hip-hop performance, pop ballad, EDM abstract, R&B narrative, K-pop choreography), lyric video technique table |
