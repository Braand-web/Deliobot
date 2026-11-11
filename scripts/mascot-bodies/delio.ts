/**
 * The Delio pack: sprout, owl, fox, bear, bunny, penguin, octopus, robot, cloud, frog.
 *
 * Every drawing lives in a 240-unit square centred on x = 120.
 *
 * Loaded by `node --experimental-strip-types`, so only erasable type syntax.
 */

import { box, circle, ellipse, grow, intersect, mirror, polygon, polyStroke, smooth, stroke, union } from "./draw.ts"
import { GREY, INK, LIGHT_GREY, type Def } from "./carved.ts"

const CREAM = "#f6f2ec"
const BEAK = "#f2a33a"
const BLUSH = "#f2b8c6"
const SCREEN = "#1b1d22"
const SCREEN_INK = "#7ff0c9"

const sprout = ellipse(120, 152, 98, 80)
const sproutStem = stroke([120, 78], [119, 64], [121, 52], [123, 42], 5, 4)
const sproutLeaves = union(
  grow(polygon([[121, 46], [102, 26], [80, 30], [98, 46]]), 5),
  grow(polygon([[124, 44], [144, 22], [168, 24], [150, 42]]), 5),
)

const owlTufts = mirror(grow(polygon([[40, 74], [44, 24], [86, 54]]), 6))
const owl = smooth(10, ellipse(120, 142, 90, 94), owlTufts)
const owlBelly = intersect(grow(owl, -1), ellipse(120, 214, 60, 40))
const owlBeak = grow(polygon([[112, 160], [128, 160], [120, 174]]), 3)

const foxEars = mirror(grow(polygon([[52, 112], [42, 32], [102, 88]]), 6))
const foxCheeks = mirror(grow(polygon([[34, 146], [10, 184], [62, 192]]), 4))
const fox = smooth(10, ellipse(120, 152, 90, 72), foxEars, foxCheeks)
const foxInnerEars = mirror(grow(polygon([[62, 98], [56, 56], [88, 84]]), 3))
const foxMuzzle = intersect(grow(fox, -1), ellipse(120, 204, 62, 40))
const foxNose = ellipse(120, 180, 11, 7.5)

const bear = smooth(8, ellipse(120, 152, 94, 82), mirror(circle(46, 86, 30)))
const bearInnerEars = mirror(circle(48, 90, 15))
const bearMuzzle = ellipse(120, 190, 40, 30)
const bearNose = ellipse(120, 176, 11, 8)

const bunnyEars = mirror(ellipse(90, 62, 21, 58))
const bunny = smooth(8, ellipse(120, 164, 90, 72), bunnyEars)
const bunnyInnerEars = mirror(ellipse(90, 66, 9, 40))

const penguinFlippers = mirror(ellipse(36, 162, 18, 46))
const penguin = smooth(6, ellipse(120, 140, 86, 100), penguinFlippers)
const penguinFace = intersect(grow(penguin, -6), smooth(10, ellipse(96, 128, 34, 42), ellipse(144, 128, 34, 42), ellipse(120, 170, 54, 52)))
const penguinFeet = mirror(ellipse(92, 238, 24, 9))
const penguinBeak = grow(polygon([[110, 150], [130, 150], [120, 164]]), 3)

const octoLegs = [56, 88, 120, 152, 184].map((x) => {
  const out = x === 120 ? 0 : x < 120 ? -16 : 16
  return stroke([x, 140], [x, 188], [x + out, 212], [x + out * 1.6, 228], 19, 10)
})
const octopus = smooth(10, ellipse(120, 104, 88, 82), ...octoLegs)

const robotHead = box(30, 62, 210, 216, 42)
const robotAntenna = polyStroke([[120, 64, 5], [120, 28, 5]])
const robotBulb = circle(120, 24, 13)
const robotEars = mirror(box(14, 112, 36, 166, 8))
const robotScreen = box(52, 88, 188, 194, 32)

const cloud = smooth(8, circle(78, 140, 52), circle(132, 112, 64), circle(178, 148, 46), box(36, 140, 210, 204, 32))

const frog = smooth(12, ellipse(120, 164, 106, 66), mirror(circle(70, 100, 36)))
const frogCheeks = mirror(ellipse(50, 184, 14, 9))

export const DELIO: Def[] = [
  {
    id: "sprout", name: "Sprout", paint: "bot", bone: null, face: sprout,
    eyes: { cx: 120, cy: 150, dx: 34, w: 26, h: 50, round: 44, ink: INK },
    parts: [[sproutStem, GREY], [sproutLeaves, "accent"], [sprout, "body"]],
  },
  {
    id: "owl", name: "Owl", paint: "bot", bone: null, face: owl,
    eyes: { cx: 120, cy: 126, dx: 36, w: 30, h: 50, round: 48, ink: INK, mouth: false },
    parts: [[owl, "body"], [owlBelly, CREAM], [owlBeak, BEAK]],
  },
  {
    id: "fox", name: "Fox", paint: "bot", bone: null, face: fox,
    eyes: { cx: 120, cy: 144, dx: 32, w: 24, h: 44, round: 40, ink: INK, mouthY: 198 },
    parts: [[fox, "body"], [foxInnerEars, GREY], [foxMuzzle, CREAM], [foxNose, INK]],
  },
  {
    id: "bear", name: "Bear", paint: "bot", bone: null, face: bear,
    eyes: { cx: 120, cy: 136, dx: 36, w: 24, h: 42, round: 40, ink: INK, mouthY: 198 },
    parts: [[bear, "body"], [bearInnerEars, GREY], [bearMuzzle, CREAM], [bearNose, INK]],
  },
  {
    id: "bunny", name: "Bunny", paint: "pale", bone: null, face: bunny,
    eyes: { cx: 120, cy: 160, dx: 34, w: 24, h: 44, round: 40, ink: INK },
    parts: [[bunny, "body"], [bunnyInnerEars, BLUSH]],
  },
  {
    id: "penguin", name: "Penguin", paint: "bot", bone: null, face: penguinFace,
    eyes: { cx: 120, cy: 126, dx: 26, w: 20, h: 38, round: 34, ink: INK, mouth: false },
    parts: [[penguinFeet, BEAK], [penguin, "body"], [penguinFace, CREAM], [penguinBeak, BEAK]],
  },
  {
    id: "octopus", name: "Octopus", paint: "bot", bone: null, face: octopus,
    eyes: { cx: 120, cy: 108, dx: 32, w: 26, h: 48, round: 44, ink: INK },
    parts: [[octopus, "body"]],
  },
  {
    id: "robot", name: "Robot", paint: "bot", bone: null, face: robotScreen,
    eyes: { cx: 120, cy: 134, dx: 32, w: 22, h: 40, round: 38, ink: SCREEN_INK },
    parts: [[robotAntenna, LIGHT_GREY], [robotBulb, "accent"], [robotEars, LIGHT_GREY], [robotHead, "body"], [robotScreen, SCREEN]],
  },
  {
    id: "cloud", name: "Cloud", paint: "pale", bone: null, face: cloud,
    eyes: { cx: 120, cy: 148, dx: 32, w: 24, h: 44, round: 40, ink: INK },
    parts: [[cloud, "body"]],
  },
  {
    id: "frog", name: "Frog", paint: "bot", bone: null, face: frog,
    eyes: { cx: 120, cy: 100, dx: 50, w: 26, h: 40, round: 38, ink: INK, mouthY: 176 },
    parts: [[frog, "body"], [frogCheeks, BLUSH]],
  },
]
