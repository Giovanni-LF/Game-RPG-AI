import { APP_VERSION, VersionCheckResult } from '../shared/protocol.ts';
import type { CoopClientMessage, CoopServerMessage } from '../types/coop.ts';
import type { HotspotGuestSession, HotspotHostSession } from './hotspotP2P.ts';

export type CoopTransportMode = 'ws' | 'p2p-host' | 'p2p-guest';

export type CoopConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'blocked_version';

export interface CoopTelemetry {
  connected: boolean;
  connectionState: CoopConnectionState;
  latencyMs: number | null;
  clientVersion: string;
  serverVersion: string | null;
  versionCheck: VersionCheckResult | null;
  reconnectAttempt: number;
  activeSessionRoomCode: string | null;
}

interface StoredCoopSession {
  roomCode: string;
  sessionToken: string;
  playerId: string;
  serverOverride: string;
  runSeedLabel: string;
}

const STORAGE_KEY = 'criptas_lan_server';
const SESSION_STORAGE_KEY = 'criptas_coop_session_v1';
const HEARTBEAT_INTERVAL_MS = 2500;
const WATCHDOG_TIMEOUT_MS = 8500;

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

function loadSavedSession(): StoredCoopSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredCoopSession>;
    if (!parsed.roomCode || !parsed.sessionToken) return null;
    return {
      roomCode: String(parsed.roomCode),
      sessionToken: String(parsed.sessionToken),
      playerId: String(parsed.playerId || ''),
      serverOverride: String(parsed.serverOverride || ''),
      runSeedLabel: String(parsed.runSeedLabel || ''),
    };
  } catch {
    return null;
  }
}

