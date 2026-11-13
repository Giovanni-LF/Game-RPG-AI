import { generateDungeonFloor, isWalkableTile } from '../engine/dungeonGenerator.ts';
import type {
  CoopClientMessage,
  CoopEnemySync,
  CoopPlayerSync,
  CoopRoomSummary,
  CoopServerMessage,
} from '../types/coop.ts';
import type { DungeonFloor, EnemyTelegraph, EnemyType } from '../types/game.ts';

export interface ServerEnemy extends CoopEnemySync {
  attackCooldown: number;
  stateTimer: number;
  bleedTimer: number;
  bleedDps: number;
  slowTimer: number;
  bossPatternIndex: number;
}

export interface ServerRoom {
  code: string;
  isPublic: boolean;
  floorNumber: number;
  floorSeed: number;
  floor: DungeonFloor;
  players: Map<string, CoopPlayerSync>;
  peerIds: Map<string, string>; // playerId -> transport peerId
  enemies: ServerEnemy[];
  interactedPropIds: Set<string>;
  brokenPropIds: Set<string>;
  portalOpen: boolean;
  lastTick: number;
}

const PLAYER_COLORS = ['#F59E0B', '#38BDF8', '#10B981', '#C084FC'];

function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

export class CoopRoomManager {
  private rooms = new Map<string, ServerRoom>();
  private peerMeta = new Map<string, { playerId: string; roomCode: string | null }>();
  private idSeq = 1;
  private sendFn: (peerId: string, msg: CoopServerMessage) => void;

  constructor(sendFn: (peerId: string, msg: CoopServerMessage) => void) {
    this.sendFn = sendFn;
  }

  registerPeer(peerId: string): string {
    const playerId = `p_${this.idSeq++}`;
    this.peerMeta.set(peerId, { playerId, roomCode: null });
    return playerId;
  }

  disconnectPeer(peerId: string) {
    this.leaveCurrentRoom(peerId);
    this.peerMeta.delete(peerId);
  }

  getRoomSnapshot(roomCode: string): ServerRoom | undefined {
    return this.rooms.get(roomCode);
  }

  listPublicRooms(): CoopRoomSummary[] {
    const list: CoopRoomSummary[] = [];
    for (const room of this.rooms.values()) {
      if (!room.isPublic || room.players.size === 0) continue;
      const host =
        Array.from(room.players.values()).find((p) => p.isHost) ??
        Array.from(room.players.values())[0];
      list.push({
        code: room.code,
        hostName: host?.name ?? 'Aventurero',
        playerCount: room.players.size,
        maxPlayers: 4,
        floorNumber: room.floorNumber,
      });
    }
    return list;
  }

