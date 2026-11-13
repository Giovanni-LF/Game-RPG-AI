import type {
  CoopClientMessage,
  CoopPlayerSync,
  CoopServerMessage,
} from '../types/coop.ts';
import type { ArchetypeId, WeaponKind } from '../types/game.ts';
import { CoopRoomManager } from './coopRoomCore.ts';

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(b64url: string): Uint8Array {
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

async function compressString(str: string): Promise<{ compressed: boolean; data: string }> {
  const raw = new TextEncoder().encode(str);
  if (typeof CompressionStream !== 'undefined') {
    try {
      const cs = new CompressionStream('deflate-raw');
      const writer = cs.writable.getWriter();
      await writer.write(raw);
      await writer.close();
      const buf = await new Response(cs.readable).arrayBuffer();
      return { compressed: true, data: toBase64Url(new Uint8Array(buf)) };
    } catch {
      // Fallback below
    }
  }
  return { compressed: false, data: toBase64Url(raw) };
}

async function decompressString(data: string, compressed: boolean): Promise<string> {
  const bytes = fromBase64Url(data);
  if (compressed && typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    await writer.write(bytes as unknown as BufferSource);
    await writer.close();
    const buf = await new Response(ds.readable).arrayBuffer();
    return new TextDecoder().decode(buf);
  }
  return new TextDecoder().decode(bytes);
}

async function encodeToken(kind: '1' | '2', payload: object): Promise<string> {
  const json = JSON.stringify(payload);
  const { compressed, data } = await compressString(json);
  return `C${kind}${compressed ? 'Z' : 'R'}:${data}`;
}

async function decodeToken<T>(token: string, expectedKind: '1' | '2'): Promise<T> {
  const clean = token.trim().replace(/\s+/g, '');
  const prefix = clean.slice(0, 4);
  if (prefix !== `C${expectedKind}Z:` && prefix !== `C${expectedKind}R:`) {
    throw new Error(
      expectedKind === '1'
        ? 'Código de invitación inválido (debe empezar por C1Z: o C1R:).'
        : 'Código de respuesta inválido (debe empezar por C2Z: o C2R:).'
    );
  }
  const compressed = prefix[2] === 'Z';
  const json = await decompressString(clean.slice(4), compressed);
  return JSON.parse(json) as T;
}

function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    let resolved = false;
    let candidateSeenTimer: number | null = null;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      pc.removeEventListener('icegatheringstatechange', onState);
      pc.removeEventListener('icecandidate', onCandidate);
      if (candidateSeenTimer !== null) window.clearTimeout(candidateSeenTimer);
      window.clearTimeout(hardTimer);
      resolve();
    };

    const onState = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };

    const onCandidate = (ev: RTCPeerConnectionIceEvent) => {
      if (!ev.candidate) {
        finish();
        return;
      }
      if (candidateSeenTimer === null) {
        candidateSeenTimer = window.setTimeout(finish, 900);
      }
    };

    const hardTimer = window.setTimeout(finish, 2800);
    pc.addEventListener('icegatheringstatechange', onState);
    pc.addEventListener('icecandidate', onCandidate);
  });
}

export interface HostSetupPayload {
  playerName: string;
  archetype: ArchetypeId;
  weaponKind: WeaponKind;
  classTitle: string;
  maxHp: number;
}

interface GuestPeerSlot {
  slotId: string;
  peerId: string;
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  connected: boolean;
}

export class HotspotHostSession {
  private roomManager: CoopRoomManager;
  private hostPlayerId: string;
  private roomCode = '';
  private slots = new Map<string, GuestPeerSlot>();
  private tickTimer: number;
  private slotSeq = 1;
  private hasEnteredGame = false;
  private messageListeners = new Set<(msg: CoopServerMessage) => void>();
  private guestsListeners = new Set<(players: CoopPlayerSync[]) => void>();
  private destroyed = false;

