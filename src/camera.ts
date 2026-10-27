// src/camera.ts
// Live camera feed. Frames stay in the <video> element's memory; nothing is recorded.
import type { Key } from './i18n';

export type Facing = 'user' | 'environment';

export class Camera {
  private stream: MediaStream | null = null;
  facing: Facing = 'environment';

  private video: HTMLVideoElement;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  async start(facing: Facing) {
    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    // Laptops report no facingMode; treat their webcam as user-facing.
    const reported = this.stream.getVideoTracks()[0]?.getSettings().facingMode;
    this.facing = reported === 'environment' ? 'environment' : 'user';
    this.video.srcObject = this.stream;
    await this.video.play();
  }

  async flip() {
    await this.start(this.facing === 'user' ? 'environment' : 'user');
  }

  /** The live stream, used when sending this camera to a paired computer. */
  get current() {
    return this.stream;
  }

  /** Front cameras are shown mirrored, like a mirror. */
  get mirrored() {
    return this.facing === 'user';
  }

  async canFlip() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput').length > 1;
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }
}

/** Which translated message explains a camera failure. */
export function cameraErrorKey(err: unknown): Key {
  const name = err instanceof DOMException ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
      return 'err.camBlocked';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'err.camMissing';
    case 'NotReadableError':
      return 'err.camBusy';
    default:
      return 'err.camFailed';
  }
}
