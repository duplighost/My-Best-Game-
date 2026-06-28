# REVERIE

*An endless world to fall into.*

A first-person, infinite, hand-tuned world of light you wander on a phone or a
computer. Move fast, glide far, follow the glow, ride the grind-lines, find the
memories. There is no wrong way to wander, and the world never ends.

It runs entirely in the browser — no build step, no servers, no accounts. Pure
HTML + ES-module JavaScript + a vendored copy of Three.js. Drag the folder onto
Netlify (or open `index.html` over any static server) and it just runs.

---

## Play

- **Keyboard & mouse:** `WASD` move · mouse look · `Shift` sprint · `Space` jump
  (hold in the air to **glide**) · `Q` dash (it pulls toward what matters) ·
  `Ctrl` slide · `F` / click send light · touch a rail to grind · `J` Atlas ·
  `Esc` pause.
- **Phone:** left thumb to move, right thumb to look, and big buttons for
  **JUMP** (hold to glide), **DASH**, **LIGHT**, **RUN**. Two thumbs, anywhere.

Find **glimmers** (light), **memories** (the heart of each landmark), and
**charms** that change how you move — a second air-dash, a longer glide, faster
rails. Everything you discover is kept in the **Atlas** and saved locally in
your browser.

## The world

Seven moods blend seamlessly into one another as you travel — the Luminous
Plains, the Warm Expanse and its oasis, the Deep Glow forest cut by rivers, the
Quiet Cold of snow and peaks, the Endless City with its grind-lines and second
layer overhead, the Haunted Hollow with a house you can step inside, and the
rare Still Ground where the watcher rests. A giant moon and a ringed planet hang
over all of it, day turns to a starlit aurora-lit night and back, and there are
things to find that mean you well and a few that mean you harm.

The palette is built to read cleanly for green-spectrum color vision: meaning is
carried by brightness, shape, and warm-vs-cool, never by red-vs-green.

## Run it locally

```bash
# from this folder, any static server works:
python3 -m http.server 8000
# then open http://localhost:8000
```

(ES modules need to be served over http, not opened as a `file://` — that's the
only requirement.)

## Deploy

Drag this whole folder into Netlify (or point Netlify at the repo). It's a
static site; `_headers` handles caching. Nothing to configure.

## Under the hood

- `src/engine/` — renderer (ACES + bloom, shader sky, moon/planet/aurora),
  input (pointer-lock + touch), particles/hitstop, procedural audio, save.
- `src/player/` — the first-person controller (the feel: dash, slide, glide,
  grind, momentum) and the camera rig (FOV kick, head-bob, landing dip, lean).
- `src/world/` — infinite chunk streaming, climate-blended biomes, analytic
  terrain + collision, decoration, and the enterable interiors.
- `src/entities/` — gentle creatures, the eerie things, and combat juice.
- `src/ui/` — HUD and the Atlas.

Everything is procedural and seeded, so the same coordinate is always the same
hill, the same tree, the same secret. The world is generated, not stored.
