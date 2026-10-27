// src/phone.ts
// The phone side of pairing: opened from the desktop's QR code (?pair=<code>).
// The phone only captures and sends; all reading happens on the computer.
import { Camera, cameraErrorKey } from './camera';
import { applyI18n, onLangChange, t, type Key } from './i18n';
import { PhoneLink, pairOptionsFromUrl } from './pairing';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

type State = { title: Key; body: Key; reason?: Key };

export function startSender(code: string) {
  const section = $('sender');
  const video = $<HTMLVideoElement>('sender-video');
  const title = $('sender-title');
  const note = $('sender-note');
  const startBtn = $<HTMLButtonElement>('sender-start');
  const controls = $('sender-controls');
  const flipBtn = $<HTMLButtonElement>('sender-flip');
  const stopBtn = $<HTMLButtonElement>('sender-stop');
  const { self, facing } = pairOptionsFromUrl();

  $('intro').hidden = true;
  section.hidden = false;

  const camera = new Camera(video);
  let link: PhoneLink | null = null;
  let wakeLock: WakeLockSentinel | null = null;
  let sharing = false;
  let state: State = { title: 'sender.readyTitle', body: 'sender.readyBody' };

  // Kept as keys so a language switch re-renders the current message.
  const show = (next: State) => {
    state = next;
    title.textContent = t(next.title);
    note.textContent = next.reason ? t('sender.endedBody', { reason: t(next.reason) }) : t(next.body);
    document.title = `Tells: ${t('sender.share')}`;
  };
  onLangChange(() => show(state));
  applyI18n(section);
  show(state);

  const mirror = () => video.classList.toggle('-scale-x-100', camera.mirrored);

  async function keepAwake() {
    try {
      wakeLock = await navigator.wakeLock?.request('screen');
    } catch {
      /* not supported or refused: the phone may dim, which is fine */
    }
  }

  function end(reason: Key) {
    sharing = false;
    camera.stop();
    wakeLock?.release().catch(() => {});
    wakeLock = null;
    controls.hidden = true;
    startBtn.hidden = true;
    show({ title: 'sender.endedTitle', body: 'sender.endedBody', reason });
  }

  async function flip() {
    if (!link) return;
    flipBtn.disabled = true;
    try {
      await camera.flip();
      mirror();
      await link.replaceStream(camera.current!, camera.facing);
    } catch (err) {
      link.close();
      end(cameraErrorKey(err));
    } finally {
      flipBtn.disabled = false;
    }
  }

  startBtn.addEventListener('click', async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      show({ title: 'sender.unavailableTitle', body: 'sender.insecure' });
      return;
    }
    startBtn.disabled = true;
    startBtn.textContent = t('start.starting');
    try {
      await camera.start(facing);
    } catch (err) {
      startBtn.disabled = false;
      startBtn.textContent = t('sender.share');
      show({ title: 'sender.unavailableTitle', body: cameraErrorKey(err) });
      return;
    }
    mirror();
    sharing = true;
    show({ title: 'sender.connectingTitle', body: 'sender.connectingBody' });

    link = new PhoneLink(code, camera.current!, camera.facing, {
      onConnected: () => {
        startBtn.hidden = true;
        controls.hidden = false;
        show({ title: 'sender.connectedTitle', body: self ? 'sender.connectedBodySelf' : 'sender.connectedBody' });
        keepAwake();
      },
      onFlipRequest: flip,
      onClose: end,
    });
  });

  flipBtn.addEventListener('click', flip);
  stopBtn.addEventListener('click', () => {
    link?.close();
    end('sender.youStopped');
  });

  // Phones pause the camera in the background, so end cleanly instead of freezing.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && sharing) {
      link?.close();
      end('sender.leftPage');
    }
  });
  window.addEventListener('pagehide', () => {
    link?.close();
    camera.stop();
  });
}
