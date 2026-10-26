// src/main.ts
import QRCode from 'qrcode';
import './style.css';
import { Camera, cameraErrorMessage, type Facing } from './camera';
import { CueEngine } from './cues';
import { Detector } from './detector';
import { Overlay } from './overlay';
import { DesktopLink, isLocalOnlyHost, isPhoneOrTablet, pairCodeFromUrl, pairUrl } from './pairing';
import { Panel } from './panel';
import { startSender } from './phone';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const intro = $('intro');
const live = $('live');
const startBtn = $<HTMLButtonElement>('start');
const usePhoneBtn = $<HTMLButtonElement>('use-phone');
const introError = $('intro-error');
const video = $<HTMLVideoElement>('video');
const canvas = $<HTMLCanvasElement>('overlay');
const status = $('status');
const statusText = $('status-text');
const liveSource = $('live-source');
const flipBtn = $<HTMLButtonElement>('flip');
const overlayBtn = $<HTMLButtonElement>('toggle-overlay');
const stopBtn = $<HTMLButtonElement>('stop');

const pair = $('pair');
const pairStatus = $('pair-status');
const pairError = $('pair-error');
const pairQr = $<HTMLCanvasElement>('pair-qr');
const pairCode = $('pair-code');
const pairCancel = $<HTMLButtonElement>('pair-cancel');
const pairCopy = $<HTMLButtonElement>('pair-copy');

const camera = new Camera(video);
const overlay = new Overlay(canvas, video);
const panel = new Panel();

type Source = 'local' | 'phone';

let source: Source = 'local';
let link: DesktopLink | null = null;
let detectorLoad: Promise<Detector> | null = null;
let detector: Detector | null = null;
let engine = new CueEngine();
let running = false;
let showOverlay = true;
let frameId = 0;
let lastVideoTime = -1;
const startLabel = isPhoneOrTablet() ? 'Start camera' : 'Use this computer’s camera';

function setStatus(text: string | null) {
  status.hidden = !text;
  statusText.textContent = text ?? '';
}

function showIntroError(text: string) {
  introError.textContent = text;
  introError.hidden = false;
}

function applyMirror(mirrored: boolean) {
  video.classList.toggle('-scale-x-100', mirrored);
  canvas.classList.toggle('-scale-x-100', mirrored);
}

function resetReading() {
  engine = new CueEngine(); // a new view means new baselines
  panel.reset();
}

/** Starts loading the models once; pairing kicks this off early so it's ready when the phone connects. */
function loadDetector() {
  detectorLoad ??= Detector.create().then((d) => (detector = d));
  return detectorLoad;
}

function showScreen(screen: 'intro' | 'pair' | 'live') {
  intro.hidden = screen !== 'intro';
  pair.hidden = screen !== 'pair';
  live.hidden = screen !== 'live';
}

/** Shared by both sources once frames are arriving in the <video> element. */
async function beginReading() {
  showScreen('live');
  if (!detector) {
    setStatus('Loading the on-device models. The first visit downloads a few megabytes.');
    try {
      await loadDetector();
    } catch (err) {
      console.error(err);
      detectorLoad = null;
      setStatus('The models didn’t load. Check your connection, then reload the page.');
      return;
    }
  }
  setStatus(null);
  resetReading();
  running = true;
  lastVideoTime = -1;
  cancelAnimationFrame(frameId);
  frameId = requestAnimationFrame(loop);
}

// ---- This device's camera -----------------------------------------------

async function startLocal() {
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
    startBtn.textContent = startLabel;
    return;
  }

  source = 'local';
  liveSource.textContent = 'On device. Nothing is saved.';
  applyMirror(camera.mirrored);
  camera.canFlip().then((can) => (flipBtn.hidden = !can));
  await beginReading();
}

// ---- A paired phone's camera (desktop only) -----------------------------

function startPairing() {
  introError.hidden = true;
  pairError.hidden = true;
  pairCopy.disabled = true;
  pairCode.textContent = '';
  pairQr.getContext('2d')?.clearRect(0, 0, pairQr.width, pairQr.height);
  showScreen('pair');

  if (isLocalOnlyHost()) {
    pairStatus.textContent = 'Your phone can’t open “localhost”.';
    pairError.textContent =
      'Run npm run dev:phone and open this page on its Network address, or use your deployed site. Then try again.';
    pairError.hidden = false;
    return;
  }

  loadDetector().catch(() => (detectorLoad = null)); // warm up while the phone scans
  pairStatus.textContent = 'Creating a code…';

  link = new DesktopLink({
    onReady: async (code) => {
      const url = pairUrl(code);
      await QRCode.toCanvas(pairQr, url, {
        width: 216,
        margin: 0,
        errorCorrectionLevel: 'M',
        color: { dark: '#0f2a2eff', light: '#ede6d6ff' },
      });
      pairCopy.disabled = false;
      pairCopy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(url);
          pairCopy.textContent = 'Link copied';
        } catch {
          pairCopy.textContent = 'Copy failed';
        }
        setTimeout(() => (pairCopy.textContent = 'Copy link'), 2000);
      };
      pairCode.textContent = `Code ${code.slice(0, 4)} ${code.slice(4, 8)} ${code.slice(8)}`;
      pairStatus.textContent = 'Waiting for your phone…';
    },
    onStream: (stream) => {
      source = 'phone';
      liveSource.textContent = 'Phone camera. Nothing is saved.';
      flipBtn.hidden = false;
      applyMirror(false); // phones start on the back camera
      video.srcObject = stream;
      video.play().catch(() => {});
      beginReading();
    },
    onFacing: (facing: Facing) => {
      applyMirror(facing === 'user');
      if (running) resetReading();
    },
    onClose: (reason) => {
      link = null;
      if (!live.hidden) stop(reason);
      else if (!pair.hidden) {
        pairStatus.textContent = 'This code stopped working.';
        pairError.textContent = `${reason} Go back and try again.`;
        pairError.hidden = false;
      }
    },
  });
}

function cancelPairing() {
  link?.close();
  link = null;
  showScreen('intro');
}

// ---- Shared loop and controls --------------------------------------------

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
  link?.close();
  link = null;
  video.srcObject = null;
  overlay.clear();
  setStatus(null);
  flipBtn.hidden = true;
  showScreen('intro');
  startBtn.disabled = false;
  startBtn.textContent = startLabel;
  if (note) showIntroError(note);
}

startBtn.addEventListener('click', startLocal);
usePhoneBtn.addEventListener('click', startPairing);
pairCancel.addEventListener('click', cancelPairing);
stopBtn.addEventListener('click', () => stop());

flipBtn.addEventListener('click', async () => {
  if (source === 'phone') {
    link?.flip(); // the phone switches and reports its new facing back
    return;
  }
  flipBtn.disabled = true;
  try {
    await camera.flip();
    applyMirror(camera.mirrored);
    resetReading();
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

// ---- Start-up ------------------------------------------------------------

const code = pairCodeFromUrl();
if (code) {
  // Opened from a desktop's QR code: this phone only sends its camera.
  startSender(code);
} else {
  startBtn.textContent = startLabel;
  usePhoneBtn.hidden = isPhoneOrTablet();

  // Privacy: this device's camera never keeps running in the background.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && running && source === 'local') {
      stop('The camera turned off when you left the page. Start it again when you’re ready.');
    }
  });
  window.addEventListener('pagehide', () => {
    camera.stop();
    link?.close();
  });
}

// Dev-only hook for previewing the panel without a person in front of the camera.
if (import.meta.env.DEV) Object.assign(window, { __tells: { panel } });
