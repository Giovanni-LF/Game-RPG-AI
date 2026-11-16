import {
  ACTIVE_SKILLS,
  ARCHETYPES,
  computeHybridClassTitle,
  computePlayerStats,
  ENEMY_DEFINITIONS,
  ENEMY_SCALING,
  generateLootItem,
  getBossDisplayName,
  getBossFloorMultipliers,
} from '../data/gameData.ts';
import { generateDungeonFloor, isWalkableTile } from '../engine/dungeonGenerator.ts';
import {
  APP_VERSION,
  compareVersions,
  createSeededRng,
  deriveFloorSeed,
  generateRandomRunSeed,
} from '../shared/protocol.ts';
import {
  PVP_ARENA_CENTER,
  PVP_BASE_ELO,
  PVP_BEST_OF,
  PVP_COUNTDOWN_SEC,
  PVP_LOADOUTS,
  PVP_RING_MAX_RADIUS,
  PVP_RING_MIN_RADIUS,
  PVP_RING_SHRINK_START_SEC,
  PVP_ROUNDS_TO_WIN,
  PVP_ROUND_DURATION_SEC,
  PVP_ROUND_END_SEC,
  PVP_SPAWN_P1,
  PVP_SPAWN_P2,
  calculateEloDelta,
  computePvpHeroStats,
  generatePvpArenaFloor,
  getPvpStartingWeapon,
  getPvpTierInfo,
} from '../shared/pvp.ts';
import type {
  CoopAuthoritativeHeroState,
  CoopClientMessage,
  CoopEnemySync,
  CoopHeroBuildState,
  CoopPlayerSync,
  CoopRoomSummary,
  CoopServerMessage,
  PvpFighterSync,
  PvpRoomSummary,
  PvpRoomSyncState,
} from '../types/coop.ts';
import type {
  ArchetypeId,
  BlessingId,
  DungeonFloor,
  EnemyTelegraph,
  EnemyType,
  GroundLoot,
  PvpMatchPhase,
  PvpOrbEntity,
} from '../types/game.ts';

export interface ServerEnemy extends CoopEnemySync {
  attackCooldown: number;
  stateTimer: number;
  bleedTimer: number;
  bleedDps: number;
  slowTimer: number;
  bossPatternIndex: number;
  enraged?: boolean;
  floorNumber?: number;
}

export interface ServerPlayerRecord {
  sync: CoopPlayerSync;
  sessionToken: string;
  peerId: string | null;
  disconnectedAt: number | null;
  hero: CoopAuthoritativeHeroState;
  shieldTimer: number;
  hitWindowStart: number;
  hitCountInWindow: number;
  lastSkillCastAt: Record<string, number>;
}

export interface ServerPvpFighterExtra {
  playerKey: string;
  ready: boolean;
  roundsWon: number;
  elo: number;
  tierName: string;
  slotIndex: 0 | 1;
  ringTickAccum: number;
}

export interface ServerPvpState {
  phase: PvpMatchPhase;
  roundNumber: number;
  phaseTimer: number;
  ringRadius: number;
  orbs: PvpOrbEntity[];
  orbSpawnTimer: number;
  winnerId: string | null;
  winnerName: string | null;
  matchCommitted: boolean;
  fighters: Map<string, ServerPvpFighterExtra>;
}

export interface PvpMatchCommitRequest {
  winnerKey: string;
  winnerName: string;
  winnerArchetype: ArchetypeId;
  loserKey: string;
  loserName: string;
  loserArchetype: ArchetypeId;
  score: string;
}

export interface PvpMatchCommitResult {
  winnerEloBefore: number;
  winnerEloAfter: number;
  winnerDelta: number;
  loserEloBefore: number;
  loserEloAfter: number;
  loserDelta: number;
  winnerTierName: string;
  loserTierName: string;
  winnerNewTitle: string | null;
  loserNewTitle: string | null;
  winnerSouls: number;
  loserSouls: number;
}

export interface CoopRoomManagerHooks {
  getPvpPlayerStanding?: (
    playerKey: string,
    playerName?: string
  ) => Promise<{ elo: number; tierName: string }>;
  commitPvpMatchOutcome?: (req: PvpMatchCommitRequest) => Promise<PvpMatchCommitResult>;
}

export interface ServerRoom {
  code: string;
  mode: 'coop' | 'pvp';
  isPublic: boolean;
  runSeed: number;
  runSeedLabel: string;
  floorNumber: number;
  floorSeed: number;
  floor: DungeonFloor;
  players: Map<string, ServerPlayerRecord>;
  enemies: ServerEnemy[];
  groundLoot: GroundLoot[];
  interactedPropIds: Set<string>;
  brokenPropIds: Set<string>;
  portalOpen: boolean;
  lootSeq: number;
  lastTick: number;
  pvp?: ServerPvpState;
}

const PLAYER_COLORS = ['#F59E0B', '#38BDF8', '#10B981', '#C084FC'];
const RECONNECT_GRACE_MS = 120_000;
const HOST_FAILOVER_MS = 15_000;
const PVP_FORFEIT_MS = 12_000;

const DEFAULT_BLESSINGS: Record<BlessingId, number> = {
  vitality: 0,
  might: 0,
  alacrity: 0,
  fortune: 0,
  flask: 0,
};

function generateSessionToken(): string {
  const bytes = new Uint8Array(12);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function collidesWall(floor: DungeonFloor, wx: number, wy: number, radius: number): boolean {
  const ts = floor.tileSize;
  const minTx = Math.floor((wx - radius) / ts);
  const maxTx = Math.floor((wx + radius) / ts);
  const minTy = Math.floor((wy - radius) / ts);
  const maxTy = Math.floor((wy + radius) / ts);
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (!isWalkableTile(floor, tx, ty)) {
        const rx = tx * ts;
        const ry = ty * ts;
        const cx = Math.max(rx, Math.min(wx, rx + ts));
        const cy = Math.max(ry, Math.min(wy, ry + ts));
        if ((wx - cx) ** 2 + (wy - cy) ** 2 < radius * radius) return true;
      }
    }
  }
  return false;
}

function nudgeEnemy(floor: DungeonFloor, e: ServerEnemy, dx: number, dy: number) {
  if (!collidesWall(floor, e.x + dx, e.y, e.radius)) e.x += dx;
  if (!collidesWall(floor, e.x, e.y + dy, e.radius)) e.y += dy;
}

function serializeEnemy(e: ServerEnemy): CoopEnemySync {
  return {
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
  };
}

function createInitialHeroState(
  archetypeId: CoopHeroBuildState['archetype'],
  x: number,
  y: number,
  buildState?: CoopHeroBuildState
): CoopAuthoritativeHeroState {
  const arch = ARCHETYPES[archetypeId] ?? ARCHETYPES.crusader;
  const blessings = buildState?.blessings ? { ...DEFAULT_BLESSINGS, ...buildState.blessings } : { ...DEFAULT_BLESSINGS };
  const unlockedNodeIds = buildState?.unlockedNodeIds?.length
    ? [...buildState.unlockedNodeIds]
    : ['origin', arch.startingNodeId];
  const unlockedSkills = buildState?.unlockedSkills?.length
    ? [...buildState.unlockedSkills]
    : [arch.startingSkills[0]];
  const equippedSlots = buildState?.equippedSlots
    ? { ...buildState.equippedSlots }
    : { Q: arch.startingSkills[0], E: null, R: null };
  const equippedWeapon = buildState?.equippedWeapon
    ? structuredClone(buildState.equippedWeapon)
    : structuredClone(arch.startingWeapon);
  const equippedRelic = buildState?.equippedRelic ? structuredClone(buildState.equippedRelic) : null;
  const stats = computePlayerStats(arch.id, 1, unlockedNodeIds, equippedWeapon, equippedRelic, {
    blessings,
  });
  const bonusFlasks = (blessings.flask >= 2 ? 1 : 0) + (blessings.flask >= 4 ? 1 : 0);
  const maxFlaskCharges = 3 + bonusFlasks;

  return {
    archetype: arch.id,
    classTitle: computeHybridClassTitle(arch.id, unlockedNodeIds),
    x,
    y,
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    shield: 0,
    level: 1,
    xp: 0,
    xpToNext: 80,
    skillPoints: 1,
    gold: 0,
    souls: 0,
    kills: 0,
    flaskCharges: maxFlaskCharges,
    maxFlaskCharges,
    alive: true,
    unlockedNodeIds,
    unlockedSkills,
    equippedSlots,
    equippedWeapon,
    equippedRelic,
    inventory: [],
    blessings,
  };
}

export class CoopRoomManager {
  private rooms = new Map<string, ServerRoom>();
  private peerMeta = new Map<
    string,
    { playerId: string; roomCode: string | null; clientVersion: string }
  >();
  private idSeq = 1;
  private sendFn: (peerId: string, msg: CoopServerMessage) => void;
  private hooks: CoopRoomManagerHooks;

  constructor(
    sendFn: (peerId: string, msg: CoopServerMessage) => void,
    hooks: CoopRoomManagerHooks = {}
  ) {
    this.sendFn = sendFn;
    this.hooks = hooks;
  }

  registerPeer(peerId: string): string {
    const playerId = `p_${this.idSeq++}`;
    this.peerMeta.set(peerId, { playerId, roomCode: null, clientVersion: APP_VERSION });
    return playerId;
  }

  disconnectPeer(peerId: string) {
    const meta = this.peerMeta.get(peerId);
    if (!meta) return;
    if (meta.roomCode) {
      const room = this.rooms.get(meta.roomCode);
      const rec = room?.players.get(meta.playerId);
      if (room && rec) {
        rec.peerId = null;
        rec.sync.connected = false;
        rec.disconnectedAt = Date.now();
        if (room.mode === 'pvp') {
          this.broadcastRoom(room, {
            type: 'pvp:state',
            state: this.serializePvpState(room),
          });
        } else {
          this.broadcastRoom(room, {
            type: 'world:tick',
            players: Array.from(room.players.values()).map((r) => r.sync),
            enemies: room.enemies.map(serializeEnemy),
          });
        }
      }
      meta.roomCode = null;
    }
    this.peerMeta.delete(peerId);
  }

  getRoomSnapshot(roomCode: string): ServerRoom | undefined {
    return this.rooms.get(roomCode);
  }

  listPublicRooms(): CoopRoomSummary[] {
    const list: CoopRoomSummary[] = [];
    for (const room of this.rooms.values()) {
      if (room.mode !== 'coop') continue;
      const connectedCount = Array.from(room.players.values()).filter(
        (r) => r.sync.connected !== false
      ).length;
      if (!room.isPublic || connectedCount === 0) continue;
      const host =
        Array.from(room.players.values()).find((r) => r.sync.isHost)?.sync ??
        Array.from(room.players.values())[0]?.sync;
      list.push({
        code: room.code,
        hostName: host?.name ?? 'Aventurero',
        playerCount: room.players.size,
        maxPlayers: 4,
        floorNumber: room.floorNumber,
        runSeedLabel: room.runSeedLabel,
      });
    }
    return list;
  }

  listPublicPvpRooms(): PvpRoomSummary[] {
    const list: PvpRoomSummary[] = [];
    for (const room of this.rooms.values()) {
      if (room.mode !== 'pvp' || !room.pvp) continue;
      const connectedCount = Array.from(room.players.values()).filter(
        (r) => r.sync.connected !== false
      ).length;
      if (!room.isPublic || connectedCount === 0) continue;
      const hostRec =
        Array.from(room.players.values()).find((r) => r.sync.isHost) ??
        Array.from(room.players.values())[0];
      const hostExtra = hostRec ? room.pvp.fighters.get(hostRec.sync.id) : undefined;
      list.push({
        code: room.code,
        hostName: hostRec?.sync.name ?? 'Duelista',
        hostElo: hostExtra?.elo ?? PVP_BASE_ELO,
        hostTierName: hostExtra?.tierName ?? getPvpTierInfo(PVP_BASE_ELO).name,
        playerCount: room.players.size,
        maxPlayers: 2,
        phase: room.pvp.phase,
        isRanked: true,
      });
    }
    return list;
  }

