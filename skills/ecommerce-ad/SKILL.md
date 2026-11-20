---
name: ecommerce-ad
description: "Product ads for online selling, as video or still: fashion, beauty, electronics, food, jewellery. Use whenever the person asks for this kind of image or video, in any language."
---

# E-commerce ad

Product ads for online selling, as video or still: fashion, beauty, electronics, food, jewellery.

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

1. **Gather intent** — Confirm: product category (fashion, beauty, electronics, food,
   jewelry, home, fitness…), request type (product-only, lifestyle, unboxing, DTC
   still), target platform, aspect ratio, desired duration, and visual tone.

2. **Build the prompt** — Use the craft principles in the references below:
   - Opening 2-second hook from [references/hooks.md](references/hooks.md)
   - Product staging, lighting, value communication, lifestyle context from
     [references/ad-craft.md](references/ad-craft.md)
   - Worked example prompts by product category and platform from
     [references/examples.md](references/examples.md)

3. **Present for review** — Show the assembled prompt and all parameters to the user
   for review and refinement **before** any generation call.

## References

Read the one you need, next to this guide:

| File | Contents |
|---|---|
| `references/ad-craft.md` | DTC/e-commerce ad craft: product staging, lighting, multi-angle techniques, lifestyle integration, text/CTA guide, quick-cut patterns, sound design |
| `references/hooks.md` | 2-second hook framework with 12 proven e-commerce hooks and prompt phrasing templates |
| `references/examples.md` | Master template + 5 full example prompts by product category (fashion, skincare, electronics, food/beverage, jewelry) |
