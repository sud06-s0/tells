// src/detector.ts
// Runs MediaPipe pose + face models in the browser (WebAssembly / WebGL).
// Video frames are passed in memory and never leave the device.
import {
  FaceLandmarker,
  FilesetResolver,
  PoseLandmarker,
  type FaceLandmarkerResult,
  type PoseLandmarkerResult,
} from '@mediapipe/tasks-vision';

const base = import.meta.env.BASE_URL;

const MODELS = {
  pose: {
    local: `${base}models/pose_landmarker_lite.task`,
    remote:
      'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
  },
  face: {
    local: `${base}models/face_landmarker.task`,
    remote:
      'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
  },
};

/** Use self-hosted models from /public/models when present (npm run models), else Google's copy. */
async function resolveModel({ local, remote }: { local: string; remote: string }) {
  try {
    const res = await fetch(local, { method: 'HEAD' });
    const type = res.headers.get('content-type') ?? '';
    if (res.ok && !type.includes('text/html')) return local;
  } catch {
    /* fall through */
  }
  return remote;
}

async function withGpuFallback<T>(make: (delegate: 'GPU' | 'CPU') => Promise<T>) {
  try {
    return await make('GPU');
  } catch {
    return make('CPU');
  }
}

export interface Frame {
  pose: PoseLandmarkerResult | null;
  face: FaceLandmarkerResult | null;
}

export class Detector {
  private lastT = 0;
  private frame = 0;
  private avgMs = 0;
  private lastFace: FaceLandmarkerResult | null = null;

  private pose: PoseLandmarker;
  private face: FaceLandmarker;

  private constructor(pose: PoseLandmarker, face: FaceLandmarker) {
    this.pose = pose;
    this.face = face;
  }

  static async create() {
    const wasmPath = new URL(`${base}wasm`, location.href).href;
    const [fileset, posePath, facePath] = await Promise.all([
      FilesetResolver.forVisionTasks(wasmPath),
      resolveModel(MODELS.pose),
      resolveModel(MODELS.face),
    ]);

    const pose = await withGpuFallback((delegate) =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: posePath, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      }),
    );
    const face = await withGpuFallback((delegate) =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: facePath, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      }),
    );
    return new Detector(pose, face);
  }

  detect(video: HTMLVideoElement, now: number): Frame {
    const t = Math.max(now, this.lastT + 1); // timestamps must strictly increase
    this.lastT = t;
    const started = performance.now();

    const pose = this.pose.detectForVideo(video, t);
    // On slower phones, run the face model every other frame.
    const slow = this.avgMs > 45;
    if (!slow || this.frame % 2 === 0) this.lastFace = this.face.detectForVideo(video, t);
    this.frame++;

    this.avgMs += 0.1 * (performance.now() - started - this.avgMs);
    return { pose, face: this.lastFace };
  }

  close() {
    this.pose.close();
    this.face.close();
  }
}
