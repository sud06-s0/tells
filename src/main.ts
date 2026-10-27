// src/main.ts
import QRCode from 'qrcode';
import './style.css';
import { Camera, cameraErrorKey, type Facing } from './camera';
import { CueEngine, type Reading } from './cues';
import { Detector } from './detector';
import { applyI18n, getLang, num, onLangChange, t, type Key } from './i18n';
import { MODES, cueLabelKey, cueTextKey, isModeId, verdict, type Mode, type ModeId } from './modes';
import { Nudger, type NudgeKey } from './nudges';
import { Overlay } from './overlay';
import { DesktopLink, isLocalOnlyHost, isPhoneOrTablet, pairCodeFromUrl, pairUrl } from './pairing';
import { Panel } from './panel';
import { startSender } from './phone';
import { canPopOut, popOut } from './pip';
import { Session, type Summary, type SummaryItem } from './session';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// Screens
const intro = $('intro');
const pair = $('pair');
const live = $('live');
const summaryEl = $('summary');

// Start screen
const startBtn = $<HTMLButtonElement>('start');
const usePhoneBtn = $<HTMLButtonElement>('use-phone');
const introError = $('intro-error');
const noteRead = $('note-read');
const noteSelf = $('note-self');
const consentRow = $('consent-row');
const consent = $<HTMLInputElement>('consent');

// Live screen
const stage = $('stage');
const video = $<HTMLVideoElement>('video');
const canvas = $<HTMLCanvasElement>('overlay');
const status = $('status');
const statusText = $('status-text');
const liveSource = $('live-source');
const timer = $('timer');
const flipBtn = $<HTMLButtonElement>('flip');
const overlayBtn = $<HTMLButtonElement>('toggle-overlay');
const stopBtn = $<HTMLButtonElement>('stop');
const calibrateBox = $('calibrate');
const calibCount = $('calib-count');
const calibTitle = $('calib-title');
const callTools = $('call-tools');
const popoutBtn = $<HTMLButtonElement>('popout');
const popoutHelp = $('popout-help');

// Pop-out window contents
const pipCard = $('pip-card');
const pipVideoSlot = $('pip-video-slot');
const pipNudge = $('pip-nudge');
const pipTimer = $('pip-timer');
const pipBack = $<HTMLButtonElement>('pip-back');
const pipEnd = $<HTMLButtonElement>('pip-end');

// Pairing screen
const pairStatus = $('pair-status');
const pairError = $('pair-error');
const pairStep3 = $('pair-step3');
const pairQr = $<HTMLCanvasElement>('pair-qr');
const pairCode = $('pair-code');
const pairCancel = $<HTMLButtonElement>('pair-cancel');
const pairCopy = $<HTMLButtonElement>('pair-copy');

const camera = new Camera(video);
const overlay = new Overlay(canvas, video);
const panel = new Panel();
const onPhone = isPhoneOrTablet();
const MODE_KEY = 'tells.mode';

type Source = 'local' | 'phone';
type Screen = 'intro' | 'pair' | 'live' | 'summary';

let mode: Mode = MODES[loadMode()];
let source: Source = 'local';
let link: DesktopLink | null = null;
let detectorLoad: Promise<Detector> | null = null;
let detector: Detector | null = null;
let engine = new CueEngine();
let session: Session | null = null;
let nudger: Nudger | null = null;
let lastNudge: NudgeKey | null = null;
let running = false;
let starting = false;
let showOverlay = true;
let frameId = 0;
let frameWin: Window = window; // whose animation frames drive the loop (this page, or the pop-out)
let pipWin: Window | null = null;
let lastVideoTime = -1;
let lastT = 0;
let calibrateUntil = 0;
let calibShown = -1;
let timerShown = -1;
let lastSummary: Summary | null = null;

// Remembered as keys so a language switch re-translates them.
let introErrorKey: Key | null = null;
let statusKey: Key | null = null;
let liveSourceKey: Key = 'live.sourceDevice';
let pairStatusKey: Key = 'pair.creating';
let pairErrorKeys: Key[] = [];
let pairCodeText = '';

// ---- Helpers -------------------------------------------------------------

