// src/phone.ts
// The phone side of pairing: opened from the desktop's QR code (?pair=<code>).
// The phone only captures and sends; all reading happens on the computer.
import { Camera, cameraErrorMessage } from './camera';
import { PhoneLink } from './pairing';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function startSender(code: string) {
  const section = $('sender');
  const video = $<HTMLVideoElement>('sender-video');
  const title = $('sender-title');
  const note = $('sender-note');
  const startBtn = $<HTMLButtonElement>('sender-start');
  const controls = $('sender-controls');
  const flipBtn = $<HTMLButtonElement>('sender-flip');
  const stopBtn = $<HTMLButtonElement>('sender-stop');

  $('intro').hidden = true;
  section.hidden = false;
  document.title = 'Tells: share camera';

  const camera = new Camera(video);
  let link: PhoneLink | null = null;
  let wakeLock: WakeLockSentinel | null = null;
  let sharing = false;

  const say = (heading: string, body: string) => {
    title.textContent = heading;
    note.textContent = body;
  };
  const mirror = () => video.classList.toggle('-scale-x-100', camera.mirrored);

  async function keepAwake() {
    try {
      wakeLock = await navigator.wakeLock?.request('screen');
    } catch {
      /* not supported or refused: the phone may dim, which is fine */
    }
  }

  function end(reason: string) {
    sharing = false;
    camera.stop();
    wakeLock?.release().catch(() => {});
    wakeLock = null;
    controls.hidden = true;
    startBtn.hidden = true;
    say('Sharing ended', `${reason} To share again, scan the code on your computer.`);
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
      end(cameraErrorMessage(err));
    } finally {
      flipBtn.disabled = false;
    }
  }

  startBtn.addEventListener('click', async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      say('Camera unavailable', 'The camera only works on a secure page. Open the link over https://.');
      return;
    }
    startBtn.disabled = true;
    startBtn.textContent = 'Starting…';
    try {
      await camera.start('environment');
    } catch (err) {
      startBtn.disabled = false;
      startBtn.textContent = 'Share camera';
      say('Camera unavailable', cameraErrorMessage(err));
      return;
    }
    mirror();
    sharing = true;
    say('Connecting…', 'Linking up with your computer.');

    link = new PhoneLink(code, camera.current!, camera.facing, {
      onConnected: () => {
        startBtn.hidden = true;
        controls.hidden = false;
        say('Connected', 'Point the phone at the person. The reading appears on your computer.');
        keepAwake();
      },
      onFlipRequest: flip,
      onClose: end,
    });
  });

  flipBtn.addEventListener('click', flip);
  stopBtn.addEventListener('click', () => {
    link?.close();
    end('You stopped sharing.');
  });

  // Phones pause the camera in the background, so end cleanly instead of freezing.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && sharing) {
      link?.close();
      end('Sharing stopped when you left the page.');
    }
  });
  window.addEventListener('pagehide', () => {
    link?.close();
    camera.stop();
  });
}
