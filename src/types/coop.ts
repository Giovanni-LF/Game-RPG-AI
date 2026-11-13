import type {
  ArchetypeId,
  EnemyTelegraph,
  EnemyType,
  PropKind,
  WeaponKind,
} from './game.ts';

export interface CoopPlayerSync {
  id: string;
  name: string;
  archetype: ArchetypeId;
  classTitle: string;
  level: number;
  x: number;
  y: number;
  facing: number;
  hp: number;
  maxHp: number;
  shield: number;
  weaponKind: WeaponKind;
  alive: boolean;
  isHost: boolean;
  color: string;
}

export interface CoopEnemySync {
  id: string;
  type: EnemyType;
  name: string;
  isBoss: boolean;
  x: number;
  y: number;
  facing: number;
  hp: number;
  maxHp: number;
  radius: number;
  speed: number;
  damage: number;
  xpValue: number;
  goldValue: number;
  state: 'idle' | 'chase' | 'windup' | 'recover';
  telegraph: EnemyTelegraph | null;
  roomId: number;
}

export interface CoopRoomSummary {
  code: string;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
  floorNumber: number;
}

export interface CoopActionPayload {
  kind: 'slash' | 'ring' | 'dash' | 'projectile';
  x: number;
  y: number;
  angle?: number;
  arc?: number;
  radius?: number;
  color: string;
  isSpin?: boolean;
  vx?: number;
  vy?: number;
  projKind?: 'bolt' | 'dagger' | 'lance';
}

export interface CoopChatMessage {
  id: string;
  senderName: string;
  senderColor: string;
  text: string;
  ts: number;
}

export type CoopClientMessage =
  | { type: 'room:list' }
  | {
      type: 'room:create';
      playerName: string;
      archetype: ArchetypeId;
      weaponKind: WeaponKind;
      classTitle: string;
      maxHp: number;
      isPublic: boolean;
    }
  | {
      type: 'room:join';
      code: string;
      playerName: string;
      archetype: ArchetypeId;
      weaponKind: WeaponKind;
      classTitle: string;
      maxHp: number;
    }
  | { type: 'room:leave' }
  | {
      type: 'player:state';
      x: number;
      y: number;
      facing: number;
      hp: number;
      maxHp: number;
      shield: number;
      level: number;
      classTitle: string;
      weaponKind: WeaponKind;
      alive: boolean;
    }
  | { type: 'player:action'; action: CoopActionPayload }
  | {
      type: 'combat:hit';
      enemyId: string;
      damage: number;
      isCrit: boolean;
      color: string;
      knockX: number;
      knockY: number;
      bleedDps?: number;
      slow?: boolean;
    }
  | { type: 'prop:interact'; propId: string }
  | { type: 'prop:break'; propId: string }
  | { type: 'player:revive'; targetPlayerId: string }
  | { type: 'floor:descend' }
  | { type: 'chat:send'; text: string };

export type CoopServerMessage =
  | { type: 'room:list'; rooms: CoopRoomSummary[] }
  | {
      type: 'room:joined';
      roomCode: string;
      playerId: string;
      floorNumber: number;
      floorSeed: number;
      players: CoopPlayerSync[];
      enemies: CoopEnemySync[];
      interactedPropIds: string[];
      brokenPropIds: string[];
      portalOpen: boolean;
    }
  | { type: 'room:error'; message: string }
  | {
      type: 'world:tick';
      players: CoopPlayerSync[];
      enemies: CoopEnemySync[];
    }
  | { type: 'player:joined'; player: CoopPlayerSync }
  | { type: 'player:left'; playerId: string; newHostId: string | null }
  | { type: 'player:action'; playerId: string; action: CoopActionPayload }
  | {
      type: 'enemy:damaged';
      enemyId: string;
      hp: number;
      damage: number;
      isCrit: boolean;
      color: string;
      attackerId: string;
    }
  | {
      type: 'enemy:killed';
      enemyId: string;
      killerId: string;
      xpValue: number;
      goldValue: number;
      isBoss: boolean;
      x: number;
      y: number;
      roomId: number;
    }
  | {
      type: 'enemy:attack';
      enemyId: string;
      telegraph: EnemyTelegraph;
    }
  | {
      type: 'prop:updated';
      propId: string;
      kind: PropKind;
      actorName: string;
      shrineVariant?: 'blood' | 'arcane' | 'sanctum';
    }
  | { type: 'prop:broken'; propId: string }
  | { type: 'player:revived'; targetPlayerId: string; reviverName: string }
  | {
      type: 'floor:changed';
      floorNumber: number;
      floorSeed: number;
      enemies: CoopEnemySync[];
      actorName: string;
    }
  | { type: 'chat:message'; message: CoopChatMessage };
