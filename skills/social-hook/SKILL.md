---
name: social-hook
description: "Scroll-stopping first seconds for TikTok, Reels and Shorts. Use whenever the person asks for this kind of image or video, in any language."
---

# Social video hook

Scroll-stopping first seconds for TikTok, Reels and Shorts.

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

1. **Gather intent** — Confirm with the user: content category (comedy, transformation,
   product, story, etc.), platform (TikTok/Reels/Shorts), target aspect ratio, desired
   duration, and whether native audio is needed.

2. **Build the hook prompt** — Use the craft principles and the 25+ hook patterns from
   [references/hook-craft.md](references/hook-craft.md):
   - Identify the hook type (visual shock, curiosity gap, emotional trigger, pattern
     interrupt, or direct address) and the 2-second master template structure.
   - Apply per-platform optimization from
     [references/platforms.md](references/platforms.md).
   - Reference worked prompts by category from
     [references/examples.md](references/examples.md).

3. **Present for review** — Show the assembled prompt, hook structure, aspect
   ratio, and duration to the user for review and refinement before any generation call.

## References

Read the one you need, next to this guide:

| File | Contents |
|---|---|
| `references/hook-craft.md` | Hook psychology (5 attention triggers), the full 25+ proven hook pattern encyclopedia, the 2-second master template, retention techniques, sound strategy, text overlay strategy, and common mistakes |
| `references/platforms.md` | Per-platform optimization (TikTok/Reels/Shorts), content-category playbooks (comedy, educational, satisfying, transformation, BTS, reaction, storytime, product, lifestyle), trending format templates, and analytics-driven iteration guidance |
| `references/examples.md` | 5 production-ready worked hook prompts (satisfying transformation, comedy skit, product reveal, emotional story, impossible visual) with full timing breakdowns and parameter settings |
