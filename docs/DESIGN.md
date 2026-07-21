# Design Notes

How the gallery works: architecture, distribution math, the plane↔sphere morph, and performance.

## Architecture — world / camera

Three DOM layers: a fixed `.viewport`, a `.world` layer that carries the camera transform, and 100 `.tile` elements pinned inside the world.

- **Planar roam** — the world is translated (`translate3d(camX, camY, 0)`); tiles stay fixed at their world coordinates `(wx, wy)`. Moving one layer instead of 100 keeps scrolling cheap.
- **Infinite loop** — any tile fully dragged past an edge is teleported one canvas-width/height to the opposite side (`recycle()`), off-screen and seamless in all four directions.
- **Ball** — the world resets to origin; each tile projects to its own screen position every frame.

## Distribution — R2 plastic-constant lattice

Scattering 100 rectangles so they look random yet never overlap and never clump is the hard part. A jittered grid looks mechanical; pure random overlaps and clumps.

We use the **R2 quasirandom lattice** (Martin Roberts): additive recurrence `(a1·i, a2·i) mod 1`, where `a1, a2` derive from the plastic constant (the real root of `x³ = x + 1`).

- More uniform than Poisson-disk sampling (packing ratio ~59.2% vs ~49.4%).
- Lives natively on a torus (`mod 1`), so tiling it for the infinite loop is seamless — zero seam handling.
- Looks non-gridded: locally random, globally ordered. Chaos with hidden order.

A rectangle AABB separation pass (`separateRects`) then guarantees zero corner overlap — something a circular min-distance test can't do.

## Plane ⇄ sphere morph

Scroll (or pinch) drives one `flat` parameter in `[0, 1]`. Each tile's screen position lerps between:

- its **flat home** `(wx + camX, wy + camY)` — the R2 lattice, and
- its **sphere point** — a Fibonacci sphere (golden angle `2.399963` rad) under perspective projection (`s = focal / (focal - z·R)`, near-large / far-small).

`flat = 1` is the pure plane; `flat = 0` the pure sphere. The sphere spins slowly around Y, and the camera is locked dead-center (`vw/2 - cellW/2`) throughout the morph, so nothing drifts off-screen.

At `zoom → 0` the sphere shrinks to center and fades, then a CRT power-off plays: squash to a horizontal line → collapse to a dot → one white afterglow flash → black.

## Performance

100 DOM nodes at 60fps comes down to a few rules:

- **Move one layer, not 100.** Planar scroll is a single `translate3d` on the world.
- **Never skew a big layer.** `translate` just moves an already-rasterized texture (cheap on the GPU); `skew` re-rasterizes the whole `4920×3075` world every frame (expensive).
- **force3D.** World and ball tiles use `translate3d(…, 0)` to stay on GPU compositing layers.
- **Static grain, no blend.** The film-grain overlay is a static texture — no per-frame animation, no `mix-blend-mode` (which would re-composite the full screen every frame).
- **zIndex only on change.** Ball-state stacking is written only when the depth bucket changes.

## Parameters

Tune live via URL query — no code edit:

| Query | Meaning | Default |
|---|---|---|
| `?n=` | image count | 100 |
| `?mind=` | min distance between tiles | 330 |
| `?dens=` | canvas fill density | 0.72 |
| `?lerp=` | inertia camera damping | 0.1 |
| `?draglerp=` | drag follow speed | 0.75 |
| `?fric=` | release friction | 0.93 |
| `?fling=` | inertia strength | 0.5 |
| `?spawn=` | eruption duration | 2.0 |
| `?bspin=` | ball spin speed | 0.0035 |
| `?demo=1` | skip intro → roam | — |
| `?debug=1` | expose frame-step debug hooks | — |

Constants live at the top of [`main.js`](../main.js).
