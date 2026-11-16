import type { VersionCheckResult } from '../shared/protocol.ts';
import type {
  ActiveSkillId,
  ArchetypeId,
  BlessingId,
  EnemyTelegraph,
  EnemyType,
  EquippedCosmetics,
  GroundLoot,
  ItemData,
  PropKind,
  PvpMatchPhase,
  PvpOrbEntity,
  PvpTierId,
  SkillSlotKey,
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
  connected?: boolean;
  cosmetics?: EquippedCosmetics;
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
  runSeedLabel?: string;
}

export interface PvpRoomSummary {
  code: string;
  hostName: string;
  hostElo: number;
  hostTierName: string;
  playerCount: number;
  maxPlayers: 2;
  phase: PvpMatchPhase;
  isRanked: boolean;
}

export interface PvpLeaderboardEntry {
  playerKey: string;
  name: string;
  elo: number;
  tierId: PvpTierId;
  tierName: string;
  tierColor: string;
  wins: number;
  losses: number;
  winStreak: number;
  bestStreak: number;
  favoriteArchetype: ArchetypeId;
  unlockedTitles: string[];
  updatedAtIso: string;
}

export interface PvpMatchHistoryEntry {
  id: string;
  timestampIso: string;
  winnerKey: string;
  winnerName: string;
  winnerArchetype: ArchetypeId;
  loserKey: string;
  loserName: string;
  loserArchetype: ArchetypeId;
  score: string;
  winnerEloAfter: number;
  loserEloAfter: number;
  eloDelta: number;
}

export interface PvpFighterSync {
  id: string;
  playerKey: string;
  name: string;
  archetype: ArchetypeId;
  classTitle: string;
  x: number;
  y: number;
  facing: number;
  hp: number;
  maxHp: number;
  shield: number;
  weaponKind: WeaponKind;
  alive: boolean;
  ready: boolean;
  roundsWon: number;
  flaskCharges: number;
  maxFlaskCharges: number;
  elo: number;
  tierName: string;
  color: string;
  connected: boolean;
  cosmetics?: EquippedCosmetics;
}

export interface PvpRoomSyncState {
  roomCode: string;
  phase: PvpMatchPhase;
  roundNumber: number;
  bestOf: 3;
  phaseTimer: number;
  ringRadius: number;
  ringMaxRadius: number;
  ringCenterX: number;
  ringCenterY: number;
  orbs: PvpOrbEntity[];
  winnerId: string | null;
  winnerName: string | null;
  fighters: PvpFighterSync[];
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

export interface CoopHeroBuildState {
  archetype: ArchetypeId;
  level: number;
  unlockedNodeIds: string[];
  unlockedSkills: ActiveSkillId[];
  equippedSlots: Record<SkillSlotKey, ActiveSkillId | null>;
  equippedWeapon: ItemData;
  equippedRelic: ItemData | null;
  inventory: ItemData[];
  blessings: Record<BlessingId, number>;
}

export interface CoopAuthoritativeHeroState {
  archetype: ArchetypeId;
  classTitle: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  shield: number;
  level: number;
  xp: number;
  xpToNext: number;
  skillPoints: number;
  gold: number;
  souls: number;
  kills: number;
  flaskCharges: number;
  maxFlaskCharges: number;
  alive: boolean;
  unlockedNodeIds: string[];
  unlockedSkills: ActiveSkillId[];
  equippedSlots: Record<SkillSlotKey, ActiveSkillId | null>;
  equippedWeapon: ItemData;
  equippedRelic: ItemData | null;
  inventory: ItemData[];
  blessings: Record<BlessingId, number>;
}

export type CoopErrorCode =
  | 'VERSION_MISMATCH'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'SESSION_EXPIRED'
  | 'INVALID_ACTION';

export type CoopClientMessage =
  | { type: 'client:hello'; version: string }
  | { type: 'net:ping'; clientTs: number }
  | { type: 'room:list' }
  | {
      type: 'room:create';
      version?: string;
      playerName: string;
      archetype: ArchetypeId;
      weaponKind: WeaponKind;
      classTitle: string;
      maxHp: number;
      isPublic: boolean;
      runSeed?: number;
      runSeedLabel?: string;
      buildState?: CoopHeroBuildState;
    }
  | {
      type: 'room:join';
      version?: string;
      code: string;
      playerName: string;
      archetype: ArchetypeId;
      weaponKind: WeaponKind;
      classTitle: string;
      maxHp: number;
      buildState?: CoopHeroBuildState;
    }
  | {
      type: 'room:reconnect';
      version?: string;
      roomCode: string;
      sessionToken: string;
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
      cosmetics?: EquippedCosmetics;
    }
  | {
      type: 'player:build';
      buildState: CoopHeroBuildState;
    }
  | { type: 'player:action'; action: CoopActionPayload }
  | {
      type: 'player:hurt';
      rawDamage: number;
      enemyId?: string;
    }
  | {
      type: 'player:flask';
    }
  | {
      type: 'player:skill';
      skillId: ActiveSkillId;
      hitsCount?: number;
    }
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
      skillId?: ActiveSkillId | 'basic' | 'dash_decoy';
    }
  | { type: 'loot:pickup'; lootId: string }
  | { type: 'prop:interact'; propId: string }
  | { type: 'prop:break'; propId: string }
  | { type: 'player:revive'; targetPlayerId: string }
  | { type: 'floor:descend' }
  | { type: 'chat:send'; text: string }
  | { type: 'pvp:list' }
  | {
      type: 'pvp:create';
      version?: string;
      playerKey: string;
      playerName: string;
      archetype: ArchetypeId;
      isPublic: boolean;
      cosmetics?: EquippedCosmetics;
    }
  | {
      type: 'pvp:join';
      version?: string;
      code: string;
      playerKey: string;
      playerName: string;
      archetype: ArchetypeId;
      cosmetics?: EquippedCosmetics;
    }
  | { type: 'pvp:ready'; ready?: boolean }
  | {
      type: 'pvp:hit';
      targetId: string;
      damage: number;
      isCrit: boolean;
      color: string;
      knockX: number;
      knockY: number;
      skillId?: ActiveSkillId | 'basic' | 'dash_decoy';
    }
  | { type: 'pvp:flask' }
  | { type: 'pvp:skill'; skillId: ActiveSkillId }
  | { type: 'pvp:orb_pickup'; orbId: string }
  | { type: 'pvp:rematch' };

