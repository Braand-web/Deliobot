# Presentation deck

Create once logo, palette, and typography are separately approved. Do not ask for another combined approval.

## Intake

Require:

- deck purpose
- audience
- source content
- desired slide count
- exact claims/data
- requested aspect ratio
- existing PPTX template, if any

Do not invent mission, values, market statistics, pricing, claims, contacts, or product variants to fill slides.

## Build

- Existing PPTX → edit its masters/layouts or unpack/repack OOXML locally.
- No template → create a small coherent layout family with an installed PPTX library such as PptxGenJS or python-pptx. Ask before installing a missing package.
- Use approved logo, palette, and fonts.
- Keep all text/shapes editable.
- Keep imagery replaceable.
- Use generated imagery only as optional supporting assets.
- Do not flatten whole slides into images.

Create only slide types required by the content, such as cover, divider, image/copy, comparison, process, data, quote, and closing.

## QA and approval

Render slides for inspection with headless LibreOffice (`soffice --headless --convert-to pdf`, then `pdftoppm`), fix, and re-render. Check overflow, collisions, alignment, font substitution, contrast, and placeholder residue.

Deliver absolute paths to the editable PPTX plus previews/PDF when requested.