  listAllAdminRooms(): Array<{
    code: string;
    mode: 'coop' | 'pvp';
    isPublic: boolean;
    playerCount: number;
    maxPlayers: number;
    floorNumber: number;
    phase?: PvpMatchPhase;
    players: Array<{ id: string; name: string; connected: boolean }>;
  }> {
    const out: Array<{
      code: string;
      mode: 'coop' | 'pvp';
      isPublic: boolean;
      playerCount: number;
      maxPlayers: number;
      floorNumber: number;
      phase?: PvpMatchPhase;
      players: Array<{ id: string; name: string; connected: boolean }>;
    }> = [];
    for (const room of this.rooms.values()) {
      out.push({
        code: room.code,
        mode: room.mode,
        isPublic: room.isPublic,
        playerCount: room.players.size,
        maxPlayers: room.mode === 'pvp' ? 2 : 4,
        floorNumber: room.floorNumber,
        phase: room.pvp?.phase,
        players: Array.from(room.players.values()).map((r) => ({
          id: r.sync.id,
          name: r.sync.name,
          connected: r.sync.connected !== false,
        })),
      });
    }
    return out;
  }

  closeRoomByCode(code: string): boolean {
    const cleaned = String(code || '').trim().toUpperCase();
    const room = this.rooms.get(cleaned);
    if (!room) return false;
    for (const rec of room.players.values()) {
      if (rec.peerId) {
        this.sendFn(rec.peerId, {
          type: 'room:error',
          code: 'ROOM_NOT_FOUND',
          message: 'La sala fue cerrada desde el panel de administración del servidor.',
        });
        const meta = this.peerMeta.get(rec.peerId);
        if (meta && meta.roomCode === cleaned) {
          meta.roomCode = null;
        }
      }
    }
    this.rooms.delete(cleaned);
    return true;
  }

