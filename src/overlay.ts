// src/overlay.ts
// Draws a chalk-line skeleton and face outline over the live video.
import {
  FaceLandmarker,
  PoseLandmarker,
  type FaceLandmarkerResult,
  type NormalizedLandmark,
  type PoseLandmarkerResult,
} from '@mediapipe/tasks-vision';

// Shoulders, arms, hands and hips only — the pose model's own face points are skipped.
const BODY = PoseLandmarker.POSE_CONNECTIONS.filter((c) => c.start >= 11 && c.end >= 11 && c.start <= 24 && c.end <= 24);
const FACE = [
  ...FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
  ...FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,
  ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
  ...FaceLandmarker.FACE_LANDMARKS_LIPS,
];
const JOINTS = [11, 12, 13, 14, 15, 16, 23, 24];

const CHALK = 'rgba(237, 230, 214, 0.8)';
const CHALK_FAINT = 'rgba(237, 230, 214, 0.4)';
const AMBER = '#F2A65A';

export class Overlay {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private video: HTMLVideoElement;

  constructor(canvas: HTMLCanvasElement, video: HTMLVideoElement) {
    this.canvas = canvas;
    this.video = video;
    this.ctx = canvas.getContext('2d')!;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  draw(pose: PoseLandmarkerResult | null, face: FaceLandmarkerResult | null, highlight: Set<number>) {
    const { canvas, ctx, video } = this;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    // Match the video's object-fit: cover crop.
    const s = Math.max(w / vw, h / vh);
    const ox = (w - vw * s) / 2;
    const oy = (h - vh * s) / 2;
    const X = (p: NormalizedLandmark) => ox + p.x * vw * s;
    const Y = (p: NormalizedLandmark) => oy + p.y * vh * s;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const lm = pose?.landmarks[0];
    if (lm) {
      const seen = (i: number) => (lm[i].visibility ?? 0) > 0.35;
      ctx.lineWidth = 3;
      for (const { start, end } of BODY) {
        if (!seen(start) || !seen(end)) continue;
        ctx.strokeStyle = highlight.has(start) && highlight.has(end) ? AMBER : CHALK;
        ctx.beginPath();
        ctx.moveTo(X(lm[start]), Y(lm[start]));
        ctx.lineTo(X(lm[end]), Y(lm[end]));
        ctx.stroke();
      }
      for (const i of JOINTS) {
        if (!seen(i)) continue;
        ctx.fillStyle = highlight.has(i) ? AMBER : CHALK;
        ctx.beginPath();
        ctx.arc(X(lm[i]), Y(lm[i]), 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const fl = face?.faceLandmarks[0];
    if (fl) {
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = CHALK_FAINT;
      ctx.beginPath();
      for (const { start, end } of FACE) {
        ctx.moveTo(X(fl[start]), Y(fl[start]));
        ctx.lineTo(X(fl[end]), Y(fl[end]));
      }
      ctx.stroke();
    }
  }
}