export type CoopServerMessage =
  | {
      type: 'server:hello';
      serverVersion: string;
      compatibility: VersionCheckResult;
    }
  | {
      type: 'net:pong';
      clientTs: number;
      serverTs: number;
    }
  | { type: 'room:list'; rooms: CoopRoomSummary[] }
  | {
      type: 'room:joined';
      roomCode: string;
      playerId: string;
      sessionToken: string;
      runSeed: number;
      runSeedLabel: string;
      floorNumber: number;
      floorSeed: number;
      serverVersion: string;
      compatibility: VersionCheckResult;
      players: CoopPlayerSync[];
      enemies: CoopEnemySync[];
      groundLoot: GroundLoot[];
      interactedPropIds: string[];
      brokenPropIds: string[];
      portalOpen: boolean;
    }
  | {
      type: 'room:reconnected';
      roomCode: string;
      playerId: string;
      sessionToken: string;
      runSeed: number;
      runSeedLabel: string;
      floorNumber: number;
      floorSeed: number;
      serverVersion: string;
      compatibility: VersionCheckResult;
      heroState: CoopAuthoritativeHeroState;
      players: CoopPlayerSync[];
      enemies: CoopEnemySync[];
      groundLoot: GroundLoot[];
      interactedPropIds: string[];
      brokenPropIds: string[];
      portalOpen: boolean;
      mode?: 'coop' | 'pvp';
      pvpState?: PvpRoomSyncState;
    }
  | { type: 'room:error'; message: string; code?: CoopErrorCode }
  | {
      type: 'world:tick';
      players: CoopPlayerSync[];
      enemies: CoopEnemySync[];
    }
  | {
      type: 'hero:stats';
      hp: number;
      maxHp: number;
      shield: number;
      level: number;
      xp: number;
      xpToNext: number;
      skillPoints: number;
      gold: number;
      souls: number;
      kills: number;
      flaskCharges: number;
      maxFlaskCharges: number;
      alive: boolean;
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
      type: 'loot:spawned';
      items: GroundLoot[];
    }
  | {
      type: 'loot:collected';
      lootId: string;
      collectorId: string;
      collectorName: string;
      kind: GroundLoot['kind'];
      amount?: number;
      item?: ItemData;
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
      groundLoot: GroundLoot[];
      actorName: string;
    }
  | { type: 'chat:message'; message: CoopChatMessage }
  | { type: 'pvp:list'; rooms: PvpRoomSummary[] }
  | {
      type: 'pvp:joined';
      roomCode: string;
      playerId: string;
      sessionToken: string;
      serverVersion: string;
      compatibility: VersionCheckResult;
      state: PvpRoomSyncState;
    }
  | { type: 'pvp:state'; state: PvpRoomSyncState }
  | {
      type: 'pvp:damaged';
      targetId: string;
      attackerId: string;
      hp: number;
      shield: number;
      damage: number;
      isCrit: boolean;
      color: string;
      knockX: number;
      knockY: number;
    }
  | {
      type: 'pvp:round_end';
      roundNumber: number;
      roundWinnerId: string;
      roundWinnerName: string;
      fighters: PvpFighterSync[];
    }
  | {
      type: 'pvp:match_end';
      winnerId: string;
      winnerName: string;
      loserId: string;
      loserName: string;
      p1Rounds: number;
      p2Rounds: number;
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
    };
