import type { CoopClientMessage, CoopServerMessage } from '../types/coop.ts';
import type { HotspotGuestSession, HotspotHostSession } from './hotspotP2P.ts';

export type CoopTransportMode = 'ws' | 'p2p-host' | 'p2p-guest';

const STORAGE_KEY = 'criptas_lan_server';

function normalizeServerInput(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^wss?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^ws/i, 'http').replace(/\/ws$/i, '');
  }
  return trimmed.includes(':') ? `http://${trimmed}` : `http://${trimmed}:3000`;
}

function loadInitialServerOverride(): string {
  if (typeof window === 'undefined') return '';
  try {
    const fromQuery = new URLSearchParams(window.location.search).get('servidor');
    if (fromQuery) {
      const normalized = normalizeServerInput(fromQuery);
      localStorage.setItem(STORAGE_KEY, normalized);
      return normalized;
    }
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export class CoopClient {
  private ws: WebSocket | null = null;
  private mode: CoopTransportMode = 'ws';
  private serverOverride: string = loadInitialServerOverride();
  private hostSession: HotspotHostSession | null = null;
  private guestSession: HotspotGuestSession | null = null;
  private p2pUnsubs: Array<() => void> = [];

  private listeners = new Set<(msg: CoopServerMessage) => void>();
  private statusListeners = new Set<(connected: boolean) => void>();
  private pendingQueue: string[] = [];
  private intentionalClose = false;
  private reconnectTimer: number | null = null;

  getMode(): CoopTransportMode {
    return this.mode;
  }

  getHostSession(): HotspotHostSession | null {
    return this.hostSession;
  }

  getServerOverride(): string {
    return this.serverOverride;
  }

  setServerOverride(raw: string) {
    const normalized = normalizeServerInput(raw);
    if (normalized === this.serverOverride) return;
    this.serverOverride = normalized;
    try {
      if (normalized) {
        localStorage.setItem(STORAGE_KEY, normalized);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Ignore storage error
    }
    if (this.mode === 'ws') {
      this.closeWsOnly();
      this.connect();
    }
  }

  getHttpBaseUrl(): string {
    if (this.serverOverride) return this.serverOverride;
    if (typeof window === 'undefined') return 'http://127.0.0.1:3000';
    return window.location.origin;
  }

  getWsUrl(): string {
    if (this.serverOverride) {
      const parsed = new URL(this.serverOverride);
      const proto = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${parsed.host}/ws`;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }

  useHotspotHost(session: HotspotHostSession) {
    this.clearP2POnly();
    this.closeWsOnly();
    this.mode = 'p2p-host';
    this.hostSession = session;
    this.p2pUnsubs.push(
      session.onHostMessage((msg) => {
        for (const cb of this.listeners) cb(msg);
      })
    );
    this.emitStatus(true);
  }

  useHotspotGuest(session: HotspotGuestSession) {
    this.clearP2POnly();
    this.closeWsOnly();
    this.mode = 'p2p-guest';
    this.guestSession = session;
    this.p2pUnsubs.push(
      session.onMessage((msg) => {
        for (const cb of this.listeners) cb(msg);
      }),
      session.onStatus((ok) => {
        this.emitStatus(ok);
      })
    );
    this.emitStatus(session.isConnected());
  }

  connect() {
    if (this.mode !== 'ws') return;
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    this.intentionalClose = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.getWsUrl());
    } catch {
      this.emitStatus(false);
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.emitStatus(true);
      while (this.pendingQueue.length > 0 && ws.readyState === WebSocket.OPEN) {
        const next = this.pendingQueue.shift();
        if (next) ws.send(next);
      }
    };

    ws.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(String(evt.data)) as CoopServerMessage;
        for (const cb of this.listeners) cb(parsed);
      } catch {
        // Ignore malformed packets
      }
    };

    ws.onclose = () => {
      this.emitStatus(false);
      this.ws = null;
      if (!this.intentionalClose && this.mode === 'ws') {
        this.reconnectTimer = window.setTimeout(() => {
          this.connect();
        }, 2000);
      }
    };

    ws.onerror = () => {
      // Handled by onclose
    };
  }

  disconnect() {
    this.clearP2POnly();
    this.closeWsOnly();
    this.mode = 'ws';
  }

  isConnected(): boolean {
    if (this.mode === 'p2p-host') return Boolean(this.hostSession);
    if (this.mode === 'p2p-guest') return Boolean(this.guestSession?.isConnected());
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(msg: CoopClientMessage) {
    if (this.mode === 'p2p-host' && this.hostSession) {
      this.hostSession.sendFromHost(msg);
      return;
    }
    if (this.mode === 'p2p-guest' && this.guestSession) {
      this.guestSession.send(msg);
      return;
    }

    const raw = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(raw);
    } else {
      this.pendingQueue.push(raw);
      if (this.pendingQueue.length > 40) this.pendingQueue.shift();
      this.connect();
    }
  }

  onMessage(cb: (msg: CoopServerMessage) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  onStatus(cb: (connected: boolean) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  private closeWsOnly() {
    this.intentionalClose = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.pendingQueue = [];
  }

  private clearP2POnly() {
    for (const unsub of this.p2pUnsubs) unsub();
    this.p2pUnsubs = [];
    if (this.hostSession) {
      this.hostSession.destroy();
      this.hostSession = null;
    }
    if (this.guestSession) {
      this.guestSession.destroy();
      this.guestSession = null;
    }
  }

  private emitStatus(connected: boolean) {
    for (const cb of this.statusListeners) cb(connected);
  }
}

export const coopClient = new CoopClient();
