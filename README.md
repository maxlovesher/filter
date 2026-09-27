# fiilter

Grade photos and videos with Lightroom-style templates — build a look once, apply it to everything.

Everything runs in your browser on the GPU (WebGL2). Photos and videos never leave your computer.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (recipe parser, curves, .xmp, LUTs, template strength)
npm run build      # static site in dist/ — host it anywhere (Netlify, Vercel, GitHub Pages…)
```

## Deploy

It's a static site — any static host works. Easiest: push the project to GitHub, then import the repo in
[Vercel](https://vercel.com/new) or [Netlify](https://app.netlify.com/start). They detect Vite automatically
(build command `npm run build`, output folder `dist`) and redeploy on every push.

## Featured templates (for every visitor)

Drop exported template files (`*.fiilter.json`) into [`templates/`](templates/README.md) and push.
They're built into the site and appear under **Featured** for everyone. Templates users save themselves
stay in their own browser.

## What it does

**Make a template once**
- Every Lightroom panel, with Lightroom's names and ranges so reel recipes can be typed in as-is:
  Light · Color (white balance, vibrance, saturation) · Color Mixer (all 8 colors × hue/sat/lum) ·
  Color Grading (shadows / midtones / highlights / global wheels, blending, balance) · Tone Curve (RGB + R/G/B) ·
  Effects (texture, clarity, dehaze, vignette + details, grain + details) · LUT (.cube)
- Click any number to type a value; double-click a slider to reset it.
- Name it and **Save** — templates are kept in the browser.
- Or: **Import** → paste recipe text (`Exposure +0.6, Contrast -30, Orange: Hue +13 …`), Lightroom `.xmp` presets,
  fiilter template files, or `.cube` LUTs. Dropping files on the window works too.

**Reuse it**
- Drop in any number of photos/videos, click a template — every item gets the look (or just the current one).
- Hover a template to preview it on the big image; each template shows a live thumbnail of your photo.
- **Template strength** (0–200 %) to dial a look up or down.
- Tweak one item without touching the template; **Copy / Paste** settings (Ctrl+C / Ctrl+V) between items;
  **Apply to all** copies the current edit everywhere.
- Undo / redo (Ctrl+Z / Ctrl+Shift+Z), before/after split view, hold `\` for the original, histogram.

**Videos**
- MP4 / MOV / WebM play back with the look applied live.
- Set **[ Start / End ]** to trim; the export only contains that part.
- Exports MP4 (H.264 when available) and keeps the original sound.

**Export**
- Full-resolution JPG/PNG (or 4K / 2048 / 1080 px for Instagram), one file or a ZIP, or straight into a folder
  (Chrome/Edge). Each item keeps its own settings.
- **Export as .cube LUT** turns any template into a LUT for CapCut, Premiere, VN, Resolve or phone apps.
  LUTs hold color only — grain, clarity, texture, dehaze and vignette can't be part of a LUT.

## Notes

- The math is modelled on Lightroom, not copied from it (Adobe's is private): the same numbers give a very similar
  look, sometimes needing a small nudge.
- iPhone HEIC photos (including recent iOS files) are converted automatically with libheif via `heic-to`;
  the ~3 MB decoder is loaded only when a HEIC file is added, and each photo takes a couple of seconds.
  RAW files aren't supported; some HEVC videos depend on your browser/GPU.
- Photos and videos live only in the open tab. Templates and LUTs are saved in this browser —
  use **Export all** on the template list to back them up or move them to another computer.

## Code map

| Path | What |
| --- | --- |
| `src/engine/shaders.ts` | The whole develop pipeline as one GLSL fragment shader |
| `src/engine/renderer.ts` | WebGL2 renderer: source texture, blur pyramid, curve LUT, 3D LUT |
| `src/engine/video.ts` | Frame-by-frame video grading + MP4 encoding (mediabunny, lazy-loaded) |
| `src/engine/export.ts` | Batch export to files / ZIP / folder |
| `src/engine/bake.ts` | Bakes a look into a `.cube` LUT |
| `src/lib/defaults.ts` | Settings model, merging, template strength, built-in looks |
| `src/lib/recipe.ts` | Recipe text parser |
| `src/lib/xmp.ts` | Lightroom `.xmp` preset reader |
| `src/lib/luts.ts` | `.cube` parser/writer and LUT library |
| `src/App.tsx` | App state: items, templates, undo/redo, import/export |