  tickAllRooms() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      const dt = Math.min(0.1, (now - room.lastTick) / 1000);
      room.lastTick = now;
      if (room.players.size === 0) continue;
      this.stepRoom(room, dt);
      this.broadcastRoom(room, {
        type: 'world:tick',
        players: Array.from(room.players.values()),
        enemies: room.enemies.map(serializeEnemy),
      });
    }
  }

  handleMessage(peerId: string, msg: CoopClientMessage) {
    const meta = this.peerMeta.get(peerId);
    if (!meta) return;

    if (msg.type === 'room:list') {
      this.sendFn(peerId, { type: 'room:list', rooms: this.listPublicRooms() });
      return;
    }

    if (msg.type === 'room:create') {
      this.leaveCurrentRoom(peerId);
      const code = this.generateRoomCode();
      const floorSeed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
      const floor = generateDungeonFloor(1, floorSeed);
      const enemies = this.spawnEnemiesForFloor(floor, floorSeed, 1);

      const player: CoopPlayerSync = {
        id: meta.playerId,
        name: (msg.playerName || 'Héroe').slice(0, 18),
        archetype: msg.archetype,
        classTitle: msg.classTitle,
        level: 1,
        x: floor.spawnX,
        y: floor.spawnY,
        facing: 0,
        hp: msg.maxHp,
        maxHp: msg.maxHp,
        shield: 0,
        weaponKind: msg.weaponKind,
        alive: true,
        isHost: true,
        color: PLAYER_COLORS[0],
      };

      const room: ServerRoom = {
        code,
        isPublic: msg.isPublic,
        floorNumber: 1,
        floorSeed,
        floor,
        players: new Map([[meta.playerId, player]]),
        peerIds: new Map([[meta.playerId, peerId]]),
        enemies,
        interactedPropIds: new Set(),
        brokenPropIds: new Set(),
        portalOpen: false,
        lastTick: Date.now(),
      };
      this.rooms.set(code, room);
      meta.roomCode = code;

      this.sendFn(peerId, {
        type: 'room:joined',
        roomCode: code,
        playerId: meta.playerId,
        floorNumber: 1,
        floorSeed,
        players: [player],
        enemies: room.enemies.map(serializeEnemy),
        interactedPropIds: [],
        brokenPropIds: [],
        portalOpen: false,
      });
      return;
    }

    if (msg.type === 'room:join') {
      const cleanCode = (msg.code || '').trim().toUpperCase();
      const room = this.rooms.get(cleanCode);
      if (!room) {
        this.sendFn(peerId, {
          type: 'room:error',
          message: `No existe ninguna sala con el código ${cleanCode}.`,
        });
        return;
      }
      if (room.players.size >= 4) {
        this.sendFn(peerId, {
          type: 'room:error',
          message: 'La sala ya está completa (4/4 jugadores).',
        });
        return;
      }

      this.leaveCurrentRoom(peerId);

      const usedColors = new Set(Array.from(room.players.values()).map((p) => p.color));
      const color =
        PLAYER_COLORS.find((c) => !usedColors.has(c)) ??
        PLAYER_COLORS[room.players.size % PLAYER_COLORS.length];

      const player: CoopPlayerSync = {
        id: meta.playerId,
        name: (msg.playerName || 'Aliado').slice(0, 18),
        archetype: msg.archetype,
        classTitle: msg.classTitle,
        level: 1,
        x: room.floor.spawnX + (room.players.size * 22 - 22),
        y: room.floor.spawnY + 18,
        facing: 0,
        hp: msg.maxHp,
        maxHp: msg.maxHp,
        shield: 0,
        weaponKind: msg.weaponKind,
        alive: true,
        isHost: false,
        color,
      };

      room.players.set(meta.playerId, player);
      room.peerIds.set(meta.playerId, peerId);
      meta.roomCode = room.code;

      this.sendFn(peerId, {
        type: 'room:joined',
        roomCode: room.code,
        playerId: meta.playerId,
        floorNumber: room.floorNumber,
        floorSeed: room.floorSeed,
        players: Array.from(room.players.values()),
        enemies: room.enemies.map(serializeEnemy),
        interactedPropIds: Array.from(room.interactedPropIds),
        brokenPropIds: Array.from(room.brokenPropIds),
        portalOpen: room.portalOpen,
      });

      this.broadcastRoom(room, { type: 'player:joined', player }, meta.playerId);
      return;
    }

    if (msg.type === 'room:leave') {
      this.leaveCurrentRoom(peerId);
      return;
    }

    if (!meta.roomCode) return;
    const room = this.rooms.get(meta.roomCode);
    if (!room) return;
    const actor = room.players.get(meta.playerId);
    if (!actor) return;

    if (msg.type === 'player:state') {
      actor.x = msg.x;
      actor.y = msg.y;
      actor.facing = msg.facing;
      actor.hp = msg.hp;
      actor.maxHp = msg.maxHp;
      actor.shield = msg.shield;
      actor.level = msg.level;
      actor.classTitle = msg.classTitle;
      actor.weaponKind = msg.weaponKind;
      actor.alive = msg.alive;
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

    if (msg.type === 'combat:hit') {
      const idx = room.enemies.findIndex((e) => e.id === msg.enemyId);
      if (idx === -1) return;
      const enemy = room.enemies[idx];
      if (enemy.hp <= 0) return;

      enemy.hp = Math.max(0, enemy.hp - msg.damage);
      if (msg.knockX || msg.knockY) {
        nudgeEnemy(room.floor, enemy, msg.knockX, msg.knockY);
      }
      if (msg.bleedDps) {
        enemy.bleedTimer = 3.0;
        enemy.bleedDps = Math.max(enemy.bleedDps, msg.bleedDps);
      }
      if (msg.slow) {
        enemy.slowTimer = Math.max(enemy.slowTimer, 2.2);
      }

      this.broadcastRoom(room, {
        type: 'enemy:damaged',
        enemyId: enemy.id,
        hp: enemy.hp,
        damage: msg.damage,
        isCrit: msg.isCrit,
        color: msg.color,
        attackerId: meta.playerId,
      });

      if (enemy.hp <= 0) {
        room.enemies.splice(idx, 1);
        this.handleEnemyKilled(room, enemy, meta.playerId);
      }
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
      return;
    }

    if (msg.type === 'prop:break') {
      if (room.brokenPropIds.has(msg.propId)) return;
      room.brokenPropIds.add(msg.propId);
      this.broadcastRoom(room, { type: 'prop:broken', propId: msg.propId });
      return;
    }

    if (msg.type === 'player:revive') {
      const target = room.players.get(msg.targetPlayerId);
      if (!target || target.alive) return;
      target.alive = true;
      target.hp = Math.max(1, Math.round(target.maxHp * 0.5));
      this.broadcastRoom(room, {
        type: 'player:revived',
        targetPlayerId: target.id,
        reviverName: actor.name,
      });
      return;
    }

    if (msg.type === 'floor:descend') {
      if (!room.portalOpen) return;
      room.floorNumber += 1;
      room.floorSeed = (Date.now() ^ (room.floorNumber * 2654435761)) >>> 0;
      room.floor = generateDungeonFloor(room.floorNumber, room.floorSeed);
      room.enemies = this.spawnEnemiesForFloor(room.floor, room.floorSeed, room.players.size);
      room.interactedPropIds.clear();
      room.brokenPropIds.clear();
      room.portalOpen = false;

      let offset = 0;
      for (const p of room.players.values()) {
        p.x = room.floor.spawnX + (offset % 2 === 0 ? -18 : 18);
        p.y = room.floor.spawnY + (offset < 2 ? -14 : 14);
        p.alive = true;
        p.hp = Math.max(p.hp, Math.round(p.maxHp * 0.5));
        offset++;
      }

      this.broadcastRoom(room, {
        type: 'floor:changed',
        floorNumber: room.floorNumber,
        floorSeed: room.floorSeed,
        enemies: room.enemies.map(serializeEnemy),
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

  private leaveCurrentRoom(peerId: string) {
    const meta = this.peerMeta.get(peerId);
    if (!meta || !meta.roomCode) return;
    const room = this.rooms.get(meta.roomCode);
    meta.roomCode = null;
    if (!room) return;

    const wasHost = room.players.get(meta.playerId)?.isHost ?? false;
    room.players.delete(meta.playerId);
    room.peerIds.delete(meta.playerId);

    if (room.players.size === 0) {
      this.rooms.delete(room.code);
      return;
    }

    let newHostId: string | null = null;
    if (wasHost) {
      const first = room.players.values().next().value as CoopPlayerSync | undefined;
      if (first) {
        first.isHost = true;
        newHostId = first.id;
      }
    }

    this.broadcastRoom(room, {
      type: 'player:left',
      playerId: meta.playerId,
      newHostId,
    });
  }

  private broadcastRoom(room: ServerRoom, msg: CoopServerMessage, excludePlayerId?: string) {
    for (const [pid, peerId] of room.peerIds.entries()) {
      if (excludePlayerId && pid === excludePlayerId) continue;
      this.sendFn(peerId, msg);
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
    roomId: number
  ): ServerEnemy {
    const id = `srv_e_${this.idSeq++}`;
    if (type === 'cultist') {
      return {
        id,
        type,
        name: 'Cultista del Eclipse',
        isBoss: false,
        x,
        y,
        facing: 0,
        hp: Math.round(54 * scale),
        maxHp: Math.round(54 * scale),
        radius: 14,
        speed: 88,
        damage: Math.round(16 * scale),
        xpValue: Math.round(28 * scale),
        goldValue: Math.round(8 * scale),
        state: 'idle',
        telegraph: null,
        roomId,
        attackCooldown: 0.8,
        stateTimer: 0,
        bleedTimer: 0,
        bleedDps: 0,
        slowTimer: 0,
        bossPatternIndex: 0,
      };
    }
    if (type === 'golem') {
      return {
        id,
        type,
        name: 'Gólem de Basalto',
        isBoss: false,
        x,
        y,
        facing: 0,
        hp: Math.round(145 * scale),
        maxHp: Math.round(145 * scale),
        radius: 21,
        speed: 68,
        damage: Math.round(24 * scale),
        xpValue: Math.round(45 * scale),
        goldValue: Math.round(14 * scale),
        state: 'idle',
        telegraph: null,
        roomId,
        attackCooldown: 1.0,
        stateTimer: 0,
        bleedTimer: 0,
        bleedDps: 0,
        slowTimer: 0,
        bossPatternIndex: 0,
      };
    }
    if (type === 'wraith') {
      return {
        id,
        type,
        name: 'Espectro Umbrío',
        isBoss: false,
        x,
        y,
        facing: 0,
        hp: Math.round(70 * scale),
        maxHp: Math.round(70 * scale),
        radius: 14,
        speed: 138,
        damage: Math.round(18 * scale),
        xpValue: Math.round(32 * scale),
        goldValue: Math.round(10 * scale),
        state: 'idle',
        telegraph: null,
        roomId,
        attackCooldown: 0.6,
        stateTimer: 0,
        bleedTimer: 0,
        bleedDps: 0,
        slowTimer: 0,
        bossPatternIndex: 0,
      };
    }
    if (type === 'boss_warden' || type === 'boss_archon') {
      const isArchon = type === 'boss_archon';
      const maxHp = Math.round((isArchon ? 680 : 600) * scale);
      return {
        id,
        type,
        name: isArchon ? 'Arconte del Eclipse' : 'Alcaide Osario, Guardián de Hierro',
        isBoss: true,
        x,
        y,
        facing: 0,
        hp: maxHp,
        maxHp,
        radius: isArchon ? 26 : 27,
        speed: isArchon ? 105 : 96,
        damage: Math.round((isArchon ? 30 : 28) * scale),
        xpValue: Math.round((isArchon ? 180 : 150) * scale),
        goldValue: Math.round((isArchon ? 75 : 60) * scale),
        state: 'idle',
        telegraph: null,
        roomId,
        attackCooldown: 1.1,
        stateTimer: 0,
        bleedTimer: 0,
        bleedDps: 0,
        slowTimer: 0,
        bossPatternIndex: 0,
      };
    }

    return {
      id,
      type: 'skeleton',
      name: 'Esqueleto Errante',
      isBoss: false,
      x,
      y,
      facing: 0,
      hp: Math.round(64 * scale),
      maxHp: Math.round(64 * scale),
      radius: 14,
      speed: 118,
      damage: Math.round(14 * scale),
      xpValue: Math.round(24 * scale),
      goldValue: Math.round(6 * scale),
      state: 'idle',
      telegraph: null,
      roomId,
      attackCooldown: 0.4,
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
    const rng = createRng(seed ^ 0x9e3779b9);
    const f = floor.floorNumber;
    const ts = floor.tileSize;
    const scale = (1 + (f - 1) * 0.36) * (1 + Math.max(0, playerCount - 1) * 0.35);
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
          result.push(this.makeEnemy(type, ex, ey, scale, room.id));
        }
      } else if (room.type === 'boss') {
        const bossType: EnemyType = f % 2 === 1 ? 'boss_warden' : 'boss_archon';
        result.push(
          this.makeEnemy(
            bossType,
            (room.cx + 0.5) * ts,
            (room.cy + 0.5) * ts,
            scale,
            room.id
          )
        );
      }
    }
    return result;
  }

  private stepRoom(room: ServerRoom, dt: number) {
    const alivePlayers = Array.from(room.players.values()).filter((p) => p.alive);
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
      const aggroRange = e.isBoss ? 520 : 360;

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
        if (dist > 78) nudgeEnemy(room.floor, e, (dx / dist) * spd * dt, (dy / dist) * spd * dt);
        if (e.attackCooldown <= 0) {
          e.bossPatternIndex = (e.bossPatternIndex + 1) % 3;
          e.state = 'windup';
          e.attackCooldown = e.type === 'boss_archon' ? 1.85 : 2.1;
          if (e.bossPatternIndex === 0 && dist < 135) {
            e.telegraph = {
              type: 'arc',
              timer: 0.72,
              duration: 0.72,
              angle: e.facing,
              range: 120,
              radius: Math.PI * 0.9,
              damage: Math.round(e.damage * 1.15),
              targetX: target.x,
              targetY: target.y,
            };
          } else if (e.bossPatternIndex === 1) {
            e.telegraph = {
              type: 'nova',
              timer: 0.85,
              duration: 0.85,
              angle: e.facing,
              range: 240,
              radius: 115,
              damage: e.damage,
              targetX: e.x,
              targetY: e.y,
            };
          } else {
            e.telegraph = {
              type: 'circle',
              timer: 0.8,
              duration: 0.8,
              angle: e.facing,
              range: 0,
              radius: 95,
              damage: Math.round(e.damage * 1.1),
              targetX: target.x,
              targetY: target.y,
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
  }
}