  tickAllRooms() {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      const dt = Math.min(0.1, (now - room.lastTick) / 1000);
      room.lastTick = now;

      if (room.mode === 'pvp' && room.pvp) {
        // Handle PvP disconnect timeouts / forfeit
        for (const [pid, rec] of [...room.players.entries()]) {
          if (rec.sync.connected === false && rec.disconnectedAt !== null) {
            const elapsed = now - rec.disconnectedAt;
            const activeBattle =
              room.pvp.phase === 'countdown' ||
              room.pvp.phase === 'fighting' ||
              room.pvp.phase === 'round_end';
            if (activeBattle && elapsed >= PVP_FORFEIT_MS && !room.pvp.matchCommitted) {
              const opponent = Array.from(room.players.values()).find(
                (r) => r.sync.id !== pid && r.sync.connected !== false
              );
              if (opponent) {
                this.finishPvpMatch(room, opponent.sync.id);
              }
            }
            if (elapsed >= RECONNECT_GRACE_MS) {
              this.removePlayerFromRoom(room, pid);
            }
          }
        }
        if (!this.rooms.has(room.code) || room.players.size === 0) continue;

        this.stepPlayerTimers(room, dt);
        this.stepPvpRoom(room, dt);
        this.broadcastRoom(room, {
          type: 'pvp:state',
          state: this.serializePvpState(room),
        });
        continue;
      }

      // Prune expired disconnected players and handle temporary host failover
      let hostDisconnectedTooLong = false;
      for (const [pid, rec] of [...room.players.entries()]) {
        if (rec.sync.connected === false && rec.disconnectedAt !== null) {
          const elapsed = now - rec.disconnectedAt;
          if (elapsed >= RECONNECT_GRACE_MS) {
            this.removePlayerFromRoom(room, pid);
            continue;
          }
          if (rec.sync.isHost && elapsed >= HOST_FAILOVER_MS) {
            hostDisconnectedTooLong = true;
          }
        }
      }

      if (!this.rooms.has(room.code) || room.players.size === 0) continue;

      if (hostDisconnectedTooLong) {
        const connectedReplacement = Array.from(room.players.values()).find(
          (r) => !r.sync.isHost && r.sync.connected !== false
        );
        if (connectedReplacement) {
          for (const r of room.players.values()) r.sync.isHost = false;
          connectedReplacement.sync.isHost = true;
        }
      }

      this.stepPlayerTimers(room, dt);
      this.stepRoom(room, dt);
      this.broadcastRoom(room, {
        type: 'world:tick',
        players: Array.from(room.players.values()).map((r) => r.sync),
        enemies: room.enemies.map(serializeEnemy),
      });
    }
  }

  handleMessage(peerId: string, msg: CoopClientMessage) {
    const meta = this.peerMeta.get(peerId);
    if (!meta) return;

    if (msg.type === 'net:ping') {
      this.sendFn(peerId, {
        type: 'net:pong',
        clientTs: msg.clientTs,
        serverTs: Date.now(),
      });
      return;
    }

    if (msg.type === 'client:hello') {
      meta.clientVersion = msg.version || APP_VERSION;
      const compatibility = compareVersions(meta.clientVersion, APP_VERSION);
      this.sendFn(peerId, {
        type: 'server:hello',
        serverVersion: APP_VERSION,
        compatibility,
      });
      return;
    }

    if (msg.type === 'room:list') {
      this.sendFn(peerId, { type: 'room:list', rooms: this.listPublicRooms() });
      return;
    }

    if (msg.type === 'pvp:list') {
      this.sendFn(peerId, { type: 'pvp:list', rooms: this.listPublicPvpRooms() });
      return;
    }

    if (msg.type === 'pvp:create') {
      const version = msg.version || meta.clientVersion || APP_VERSION;
      const compatibility = compareVersions(version, APP_VERSION);
      if (!compatibility.compatible) {
        this.sendFn(peerId, {
          type: 'room:error',
          code: 'VERSION_MISMATCH',
          message: compatibility.message || 'Versión incompatible con el servidor.',
        });
        return;
      }

      this.leaveCurrentRoom(peerId);
      const code = this.generateRoomCode();
      const floor = generatePvpArenaFloor();
      const arch = ARCHETYPES[msg.archetype] ? msg.archetype : 'crusader';
      const loadout = PVP_LOADOUTS[arch];
      const stats = computePvpHeroStats(arch);
      const weapon = getPvpStartingWeapon(arch);

      const hero: CoopAuthoritativeHeroState = {
        archetype: arch,
        classTitle: loadout.classTitle,
        x: PVP_SPAWN_P1.x,
        y: PVP_SPAWN_P1.y,
        hp: stats.maxHp,
        maxHp: stats.maxHp,
        shield: 0,
        level: 5,
        xp: 0,
        xpToNext: 999,
        skillPoints: 0,
        gold: 0,
        souls: 0,
        kills: 0,
        flaskCharges: 2,
        maxFlaskCharges: 2,
        alive: true,
        unlockedNodeIds: [],
        unlockedSkills: [...loadout.skills],
        equippedSlots: { ...loadout.slots },
        equippedWeapon: weapon,
        equippedRelic: null,
        inventory: [],
        blessings: { ...DEFAULT_BLESSINGS },
      };

      const player: CoopPlayerSync = {
        id: meta.playerId,
        name: (msg.playerName || 'Duelista').slice(0, 18),
        archetype: arch,
        classTitle: loadout.classTitle,
        level: 5,
        x: PVP_SPAWN_P1.x,
        y: PVP_SPAWN_P1.y,
        facing: PVP_SPAWN_P1.facing,
        hp: stats.maxHp,
        maxHp: stats.maxHp,
        shield: 0,
        weaponKind: weapon.weaponKind ?? 'greatsword',
        alive: true,
        isHost: true,
        color: '#F59E0B',
        connected: true,
        cosmetics: msg.cosmetics,
      };

      const sessionToken = generateSessionToken();
      const rec: ServerPlayerRecord = {
        sync: player,
        sessionToken,
        peerId,
        disconnectedAt: null,
        hero,
        shieldTimer: 0,
        hitWindowStart: Date.now(),
        hitCountInWindow: 0,
        lastSkillCastAt: {},
      };

      const cleanKey = String(msg.playerKey || meta.playerId).slice(0, 48);
      const baseTier = getPvpTierInfo(PVP_BASE_ELO);
      const pvpState: ServerPvpState = {
        phase: 'waiting',
        roundNumber: 1,
        phaseTimer: 0,
        ringRadius: PVP_RING_MAX_RADIUS,
        orbs: [],
        orbSpawnTimer: 10,
        winnerId: null,
        winnerName: null,
        matchCommitted: false,
        fighters: new Map([
          [
            meta.playerId,
            {
              playerKey: cleanKey,
              ready: false,
              roundsWon: 0,
              elo: PVP_BASE_ELO,
              tierName: baseTier.name,
              slotIndex: 0,
              ringTickAccum: 0,
            },
          ],
        ]),
      };

      const room: ServerRoom = {
        code,
        mode: 'pvp',
        isPublic: msg.isPublic,
        runSeed: 777,
        runSeedLabel: 'ARENA-PVP',
        floorNumber: 1,
        floorSeed: 777,
        floor,
        players: new Map([[meta.playerId, rec]]),
        enemies: [],
        groundLoot: [],
        interactedPropIds: new Set(),
        brokenPropIds: new Set(),
        portalOpen: false,
        lootSeq: 1,
        lastTick: Date.now(),
        pvp: pvpState,
      };
      this.rooms.set(code, room);
      meta.roomCode = code;

      this.hydratePvpFighterStanding(room, meta.playerId, cleanKey, player.name);

      this.sendFn(peerId, {
        type: 'pvp:joined',
        roomCode: code,
        playerId: meta.playerId,
        sessionToken,
        serverVersion: APP_VERSION,
        compatibility,
        state: this.serializePvpState(room),
      });
      return;
    }

    if (msg.type === 'pvp:join') {
      const version = msg.version || meta.clientVersion || APP_VERSION;
      const compatibility = compareVersions(version, APP_VERSION);
      if (!compatibility.compatible) {
        this.sendFn(peerId, {
          type: 'room:error',
          code: 'VERSION_MISMATCH',
          message: compatibility.message || 'Versión incompatible con el servidor.',
        });
        return;
      }

      const cleanCode = (msg.code || '').trim().toUpperCase();
      const room = this.rooms.get(cleanCode);
      if (!room || room.mode !== 'pvp' || !room.pvp) {
        this.sendFn(peerId, {
          type: 'room:error',
          code: 'ROOM_NOT_FOUND',
          message: `No existe ninguna arena PvP con el código ${cleanCode}.`,
        });
        return;
      }
      if (room.players.size >= 2) {
        this.sendFn(peerId, {
          type: 'room:error',
          code: 'ROOM_FULL',
          message: 'La arena ya tiene 2 duelistas.',
        });
        return;
      }

      this.leaveCurrentRoom(peerId);

      const usedSlots = new Set(Array.from(room.pvp.fighters.values()).map((f) => f.slotIndex));
      const slotIndex: 0 | 1 = usedSlots.has(0) ? 1 : 0;
      const spawn = slotIndex === 0 ? PVP_SPAWN_P1 : PVP_SPAWN_P2;
      const color = slotIndex === 0 ? '#F59E0B' : '#38BDF8';
      const arch = ARCHETYPES[msg.archetype] ? msg.archetype : 'stalker';
      const loadout = PVP_LOADOUTS[arch];
      const stats = computePvpHeroStats(arch);
      const weapon = getPvpStartingWeapon(arch);

      const hero: CoopAuthoritativeHeroState = {
        archetype: arch,
        classTitle: loadout.classTitle,
        x: spawn.x,
        y: spawn.y,
        hp: stats.maxHp,
        maxHp: stats.maxHp,
        shield: 0,
        level: 5,
        xp: 0,
        xpToNext: 999,
        skillPoints: 0,
        gold: 0,
        souls: 0,
        kills: 0,
        flaskCharges: 2,
        maxFlaskCharges: 2,
        alive: true,
        unlockedNodeIds: [],
        unlockedSkills: [...loadout.skills],
        equippedSlots: { ...loadout.slots },
        equippedWeapon: weapon,
        equippedRelic: null,
        inventory: [],
        blessings: { ...DEFAULT_BLESSINGS },
      };

      const player: CoopPlayerSync = {
        id: meta.playerId,
        name: (msg.playerName || 'Retador').slice(0, 18),
        archetype: arch,
        classTitle: loadout.classTitle,
        level: 5,
        x: spawn.x,
        y: spawn.y,
        facing: spawn.facing,
        hp: stats.maxHp,
        maxHp: stats.maxHp,
        shield: 0,
        weaponKind: weapon.weaponKind ?? 'greatsword',
        alive: true,
        isHost: false,
        color,
        connected: true,
        cosmetics: msg.cosmetics,
      };

      const sessionToken = generateSessionToken();
      room.players.set(meta.playerId, {
        sync: player,
        sessionToken,
        peerId,
        disconnectedAt: null,
        hero,
        shieldTimer: 0,
        hitWindowStart: Date.now(),
        hitCountInWindow: 0,
        lastSkillCastAt: {},
      });

      const cleanKey = String(msg.playerKey || meta.playerId).slice(0, 48);
      const baseTier = getPvpTierInfo(PVP_BASE_ELO);
      room.pvp.fighters.set(meta.playerId, {
        playerKey: cleanKey,
        ready: false,
        roundsWon: 0,
        elo: PVP_BASE_ELO,
        tierName: baseTier.name,
        slotIndex,
        ringTickAccum: 0,
      });
      meta.roomCode = room.code;

      this.hydratePvpFighterStanding(room, meta.playerId, cleanKey, player.name);

      this.sendFn(peerId, {
        type: 'pvp:joined',
        roomCode: room.code,
        playerId: meta.playerId,
        sessionToken,
        serverVersion: APP_VERSION,
        compatibility,
        state: this.serializePvpState(room),
      });

      this.broadcastRoom(room, {
        type: 'pvp:state',
        state: this.serializePvpState(room),
      });
      return;
    }

    if (msg.type === 'room:create') {
      const version = msg.version || meta.clientVersion || APP_VERSION;
      const compatibility = compareVersions(version, APP_VERSION);
      if (!compatibility.compatible) {
        this.sendFn(peerId, {
          type: 'room:error',
          code: 'VERSION_MISMATCH',
          message: compatibility.message || 'Versión incompatible con el servidor.',
        });
        return;
      }

      this.leaveCurrentRoom(peerId);
      const code = this.generateRoomCode();
      const generated = generateRandomRunSeed();
      const runSeed = typeof msg.runSeed === 'number' && msg.runSeed > 0 ? msg.runSeed >>> 0 : generated.numeric;
      const runSeedLabel = (msg.runSeedLabel || '').trim().toUpperCase().slice(0, 20) || generated.label;
      const floorSeed = deriveFloorSeed(runSeed, 1);
      const floor = generateDungeonFloor(1, floorSeed);
      const enemies = this.spawnEnemiesForFloor(floor, floorSeed, 1);

      const hero = createInitialHeroState(msg.archetype, floor.spawnX, floor.spawnY, msg.buildState);
      const player: CoopPlayerSync = {
        id: meta.playerId,
        name: (msg.playerName || 'Héroe').slice(0, 18),
        archetype: hero.archetype,
        classTitle: msg.classTitle || hero.classTitle,
        level: 1,
        x: floor.spawnX,
        y: floor.spawnY,
        facing: 0,
        hp: hero.maxHp,
        maxHp: hero.maxHp,
        shield: 0,
        weaponKind: msg.weaponKind,
        alive: true,
        isHost: true,
        color: PLAYER_COLORS[0],
        connected: true,
      };

      const sessionToken = generateSessionToken();
      const rec: ServerPlayerRecord = {
        sync: player,
        sessionToken,
        peerId,
        disconnectedAt: null,
        hero,
        shieldTimer: 0,
        hitWindowStart: Date.now(),
        hitCountInWindow: 0,
        lastSkillCastAt: {},
      };

      const room: ServerRoom = {
        code,
        mode: 'coop',
        isPublic: msg.isPublic,
        runSeed,
        runSeedLabel,
        floorNumber: 1,
        floorSeed,
        floor,
        players: new Map([[meta.playerId, rec]]),
        enemies,
        groundLoot: [],
        interactedPropIds: new Set(),
        brokenPropIds: new Set(),
        portalOpen: false,
        lootSeq: 1,
        lastTick: Date.now(),
      };
      this.rooms.set(code, room);
      meta.roomCode = code;

      this.sendFn(peerId, {
        type: 'room:joined',
        roomCode: code,
        playerId: meta.playerId,
        sessionToken,
        runSeed,
        runSeedLabel,
        floorNumber: 1,
        floorSeed,
        serverVersion: APP_VERSION,
        compatibility,
        players: [player],
        enemies: room.enemies.map(serializeEnemy),
        groundLoot: [],
        interactedPropIds: [],
        brokenPropIds: [],
        portalOpen: false,
      });
      return;
    }

    if (msg.type === 'room:join') {
      const version = msg.version || meta.clientVersion || APP_VERSION;
      const compatibility = compareVersions(version, APP_VERSION);
      if (!compatibility.compatible) {
        this.sendFn(peerId, {
          type: 'room:error',
          code: 'VERSION_MISMATCH',
          message: compatibility.message || 'Versión incompatible con el servidor.',
        });
        return;
      }

      const cleanCode = (msg.code || '').trim().toUpperCase();
      const room = this.rooms.get(cleanCode);
      if (!room || room.mode !== 'coop') {
        this.sendFn(peerId, {
          type: 'room:error',
          code: 'ROOM_NOT_FOUND',
          message: `No existe ninguna sala cooperativa con el código ${cleanCode}.`,
        });
        return;
      }
      if (room.players.size >= 4) {
        this.sendFn(peerId, {
          type: 'room:error',
          code: 'ROOM_FULL',
          message: 'La sala ya está completa (4/4 jugadores).',
        });
        return;
      }

      this.leaveCurrentRoom(peerId);

      const usedColors = new Set(Array.from(room.players.values()).map((r) => r.sync.color));
      const color =
        PLAYER_COLORS.find((c) => !usedColors.has(c)) ??
        PLAYER_COLORS[room.players.size % PLAYER_COLORS.length];

      const spawnX = room.floor.spawnX + (room.players.size * 22 - 22);
      const spawnY = room.floor.spawnY + 18;
      const hero = createInitialHeroState(msg.archetype, spawnX, spawnY, msg.buildState);
      const player: CoopPlayerSync = {
        id: meta.playerId,
        name: (msg.playerName || 'Aliado').slice(0, 18),
        archetype: hero.archetype,
        classTitle: msg.classTitle || hero.classTitle,
        level: 1,
        x: spawnX,
        y: spawnY,
        facing: 0,
        hp: hero.maxHp,
        maxHp: hero.maxHp,
        shield: 0,
        weaponKind: msg.weaponKind,
        alive: true,
        isHost: false,
        color,
        connected: true,
      };

      const sessionToken = generateSessionToken();
      room.players.set(meta.playerId, {
        sync: player,
        sessionToken,
        peerId,
        disconnectedAt: null,
        hero,
        shieldTimer: 0,
        hitWindowStart: Date.now(),
        hitCountInWindow: 0,
        lastSkillCastAt: {},
      });
      meta.roomCode = room.code;

      this.sendFn(peerId, {
        type: 'room:joined',
        roomCode: room.code,
        playerId: meta.playerId,
        sessionToken,
        runSeed: room.runSeed,
        runSeedLabel: room.runSeedLabel,
        floorNumber: room.floorNumber,
        floorSeed: room.floorSeed,
        serverVersion: APP_VERSION,
        compatibility,
        players: Array.from(room.players.values()).map((r) => r.sync),
        enemies: room.enemies.map(serializeEnemy),
        groundLoot: room.groundLoot.map((l) => structuredClone(l)),
        interactedPropIds: Array.from(room.interactedPropIds),
        brokenPropIds: Array.from(room.brokenPropIds),
        portalOpen: room.portalOpen,
      });

      this.broadcastRoom(room, { type: 'player:joined', player }, meta.playerId);
      return;
    }

    if (msg.type === 'room:reconnect') {
      const version = msg.version || meta.clientVersion || APP_VERSION;
      const compatibility = compareVersions(version, APP_VERSION);
      if (!compatibility.compatible) {
        this.sendFn(peerId, {
          type: 'room:error',
          code: 'VERSION_MISMATCH',
          message: compatibility.message || 'Versión incompatible con el servidor.',
        });
        return;
      }

      const cleanCode = (msg.roomCode || '').trim().toUpperCase();
      const room = this.rooms.get(cleanCode);
      if (!room) {
        this.sendFn(peerId, {
          type: 'room:error',
          code: 'SESSION_EXPIRED',
          message: `La sala #${cleanCode} ya no está activa.`,
        });
        return;
      }

      let matched: ServerPlayerRecord | null = null;
      for (const rec of room.players.values()) {
        if (rec.sessionToken === msg.sessionToken) {
          matched = rec;
          break;
        }
      }

      if (!matched) {
        this.sendFn(peerId, {
          type: 'room:error',
          code: 'SESSION_EXPIRED',
          message: 'Tu token de sesión expiró tras el tiempo de espera.',
        });
        return;
      }

      // Rebind peer metadata to the recovered hero identity
      meta.playerId = matched.sync.id;
      meta.roomCode = room.code;
      matched.peerId = peerId;
      matched.sync.connected = true;
      matched.disconnectedAt = null;
      matched.hero.x = matched.sync.x;
      matched.hero.y = matched.sync.y;

      this.sendFn(peerId, {
        type: 'room:reconnected',
        roomCode: room.code,
        playerId: matched.sync.id,
        sessionToken: matched.sessionToken,
        runSeed: room.runSeed,
        runSeedLabel: room.runSeedLabel,
        floorNumber: room.floorNumber,
        floorSeed: room.floorSeed,
        serverVersion: APP_VERSION,
        compatibility,
        heroState: structuredClone(matched.hero),
        players: Array.from(room.players.values()).map((r) => r.sync),
        enemies: room.enemies.map(serializeEnemy),
        groundLoot: room.groundLoot.map((l) => structuredClone(l)),
        interactedPropIds: Array.from(room.interactedPropIds),
        brokenPropIds: Array.from(room.brokenPropIds),
        portalOpen: room.portalOpen,
        mode: room.mode,
        pvpState: room.mode === 'pvp' ? this.serializePvpState(room) : undefined,
      });

      if (room.mode === 'pvp') {
        this.broadcastRoom(
          room,
          {
            type: 'pvp:state',
            state: this.serializePvpState(room),
          },
          matched.sync.id
        );
      } else {
        this.broadcastRoom(
          room,
          {
            type: 'world:tick',
            players: Array.from(room.players.values()).map((r) => r.sync),
            enemies: room.enemies.map(serializeEnemy),
          },
          matched.sync.id
        );
      }
      return;
    }

    if (msg.type === 'room:leave') {
      this.leaveCurrentRoom(peerId);
      return;
    }

    if (!meta.roomCode) return;
    const room = this.rooms.get(meta.roomCode);
    if (!room) return;
    const rec = room.players.get(meta.playerId);
    if (!rec) return;
    const actor = rec.sync;

    if (msg.type === 'player:state') {
      // Hybrid authority: client drives smooth movement/facing/weapon visuals; server preserves authoritative HP/shield/level/alive
      const maxX = room.floor.width * room.floor.tileSize;
      const maxY = room.floor.height * room.floor.tileSize;
      const clampedX = Math.max(0, Math.min(maxX, msg.x));
      const clampedY = Math.max(0, Math.min(maxY, msg.y));
      actor.x = clampedX;
      actor.y = clampedY;
      actor.facing = msg.facing;
      if (room.mode === 'coop') {
        actor.weaponKind = msg.weaponKind;
        if (msg.classTitle) {
          actor.classTitle = msg.classTitle;
          rec.hero.classTitle = msg.classTitle;
        }
      }
      rec.hero.x = clampedX;
      rec.hero.y = clampedY;
      if (msg.cosmetics) {
        actor.cosmetics = msg.cosmetics;
      }
      return;
    }

    if (room.mode === 'pvp' && room.pvp) {
      if (msg.type === 'pvp:ready') {
        if (room.pvp.phase !== 'waiting') return;
        const extra = room.pvp.fighters.get(meta.playerId);
        if (!extra) return;
        extra.ready = typeof msg.ready === 'boolean' ? msg.ready : !extra.ready;
        const fighters = Array.from(room.pvp.fighters.values());
        const connectedCount = Array.from(room.players.values()).filter(
          (r) => r.sync.connected !== false
        ).length;
        if (
          room.players.size === 2 &&
          connectedCount === 2 &&
          fighters.length === 2 &&
          fighters.every((f) => f.ready)
        ) {
          this.startPvpRound(room, 1);
        }
        this.broadcastRoom(room, { type: 'pvp:state', state: this.serializePvpState(room) });
        return;
      }

      if (msg.type === 'pvp:rematch') {
        if (room.pvp.phase !== 'match_end' || room.players.size < 2) return;
        room.pvp.winnerId = null;
        room.pvp.winnerName = null;
        room.pvp.matchCommitted = false;
        for (const extra of room.pvp.fighters.values()) {
          extra.roundsWon = 0;
          extra.ready = true;
          extra.ringTickAccum = 0;
        }
        this.startPvpRound(room, 1);
        this.broadcastRoom(room, { type: 'pvp:state', state: this.serializePvpState(room) });
        return;
      }

      if (msg.type === 'pvp:flask') {
        if (room.pvp.phase !== 'fighting' || !rec.hero.alive) return;
        if (rec.hero.flaskCharges <= 0 || rec.hero.hp >= rec.hero.maxHp) return;
        const stats = computePvpHeroStats(rec.hero.archetype);
        rec.hero.flaskCharges -= 1;
        const heal = Math.round(rec.hero.maxHp * stats.flaskHealPct);
        rec.hero.hp = Math.min(rec.hero.maxHp, rec.hero.hp + heal);
        actor.hp = rec.hero.hp;
        this.sendHeroStats(rec);
        this.broadcastRoom(room, { type: 'pvp:state', state: this.serializePvpState(room) });
        return;
      }

      if (msg.type === 'pvp:skill') {
        if (room.pvp.phase !== 'fighting' || !rec.hero.alive) return;
        const skill = ACTIVE_SKILLS[msg.skillId];
        if (!skill) return;
        const stats = computePvpHeroStats(rec.hero.archetype);
        const now = Date.now();
        const minCdMs = Math.max(500, skill.cooldown * (1 - stats.cooldownReduction) * 1000 * 0.85);
        const prevCast = rec.lastSkillCastAt[msg.skillId] ?? 0;
        if (now - prevCast < minCdMs) return;
        rec.lastSkillCastAt[msg.skillId] = now;

        if (msg.skillId === 'aegis') {
          const shieldAmount = Math.round(rec.hero.maxHp * (skill.shieldHpRatio ?? 0.35));
          rec.hero.shield = Math.max(rec.hero.shield, shieldAmount);
          rec.shieldTimer = skill.shieldDuration ?? 5.0;
          actor.shield = rec.hero.shield;
          this.sendHeroStats(rec);
          this.broadcastRoom(room, { type: 'pvp:state', state: this.serializePvpState(room) });
        }
        return;
      }

      if (msg.type === 'pvp:orb_pickup') {
        if (room.pvp.phase !== 'fighting' || !rec.hero.alive) return;
        const idx = room.pvp.orbs.findIndex((o) => o.id === msg.orbId);
        if (idx === -1) return;
        const orb = room.pvp.orbs[idx];
        if (Math.hypot(actor.x - orb.x, actor.y - orb.y) > 90) return;
        room.pvp.orbs.splice(idx, 1);
        if (orb.kind === 'heal') {
          rec.hero.hp = Math.min(rec.hero.maxHp, rec.hero.hp + orb.amount);
          actor.hp = rec.hero.hp;
          this.sendHeroStats(rec);
        }
        this.broadcastRoom(room, { type: 'pvp:state', state: this.serializePvpState(room) });
        return;
      }

      if (msg.type === 'pvp:hit') {
        if (room.pvp.phase !== 'fighting' || !rec.hero.alive) return;
        if (msg.targetId === meta.playerId) return;
        const targetRec = room.players.get(msg.targetId);
        if (!targetRec || !targetRec.hero.alive) return;

        const now = Date.now();
        if (now - rec.hitWindowStart > 500) {
          rec.hitWindowStart = now;
          rec.hitCountInWindow = 0;
        }
        rec.hitCountInWindow++;
        if (rec.hitCountInWindow > 14) return;

        const dist = Math.hypot(targetRec.sync.x - actor.x, targetRec.sync.y - actor.y);
        const maxSkillRange =
          msg.skillId && msg.skillId !== 'basic' && msg.skillId !== 'dash_decoy' && ACTIVE_SKILLS[msg.skillId]
            ? ACTIVE_SKILLS[msg.skillId].maxRange
            : 580;
        if (dist > maxSkillRange + 160) return;

        const atkStats = computePvpHeroStats(rec.hero.archetype);
        let skillCapBase = Math.max(atkStats.baseDamage * 1.4, atkStats.arcanePower * 1.4);
        if (msg.skillId && msg.skillId !== 'basic' && msg.skillId !== 'dash_decoy') {
          const sk = ACTIVE_SKILLS[msg.skillId];
          if (sk) {
            skillCapBase = atkStats.baseDamage * sk.physicalScale + atkStats.arcanePower * sk.arcaneScale;
          }
        }
        const critFactor = msg.isCrit ? atkStats.critMultiplier : 1.0;
        const maxAllowedDamage = Math.max(6, Math.ceil(skillCapBase * critFactor * 1.25));
        const rawIncoming = Math.max(1, Math.min(Math.round(msg.damage || 1), maxAllowedDamage));

        const targetStats = computePvpHeroStats(targetRec.hero.archetype);
        const mitigation = targetStats.armor / (targetStats.armor + 45);
        const mitigated = Math.max(2, Math.round(rawIncoming * (1 - mitigation)));

        if (atkStats.lifesteal > 0) {
          const leech = Math.max(1, Math.round(mitigated * atkStats.lifesteal));
          rec.hero.hp = Math.min(rec.hero.maxHp, rec.hero.hp + leech);
          actor.hp = rec.hero.hp;
          this.sendHeroStats(rec);
        }

        if (msg.skillId === 'eclipse_nova') {
          rec.hero.hp = Math.min(rec.hero.maxHp, rec.hero.hp + 12);
          actor.hp = rec.hero.hp;
          this.sendHeroStats(rec);
        }

        const kx = Math.max(-45, Math.min(45, msg.knockX || 0));
        const ky = Math.max(-45, Math.min(45, msg.knockY || 0));
        this.applyPvpDamage(
          room,
          targetRec,
          meta.playerId,
          mitigated,
          Boolean(msg.isCrit),
          msg.color || '#EF4444',
          kx,
          ky
        );
        return;
      }
    }

    if (msg.type === 'player:build') {
      const b = msg.buildState;
      const prevMaxHp = rec.hero.maxHp;
      // Validate skill tree nodes within achievable skill points budget (1 start + level-1 + shrine headroom)
      const maxNodesAllowed = Math.max(4, rec.hero.level + 6);
      const validNodes = b.unlockedNodeIds.slice(0, maxNodesAllowed);

      rec.hero.archetype = b.archetype;
      rec.hero.unlockedNodeIds = validNodes;
      rec.hero.unlockedSkills = [...b.unlockedSkills];
      rec.hero.equippedSlots = { ...b.equippedSlots };
      rec.hero.equippedWeapon = structuredClone(b.equippedWeapon);
      rec.hero.equippedRelic = b.equippedRelic ? structuredClone(b.equippedRelic) : null;
      rec.hero.inventory = structuredClone(b.inventory.slice(0, 18));
      rec.hero.blessings = { ...DEFAULT_BLESSINGS, ...b.blessings };
      rec.hero.classTitle = computeHybridClassTitle(rec.hero.archetype, rec.hero.unlockedNodeIds);

      const stats = this.computeRecStats(rec);
      rec.hero.maxHp = stats.maxHp;
      const deltaHp = stats.maxHp - prevMaxHp;
      if (deltaHp > 0 && rec.hero.alive) {
        rec.hero.hp = Math.min(rec.hero.maxHp, rec.hero.hp + deltaHp);
      } else {
        rec.hero.hp = Math.min(rec.hero.maxHp, rec.hero.hp);
      }
      actor.archetype = rec.hero.archetype;
      actor.classTitle = rec.hero.classTitle;
      actor.maxHp = rec.hero.maxHp;
      actor.hp = rec.hero.hp;
      actor.weaponKind = rec.hero.equippedWeapon.weaponKind ?? actor.weaponKind;
      this.sendHeroStats(rec);
      return;
    }

    if (msg.type === 'player:action') {
      this.broadcastRoom(
        room,
        { type: 'player:action', playerId: meta.playerId, action: msg.action },
        meta.playerId
      );
      return;
    }

    if (msg.type === 'player:hurt') {
      if (!rec.hero.alive) return;
      const stats = this.computeRecStats(rec);
      const raw = Math.max(1, Math.min(350, Math.round(msg.rawDamage || 0)));
      const mitigation = stats.armor / (stats.armor + 45);
      let dmg = Math.max(2, Math.round(raw * (1 - mitigation)));

      if (rec.hero.shield > 0) {
        const absorbed = Math.min(rec.hero.shield, dmg);
        rec.hero.shield -= absorbed;
        dmg -= absorbed;
      }

      if (dmg > 0) {
        rec.hero.hp = Math.max(0, rec.hero.hp - dmg);
      }
      if (rec.hero.hp <= 0) {
        rec.hero.hp = 0;
        rec.hero.alive = false;
        rec.hero.shield = 0;
      }
      actor.hp = rec.hero.hp;
      actor.shield = rec.hero.shield;
      actor.alive = rec.hero.alive;
      this.sendHeroStats(rec);
      return;
    }

    if (msg.type === 'player:flask') {
      if (!rec.hero.alive || rec.hero.flaskCharges <= 0 || rec.hero.hp >= rec.hero.maxHp) return;
      const stats = this.computeRecStats(rec);
      rec.hero.flaskCharges--;
      const heal = Math.round(rec.hero.maxHp * stats.flaskHealPct);
      rec.hero.hp = Math.min(rec.hero.maxHp, rec.hero.hp + heal);
      actor.hp = rec.hero.hp;
      this.sendHeroStats(rec);
      return;
    }

    if (msg.type === 'player:skill') {
      if (!rec.hero.alive) return;
      const skill = ACTIVE_SKILLS[msg.skillId];
      if (!skill) return;
      const stats = this.computeRecStats(rec);
      const now = Date.now();
      const minCdMs = Math.max(500, skill.cooldown * (1 - stats.cooldownReduction) * 1000 * 0.85);
      const prevCast = rec.lastSkillCastAt[msg.skillId] ?? 0;
      if (now - prevCast < minCdMs) return;
      rec.lastSkillCastAt[msg.skillId] = now;

      if (msg.skillId === 'aegis') {
        const shieldAmount = Math.round(rec.hero.maxHp * (skill.shieldHpRatio ?? 0.35));
        rec.hero.shield = Math.max(rec.hero.shield, shieldAmount);
        rec.shieldTimer = skill.shieldDuration ?? 5.0;
        actor.shield = rec.hero.shield;
        this.sendHeroStats(rec);
      } else if (msg.skillId === 'eclipse_nova' && (msg.hitsCount ?? 0) > 0) {
        const cappedHits = Math.min(12, Math.max(0, Math.round(msg.hitsCount ?? 0)));
        const heal = cappedHits * 7;
        rec.hero.hp = Math.min(rec.hero.maxHp, rec.hero.hp + heal);
        actor.hp = rec.hero.hp;
        this.sendHeroStats(rec);
      }
      return;
    }

    if (msg.type === 'combat:hit') {
      if (!actor.alive) return;
      const idx = room.enemies.findIndex((e) => e.id === msg.enemyId);
      if (idx === -1) return;
      const enemy = room.enemies[idx];
      if (enemy.hp <= 0) return;

      // Rate-limit sanity check (max 16 hits per 500ms window to support multi-target AoE cleanly)
      const now = Date.now();
      if (now - rec.hitWindowStart > 500) {
        rec.hitWindowStart = now;
        rec.hitCountInWindow = 0;
      }
      rec.hitCountInWindow++;
      if (rec.hitCountInWindow > 18) return;

      // Range sanity check (generous lag tolerance for projectiles & dashes)
      const dist = Math.hypot(enemy.x - actor.x, enemy.y - actor.y);
      const maxSkillRange =
        msg.skillId && msg.skillId !== 'basic' && msg.skillId !== 'dash_decoy' && ACTIVE_SKILLS[msg.skillId]
          ? ACTIVE_SKILLS[msg.skillId].maxRange
          : 560;
      if (dist > maxSkillRange + enemy.radius + 140) return;

      // Authoritative damage cap derived from server-held hero stats + JSON skill multipliers
      const stats = this.computeRecStats(rec);
      let skillCapBase = Math.max(stats.baseDamage * 1.45, stats.arcanePower * 1.45);
      if (msg.skillId && msg.skillId !== 'basic' && msg.skillId !== 'dash_decoy') {
        const sk = ACTIVE_SKILLS[msg.skillId];
        if (sk) {
          skillCapBase = stats.baseDamage * sk.physicalScale + stats.arcanePower * sk.arcaneScale;
        }
      } else if (msg.skillId === 'dash_decoy') {
        skillCapBase = stats.baseDamage + stats.arcanePower;
      }
      const critFactor = msg.isCrit ? stats.critMultiplier : 1.0;
      const maxAllowedDamage = Math.max(8, Math.ceil(skillCapBase * critFactor * 1.35));
      const validDamage = Math.max(1, Math.min(Math.round(msg.damage || 1), maxAllowedDamage));

      enemy.hp = Math.max(0, enemy.hp - validDamage);
      if (msg.knockX || msg.knockY) {
        const kx = Math.max(-45, Math.min(45, msg.knockX));
        const ky = Math.max(-45, Math.min(45, msg.knockY));
        nudgeEnemy(room.floor, enemy, kx, ky);
      }
      if (msg.bleedDps && stats.bleedOnHit) {
        enemy.bleedTimer = 3.0;
        enemy.bleedDps = Math.max(enemy.bleedDps, Math.min(Math.round(stats.baseDamage * 0.45), msg.bleedDps));
      }
      if (msg.slow) {
        enemy.slowTimer = Math.max(enemy.slowTimer, 2.2);
      }

      if (stats.lifesteal > 0 && rec.hero.alive) {
        const leech = Math.max(1, Math.round(validDamage * stats.lifesteal));
        rec.hero.hp = Math.min(rec.hero.maxHp, rec.hero.hp + leech);
        actor.hp = rec.hero.hp;
      }

      this.broadcastRoom(room, {
        type: 'enemy:damaged',
        enemyId: enemy.id,
        hp: enemy.hp,
        damage: validDamage,
        isCrit: Boolean(msg.isCrit),
        color: msg.color,
        attackerId: meta.playerId,
      });

      if (enemy.hp <= 0) {
        room.enemies.splice(idx, 1);
        this.handleEnemyKilled(room, enemy, meta.playerId);
      } else if (stats.lifesteal > 0) {
        this.sendHeroStats(rec);
      }
      return;
    }

    if (msg.type === 'loot:pickup') {
      if (!rec.hero.alive) return;
      const lootIdx = room.groundLoot.findIndex((l) => l.id === msg.lootId);
      if (lootIdx === -1) return;
      const picked = room.groundLoot.splice(lootIdx, 1)[0];

      if (picked.kind === 'gold') {
        rec.hero.gold += picked.amount ?? 5;
      } else if (picked.kind === 'soul') {
        rec.hero.souls += picked.amount ?? 2;
      } else if (picked.kind === 'hp_orb') {
        const heal = picked.amount ?? Math.round(rec.hero.maxHp * 0.14);
        rec.hero.hp = Math.min(rec.hero.maxHp, rec.hero.hp + heal);
        actor.hp = rec.hero.hp;
      } else if (picked.kind === 'item' && picked.item) {
        rec.hero.inventory = [picked.item, ...rec.hero.inventory].slice(0, 18);
      }

      this.sendHeroStats(rec);
      this.broadcastRoom(room, {
        type: 'loot:collected',
        lootId: picked.id,
        collectorId: actor.id,
        collectorName: actor.name,
        kind: picked.kind,
        amount: picked.amount,
        item: picked.item,
      });
      return;
    }

    if (msg.type === 'prop:interact') {
      if (room.interactedPropIds.has(msg.propId)) return;
      const prop = room.floor.props.find((p) => p.id === msg.propId);
      if (!prop || (prop.kind !== 'chest' && prop.kind !== 'shrine')) return;
      room.interactedPropIds.add(msg.propId);
      this.broadcastRoom(room, {
        type: 'prop:updated',
        propId: prop.id,
        kind: prop.kind,
        actorName: actor.name,
        shrineVariant: prop.shrineVariant,
      });

      if (prop.kind === 'chest') {
        const rng = this.nextLootRng(room);
        const maxFortune = this.getMaxPartyFortune(room);
        const item = generateLootItem(
          room.floorNumber,
          maxFortune,
          undefined,
          rng,
          `srv_item_${room.floorNumber}_${room.lootSeq++}`
        );
        const spawned: GroundLoot[] = [
          {
            id: `srv_loot_${this.idSeq++}`,
            x: prop.x,
            y: prop.y + 18,
            vx: (rng() - 0.5) * 80,
            vy: 60,
            kind: 'item',
            item,
            bobPhase: rng() * 6,
          },
          {
            id: `srv_loot_${this.idSeq++}`,
            x: prop.x,
            y: prop.y,
            vx: (rng() - 0.5) * 120,
            vy: (rng() - 0.5) * 120,
            kind: 'gold',
            amount: 10 + room.floorNumber * 6,
            bobPhase: rng() * 6,
          },
          {
            id: `srv_loot_${this.idSeq++}`,
            x: prop.x,
            y: prop.y,
            vx: (rng() - 0.5) * 120,
            vy: (rng() - 0.5) * 120,
            kind: 'gold',
            amount: 10 + room.floorNumber * 6,
            bobPhase: rng() * 6,
          },
        ];
        room.groundLoot.push(...spawned);
        this.broadcastRoom(room, { type: 'loot:spawned', items: spawned });
      } else if (prop.kind === 'shrine') {
        for (const pRec of room.players.values()) {
          if (prop.shrineVariant === 'blood') {
            if (pRec.hero.alive) pRec.hero.hp = pRec.hero.maxHp;
            pRec.hero.flaskCharges = pRec.hero.maxFlaskCharges;
            pRec.sync.hp = pRec.hero.hp;
          } else if (prop.shrineVariant === 'arcane') {
            pRec.hero.skillPoints += 1;
          } else {
            pRec.hero.souls += 8 + room.floorNumber * 3;
            this.grantXpToPlayer(pRec, 45 * room.floorNumber);
          }
          this.sendHeroStats(pRec);
        }
      }
      return;
    }

    if (msg.type === 'prop:break') {
      if (room.brokenPropIds.has(msg.propId)) return;
      room.brokenPropIds.add(msg.propId);
      this.broadcastRoom(room, { type: 'prop:broken', propId: msg.propId });

      const prop = room.floor.props.find((p) => p.id === msg.propId);
      if (prop) {
        const rng = this.nextLootRng(room);
        if (rng() < 0.55) {
          const isOrb = rng() < 0.25;
          const drop: GroundLoot = {
            id: `srv_loot_${this.idSeq++}`,
            x: prop.x,
            y: prop.y,
            vx: (rng() - 0.5) * 60,
            vy: (rng() - 0.5) * 60,
            kind: isOrb ? 'hp_orb' : 'gold',
            amount: isOrb ? 22 + room.floorNumber * 4 : 5 + room.floorNumber * 3,
            bobPhase: 0,
          };
          room.groundLoot.push(drop);
          this.broadcastRoom(room, { type: 'loot:spawned', items: [drop] });
        }
      }
      return;
    }

    if (msg.type === 'player:revive') {
      if (!rec.hero.alive) return;
      const targetRec = room.players.get(msg.targetPlayerId);
      if (!targetRec || targetRec.hero.alive) return;
      targetRec.hero.alive = true;
      targetRec.hero.hp = Math.max(1, Math.round(targetRec.hero.maxHp * 0.5));
      targetRec.sync.alive = true;
      targetRec.sync.hp = targetRec.hero.hp;
      this.sendHeroStats(targetRec);
      this.broadcastRoom(room, {
        type: 'player:revived',
        targetPlayerId: targetRec.sync.id,
        reviverName: actor.name,
      });
      return;
    }

    if (msg.type === 'floor:descend') {
      if (!room.portalOpen) return;
      room.floorNumber += 1;
      room.floorSeed = deriveFloorSeed(room.runSeed, room.floorNumber);
      room.floor = generateDungeonFloor(room.floorNumber, room.floorSeed);
      room.enemies = this.spawnEnemiesForFloor(room.floor, room.floorSeed, room.players.size);
      room.groundLoot = [];
      room.interactedPropIds.clear();
      room.brokenPropIds.clear();
      room.portalOpen = false;

      let offset = 0;
      for (const pRec of room.players.values()) {
        const nx = room.floor.spawnX + (offset % 2 === 0 ? -18 : 18);
        const ny = room.floor.spawnY + (offset < 2 ? -14 : 14);
        pRec.sync.x = nx;
        pRec.sync.y = ny;
        pRec.hero.x = nx;
        pRec.hero.y = ny;
        pRec.hero.alive = true;
        pRec.hero.hp = Math.max(pRec.hero.hp, Math.round(pRec.hero.maxHp * 0.5));
        pRec.sync.alive = true;
        pRec.sync.hp = pRec.hero.hp;
        this.sendHeroStats(pRec);
        offset++;
      }

      this.broadcastRoom(room, {
        type: 'floor:changed',
        floorNumber: room.floorNumber,
        floorSeed: room.floorSeed,
        enemies: room.enemies.map(serializeEnemy),
        groundLoot: [],
        actorName: actor.name,
      });
      return;
    }

    if (msg.type === 'chat:send') {
      const clean = (msg.text || '').trim().slice(0, 120);
      if (!clean) return;
      this.broadcastRoom(room, {
        type: 'chat:message',
        message: {
          id: `msg_${this.idSeq++}`,
          senderName: actor.name,
          senderColor: actor.color,
          text: clean,
          ts: Date.now(),
        },
      });
    }
  }

  private computeRecStats(rec: ServerPlayerRecord) {
    return computePlayerStats(
      rec.hero.archetype,
      rec.hero.level,
      rec.hero.unlockedNodeIds,
      rec.hero.equippedWeapon,
      rec.hero.equippedRelic,
      { blessings: rec.hero.blessings }
    );
  }

  private getMaxPartyFortune(room: ServerRoom): number {
    let maxF = 0;
    for (const rec of room.players.values()) {
      maxF = Math.max(maxF, rec.hero.blessings.fortune ?? 0);
    }
    return maxF;
  }

  private nextLootRng(room: ServerRoom): () => number {
    room.lootSeq += 1;
    return createSeededRng(room.floorSeed ^ Math.imul(room.lootSeq, 0x9e3779b1));
  }

  private sendHeroStats(rec: ServerPlayerRecord) {
    if (!rec.peerId) return;
    this.sendFn(rec.peerId, {
      type: 'hero:stats',
      hp: rec.hero.hp,
      maxHp: rec.hero.maxHp,
      shield: rec.hero.shield,
      level: rec.hero.level,
      xp: rec.hero.xp,
      xpToNext: rec.hero.xpToNext,
      skillPoints: rec.hero.skillPoints,
      gold: rec.hero.gold,
      souls: rec.hero.souls,
      kills: rec.hero.kills,
      flaskCharges: rec.hero.flaskCharges,
      maxFlaskCharges: rec.hero.maxFlaskCharges,
      alive: rec.hero.alive,
    });
  }

  private grantXpToPlayer(rec: ServerPlayerRecord, amount: number) {
    rec.hero.xp += amount;
    while (rec.hero.xp >= rec.hero.xpToNext) {
      rec.hero.xp -= rec.hero.xpToNext;
      rec.hero.level += 1;
      rec.hero.skillPoints += 1;
      rec.hero.xpToNext = Math.round(rec.hero.xpToNext * 1.32 + 25);
      const stats = this.computeRecStats(rec);
      rec.hero.maxHp = stats.maxHp;
      if (rec.hero.alive) rec.hero.hp = stats.maxHp;
      rec.sync.level = rec.hero.level;
      rec.sync.maxHp = rec.hero.maxHp;
      rec.sync.hp = rec.hero.hp;
    }
  }

  private stepPlayerTimers(room: ServerRoom, dt: number) {
    for (const rec of room.players.values()) {
      if (rec.shieldTimer > 0) {
        rec.shieldTimer -= dt;
        if (rec.shieldTimer <= 0 && rec.hero.shield > 0) {
          rec.hero.shield = 0;
          rec.sync.shield = 0;
          this.sendHeroStats(rec);
        }
      }
    }
  }

  private removePlayerFromRoom(room: ServerRoom, playerId: string) {
    const rec = room.players.get(playerId);
    if (!rec) return;
    const wasHost = rec.sync.isHost;

    if (room.mode === 'pvp' && room.pvp) {
      const activeBattle =
        room.pvp.phase === 'countdown' ||
        room.pvp.phase === 'fighting' ||
        room.pvp.phase === 'round_end';
      if (activeBattle && !room.pvp.matchCommitted && room.players.size === 2) {
        const opponent = Array.from(room.players.values()).find((r) => r.sync.id !== playerId);
        if (opponent) {
          this.finishPvpMatch(room, opponent.sync.id);
        }
      }
      room.pvp.fighters.delete(playerId);
    }

    room.players.delete(playerId);

    if (room.players.size === 0) {
      this.rooms.delete(room.code);
      return;
    }

    let newHostId: string | null = null;
    if (wasHost) {
      const nextHost =
        Array.from(room.players.values()).find((r) => r.sync.connected !== false) ??
        Array.from(room.players.values())[0];
      if (nextHost) {
        nextHost.sync.isHost = true;
        newHostId = nextHost.sync.id;
      }
    }

    if (room.mode === 'pvp' && room.pvp) {
      if (room.pvp.phase !== 'match_end') {
        room.pvp.phase = 'waiting';
        room.pvp.roundNumber = 1;
        room.pvp.phaseTimer = 0;
        for (const extra of room.pvp.fighters.values()) {
          extra.ready = false;
          extra.roundsWon = 0;
        }
      }
      this.broadcastRoom(room, {
        type: 'pvp:state',
        state: this.serializePvpState(room),
      });
    }

    this.broadcastRoom(room, {
      type: 'player:left',
      playerId,
      newHostId,
    });
  }

  private leaveCurrentRoom(peerId: string) {
    const meta = this.peerMeta.get(peerId);
    if (!meta || !meta.roomCode) return;
    const room = this.rooms.get(meta.roomCode);
    meta.roomCode = null;
    if (!room) return;
    this.removePlayerFromRoom(room, meta.playerId);
  }

  private broadcastRoom(room: ServerRoom, msg: CoopServerMessage, excludePlayerId?: string) {
    for (const [pid, rec] of room.players.entries()) {
      if (excludePlayerId && pid === excludePlayerId) continue;
      if (rec.peerId) {
        this.sendFn(rec.peerId, msg);
      }
    }
  }

  private generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 20; attempt++) {
      let code = '';
      for (let i = 0; i < 5; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    return `C${Date.now().toString(36).slice(-4).toUpperCase()}`;
  }

  private makeEnemy(
    type: EnemyType,
    x: number,
    y: number,
    scale: number,
    roomId: number,
    floorNumber = 1,
    playerCount = 1
  ): ServerEnemy {
    const def = ENEMY_DEFINITIONS[type] ?? ENEMY_DEFINITIONS.skeleton;
    if (def.isBoss) {
      const bm = getBossFloorMultipliers(floorNumber, playerCount);
      const maxHp = Math.round(def.baseHp * bm.hpMult);
      return {
        id: `srv_e_${this.idSeq++}`,
        type: def.type,
        name: getBossDisplayName(def.name, floorNumber),
        isBoss: true,
        x,
        y,
        facing: 0,
        hp: maxHp,
        maxHp,
        radius: def.radius,
        speed: Math.round(def.speed * bm.speedMult),
        damage: Math.round(def.damage * bm.damageMult),
        xpValue: Math.round(def.xpValue * bm.xpMult),
        goldValue: Math.round(def.goldValue * bm.goldMult),
        state: 'idle',
        telegraph: null,
        roomId,
        attackCooldown: Math.max(0.5, def.initialCooldown * bm.cooldownMult),
        stateTimer: 0,
        bleedTimer: 0,
        bleedDps: 0,
        slowTimer: 0,
        bossPatternIndex: 0,
        enraged: false,
        floorNumber,
      };
    }

    const maxHp = Math.round(def.baseHp * scale);
    return {
      id: `srv_e_${this.idSeq++}`,
      type: def.type,
      name: def.name,
      isBoss: false,
      x,
      y,
      facing: 0,
      hp: maxHp,
      maxHp,
      radius: def.radius,
      speed: def.speed,
      damage: Math.round(def.damage * scale),
      xpValue: Math.round(def.xpValue * scale),
      goldValue: Math.round(def.goldValue * scale),
      state: 'idle',
      telegraph: null,
      roomId,
      attackCooldown: def.initialCooldown,
      stateTimer: 0,
      bleedTimer: 0,
      bleedDps: 0,
      slowTimer: 0,
      bossPatternIndex: 0,
    };
  }

  private spawnEnemiesForFloor(
    floor: DungeonFloor,
    seed: number,
    playerCount: number
  ): ServerEnemy[] {
    const rng = createSeededRng(seed ^ 0x9e3779b9);
    const f = floor.floorNumber;
    const ts = floor.tileSize;
    const scale =
      (1 + (f - 1) * ENEMY_SCALING.floorFactor) *
      (1 + Math.max(0, playerCount - 1) * ENEMY_SCALING.coopPlayerFactor);
    const result: ServerEnemy[] = [];

    for (const room of floor.rooms) {
      if (room.type === 'combat') {
        const count = Math.min(8, 3 + f + Math.floor(rng() * 2));
        for (let i = 0; i < count; i++) {
          const ex = (room.x + 1.5 + rng() * (room.w - 3)) * ts;
          const ey = (room.y + 1.5 + rng() * (room.h - 3)) * ts;
          const roll = rng();
          let type: EnemyType = 'skeleton';
          if (roll > 0.78) type = 'golem';
          else if (roll > 0.52) type = 'cultist';
          else if (roll > 0.32 && (f >= 2 || rng() < 0.45)) type = 'wraith';
          result.push(this.makeEnemy(type, ex, ey, scale, room.id, f, playerCount));
        }
      } else if (room.type === 'boss') {
        const bossType: EnemyType = f % 2 === 1 ? 'boss_warden' : 'boss_archon';
        result.push(
          this.makeEnemy(
            bossType,
            (room.cx + 0.5) * ts,
            (room.cy + 0.5) * ts,
            scale,
            room.id,
            f,
            playerCount
          )
        );
      }
    }
    return result;
  }

  private stepRoom(room: ServerRoom, dt: number) {
    const alivePlayers = Array.from(room.players.values())
      .map((r) => r.sync)
      .filter((p) => p.alive && p.connected !== false);
    if (alivePlayers.length === 0) return;

    for (let i = room.enemies.length - 1; i >= 0; i--) {
      const e = room.enemies[i];
      if (e.hp <= 0) continue;

      e.attackCooldown = Math.max(0, e.attackCooldown - dt);
      e.slowTimer = Math.max(0, e.slowTimer - dt);

      if (e.bleedTimer > 0) {
        e.bleedTimer -= dt;
        e.hp -= e.bleedDps * dt;
        if (e.hp <= 0) {
          room.enemies.splice(i, 1);
          this.handleEnemyKilled(room, e, 'bleed');
          continue;
        }
      }

      let target = alivePlayers[0];
      let minDist = Math.hypot(target.x - e.x, target.y - e.y);
      for (let j = 1; j < alivePlayers.length; j++) {
        const p = alivePlayers[j];
        const d = Math.hypot(p.x - e.x, p.y - e.y);
        if (d < minDist) {
          minDist = d;
          target = p;
        }
      }

      const dx = target.x - e.x;
      const dy = target.y - e.y;
      const dist = Math.max(0.01, minDist);
      const aggroRange = ENEMY_DEFINITIONS[e.type]?.aggroRange ?? (e.isBoss ? 520 : 360);

      if (e.state === 'idle') {
        if (dist <= aggroRange) e.state = 'chase';
        continue;
      }

      if (e.state === 'windup' && e.telegraph) {
        e.telegraph.timer -= dt;
        if (e.telegraph.timer <= 0) {
          const fired: EnemyTelegraph = { ...e.telegraph };
          if (
            e.type === 'wraith' &&
            !collidesWall(room.floor, fired.targetX, fired.targetY, e.radius)
          ) {
            e.x = fired.targetX;
            e.y = fired.targetY;
          }
          e.telegraph = null;
          e.state = 'recover';
          e.stateTimer = e.isBoss ? 0.5 : 0.4;
          this.broadcastRoom(room, { type: 'enemy:attack', enemyId: e.id, telegraph: fired });
        }
        continue;
      }

      if (e.state === 'recover') {
        e.stateTimer -= dt;
        if (e.stateTimer <= 0) e.state = 'chase';
        continue;
      }

      e.facing = Math.atan2(dy, dx);
      const spd = e.speed * (e.slowTimer > 0 ? 0.55 : 1);

      if (e.type === 'cultist') {
        if (dist > 220) {
          nudgeEnemy(room.floor, e, (dx / dist) * spd * dt, (dy / dist) * spd * dt);
        } else if (dist < 120) {
          nudgeEnemy(
            room.floor,
            e,
            -(dx / dist) * spd * 0.75 * dt,
            -(dy / dist) * spd * 0.75 * dt
          );
        }
        if (dist < 310 && e.attackCooldown <= 0) {
          e.state = 'windup';
          e.attackCooldown = 2.0;
          e.telegraph = {
            type: 'line',
            timer: 0.65,
            duration: 0.65,
            angle: e.facing,
            range: 280,
            radius: 8,
            damage: e.damage,
            targetX: target.x,
            targetY: target.y,
          };
        }
      } else if (e.type === 'golem') {
        if (dist > 56) nudgeEnemy(room.floor, e, (dx / dist) * spd * dt, (dy / dist) * spd * dt);
        if (dist < 84 && e.attackCooldown <= 0) {
          e.state = 'windup';
          e.attackCooldown = 2.4;
          e.telegraph = {
            type: 'circle',
            timer: 0.85,
            duration: 0.85,
            angle: e.facing,
            range: 0,
            radius: 92,
            damage: e.damage,
            targetX: e.x,
            targetY: e.y,
          };
        }
      } else if (e.type === 'wraith') {
        if (dist > 64) nudgeEnemy(room.floor, e, (dx / dist) * spd * dt, (dy / dist) * spd * dt);
        if (dist < 150 && e.attackCooldown <= 0) {
          e.state = 'windup';
          e.attackCooldown = 1.7;
          e.telegraph = {
            type: 'line',
            timer: 0.5,
            duration: 0.5,
            angle: e.facing,
            range: 135,
            radius: 16,
            damage: e.damage,
            targetX: e.x + Math.cos(e.facing) * 125,
            targetY: e.y + Math.sin(e.facing) * 125,
          };
        }
      } else if (e.isBoss) {
        const floorNum = e.floorNumber ?? room.floorNumber;
        const bm = getBossFloorMultipliers(floorNum, room.players.size);
        if (floorNum >= 2 && !e.enraged && e.hp <= e.maxHp * 0.5) {
          e.enraged = true;
          e.attackCooldown = Math.min(e.attackCooldown, 0.35);
          e.speed = Math.round(e.speed * 1.15);
        }
        const enragedCd = e.enraged ? 0.76 : 1;
        const enragedTele = e.enraged ? 0.85 : 1;
        const effectiveSpd = spd * (e.enraged ? 1.12 : 1);

        if (dist > 78) {
          nudgeEnemy(
            room.floor,
            e,
            (dx / dist) * effectiveSpd * dt,
            (dy / dist) * effectiveSpd * dt
          );
        }
        if (e.attackCooldown <= 0) {
          const patternCount = floorNum >= 3 || e.enraged ? 4 : 3;
          e.bossPatternIndex = (e.bossPatternIndex + 1) % patternCount;
          e.state = 'windup';
          const baseCd = e.type === 'boss_archon' ? 1.85 : 2.1;
          e.attackCooldown = Math.max(0.65, baseCd * bm.cooldownMult * enragedCd);

          if (e.bossPatternIndex === 0 && dist < 145) {
            const windup = Math.max(0.36, 0.72 * bm.telegraphMult * enragedTele);
            e.telegraph = {
              type: 'arc',
              timer: windup,
              duration: windup,
              angle: e.facing,
              range: 120 + Math.min(48, (floorNum - 1) * 8),
              radius: Math.PI * (e.enraged ? 1.1 : 0.9),
              damage: Math.round(e.damage * 1.15),
              targetX: target.x,
              targetY: target.y,
              enraged: e.enraged,
            };
          } else if (e.bossPatternIndex === 1) {
            const windup = Math.max(0.42, 0.85 * bm.telegraphMult * enragedTele);
            const baseOrbs = e.type === 'boss_archon' ? 10 : 8;
            e.telegraph = {
              type: 'nova',
              timer: windup,
              duration: windup,
              angle: e.facing,
              range: 240 + Math.min(80, (floorNum - 1) * 16),
              radius: 115 + bm.bonusSlamRadius * 0.5,
              damage: e.damage,
              targetX: e.x,
              targetY: e.y,
              orbCount: baseOrbs + bm.bonusOrbs + (e.enraged ? 4 : 0),
              orbSpeed: 265 + Math.min(150, (floorNum - 1) * 24) + (e.enraged ? 35 : 0),
              enraged: e.enraged,
            };
          } else if (e.bossPatternIndex === 3) {
            if (e.type === 'boss_archon') {
              const windup = Math.max(0.38, 0.68 * bm.telegraphMult * enragedTele);
              e.telegraph = {
                type: 'line',
                timer: windup,
                duration: windup,
                angle: e.facing,
                range: 340,
                radius: 10,
                damage: Math.round(e.damage * 0.95),
                targetX: target.x,
                targetY: target.y,
                orbCount: 3 + Math.min(4, Math.max(0, floorNum - 2)) + (e.enraged ? 2 : 0),
                orbSpeed: 310 + Math.min(140, (floorNum - 1) * 22),
                enraged: e.enraged,
              };
            } else {
              const windup = Math.max(0.38, 0.68 * bm.telegraphMult * enragedTele);
              e.telegraph = {
                type: 'circle',
                timer: windup,
                duration: windup,
                angle: e.facing,
                range: 0,
                radius: 110 + bm.bonusSlamRadius,
                damage: Math.round(e.damage * 1.22),
                targetX: target.x,
                targetY: target.y,
                enraged: e.enraged,
              };
            }
          } else {
            const windup = Math.max(0.4, 0.8 * bm.telegraphMult * enragedTele);
            e.telegraph = {
              type: 'circle',
              timer: windup,
              duration: windup,
              angle: e.facing,
              range: 0,
              radius: 95 + bm.bonusSlamRadius,
              damage: Math.round(e.damage * 1.1),
              targetX: target.x,
              targetY: target.y,
              enraged: e.enraged,
            };
          }
        }
      } else {
        if (dist > 44) nudgeEnemy(room.floor, e, (dx / dist) * spd * dt, (dy / dist) * spd * dt);
        if (dist < 64 && e.attackCooldown <= 0) {
          e.state = 'windup';
          e.attackCooldown = 1.45;
          e.telegraph = {
            type: 'arc',
            timer: 0.45,
            duration: 0.45,
            angle: e.facing,
            range: 68,
            radius: Math.PI * 0.7,
            damage: e.damage,
            targetX: target.x,
            targetY: target.y,
          };
        }
      }
    }
  }

  private handleEnemyKilled(room: ServerRoom, enemy: ServerEnemy, killerId: string) {
    if (enemy.isBoss) {
      room.portalOpen = true;
    }

    const killerRec = room.players.get(killerId);
    if (killerRec) {
      const killerStats = this.computeRecStats(killerRec);
      if (killerStats.killHeal > 0 && killerRec.hero.alive) {
        killerRec.hero.hp = Math.min(killerRec.hero.maxHp, killerRec.hero.hp + killerStats.killHeal);
        killerRec.sync.hp = killerRec.hero.hp;
      }
    }

    // Grant XP & kill tally authoritatively
    for (const pRec of room.players.values()) {
      pRec.hero.kills += 1;
      this.grantXpToPlayer(pRec, enemy.xpValue);
      this.sendHeroStats(pRec);
    }

    this.broadcastRoom(room, {
      type: 'enemy:killed',
      enemyId: enemy.id,
      killerId,
      xpValue: enemy.xpValue,
      goldValue: enemy.goldValue,
      isBoss: enemy.isBoss,
      x: enemy.x,
      y: enemy.y,
      roomId: enemy.roomId,
    });

    // Server-authoritative deterministic loot spawning
    const rng = this.nextLootRng(room);
    const maxFortune = this.getMaxPartyFortune(room);
    const spawned: GroundLoot[] = [];

    if (enemy.isBoss) {
      const bossSouls = 18 + room.floorNumber * 8;
      for (const pRec of room.players.values()) {
        pRec.hero.souls += bossSouls;
        this.sendHeroStats(pRec);
      }
      const bossItem = generateLootItem(
        room.floorNumber,
        maxFortune,
        room.floorNumber >= 2 ? 'relic' : 'epic',
        rng,
        `srv_boss_item_${room.floorNumber}_${room.lootSeq++}`
      );
      spawned.push({
        id: `srv_loot_${this.idSeq++}`,
        x: enemy.x,
        y: enemy.y,
        vx: 0,
        vy: 30,
        kind: 'item',
        item: bossItem,
        bobPhase: 0,
      });
    } else {
      if (rng() < 0.28 + maxFortune * 0.04) {
        spawned.push({
          id: `srv_loot_${this.idSeq++}`,
          x: enemy.x,
          y: enemy.y,
          vx: (rng() - 0.5) * 85,
          vy: (rng() - 0.5) * 85,
          kind: 'soul',
          amount: 2 + Math.floor(room.floorNumber * 0.8),
          bobPhase: rng() * 6,
        });
      }
      if (rng() < 0.72) {
        spawned.push({
          id: `srv_loot_${this.idSeq++}`,
          x: enemy.x,
          y: enemy.y,
          vx: (rng() - 0.5) * 75,
          vy: (rng() - 0.5) * 75,
          kind: 'gold',
          amount: enemy.goldValue,
          bobPhase: rng() * 6,
        });
      }
      if (rng() < 0.16) {
        spawned.push({
          id: `srv_loot_${this.idSeq++}`,
          x: enemy.x,
          y: enemy.y,
          vx: (rng() - 0.5) * 60,
          vy: (rng() - 0.5) * 60,
          kind: 'hp_orb',
          amount: 20 + room.floorNumber * 5,
          bobPhase: rng() * 6,
        });
      }
      if (rng() < 0.12 + maxFortune * 0.015) {
        spawned.push({
          id: `srv_loot_${this.idSeq++}`,
          x: enemy.x,
          y: enemy.y,
          vx: (rng() - 0.5) * 70,
          vy: (rng() - 0.5) * 70,
          kind: 'item',
          item: generateLootItem(
            room.floorNumber,
            maxFortune,
            undefined,
            rng,
            `srv_drop_item_${room.floorNumber}_${room.lootSeq++}`
          ),
          bobPhase: rng() * 6,
        });
      }
    }

    if (spawned.length > 0) {
      room.groundLoot.push(...spawned);
      this.broadcastRoom(room, { type: 'loot:spawned', items: spawned });
    }
  }

  private hydratePvpFighterStanding(
    room: ServerRoom,
    playerId: string,
    playerKey: string,
    playerName: string
  ) {
    if (!this.hooks.getPvpPlayerStanding || !room.pvp) return;
    this.hooks
      .getPvpPlayerStanding(playerKey, playerName)
      .then((standing) => {
        if (!this.rooms.has(room.code) || !room.pvp) return;
        const extra = room.pvp.fighters.get(playerId);
        if (!extra) return;
        extra.elo = standing.elo;
        extra.tierName = standing.tierName;
        this.broadcastRoom(room, {
          type: 'pvp:state',
          state: this.serializePvpState(room),
        });
      })
      .catch(() => undefined);
  }

  private serializePvpFighters(room: ServerRoom): PvpFighterSync[] {
    const pvp = room.pvp;
    if (!pvp) return [];
    const list: PvpFighterSync[] = [];
    const recs = Array.from(room.players.values()).sort((a, b) => {
      const sa = pvp.fighters.get(a.sync.id)?.slotIndex ?? 0;
      const sb = pvp.fighters.get(b.sync.id)?.slotIndex ?? 0;
      return sa - sb;
    });
    for (const rec of recs) {
      const extra = pvp.fighters.get(rec.sync.id);
      list.push({
        id: rec.sync.id,
        playerKey: extra?.playerKey ?? rec.sync.id,
        name: rec.sync.name,
        archetype: rec.hero.archetype,
        classTitle: rec.hero.classTitle,
        x: rec.sync.x,
        y: rec.sync.y,
        facing: rec.sync.facing,
        hp: rec.hero.hp,
        maxHp: rec.hero.maxHp,
        shield: rec.hero.shield,
        weaponKind: rec.sync.weaponKind,
        alive: rec.hero.alive,
        ready: extra?.ready ?? false,
        roundsWon: extra?.roundsWon ?? 0,
        flaskCharges: rec.hero.flaskCharges,
        maxFlaskCharges: rec.hero.maxFlaskCharges,
        elo: extra?.elo ?? PVP_BASE_ELO,
        tierName: extra?.tierName ?? getPvpTierInfo(PVP_BASE_ELO).name,
        color: rec.sync.color,
        connected: rec.sync.connected !== false,
        cosmetics: rec.sync.cosmetics,
      });
    }
    return list;
  }

  private serializePvpState(room: ServerRoom): PvpRoomSyncState {
    const pvp = room.pvp!;
    return {
      roomCode: room.code,
      phase: pvp.phase,
      roundNumber: pvp.roundNumber,
      bestOf: PVP_BEST_OF,
      phaseTimer: Math.max(0, Number(pvp.phaseTimer.toFixed(2))),
      ringRadius: Math.round(pvp.ringRadius),
      ringMaxRadius: PVP_RING_MAX_RADIUS,
      ringCenterX: PVP_ARENA_CENTER.x,
      ringCenterY: PVP_ARENA_CENTER.y,
      orbs: pvp.orbs.map((o) => ({ ...o })),
      winnerId: pvp.winnerId,
      winnerName: pvp.winnerName,
      fighters: this.serializePvpFighters(room),
    };
  }

  private startPvpRound(room: ServerRoom, roundNumber: number) {
    const pvp = room.pvp;
    if (!pvp) return;
    pvp.phase = 'countdown';
    pvp.roundNumber = roundNumber;
    pvp.phaseTimer = PVP_COUNTDOWN_SEC;
    pvp.ringRadius = PVP_RING_MAX_RADIUS;
    pvp.orbs = [];
    pvp.orbSpawnTimer = 10;

    for (const rec of room.players.values()) {
      const extra = pvp.fighters.get(rec.sync.id);
      const slotIndex = extra?.slotIndex ?? 0;
      const spawn = slotIndex === 0 ? PVP_SPAWN_P1 : PVP_SPAWN_P2;
      const stats = computePvpHeroStats(rec.hero.archetype);
      rec.hero.maxHp = stats.maxHp;
      rec.hero.hp = stats.maxHp;
      rec.hero.shield = 0;
      rec.hero.alive = true;
      rec.hero.flaskCharges = 2;
      rec.hero.maxFlaskCharges = 2;
      rec.hero.x = spawn.x;
      rec.hero.y = spawn.y;
      rec.shieldTimer = 0;
      rec.sync.x = spawn.x;
      rec.sync.y = spawn.y;
      rec.sync.facing = spawn.facing;
      rec.sync.hp = stats.maxHp;
      rec.sync.maxHp = stats.maxHp;
      rec.sync.shield = 0;
      rec.sync.alive = true;
      if (extra) extra.ringTickAccum = 0;
      this.sendHeroStats(rec);
    }
  }

  private stepPvpRoom(room: ServerRoom, dt: number) {
    const pvp = room.pvp;
    if (!pvp) return;

    if (pvp.phase === 'countdown') {
      pvp.phaseTimer -= dt;
      if (pvp.phaseTimer <= 0) {
        pvp.phase = 'fighting';
        pvp.phaseTimer = PVP_ROUND_DURATION_SEC;
        pvp.orbSpawnTimer = 9;
      }
      return;
    }

    if (pvp.phase === 'fighting') {
      pvp.phaseTimer = Math.max(0, pvp.phaseTimer - dt);
      const elapsed = PVP_ROUND_DURATION_SEC - pvp.phaseTimer;
      if (elapsed >= PVP_RING_SHRINK_START_SEC) {
        const shrinkSpan = Math.max(1, PVP_ROUND_DURATION_SEC - PVP_RING_SHRINK_START_SEC);
        const progress = Math.min(1, (elapsed - PVP_RING_SHRINK_START_SEC) / shrinkSpan);
        pvp.ringRadius =
          PVP_RING_MAX_RADIUS - (PVP_RING_MAX_RADIUS - PVP_RING_MIN_RADIUS) * progress;
      }

      // Eclipse Ring storm damage outside safe circle
      for (const rec of room.players.values()) {
        if (!rec.hero.alive || pvp.phase !== 'fighting') continue;
        const extra = pvp.fighters.get(rec.sync.id);
        if (!extra) continue;
        const dist = Math.hypot(
          rec.sync.x - PVP_ARENA_CENTER.x,
          rec.sync.y - PVP_ARENA_CENTER.y
        );
        if (dist > pvp.ringRadius) {
          extra.ringTickAccum += dt;
          if (extra.ringTickAccum >= 0.5) {
            extra.ringTickAccum -= 0.5;
            const opponent = Array.from(room.players.values()).find(
              (r) => r.sync.id !== rec.sync.id
            );
            this.applyPvpDamage(
              room,
              rec,
              opponent?.sync.id ?? 'eclipse_ring',
              14,
              false,
              '#A855F7',
              0,
              0
            );
          }
        } else {
          extra.ringTickAccum = 0;
        }
      }

      if (pvp.phase !== 'fighting') return;

      // Spawn arena energy orbs periodically near center
      pvp.orbSpawnTimer -= dt;
      if (pvp.orbSpawnTimer <= 0 && pvp.orbs.length < 2) {
        pvp.orbSpawnTimer = 11;
        const kind: PvpOrbEntity['kind'] = pvp.orbs.length % 2 === 0 ? 'heal' : 'mana';
        const angle = (this.idSeq * 2.39996) % (Math.PI * 2);
        const offsetDist = 36 + ((this.idSeq * 29) % 70);
        pvp.orbs.push({
          id: `pvp_orb_${this.idSeq++}`,
          x: Math.round(PVP_ARENA_CENTER.x + Math.cos(angle) * offsetDist),
          y: Math.round(PVP_ARENA_CENTER.y + Math.sin(angle) * offsetDist),
          kind,
          amount: kind === 'heal' ? 48 : 35,
        });
      }
      return;
    }

    if (pvp.phase === 'round_end') {
      pvp.phaseTimer -= dt;
      if (pvp.phaseTimer <= 0) {
        this.startPvpRound(room, pvp.roundNumber + 1);
      }
    }
  }

  private applyPvpDamage(
    room: ServerRoom,
    targetRec: ServerPlayerRecord,
    attackerId: string,
    damage: number,
    isCrit: boolean,
    color: string,
    knockX: number,
    knockY: number
  ) {
    const pvp = room.pvp;
    if (!pvp || pvp.phase !== 'fighting' || !targetRec.hero.alive) return;

    let remaining = damage;
    if (targetRec.hero.shield > 0) {
      const absorbed = Math.min(targetRec.hero.shield, remaining);
      targetRec.hero.shield -= absorbed;
      remaining -= absorbed;
    }
    if (remaining > 0) {
      targetRec.hero.hp = Math.max(0, targetRec.hero.hp - remaining);
    }

    if (targetRec.hero.hp <= 0) {
      targetRec.hero.hp = 0;
      targetRec.hero.shield = 0;
      targetRec.hero.alive = false;
    }

    targetRec.sync.hp = targetRec.hero.hp;
    targetRec.sync.shield = targetRec.hero.shield;
    targetRec.sync.alive = targetRec.hero.alive;
    this.sendHeroStats(targetRec);

    this.broadcastRoom(room, {
      type: 'pvp:damaged',
      targetId: targetRec.sync.id,
      attackerId,
      hp: targetRec.hero.hp,
      shield: targetRec.hero.shield,
      damage,
      isCrit,
      color,
      knockX,
      knockY,
    });

    if (!targetRec.hero.alive) {
      const winnerRec =
        room.players.get(attackerId) ??
        Array.from(room.players.values()).find((r) => r.sync.id !== targetRec.sync.id);
      if (!winnerRec) return;
      const winnerExtra = pvp.fighters.get(winnerRec.sync.id);
      if (winnerExtra) {
        winnerExtra.roundsWon += 1;
      }

      this.broadcastRoom(room, {
        type: 'pvp:round_end',
        roundNumber: pvp.roundNumber,
        roundWinnerId: winnerRec.sync.id,
        roundWinnerName: winnerRec.sync.name,
        fighters: this.serializePvpFighters(room),
      });

      if ((winnerExtra?.roundsWon ?? 0) >= PVP_ROUNDS_TO_WIN) {
        this.finishPvpMatch(room, winnerRec.sync.id);
      } else {
        pvp.phase = 'round_end';
        pvp.phaseTimer = PVP_ROUND_END_SEC;
        this.broadcastRoom(room, {
          type: 'pvp:state',
          state: this.serializePvpState(room),
        });
      }
    }
  }

  private finishPvpMatch(room: ServerRoom, winnerId: string) {
    const pvp = room.pvp;
    if (!pvp || pvp.matchCommitted) return;
    const winnerRec = room.players.get(winnerId);
    const loserRec = Array.from(room.players.values()).find((r) => r.sync.id !== winnerId);
    if (!winnerRec || !loserRec) return;

    pvp.matchCommitted = true;
    pvp.phase = 'match_end';
    pvp.phaseTimer = 0;
    pvp.winnerId = winnerRec.sync.id;
    pvp.winnerName = winnerRec.sync.name;

    const winnerExtra = pvp.fighters.get(winnerRec.sync.id)!;
    const loserExtra = pvp.fighters.get(loserRec.sync.id)!;
    winnerExtra.roundsWon = Math.max(winnerExtra.roundsWon, PVP_ROUNDS_TO_WIN);

    const ordered = Array.from(room.players.values()).sort(
      (a, b) =>
        (pvp.fighters.get(a.sync.id)?.slotIndex ?? 0) -
        (pvp.fighters.get(b.sync.id)?.slotIndex ?? 0)
    );
    const p1Rounds = pvp.fighters.get(ordered[0]?.sync.id ?? '')?.roundsWon ?? winnerExtra.roundsWon;
    const p2Rounds = pvp.fighters.get(ordered[1]?.sync.id ?? '')?.roundsWon ?? loserExtra.roundsWon;
    const score = `${winnerExtra.roundsWon}-${loserExtra.roundsWon}`;

    const finalizeAndBroadcast = (res: PvpMatchCommitResult) => {
      if (!this.rooms.has(room.code) || !room.pvp) return;
      winnerExtra.elo = res.winnerEloAfter;
      winnerExtra.tierName = res.winnerTierName;
      loserExtra.elo = res.loserEloAfter;
      loserExtra.tierName = res.loserTierName;

      this.broadcastRoom(room, {
        type: 'pvp:state',
        state: this.serializePvpState(room),
      });

      this.broadcastRoom(room, {
        type: 'pvp:match_end',
        winnerId: winnerRec.sync.id,
        winnerName: winnerRec.sync.name,
        loserId: loserRec.sync.id,
        loserName: loserRec.sync.name,
        p1Rounds,
        p2Rounds,
        winnerEloBefore: res.winnerEloBefore,
        winnerEloAfter: res.winnerEloAfter,
        winnerDelta: res.winnerDelta,
        loserEloBefore: res.loserEloBefore,
        loserEloAfter: res.loserEloAfter,
        loserDelta: res.loserDelta,
        winnerTierName: res.winnerTierName,
        loserTierName: res.loserTierName,
        winnerNewTitle: res.winnerNewTitle,
        loserNewTitle: res.loserNewTitle,
        winnerSouls: res.winnerSouls,
        loserSouls: res.loserSouls,
      });
    };

    if (this.hooks.commitPvpMatchOutcome) {
      this.hooks
        .commitPvpMatchOutcome({
          winnerKey: winnerExtra.playerKey,
          winnerName: winnerRec.sync.name,
          winnerArchetype: winnerRec.hero.archetype,
          loserKey: loserExtra.playerKey,
          loserName: loserRec.sync.name,
          loserArchetype: loserRec.hero.archetype,
          score,
        })
        .then(finalizeAndBroadcast)
        .catch(() => {
          const calc = calculateEloDelta(winnerExtra.elo, loserExtra.elo);
          finalizeAndBroadcast({
            winnerEloBefore: winnerExtra.elo,
            winnerEloAfter: calc.winnerAfter,
            winnerDelta: calc.winnerDelta,
            loserEloBefore: loserExtra.elo,
            loserEloAfter: calc.loserAfter,
            loserDelta: calc.loserDelta,
            winnerTierName: getPvpTierInfo(calc.winnerAfter).name,
            loserTierName: getPvpTierInfo(calc.loserAfter).name,
            winnerNewTitle: null,
            loserNewTitle: null,
            winnerSouls: 35,
            loserSouls: 12,
          });
        });
    } else {
      const calc = calculateEloDelta(winnerExtra.elo, loserExtra.elo);
      finalizeAndBroadcast({
        winnerEloBefore: winnerExtra.elo,
        winnerEloAfter: calc.winnerAfter,
        winnerDelta: calc.winnerDelta,
        loserEloBefore: loserExtra.elo,
        loserEloAfter: calc.loserAfter,
        loserDelta: calc.loserDelta,
        winnerTierName: getPvpTierInfo(calc.winnerAfter).name,
        loserTierName: getPvpTierInfo(calc.loserAfter).name,
        winnerNewTitle: null,
        loserNewTitle: null,
        winnerSouls: 35,
        loserSouls: 12,
      });
    }
  }
}
