---
name: youtube-thumbnail
description: "Click-worthy YouTube thumbnails and Shorts or Reels covers: one strong concept, the person's own face when they want it, bold readable headline, several variants to compare. Use whenever the person asks for this, in any language."
---

# YouTube thumbnail

One picture that makes the right person click, and tells the truth about the video.

## Ask only what is missing

The video's topic and title and the promise it really keeps; who appears (0 to 3 people: the person's own photo, another
person who agreed, or a generated character); a thumbnail they like for its style (to analyse, never to copy); a logo;
an optional headline of 2 to 4 words; the shape (16:9 for YouTube, 9:16 for Shorts and Reels covers, 4:5 for
Instagram); one picture or about four variants.

## Find the concept

Read `references/thumbnail-frameworks.md`. Brainstorm at least five truthful concepts privately, pick the strongest
curiosity gap with one focal subject and little clutter. A variant set changes the concept, the expression or the camera
take, one at a time.

## Write the prompt, in this order

1. Frame: "bold, punchy YouTube thumbnail, poster-grade, photoreal, high impact, <shape>, one unified frame".
2. The scene from the video, exactly.
3. "No text, no readable labels, no watermark" (the headline is added afterwards).
4. Subjects large in the foreground, chest-up or medium close-up, about half the frame, faces crisply sharp.
5. Only the props or effects that explain the curiosity gap.
6. Composition: one hero on a power third, clear scale hierarchy, depth, strong separation from the background.
7. Background: vivid, high-contrast colour field or environment, soft vignette.
8. Light on people: strong key light sculpting the face, soft fill, rim and hair light.
9. Grade: vivid, glossy, deep blacks, crisp highlights, rich colour (calmer only when the brief is calm or premium).

With the person's photo, use `edit_image` on that photo and start the prompt with: "Keep this exact person: same face,
bone structure, eyes, nose, lips, skin tone and hair; do not beautify or restyle the face. Expression: <emotion>." Then
the frame, scene and light. Without a photo, `generate_image` with the same order.

## Add the headline

Lay the words over the picture in HTML and render it to PNG at 1280×720 (or the cover size) with headless Chrome, as
`references/text-overlay-bake.md` describes: heavy condensed font, all caps, thick outline, hard shadow, 2 to 4 words,
never on the face. Text drawn this way is always spelled right.

## Check before showing

At phone size (about 320 px wide): is the face readable, the idea clear in one second, the text legible? Faces match the
photo? Then show the variants side by side and say which you would pick and why.

Every image and video tool answers with the path of a saved copy: keep it, show the result with `attach_file` when
it is not already attached, and reuse the file for the next edit.
