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
  orbCount?: number;
  orbSpeed?: number;
  enraged?: boolean;
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
  enraged?: boolean;
  floorNumber?: number;
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

export type CosmeticCategory = 'skin' | 'aura' | 'trail' | 'pet';

export interface CosmeticItemDef {
  id: string;
  category: CosmeticCategory;
  name: string;
  description: string;
  cost: number;
  rarity: Rarity;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  styleTag?: string;
}

export interface EquippedCosmetics {
  skin: string;
  aura: string;
  trail: string;
  pet: string;
}

export interface BestiaryEnemyLore {
  type: EnemyType;
  title: string;
  faction: string;
  dangerRank: 'Común' | 'Élite' | 'Jefe';
  accentColor: string;
  lore: string;
  abilities: string[];
  weakness: string;
}

export type AchievementCategory = 'combat' | 'exploration' | 'mastery' | 'collection';

export interface AchievementStats {
  totalKills: number;
  bossWardenKills: number;
  bossArchonKills: number;
  bestFloor: number;
  maxLevelReached: number;
  hybridClassesForged: number;
  relicRarityObtained: number;
  interactionsCount: number;
  bestiaryDiscovered: number;
  cosmeticsUnlocked: number;
  coopRunsPlayed: number;
  blessingsBought: number;
  pvpMatchesPlayed: number;
  pvpWins: number;
  pvpPeakElo: number;
}

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  category: AchievementCategory;
  statKey: keyof AchievementStats;
  target: number;
  rewardSouls: number;
  accentColor: string;
}

export type PvpTierId = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';
export type PvpMode = 'online' | 'local';
export type PvpMatchPhase = 'waiting' | 'countdown' | 'fighting' | 'round_end' | 'match_end';

export interface PvpOrbEntity {
  id: string;
  x: number;
  y: number;
  kind: 'heal' | 'mana';
  amount: number;
}

export interface PvpMatchResult {
  mode: PvpMode;
  won: boolean;
  winnerName: string;
  loserName: string;
  p1Rounds: number;
  p2Rounds: number;
  eloBefore: number;
  eloAfter: number;
  eloDelta: number;
  tierName: string;
  unlockedTitle: string | null;
  soulsReward: number;
}

export interface PvpFighterHud {
  id: string;
  name: string;
  archetype: ArchetypeId;
  classTitle: string;
  hp: number;
  maxHp: number;
  shield: number;
  roundsWon: number;
  ready: boolean;
  elo?: number;
  tierName?: string;
  color: string;
  connected?: boolean;
}

export interface PvpHudState {
  mode: PvpMode;
  roomCode?: string;
  phase: PvpMatchPhase;
  roundNumber: number;
  bestOf: 3;
  phaseTimer: number;
  ringRadius: number;
  ringMaxRadius: number;
  ringCenterX: number;
  ringCenterY: number;
  canAct: boolean;
  winnerId: string | null;
  winnerName: string | null;
  matchResult?: PvpMatchResult | null;
  fighters: PvpFighterHud[];
  localFighterId: string;
}

export interface AdminFlags {
  godMode: boolean;
  infiniteMana: boolean;
  zeroCooldowns: boolean;
  oneHitKill: boolean;
  revealMinimap: boolean;
  freezeEnemies: boolean;
  autoLoot: boolean;
  showHitboxes: boolean;
  speedMultiplier: number;
  damageMultiplier: number;
}

export interface AdminDiagnosticsSnapshot {
  inRun: boolean;
  modeLabel: string;
  floorNumber: number;
  floorName: string;
  runSeedLabel: string;
  px: number;
  py: number;
  tileX: number;
  tileY: number;
  enemiesAlive: number;
  projectilesActive: number;
  lootOnGround: number;
  roomsTotal: number;
  roomsDiscovered: number;
  heroLevel: number;
  heroHp: number;
  heroMaxHp: number;
  heroBaseDamage: number;
  heroArcanePower: number;
  heroArmor: number;
  heroCritChance: number;
  heroMoveSpeed: number;
  heroKills: number;
  heroGold: number;
  inventoryCount: number;
}

export interface MetaSaveData {
  soulShards: number;
  blessings: Record<BlessingId, number>;
  bestFloor: number;
  totalKills: number;
  unlockedClassTitles: string[];
  recentRuns: RunRecord[];
  muted: boolean;
  unlockedCosmetics: string[];
  equippedCosmetics: EquippedCosmetics;
  discoveredEnemies: EnemyType[];
  bestiaryKills: Partial<Record<EnemyType, number>>;
  unlockedAchievements: string[];
  achievementStats: AchievementStats;
  pvpElo: number;
  pvpWins: number;
  pvpLosses: number;
  pvpWinStreak: number;
  pvpBestStreak: number;
  pvpUnlockedTitles: string[];
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
    floorTier?: number;
    enraged?: boolean;
    difficultyLabel?: string;
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
    runSeedLabel?: string;
    allies: CoopPlayerSync[];
    isDowned: boolean;
  } | null;
  pvp?: PvpHudState | null;
  runSeed?: number;
  runSeedLabel?: string;
  localP2: LocalCoopPlayerHud | null;
  localCoopControlMode?: LocalCoopControlMode;
  adminFlags?: AdminFlags;
  equippedCosmetics?: EquippedCosmetics;
}

export type SaveSlotId = 'slot1' | 'slot2' | 'slot3';

export interface SavedHeroState {
  archetype: ArchetypeId;
  x: number;
  y: number;
  facing: number;
  level: number;
  xp: number;
  xpToNext: number;
  skillPoints: number;
  hp: number;
  mana: number;
  shield: number;
  flaskCharges: number;
  maxFlaskCharges: number;
  unlockedNodeIds: string[];
  unlockedSkills: ActiveSkillId[];
  equippedSlots: Record<SkillSlotKey, ActiveSkillId | null>;
  equippedWeapon: ItemData;
  equippedRelic: ItemData | null;
  inventory: ItemData[];
  isDowned: boolean;
}

export interface SerializedDungeonFloor {
  floorNumber: number;
  name: string;
  width: number;
  height: number;
  tileSize: number;
  tilesB64: string;
  visibilityB64: string;
  wallDecorB64: string;
  rooms: DungeonRoom[];
  props: DungeonProp[];
  spawnX: number;
  spawnY: number;
  bossRoomId: number;
}

export interface ActiveRunSave {
  version: 2;
  savedAtIso: string;
  runSeed?: number;
  runSeedLabel?: string;
  localCoopMode: boolean;
  localCoopControlMode: LocalCoopControlMode;
  floor: SerializedDungeonFloor;
  p1: SavedHeroState;
  p2: SavedHeroState | null;
  gold: number;
  soulsThisRun: number;
  kills: number;
  enemies: EnemyEntity[];
  loot: GroundLoot[];
  idCounter: number;
}

export interface SaveProfileData {
  id: SaveSlotId;
  name: string;
  updatedAtIso: string;
  meta: MetaSaveData;
  activeRun: ActiveRunSave | null;
}

export interface SaveSlotSummary {
  id: SaveSlotId;
  name: string;
  updatedAtIso: string;
  soulShards: number;
  bestFloor: number;
  totalKills: number;
  blessingsTotal: number;
  hasActiveRun: boolean;
  activeRunSummary: {
    floorNumber: number;
    floorName: string;
    p1ClassTitle: string;
    p1Level: number;
    localCoopMode: boolean;
    kills: number;
    savedAtIso: string;
  } | null;
}

