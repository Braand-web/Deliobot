---
name: video-style-reverse
description: "Reverse-engineers the editing style of any video (pacing, cuts, colour grade, sound, speech pace, text and structure) with evidence for each finding, writes a reusable style file, then rebuilds that style on the person's own topic and checks the rebuild against the original. Use whenever the person asks for this, in any language."
---

# Video style reverse-engineering

A finished video hides how it was made, but most of its style can be measured. `style.mjs` (next to this guide) builds on
the video-analysis skill: cuts, shot lengths, colour, sound and, with a transcript, speech pace.

## 1. Measure

Start with a short section (30 to 60 seconds) of the video the person gives:

```sh
node "<root>/style.mjs" --video <file> --out <folder>/style-original --frames 16
```

Then `transcribe_audio` on the same file with `words: true`, save the JSON, and run again with
`--transcript <that file>` to add words per minute, talking time and pauses.

## 2. Read and label every finding

`style.json` holds the measured findings, each marked `"evidence": "seen"` with how it was measured, plus two lists:

- `toInfer`: look at the contact sheet and stills and fill these in yourself (text style, framing, camera motion,
  transitions, graphics, the hook, the structure), each marked **inferred** with the reason.
- `unknown`: what a finished file cannot tell (software, exact fonts, effects, sound effects). Say so; never guess.

Write the result as a style guide the person can read: pacing, look, text, sound, structure, and a shot-by-shot
template of the first 15 seconds. The cut count is a minimum: jump cuts with little change in the picture are missed.

## 3. Rebuild on the person's topic

Use their own material and subject, never the original's footage, voice, characters or brand. Plan shots to the measured
shot lengths, grade the stills toward the measured palette, match the speech pace in the script, and make it with the
media tools and the video-montage skill.

## 4. Compare and fix

```sh
node "<root>/style.mjs" --video <rebuild> --out <folder>/style-rebuild
node "<root>/style.mjs" --compare <folder>/style-original/style.json --with <folder>/style-rebuild/style.json
```

It scores each dimension from 0 to 1 and lists the gaps in plain words (cut faster, warmer grade, louder mix…). Fix the
largest gaps, measure again, and show the person both contact sheets side by side.

Studying a style is fine; copying someone's video, footage or brand is not. Rules on reuse differ by country.
