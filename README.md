<!-- README.md -->
# Tells

Live body-language reading from a phone or laptop camera. Pose and face models run in the browser, so no video, photos or landmarks are saved or sent anywhere. Each frame is read and dropped.

Built with TypeScript, Tailwind CSS v4, Vite and Google MediaPipe Tasks Vision (Apache 2.0, free).

## Modes

| Mode | Camera points at | What you get |
| --- | --- | --- |
| Read someone | Another person (asks you to confirm they know) | What their posture, gestures and expression can suggest |
| Interview practice | You, sitting | Tips on eye contact, posture and nervous habits, then a summary |
| Presentation practice | You, standing | Tips on gestures, facing your audience and stance, then a summary |
| Video call check (desktop) | You, during a call | One reminder at a time when a habit lasts too long, plus a summary |

Practice modes start with a few seconds of calibration so the tips fit your normal posture. The summary shows what went well, what to work on with a tip for each, and average openness, engagement and tension. It's kept in memory only and is gone when you leave the page.

In **Video call check**, **Pop out** opens a small always-on-top window (Chrome and Edge on desktop) so reminders stay visible over Zoom, Meet or Teams. Without the pop-out, leaving the tab turns the camera off as usual.

## Languages

English, Bengali (বাংলা) and Hindi (हिन्दी). Switch from the top of the start screen. The choice is remembered on that device, and a paired phone opens in the same language. All text is in `src/i18n/`: `en.ts` is the source, and TypeScript fails the build if `bn.ts` or `hi.ts` is missing a string.

## What Tells won't do

No lie detection, no "are they attracted to me" readings, no scoring of job candidates or students, and no hidden or background mode. Body language can't reliably answer those questions, and judging people's emotions at work or school is restricted in some places (for example under the EU AI Act). Reading someone else requires ticking that they know and are okay with it.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173 on this computer
npm run dev:phone    # HTTPS on your Wi-Fi, open the "Network" URL on your phone
```

Phones only allow the camera on HTTPS pages. `dev:phone` uses a self-signed certificate, so your phone will show a warning the first time. Tap through it ("Advanced" then "Proceed").

## Use your phone as the camera (desktop only)

On a computer, the start screen has a second button: **Use your phone's camera**.

1. Click it. A QR code appears.
2. Scan it with your phone and tap **Share camera**.
3. Point the phone at the person. The skeleton and reading appear on the computer.

The phone's video goes directly to the computer over WebRTC, encrypted end to end. The free PeerJS cloud server is only used to introduce the two devices and never sees the video. Nothing is recorded on either device. The computer can switch the phone's camera, and stopping on either side ends the session on both.

Notes:
- The QR code needs an address your phone can reach, so it won't work from `localhost`. Use `npm run dev:phone` and open the **Network** address on the computer too, or use the deployed site.
- Both devices on the same Wi-Fi is the most reliable. Across different networks (for example, phone on mobile data) some connections can't be made without a TURN relay server.
- To use your own connection server instead of PeerJS cloud, run `npx peer --port 9000` and copy `.env.example` to `.env`.

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
src/main.ts       app wiring: screens, modes, calibration, render loop
src/modes.ts      the four modes and how each treats a cue
src/session.ts    in-memory practice stats for the summary
src/nudges.ts     video call reminders
src/pip.ts        video call pop-out window
src/i18n/         English, Bengali and Hindi strings
src/camera.ts     camera start, flip, stop
src/pairing.ts    phone-to-desktop link (QR code, WebRTC)
src/phone.ts      phone screen that shares its camera
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
