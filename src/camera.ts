// src/camera.ts
// Live camera feed. Frames stay in the <video> element's memory; nothing is recorded.

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

export function cameraErrorMessage(err: unknown) {
  const name = err instanceof DOMException ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
      return 'Camera access is blocked. Allow the camera for this site in your browser settings, then try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device.';
    case 'NotReadableError':
      return 'Another app is using the camera. Close it and try again.';
    default:
      return 'The camera could not start. Reload the page and try again.';
  }
}
