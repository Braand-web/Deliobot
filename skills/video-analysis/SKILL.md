---
name: video-analysis
description: "Watch and understand a video: what it shows shot by shot, what is said (timestamped transcript), its length, shape, cuts, black frames, silences and loudness. Use for any video the person sent or that you made: to summarise it, answer questions about it, review an ad, check a montage before showing it, find the best moments, or write captions."
---

# Video analysis

Two tools together give you both halves of a video: the pictures and the words.

## 1. The pictures and the facts

`analyze.mjs` sits next to this guide, in this skill's `root`.

```sh
node "<root>/analyze.mjs" --video <file> --out <folder>/analysis --frames 12
```

It answers with one line of JSON (also saved as `analysis.json`):

- `seconds`, `video` (codec, width, height, fps), `audio` (or `null` when there is no sound), `shape`;
- `scenes`: the times, in seconds, where the picture cuts to a new shot;
- `frames`: stills at each cut and evenly in between, each with its time (`--frames` up to 48 for long videos);
- `contactSheet`: one picture with every still in order, the quickest overview;
- `black` and `silence`: spans of black picture or silence, `loudness` (mean and peak in dB).

Look at the contact sheet first, then open the stills you need with your file tools: you see them as pictures. For a
long video, run it again on the part that matters with more frames.

## 2. The words

`transcribe_audio` with the same file gives what is said, with timestamps and the language. Ask for `words: true` when
you need word timing (captions, cutting on a word). It also saves the full transcript as JSON.

## Put them together

Match the transcript's times with the stills' times and describe the video as a sequence: what is seen and said in each
shot. Then answer what the person asked. Useful checks:

- **An ad or a post:** the hook in the first 2 seconds, the product visible early, one message per shot, captions
  readable, the call to action at the end, the length right for the platform.
- **A montage you made:** no black frames or silence where there should be none, the voice not covered by the music
  (peak under about -1 dB, voice clearly above the music), captions in sync, the length and shape as planned.
- **A video the person sent:** summary, key moments with their times, quotes, what could be improved.

Say what you could not tell: a still is not the motion between stills, and a transcript has no tone of voice.

When ffmpeg is not ready yet, the script says so: Deliobot installs it by itself in the background; wait a minute and
run it again.
