import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CursorAvatar } from "@/components/CursorAvatar";
import { MASCOT_BODIES } from "../../shared/mascot-bodies";
import { glowTempo, PICTURE_EXPRESSION, STEEL_IMAGES, steelBodyBlink, steelBodyImage, type SteelImage } from "./steel-body";

const images: SteelImage[] = [40, 56, 88, 128, 192, 256].map((px) => ({ body: "cursor", px, url: `/steel/cursor-${px}.webp` }));

describe("Delio's rendered steel body", () => {
  it("picks the smallest image with a device pixel for every pixel drawn, from the popup down to the cursor", () => {
    expect(steelBodyImage("cursor", 20, 2, images)).toBe("/steel/cursor-40.webp");
    expect(steelBodyImage("cursor", 28, 2, images)).toBe("/steel/cursor-56.webp");
    expect(steelBodyImage("cursor", 44, 1, images)).toBe("/steel/cursor-56.webp");
    expect(steelBodyImage("cursor", 96, 2, images)).toBe("/steel/cursor-192.webp");
    expect(steelBodyImage("cursor", 112, 3, images)).toBe("/steel/cursor-256.webp");
    expect(steelBodyImage("cursor", 28, 0, images)).toBe("/steel/cursor-40.webp");
  });

  it("shows the picture for the state's expression, and the resting face when that expression has none", () => {
    const faces: SteelImage[] = [
      ...images,
      ...[40, 256].map((px) => ({ body: "cursor", px, url: `/steel/cursor.happy-${px}.webp`, expression: "happy" as const })),
    ];
    expect(steelBodyImage("cursor", 20, 2, faces, "laughing")).toBe("/steel/cursor.happy-40.webp");
    expect(steelBodyImage("cursor", 112, 2, faces, "happy")).toBe("/steel/cursor.happy-256.webp");
    expect(steelBodyImage("cursor", 20, 2, faces, "idle")).toBe("/steel/cursor-40.webp");
    expect(steelBodyImage("cursor", 20, 2, faces, "sleeping")).toBe("/steel/cursor-40.webp");
    expect(steelBodyImage("cursor", 20, 2, faces)).toBe("/steel/cursor-40.webp");
  });

  it("ships a resting face and every expression in each size", () => {
    const own = STEEL_IMAGES.filter((image) => image.body === "cursor" && !image.blink);
    const sizes = [40, 56, 88, 128, 192, 256];
    for (const expression of [undefined, ...new Set(Object.values(PICTURE_EXPRESSION))].filter((e) => e !== "idle")) {
      expect(own.filter((image) => image.expression === expression).map((image) => image.px)).toEqual(sizes);
    }
  });

  it("blinks with the same face's eyes shut, and only on faces whose eyes are open", () => {
    const sizes = [40, 56, 88, 128, 192, 256];
    for (const face of ["idle", "thinking", "working", "surprised", "curious", "listening", "sad"] as const) {
      const shut = STEEL_IMAGES.filter((image) => image.body === "cursor" && image.blink && (image.expression ?? "idle") === face);
      expect(shut.map((image) => image.px), face).toEqual(sizes);
    }
    expect(steelBodyBlink("cursor", 20, 2, STEEL_IMAGES, "idle")).toMatch(/cursor\.idle\.blink-40\./);
    expect(steelBodyBlink("cursor", 20, 2, STEEL_IMAGES, "searching")).toMatch(/cursor\.thinking\.blink-40\./);
    expect(steelBodyBlink("cursor", 20, 2, STEEL_IMAGES, "happy"), "its eyes are already shut").toBeNull();
    expect(steelBodyBlink("circle", 20, 2, STEEL_IMAGES, "idle")).toBeNull();
    expect(steelBodyImage("cursor", 20, 2, STEEL_IMAGES, "idle")).not.toMatch(/blink/);
  });

  it("breathes the antenna's light quickly at work, slowly at rest, and not at all asleep", () => {
    expect(glowTempo("working")).toBe("fast");
    expect(glowTempo("dictating")).toBe("fast");
    expect(glowTempo("idle")).toBe("slow");
    expect(glowTempo("happy")).toBe("slow");
    expect(glowTempo("sleeping")).toBe("off");
    expect(glowTempo("powering-down")).toBe("off");
  });

  it("draws the blink and the glow over the picture, even paused, and floats only while animated", () => {
    const svg = (paused: boolean) => renderToStaticMarkup(createElement(CursorAvatar, {
      size: 112, silhouette: MASCOT_BODIES.cursor, picture: "/p.webp", pictureBlink: "/b.webp",
      pictureGlow: { x: 133, y: 12, r: 24, tempo: "fast" }, paused,
    }));
    const live = svg(false);
    expect(live).toContain('href="/b.webp"');
    expect(live).toContain("delio-blink");
    expect(live).toContain("delio-glow delio-glow-fast");
    expect(live).toContain("delio-float");
    const still = svg(true);
    expect(still).toContain("delio-blink");
    expect(still).toContain("delio-glow-fast");
    expect(still).not.toContain("delio-float");
  });

  it("keeps the drawn steel for a body with no images", () => {
    expect(steelBodyImage("circle", 44, 2, images)).toBeNull();
    expect(steelBodyImage("cursor", 44, 2, [])).toBeNull();
  });

  it("draws the picture over the whole avatar frame instead of the body and the face", () => {
    const svg = (picture?: string) => renderToStaticMarkup(createElement(CursorAvatar, { size: 112, silhouette: MASCOT_BODIES.cursor, picture }));
    const withPicture = svg("/steel/cursor-256.webp");
    expect(withPicture).toContain('<image href="/steel/cursor-256.webp" x="-15" y="-15" width="258.541" height="258.541" preserveAspectRatio="none"');
    expect(withPicture).not.toMatch(/fill="url\(#[^)]+-grad\)"/);
    expect(withPicture).toMatch(/<g clip-path="url\(#[^)]+-clip\)" visibility="hidden">/);
    expect(svg()).toMatch(/fill="url\(#[^)]+-grad\)"/);
    expect(svg()).not.toContain("<image");
    expect(svg()).not.toContain('visibility="hidden"');
  });
});
