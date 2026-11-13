import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { CoopRoomManager } from './src/net/coopRoomCore.ts';
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
  // Prefer typical hotspot / LAN ranges first (192.168.x.x, 172.20.x.x, 10.x.x.x)
  return ips.sort((a, b) => {
    const score = (ip: string) =>
      ip.startsWith('192.168.') ? 0 : ip.startsWith('172.') ? 1 : ip.startsWith('10.') ? 2 : 3;
    return score(a) - score(b);
  });
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  const PORT = Number(process.env.PORT) || 3000;

  const sockets = new Map<string, WebSocket>();
  let peerSeq = 1;

  const roomManager = new CoopRoomManager((peerId: string, msg: CoopServerMessage) => {
    const ws = sockets.get(peerId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  });

  app.use(express.json());

  // Allow CORS for LAN / Hotspot PWA clients connecting to this local server IP
  app.use('/api', (_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });

  app.get('/api/rooms', (_req, res) => {
    res.json({ rooms: roomManager.listPublicRooms() });
  });

  app.get('/api/lan-info', (_req, res) => {
    const ips = getLanIPv4Addresses();
    const urls = ips.map((ip) => `http://${ip}:${PORT}`);
    res.json({ port: PORT, ips, urls });
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

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
    });

    ws.on('close', () => {
      roomManager.disconnectPeer(peerId);
      sockets.delete(peerId);
    });
  });

  // 20Hz authoritative room simulation loop
  setInterval(() => {
    roomManager.tickAllRooms();
  }, 50);

  server.listen(PORT, '0.0.0.0', () => {
    const ips = getLanIPv4Addresses();
    console.log(`Criptas del Eclipse servidor local escuchando en http://0.0.0.0:${PORT}`);
    if (ips.length > 0) {
      console.log('Direcciones LAN / Hotspot para otros dispositivos sin internet:');
      for (const ip of ips) {
        console.log(`  -> http://${ip}:${PORT}`);
      }
    }
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
