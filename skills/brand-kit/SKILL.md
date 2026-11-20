---
name: brand-kit
description: "A complete visual identity: brand direction, colour palette, typography, logo, mockups, social templates, packaging, signage and a brand book as PDF; or the extension of an existing brand. Use whenever the person asks for this, in any language."
---

# Brand kit

Build an identity that holds together, or extend the one the person has. What they already own (logo, colours, fonts,
name) is fixed: never redraw an official logo, never change approved colours.

## Steps, each approved before the next

1. **Intake** (`references/intake.md`): name, what they sell and to whom, three adjectives, competitors, what they like
   and dislike, where the brand will live (shop, Instagram, packaging, signage). One message, choices where possible.
2. **Direction:** two or three short concept boards (`references/brandkit-design-brain.md`):
   a name for each direction, mood words, palette idea, type idea, one picture each with `generate_image`.
3. **Palette** (`references/palette.md`): 5 to 7 colours with hex codes and roles (primary, secondary, accent, neutrals,
   background, text). Check text contrast (4.5:1 for body text). Show it as a small HTML board you write and screenshot.
4. **Typography** (`references/typography.md`): a heading and a body font, free Google Fonts unless they own others,
   with sizes. Show a specimen board in HTML.
5. **Logo** (`references/logo-prompt-enhancer.md`): three candidates with `generate_image` on a
   plain background, 1:1. A wordmark or monogram can also be drawn as an SVG you write by hand with the chosen font,
   which stays sharp at any size. Let the person choose, then refine only the chosen one.
6. **Applications** the person needs: mockups with `edit_image` on a photo of the real object
   or a generated blank scene, social templates, packaging (`references/packaging.md`), signage (`references/signage.md`),
   merchandise (`references/merchandise.md`), posters and banners (`references/posters-banners.md`), a short
   presentation deck (`references/presentation-deck.md`).
7. **Brand book**: one HTML document (logo and its clear space, palette with hex and RGB,
   type scale, do and don't, examples), printed to PDF with headless Chrome or Edge
   (`--headless --print-to-pdf=<file> <html>`). Keep every file in `<sharedBotFolder>/brand/<name>/`.

Check every step with `references/qa-and-iteration.md` before showing it.

Every image and video tool answers with the path of a saved copy: keep it, show the result with `attach_file` when
it is not already attached, and reuse the file for the next edit.

## Never

Copy another company's logo, mascot or trade dress, or promise that a logo is free to register as a trademark.
