import type { Ring } from "./cursor-face-data"

export const toPath = (ring: Ring) =>
  'M' + ring.map(p => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join('L') + 'Z'

export const clone = (rings: Ring[]): Ring[] =>
  rings.map(r => r.map((p): [number, number] => [p[0], p[1]]))

export const ringCentre = (ring: Ring): [number, number] => {
  let x = 0
  let y = 0
  for (const p of ring) {
    x += p[0]
    y += p[1]
  }
  return [x / ring.length, y / ring.length]
}
