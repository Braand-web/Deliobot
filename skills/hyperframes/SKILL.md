---
name: hyperframes
description: "Animated videos made from HTML: launch films, explainers, kinetic text, charts, captions, slideshows, any shape, rendered to MP4. Use whenever the person asks for this, in any language."
---

# HyperFrames video

HyperFrames writes a video as HTML, CSS and GSAP animation and renders it frame by frame to MP4, so text, charts,
logos and layouts come out sharp and exact, unlike generated video. It runs on this computer: its command line comes
from npm on first use and needs Node.js 22 or later with npm, plus ffmpeg (Deliobot provides ffmpeg by itself).

Check `npx --version` first. When npm is missing, ask the person before installing Node.js LTS (Windows:
`winget install OpenJS.NodeJS.LTS`; macOS: `brew install node`; Linux: their package manager), then continue.

`<SKILLS>` in the guides below is this skill's folder (where this file is). Read the guide for the job first:

| Job | Read |
|---|---|
| Make, edit, animate or render any HyperFrames video | `<SKILLS>/hyperframes/SKILL.md` (always first) |
| The command line: create, check, snapshot, preview, render | `<SKILLS>/hyperframes-cli/SKILL.md` |
| Ready-made blocks: charts, maps, effects, transitions | `<SKILLS>/hyperframes-registry/SKILL.md` |
| Music, sound, images, voice-over, transcripts, grades | `<SKILLS>/media-use/SKILL.md` |
| A video presented as slides | `<SKILLS>/slideshow/SKILL.md` |
| Rebuild a video someone shows you, in HyperFrames | `<SKILLS>/reverse-any-video/SKILL.md` |
| Match the look of a reference | `<SKILLS>/style-sampling/SKILL.md` |

## In Deliobot

- Media: use Deliobot's own tools first (`generate_image`, `edit_image`, `generate_video`, `generate_music`,
  `transcribe_audio`); every one saves a file you can put in the project's `assets/`. Use HeyGen services only when the
  person asks for them and signs in themselves.
- Keep each project in `<sharedBotFolder>/videos/<name>/`. Show snapshots while you work, then the rendered MP4 with
  `attach_file`, and check it with the video-analysis skill before saying it is done.
- Generated footage and HyperFrames mix well: animate titles, captions, charts and the logo in HyperFrames over clips
  made with `generate_video`.

The guides are © HeyGen, under the Apache License 2.0 (`LICENSE`); the usage beacon was removed.
