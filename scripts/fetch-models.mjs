// scripts/fetch-models.mjs
// Optional: download the MediaPipe models into public/models so the app
// serves them itself instead of fetching from Google at runtime.
import { mkdir, writeFile } from 'node:fs/promises';

const MODELS = {
  'pose_landmarker_lite.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
  'face_landmarker.task':
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
};

const dir = new URL('../public/models/', import.meta.url);
await mkdir(dir, { recursive: true });

for (const [name, url] of Object.entries(MODELS)) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed for ${name}: ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  await writeFile(new URL(name, dir), bytes);
  console.log(`Saved public/models/${name} (${(bytes.length / 1e6).toFixed(1)} MB)`);
}