  constructor(hostSetup: HostSetupPayload) {
    this.roomManager = new CoopRoomManager((peerId, msg) => {
      if (peerId === 'host_local') {
        if (msg.type === 'room:joined') {
          this.roomCode = msg.roomCode;
          if (!this.hasEnteredGame) return; // Wait until host clicks "Entrar a la Cripta"
        }
        if (
          msg.type === 'player:joined' ||
          msg.type === 'player:left' ||
          msg.type === 'world:tick'
        ) {
          this.emitGuestsUpdate();
        }
        if (this.hasEnteredGame || msg.type === 'chat:message' || msg.type === 'room:error') {
          for (const cb of this.messageListeners) cb(msg);
        }
        return;
      }

      // Send over P2P DataChannel to remote guest
      for (const slot of this.slots.values()) {
        if (slot.peerId === peerId && slot.dc && slot.dc.readyState === 'open') {
          try {
            slot.dc.send(JSON.stringify(msg));
          } catch {
            // Ignore transient send error
          }
          break;
        }
      }
    });

    this.hostPlayerId = this.roomManager.registerPeer('host_local');
    this.roomManager.handleMessage('host_local', {
      type: 'room:create',
      playerName: hostSetup.playerName,
      archetype: hostSetup.archetype,
      weaponKind: hostSetup.weaponKind,
      classTitle: hostSetup.classTitle,
      maxHp: hostSetup.maxHp,
      isPublic: false,
    });

    this.tickTimer = window.setInterval(() => {
      if (!this.destroyed) {
        this.roomManager.tickAllRooms();
      }
    }, 50);
  }

  getRoomCode(): string {
    return this.roomCode;
  }

  getPlayers(): CoopPlayerSync[] {
    const room = this.roomManager.getRoomSnapshot(this.roomCode);
    return room ? Array.from(room.players.values()) : [];
  }

  async createInviteOffer(): Promise<{ slotId: string; offerToken: string; roomCode: string }> {
    const slotId = `guest_${this.slotSeq++}`;
    const peerId = `p2p_${slotId}`;
    const pc = new RTCPeerConnection({ iceServers: [] });
    const dc = pc.createDataChannel('criptas-coop', { ordered: true });

    const slot: GuestPeerSlot = {
      slotId,
      peerId,
      pc,
      dc,
      connected: false,
    };
    this.slots.set(slotId, slot);

    dc.onopen = () => {
      slot.connected = true;
      this.roomManager.registerPeer(peerId);
      this.emitGuestsUpdate();
    };

    dc.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(String(evt.data)) as CoopClientMessage;
        this.roomManager.handleMessage(peerId, parsed);
        if (parsed.type === 'room:join') {
          this.emitGuestsUpdate();
        }
      } catch {
        // Ignore invalid JSON packet
      }
    };

    dc.onclose = () => {
      slot.connected = false;
      this.roomManager.disconnectPeer(peerId);
      this.emitGuestsUpdate();
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        slot.connected = false;
        this.roomManager.disconnectPeer(peerId);
        this.emitGuestsUpdate();
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc);

    const localSdp = pc.localDescription?.sdp;
    if (!localSdp) {
      throw new Error('No se pudo generar la oferta de conexión local.');
    }

    const offerToken = await encodeToken('1', { s: localSdp, r: this.roomCode });
    return { slotId, offerToken, roomCode: this.roomCode };
  }

  async acceptGuestAnswer(slotId: string, answerToken: string): Promise<void> {
    const slot = this.slots.get(slotId);
    if (!slot) {
      throw new Error('La invitación seleccionada ya no está activa.');
    }
    const parsed = await decodeToken<{ s: string }>(answerToken, '2');
    await slot.pc.setRemoteDescription({ type: 'answer', sdp: parsed.s });
  }

  enterRoomNow() {
    this.hasEnteredGame = true;
    const room = this.roomManager.getRoomSnapshot(this.roomCode);
    if (!room) return;
    const joinedMsg: CoopServerMessage = {
      type: 'room:joined',
      roomCode: room.code,
      playerId: this.hostPlayerId,
      floorNumber: room.floorNumber,
      floorSeed: room.floorSeed,
      players: Array.from(room.players.values()),
      enemies: room.enemies.map((e) => ({
        id: e.id,
        type: e.type,
        name: e.name,
        isBoss: e.isBoss,
        x: e.x,
        y: e.y,
        facing: e.facing,
        hp: e.hp,
        maxHp: e.maxHp,
        radius: e.radius,
        speed: e.speed,
        damage: e.damage,
        xpValue: e.xpValue,
        goldValue: e.goldValue,
        state: e.state,
        telegraph: e.telegraph,
        roomId: e.roomId,
      })),
      interactedPropIds: Array.from(room.interactedPropIds),
      brokenPropIds: Array.from(room.brokenPropIds),
      portalOpen: room.portalOpen,
    };
    for (const cb of this.messageListeners) cb(joinedMsg);
  }

  sendFromHost(msg: CoopClientMessage) {
    this.roomManager.handleMessage('host_local', msg);
  }

  onHostMessage(cb: (msg: CoopServerMessage) => void): () => void {
    this.messageListeners.add(cb);
    return () => this.messageListeners.delete(cb);
  }

  onGuestsChange(cb: (players: CoopPlayerSync[]) => void): () => void {
    this.guestsListeners.add(cb);
    return () => this.guestsListeners.delete(cb);
  }

  private emitGuestsUpdate() {
    const players = this.getPlayers();
    for (const cb of this.guestsListeners) cb(players);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    window.clearInterval(this.tickTimer);
    for (const slot of this.slots.values()) {
      try {
        slot.dc?.close();
      } catch {
        // Ignore
      }
      try {
        slot.pc.close();
      } catch {
        // Ignore
      }
    }
    this.slots.clear();
    this.roomManager.disconnectPeer('host_local');
    this.messageListeners.clear();
    this.guestsListeners.clear();
  }
}

