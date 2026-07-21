# Infinite Gallery

English · [中文](README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-2E6B4F.svg)](LICENSE) ![build: none](https://img.shields.io/badge/build-none-2b2622.svg) ![WebGL: none](https://img.shields.io/badge/WebGL-none-d98e3a.svg) ![GSAP 3.15](https://img.shields.io/badge/GSAP-3.15-88CE02.svg)

> 100 photos erupt from the center, roam an infinite plane, gather into a spinning 3D sphere, then power off like an old CRT — in pure DOM + CSS + GSAP, **zero WebGL**.

<div align="center">
  <img src="assets/screenshots/sphere.jpg" width="90%" alt="100 grayscale photos gathered into a slowly spinning 3D sphere">
  <br><sub>Scroll in — all 100 images gather into a slowly spinning 3D sphere, always centered.</sub>
</div>

## Interaction

| Stage | Input | What happens |
|---|---|---|
| **Intro** | click / tap | images erupt from the center, burst into a golden-angle disc, scatter into a sparse plane |
| **Roam** | drag / arrow keys | infinite scroll in all four directions, throw-to-glide inertia; hover reveals color |
| **Sphere** | wheel / pinch | plane ⇄ Fibonacci sphere in one continuous morph (slow spin, always centered) |
| **Power-off** | scroll / pinch to the end | rocket-shrink + CRT shutdown: squash to a line → dot → white afterglow → black |

<div align="center">
  <img src="assets/screenshots/roam.jpg" width="90%" alt="Sparse photos scattered across an infinite roam plane">
  <br><sub>Drag to roam an infinite plane in any direction — hover reveals color.</sub>
</div>

## How it works

- **Pure DOM + CSS + GSAP**, ES modules, no build tool — clone and run.
- **R2 plastic-constant lattice** scatters 100 images: more uniform than Poisson-disk, seamless on a torus, chaos with hidden golden order.
- **Rectangle AABB separation** removes every corner overlap.
- **Fibonacci sphere + perspective projection** drive the plane ⇄ sphere morph.
- **World / camera architecture** — one transform layer carries an infinite canvas; off-screen recycle loops it four ways.

Full technical notes: [docs/DESIGN.md](docs/DESIGN.md).

## Run

```bash
python3 -m http.server 5173
# open http://localhost:5173
```

Pure static, zero build — deploy the repo root to any static host (Cloudflare Pages, GitHub Pages, Netlify).

## Tuning

Live URL-query tuning, no code edit: `?n=100` `?mind=330` `?dens=0.72` `?demo=1` … (full table in [docs/DESIGN.md](docs/DESIGN.md)).

## Test

```bash
node --test test/geometry.test.js
```

## Author

**Infinite Gallery** is independently created and maintained by **BLCaptain (爆裂队长NEXT)**.

- GitHub: [@dososo](https://github.com/dososo)
- X / Twitter: [@thinkszyg](https://x.com/thinkszyg)
- Email: blteam2026@outlook.com

Feedback and requests welcome via [Issues](https://github.com/dososo/infinite-image-gallery/issues). If this project helps you, a Star is appreciated.

## License

MIT — see [LICENSE](LICENSE). Image assets are from [Unsplash](https://unsplash.com) under the Unsplash License; per-photo credits in [assets/credits.md](assets/credits.md).
