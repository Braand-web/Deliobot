import type { CursorState } from "@/components/CursorAvatar";

// The mascot as finished pictures, face included: src/assets/delio-steel/<body>-<px>.webp for its resting face and
// <body>.<expression>-<px>.webp for the others, square, framing the mascot's whole SVG viewBox, at <px> device pixels.
// A body with no pictures keeps the drawn steel finish.
const files = import.meta.glob<string>("../assets/delio-steel/*.{webp,png}", { eager: true, query: "?url", import: "default" });

/** The faces a picture set can carry; every other state borrows the closest one. */
export type PictureExpression =
  | "idle" | "happy" | "thinking" | "working" | "surprised" | "curious" | "listening" | "sad" | "proud" | "sleeping";

export const PICTURE_EXPRESSION: Record<CursorState, PictureExpression> = {
  sleeping: "sleeping",
  waking: "curious",
  idle: "idle",
  listening: "listening",
  thinking: "thinking",
  searching: "thinking",
  working: "working",
  excited: "happy",
  surprised: "surprised",
  suspicious: "curious",
  angry: "sad",
  drowsy: "sleeping",
  happy: "happy",
  curious: "curious",
  confused: "thinking",
  bored: "idle",
  proud: "proud",
  shy: "curious",
  sad: "sad",
  laughing: "happy",
  scared: "surprised",
  playful: "happy",
  celebrate: "proud",
  orbit: "thinking",
  radar: "thinking",
  progress: "working",
  spawning: "surprised",
  humming: "working",
  loading: "working",
  dictating: "listening",
  sending: "working",
  receiving: "curious",
  uploading: "working",
  writing: "working",
  notifying: "surprised",
  alerting: "surprised",
  bouncing: "happy",
  dragging: "surprised",
  "powering-down": "sleeping",
};

export interface SteelImage { body: string; px: number; url: string; expression?: PictureExpression }

export const STEEL_IMAGES: readonly SteelImage[] = Object.entries(files)
  .flatMap(([path, url]) => {
    const match = /\/([a-z]+)(?:\.([a-z]+))?-(\d+)\.(?:webp|png)$/.exec(path);
    if (!match) return [];
    const image: SteelImage = { body: match[1]!, px: Number(match[3]), url };
    if (match[2] && match[2] !== "idle") image.expression = match[2] as PictureExpression;
    return [image];
  })
  .sort((a, b) => a.px - b.px);

/** The smallest image that still has a device pixel for every pixel drawn, or the largest there is; null when this body
 * has none. A state whose expression has no pictures shows the resting face. */
export function steelBodyImage(
  body: string,
  size: number,
  density: number,
  images: readonly SteelImage[] = STEEL_IMAGES,
  state?: CursorState,
): string | null {
  const wanted = state ? PICTURE_EXPRESSION[state] : "idle";
  const own = images.filter((image) => image.body === body);
  const expressed = wanted === "idle" ? [] : own.filter((image) => image.expression === wanted);
  const pool = expressed.length ? expressed : own.filter((image) => !image.expression);
  if (!pool.length) return null;
  const px = size * Math.max(1, density);
  return (pool.find((image) => image.px >= px) ?? pool.at(-1)!).url;
}
