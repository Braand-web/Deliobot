---
name: consistent-character
description: "Keeps the same face across pictures and videos: the founder, a brand ambassador or a mascot, from a few photos or one approved portrait, for ads, posts, thumbnails and series. Use whenever the person asks for this, in any language."
---

# Consistent character

Keep one identity across many pictures and clips: the person themselves (their own photos, with their consent), an
invented brand ambassador, or a mascot.

## Set the character up once

1. **A real person:** ask for 3 to 10 clear photos (see `references/photo-guide.md`). Pick the sharpest, front-facing,
   evenly lit one as the **anchor**. Use a real person's face only when that person is the one asking or has agreed.
2. **An invented character:** make three candidate portraits with `generate_image` from a detailed description, and let
   the person choose one: that portrait is the anchor.
3. Write a **character sheet** and keep it with the anchor's path in your memory or with `project_note`: age range, face
   shape, skin tone, eyes, hair (colour, length, texture, style), distinctive marks, build, usual clothing and colours,
   expression range. The sheet is copied word for word into every later prompt.

## Make new pictures of them

- `edit_image` on the **anchor** file, never on a previous result, so the face does not drift: "Keep this exact person:
  same face, bone structure, eyes, nose, lips, skin tone and hair. Show them <scene>, <framing>, <light>, <expression>."
- Change one thing at a time (place, outfit, pose, light). Framing from chest-up to medium shot keeps the face most
  faithful; full-body shots drift more.
- Compare each result with the anchor before showing it. Redo the ones where the face changed.

## Put them in a video

`generate_video` has no picture input: start each clip's prompt with the character sheet, word for word, then the action
and the camera. Keep clips short (5 s) and close on the face. For a speaking presenter, make the voice with
`generate_music` (`kind: "voice"`) and keep the same voice description every time.

Every image and video tool answers with the path of a saved copy: keep it, show the result with `attach_file` when
it is not already attached, and reuse the file for the next edit.

## Never

Make someone look like a real person who has not agreed, put a real person in a compromising, political, medical or
sexual scene, or present a generated person as a real customer or a real testimonial.