function loadMode(): ModeId {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (isModeId(saved) && (MODES[saved].phoneOk || !onPhone)) return saved;
  } catch {
    /* storage blocked */
  }
  return 'read';
}

function showScreen(screen: Screen) {
  intro.hidden = screen !== 'intro';
  pair.hidden = screen !== 'pair';
  live.hidden = screen !== 'live';
  summaryEl.hidden = screen !== 'summary';
}

function setStatus(key: Key | null) {
  statusKey = key;
  status.hidden = !key;
  statusText.textContent = key ? t(key) : '';
}

function showIntroError(key: Key | null) {
  introErrorKey = key;
  introError.textContent = key ? t(key) : '';
  introError.hidden = !key;
}

function applyMirror(mirrored: boolean) {
  video.classList.toggle('-scale-x-100', mirrored);
  canvas.classList.toggle('-scale-x-100', mirrored);
}

const clock = (sec: number) => {
  const s = Math.floor(sec);
  return `${num(Math.floor(s / 60))}:${num(s % 60, { minimumIntegerDigits: 2 })}`;
};

function duration(sec: number) {
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  return m ? t('sum.duration', { m: num(m), s: num(s % 60) }) : t('sum.durationShort', { s: num(s) });
}

/** Starts loading the models once; pairing kicks this off early so it's ready when the phone connects. */
function loadDetector() {
  detectorLoad ??= Detector.create().then((d) => (detector = d));
  return detectorLoad;
}

// ---- Start screen ----------------------------------------------------------

function selectMode(id: ModeId) {
  mode = MODES[id];
  try {
    localStorage.setItem(MODE_KEY, id);
  } catch {
    /* fine: the choice lasts for this visit */
  }
  showIntroError(null);
  updateIntro();
}

function updateIntro() {
  document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((r) => (r.checked = r.value === mode.id));
  noteRead.hidden = mode.self;
  consentRow.hidden = mode.self;
  noteSelf.hidden = !mode.self;
  usePhoneBtn.hidden = onPhone || !mode.allowPhone;

  const blocked = !mode.self && !consent.checked; // reading someone else needs their okay
  startBtn.disabled = blocked || starting;
  usePhoneBtn.disabled = blocked;
  startBtn.textContent = t(starting ? 'start.starting' : onPhone ? 'start.device' : 'start.computer');
}

document.querySelectorAll<HTMLElement>('[data-mode-row]').forEach((row) => {
  const id = row.dataset.modeRow;
  if (isModeId(id) && onPhone && !MODES[id].phoneOk) row.hidden = true;
});
document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((r) =>
  r.addEventListener('change', () => isModeId(r.value) && selectMode(r.value)),
);
consent.addEventListener('change', updateIntro);

// ---- Live session ----------------------------------------------------------

function setupLiveChrome() {
  panel.setMode(mode);
  liveSource.textContent = t(liveSourceKey);
  timer.hidden = !mode.self;
  timer.textContent = clock(0);
  timerShown = -1;
  stopBtn.setAttribute('aria-label', t(mode.summary ? 'live.end' : 'live.stop'));
  overlayBtn.setAttribute('aria-label', t(showOverlay ? 'live.hideSkeleton' : 'live.showSkeleton'));
  callTools.hidden = !mode.nudges;
  popoutBtn.hidden = !canPopOut();
  popoutHelp.textContent = t(canPopOut() ? 'call.popHelp' : 'call.popUnsupported');
}

/** Shared by both camera sources once frames are arriving in the <video> element. */
async function beginSession() {
  showScreen('live');
  setupLiveChrome();
  panel.showMessage('', '');
  if (!detector) {
    setStatus('live.loading');
    try {
      await loadDetector();
    } catch (err) {
      console.error(err);
      detectorLoad = null;
      setStatus('live.modelsFailed');
      return;
    }
  }
  setStatus(null);
  engine = new CueEngine();
  session = mode.summary ? new Session(mode) : null;
  nudger = mode.nudges ? new Nudger() : null;
  lastNudge = null;
  startCalibration();
  running = true;
  lastVideoTime = -1;
  lastT = 0;
  cancelLoop();
  schedule();
}

/** A new camera view means new baselines (and, in practice modes, a fresh calibration). */
function resetReading() {
  engine = new CueEngine();
  panel.reset();
  startCalibration();
}

