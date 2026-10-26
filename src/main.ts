// src/main.ts
import './style.css';
import { Camera, cameraErrorMessage } from './camera';
import { CueEngine } from './cues';
import { Detector } from './detector';
import { Overlay } from './overlay';
import { Panel } from './panel';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const intro = $('intro');
const live = $('live');
const startBtn = $<HTMLButtonElement>('start');
const introError = $('intro-error');
const video = $<HTMLVideoElement>('video');
const canvas = $<HTMLCanvasElement>('overlay');
const status = $('status');
const statusText = $('status-text');
const flipBtn = $<HTMLButtonElement>('flip');
const overlayBtn = $<HTMLButtonElement>('toggle-overlay');
const stopBtn = $<HTMLButtonElement>('stop');

const camera = new Camera(video);
const overlay = new Overlay(canvas, video);
const panel = new Panel();

let detector: Detector | null = null;
let engine = new CueEngine();
let running = false;
let showOverlay = true;
let frameId = 0;
let lastVideoTime = -1;

function setStatus(text: string | null) {
  status.hidden = !text;
  statusText.textContent = text ?? '';
}

function showIntroError(text: string) {
  introError.textContent = text;
  introError.hidden = false;
}

function applyMirror() {
  video.classList.toggle('-scale-x-100', camera.mirrored);
  canvas.classList.toggle('-scale-x-100', camera.mirrored);
}

async function start() {
  introError.hidden = true;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    showIntroError('The camera only works on a secure page. Open this app over https:// (or on localhost).');
    return;
  }

  startBtn.disabled = true;
  startBtn.textContent = 'Starting…';
  try {
    await camera.start('environment'); // phones: back camera to look at someone else
  } catch (err) {
    showIntroError(cameraErrorMessage(err));
    startBtn.disabled = false;
    startBtn.textContent = 'Start camera';
    return;
  }

  intro.hidden = true;
  live.hidden = false;
  applyMirror();
  camera.canFlip().then((can) => (flipBtn.hidden = !can));

  if (!detector) {
    setStatus('Loading the on-device models. The first visit downloads a few megabytes.');
    try {
      detector = await Detector.create();
    } catch (err) {
      console.error(err);
      setStatus('The models didn’t load. Check your connection, then reload the page.');
      return;
    }
  }
  setStatus(null);

  engine = new CueEngine();
  panel.reset();
  running = true;
  lastVideoTime = -1;
  frameId = requestAnimationFrame(loop);
}

function loop() {
  if (!running) return;
  frameId = requestAnimationFrame(loop);
  if (!detector || video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  const t = performance.now();
  const { pose, face } = detector.detect(video, t);
  const reading = engine.update(pose, face, t, video.videoWidth / video.videoHeight);
  panel.render(reading);
  if (showOverlay) overlay.draw(pose, face, reading.highlight);
}

function stop(note?: string) {
  running = false;
  cancelAnimationFrame(frameId);
  camera.stop();
  overlay.clear();
  setStatus(null);
  live.hidden = true;
  intro.hidden = false;
  startBtn.disabled = false;
  startBtn.textContent = 'Start camera';
  if (note) showIntroError(note);
}

startBtn.addEventListener('click', start);
stopBtn.addEventListener('click', () => stop());

flipBtn.addEventListener('click', async () => {
  flipBtn.disabled = true;
  try {
    await camera.flip();
    applyMirror();
    engine = new CueEngine(); // a new view means new baselines
    panel.reset();
  } catch (err) {
    stop(cameraErrorMessage(err));
  } finally {
    flipBtn.disabled = false;
  }
});

overlayBtn.addEventListener('click', () => {
  showOverlay = !showOverlay;
  overlayBtn.setAttribute('aria-pressed', String(showOverlay));
  overlayBtn.setAttribute('aria-label', showOverlay ? 'Hide skeleton' : 'Show skeleton');
  if (!showOverlay) overlay.clear();
});

// Privacy: the camera never keeps running in the background.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running) stop('The camera turned off when you left the page. Start it again when you’re ready.');
});
window.addEventListener('pagehide', () => camera.stop());

// Dev-only hook for previewing the panel without a person in front of the camera.
if (import.meta.env.DEV) Object.assign(window, { __tells: { panel } });
