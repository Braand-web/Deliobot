---
name: cartoon-animation
description: "2D cartoon animation: cel-shaded, hand-drawn, flat vector, watercolour, kids' styles. Use whenever the person asks for this kind of image or video, in any language."
---

# Cartoon animation

2D cartoon animation: cel-shaded, hand-drawn, flat vector, watercolour, kids' styles.

## Make it

- Every media tool answers with the path of a saved copy of what it made: keep those paths, they are the material for
  the edit.
- Video shots: `generate_video` with the finished prompt (in English, apart from spoken lines), `seconds` (10 at most per
  shot) and `aspect` (`9:16` for TikTok, Reels, Shorts and stories; `1:1` for the feed; `16:9` for YouTube, websites and
  TV). A plan or example longer than 10 s is several shots: make each one, then join them in order (see below).
- **Animate a picture** (a key frame you made, the person's photo, a comic panel, a product shot): pass its path as
  `image` to `generate_video`. It becomes the first frame, so the look, the face or the product stays exact; the prompt
  then describes only the motion, the camera and what changes.
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

1. **Gather intent** — Confirm with the user: cartoon style (Disney, Cartoon Network,
   flat vector, Ghibli, pixel art, etc.), character/subject, tone (comedic, whimsical,
   dramatic), target platform, aspect ratio, and desired duration.

2. **Build the prompt** — Use the craft principles in the references below:
   - Opening hook (2-second cartoon attention-capture technique) from
     [references/hooks.md](references/hooks.md)
   - Art style, animation principles, color palette, character design from
     [references/animation-craft.md](references/animation-craft.md)
   - Worked example prompts by style from
     [references/examples.md](references/examples.md)

3. **Present for review** — Show the assembled prompt and all parameters to the user for
   review and refinement **before** any generation call. The user must approve the prompt
   text, aspect ratio, and duration.

## References

Read the one you need, next to this guide:

| File | Contents |
|---|---|
| `references/animation-craft.md` | 15+ art style encyclopedia, 12 animation principles in prompt language, character design principles, color palettes (8+), line-work styles, background approaches, character animation keywords, transition and effect library |
| `references/hooks.md` | 2-second hook framework with 10+ cartoon hook techniques, prompt integration phrases, hook selection guide by tone, and advanced hook-stacking guidance |
| `references/examples.md` | Master prompt template, 5 full production-quality cartoon example prompts (Warner Bros. action, Ghibli peaceful, flat vector explainer, retro rubber hose, comedy skit), style deployment guide, and common-mistakes fix table |
