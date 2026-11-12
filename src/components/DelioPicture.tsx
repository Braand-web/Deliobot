import { VIEW_SPAN } from "./mascot-motion"

export interface PictureGlow { x: number; y: number; r: number; tempo: 'fast' | 'slow' | 'off' }

/** The glow's gradient, placed in the avatar's <defs> under `${uid}-glow`. */
export function PictureGlowGradient({ uid }: { uid: string }) {
  return (
    <radialGradient id={`${uid}-glow`}>
      <stop offset="0%" stopColor="#9fb4ff" stopOpacity="0.9" />
      <stop offset="45%" stopColor="#8a7dff" stopOpacity="0.35" />
      <stop offset="100%" stopColor="#8a7dff" stopOpacity="0" />
    </radialGradient>
  )
}

/** A mascot drawn from a picture: it floats, blinks and its antenna glows, all in CSS, still when motion is reduced. */
export function DelioPicture({ uid, picture, blink, glow, phase, paused, reduced }: {
  uid: string; picture: string; blink?: string | null; glow?: PictureGlow | null; phase: number; paused: boolean; reduced: boolean
}) {
  const still = paused || reduced
  return (
    <g className={still ? undefined : 'delio-float'} style={still ? undefined : { animationDelay: `${-phase}s` }}>
      <image href={picture} x="-15" y="-15" width={VIEW_SPAN} height={VIEW_SPAN} preserveAspectRatio="none" />
      {blink && !reduced && (
        <image href={blink} x="-15" y="-15" width={VIEW_SPAN} height={VIEW_SPAN} preserveAspectRatio="none"
          className="delio-blink" style={{ animationDelay: `${-phase}s` }} />
      )}
      {glow && glow.tempo !== 'off' && (
        <circle cx={glow.x} cy={glow.y} r={Math.min(glow.r * 2.2, glow.y + 15)} fill={`url(#${uid}-glow)`}
          className={reduced ? undefined : `delio-glow delio-glow-${glow.tempo}`} style={reduced ? { opacity: 0.55 } : undefined} />
      )}
    </g>
  )
}
