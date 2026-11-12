import { readFileSync } from "node:fs";

/** The mascot pictures from the app's own assets, read once at start. */
export function mascotAssets(): Map<string, Uint8Array> {
  return new Map(["idle", "happy", "sad", "curious"].map((expression) => {
    const file = expression === "idle" ? "cursor-88.webp" : `cursor.${expression}-88.webp`;
    return [`/assets/delio-${expression}.webp`, readFileSync(new URL(`../../../src/assets/delio-steel/${file}`, import.meta.url))] as const;
  }));
}
