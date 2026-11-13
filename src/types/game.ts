import type { CoopPlayerSync } from './coop.ts';

export type GameScreen = 'TITLE' | 'PLAYING' | 'PAUSED' | 'VICTORY' | 'GAME_OVER';

export type ArchetypeId = 'crusader' | 'stalker' | 'occultist';

export type BranchId = 'steel' | 'shadow' | 'arcane';

export type ActiveSkillId =
  | 'whirlwind'
  | 'aegis'
  | 'shadow_step'
  | 'dagger_fan'
  | 'abyss_lance'
  | 'eclipse_nova';

export type SkillSlotKey = 'Q' | 'E' | 'R';

export type Rarity = 'common' | 'rare' | 'epic' | 'relic';

export type WeaponKind = 'greatsword' | 'daggers' | 'staff' | 'halberd' | 'scythe';

export type ItemSlot = 'weapon' | 'relic';

export interface ItemStats {
  damageBonus?: number;
  arcaneBonus?: number;
  maxHpBonus?: number;
  maxManaBonus?: number;
  armorBonus?: number;
  critChanceBonus?: number; // 0.05 = +5%
  critMultBonus?: number;
  attackSpeedBonus?: number; // 0.15 = +15%
  moveSpeedBonus?: number; // flat px/s
  lifestealBonus?: number; // 0.04 = 4%
  cooldownReduction?: number; // 0.08 = 8%
}

export interface ItemData {
  id: string;
  name: string;
  slot: ItemSlot;
  weaponKind?: WeaponKind;
  rarity: Rarity;
  level: number;
  description: string;
  stats: ItemStats;
  valueGold: number;
}

export interface ArchetypeDef {
  id: ArchetypeId;
  name: string;
  subtitle: string;
  description: string;
  primaryBranch: BranchId;
  accentColor: string;
  startingNodeId: string;
  startingSkills: [ActiveSkillId, ActiveSkillId | null, ActiveSkillId | null];
  startingWeapon: ItemData;
  baseStats: {
    maxHp: number;
    maxMana: number;
    armor: number;
    moveSpeed: number;
    baseDamage: number;
    arcanePower: number;
    attackSpeed: number;
    critChance: number;
    critMultiplier: number;
  };
}

export interface ActiveSkillDef {
  id: ActiveSkillId;
  name: string;
  branch: BranchId;
  manaCost: number;
  cooldown: number; // seconds
  description: string;
  color: string;
}

export interface SkillTreeNode {
  id: string;
  name: string;
  branch: BranchId | 'origin' | 'hybrid';
  tier: 0 | 1 | 2 | 3 | 4;
  x: number; // 0..800 SVG space
  y: number; // 0..600 SVG space
  requires: string[]; // at least one parent unlocked (or origin)
  description: string;
  unlocksSkill?: ActiveSkillId;
  statBonuses: ItemStats & {
    dashLeavesShadow?: boolean;
    critChainArcane?: boolean;
    bleedOnHit?: boolean;
    manaShieldRatio?: number;
    killHeal?: number;
  };
}

export interface ComputedStats {
  maxHp: number;
  maxMana: number;
  armor: number; // % damage reduction cap ~60%
  moveSpeed: number;
  baseDamage: number;
  arcanePower: number;
  attackSpeed: number;
  critChance: number;
  critMultiplier: number;
  lifesteal: number;
  cooldownReduction: number;
  dashCooldown: number;
  flaskHealPct: number;
  manaRegen: number;
  dashLeavesShadow: boolean;
  critChainArcane: boolean;
  bleedOnHit: boolean;
  manaShieldRatio: number;
  killHeal: number;
}

export type TileType = 0 | 1 | 2; // 0 = void/wall, 1 = crypt floor, 2 = hallway/pillar border floor

export type RoomType = 'start' | 'combat' | 'treasure' | 'shrine' | 'boss';

export interface DungeonRoom {
  id: number;
  x: number; // tile coords
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  type: RoomType;
  cleared: boolean;
  discovered: boolean;
}

export type PropKind = 'urn' | 'chest' | 'shrine' | 'brazier' | 'portal' | 'trap';

export interface DungeonProp {
  id: string;
  kind: PropKind;
  x: number; // world px
  y: number;
  radius: number;
  interacted: boolean;
  broken: boolean;
  shrineVariant?: 'blood' | 'arcane' | 'sanctum';
  trapTimer?: number;
  trapState?: 'idle' | 'arming' | 'active';
}

export interface DungeonFloor {
  floorNumber: number;
  name: string;
  width: number; // tiles
  height: number; // tiles
  tileSize: number;
  tiles: Uint8Array; // TileType
  visibility: Uint8Array; // 0 unseen, 1 explored, 2 lit
  wallDecor: Uint8Array; // deterministic crack/brick variation
  rooms: DungeonRoom[];
  props: DungeonProp[];
  spawnX: number;
  spawnY: number;
  bossRoomId: number;
}