function persistSavedSession(session: StoredCoopSession | null) {
  if (typeof window === 'undefined') return;
  try {
    if (!session) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } else {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    }
  } catch {
    // Ignore storage failure
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
  private telemetryListeners = new Set<(t: CoopTelemetry) => void>();
  private pendingQueue: string[] = [];
  private intentionalClose = false;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;

  private activeSession: StoredCoopSession | null = loadSavedSession();
  private latencyMs: number | null = null;
  private serverVersion: string | null = null;
  private versionCheck: VersionCheckResult | null = null;
  private connectionState: CoopConnectionState = 'disconnected';
  private reconnectAttempt = 0;
  private lastPacketAt = 0;

  getMode(): CoopTransportMode {
    return this.mode;
  }

  getHostSession(): HotspotHostSession | null {
    return this.hostSession;
  }

  getServerOverride(): string {
    return this.serverOverride;
  }

  getSavedSession(): StoredCoopSession | null {
    return this.activeSession;
  }

  getTelemetry(): CoopTelemetry {
    return {
      connected: this.isConnected(),
      connectionState: this.connectionState,
      latencyMs: this.latencyMs,
      clientVersion: APP_VERSION,
      serverVersion: this.serverVersion,
      versionCheck: this.versionCheck,
      reconnectAttempt: this.reconnectAttempt,
      activeSessionRoomCode: this.activeSession?.roomCode ?? null,
    };
  }

  clearSavedSession() {
    this.activeSession = null;
    persistSavedSession(null);
    this.emitTelemetry();
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
      this.serverVersion = null;
      this.versionCheck = null;
      this.latencyMs = null;
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
    this.latencyMs = 0;
    this.serverVersion = APP_VERSION;
    this.versionCheck = {
      status: 'ok',
      compatible: true,
      clientVersion: APP_VERSION,
      serverVersion: APP_VERSION,
      message: null,
    };
    this.connectionState = 'connected';
    this.reconnectAttempt = 0;
    this.p2pUnsubs.push(
      session.onHostMessage((msg) => {
        this.handleIncomingMessage(msg);
      })
    );
    this.emitStatus(true);
    this.emitTelemetry();
  }

  useHotspotGuest(session: HotspotGuestSession) {
    this.clearP2POnly();
    this.closeWsOnly();
    this.mode = 'p2p-guest';
    this.guestSession = session;
    this.latencyMs = null;
    this.connectionState = session.isConnected() ? 'connected' : 'connecting';
    this.startHeartbeatLoop();
    this.p2pUnsubs.push(
      session.onMessage((msg) => {
        this.handleIncomingMessage(msg);
      }),
      session.onStatus((ok) => {
        this.connectionState = ok ? 'connected' : 'disconnected';
        this.emitStatus(ok);
        this.emitTelemetry();
      })
    );
    this.emitStatus(session.isConnected());
    this.emitTelemetry();
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
    this.connectionState = this.activeSession ? 'reconnecting' : 'connecting';
    this.emitTelemetry();

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.getWsUrl());
    } catch {
      this.connectionState = this.activeSession ? 'reconnecting' : 'disconnected';
      this.emitStatus(false);
      this.emitTelemetry();
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.lastPacketAt = Date.now();
      this.reconnectAttempt = 0;
      this.connectionState = 'connected';
      this.startHeartbeatLoop();

      // Send client version handshake first
      ws.send(JSON.stringify({ type: 'client:hello', version: APP_VERSION } satisfies CoopClientMessage));

      // Attempt seamless session recovery if a token exists in sessionStorage
      if (this.activeSession) {
        ws.send(
          JSON.stringify({
            type: 'room:reconnect',
            version: APP_VERSION,
            roomCode: this.activeSession.roomCode,
            sessionToken: this.activeSession.sessionToken,
          } satisfies CoopClientMessage)
        );
      }

      // Initial ping for immediate RTT display
      ws.send(JSON.stringify({ type: 'net:ping', clientTs: performance.now() } satisfies CoopClientMessage));

      this.emitStatus(true);
      this.emitTelemetry();

      while (this.pendingQueue.length > 0 && ws.readyState === WebSocket.OPEN) {
        const next = this.pendingQueue.shift();
        if (next) ws.send(next);
      }
    };

    ws.onmessage = (evt) => {
      this.lastPacketAt = Date.now();
      try {
        const parsed = JSON.parse(String(evt.data)) as CoopServerMessage;
        this.handleIncomingMessage(parsed);
      } catch {
        // Ignore malformed packets
      }
    };

    ws.onclose = () => {
      this.stopHeartbeatLoop();
      this.ws = null;
      this.emitStatus(false);
      if (this.connectionState !== 'blocked_version') {
        this.connectionState = !this.intentionalClose && this.activeSession ? 'reconnecting' : 'disconnected';
      }
      this.emitTelemetry();
      if (!this.intentionalClose && this.mode === 'ws' && this.connectionState !== 'blocked_version') {
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // Handled by onclose
    };
  }

  disconnect() {
    this.clearSavedSession();
    this.clearP2POnly();
    this.closeWsOnly();
    this.mode = 'ws';
    this.latencyMs = null;
    this.connectionState = 'disconnected';
    this.emitTelemetry();
  }

  isConnected(): boolean {
    if (this.mode === 'p2p-host') return Boolean(this.hostSession);
    if (this.mode === 'p2p-guest') return Boolean(this.guestSession?.isConnected());
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(msg: CoopClientMessage) {
    if (msg.type === 'room:leave') {
      this.clearSavedSession();
    }

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
      if (msg.type !== 'net:ping') {
        this.pendingQueue.push(raw);
        if (this.pendingQueue.length > 40) this.pendingQueue.shift();
      }
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

  onTelemetry(cb: (telemetry: CoopTelemetry) => void): () => void {
    this.telemetryListeners.add(cb);
    cb(this.getTelemetry());
    return () => this.telemetryListeners.delete(cb);
  }

  private handleIncomingMessage(msg: CoopServerMessage) {
    if (msg.type === 'server:hello') {
      this.serverVersion = msg.serverVersion;
      this.versionCheck = msg.compatibility;
      if (!msg.compatibility.compatible) {
        this.connectionState = 'blocked_version';
        this.clearSavedSession();
        this.closeWsOnly();
      }
      this.emitTelemetry();
      for (const cb of this.listeners) cb(msg);
      return;
    }

    if (msg.type === 'net:pong') {
      const rtt = Math.max(1, Math.round(performance.now() - msg.clientTs));
      this.latencyMs =
        this.latencyMs === null ? rtt : Math.round(this.latencyMs * 0.65 + rtt * 0.35);
      this.emitTelemetry();
      return;
    }

    if (msg.type === 'room:joined' || msg.type === 'room:reconnected' || msg.type === 'pvp:joined') {
      this.serverVersion = msg.serverVersion;
      this.versionCheck = msg.compatibility;
      this.connectionState = 'connected';
      this.reconnectAttempt = 0;
      if (this.mode === 'ws') {
        const seedLabel = msg.type === 'pvp:joined' ? 'ARENA-PVP' : msg.runSeedLabel;
        this.activeSession = {
          roomCode: msg.roomCode,
          sessionToken: msg.sessionToken,
          playerId: msg.playerId,
          serverOverride: this.serverOverride,
          runSeedLabel: seedLabel,
        };
        persistSavedSession(this.activeSession);
      }
      this.emitTelemetry();
    } else if (msg.type === 'room:error') {
      if (
        msg.code === 'SESSION_EXPIRED' ||
        msg.code === 'ROOM_NOT_FOUND' ||
        msg.code === 'VERSION_MISMATCH'
      ) {
        this.clearSavedSession();
      }
      if (msg.code === 'VERSION_MISMATCH') {
        this.connectionState = 'blocked_version';
        this.emitTelemetry();
      }
    }

    for (const cb of this.listeners) cb(msg);
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
    }
    const attempt = this.reconnectAttempt;
    this.reconnectAttempt += 1;
    const delayMs = Math.min(8000, 1000 * Math.pow(2, Math.min(attempt, 3)));
    this.emitTelemetry();
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  private startHeartbeatLoop() {
    this.stopHeartbeatLoop();
    this.lastPacketAt = Date.now();
    this.heartbeatTimer = window.setInterval(() => {
      if (this.mode === 'ws') {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          if (this.activeSession && Date.now() - this.lastPacketAt > WATCHDOG_TIMEOUT_MS) {
            // Hung socket detected by heartbeat watchdog: force close to trigger token reconnect
            try {
              this.ws.close();
            } catch {
              // Ignore
            }
            return;
          }
          this.send({ type: 'net:ping', clientTs: performance.now() });
        }
      } else if (this.mode === 'p2p-guest' && this.guestSession?.isConnected()) {
        this.guestSession.send({ type: 'net:ping', clientTs: performance.now() });
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeatLoop() {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private closeWsOnly() {
    this.intentionalClose = true;
    this.stopHeartbeatLoop();
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
    this.stopHeartbeatLoop();
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

  private emitTelemetry() {
    const snap = this.getTelemetry();
    for (const cb of this.telemetryListeners) cb(snap);
  }
}

export const coopClient = new CoopClient();
