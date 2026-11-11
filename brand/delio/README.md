# Delio brand

- `icon/` — the app icon. `delio-icon-source.webp` is the original artwork;
  `icon-1024.png` (macOS grid with shadow), `app-icon-512.png` and
  `app-icon-192.png` are cut out on a transparent background.
- `mascot-3d/` — the 3D model of the mascot (three.js). Each expression is a
  URL parameter: `mascot.html?expr=happy`.
- `renders/` — the ten expressions at 1024 px, and a sheet of all of them.

The app shows the mascot from `src/assets/delio-steel/cursor-<px>.webp`
(resting face) and `cursor.<expression>-<px>.webp` (the others), in six
sizes. `src/lib/steel-body.ts` maps each of the app's states to one of the
ten expressions.

## Rendering again

```bash
cd brand/delio/mascot-3d && npm install
```

```bash
python3 -m http.server 8765
```

Then, from another terminal in the same folder:

```bash
npm run render
```
