---
name: ugc-video-ads
description: "Video ads that sell: UGC-style creators talking about the product, unboxings, tutorials, reviews, try-ons, polished TV spots and product showcases, with script, voice, music and captions. Use whenever the person asks for this, in any language."
---

# UGC and video ads

Short ads built to stop the scroll and sell one product, from a script to a finished, captioned video.

## Pick the format

| Format | Feels like | Best for |
|---|---|---|
| ugc | a real person filming on their phone, talking to camera | default; trust, relatability |
| tutorial | "here is how to use it", hands and steps | products that need showing |
| unboxing | "it just arrived", the reveal | gifts, packaging, launches |
| review | a person giving their honest opinion | considered purchases |
| try-on | clothing or accessories worn and turned | fashion, beauty |
| showcase | the product itself, polished, little presenter | design objects, tech |
| tv spot | broadcast commercial, cinematic, a tagline | brand campaigns |

Ask only what is missing: the product (a photo and its page or facts), the offer, the audience, the platform and shape
(9:16 for TikTok, Reels, Shorts and stories; 1:1 or 4:5 for the feed; 16:9 for YouTube and TV), the length (15, 20 or
30 s), language, and how many variants. Facts, prices and claims come from the person; never invent a result, a
testimonial or a number, and never present a generated person as a real customer.

## Write the script

- **Hook (0 to 2 s):** a pattern interrupt, a bold claim the product truly backs, a question or a problem shown.
- **Problem and product (2 to 8 s):** the pain, then the product as the answer, on screen early.
- **Proof (8 to 20 s):** the product working, a detail close-up, a benefit per shot.
- **Call to action (last 3 s):** what to do and the offer, spoken and on screen.

About 2.5 spoken words a second. One idea per shot; shots of 2 to 5 seconds for UGC, longer for a TV spot.

## Make it

1. Key frame: `edit_image` on the product photo for the opening shot (the product must stay exact) or `generate_image`.
   Show it with the script before spending on video.
2. Shots: `generate_video`, 5 to 10 seconds each, in the agreed shape. For a presenter speaking, put the spoken line in
   quotes, in its language, in the prompt, describe the person the same way in every shot (see the consistent-character
   skill), and phone-camera framing for UGC ("handheld selfie video, natural window light, casual home setting").
3. Voice-over (when the presenter does not speak on camera): `generate_music` with `kind: "voice"` and the exact words.
   Music: `generate_music` with `kind: "music"`, genre and tempo matching the platform.
4. Edit with the video-montage skill: shots in order, `--voice`, `--music`, `--captions` (UGC ads nearly always need
   them: most people watch muted).
5. Variants: change the hook only, keep the rest, so the person can test which hook wins.

Show the finished ad with its length, shape and the script, and offer the next variant.
