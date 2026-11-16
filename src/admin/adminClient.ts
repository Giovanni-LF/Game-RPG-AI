import type {
  AdminCommandResult,
  AdminServerSaveSummary,
  AdminServerSnapshot,
  AdminWsClientMessage,
  AdminWsServerMessage,
  RemoteAdminCommand,
} from '../shared/adminProtocol';
import type { PvpLeaderboardEntry, PvpMatchHistoryEntry } from '../types/coop';

const SERVER_STORAGE_KEY = 'criptas_ext_admin_server_v1';
const KEY_STORAGE_KEY = 'criptas_ext_admin_key_v1';

export function normalizeAdminServerUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:3000';
  }
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^wss?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^ws/i, 'http').replace(/\/ws(\/admin)?$/i, '');
  }
  return trimmed.includes(':') ? `http://${trimmed}` : `http://${trimmed}:3000`;
}

export function loadInitialAdminConfig(): {
  serverUrl: string;
  adminKey: string;
  autoConnect: boolean;
} {
  if (typeof window === 'undefined') {
    return { serverUrl: 'http://127.0.0.1:3000', adminKey: 'ECLIPSE-ADMIN-2026', autoConnect: false };
  }
  try {
    const params = new URLSearchParams(window.location.search);
    const paramServer = params.get('server') || params.get('servidor');
    const paramKey = params.get('key');
    const savedServer = localStorage.getItem(SERVER_STORAGE_KEY);
    const savedKey = localStorage.getItem(KEY_STORAGE_KEY);

    const serverUrl = normalizeAdminServerUrl(paramServer || savedServer || window.location.origin);
    const adminKey = (paramKey || savedKey || 'ECLIPSE-ADMIN-2026').trim();
    const autoConnect = Boolean(paramServer || paramKey || (savedServer && savedKey));
    return { serverUrl, adminKey, autoConnect };
  } catch {
    return {
      serverUrl: window.location.origin,
      adminKey: 'ECLIPSE-ADMIN-2026',
      autoConnect: false,
    };
  }
}

export function saveAdminConfig(serverUrl: string, adminKey: string) {
  try {
    localStorage.setItem(SERVER_STORAGE_KEY, normalizeAdminServerUrl(serverUrl));
    localStorage.setItem(KEY_STORAGE_KEY, adminKey.trim());
  } catch {
    // Ignore storage failure
  }
}

export class ExternalAdminClient {
  private ws: WebSocket | null = null;
  private serverUrl = '';
  private adminKey = '';
  private seq = 1;
  private reconnectTimer: number | null = null;
  private intentionalClose = false;

  private pending = new Map<
    string,
    { resolve: (res: AdminCommandResult) => void; timer: number }
  >();
  private snapshotListeners = new Set<(snap: AdminServerSnapshot) => void>();
  private statusListeners = new Set<(status: 'disconnected' | 'connecting' | 'connected' | 'error', error?: string) => void>();

  connect(serverUrlInput: string, adminKeyInput: string) {
    this.disconnect();
    this.serverUrl = normalizeAdminServerUrl(serverUrlInput);
    this.adminKey = adminKeyInput.trim();
    this.intentionalClose = false;
    saveAdminConfig(this.serverUrl, this.adminKey);
    this.openSocket();
  }

  disconnect() {
    this.intentionalClose = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    for (const [reqId, item] of this.pending.entries()) {
      window.clearTimeout(item.timer);
      item.resolve({
        requestId: reqId,
        clientId: '',
        ok: false,
        message: 'Conexión cerrada.',
      });
    }
    this.pending.clear();
    this.emitStatus('disconnected');
  }

  getServerUrl(): string {
    return this.serverUrl;
  }

  getAdminKey(): string {
    return this.adminKey;
  }

  onSnapshot(cb: (snap: AdminServerSnapshot) => void): () => void {
    this.snapshotListeners.add(cb);
    return () => this.snapshotListeners.delete(cb);
  }

