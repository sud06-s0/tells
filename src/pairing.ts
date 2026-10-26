// src/pairing.ts
// Phone-to-desktop camera link.
//
// The phone's video travels straight to the desktop over WebRTC (peer to peer,
// encrypted with DTLS-SRTP). The free PeerJS cloud server is only used to
// introduce the two devices; it never sees the video. Nothing is recorded.
import Peer, { type DataConnection, type MediaConnection, type PeerOptions } from 'peerjs';
import type { Facing } from './camera';

type Message = { type: 'facing'; facing: Facing } | { type: 'flip' } | { type: 'bye' };

const ID_PREFIX = 'tells-';

/**
 * Connection server for introducing the two devices. Defaults to the free PeerJS
 * cloud. To run your own (`npx peer --port 9000`), set these in a .env file:
 * VITE_PEER_HOST, VITE_PEER_PORT, VITE_PEER_PATH, VITE_PEER_SECURE ("true"/"false").
 */
function peerOptions(): PeerOptions {
  const env = import.meta.env;
  if (!env.VITE_PEER_HOST) return {};
  return {
    host: env.VITE_PEER_HOST,
    port: env.VITE_PEER_PORT ? Number(env.VITE_PEER_PORT) : undefined,
    path: env.VITE_PEER_PATH || '/',
    secure: env.VITE_PEER_SECURE ? env.VITE_PEER_SECURE === 'true' : location.protocol === 'https:',
  };
}

function randomCode(length = 12) {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export function pairUrl(code: string) {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('pair', code);
  return url.href;
}

export function pairCodeFromUrl() {
  const code = new URLSearchParams(location.search).get('pair');
  return code && /^[a-z0-9]{8,32}$/.test(code) ? code : null;
}

/** Phones can't open localhost / 127.0.0.1 on your computer. */
export function isLocalOnlyHost() {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);
}

export function isPhoneOrTablet() {
  const ua = navigator.userAgent;
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || iPadOS;
}

function describePeerError(type: string) {
  switch (type) {
    case 'peer-unavailable':
      return 'The computer isn’t waiting any more. Scan a fresh code on the computer.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
    case 'disconnected':
      return 'The connection service couldn’t be reached. Check your internet and try again.';
    case 'browser-incompatible':
      return 'This browser can’t make a direct video connection. Try Chrome or Safari.';
    default:
      return 'The connection failed. Try again.';
  }
}

// ---- Desktop side: shows the QR code and receives the phone's camera -------

export interface DesktopEvents {
  onReady: (code: string) => void;
  onStream: (stream: MediaStream) => void;
  onFacing: (facing: Facing) => void;
  onClose: (reason: string) => void;
}

export class DesktopLink {
  private peer: Peer;
  private conn: DataConnection | null = null;
  private call: MediaConnection | null = null;
  private closed = false;
  private events: DesktopEvents;
  readonly code = randomCode();

  constructor(events: DesktopEvents) {
    this.events = events;
    this.peer = new Peer(ID_PREFIX + this.code, peerOptions());

    this.peer.on('open', () => this.events.onReady(this.code));

    // Only the first phone to connect is accepted; later attempts are refused.
    this.peer.on('connection', (conn) => {
      if (this.conn) return conn.close();
      this.conn = conn;
      conn.on('data', (data) => this.handle(data as Message));
      conn.on('close', () => this.end('Your phone disconnected.'));
    });

    this.peer.on('call', (call) => {
      if (this.call) return call.close();
      this.call = call;
      call.answer(); // receive only: the desktop sends no video back
      call.on('stream', (stream) => this.events.onStream(stream));
      call.on('close', () => this.end('Your phone stopped sharing its camera.'));
      call.peerConnection?.addEventListener('connectionstatechange', () => {
        const state = call.peerConnection.connectionState;
        if (state === 'failed') this.end('The video link to your phone dropped. Both devices on the same Wi-Fi works best.');
      });
    });

    this.peer.on('error', (err) => this.end(describePeerError(err.type)));
  }

  /** Ask the phone to switch between its front and back camera. */
  flip() {
    this.send({ type: 'flip' });
  }

  get connected() {
    return !!this.call;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.send({ type: 'bye' });
    // Give the goodbye a moment to arrive before tearing down.
    setTimeout(() => this.peer.destroy(), 150);
  }

  private send(msg: Message) {
    if (this.conn?.open) this.conn.send(msg);
  }

  private handle(msg: Message) {
    if (msg?.type === 'facing') this.events.onFacing(msg.facing === 'user' ? 'user' : 'environment');
    if (msg?.type === 'bye') this.end('Your phone stopped sharing its camera.');
  }

  private end(reason: string) {
    if (this.closed) return;
    this.closed = true;
    this.peer.destroy();
    this.events.onClose(reason);
  }
}

// ---- Phone side: sends its camera to the desktop ---------------------------

export interface PhoneEvents {
  onConnected: () => void;
  onFlipRequest: () => void;
  onClose: (reason: string) => void;
}

export class PhoneLink {
  private peer: Peer;
  private conn: DataConnection | null = null;
  private call: MediaConnection | null = null;
  private closed = false;
  private events: PhoneEvents;

  constructor(code: string, stream: MediaStream, facing: Facing, events: PhoneEvents) {
    this.events = events;
    this.peer = new Peer(peerOptions());

    this.peer.on('open', () => {
      const target = ID_PREFIX + code;
      this.conn = this.peer.connect(target, { reliable: true });
      this.conn.on('open', () => this.setFacing(facing));
      this.conn.on('data', (data) => {
        const msg = data as Message;
        if (msg?.type === 'flip') this.events.onFlipRequest();
        if (msg?.type === 'bye') this.end('The computer ended the session.');
      });
      this.conn.on('close', () => this.end('The computer disconnected.'));

      this.call = this.peer.call(target, stream);
      this.call.on('close', () => this.end('The computer disconnected.'));
      this.call.peerConnection?.addEventListener('connectionstatechange', () => {
        const state = this.call?.peerConnection.connectionState;
        if (state === 'connected') this.events.onConnected();
        if (state === 'failed') this.end('The video link dropped. Both devices on the same Wi-Fi works best.');
      });
    });

    this.peer.on('error', (err) => this.end(describePeerError(err.type)));
  }

  /** After switching cameras, swap the outgoing track without reconnecting. */
  async replaceStream(stream: MediaStream, facing: Facing) {
    const track = stream.getVideoTracks()[0];
    const sender = this.call?.peerConnection?.getSenders().find((s) => s.track?.kind === 'video');
    if (track && sender) await sender.replaceTrack(track);
    this.setFacing(facing);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.conn?.open) this.conn.send({ type: 'bye' } satisfies Message);
    setTimeout(() => this.peer.destroy(), 150);
  }

  private setFacing(facing: Facing) {
    if (this.conn?.open) this.conn.send({ type: 'facing', facing } satisfies Message);
  }

  private end(reason: string) {
    if (this.closed) return;
    this.closed = true;
    this.peer.destroy();
    this.events.onClose(reason);
  }
}
