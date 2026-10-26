<!-- README.md -->
# Tells

Live body-language reading from a phone or laptop camera. Pose and face models run in the browser, so no video, photos or landmarks are saved or sent anywhere. Each frame is read and dropped.

Built with TypeScript, Tailwind CSS v4, Vite and Google MediaPipe Tasks Vision (Apache 2.0, free).

## Run it

```bash
npm install
npm run dev          # http://localhost:5173 on this computer
npm run dev:phone    # HTTPS on your Wi-Fi, open the "Network" URL on your phone
```

Phones only allow the camera on HTTPS pages. `dev:phone` uses a self-signed certificate, so your phone will show a warning the first time. Tap through it ("Advanced" then "Proceed").

## Deploy

```bash
npm run build        # outputs dist/
```

Upload `dist/` to any static host: Vercel, Netlify, Cloudflare Pages or GitHub Pages. They all serve HTTPS, so the camera works on phones.

## Models

By default the two models (about 9 MB total) download from Google's MediaPipe storage the first time someone opens the app. Browsers cache them after that.

To serve them from your own site instead:

```bash
npm run models       # saves them to public/models/
```

The app checks `public/models/` first and only falls back to Google when the files are missing. The WebAssembly runtime is already self-hosted in `public/wasm/`.

## How it reads someone

| Signal | How it's measured |
| --- | --- |
| Arms crossed, hands on hips, hand near face | Wrist and elbow positions relative to the shoulders, nose and hips |
| Gesturing, fidgeting | Wrist movement range and back-and-forth reversals over 2 seconds |
| Leaning in or back | Shoulder depth vs hips, or apparent size vs their own normal when hips are out of frame |
| Body turned away | Depth difference between the shoulders |
| Shoulders raised | Neck length compared with that person's own baseline |
| Smiling, brows, lips pressed | Face blendshape scores |
| Eye contact, looking away or down | Head angle plus eye direction blendshapes |
| Head tilt, nodding, shaking | Head roll, and pitch/yaw reversals over 1.5 seconds |
| Blinking a lot | Blink onsets per minute over 30 seconds (after 15 seconds of data) |

These cues roll up into openness, engagement and tension scores, and the headline is chosen from them. Every threshold lives in `src/cues.ts` if you want to tune it.

## Files

```
src/main.ts       app wiring, start/stop, render loop
src/camera.ts     camera start, flip, stop
src/detector.ts   MediaPipe pose + face models
src/cues.ts       landmarks → cues, scores and headline
src/geometry.ts   smoothing, baselines, time windows, head angles
src/overlay.ts    skeleton and face outline drawing
src/panel.ts      reading panel rendering
src/style.css     Tailwind theme tokens
scripts/fetch-models.mjs   optional model download
```

## Limits

Body language gives cues, not thoughts. Crossed arms can just mean someone is cold. The app reads one person at a time and works best at 1.5 to 3 metres with the upper body in frame. Some places restrict emotion recognition, for example in workplaces and schools under the EU AI Act. Ask people before pointing it at them.
