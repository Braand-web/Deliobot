---
name: brand-story
description: "Brand films: origin stories, mission films, company culture, founder stories. Use whenever the person asks for this kind of image or video, in any language."
---

# Brand story film

Brand films: origin stories, mission films, company culture, founder stories.

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

1. **Gather intent** — Confirm with the user: brand story type (origin, manifesto,
   customer transformation, behind-the-scenes, etc.), emotional register (inspirational,
   warm/nostalgic, bold, calm/trustworthy), target platform, aspect ratio, desired
   duration, and whether native audio or a location still is needed.

2. **Build the prompt** — Use the craft principles and templates from the references:
   - Opening hook (2-second attention-capture) from
     [references/hooks.md](references/hooks.md)
   - Narrative arc, emotional register, camera/lighting, voiceover from
     [references/narrative-craft.md](references/narrative-craft.md)
   - Worked example prompts by brand type from
     [references/examples.md](references/examples.md)

3. **Present for review** — Show the assembled prompt and all parameters to the user for
   review and refinement before any generation call. The user must approve the prompt
   text, aspect ratio, and duration.

## References

Read the one you need, next to this guide:

| File | Contents |
|---|---|
| `references/narrative-craft.md` | Brand storytelling philosophy, 10+ narrative arc structures, industry-specific approaches, emotional register guide, visual metaphor library, camera/lighting/color guidance, voiceover techniques, sound design, and effectiveness checklist |
| `references/hooks.md` | 12 essential brand story hooks, hook-stacking techniques, platform-specific hook guidance, and hook-to-narrative-arc matching table |
| `references/examples.md` | Master template for brand story prompts, 5 production-ready worked example prompts by brand type (tech startup, artisan food, fashion manifesto, health/wellness, creative agency), brand story brief template, and platform deployment guide |