function startCalibration() {
  calibShown = -1;
  if (!mode.calibrate) {
    calibrateUntil = 0;
    calibrateBox.hidden = true;
    return;
  }
  calibrateUntil = performance.now() + mode.calibrate * 1000;
  calibrateBox.hidden = false;
  renderCalibration(performance.now(), true);
}

function renderCalibration(now: number, force = false) {
  const left = Math.max(1, Math.ceil((calibrateUntil - now) / 1000));
  if (left === calibShown && !force) return;
  calibShown = left;
  const title = t(mode.posture === 'stand' ? 'calib.stand' : 'calib.sit');
  calibCount.textContent = num(left);
  calibTitle.textContent = title;
  panel.showMessage(title, t('calib.body'));
}

function highlightFor(r: Reading) {
  const joints = new Set<number>();
  for (const c of r.cues) if (verdict(mode, c.id, c.tone) !== 'good') c.joints?.forEach((j) => joints.add(j));
  return joints;
}

function schedule() {
  frameId = frameWin.requestAnimationFrame(loop);
}

function cancelLoop() {
  frameWin.cancelAnimationFrame(frameId);
}

function loop() {
  if (!running) return;
  schedule();
  if (!detector || video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  const now = performance.now();
  const dt = lastT ? Math.min(0.25, (now - lastT) / 1000) : 1 / 30;
  lastT = now;

  const { pose, face } = detector.detect(video, now);
  const reading = engine.update(pose, face, now, video.videoWidth / video.videoHeight);
  const drawSkeleton = showOverlay && !pipWin;

  if (calibrateUntil) {
    if (now < calibrateUntil) {
      renderCalibration(now);
      if (drawSkeleton) overlay.draw(pose, face, new Set());
      return;
    }
    calibrateUntil = 0;
    calibrateBox.hidden = true;
    panel.reset();
  }

  session?.update(reading, dt);
  const nudge = nudger ? nudger.update(reading, now) : null;
  panel.render(reading, nudge);
  if (pipWin && nudge !== lastNudge) renderPipNudge(nudge ?? 'good');
  lastNudge = nudge;

  if (session) {
    const sec = Math.floor(session.elapsed);
    if (sec !== timerShown) {
      timerShown = sec;
      timer.textContent = pipTimer.textContent = clock(sec);
    }
  }
  if (drawSkeleton) overlay.draw(pose, face, highlightFor(reading));
}

/** Turns the camera off and tears the session down (no screen change). */
function stopCamera() {
  running = false;
  cancelLoop();
  closePip();
  camera.stop();
  link?.close();
  link = null;
  video.srcObject = null;
  overlay.clear();
  setStatus(null);
  flipBtn.hidden = true;
  calibrateBox.hidden = true;
  calibrateUntil = 0;
}

/** Ends the session: practice modes go to the summary, reading goes back to the start. */
function finish(errKey?: Key) {
  const summary = session?.summary() ?? null;
  stopCamera();
  session = null;
  nudger = null;
  starting = false;
  if (summary && summary.seconds >= 5) {
    showSummary(summary);
    return;
  }
  showScreen('intro');
  updateIntro();
  showIntroError(errKey ?? null);
}

// ---- This device's camera ------------------------------------------------

async function startLocal() {
  showIntroError(null);
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    showIntroError('err.insecure');
    return;
  }
  starting = true;
  updateIntro();
  try {
    await camera.start(mode.facing);
  } catch (err) {
    starting = false;
    updateIntro();
    showIntroError(cameraErrorKey(err));
    return;
  }
  starting = false;
  updateIntro();
  source = 'local';
  liveSourceKey = 'live.sourceDevice';
  applyMirror(camera.mirrored);
  camera.canFlip().then((can) => (flipBtn.hidden = !can));
  await beginSession();
}

// ---- A paired phone's camera (desktop only) --------------------------------

function renderPair() {
  pairStatus.textContent = t(pairStatusKey);
  pairError.textContent = pairErrorKeys.map((k) => t(k)).join(' ');
  pairError.hidden = !pairErrorKeys.length;
  pairStep3.textContent = t(mode.self ? 'pair.step3.self' : 'pair.step3.read');
  pairCode.textContent = pairCodeText ? t('pair.code', { code: pairCodeText }) : '';
}

