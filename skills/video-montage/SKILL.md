---
name: video-montage
description: "Edit generated or supplied clips and pictures into one finished video: joins shots in order, fits them to 9:16, 16:9, 1:1 or 4:5, adds a voice-over and music ducked under the voice, burns in captions, fades in and out. Use whenever a video is longer than one generated shot, needs a voice-over, music or subtitles, or the person asks to edit, cut, join or caption a video."
---

# Video montage

`montage.mjs` sits next to this guide, in this skill's `root`. It needs Node 18 or later and ffmpeg. Every media tool
(`generate_video`, `generate_image`, `edit_image`, `generate_music`) answers with the path of a saved copy of what it
made: those paths, and the person's own files, are the material.

```sh
node "<root>/montage.mjs" --out <folder>/final.mp4 --aspect 9:16 \
  --voice voice.mp3 --music music.mp3 --captions captions.json \
  shot1.mp4 shot2.mp4 picture.png:3 shot3.mp4
```

- Clips play in the order given. A picture takes `path:seconds` (3 s when absent) and gets a slow push-in.
- `--aspect` is `9:16` (TikTok, Reels, Shorts, stories, WhatsApp status), `16:9` (YouTube, website, TV), `1:1` or `4:5`
  (feed). Clips of another shape are cropped to fill the frame; `--pad` letterboxes them instead.
- `--voice` lays the voice-over from the start. `--music` loops under the whole video, at `--music-volume` (0.3 by
  default) and lower still whenever the voice speaks. `--keep-clip-audio` keeps the clips' own sound too.
- `--captions` takes an `.srt` file, or JSON: `[{"start": 0, "end": 2.4, "text": "…"}, …]` in seconds. Keep each cue to
  two short lines, in the language of the voice-over, timed to it.
- `--no-fade` drops the short fade in and out.

It answers with one line of JSON: `out`, `seconds`, `width`, `height`, `audio`. Deliobot installs ffmpeg by itself in
the background; when the script says it is not ready yet, wait a minute and run it again.

## Before showing it

Check it with the video-analysis skill (`analyze.mjs` on the result): look at the contact sheet and a few stills for
framing, captions readable and not covering a face or the product; no `black` spans; no `silence` where the voice should
be; `seconds` as planned. Then attach the
video with `attach_file` and say its length and shape.

## Timing a voice-over

Speech runs at about 2.5 words a second. Write the script to the planned length, generate the voice with
`generate_music` (`kind: "voice"`), read its real length with `ffprobe`, and fit the shots to the voice, not the voice to
the shots.
