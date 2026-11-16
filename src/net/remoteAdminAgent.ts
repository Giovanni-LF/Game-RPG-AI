import type {
  AgentWsClientMessage,
  AgentWsServerMessage,
  GameClientStateReport,
  RemoteAdminCommand,
} from '../shared/adminProtocol';
import { coopClient } from './coopClient';

const AGENT_CLIENT_ID_KEY = 'criptas_admin_agent_client_id_v1';

export function getOrCreateAdminAgentClientId(): string {
  if (typeof window === 'undefined') return 'cli_server';
  try {
    const existing = sessionStorage.getItem(AGENT_CLIENT_ID_KEY);
    if (existing && existing.trim()) return existing.trim();
    const fresh = `cli_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    sessionStorage.setItem(AGENT_CLIENT_ID_KEY, fresh);
    return fresh;
  } catch {
    return `cli_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  }
}

export interface RemoteAdminAgentHandlers {
  getState: () => GameClientStateReport;
  executeCommand: (
    command: RemoteAdminCommand
  ) => Promise<{ ok: boolean; message: string; state?: GameClientStateReport }> | {
    ok: boolean;
    message: string;
    state?: GameClientStateReport;
  };
}

export class RemoteAdminAgent {
  private ws: WebSocket | null = null;
  private disposed = false;
  private reconnectTimer: number | null = null;
  private keepaliveTimer: number | null = null;
  private throttleTimer: number | null = null;
  private reconnectDelayMs = 2000;
  private lastSentAt = 0;
  private pendingState: GameClientStateReport | null = null;
  private lastWsUrl = '';
  private handlers: RemoteAdminAgentHandlers;

  constructor(handlers: RemoteAdminAgentHandlers) {
    this.handlers = handlers;
  }

  private getAgentWsUrl(): string {
    const httpBase = coopClient.getHttpBaseUrl();
    try {
      const parsed = new URL(httpBase);
      const proto = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${parsed.host}/ws/agent`;
    } catch {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${window.location.host}/ws/agent`;
    }
  }

  start() {
    this.disposed = false;
    this.connect();
    if (this.keepaliveTimer === null) {
      this.keepaliveTimer = window.setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.sendRaw({ type: 'agent:state', state: this.handlers.getState() });
        } else if (this.getAgentWsUrl() !== this.lastWsUrl) {
          this.reconnectNow();
        }
      }, 3000);
    }
  }

  reconnectNow() {
    if (this.disposed) return;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      this.ws?.close();
    } catch {
      // Ignore close error
    }
    this.ws = null;
    this.reconnectDelayMs = 2000;
    this.connect();
  }

  stop() {
    this.disposed = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.keepaliveTimer !== null) {
      window.clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    if (this.throttleTimer !== null) {
      window.clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore close error
      }
      this.ws = null;
    }
  }

  notifyStateChanged(state?: GameClientStateReport) {
    if (this.disposed) return;
    const report = state ?? this.handlers.getState();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const now = Date.now();
    const elapsed = now - this.lastSentAt;
    if (elapsed >= 350) {
      this.lastSentAt = now;
      this.pendingState = null;
      this.sendRaw({ type: 'agent:state', state: report });
      return;
    }

    this.pendingState = report;
    if (this.throttleTimer === null) {
      this.throttleTimer = window.setTimeout(() => {
        this.throttleTimer = null;
        if (!this.disposed && this.pendingState && this.ws?.readyState === WebSocket.OPEN) {
          this.lastSentAt = Date.now();
          const toSend = this.pendingState;
          this.pendingState = null;
          this.sendRaw({ type: 'agent:state', state: toSend });
        }
      }, 360 - elapsed);
    }
  }

  private sendRaw(msg: AgentWsClientMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(msg));
      } catch {
        // Ignore transient WS send error
      }
    }
  }

  private connect() {
    if (this.disposed || typeof window === 'undefined') return;
    const url = this.getAgentWsUrl();
    this.lastWsUrl = url;

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;

    socket.onopen = () => {
      if (this.disposed || this.ws !== socket) return;
      this.reconnectDelayMs = 2000;
      this.lastSentAt = Date.now();
      this.sendRaw({
        type: 'agent:register',
        state: this.handlers.getState(),
      });
    };

    socket.onmessage = async (event) => {
      if (this.disposed) return;
      let msg: AgentWsServerMessage;
      try {
        msg = JSON.parse(String(event.data)) as AgentWsServerMessage;
      } catch {
        return;
      }
      if (msg.type !== 'agent:command') return;

      try {
        const result = await this.handlers.executeCommand(msg.command);
        const latestState = result.state ?? this.handlers.getState();
        this.sendRaw({
          type: 'agent:command_ack',
          requestId: msg.requestId,
          ok: result.ok,
          message: result.message,
          state: latestState,
        });
      } catch (err) {
        this.sendRaw({
          type: 'agent:command_ack',
          requestId: msg.requestId,
          ok: false,
          message: err instanceof Error ? err.message : 'Error ejecutando comando en el cliente.',
          state: this.handlers.getState(),
        });
      }
    };

    socket.onclose = () => {
      if (this.ws === socket) {
        this.ws = null;
      }
      if (!this.disposed) {
        this.scheduleReconnect();
      }
    };

    socket.onerror = () => {
      // Handled silently by onclose backoff so offline solo play shows zero errors
    };
  }

  private scheduleReconnect() {
    if (this.disposed || this.reconnectTimer !== null) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(10000, Math.round(this.reconnectDelayMs * 1.5));
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