function startPairing() {
  showIntroError(null);
  pairCopy.disabled = true;
  pairCodeText = '';
  pairErrorKeys = [];
  pairQr.getContext('2d')?.clearRect(0, 0, pairQr.width, pairQr.height);
  showScreen('pair');

  if (isLocalOnlyHost()) {
    pairStatusKey = 'pair.localTitle';
    pairErrorKeys = ['pair.localBody'];
    renderPair();
    return;
  }

  loadDetector().catch(() => (detectorLoad = null)); // warm up while the phone scans
  pairStatusKey = 'pair.creating';
  renderPair();

  link = new DesktopLink({
    onReady: async (code) => {
      const url = pairUrl(code, { lang: getLang(), self: mode.self, facing: mode.facing });
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
          pairCopy.textContent = t('pair.copied');
        } catch {
          pairCopy.textContent = t('pair.copyFailed');
        }
        setTimeout(() => (pairCopy.textContent = t('pair.copy')), 2000);
      };
      pairCodeText = `${code.slice(0, 4)} ${code.slice(4, 8)} ${code.slice(8)}`;
      pairStatusKey = 'pair.waiting';
      renderPair();
    },
    onStream: (stream) => {
      source = 'phone';
      liveSourceKey = 'live.sourcePhone';
      flipBtn.hidden = false;
      applyMirror(mode.facing === 'user');
      video.srcObject = stream;
      video.play().catch(() => {});
      beginSession();
    },
    onFacing: (facing: Facing) => {
      applyMirror(facing === 'user');
      if (running) resetReading();
    },
    onClose: (reason) => {
      link = null;
      if (!live.hidden) finish(reason);
      else if (!pair.hidden) {
        pairStatusKey = 'pair.dead';
        pairErrorKeys = [reason, 'pair.deadSuffix'];
        renderPair();
      }
    },
  });
}

function cancelPairing() {
  link?.close();
  link = null;
  showScreen('intro');
  updateIntro();
}

// ---- Video call check: pop-out window ------------------------------------

function renderPipNudge(nudge: NudgeKey) {
  pipNudge.textContent = t(`nudge.${nudge}`);
  pipNudge.dataset.nudge = String(nudge !== 'good');
}

async function openPip() {
  if (!canPopOut() || pipWin || !running) return;
  try {
    pipCard.hidden = false;
    applyI18n(pipCard);
    renderPipNudge(lastNudge ?? 'good');
    pipTimer.textContent = timer.textContent;
    const win = await popOut(pipCard, t('call.pipTitle'), onPipClosed);
    cancelLoop();
    pipWin = frameWin = win;
    pipVideoSlot.appendChild(video); // the camera preview moves into the small window
    video.play().catch(() => {});
    overlay.clear();
    if (running) schedule();
  } catch (err) {
    console.error(err);
    pipCard.hidden = true;
    document.body.appendChild(pipCard);
  }
}

/** Puts everything back on this page. Safe to call more than once. */
function onPipClosed() {
  if (!pipWin) return;
  cancelLoop();
  pipWin = null;
  frameWin = window;
  stage.insertBefore(video, canvas);
  video.play().catch(() => {});
  pipCard.hidden = true;
  document.body.appendChild(pipCard);
  if (!running) return;
  // Without the pop-out, the camera must not keep running behind a hidden page.
  if (document.hidden) finish('err.leftPageCall');
  else schedule();
}

function closePip() {
  const win = pipWin;
  if (!win) return;
  onPipClosed();
  win.close();
}

// ---- Summary ----------------------------------------------------------------