export type EnemyType =
  | 'skeleton'
  | 'cultist'
  | 'golem'
  | 'wraith'
  | 'boss_warden'
  | 'boss_archon';

export type TelegraphType = 'arc' | 'line' | 'circle' | 'nova';

export interface EnemyTelegraph {
  type: TelegraphType;
  timer: number;
  duration: number;
  angle: number;
  range: number;
  radius: number;
  damage: number;
  targetX: number;
  targetY: number;
}

export interface EnemyEntity {
  id: string;
  type: EnemyType;
  name: string;
  isBoss: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hp: number;
  maxHp: number;
  speed: number;
  damage: number;
  xpValue: number;
  goldValue: number;
  facing: number;
  state: 'idle' | 'chase' | 'windup' | 'recover';
  stateTimer: number;
  attackCooldown: number;
  hitFlash: number;
  bleedTimer: number;
  bleedDps: number;
  slowTimer: number;
  squashX: number;
  squashY: number;
  telegraph: EnemyTelegraph | null;
  bossPatternIndex: number;
  roomId: number;
}

export interface GroundLoot {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: 'gold' | 'soul' | 'hp_orb' | 'item';
  amount?: number;
  item?: ItemData;
  bobPhase: number;
}

export type BlessingId = 'vitality' | 'might' | 'alacrity' | 'fortune' | 'flask';

export interface EternalBlessingDef {
  id: BlessingId;
  name: string;
  description: string;
  maxLevel: number;
  baseCost: number;
  costStep: number;
  bonusPerLevelLabel: string;
}

export interface RunRecord {
  id: string;
  dateIso: string;
  archetype: ArchetypeId;
  classTitle: string;
  floorReached: number;
  kills: number;
  soulsEarned: number;
  victory: boolean;
}

export interface MetaSaveData {
  soulShards: number;
  blessings: Record<BlessingId, number>;
  bestFloor: number;
  totalKills: number;
  unlockedClassTitles: string[];
  recentRuns: RunRecord[];
  muted: boolean;
}

export type LocalCoopControlMode = 'auto' | 'keyboard_split' | 'dual_touch';

export interface LocalCoopPlayerHud {
  archetype: ArchetypeId;
  classTitle: string;
  level: number;
  xp: number;
  xpToNext: number;
  skillPoints: number;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  shield: number;
  flaskCharges: number;
  maxFlaskCharges: number;
  dashCooldownRemaining: number;
  dashCooldownMax: number;
  equippedSlots: Record<SkillSlotKey, ActiveSkillId | null>;
  skillCooldowns: Record<SkillSlotKey, number>;
  skillMaxCooldowns: Record<SkillSlotKey, number>;
  unlockedSkills: ActiveSkillId[];
  unlockedNodeIds: string[];
  equippedWeapon: ItemData;
  equippedRelic: ItemData | null;
  inventory: ItemData[];
  computedStats: ComputedStats;
  isDowned: boolean;
  nearbyPrompt: string | null;
  tileX: number;
  tileY: number;
}

export interface HudSnapshot {
  screen: GameScreen;
  floorNumber: number;
  floorName: string;
  archetype: ArchetypeId;
  classTitle: string;
  level: number;
  xp: number;
  xpToNext: number;
  skillPoints: number;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  shield: number;
  gold: number;
  soulsThisRun: number;
  kills: number;
  flaskCharges: number;
  maxFlaskCharges: number;
  dashCooldownRemaining: number;
  dashCooldownMax: number;
  equippedSlots: Record<SkillSlotKey, ActiveSkillId | null>;
  skillCooldowns: Record<SkillSlotKey, number>;
  skillMaxCooldowns: Record<SkillSlotKey, number>;
  unlockedSkills: ActiveSkillId[];
  unlockedNodeIds: string[];
  equippedWeapon: ItemData;
  equippedRelic: ItemData | null;
  inventory: ItemData[];
  computedStats: ComputedStats;
  boss: {
    name: string;
    hp: number;
    maxHp: number;
  } | null;
  nearbyPrompt: string | null;
  levelUpToastTimer: number;
  bannerMessage: string | null;
  minimap: {
    width: number;
    height: number;
    playerTileX: number;
    playerTileY: number;
    rooms: Array<{
      x: number;
      y: number;
      w: number;
      h: number;
      type: RoomType;
      discovered: boolean;
      cleared: boolean;
    }>;
    props: Array<{
      tx: number;
      ty: number;
      kind: PropKind;
      done: boolean;
    }>;
  };
  coop: {
    roomCode: string;
    localPlayerId: string;
    allies: CoopPlayerSync[];
    isDowned: boolean;
  } | null;
  localP2: LocalCoopPlayerHud | null;
  localCoopControlMode?: LocalCoopControlMode;
}