export class HotspotGuestSession {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private pendingQueue: string[] = [];
  private messageListeners = new Set<(msg: CoopServerMessage) => void>();
  private statusListeners = new Set<(connected: boolean) => void>();
  private roomCode = '';
  private joinPayloadOnOpen: Omit<Extract<CoopClientMessage, { type: 'room:join' }>, 'type' | 'code'> | null =
    null;

  async acceptOfferAndCreateAnswer(
    offerToken: string,
    joinSetup: Omit<Extract<CoopClientMessage, { type: 'room:join' }>, 'type' | 'code'>
  ): Promise<{ answerToken: string; roomCode: string }> {
    this.destroy();

    const parsed = await decodeToken<{ s: string; r: string }>(offerToken, '1');
    this.roomCode = parsed.r;
    this.joinPayloadOnOpen = joinSetup;

    const pc = new RTCPeerConnection({ iceServers: [] });
    this.pc = pc;

    pc.ondatachannel = (ev) => {
      const dc = ev.channel;
      this.dc = dc;
      dc.onopen = () => {
        this.emitStatus(true);
        if (this.joinPayloadOnOpen) {
          this.send({
            type: 'room:join',
            code: this.roomCode,
            ...this.joinPayloadOnOpen,
          });
          this.joinPayloadOnOpen = null;
        }
        while (this.pendingQueue.length > 0 && dc.readyState === 'open') {
          const next = this.pendingQueue.shift();
          if (next) dc.send(next);
        }
      };

      dc.onmessage = (msgEvt) => {
        try {
          const msg = JSON.parse(String(msgEvt.data)) as CoopServerMessage;
          for (const cb of this.messageListeners) cb(msg);
        } catch {
          // Ignore invalid packet
        }
      };

      dc.onclose = () => {
        this.emitStatus(false);
      };
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.emitStatus(false);
      }
    };

    await pc.setRemoteDescription({ type: 'offer', sdp: parsed.s });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceGathering(pc);

    const localSdp = pc.localDescription?.sdp;
    if (!localSdp) {
      throw new Error('No se pudo generar la respuesta de conexión local.');
    }

    const answerToken = await encodeToken('2', { s: localSdp });
    return { answerToken, roomCode: this.roomCode };
  }

  send(msg: CoopClientMessage) {
    const raw = JSON.stringify(msg);
    if (this.dc && this.dc.readyState === 'open') {
      this.dc.send(raw);
    } else {
      this.pendingQueue.push(raw);
      if (this.pendingQueue.length > 40) this.pendingQueue.shift();
    }
  }

  isConnected(): boolean {
    return this.dc?.readyState === 'open';
  }

  onMessage(cb: (msg: CoopServerMessage) => void): () => void {
    this.messageListeners.add(cb);
    return () => this.messageListeners.delete(cb);
  }

  onStatus(cb: (connected: boolean) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  private emitStatus(connected: boolean) {
    for (const cb of this.statusListeners) cb(connected);
  }

  destroy() {
    if (this.dc) {
      try {
        this.dc.close();
      } catch {
        // Ignore
      }
      this.dc = null;
    }
    if (this.pc) {
      try {
        this.pc.close();
      } catch {
        // Ignore
      }
      this.pc = null;
    }
    this.pendingQueue = [];
  }
}
