import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { GAME_CATALOG } from './src/data/gameData.ts';
import { CoopRoomManager } from './src/net/coopRoomCore.ts';
import {
  adminDeletePvpPlayer,
  adminResetPvpLeaderboard,
  adminUpdatePvpLeaderboardPlayer,
  getPvpLeaderboard,
  getPvpPlayerStanding,
  recordPvpMatchOutcome,
} from './src/server/pvpStorage.ts';
import {
  deleteServerSave,
  isValidSlotId,
  listServerSaves,
  normalizeSyncKey,
  readServerSave,
  writeServerSave,
  writeServerSlot,
} from './src/server/saveStorage.ts';
import type {
  AdminCommandResult,
  AdminServerSnapshot,
  AdminWsClientMessage,
  AdminWsServerMessage,
  AgentWsClientMessage,
  ConnectedGameClientSummary,
  RemoteAdminCommand,
} from './src/shared/adminProtocol.ts';
import { APP_VERSION } from './src/shared/protocol.ts';
import type { CoopClientMessage, CoopServerMessage } from './src/types/coop.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getLanIPv4Addresses(): string[] {
  const nets = os.networkInterfaces();
  const ips: string[] = [];
  for (const ifaceList of Object.values(nets)) {
    if (!ifaceList) continue;
    for (const net of ifaceList) {
      if (
        net.family === 'IPv4' &&
        !net.internal &&
        net.address &&
        !net.address.startsWith('169.254.')
      ) {
        ips.push(net.address);
      }
    }
  }
  return ips.sort((a, b) => {
    const score = (ip: string) =>
      ip.startsWith('192.168.') ? 0 : ip.startsWith('172.') ? 1 : ip.startsWith('10.') ? 2 : 3;
    return score(a) - score(b);
  });
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const agentWss = new WebSocketServer({ noServer: true });
  const adminWss = new WebSocketServer({ noServer: true });

  const PORT = Number(process.env.PORT) || 3000;
  const ADMIN_KEY = (process.env.ADMIN_KEY || 'ECLIPSE-ADMIN-2026').trim();
  const startedAtMs = Date.now();

  server.on('upgrade', (req, socket, head) => {
    try {
      const parsed = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (parsed.pathname === '/ws') {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      } else if (parsed.pathname === '/ws/agent') {
        agentWss.handleUpgrade(req, socket, head, (ws) => {
          agentWss.emit('connection', ws, req);
        });
      } else if (parsed.pathname === '/ws/admin') {
        adminWss.handleUpgrade(req, socket, head, (ws) => {
          adminWss.emit('connection', ws, req);
        });
      }
    } catch {
      socket.destroy();
    }
  });

  const sockets = new Map<string, WebSocket>();
  let peerSeq = 1;

  const roomManager = new CoopRoomManager(
    (peerId: string, msg: CoopServerMessage) => {
      const ws = sockets.get(peerId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    },
    {
      getPvpPlayerStanding: async (playerKey, playerName) => {
        const entry = await getPvpPlayerStanding(playerKey, playerName);
        return { elo: entry.elo, tierName: entry.tierName };
      },
      commitPvpMatchOutcome: async (req) => {
        const res = await recordPvpMatchOutcome(req);
        return {
          winnerEloBefore: res.winnerBefore,
          winnerEloAfter: res.winner.elo,
          winnerDelta: res.winnerDelta,
          loserEloBefore: res.loserBefore,
          loserEloAfter: res.loser.elo,
          loserDelta: res.loserDelta,
          winnerTierName: res.winner.tierName,
          loserTierName: res.loser.tierName,
          winnerNewTitle: res.winnerNewTitle,
          loserNewTitle: res.loserNewTitle,
          winnerSouls: res.winnerSouls,
          loserSouls: res.loserSouls,
        };
      },
    }
  );

  // Connected Game Client Agents & External Admin Dashboards
  const agentPeers = new Map<
    string,
    {
      ws: WebSocket;
      summary: ConnectedGameClientSummary;
    }
  >();
  const adminPeers = new Map<WebSocket, { authed: boolean }>();
  const pendingAdminRequests = new Map<
    string,
    {
      resolve: (res: AdminCommandResult) => void;
      timer: NodeJS.Timeout;
    }
  >();
  let adminBroadcastTimer: NodeJS.Timeout | null = null;
  let adminReqSeq = 1;

  function extractAdminKeyFromReq(req: express.Request | http.IncomingMessage): string {
    const headers = req.headers;
    const xKey = headers['x-admin-key'];
    if (typeof xKey === 'string' && xKey.trim()) return xKey.trim();
    const auth = headers['authorization'];
    if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
      return auth.slice(7).trim();
    }
    try {
      const parsed = new URL(req.url || '/', 'http://localhost');
      const qKey = parsed.searchParams.get('key');
      if (qKey) return qKey.trim();
    } catch {
      // ignore URL parse error
    }
    return '';
  }

  function requireAdminAuth(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    if (extractAdminKeyFromReq(req) !== ADMIN_KEY) {
      res.status(401).json({ ok: false, error: 'Clave de administrador inválida o ausente.' });
      return;
    }
    next();
  }

  async function buildAdminSnapshot(): Promise<AdminServerSnapshot> {
    const ips = getLanIPv4Addresses();
    const lanUrls = ips.map((ip) => `http://${ip}:${PORT}`);
    const [lb, saves] = await Promise.all([
      getPvpLeaderboard(50).catch(() => ({ entries: [], recentMatches: [] })),
      listServerSaves().catch(() => []),
    ]);
    return {
      serverVersion: APP_VERSION,
      uptimeSec: Math.floor((Date.now() - startedAtMs) / 1000),
      lanUrls,
      clients: Array.from(agentPeers.values()).map((a) => a.summary),
      rooms: roomManager.listAllAdminRooms(),
      leaderboardCount: lb.entries.length,
      savesCount: saves.length,
    };
  }

  function sendAdminWs(ws: WebSocket, msg: AdminWsServerMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  async function broadcastAdminSnapshot() {
    if (adminPeers.size === 0) return;
    const authedSockets = Array.from(adminPeers.entries())
      .filter(([, meta]) => meta.authed)
      .map(([ws]) => ws);
    if (authedSockets.length === 0) return;
    const snapshot = await buildAdminSnapshot();
    const payload = JSON.stringify({ type: 'admin:snapshot', snapshot } satisfies AdminWsServerMessage);
    for (const ws of authedSockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }

  function scheduleAdminBroadcast() {
    if (adminBroadcastTimer || adminPeers.size === 0) return;
    adminBroadcastTimer = setTimeout(() => {
      adminBroadcastTimer = null;
      void broadcastAdminSnapshot();
    }, 150);
  }

  function dispatchAdminCommandToClient(
    targetClientId: string,
    command: RemoteAdminCommand,
    customRequestId?: string
  ): Promise<AdminCommandResult> {
    const requestId = customRequestId || `adm_${Date.now()}_${adminReqSeq++}`;
    const target = agentPeers.get(targetClientId);
    if (!target || target.ws.readyState !== WebSocket.OPEN) {
      return Promise.resolve({
        requestId,
        clientId: targetClientId,
        ok: false,
        message: 'El cliente de juego seleccionado no está conectado.',
      });
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingAdminRequests.delete(requestId);
        resolve({
          requestId,
          clientId: targetClientId,
          ok: false,
          message: 'Tiempo de espera agotado esperando respuesta del cliente.',
        });
      }, 4500);

      pendingAdminRequests.set(requestId, { resolve, timer });
      target.ws.send(
        JSON.stringify({
          type: 'agent:command',
          requestId,
          command,
        })
      );
    });
  }

  app.use(express.json({ limit: '2mb' }));

  // Allow CORS for external Admin Web Apps & LAN / Hotspot PWA clients
  app.use('/api', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Key, X-Save-Key');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.get('/api/version', (_req, res) => {
    res.json({ ok: true, version: APP_VERSION });
  });

  app.get('/api/catalog', (_req, res) => {
    res.json({ ok: true, version: APP_VERSION, catalog: GAME_CATALOG });
  });

  app.get('/api/rooms', (_req, res) => {
    res.json({ rooms: roomManager.listPublicRooms(), version: APP_VERSION });
  });

  app.get('/api/pvp/rooms', (_req, res) => {
    res.json({ ok: true, rooms: roomManager.listPublicPvpRooms(), version: APP_VERSION });
  });

  app.get('/api/pvp/leaderboard', async (req, res) => {
    try {
      const limit = Math.min(50, Math.max(5, Number(req.query.limit) || 30));
      const data = await getPvpLeaderboard(limit);
      res.json({ ok: true, ...data, version: APP_VERSION });
    } catch {
      res.status(500).json({ ok: false, error: 'Error cargando clasificación PvP.' });
    }
  });

  app.get('/api/pvp/player/:playerKey', async (req, res) => {
    try {
      const name = typeof req.query.name === 'string' ? req.query.name : undefined;
      const entry = await getPvpPlayerStanding(req.params.playerKey, name);
      res.json({ ok: true, player: entry, version: APP_VERSION });
    } catch {
      res.status(500).json({ ok: false, error: 'Error consultando perfil PvP.' });
    }
  });

  app.get('/api/lan-info', (_req, res) => {
    const ips = getLanIPv4Addresses();
    const urls = ips.map((ip) => `http://${ip}:${PORT}`);
    res.json({ port: PORT, ips, urls, version: APP_VERSION });
  });

  // =========================================================================
  // EXTERNAL ADMIN WEB APP REST API (/api/admin/*)
  // =========================================================================
  app.get('/api/admin/ping', (_req, res) => {
    res.json({
      ok: true,
      service: 'criptas-admin-bridge',
      version: APP_VERSION,
      wsAdminPath: '/ws/admin',
      requiresKey: true,
    });
  });

  app.get('/api/admin/status', requireAdminAuth, async (_req, res) => {
    const snapshot = await buildAdminSnapshot();
    res.json({ ok: true, snapshot });
  });

  app.post('/api/admin/command', requireAdminAuth, async (req, res) => {
    const body = req.body as { targetClientId?: string; command?: RemoteAdminCommand } | undefined;
    if (!body?.targetClientId || !body?.command?.type) {
      res.status(400).json({ ok: false, error: 'Falta targetClientId o command válido.' });
      return;
    }
    const result = await dispatchAdminCommandToClient(body.targetClientId, body.command);
    res.status(result.ok ? 200 : 404).json({ ok: result.ok, result });
  });

  app.get('/api/admin/pvp/leaderboard', requireAdminAuth, async (_req, res) => {
    try {
      const data = await getPvpLeaderboard(50);
      res.json({ ok: true, ...data });
    } catch {
      res.status(500).json({ ok: false, error: 'No se pudo leer la clasificación PvP.' });
    }
  });

  app.put('/api/admin/pvp/player/:playerKey', requireAdminAuth, async (req, res) => {
    try {
      const body = req.body as {
        name?: string;
        elo?: number;
        wins?: number;
        losses?: number;
        winStreak?: number;
        reset?: boolean;
      };
      const updated = await adminUpdatePvpLeaderboardPlayer(req.params.playerKey, body || {});
      scheduleAdminBroadcast();
      res.json({ ok: true, player: updated });
    } catch {
      res.status(500).json({ ok: false, error: 'No se pudo actualizar el jugador PvP.' });
    }
  });

  app.delete('/api/admin/pvp/player/:playerKey', requireAdminAuth, async (req, res) => {
    try {
      const deleted = await adminDeletePvpPlayer(req.params.playerKey);
      scheduleAdminBroadcast();
      res.json({ ok: true, deleted });
    } catch {
      res.status(500).json({ ok: false, error: 'No se pudo eliminar el jugador PvP.' });
    }
  });

  app.post('/api/admin/pvp/reset', requireAdminAuth, async (_req, res) => {
    try {
      await adminResetPvpLeaderboard();
      scheduleAdminBroadcast();
      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false, error: 'No se pudo reiniciar la clasificación PvP.' });
    }
  });

  app.get('/api/admin/saves', requireAdminAuth, async (_req, res) => {
    try {
      const saves = await listServerSaves();
      res.json({ ok: true, saves });
    } catch {
      res.status(500).json({ ok: false, error: 'No se pudieron listar los guardados del servidor.' });
    }
  });

  app.get('/api/admin/saves/:syncKey', requireAdminAuth, async (req, res) => {
    const syncKey = normalizeSyncKey(req.params.syncKey);
    if (!syncKey) {
      res.status(400).json({ ok: false, error: 'Código de guardado inválido.' });
      return;
    }
    try {
      const result = await readServerSave(syncKey);
      res.json({ ok: true, syncKey, ...result });
    } catch {
      res.status(500).json({ ok: false, error: 'Error leyendo guardado.' });
    }
  });

  app.delete('/api/admin/saves/:syncKey', requireAdminAuth, async (req, res) => {
    const syncKey = normalizeSyncKey(req.params.syncKey);
    if (!syncKey) {
      res.status(400).json({ ok: false, error: 'Código de guardado inválido.' });
      return;
    }
    try {
      const deleted = await deleteServerSave(syncKey);
      scheduleAdminBroadcast();
      res.json({ ok: true, deleted });
    } catch {
      res.status(500).json({ ok: false, error: 'Error eliminando guardado.' });
    }
  });

  app.post('/api/admin/rooms/:code/close', requireAdminAuth, (req, res) => {
    const closed = roomManager.closeRoomByCode(req.params.code);
    scheduleAdminBroadcast();
    res.json({ ok: closed, closed });
  });

  // =========================================================================
  // SAVE SYNC ENDPOINTS (/api/saves/*)
  // =========================================================================
  app.get('/api/saves/:syncKey', async (req, res) => {
    const syncKey = normalizeSyncKey(req.params.syncKey);
    if (!syncKey) {
      res.status(400).json({ ok: false, error: 'Código de guardado inválido (mínimo 4 caracteres).' });
      return;
    }
    try {
      const result = await readServerSave(syncKey);
      res.json({ ok: true, syncKey, ...result });
    } catch {
      res.status(500).json({ ok: false, error: 'Error leyendo guardado del servidor.' });
    }
  });

  app.put('/api/saves/:syncKey', async (req, res) => {
    const syncKey = normalizeSyncKey(req.params.syncKey);
    if (!syncKey) {
      res.status(400).json({ ok: false, error: 'Código de guardado inválido (mínimo 4 caracteres).' });
      return;
    }
    try {
      const storePayload = (req.body as { store?: unknown } | undefined)?.store ?? req.body;
      const saved = await writeServerSave(syncKey, storePayload);
      scheduleAdminBroadcast();
      res.json({ ok: true, syncKey, ...saved });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo guardar en el servidor.';
      res.status(400).json({ ok: false, error: message });
    }
  });

  app.get('/api/saves/:syncKey/slots/:slotId', async (req, res) => {
    const syncKey = normalizeSyncKey(req.params.syncKey);
    const slotId = req.params.slotId;
    if (!syncKey || !isValidSlotId(slotId)) {
      res.status(400).json({ ok: false, error: 'Código de guardado o ranura inválida.' });
      return;
    }
    try {
      const result = await readServerSave(syncKey);
      if (!result.found || !result.store) {
        res.json({ ok: true, found: false, syncKey, slotId });
        return;
      }
      res.json({
        ok: true,
        found: true,
        syncKey,
        slotId,
        updatedAtIso: result.updatedAtIso,
        profile: result.store.profiles[slotId],
      });
    } catch {
      res.status(500).json({ ok: false, error: 'Error consultando ranura en el servidor.' });
    }
  });

  app.put('/api/saves/:syncKey/slots/:slotId', async (req, res) => {
    const syncKey = normalizeSyncKey(req.params.syncKey);
    const slotId = req.params.slotId;
    if (!syncKey || !isValidSlotId(slotId)) {
      res.status(400).json({ ok: false, error: 'Código de guardado o ranura inválida.' });
      return;
    }
    try {
      const profilePayload = (req.body as { profile?: unknown } | undefined)?.profile ?? req.body;
      const saved = await writeServerSlot(syncKey, slotId, profilePayload);
      scheduleAdminBroadcast();
      res.json({ ok: true, syncKey, slotId, ...saved });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error guardando ranura en el servidor.';
      res.status(400).json({ ok: false, error: message });
    }
  });

  app.delete('/api/saves/:syncKey', async (req, res) => {
    const syncKey = normalizeSyncKey(req.params.syncKey);
    if (!syncKey) {
      res.status(400).json({ ok: false, error: 'Código de guardado inválido.' });
      return;
    }
    try {
      const deleted = await deleteServerSave(syncKey);
      scheduleAdminBroadcast();
      res.json({ ok: true, syncKey, deleted });
    } catch {
      res.status(500).json({ ok: false, error: 'Error eliminando guardado en el servidor.' });
    }
  });

  // =========================================================================
  // STATIC / SPA / SEPARATE ADMIN WEB APP ENTRYPOINTS (/ & /admin)
  // =========================================================================
  if (process.env.NODE_ENV === 'production') {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get(['/admin', '/admin/', '/admin.html'], (_req, res) => {
      res.sendFile(path.join(distDir, 'admin.html'));
    });
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: {
        middlewareMode: true,
        ws: { server },
      },
      appType: 'spa',
    });
    app.use((req, _res, next) => {
      if (req.path === '/admin' || req.path === '/admin/') {
        const queryIdx = req.url.indexOf('?');
        const qs = queryIdx >= 0 ? req.url.slice(queryIdx) : '';
        req.url = `/admin.html${qs}`;
      }
      next();
    });
    app.use(vite.middlewares);
  }

  // Co-op / PvP Game Rooms WebSocket
  wss.on('connection', (ws) => {
    const peerId = `ws_${peerSeq++}`;
    sockets.set(peerId, ws);
    roomManager.registerPeer(peerId);

    ws.on('message', (rawBuf) => {
      let msg: CoopClientMessage;
      try {
        msg = JSON.parse(rawBuf.toString()) as CoopClientMessage;
      } catch {
        return;
      }
      roomManager.handleMessage(peerId, msg);
      if (
        msg.type === 'room:create' ||
        msg.type === 'room:join' ||
        msg.type === 'room:leave' ||
        msg.type === 'pvp:create' ||
        msg.type === 'pvp:join'
      ) {
        scheduleAdminBroadcast();
      }
    });

    ws.on('close', () => {
      roomManager.disconnectPeer(peerId);
      sockets.delete(peerId);
      scheduleAdminBroadcast();
    });
  });

  // Base-Game Client Agent WebSocket (/ws/agent)
  agentWss.on('connection', (ws) => {
    let registeredClientId: string | null = null;

    ws.on('message', (rawBuf) => {
      let msg: AgentWsClientMessage;
      try {
        msg = JSON.parse(rawBuf.toString()) as AgentWsClientMessage;
      } catch {
        return;
      }

      if (msg.type === 'agent:register' || msg.type === 'agent:state') {
        const incoming = msg.state;
        if (!incoming?.clientId) return;
        registeredClientId = incoming.clientId;
        const prev = agentPeers.get(registeredClientId);
        const nowIso = new Date().toISOString();
        agentPeers.set(registeredClientId, {
          ws,
          summary: {
            ...incoming,
            connectedAtIso: prev?.summary.connectedAtIso ?? nowIso,
            lastSeenIso: nowIso,
          },
        });
        scheduleAdminBroadcast();
        return;
      }

      if (msg.type === 'agent:command_ack') {
        if (msg.state && registeredClientId) {
          const prev = agentPeers.get(registeredClientId);
          agentPeers.set(registeredClientId, {
            ws,
            summary: {
              ...msg.state,
              connectedAtIso: prev?.summary.connectedAtIso ?? new Date().toISOString(),
              lastSeenIso: new Date().toISOString(),
            },
          });
          scheduleAdminBroadcast();
        }
        const pending = pendingAdminRequests.get(msg.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          pendingAdminRequests.delete(msg.requestId);
          pending.resolve({
            requestId: msg.requestId,
            clientId: registeredClientId || '',
            ok: msg.ok,
            message: msg.message,
          });
        }
      }
    });

    ws.on('close', () => {
      if (registeredClientId) {
        const cur = agentPeers.get(registeredClientId);
        if (cur && cur.ws === ws) {
          agentPeers.delete(registeredClientId);
          scheduleAdminBroadcast();
        }
      }
    });
  });

  // External Admin Web App WebSocket (/ws/admin)
  adminWss.on('connection', async (ws, req) => {
    const queryKey = extractAdminKeyFromReq(req);
    const authedInitially = queryKey === ADMIN_KEY;
    adminPeers.set(ws, { authed: authedInitially });

    if (authedInitially) {
      const snapshot = await buildAdminSnapshot();
      sendAdminWs(ws, { type: 'admin:welcome', snapshot });
    }

    ws.on('message', async (rawBuf) => {
      let msg: AdminWsClientMessage;
      try {
        msg = JSON.parse(rawBuf.toString()) as AdminWsClientMessage;
      } catch {
        return;
      }

      if (msg.type === 'admin:auth') {
        if (String(msg.key || '').trim() === ADMIN_KEY) {
          adminPeers.set(ws, { authed: true });
          const snapshot = await buildAdminSnapshot();
          sendAdminWs(ws, { type: 'admin:welcome', snapshot });
        } else {
          sendAdminWs(ws, { type: 'admin:error', message: 'Clave de administrador incorrecta.' });
        }
        return;
      }

      const peerMeta = adminPeers.get(ws);
      if (!peerMeta?.authed) {
        sendAdminWs(ws, { type: 'admin:error', message: 'No autenticado.' });
        return;
      }

      if (msg.type === 'admin:refresh') {
        const snapshot = await buildAdminSnapshot();
        sendAdminWs(ws, { type: 'admin:snapshot', snapshot });
        return;
      }

      if (msg.type === 'admin:command') {
        const result = await dispatchAdminCommandToClient(
          msg.targetClientId,
          msg.command,
          msg.requestId
        );
        sendAdminWs(ws, { type: 'admin:command_result', result });
        void broadcastAdminSnapshot();
      }
    });

    ws.on('close', () => {
      adminPeers.delete(ws);
    });
  });

  // 20Hz authoritative room simulation loop
  setInterval(() => {
    roomManager.tickAllRooms();
  }, 50);

  server.listen(PORT, '0.0.0.0', () => {
    const ips = getLanIPv4Addresses();
    console.log(`Criptas del Eclipse servidor local escuchando en http://0.0.0.0:${PORT}`);
    console.log(`Panel de Administración Externo disponible en http://localhost:${PORT}/admin (Clave: ${ADMIN_KEY})`);
    if (ips.length > 0) {
      console.log('Direcciones LAN / Hotspot para otros dispositivos sin internet:');
      for (const ip of ips) {
        console.log(`  -> Juego: http://${ip}:${PORT} | Admin: http://${ip}:${PORT}/admin`);
      }
    }
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
