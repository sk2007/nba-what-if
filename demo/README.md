# Demo video

A 37-second product demo of NBA What If, built with [HyperFrames](https://hyperframes.heygen.com) (HTML + GSAP rendered to MP4).

It walks through Rockets 117, Warriors 116 (Apr 5, 2026): the full-game win-probability curve, flipping Sengun's Q4 0:11 layup to Missed (Warriors 5% → 84%), the rewritten final two minutes, and the Clutch Index.

## Render

Requires Node >= 22 and FFmpeg.

From this directory:

```bash
npm run check     # lint, runtime, layout, contrast
npm run dev       # preview in the browser studio
npm run render    # render to MP4
```

Or `npx hyperframes@0.9.37 render -o nba-what-if-demo.mp4`.

## Notes

- `index.html` holds the whole composition. Scene timing lives in each `<section data-start data-duration>` and the GSAP timeline at the bottom.
- The chart paths in scenes 3 and 5 are baked from `/api/games/0022501142/playbyplay` and `/api/wp/recompute` (override: event 463 → Missed).
- Screenshots in `assets/` were captured from the local app at 1600×900.
- The soundtrack is `assets/audio/carry_me_home.mp3`, starting at 2:31.4 (`data-media-start` on `#music`) at 0.6 volume because the master is hot.