function renderItems(list: HTMLElement, items: SummaryItem[], kind: 'good' | 'work', emptyKey: Key) {
  list.replaceChildren();
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'py-3 text-sm text-fog';
    li.textContent = t(emptyKey);
    list.appendChild(li);
    return;
  }
  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'py-3';
    const share = t('sum.share', { p: num(Math.round(item.share * 100)) });
    const times = item.count === 1 ? t('sum.once') : t('sum.times', { n: num(item.count) });

    const head = document.createElement('p');
    head.className = 'flex flex-wrap items-baseline justify-between gap-x-3';
    const label = document.createElement('span');
    label.className = 'font-semibold text-chalk';
    label.textContent = t(cueLabelKey(item.id));
    const stat = document.createElement('span');
    stat.className = 'text-sm tabular-nums text-fog';
    stat.textContent = kind === 'good' ? share : `${times}, ${share}`;
    head.append(label, stat);
    li.appendChild(head);

    if (kind === 'work') {
      const tip = document.createElement('p');
      tip.className = 'mt-1 text-sm leading-snug text-fog';
      tip.textContent = t(cueTextKey(mode, item.id));
      li.appendChild(tip);
    }
    list.appendChild(li);
  }
}

function renderSummary(s: Summary) {
  $('sum-sub').textContent = t('sum.sub', { mode: t(`mode.${mode.id}.name` as Key), duration: duration(s.seconds) });
  $('sum-headline').textContent = t(`head.self.${s.headline}` as Key);
  $('sum-short').hidden = !s.short;
  for (const key of ['openness', 'engagement', 'tension'] as const) {
    $(`sum-m-${key}`).style.width = `${Math.round(s[key] * 100)}%`;
    $(`sum-v-${key}`).textContent = num(s[key], { style: 'percent' });
  }
  renderItems($('sum-well'), s.wentWell, 'good', 'sum.nothingWell');
  renderItems($('sum-work'), s.workOn, 'work', 'sum.nothingWork');
}

function showSummary(s: Summary) {
  lastSummary = s;
  showScreen('summary');
  renderSummary(s);
  window.scrollTo(0, 0);
}

// ---- Controls ----------------------------------------------------------------

startBtn.addEventListener('click', startLocal);
usePhoneBtn.addEventListener('click', startPairing);
pairCancel.addEventListener('click', cancelPairing);
stopBtn.addEventListener('click', () => finish());
popoutBtn.addEventListener('click', openPip);
pipBack.addEventListener('click', closePip);
pipEnd.addEventListener('click', () => finish());

$('sum-again').addEventListener('click', () => {
  if (source === 'phone' && !onPhone) startPairing();
  else {
    showScreen('intro');
    updateIntro();
    startLocal();
  }
});
$('sum-modes').addEventListener('click', () => {
  showScreen('intro');
  updateIntro();
  window.scrollTo(0, 0);
});

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
    finish(cameraErrorKey(err));
  } finally {
    flipBtn.disabled = false;
  }
});

overlayBtn.addEventListener('click', () => {
  showOverlay = !showOverlay;
  overlayBtn.setAttribute('aria-pressed', String(showOverlay));
  overlayBtn.setAttribute('aria-label', t(showOverlay ? 'live.hideSkeleton' : 'live.showSkeleton'));
  if (!showOverlay) overlay.clear();
});

// Re-translate everything that was set from code.
onLangChange(() => {
  updateIntro();
  showIntroError(introErrorKey);
  if (statusKey) setStatus(statusKey);
  renderPair();
  if (!live.hidden) {
    setupLiveChrome();
    if (calibrateUntil) renderCalibration(performance.now(), true);
  }
  if (lastSummary && !summaryEl.hidden) renderSummary(lastSummary);
  if (pipWin) {
    applyI18n(pipCard);
    renderPipNudge(lastNudge ?? 'good');
    pipWin.document.documentElement.lang = getLang();
  }
});

// ---- Start-up ------------------------------------------------------------------

applyI18n();
const code = pairCodeFromUrl();
if (code) {
  // Opened from a desktop's QR code: this phone only sends its camera.
  startSender(code);
} else {
  updateIntro();

  // Privacy: this device's camera never keeps running behind a hidden page,
  // unless the video call pop-out is open (it stays visible, showing the camera).
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden || !running || source !== 'local' || pipWin) return;
    finish(mode.nudges ? 'err.leftPageCall' : 'err.leftPage');
  });
  window.addEventListener('pagehide', () => {
    camera.stop();
    link?.close();
  });
}

// Dev-only hooks for previewing screens without a person in front of the camera.
if (import.meta.env.DEV) Object.assign(window, { __tells: { panel, showSummary, selectMode } });