  onStatus(
    cb: (status: 'disconnected' | 'connecting' | 'connected' | 'error', error?: string) => void
  ): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  requestRefresh() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'admin:refresh' } satisfies AdminWsClientMessage));
    }
  }

  async sendCommand(targetClientId: string, command: RemoteAdminCommand): Promise<AdminCommandResult> {
    const requestId = `cmd_${Date.now()}_${this.seq++}`;
    if (this.ws?.readyState === WebSocket.OPEN) {
      return new Promise((resolve) => {
        const timer = window.setTimeout(() => {
          this.pending.delete(requestId);
          resolve({
            requestId,
            clientId: targetClientId,
            ok: false,
            message: 'Tiempo de espera agotado ejecutando comando remoto.',
          });
        }, 5000);
        this.pending.set(requestId, { resolve, timer });
        this.ws!.send(
          JSON.stringify({
            type: 'admin:command',
            requestId,
            targetClientId,
            command,
          } satisfies AdminWsClientMessage)
        );
      });
    }

    // Fallback to REST HTTP if WS is temporarily unavailable
    const res = await this.apiFetch<{ ok: boolean; result: AdminCommandResult }>('/api/admin/command', {
      method: 'POST',
      body: JSON.stringify({ targetClientId, command }),
    });
    return res.result;
  }

  async fetchPvpLeaderboard(): Promise<{
    entries: PvpLeaderboardEntry[];
    recentMatches: PvpMatchHistoryEntry[];
  }> {
    const data = await this.apiFetch<{
      ok: boolean;
      entries: PvpLeaderboardEntry[];
      recentMatches: PvpMatchHistoryEntry[];
    }>('/api/admin/pvp/leaderboard');
    return {
      entries: data.entries ?? [],
      recentMatches: data.recentMatches ?? [],
    };
  }

  async updatePvpPlayer(
    playerKey: string,
    patch: {
      name?: string;
      elo?: number;
      wins?: number;
      losses?: number;
      winStreak?: number;
      reset?: boolean;
    }
  ): Promise<PvpLeaderboardEntry> {
    const data = await this.apiFetch<{ ok: boolean; player: PvpLeaderboardEntry }>(
      `/api/admin/pvp/player/${encodeURIComponent(playerKey)}`,
      {
        method: 'PUT',
        body: JSON.stringify(patch),
      }
    );
    return data.player;
  }

  async deletePvpPlayer(playerKey: string): Promise<boolean> {
    const data = await this.apiFetch<{ ok: boolean; deleted: boolean }>(
      `/api/admin/pvp/player/${encodeURIComponent(playerKey)}`,
      { method: 'DELETE' }
    );
    return data.deleted;
  }

  async resetPvpLeaderboard(): Promise<void> {
    await this.apiFetch('/api/admin/pvp/reset', { method: 'POST' });
  }

  async fetchServerSaves(): Promise<AdminServerSaveSummary[]> {
    const data = await this.apiFetch<{ ok: boolean; saves: AdminServerSaveSummary[] }>(
      '/api/admin/saves'
    );
    return data.saves ?? [];
  }

  async fetchSaveDetail(syncKey: string): Promise<Record<string, unknown>> {
    return this.apiFetch<Record<string, unknown>>(
      `/api/admin/saves/${encodeURIComponent(syncKey)}`
    );
  }

  async deleteServerSave(syncKey: string): Promise<boolean> {
    const data = await this.apiFetch<{ ok: boolean; deleted: boolean }>(
      `/api/admin/saves/${encodeURIComponent(syncKey)}`,
      { method: 'DELETE' }
    );
    return data.deleted;
  }

  async closeRoom(code: string): Promise<boolean> {
    const data = await this.apiFetch<{ ok: boolean; closed: boolean }>(
      `/api/admin/rooms/${encodeURIComponent(code)}/close`,
      { method: 'POST' }
    );
    return data.closed;
  }

  private async apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
    const base = normalizeAdminServerUrl(this.serverUrl);
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': this.adminKey,
        ...(init.headers || {}),
      },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((json as { error?: string }).error || `Error HTTP ${res.status}`);
    }
    return json as T;
  }

  private openSocket() {
    this.emitStatus('connecting');
    let wsUrl = '';
    try {
      const parsed = new URL(this.serverUrl);
      const proto = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${proto}//${parsed.host}/ws/admin?key=${encodeURIComponent(this.adminKey)}`;
    } catch {
      this.emitStatus('error', 'URL del servidor inválida.');
      return;
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      this.emitStatus('error', 'No se pudo iniciar la conexión WebSocket.');
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'admin:auth', key: this.adminKey } satisfies AdminWsClientMessage));
    };

    ws.onmessage = (evt) => {
      let msg: AdminWsServerMessage;
      try {
        msg = JSON.parse(String(evt.data)) as AdminWsServerMessage;
      } catch {
        return;
      }

      if (msg.type === 'admin:welcome') {
        this.emitStatus('connected');
        this.emitSnapshot(msg.snapshot);
        return;
      }

      if (msg.type === 'admin:snapshot') {
        this.emitSnapshot(msg.snapshot);
        return;
      }

      if (msg.type === 'admin:command_result') {
        const pending = this.pending.get(msg.result.requestId);
        if (pending) {
          window.clearTimeout(pending.timer);
          this.pending.delete(msg.result.requestId);
          pending.resolve(msg.result);
        }
        return;
      }

      if (msg.type === 'admin:error') {
        this.emitStatus('error', msg.message);
      }
    };

    ws.onclose = () => {
      this.ws = null;
      if (!this.intentionalClose) {
        this.emitStatus('disconnected');
        if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = null;
          if (!this.intentionalClose) this.openSocket();
        }, 3000);
      }
    };

    ws.onerror = () => {
      // Handled by onclose
    };
  }

  private emitSnapshot(snap: AdminServerSnapshot) {
    for (const cb of this.snapshotListeners) cb(snap);
  }

  private emitStatus(
    status: 'disconnected' | 'connecting' | 'connected' | 'error',
    error?: string
  ) {
    for (const cb of this.statusListeners) cb(status, error);
  }
}
