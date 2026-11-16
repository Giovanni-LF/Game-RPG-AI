import { sfx } from '../audio/sfx';
import {
  ACTIVE_SKILLS,
  ARCHETYPES,
  computeHybridClassTitle,
  computePlayerStats,
  ENEMY_DEFINITIONS,
  ENEMY_SCALING,
  RARITY_COLORS,
  SKILL_TREE_NODES,
  generateLootItem,
  getBossDisplayName,
  getBossFloorMultipliers,
} from '../data/gameData';
import { coopClient } from '../net/coopClient';
import {
  createSeededRng,
  deriveFloorSeed,
  generateRandomRunSeed,
  normalizeSeedInput,
} from '../shared/protocol';
import {
  PVP_ARENA_CENTER,
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
  computePvpHeroStats,
  generatePvpArenaFloor,
  getPvpStartingWeapon,
} from '../shared/pvp';
import type {
  CoopActionPayload,
  CoopEnemySync,
  CoopPlayerSync,
  CoopServerMessage,
  PvpFighterSync,
  PvpRoomSyncState,
} from '../types/coop';
import { type AchievementStatUpdate, base64ToUint8, uint8ToBase64 } from '../storage/persistence';
import {
  ActiveRunSave,
  ActiveSkillId,
  AdminDiagnosticsSnapshot,
  AdminFlags,
  ArchetypeId,
  ComputedStats,
  DungeonFloor,
  DungeonProp,
  EnemyEntity,
  EnemyType,
  GameScreen,
  GroundLoot,
  HudSnapshot,
  ItemData,
  LocalCoopControlMode,
  LocalCoopPlayerHud,
  MetaSaveData,
  PvpFighterHud,
  PvpMatchPhase,
  PvpMatchResult,
  PvpMode,
  PvpOrbEntity,
  Rarity,
  RunRecord,
  SavedHeroState,
  SerializedDungeonFloor,
  SkillSlotKey,
  WeaponKind,
} from '../types/game';
import { generateDungeonFloor, isWalkableTile } from './dungeonGenerator';
import { drawEnemySprite, drawHeroSprite, resolveTrailColor } from './entityRenderer';

interface Projectile {
  active: boolean;
  fromPlayer: boolean;
  ownerNum?: 1 | 2;
  visualOnly?: boolean;
  skillId?: ActiveSkillId | 'basic';
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  isCrit: boolean;
  color: string;
  life: number;
  maxLife: number;
  pierce: number;
  hitIds: Set<string>;
  applyBleed: boolean;
  applySlow: boolean;
  kind: 'bolt' | 'dagger' | 'lance' | 'enemy_orb';
}

interface SlashArc {
  x: number;
  y: number;
  angle: number;
  arc: number;
  radius: number;
  color: string;
  life: number;
  maxLife: number;
  isSpin: boolean;
}

interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number;
  maxLife: number;
  drag: number;
}

interface FloatingText {
  active: boolean;
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  scale: number;
  life: number;
  maxLife: number;
}

interface DashGhost {
  x: number;
  y: number;
  facing: number;
  life: number;
  maxLife: number;
  color: string;
}

interface NovaRing {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  color: string;
  life: number;
  maxLife: number;
}

export interface EngineCallbacks {
  onHudUpdate: (snapshot: HudSnapshot) => void;
  onRunFinished: (record: RunRecord) => void;
  onSaveCheckpoint?: (snapshot: ActiveRunSave) => void;
  onClearCheckpoint?: () => void;
  onBestiaryEvent?: (enemyType: EnemyType, killed: boolean) => void;
  onAdminGrantSouls?: (amount: number) => void;
  onAchievementEvent?: (updates: AchievementStatUpdate) => void;
  onPvpMatchFinished?: (result: PvpMatchResult) => void;
}

type BufferedAction = {
  type: 'attack' | 'dash' | 'skill' | 'flask' | 'interact';
  slot?: SkillSlotKey;
  expires: number;
};

interface LocalPlayer2State {
  archetype: ArchetypeId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  squashX: number;
  squashY: number;
  hitFlash: number;
  invuln: number;
  dashTimer: number;
  dashDirX: number;
  dashDirY: number;
  dashCooldown: number;
  attackCooldown: number;
  comboStep: number;
  comboResetTimer: number;
  guaranteedCrit: boolean;
  level: number;
  xp: number;
  xpToNext: number;
  skillPoints: number;
  hp: number;
  mana: number;
  shield: number;
  shieldTimer: number;
  flaskCharges: number;
  maxFlaskCharges: number;
  unlockedNodeIds: string[];
  unlockedSkills: ActiveSkillId[];
  equippedSlots: Record<SkillSlotKey, ActiveSkillId | null>;
  skillCooldowns: Record<SkillSlotKey, number>;
  equippedWeapon: ItemData;
  equippedRelic: ItemData | null;
  inventory: ItemData[];
  stats: ComputedStats;
  isDowned: boolean;
  touchMoveX: number;
  touchMoveY: number;
  touchAttackHeld: boolean;
  bufferedAction: BufferedAction | null;
}

export class GameEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private callbacks: EngineCallbacks;

  private rafId = 0;
  private lastTime = 0;
  private destroyed = false;

  // Viewport & camera
  private viewW = 1280;
  private viewH = 720;
  private dpr = 1;
  private baseCamScale = 1;
  private camScale = 1;
  private camX = 0;
  private camY = 0;
  private shakeTime = 0;
  private shakeIntensity = 0;
  private hitstopTimer = 0;
  private worldTime = 0;

  // Input state
  private heldKeys = new Set<string>();
  private mouseScreenX = 0;
  private mouseScreenY = 0;
  private mouseDown = false;
  private touchMoveX = 0;
  private touchMoveY = 0;
  private touchAttackHeld = false;
  private lastInputType: 'mouse' | 'touch' | 'gamepad' = 'mouse';
  private bufferedAction: BufferedAction | null = null;
  private prevGamepadButtons = new Map<number, boolean[]>();

  // Run & player state
  private screen: GameScreen = 'TITLE';
  private meta: MetaSaveData;
  private archetype: ArchetypeId = 'crusader';
  private floor!: DungeonFloor;

  private px = 0;
  private py = 0;
  private pvx = 0;
  private pvy = 0;
  private pRadius = 15;
  private pFacing = 0;
  private pSquashX = 1;
  private pSquashY = 1;
  private pHitFlash = 0;
  private pInvuln = 0;
  private dashTimer = 0;
  private dashDirX = 1;
  private dashDirY = 0;
  private dashCooldown = 0;
  private attackCooldown = 0;
  private comboStep = 0;
  private comboResetTimer = 0;
  private guaranteedCrit = false;

  private level = 1;
  private xp = 0;
  private xpToNext = 80;
  private skillPoints = 0;
  private hp = 150;
  private mana = 65;
  private shield = 0;
  private shieldTimer = 0;
  private gold = 0;
  private soulsThisRun = 0;
  private kills = 0;
  private flaskCharges = 3;
  private maxFlaskCharges = 3;

  private unlockedNodeIds: string[] = [];
  private unlockedSkills: ActiveSkillId[] = [];
  private equippedSlots: Record<SkillSlotKey, ActiveSkillId | null> = { Q: null, E: null, R: null };
  private skillCooldowns: Record<SkillSlotKey, number> = { Q: 0, E: 0, R: 0 };
  private equippedWeapon!: ItemData;
  private equippedRelic: ItemData | null = null;
  private inventory: ItemData[] = [];
  private stats!: ComputedStats;

  private levelUpToastTimer = 0;
  private bannerMessage: string | null = null;
  private bannerTimer = 0;
  private hudEmitTimer = 0;
  private runReported = false;

  // Entities & pools
  private enemies: EnemyEntity[] = [];
  private loot: GroundLoot[] = [];
  private slashes: SlashArc[] = [];
  private ghosts: DashGhost[] = [];
  private rings: NovaRing[] = [];
  private projectiles: Projectile[] = [];
  private particles: Particle[] = [];
  private floatingTexts: FloatingText[] = [];
  private idCounter = 1;

  // Online cooperative multiplayer state
  private coopMode = false;
  private coopRoomCode: string | null = null;
  private coopPlayerId: string | null = null;
  private runSeed = 0;
  private runSeedLabel = '';
  private isDowned = false;
  private remotePlayers = new Map<string, CoopPlayerSync & { targetX: number; targetY: number }>();
  private enemyNetTargets = new Map<string, { x: number; y: number }>();
  private pendingLootPickups = new Map<string, number>();
  private currentHitSkillId: ActiveSkillId | 'basic' | 'dash_decoy' = 'basic';
  private coopSyncTimer = 0;

  // Offline local 2-player co-op state
  private localCoopMode = false;
  private localCoopControlMode: LocalCoopControlMode = 'auto';
  private p2: LocalPlayer2State | null = null;

  // Competitive PvP Arena state (online & local 2P)
  private pvpMode: PvpMode | null = null;
  private pvpPhase: PvpMatchPhase = 'waiting';
  private pvpRoundNumber = 1;
  private pvpPhaseTimer = 0;
  private pvpRingRadius = PVP_RING_MAX_RADIUS;
  private pvpOrbs: PvpOrbEntity[] = [];
  private pvpOrbSpawnTimer = 9;
  private pvpOrbSeq = 1;
  private pvpFighters: PvpFighterSync[] = [];
  private pvpLocalRoundsWon: [number, number] = [0, 0];
  private pvpRingTickAccum: [number, number] = [0, 0];
  private pvpWinnerId: string | null = null;
  private pvpWinnerName: string | null = null;
  private pvpMatchResult: PvpMatchResult | null = null;
  private pvpReported = false;
  private pvpPendingOrbPickups = new Map<string, number>();

  // Admin HUD state & visual atmosphere motes
  private adminFlags: AdminFlags = {
    godMode: false,
    infiniteMana: false,
    zeroCooldowns: false,
    oneHitKill: false,
    revealMinimap: false,
    freezeEnemies: false,
    autoLoot: false,
    showHitboxes: false,
    speedMultiplier: 1,
    damageMultiplier: 1,
  };
  private seenEnemyTypesThisSession = new Set<EnemyType>();
  private ambientMotes: Array<{
    dx: number;
    dy: number;
    vx: number;
    vy: number;
    size: number;
    alpha: number;
    hue: 'amber' | 'violet';
  }> = Array.from({ length: 34 }, (_, i) => ({
    dx: ((i * 197) % 900) - 450,
    dy: ((i * 313) % 620) - 310,
    vx: (((i % 7) - 3) * 4.5),
    vy: -6 - (i % 5) * 3.5,
    size: 1.2 + (i % 3) * 0.7,
    alpha: 0.14 + (i % 4) * 0.06,
    hue: i % 3 === 0 ? 'violet' : 'amber',
  }));

  constructor(canvas: HTMLCanvasElement, meta: MetaSaveData, callbacks: EngineCallbacks) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('No se pudo inicializar el contexto 2D del lienzo.');
    }
    this.ctx = context;
    this.meta = meta;
    this.callbacks = callbacks;

    // Pre-allocate object pools
    for (let i = 0; i < 80; i++) {
      this.projectiles.push({
        active: false,
        fromPlayer: true,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        radius: 6,
        damage: 0,
        isCrit: false,
        color: '#fff',
        life: 0,
        maxLife: 1,
        pierce: 0,
        hitIds: new Set(),
        applyBleed: false,
        applySlow: false,
        kind: 'bolt',
      });
    }
    for (let i = 0; i < 260; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        size: 3,
        color: '#fff',
        life: 0,
        maxLife: 0.4,
        drag: 4,
      });
    }
    for (let i = 0; i < 55; i++) {
      this.floatingTexts.push({
        active: false,
        x: 0,
        y: 0,
        vy: -36,
        text: '',
        color: '#fff',
        scale: 1,
        life: 0,
        maxLife: 0.75,
      });
    }

    const seedInit = generateRandomRunSeed();
    this.runSeed = seedInit.numeric;
    this.runSeedLabel = seedInit.label;

    this.equippedWeapon = structuredClone(ARCHETYPES[this.archetype].startingWeapon);
    this.recomputeStats();
    this.hp = this.stats.maxHp;
    this.mana = this.stats.maxMana;

    this.handleResize();
    this.bindEvents();
    this.initFloor(1, true);
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  updateMeta(meta: MetaSaveData) {
    this.meta = meta;
    if (this.screen === 'PLAYING' || this.screen === 'PAUSED') {
      this.recomputeStats();
      this.emitHud();
    }
  }

  startRun(archetypeId: ArchetypeId, seedInput?: string) {
    this.leaveCoopRoom();
    this.localCoopMode = false;
    this.pvpMode = null;
    this.p2 = null;
    this.camScale = this.baseCamScale;
    const chosenSeed = seedInput?.trim() ? normalizeSeedInput(seedInput) : generateRandomRunSeed();
    this.runSeed = chosenSeed.numeric;
    this.runSeedLabel = chosenSeed.label;
    this.resetRunState(archetypeId);
    this.screen = 'PLAYING';
    this.initFloor(1, false);
    this.showBanner(`Piso 1 · ${this.floor.name} · Semilla ${this.runSeedLabel}`);
    this.emitHud();
    this.triggerCheckpoint();
  }

  startLocalCoopRun(
    p1Arch: ArchetypeId,
    p2Arch: ArchetypeId,
    controlMode: LocalCoopControlMode = 'auto',
    seedInput?: string
  ) {
    this.leaveCoopRoom();
    this.localCoopMode = true;
    this.pvpMode = null;
    this.localCoopControlMode = controlMode;
    this.camScale = this.baseCamScale;
    const chosenSeed = seedInput?.trim() ? normalizeSeedInput(seedInput) : generateRandomRunSeed();
    this.runSeed = chosenSeed.numeric;
    this.runSeedLabel = chosenSeed.label;
    this.resetRunState(p1Arch);
    this.p2 = this.createLocalPlayer2State(p2Arch);
    this.screen = 'PLAYING';
    this.initFloor(1, false);
    this.callbacks.onAchievementEvent?.({ coopRunsPlayed: { mode: 'inc', value: 1 } });
    this.showBanner(`Cooperativo Local · Piso 1 · Semilla ${this.runSeedLabel}`);
    this.emitHud();
    this.triggerCheckpoint();
  }

  startLocalPvpRun(
    p1Arch: ArchetypeId,
    p2Arch: ArchetypeId,
    controlMode: LocalCoopControlMode = 'auto'
  ) {
    this.leaveCoopRoom();
    this.localCoopMode = true;
    this.localCoopControlMode = controlMode;
    this.pvpMode = 'local';
    this.pvpPhase = 'countdown';
    this.pvpRoundNumber = 1;
    this.pvpPhaseTimer = PVP_COUNTDOWN_SEC;
    this.pvpRingRadius = PVP_RING_MAX_RADIUS;
    this.pvpOrbs = [];
    this.pvpOrbSpawnTimer = 9;
    this.pvpFighters = [];
    this.pvpLocalRoundsWon = [0, 0];
    this.pvpRingTickAccum = [0, 0];
    this.pvpWinnerId = null;
    this.pvpWinnerName = null;
    this.pvpMatchResult = null;
    this.pvpReported = false;
    this.camScale = this.baseCamScale;

    this.resetPvpFighter1(p1Arch);
    this.p2 = this.createLocalPvpPlayer2State(p2Arch);

    this.floor = generatePvpArenaFloor();
    this.enemies = [];
    this.loot = [];
    this.slashes = [];
    this.ghosts = [];
    this.rings = [];
    for (const p of this.projectiles) p.active = false;

    this.px = PVP_SPAWN_P1.x;
    this.py = PVP_SPAWN_P1.y;
    this.pFacing = PVP_SPAWN_P1.facing;
    this.p2.x = PVP_SPAWN_P2.x;
    this.p2.y = PVP_SPAWN_P2.y;
    this.p2.facing = PVP_SPAWN_P2.facing;
    this.camX = PVP_ARENA_CENTER.x;
    this.camY = PVP_ARENA_CENTER.y;

    this.screen = 'PLAYING';
    this.showBanner('Arena de Duelo Local · Al mejor de 3 rondas');
    this.emitHud();
  }

  private resetPvpFighter1(archId: ArchetypeId) {
    this.resetRunState(archId);
    const loadout = PVP_LOADOUTS[archId] ?? PVP_LOADOUTS.crusader;
    this.level = 5;
    this.skillPoints = 0;
    this.unlockedNodeIds = [];
    this.unlockedSkills = [...loadout.skills];
    this.equippedSlots = { ...loadout.slots };
    this.equippedWeapon = getPvpStartingWeapon(archId);
    this.equippedRelic = null;
    this.stats = computePvpHeroStats(archId);
    this.hp = this.stats.maxHp;
    this.mana = this.stats.maxMana;
    this.shield = 0;
    this.shieldTimer = 0;
    this.flaskCharges = 2;
    this.maxFlaskCharges = 2;
  }

  private createLocalPvpPlayer2State(archId: ArchetypeId): LocalPlayer2State {
    const base = this.createLocalPlayer2State(archId);
    const loadout = PVP_LOADOUTS[archId] ?? PVP_LOADOUTS.stalker;
    base.level = 5;
    base.skillPoints = 0;
    base.unlockedNodeIds = [];
    base.unlockedSkills = [...loadout.skills];
    base.equippedSlots = { ...loadout.slots };
    base.equippedWeapon = getPvpStartingWeapon(archId);
    base.equippedRelic = null;
    base.stats = computePvpHeroStats(archId);
    base.hp = base.stats.maxHp;
    base.mana = base.stats.maxMana;
    base.shield = 0;
    base.shieldTimer = 0;
    base.flaskCharges = 2;
    base.maxFlaskCharges = 2;
    base.x = PVP_SPAWN_P2.x;
    base.y = PVP_SPAWN_P2.y;
    base.facing = PVP_SPAWN_P2.facing;
    return base;
  }

  startNetworkPvpRun(
    archetypeId: ArchetypeId,
    joinPayload: Extract<CoopServerMessage, { type: 'pvp:joined' }>
  ) {
    this.localCoopMode = false;
    this.p2 = null;
    this.camScale = this.baseCamScale;
    this.resetPvpFighter1(archetypeId);
    this.coopMode = true;
    this.coopRoomCode = joinPayload.roomCode;
    this.coopPlayerId = joinPayload.playerId;
    this.runSeed = 777;
    this.runSeedLabel = 'ARENA-PVP';
    this.isDowned = false;
    this.remotePlayers.clear();
    this.enemyNetTargets.clear();
    this.pendingLootPickups.clear();

    this.pvpMode = 'online';
    this.pvpMatchResult = null;
    this.pvpReported = false;
    this.pvpPendingOrbPickups.clear();

    this.floor = generatePvpArenaFloor();
    this.enemies = [];
    this.loot = [];
    this.slashes = [];
    this.ghosts = [];
    this.rings = [];
    for (const p of this.projectiles) p.active = false;

    this.applyPvpSyncState(joinPayload.state, true);
    this.screen = 'PLAYING';
    this.showBanner(`Arena PvP #${joinPayload.roomCode} · Pulsa Listo para combatir`);
    this.emitHud();
  }

  reconnectPvpRun(payload: Extract<CoopServerMessage, { type: 'room:reconnected' }>) {
    if (!payload.pvpState) return;
    this.localCoopMode = false;
    this.p2 = null;
    this.camScale = this.baseCamScale;
    this.resetPvpFighter1(payload.heroState.archetype);
    this.coopMode = true;
    this.coopRoomCode = payload.roomCode;
    this.coopPlayerId = payload.playerId;
    this.runSeed = 777;
    this.runSeedLabel = 'ARENA-PVP';
    this.remotePlayers.clear();
    this.enemyNetTargets.clear();
    this.pendingLootPickups.clear();

    this.pvpMode = 'online';
    this.pvpMatchResult = null;
    this.pvpReported = false;
    this.pvpPendingOrbPickups.clear();

    this.floor = generatePvpArenaFloor();
    this.enemies = [];
    this.loot = [];
    this.slashes = [];
    this.ghosts = [];
    this.rings = [];
    for (const p of this.projectiles) p.active = false;

    this.applyPvpSyncState(payload.pvpState, true);
    this.screen = 'PLAYING';
    this.showBanner(`Reconectado a Arena PvP #${payload.roomCode}`);
    this.emitHud();
  }

  togglePvpReady() {
    if (this.pvpMode !== 'online') return;
    coopClient.send({ type: 'pvp:ready' });
  }

  requestPvpRematch() {
    if (this.pvpMode === 'online') {
      coopClient.send({ type: 'pvp:rematch' });
    } else if (this.pvpMode === 'local' && this.p2) {
      this.startLocalPvpRun(this.archetype, this.p2.archetype, this.localCoopControlMode);
    }
  }

  private serializeHeroState(num: 1 | 2): SavedHeroState {
    if (num === 2 && this.p2) {
      const p2 = this.p2;
      return {
        archetype: p2.archetype,
        x: p2.x,
        y: p2.y,
        facing: p2.facing,
        level: p2.level,
        xp: p2.xp,
        xpToNext: p2.xpToNext,
        skillPoints: p2.skillPoints,
        hp: p2.hp,
        mana: p2.mana,
        shield: p2.shield,
        flaskCharges: p2.flaskCharges,
        maxFlaskCharges: p2.maxFlaskCharges,
        unlockedNodeIds: [...p2.unlockedNodeIds],
        unlockedSkills: [...p2.unlockedSkills],
        equippedSlots: { ...p2.equippedSlots },
        equippedWeapon: structuredClone(p2.equippedWeapon),
        equippedRelic: p2.equippedRelic ? structuredClone(p2.equippedRelic) : null,
        inventory: structuredClone(p2.inventory),
        isDowned: p2.isDowned,
      };
    }

    return {
      archetype: this.archetype,
      x: this.px,
      y: this.py,
      facing: this.pFacing,
      level: this.level,
      xp: this.xp,
      xpToNext: this.xpToNext,
      skillPoints: this.skillPoints,
      hp: this.hp,
      mana: this.mana,
      shield: this.shield,
      flaskCharges: this.flaskCharges,
      maxFlaskCharges: this.maxFlaskCharges,
      unlockedNodeIds: [...this.unlockedNodeIds],
      unlockedSkills: [...this.unlockedSkills],
      equippedSlots: { ...this.equippedSlots },
      equippedWeapon: structuredClone(this.equippedWeapon),
      equippedRelic: this.equippedRelic ? structuredClone(this.equippedRelic) : null,
      inventory: structuredClone(this.inventory),
      isDowned: this.isDowned,
    };
  }

  private serializeDungeonFloor(): SerializedDungeonFloor {
    return {
      floorNumber: this.floor.floorNumber,
      name: this.floor.name,
      width: this.floor.width,
      height: this.floor.height,
      tileSize: this.floor.tileSize,
      tilesB64: uint8ToBase64(this.floor.tiles),
      visibilityB64: uint8ToBase64(this.floor.visibility),
      wallDecorB64: uint8ToBase64(this.floor.wallDecor),
      rooms: structuredClone(this.floor.rooms),
      props: structuredClone(this.floor.props),
      spawnX: this.floor.spawnX,
      spawnY: this.floor.spawnY,
      bossRoomId: this.floor.bossRoomId,
    };
  }

  exportActiveRunSave(): ActiveRunSave | null {
    if (this.coopMode || this.pvpMode || !this.floor || this.runReported) return null;
    if (this.screen !== 'PLAYING' && this.screen !== 'PAUSED') return null;

    const cleanEnemies = this.enemies.map((e) => ({
      ...structuredClone(e),
      hitFlash: 0,
      telegraph: null,
      state: 'idle' as const,
      stateTimer: 0,
      attackCooldown: Math.max(0.45, e.attackCooldown),
    }));

    return {
      version: 2,
      savedAtIso: new Date().toISOString(),
      runSeed: this.runSeed,
      runSeedLabel: this.runSeedLabel,
      localCoopMode: this.localCoopMode && Boolean(this.p2),
      localCoopControlMode: this.localCoopControlMode,
      floor: this.serializeDungeonFloor(),
      p1: this.serializeHeroState(1),
      p2: this.localCoopMode && this.p2 ? this.serializeHeroState(2) : null,
      gold: this.gold,
      soulsThisRun: this.soulsThisRun,
      kills: this.kills,
      enemies: cleanEnemies,
      loot: structuredClone(this.loot),
      idCounter: this.idCounter,
    };
  }

  triggerCheckpoint(): boolean {
    const snap = this.exportActiveRunSave();
    if (!snap) return false;
    this.callbacks.onSaveCheckpoint?.(snap);
    return true;
  }

  resumeSavedRun(save: ActiveRunSave) {
    this.leaveCoopRoom();
    this.pvpMode = null;
    this.heldKeys.clear();
    this.mouseDown = false;
    this.touchMoveX = 0;
    this.touchMoveY = 0;
    this.touchAttackHeld = false;
    this.bufferedAction = null;

    this.localCoopMode = Boolean(save.localCoopMode && save.p2);
    this.localCoopControlMode = save.localCoopControlMode ?? 'auto';
    if (save.runSeed && save.runSeedLabel) {
      this.runSeed = save.runSeed;
      this.runSeedLabel = save.runSeedLabel;
    } else {
      const fallback = generateRandomRunSeed();
      this.runSeed = fallback.numeric;
      this.runSeedLabel = fallback.label;
    }
    this.camScale = this.baseCamScale;
    this.runReported = false;

    const sf = save.floor;
    this.floor = {
      floorNumber: sf.floorNumber,
      name: sf.name,
      width: sf.width,
      height: sf.height,
      tileSize: sf.tileSize,
      tiles: base64ToUint8(sf.tilesB64),
      visibility: base64ToUint8(sf.visibilityB64),
      wallDecor: base64ToUint8(sf.wallDecorB64),
      rooms: structuredClone(sf.rooms),
      props: structuredClone(sf.props),
      spawnX: sf.spawnX,
      spawnY: sf.spawnY,
      bossRoomId: sf.bossRoomId,
    };

    const p1 = save.p1;
    this.archetype = p1.archetype;
    this.px = p1.x;
    this.py = p1.y;
    this.pvx = 0;
    this.pvy = 0;
    this.pFacing = p1.facing;
    this.pSquashX = 1;
    this.pSquashY = 1;
    this.pHitFlash = 0;
    this.pInvuln = 0.8;
    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.attackCooldown = 0;
    this.comboStep = 0;
    this.comboResetTimer = 0;
    this.guaranteedCrit = false;
    this.level = p1.level;
    this.xp = p1.xp;
    this.xpToNext = p1.xpToNext;
    this.skillPoints = p1.skillPoints;
    this.flaskCharges = p1.flaskCharges;
    this.maxFlaskCharges = p1.maxFlaskCharges;
    this.unlockedNodeIds = [...p1.unlockedNodeIds];
    this.unlockedSkills = [...p1.unlockedSkills];
    this.equippedSlots = { ...p1.equippedSlots };
    this.skillCooldowns = { Q: 0, E: 0, R: 0 };
    this.equippedWeapon = structuredClone(p1.equippedWeapon);
    this.equippedRelic = p1.equippedRelic ? structuredClone(p1.equippedRelic) : null;
    this.inventory = structuredClone(p1.inventory);
    this.isDowned = p1.isDowned;

    this.recomputeStats();
    this.hp = Math.min(this.stats.maxHp, Math.max(p1.isDowned ? 0 : 1, p1.hp));
    this.mana = Math.min(this.stats.maxMana, Math.max(0, p1.mana));
    this.shield = Math.max(0, p1.shield);
    this.shieldTimer = this.shield > 0 ? 3 : 0;

    if (this.localCoopMode && save.p2) {
      const sp2 = save.p2;
      const p2State = this.createLocalPlayer2State(sp2.archetype);
      p2State.x = sp2.x;
      p2State.y = sp2.y;
      p2State.facing = sp2.facing;
      p2State.invuln = 0.8;
      p2State.level = sp2.level;
      p2State.xp = sp2.xp;
      p2State.xpToNext = sp2.xpToNext;
      p2State.skillPoints = sp2.skillPoints;
      p2State.flaskCharges = sp2.flaskCharges;
      p2State.maxFlaskCharges = sp2.maxFlaskCharges;
      p2State.unlockedNodeIds = [...sp2.unlockedNodeIds];
      p2State.unlockedSkills = [...sp2.unlockedSkills];
      p2State.equippedSlots = { ...sp2.equippedSlots };
      p2State.equippedWeapon = structuredClone(sp2.equippedWeapon);
      p2State.equippedRelic = sp2.equippedRelic ? structuredClone(sp2.equippedRelic) : null;
      p2State.inventory = structuredClone(sp2.inventory);
      p2State.isDowned = sp2.isDowned;
      this.p2 = p2State;
      this.recomputeStatsForP2();
      this.p2.hp = Math.min(this.p2.stats.maxHp, Math.max(sp2.isDowned ? 0 : 1, sp2.hp));
      this.p2.mana = Math.min(this.p2.stats.maxMana, Math.max(0, sp2.mana));
      this.p2.shield = Math.max(0, sp2.shield);
      this.p2.shieldTimer = this.p2.shield > 0 ? 3 : 0;
    } else {
      this.p2 = null;
    }

    this.gold = save.gold;
    this.soulsThisRun = save.soulsThisRun;
    this.kills = save.kills;
    this.idCounter = Math.max(this.idCounter, save.idCounter || 100);
    this.enemies = structuredClone(save.enemies);
    this.loot = structuredClone(save.loot);

    this.slashes = [];
    this.ghosts = [];
    this.rings = [];
    for (const p of this.projectiles) p.active = false;
    for (const pt of this.particles) pt.active = false;
    for (const ft of this.floatingTexts) ft.active = false;

    if (this.localCoopMode && this.p2) {
      this.camX = (this.px + this.p2.x) * 0.5;
      this.camY = (this.py + this.p2.y) * 0.5;
    } else {
      this.camX = this.px;
      this.camY = this.py;
    }

    this.screen = 'PLAYING';
    this.updateVisibility();
    this.showBanner(`Incursión reanudada · Piso ${this.floor.floorNumber}`);
    this.emitHud();
  }

  private createLocalPlayer2State(archetypeId: ArchetypeId): LocalPlayer2State {
    const arch = ARCHETYPES[archetypeId];
    const bonusFlasks =
      (this.meta.blessings.flask >= 2 ? 1 : 0) + (this.meta.blessings.flask >= 4 ? 1 : 0);
    const maxFlaskCharges = 3 + bonusFlasks;
    const unlockedNodeIds = ['origin', arch.startingNodeId];
    const startSkill = arch.startingSkills[0];
    const equippedWeapon = structuredClone(arch.startingWeapon);
    const stats = computePlayerStats(
      archetypeId,
      1,
      unlockedNodeIds,
      equippedWeapon,
      null,
      this.meta
    );

    return {
      archetype: archetypeId,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      facing: Math.PI,
      squashX: 1,
      squashY: 1,
      hitFlash: 0,
      invuln: 0,
      dashTimer: 0,
      dashDirX: 1,
      dashDirY: 0,
      dashCooldown: 0,
      attackCooldown: 0,
      comboStep: 0,
      comboResetTimer: 0,
      guaranteedCrit: false,
      level: 1,
      xp: 0,
      xpToNext: 80,
      skillPoints: 1,
      hp: stats.maxHp,
      mana: stats.maxMana,
      shield: 0,
      shieldTimer: 0,
      flaskCharges: maxFlaskCharges,
      maxFlaskCharges,
      unlockedNodeIds,
      unlockedSkills: [startSkill],
      equippedSlots: { Q: startSkill, E: null, R: null },
      skillCooldowns: { Q: 0, E: 0, R: 0 },
      equippedWeapon,
      equippedRelic: null,
      inventory: [],
      stats,
      isDowned: false,
      touchMoveX: 0,
      touchMoveY: 0,
      touchAttackHeld: false,
      bufferedAction: null,
    };
  }

  startCoopRun(
    archetypeId: ArchetypeId,
    joinPayload: Extract<CoopServerMessage, { type: 'room:joined' }>
  ) {
    this.localCoopMode = false;
    this.p2 = null;
    this.camScale = this.baseCamScale;
    this.resetRunState(archetypeId);
    this.coopMode = true;
    this.coopRoomCode = joinPayload.roomCode;
    this.coopPlayerId = joinPayload.playerId;
    this.runSeed = joinPayload.runSeed;
    this.runSeedLabel = joinPayload.runSeedLabel;
    this.isDowned = false;
    this.remotePlayers.clear();
    this.enemyNetTargets.clear();
    this.pendingLootPickups.clear();

    for (const p of joinPayload.players) {
      if (p.id !== joinPayload.playerId) {
        this.remotePlayers.set(p.id, { ...p, targetX: p.x, targetY: p.y });
      }
    }

    this.screen = 'PLAYING';
    this.initFloorWithSeed(
      joinPayload.floorNumber,
      joinPayload.floorSeed,
      joinPayload.enemies,
      joinPayload.interactedPropIds,
      joinPayload.brokenPropIds,
      joinPayload.portalOpen,
      joinPayload.groundLoot
    );

    const me = joinPayload.players.find((p) => p.id === joinPayload.playerId);
    if (me) {
      this.px = me.x;
      this.py = me.y;
      this.camX = me.x;
      this.camY = me.y;
    }

    this.sendCoopBuildUpdate();
    this.callbacks.onAchievementEvent?.({ coopRunsPlayed: { mode: 'inc', value: 1 } });
    this.showBanner(`Sala ${joinPayload.roomCode} · Piso ${joinPayload.floorNumber} · ${this.runSeedLabel}`);
    this.emitHud();
  }

  reconnectCoopRun(payload: Extract<CoopServerMessage, { type: 'room:reconnected' }>) {
    const hs = payload.heroState;
    this.localCoopMode = false;
    this.p2 = null;
    this.camScale = this.baseCamScale;
    this.runReported = false;
    this.coopMode = true;
    this.coopRoomCode = payload.roomCode;
    this.coopPlayerId = payload.playerId;
    this.runSeed = payload.runSeed;
    this.runSeedLabel = payload.runSeedLabel;
    this.remotePlayers.clear();
    this.enemyNetTargets.clear();
    this.pendingLootPickups.clear();

    this.archetype = hs.archetype;
    this.level = hs.level;
    this.xp = hs.xp;
    this.xpToNext = hs.xpToNext;
    this.skillPoints = hs.skillPoints;
    this.gold = hs.gold;
    this.soulsThisRun = hs.souls;
    this.kills = hs.kills;
    this.flaskCharges = hs.flaskCharges;
    this.maxFlaskCharges = hs.maxFlaskCharges;
    this.unlockedNodeIds = [...hs.unlockedNodeIds];
    this.unlockedSkills = [...hs.unlockedSkills];
    this.equippedSlots = { ...hs.equippedSlots };
    this.skillCooldowns = { Q: 0, E: 0, R: 0 };
    this.equippedWeapon = structuredClone(hs.equippedWeapon);
    this.equippedRelic = hs.equippedRelic ? structuredClone(hs.equippedRelic) : null;
    this.inventory = structuredClone(hs.inventory);
    this.isDowned = !hs.alive;

    this.recomputeStats();
    this.hp = Math.min(this.stats.maxHp, hs.hp);
    this.mana = this.stats.maxMana;
    this.shield = hs.shield;
    this.shieldTimer = hs.shield > 0 ? 4 : 0;

    for (const p of payload.players) {
      if (p.id !== payload.playerId) {
        this.remotePlayers.set(p.id, { ...p, targetX: p.x, targetY: p.y });
      }
    }

    this.screen = 'PLAYING';
    this.initFloorWithSeed(
      payload.floorNumber,
      payload.floorSeed,
      payload.enemies,
      payload.interactedPropIds,
      payload.brokenPropIds,
      payload.portalOpen,
      payload.groundLoot
    );

    this.px = hs.x;
    this.py = hs.y;
    this.camX = hs.x;
    this.camY = hs.y;
    this.pInvuln = 1.0;

    this.showBanner(`Reconectado a Sala #${payload.roomCode} · Piso ${payload.floorNumber}`);
    this.emitHud();
  }

  leaveCoopRoom() {
    if (this.coopMode) {
      coopClient.send({ type: 'room:leave' });
    }
    if (coopClient.getMode() !== 'ws') {
      coopClient.disconnect();
    } else {
      coopClient.clearSavedSession();
    }
    this.coopMode = false;
    this.coopRoomCode = null;
    this.coopPlayerId = null;
    this.isDowned = false;
    this.remotePlayers.clear();
    this.enemyNetTargets.clear();
    this.pendingLootPickups.clear();
    if (this.pvpMode === 'online') {
      this.pvpMode = null;
      this.pvpFighters = [];
      this.pvpOrbs = [];
      this.pvpMatchResult = null;
      this.pvpReported = false;
      this.pvpWinnerId = null;
      this.pvpWinnerName = null;
      this.pvpPendingOrbPickups.clear();
    }
  }

  private resetRunState(archetypeId: ArchetypeId) {
    this.archetype = archetypeId;
    const arch = ARCHETYPES[archetypeId];
    this.level = 1;
    this.xp = 0;
    this.xpToNext = 80;
    this.skillPoints = 1;
    this.gold = 0;
    this.soulsThisRun = 0;
    this.kills = 0;
    this.runReported = false;
    this.isDowned = false;

    const bonusFlasks = (this.meta.blessings.flask >= 2 ? 1 : 0) + (this.meta.blessings.flask >= 4 ? 1 : 0);
    this.maxFlaskCharges = 3 + bonusFlasks;
    this.flaskCharges = this.maxFlaskCharges;

    this.unlockedNodeIds = ['origin', arch.startingNodeId];
    const startSkill = arch.startingSkills[0];
    this.unlockedSkills = [startSkill];
    this.equippedSlots = {
      Q: startSkill,
      E: null,
      R: null,
    };
    this.skillCooldowns = { Q: 0, E: 0, R: 0 };
    this.equippedWeapon = structuredClone(arch.startingWeapon);
    this.equippedRelic = null;
    this.inventory = [];

    this.recomputeStats();
    this.hp = this.stats.maxHp;
    this.mana = this.stats.maxMana;
    this.shield = 0;
    this.shieldTimer = 0;
    this.levelUpToastTimer = 0;
  }

  handleCoopMessage(msg: CoopServerMessage) {
    if (!this.coopMode) return;

    if (this.pvpMode === 'online') {
      if (msg.type === 'pvp:state') {
        this.applyPvpSyncState(msg.state);
        return;
      }
      if (msg.type === 'pvp:damaged') {
        const isMe = msg.targetId === this.coopPlayerId;
        const target = isMe ? null : this.remotePlayers.get(msg.targetId);
        const tx = isMe ? this.px : target?.x ?? this.px;
        const ty = isMe ? this.py : target?.y ?? this.py;
        if (isMe) {
          this.hp = Math.max(0, msg.hp);
          this.shield = msg.shield;
          this.pHitFlash = 0.16;
          this.addShake(5.5, 0.14);
          sfx.playPlayerHurt();
          if (msg.knockX || msg.knockY) {
            this.moveHeroWithWallSlide(this.getHeroState(1), msg.knockX, msg.knockY);
          }
        } else {
          if (target) {
            target.hp = Math.max(0, msg.hp);
            target.shield = msg.shield;
          }
          if (msg.attackerId === this.coopPlayerId) {
            sfx.playHit(msg.isCrit);
            if (msg.isCrit) {
              this.hitstopTimer = Math.max(this.hitstopTimer, 0.035);
              this.addShake(3.5, 0.09);
            }
          }
        }
        this.spawnParticles(tx, ty, msg.isCrit ? 12 : 7, msg.isCrit ? '#F59E0B' : msg.color, 145, 0.3);
        this.spawnFloatingText(
          tx + (Math.random() - 0.5) * 14,
          ty - 24,
          msg.isCrit ? `${msg.damage}!` : `${msg.damage}`,
          msg.isCrit ? '#F59E0B' : '#EF4444',
          msg.isCrit ? 1.24 : 0.96
        );
        this.emitHud();
        return;
      }
      if (msg.type === 'pvp:round_end') {
        for (const p of this.projectiles) p.active = false;
        this.slashes = [];
        sfx.playVictory();
        this.showBanner(`Ronda ${msg.roundNumber}: ¡${msg.roundWinnerName} gana la ronda!`);
        this.emitHud();
        return;
      }
      if (msg.type === 'pvp:match_end') {
        const won = msg.winnerId === this.coopPlayerId;
        this.pvpPhase = 'match_end';
        this.pvpWinnerId = msg.winnerId;
        this.pvpWinnerName = msg.winnerName;
        const result: PvpMatchResult = {
          mode: 'online',
          won,
          winnerName: msg.winnerName,
          loserName: msg.loserName,
          p1Rounds: msg.p1Rounds,
          p2Rounds: msg.p2Rounds,
          eloBefore: won ? msg.winnerEloBefore : msg.loserEloBefore,
          eloAfter: won ? msg.winnerEloAfter : msg.loserEloAfter,
          eloDelta: won ? msg.winnerDelta : msg.loserDelta,
          tierName: won ? msg.winnerTierName : msg.loserTierName,
          unlockedTitle: won ? msg.winnerNewTitle : msg.loserNewTitle,
          soulsReward: won ? msg.winnerSouls : msg.loserSouls,
        };
        this.pvpMatchResult = result;
        if (won) sfx.playVictory();
        else sfx.playPlayerHurt();
        if (!this.pvpReported) {
          this.pvpReported = true;
          this.callbacks.onPvpMatchFinished?.(result);
        }
        this.emitHud();
        return;
      }
      if (msg.type === 'player:left') {
        const left = this.remotePlayers.get(msg.playerId);
        if (left) {
          this.remotePlayers.delete(msg.playerId);
          this.showBanner(`${left.name} salió de la Arena`);
        }
        this.emitHud();
        return;
      }
    }

    if (msg.type === 'hero:stats') {
      const prevLevel = this.level;
      this.level = msg.level;
      this.xp = msg.xp;
      this.xpToNext = msg.xpToNext;
      this.skillPoints = msg.skillPoints;
      this.gold = msg.gold;
      this.soulsThisRun = msg.souls;
      this.kills = msg.kills;
      this.flaskCharges = msg.flaskCharges;
      this.maxFlaskCharges = msg.maxFlaskCharges;
      if (this.pvpMode === 'online') {
        this.hp = Math.min(this.stats.maxHp, msg.hp);
        this.shield = msg.shield;
        this.isDowned = !msg.alive;
        this.emitHud();
        return;
      }
      this.recomputeStats();
      this.hp = Math.min(this.stats.maxHp, msg.hp);
      this.shield = msg.shield;
      const wasDowned = this.isDowned;
      this.isDowned = !msg.alive;

      if (msg.level > prevLevel) {
        this.mana = this.stats.maxMana;
        this.levelUpToastTimer = 5.5;
        sfx.playLevelUp();
        this.rings.push({
          x: this.px,
          y: this.py,
          radius: 12,
          maxRadius: 120,
          color: '#F59E0B',
          life: 0.45,
          maxLife: 0.45,
        });
        this.spawnFloatingText(this.px, this.py - 34, `¡Nivel ${this.level}!`, '#F59E0B', 1.35);
      }

      if (!wasDowned && this.isDowned) {
        this.heldKeys.clear();
        this.mouseDown = false;
        this.touchMoveX = 0;
        this.touchMoveY = 0;
        this.touchAttackHeld = false;
        const anyAllyAlive = Array.from(this.remotePlayers.values()).some((a) => a.alive);
        if (anyAllyAlive) {
          this.showBanner('Has caído · Un aliado puede revivirte');
        } else {
          this.finishRun(false);
        }
      }
      this.emitHud();
      return;
    }

    if (msg.type === 'loot:spawned') {
      for (const item of msg.items) {
        if (!this.loot.some((l) => l.id === item.id)) {
          this.loot.push(structuredClone(item));
        }
      }
      return;
    }

    if (msg.type === 'loot:collected') {
      this.pendingLootPickups.delete(msg.lootId);
      const idx = this.loot.findIndex((l) => l.id === msg.lootId);
      const lx = idx !== -1 ? this.loot[idx].x : this.px;
      const ly = idx !== -1 ? this.loot[idx].y : this.py;
      if (idx !== -1) this.loot.splice(idx, 1);

      if (msg.collectorId === this.coopPlayerId) {
        if (msg.kind === 'gold') {
          sfx.playPickup(false);
          this.spawnFloatingText(lx, ly - 12, `+${msg.amount} Oro`, '#F59E0B', 0.85);
        } else if (msg.kind === 'soul') {
          sfx.playPickup(true);
          this.spawnFloatingText(lx, ly - 12, `+${msg.amount} Alma`, '#A78BFA', 0.95);
        } else if (msg.kind === 'hp_orb') {
          sfx.playPickup(false);
          this.spawnFloatingText(lx, ly - 12, `+${msg.amount} Vida`, '#10B981', 0.9);
        } else if (msg.kind === 'item' && msg.item) {
          this.inventory = [msg.item, ...this.inventory].slice(0, 18);
          if (msg.item.rarity === 'relic') {
            this.callbacks.onAchievementEvent?.({ relicRarityObtained: { mode: 'max', value: 1 } });
          }
          sfx.playPickup(msg.item.rarity !== 'common');
          this.spawnFloatingText(lx, ly - 16, msg.item.name, RARITY_COLORS[msg.item.rarity], 1.0);
        }
      } else if (msg.kind === 'item' && msg.item) {
        this.spawnFloatingText(lx, ly - 16, `${msg.collectorName}: ${msg.item.name}`, '#949BA8', 0.85);
      }
      this.emitHud();
      return;
    }

    if (msg.type === 'world:tick') {
      const seenPlayerIds = new Set<string>();
      for (const p of msg.players) {
        if (p.id === this.coopPlayerId) continue;
        seenPlayerIds.add(p.id);
        const existing = this.remotePlayers.get(p.id);
        if (existing) {
          const prevX = existing.x;
          const prevY = existing.y;
          Object.assign(existing, p);
          existing.x = prevX;
          existing.y = prevY;
          existing.targetX = p.x;
          existing.targetY = p.y;
        } else {
          this.remotePlayers.set(p.id, { ...p, targetX: p.x, targetY: p.y });
        }
      }
      for (const key of this.remotePlayers.keys()) {
        if (!seenPlayerIds.has(key)) this.remotePlayers.delete(key);
      }

      if (this.isDowned && !this.runReported && msg.players.length > 0 && msg.players.every((p) => !p.alive)) {
        this.finishRun(false);
      }

      // Reconcile authoritative enemies
      const existingById = new Map(this.enemies.map((e) => [e.id, e]));
      const nextEnemies: EnemyEntity[] = [];
      this.enemyNetTargets.clear();

      for (const se of msg.enemies) {
        const cur = existingById.get(se.id);
        this.enemyNetTargets.set(se.id, { x: se.x, y: se.y });
        if (cur) {
          if (Math.hypot(se.x - cur.x, se.y - cur.y) > 75) {
            cur.x = se.x;
            cur.y = se.y;
          }
          cur.facing = se.facing;
          cur.hp = se.hp;
          cur.maxHp = se.maxHp;
          cur.state = se.state;
          cur.telegraph = se.telegraph;
          nextEnemies.push(cur);
        } else {
          nextEnemies.push(this.syncToEnemyEntity(se));
        }
      }
      this.enemies = nextEnemies;
      return;
    }

    if (msg.type === 'player:joined') {
      if (msg.player.id !== this.coopPlayerId) {
        this.remotePlayers.set(msg.player.id, { ...msg.player, targetX: msg.player.x, targetY: msg.player.y });
        this.showBanner(`${msg.player.name} se unió a la cripta`);
      }
      return;
    }

    if (msg.type === 'player:left') {
      const left = this.remotePlayers.get(msg.playerId);
      if (left) {
        this.remotePlayers.delete(msg.playerId);
        this.showBanner(`${left.name} abandonó la cripta`);
      }
      return;
    }

    if (msg.type === 'player:action') {
      if (msg.playerId === this.coopPlayerId) return;
      const a = msg.action;
      if (a.kind === 'slash') {
        this.slashes.push({
          x: a.x,
          y: a.y,
          angle: a.angle ?? 0,
          arc: a.arc ?? Math.PI * 0.85,
          radius: a.radius ?? 78,
          color: a.color,
          life: a.isSpin ? 0.28 : 0.17,
          maxLife: a.isSpin ? 0.28 : 0.17,
          isSpin: Boolean(a.isSpin),
        });
      } else if (a.kind === 'ring') {
        this.rings.push({
          x: a.x,
          y: a.y,
          radius: 16,
          maxRadius: a.radius ?? 96,
          color: a.color,
          life: 0.3,
          maxLife: 0.3,
        });
      } else if (a.kind === 'dash') {
        this.ghosts.push({
          x: a.x,
          y: a.y,
          facing: a.angle ?? 0,
          life: 0.22,
          maxLife: 0.22,
          color: a.color,
        });
        this.spawnParticles(a.x, a.y, 8, a.color, 90, 0.25);
      } else if (a.kind === 'projectile') {
        this.spawnProjectile({
          fromPlayer: true,
          visualOnly: true,
          x: a.x,
          y: a.y,
          vx: a.vx ?? 500,
          vy: a.vy ?? 0,
          radius: a.projKind === 'lance' ? 11 : 7,
          damage: 0,
          isCrit: false,
          color: a.color,
          maxLife: 0.85,
          pierce: a.projKind === 'lance' ? 4 : 0,
          applyBleed: false,
          applySlow: false,
          kind: a.projKind ?? 'bolt',
        });
      }
      return;
    }

    if (msg.type === 'enemy:damaged') {
      const e = this.enemies.find((en) => en.id === msg.enemyId);
      if (e) {
        e.hp = msg.hp;
        e.hitFlash = 0.11;
        e.squashX = 1.24;
        e.squashY = 0.78;
        this.spawnParticles(e.x, e.y, msg.isCrit ? 12 : 6, msg.isCrit ? '#F59E0B' : msg.color, 140, 0.3);
        this.spawnFloatingText(
          e.x + (Math.random() - 0.5) * 14,
          e.y - e.radius - 6,
          msg.isCrit ? `${msg.damage}!` : `${msg.damage}`,
          msg.isCrit ? '#F59E0B' : '#E5E0D5',
          msg.isCrit ? 1.22 : 0.92
        );
      }
      if (msg.attackerId === this.coopPlayerId) {
        sfx.playHit(msg.isCrit);
        if (msg.isCrit) {
          this.hitstopTimer = Math.max(this.hitstopTimer, 0.035);
          this.addShake(3.5, 0.09);
        }
        if (this.stats.lifesteal > 0 && !this.isDowned) {
          const leech = Math.max(1, Math.round(msg.damage * this.stats.lifesteal));
          this.hp = Math.min(this.stats.maxHp, this.hp + leech);
        }
      }
      return;
    }

    if (msg.type === 'enemy:killed') {
      const idx = this.enemies.findIndex((e) => e.id === msg.enemyId);
      const killedType = idx !== -1 ? this.enemies[idx].type : undefined;
      const ex = idx !== -1 ? this.enemies[idx].x : msg.x;
      const ey = idx !== -1 ? this.enemies[idx].y : msg.y;
      if (idx !== -1) this.enemies.splice(idx, 1);
      this.enemyNetTargets.delete(msg.enemyId);
      if (killedType) {
        this.callbacks.onBestiaryEvent?.(killedType, true);
        const achUpdate: AchievementStatUpdate = { totalKills: { mode: 'inc', value: 1 } };
        if (killedType === 'boss_warden') achUpdate.bossWardenKills = { mode: 'inc', value: 1 };
        if (killedType === 'boss_archon') achUpdate.bossArchonKills = { mode: 'inc', value: 1 };
        this.callbacks.onAchievementEvent?.(achUpdate);
      }

      this.spawnParticles(ex, ey, msg.isBoss ? 44 : 18, msg.isBoss ? '#F59E0B' : '#DC2626', 210, 0.45);

      if (msg.isBoss) {
        const bossSouls = 18 + this.floor.floorNumber * 8;
        this.spawnFloatingText(ex, ey - 24, `+${bossSouls} Fragmentos`, '#A78BFA', 1.3);
        if (!this.floor.props.some((p) => p.kind === 'portal')) {
          const bossRoom = this.floor.rooms[this.floor.bossRoomId];
          this.floor.props.push({
            id: `portal_${this.idCounter++}`,
            kind: 'portal',
            x: (bossRoom.cx + 0.5) * this.floor.tileSize,
            y: (bossRoom.cy + 0.5) * this.floor.tileSize,
            radius: 26,
            interacted: false,
            broken: false,
          });
        }
        this.showBanner('¡Guardián abatido! Portal de descenso abierto');
      }

      const room = this.floor.rooms.find((r) => r.id === msg.roomId);
      if (room && !this.enemies.some((e) => e.roomId === room.id)) {
        room.cleared = true;
      }
      return;
    }

    if (msg.type === 'enemy:attack') {
      const e = this.enemies.find((en) => en.id === msg.enemyId);
      if (e) {
        this.executeEnemyAttack(e, msg.telegraph);
      }
      return;
    }

    if (msg.type === 'prop:updated') {
      const prop = this.floor.props.find((p) => p.id === msg.propId);
      if (!prop || prop.interacted) return;
      prop.interacted = true;
      if (msg.kind === 'chest') {
        sfx.playChestOpen();
        this.spawnParticles(prop.x, prop.y, 22, '#F59E0B', 140, 0.5);
        this.showBanner(`${msg.actorName} abrió un Cofre Antiguo`);
      } else if (msg.kind === 'shrine') {
        sfx.playShrine();
        this.spawnParticles(prop.x, prop.y, 24, '#8B5CF6', 130, 0.55);
        if (msg.shrineVariant === 'blood') {
          this.showBanner(`${msg.actorName} activó Altar Carmesí: Vida y Frascos`);
        } else if (msg.shrineVariant === 'arcane') {
          this.levelUpToastTimer = 4.5;
          this.showBanner(`${msg.actorName} activó Altar del Eclipse: +1 Habilidad`);
        } else {
          this.showBanner(`${msg.actorName} activó Altar del Santuario`);
        }
      }
      this.emitHud();
      return;
    }

    if (msg.type === 'prop:broken') {
      const prop = this.floor.props.find((p) => p.id === msg.propId);
      if (prop && !prop.broken) {
        prop.broken = true;
        this.spawnParticles(prop.x, prop.y, 8, '#A1887F', 100, 0.3);
      }
      return;
    }

    if (msg.type === 'player:revived') {
      if (msg.targetPlayerId === this.coopPlayerId) {
        this.isDowned = false;
        this.hp = Math.max(1, Math.round(this.stats.maxHp * 0.5));
        this.pInvuln = 1.5;
        sfx.playShrine();
        this.spawnParticles(this.px, this.py, 22, '#10B981', 140, 0.45);
        this.showBanner(`${msg.reviverName} te ha revivido`);
        this.emitHud();
      } else {
        const ally = this.remotePlayers.get(msg.targetPlayerId);
        if (ally) {
          ally.alive = true;
          this.spawnParticles(ally.x, ally.y, 18, '#10B981', 120, 0.4);
          this.showBanner(`${msg.reviverName} revivió a ${ally.name}`);
        }
      }
      return;
    }

    if (msg.type === 'floor:changed') {
      this.isDowned = false;
      this.pendingLootPickups.clear();
      this.hp = Math.max(this.hp, Math.round(this.stats.maxHp * 0.5));
      this.mana = this.stats.maxMana;
      this.initFloorWithSeed(
        msg.floorNumber,
        msg.floorSeed,
        msg.enemies,
        [],
        [],
        false,
        msg.groundLoot
      );
      sfx.playShrine();
      this.showBanner(`${msg.actorName} abrió el Piso ${msg.floorNumber} · ${this.floor.name}`);
      this.emitHud();
    }
  }

  private sendCoopAction(action: CoopActionPayload) {
    if (!this.coopMode) return;
    coopClient.send({ type: 'player:action', action });
  }

  private syncToEnemyEntity(se: CoopEnemySync): EnemyEntity {
    return {
      id: se.id,
      type: se.type,
      name: se.name,
      isBoss: se.isBoss,
      x: se.x,
      y: se.y,
      vx: 0,
      vy: 0,
      radius: se.radius,
      hp: se.hp,
      maxHp: se.maxHp,
      speed: se.speed,
      damage: se.damage,
      xpValue: se.xpValue,
      goldValue: se.goldValue,
      facing: se.facing,
      state: se.state,
      stateTimer: 0,
      attackCooldown: 0,
      hitFlash: 0,
      bleedTimer: 0,
      bleedDps: 0,
      slowTimer: 0,
      squashX: 1,
      squashY: 1,
      telegraph: se.telegraph,
      bossPatternIndex: 0,
      roomId: se.roomId,
    };
  }

  private initFloorWithSeed(
    floorNumber: number,
    seed: number,
    syncEnemies: CoopEnemySync[],
    interactedPropIds: string[],
    brokenPropIds: string[],
    portalOpen: boolean,
    groundLoot: GroundLoot[] = []
  ) {
    this.floor = generateDungeonFloor(floorNumber, seed);
    this.px = this.floor.spawnX;
    this.py = this.floor.spawnY;
    this.camX = this.px;
    this.camY = this.py;

    const interactedSet = new Set(interactedPropIds);
    const brokenSet = new Set(brokenPropIds);
    for (const prop of this.floor.props) {
      if (interactedSet.has(prop.id)) prop.interacted = true;
      if (brokenSet.has(prop.id)) prop.broken = true;
    }

    if (portalOpen && !this.floor.props.some((p) => p.kind === 'portal')) {
      const bossRoom = this.floor.rooms[this.floor.bossRoomId];
      this.floor.props.push({
        id: `portal_${this.idCounter++}`,
        kind: 'portal',
        x: (bossRoom.cx + 0.5) * this.floor.tileSize,
        y: (bossRoom.cy + 0.5) * this.floor.tileSize,
        radius: 26,
        interacted: false,
        broken: false,
      });
    }

    this.enemies = syncEnemies.map((se) => this.syncToEnemyEntity(se));
    this.enemyNetTargets.clear();
    for (const se of syncEnemies) {
      this.enemyNetTargets.set(se.id, { x: se.x, y: se.y });
    }

    this.loot = groundLoot.map((l) => structuredClone(l));
    this.slashes = [];
    this.ghosts = [];
    this.rings = [];
    for (const p of this.projectiles) p.active = false;
    this.updateVisibility();
    this.callbacks.onAchievementEvent?.({ bestFloor: { mode: 'max', value: floorNumber } });
  }

  private applyPvpSyncState(state: PvpRoomSyncState, snapPositions = false) {
    const prevPhase = this.pvpPhase;
    const prevRound = this.pvpRoundNumber;
    this.pvpPhase = state.phase;
    this.pvpRoundNumber = state.roundNumber;
    this.pvpPhaseTimer = state.phaseTimer;
    this.pvpRingRadius = state.ringRadius;
    this.pvpOrbs = state.orbs.map((o) => ({ ...o }));
    this.pvpWinnerId = state.winnerId;
    this.pvpWinnerName = state.winnerName;
    this.pvpFighters = state.fighters;

    const seenRemote = new Set<string>();
    for (const f of state.fighters) {
      if (f.id === this.coopPlayerId) {
        this.hp = f.hp;
        this.shield = f.shield;
        this.flaskCharges = f.flaskCharges;
        this.maxFlaskCharges = f.maxFlaskCharges;
        this.isDowned = !f.alive;
        if (
          snapPositions ||
          (prevPhase !== 'countdown' && state.phase === 'countdown') ||
          prevRound !== state.roundNumber
        ) {
          this.px = f.x;
          this.py = f.y;
          this.pFacing = f.facing;
          this.mana = this.stats.maxMana;
          this.skillCooldowns = { Q: 0, E: 0, R: 0 };
          this.dashCooldown = 0;
          if (snapPositions) {
            this.camX = f.x;
            this.camY = f.y;
          }
        }
      } else {
        seenRemote.add(f.id);
        const existing = this.remotePlayers.get(f.id);
        const syncObj: CoopPlayerSync = {
          id: f.id,
          name: f.name,
          archetype: f.archetype,
          classTitle: f.classTitle,
          level: 5,
          x: f.x,
          y: f.y,
          facing: f.facing,
          hp: f.hp,
          maxHp: f.maxHp,
          shield: f.shield,
          weaponKind: f.weaponKind,
          alive: f.alive,
          isHost: false,
          color: f.color,
          connected: f.connected,
          cosmetics: f.cosmetics,
        };
        if (existing && !snapPositions && prevRound === state.roundNumber) {
          const px = existing.x;
          const py = existing.y;
          Object.assign(existing, syncObj);
          existing.x = px;
          existing.y = py;
          existing.targetX = f.x;
          existing.targetY = f.y;
        } else {
          this.remotePlayers.set(f.id, { ...syncObj, targetX: f.x, targetY: f.y });
        }
      }
    }
    for (const id of this.remotePlayers.keys()) {
      if (!seenRemote.has(id)) this.remotePlayers.delete(id);
    }

    if (prevPhase !== 'fighting' && state.phase === 'fighting') {
      this.pvpMatchResult = null;
      this.pvpReported = false;
      sfx.playBossRoar();
      this.showBanner(`¡RONDA ${state.roundNumber} · COMBATE!`);
    } else if (prevPhase !== 'countdown' && state.phase === 'countdown') {
      this.pvpMatchResult = null;
      this.pvpReported = false;
      this.showBanner(`Ronda ${state.roundNumber} · Prepárate`);
    }

    this.emitHud();
  }

  continueEndless() {
    if (this.screen !== 'VICTORY') return;
    this.screen = 'PLAYING';
    this.runReported = false;
    this.descendNextFloor();
    this.emitHud();
  }

  setScreen(screen: GameScreen) {
    if (screen === 'TITLE') {
      this.leaveCoopRoom();
      this.localCoopMode = false;
      this.pvpMode = null;
      this.p2 = null;
      this.camScale = this.baseCamScale;
    }
    this.screen = screen;
    if (screen !== 'PLAYING') {
      this.heldKeys.clear();
      this.mouseDown = false;
      this.touchMoveX = 0;
      this.touchMoveY = 0;
      this.touchAttackHeld = false;
      if (this.p2) {
        this.p2.touchMoveX = 0;
        this.p2.touchMoveY = 0;
        this.p2.touchAttackHeld = false;
      }
    }
    if (screen === 'PAUSED' && !this.coopMode && !this.runReported) {
      this.triggerCheckpoint();
    }
    this.emitHud();
  }

  setTouchMove(dx: number, dy: number) {
    this.lastInputType = 'touch';
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      this.touchMoveX = dx / len;
      this.touchMoveY = dy / len;
    } else {
      this.touchMoveX = dx;
      this.touchMoveY = dy;
    }
  }

  setTouchAttackHeld(held: boolean) {
    this.lastInputType = 'touch';
    this.touchAttackHeld = held;
    if (held && this.screen === 'PLAYING' && (!this.bufferedAction || this.bufferedAction.type === 'attack')) {
      this.bufferedAction = { type: 'attack', expires: performance.now() + 140 };
    }
  }

  triggerTouchDash() {
    this.lastInputType = 'touch';
    if (this.screen !== 'PLAYING') return;
    this.bufferedAction = { type: 'dash', expires: performance.now() + 180 };
  }

  triggerTouchSkill(slot: SkillSlotKey) {
    this.lastInputType = 'touch';
    if (this.screen !== 'PLAYING') return;
    this.bufferedAction = { type: 'skill', slot, expires: performance.now() + 180 };
  }

  triggerTouchFlask() {
    this.lastInputType = 'touch';
    if (this.screen !== 'PLAYING') return;
    this.bufferedAction = { type: 'flask', expires: performance.now() + 180 };
  }

  triggerTouchInteract() {
    this.lastInputType = 'touch';
    if (this.screen !== 'PLAYING') return;
    this.bufferedAction = { type: 'interact', expires: performance.now() + 180 };
  }

  setP2TouchMove(dx: number, dy: number) {
    if (!this.p2) return;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      this.p2.touchMoveX = dx / len;
      this.p2.touchMoveY = dy / len;
    } else {
      this.p2.touchMoveX = dx;
      this.p2.touchMoveY = dy;
    }
  }

  setP2TouchAttackHeld(held: boolean) {
    if (!this.p2) return;
    this.p2.touchAttackHeld = held;
    if (held && this.screen === 'PLAYING' && (!this.p2.bufferedAction || this.p2.bufferedAction.type === 'attack')) {
      this.p2.bufferedAction = { type: 'attack', expires: performance.now() + 140 };
    }
  }

  triggerP2TouchDash() {
    if (!this.p2 || this.screen !== 'PLAYING') return;
    this.p2.bufferedAction = { type: 'dash', expires: performance.now() + 160 };
  }

  triggerP2TouchSkill(slot: SkillSlotKey) {
    if (!this.p2 || this.screen !== 'PLAYING') return;
    this.p2.bufferedAction = { type: 'skill', slot, expires: performance.now() + 160 };
  }

  triggerP2TouchFlask() {
    if (!this.p2 || this.screen !== 'PLAYING') return;
    this.p2.bufferedAction = { type: 'flask', expires: performance.now() + 160 };
  }

  triggerP2TouchInteract() {
    if (!this.p2 || this.screen !== 'PLAYING') return;
    this.p2.bufferedAction = { type: 'interact', expires: performance.now() + 160 };
  }

  unlockSkillNode(nodeId: string, playerNum: 1 | 2 = 1): boolean {
    if (playerNum === 2 && this.p2) {
      const p2 = this.p2;
      if (p2.skillPoints <= 0) return false;
      if (p2.unlockedNodeIds.includes(nodeId)) return false;
      const node = SKILL_TREE_NODES.find((n) => n.id === nodeId);
      if (!node) return false;
      const hasParent =
        node.requires.length === 0 ||
        node.requires.some((req) => p2.unlockedNodeIds.includes(req));
      if (!hasParent) return false;

      p2.skillPoints--;
      p2.unlockedNodeIds = [...p2.unlockedNodeIds, nodeId];
      if (node.unlocksSkill && !p2.unlockedSkills.includes(node.unlocksSkill)) {
        p2.unlockedSkills = [...p2.unlockedSkills, node.unlocksSkill];
        if (!p2.equippedSlots.Q) p2.equippedSlots.Q = node.unlocksSkill;
        else if (!p2.equippedSlots.E) p2.equippedSlots.E = node.unlocksSkill;
        else if (!p2.equippedSlots.R) p2.equippedSlots.R = node.unlocksSkill;
      }

      const prevMaxHp = p2.stats.maxHp;
      this.recomputeStatsForP2();
      const hpGain = Math.max(0, p2.stats.maxHp - prevMaxHp);
      p2.hp = Math.min(p2.stats.maxHp, p2.hp + hpGain);
      sfx.playPickup(true);
      this.emitHud();
      this.triggerCheckpoint();
      return true;
    }

    if (this.skillPoints <= 0) return false;
    if (this.unlockedNodeIds.includes(nodeId)) return false;
    const node = SKILL_TREE_NODES.find((n) => n.id === nodeId);
    if (!node) return false;
    const hasParent =
      node.requires.length === 0 ||
      node.requires.some((req) => this.unlockedNodeIds.includes(req));
    if (!hasParent) return false;

    this.skillPoints--;
    this.unlockedNodeIds = [...this.unlockedNodeIds, nodeId];
    if (node.unlocksSkill && !this.unlockedSkills.includes(node.unlocksSkill)) {
      this.unlockedSkills = [...this.unlockedSkills, node.unlocksSkill];
      if (!this.equippedSlots.Q) this.equippedSlots.Q = node.unlocksSkill;
      else if (!this.equippedSlots.E) this.equippedSlots.E = node.unlocksSkill;
      else if (!this.equippedSlots.R) this.equippedSlots.R = node.unlocksSkill;
    }

    const prevMaxHp = this.stats.maxHp;
    this.recomputeStats();
    const hpGain = Math.max(0, this.stats.maxHp - prevMaxHp);
    this.hp = Math.min(this.stats.maxHp, this.hp + hpGain);
    const nextTitle = computeHybridClassTitle(this.archetype, this.unlockedNodeIds);
    if (nextTitle !== ARCHETYPES[this.archetype].name) {
      this.callbacks.onAchievementEvent?.({ hybridClassesForged: { mode: 'max', value: 1 } });
    }
    sfx.playPickup(true);
    this.sendCoopBuildUpdate();
    this.emitHud();
    this.triggerCheckpoint();
    return true;
  }

  assignSkillSlot(slot: SkillSlotKey, skillId: ActiveSkillId | null, playerNum: 1 | 2 = 1) {
    if (playerNum === 2 && this.p2) {
      const p2 = this.p2;
      if (skillId && !p2.unlockedSkills.includes(skillId)) return;
      const slots: SkillSlotKey[] = ['Q', 'E', 'R'];
      for (const s of slots) {
        if (s !== slot && p2.equippedSlots[s] === skillId) {
          p2.equippedSlots[s] = p2.equippedSlots[slot];
        }
      }
      p2.equippedSlots[slot] = skillId;
      p2.skillCooldowns[slot] = 0;
      this.emitHud();
      this.triggerCheckpoint();
      return;
    }

    if (skillId && !this.unlockedSkills.includes(skillId)) return;
    const slots: SkillSlotKey[] = ['Q', 'E', 'R'];
    for (const s of slots) {
      if (s !== slot && this.equippedSlots[s] === skillId) {
        this.equippedSlots[s] = this.equippedSlots[slot];
      }
    }
    this.equippedSlots[slot] = skillId;
    this.skillCooldowns[slot] = 0;
    this.sendCoopBuildUpdate();
    this.emitHud();
    this.triggerCheckpoint();
  }

  equipItem(itemId: string, playerNum: 1 | 2 = 1) {
    if (playerNum === 2 && this.p2) {
      const p2 = this.p2;
      const idx = p2.inventory.findIndex((i) => i.id === itemId);
      if (idx === -1) return;
      const item = p2.inventory[idx];
      const nextInv = [...p2.inventory];
      nextInv.splice(idx, 1);

      if (item.slot === 'weapon') {
        nextInv.push(p2.equippedWeapon);
        p2.equippedWeapon = item;
      } else {
        if (p2.equippedRelic) nextInv.push(p2.equippedRelic);
        p2.equippedRelic = item;
      }

      p2.inventory = nextInv;
      this.recomputeStatsForP2();
      p2.hp = Math.min(p2.hp, p2.stats.maxHp);
      p2.mana = Math.min(p2.mana, p2.stats.maxMana);
      sfx.playPickup(false);
      this.emitHud();
      this.triggerCheckpoint();
      return;
    }

    const idx = this.inventory.findIndex((i) => i.id === itemId);
    if (idx === -1) return;
    const item = this.inventory[idx];
    const nextInv = [...this.inventory];
    nextInv.splice(idx, 1);

    if (item.slot === 'weapon') {
      nextInv.push(this.equippedWeapon);
      this.equippedWeapon = item;
    } else {
      if (this.equippedRelic) nextInv.push(this.equippedRelic);
      this.equippedRelic = item;
    }

    this.inventory = nextInv;
    this.recomputeStats();
    this.hp = Math.min(this.hp, this.stats.maxHp);
    this.mana = Math.min(this.mana, this.stats.maxMana);
    if (item.rarity === 'relic') {
      this.callbacks.onAchievementEvent?.({ relicRarityObtained: { mode: 'max', value: 1 } });
    }
    sfx.playPickup(false);
    this.sendCoopBuildUpdate();
    this.emitHud();
    this.triggerCheckpoint();
  }

  salvageItem(itemId: string, playerNum: 1 | 2 = 1) {
    if (playerNum === 2 && this.p2) {
      const p2 = this.p2;
      const idx = p2.inventory.findIndex((i) => i.id === itemId);
      if (idx === -1) return;
      const item = p2.inventory[idx];
      this.gold += item.valueGold;
      p2.inventory = p2.inventory.filter((i) => i.id !== itemId);
      sfx.playPickup(false);
      this.emitHud();
      this.triggerCheckpoint();
      return;
    }

    const idx = this.inventory.findIndex((i) => i.id === itemId);
    if (idx === -1) return;
    const item = this.inventory[idx];
    this.gold += item.valueGold;
    this.inventory = this.inventory.filter((i) => i.id !== itemId);
    sfx.playPickup(false);
    this.sendCoopBuildUpdate();
    this.emitHud();
    this.triggerCheckpoint();
  }

  // ==================== ADMIN HUD CONTROLS ====================
  getAdminFlags(): AdminFlags {
    return { ...this.adminFlags };
  }

  setAdminFlag(patch: Partial<AdminFlags>) {
    this.adminFlags = { ...this.adminFlags, ...patch };
    if (patch.revealMinimap) {
      this.adminRevealFullMap();
    }
    if (this.adminFlags.infiniteMana) {
      this.mana = this.stats.maxMana;
      if (this.p2) this.p2.mana = this.p2.stats.maxMana;
    }
    if (this.adminFlags.zeroCooldowns) {
      this.dashCooldown = 0;
      this.skillCooldowns = { Q: 0, E: 0, R: 0 };
      if (this.p2) {
        this.p2.dashCooldown = 0;
        this.p2.skillCooldowns = { Q: 0, E: 0, R: 0 };
      }
    }
    this.emitHud();
  }

  adminHealFull() {
    if (!this.floor) return;
    this.isDowned = false;
    this.hp = this.stats.maxHp;
    this.mana = this.stats.maxMana;
    this.flaskCharges = this.maxFlaskCharges;
    this.shield = Math.max(this.shield, Math.round(this.stats.maxHp * 0.25));
    this.shieldTimer = Math.max(this.shieldTimer, 5);
    if (this.p2) {
      this.p2.isDowned = false;
      this.p2.hp = this.p2.stats.maxHp;
      this.p2.mana = this.p2.stats.maxMana;
      this.p2.flaskCharges = this.p2.maxFlaskCharges;
    }
    sfx.playFlask();
    this.spawnParticles(this.px, this.py, 22, '#10B981', 140, 0.45);
    this.spawnFloatingText(this.px, this.py - 30, 'Restauración Admin', '#10B981', 1.15);
    this.emitHud();
  }

  adminAddGold(amount: number) {
    this.gold = Math.max(0, this.gold + Math.round(amount));
    sfx.playPickup(false);
    this.spawnFloatingText(this.px, this.py - 28, `+${amount} Oro`, '#F59E0B', 1.05);
    this.emitHud();
  }

  adminAddSouls(amount: number) {
    const clean = Math.round(amount);
    if (this.screen === 'PLAYING' || this.screen === 'PAUSED') {
      this.soulsThisRun = Math.max(0, this.soulsThisRun + clean);
      this.spawnFloatingText(this.px, this.py - 28, `+${clean} Almas`, '#A78BFA', 1.15);
    }
    this.callbacks.onAdminGrantSouls?.(clean);
    sfx.playPickup(true);
    this.emitHud();
  }

  adminLevelUp(levels = 1) {
    for (let i = 0; i < levels; i++) {
      this.grantXp(this.xpToNext - this.xp);
      if (this.localCoopMode && this.p2) {
        this.grantXpP2(this.p2.xpToNext - this.p2.xp);
      }
    }
    this.emitHud();
    this.triggerCheckpoint();
  }

  adminAddSkillPoints(pts = 3) {
    this.skillPoints += Math.max(1, Math.round(pts));
    if (this.p2) this.p2.skillPoints += Math.max(1, Math.round(pts));
    sfx.playLevelUp();
    this.emitHud();
  }

  adminUnlockAllSkills() {
    for (const node of SKILL_TREE_NODES) {
      if (!this.unlockedNodeIds.includes(node.id)) {
        this.unlockedNodeIds.push(node.id);
      }
      if (node.unlocksSkill && !this.unlockedSkills.includes(node.unlocksSkill)) {
        this.unlockedSkills.push(node.unlocksSkill);
      }
    }
    if (!this.equippedSlots.Q && this.unlockedSkills[0]) this.equippedSlots.Q = this.unlockedSkills[0];
    if (!this.equippedSlots.E && this.unlockedSkills[1]) this.equippedSlots.E = this.unlockedSkills[1];
    if (!this.equippedSlots.R && this.unlockedSkills[2]) this.equippedSlots.R = this.unlockedSkills[2];
    this.recomputeStats();
    this.hp = this.stats.maxHp;
    this.mana = this.stats.maxMana;
    if (this.p2) {
      for (const node of SKILL_TREE_NODES) {
        if (!this.p2.unlockedNodeIds.includes(node.id)) {
          this.p2.unlockedNodeIds.push(node.id);
        }
        if (node.unlocksSkill && !this.p2.unlockedSkills.includes(node.unlocksSkill)) {
          this.p2.unlockedSkills.push(node.unlocksSkill);
        }
      }
      this.recomputeStatsForP2();
      this.p2.hp = this.p2.stats.maxHp;
      this.p2.mana = this.p2.stats.maxMana;
    }
    sfx.playVictory();
    this.showBanner('Admin: Todas las sendas y habilidades desbloqueadas');
    this.sendCoopBuildUpdate();
    this.emitHud();
    this.triggerCheckpoint();
  }

  adminResetFlags() {
    this.setAdminFlag({
      godMode: false,
      infiniteMana: false,
      zeroCooldowns: false,
      oneHitKill: false,
      revealMinimap: false,
      freezeEnemies: false,
      autoLoot: false,
      showHitboxes: false,
      speedMultiplier: 1,
      damageMultiplier: 1,
    });
    this.showBanner('Admin: Todos los modificadores restablecidos');
  }

  adminRefillFlasks() {
    this.flaskCharges = this.maxFlaskCharges;
    if (this.p2) this.p2.flaskCharges = this.p2.maxFlaskCharges;
    sfx.playPickup(false);
    this.spawnFloatingText(this.px, this.py - 28, 'Frascos Recargados', '#EF4444', 1.0);
    this.emitHud();
  }

  adminReviveHeroes() {
    if (!this.floor) return;
    this.isDowned = false;
    this.hp = Math.max(this.hp, Math.round(this.stats.maxHp * 0.75));
    if (this.p2) {
      this.p2.isDowned = false;
      this.p2.hp = Math.max(this.p2.hp, Math.round(this.p2.stats.maxHp * 0.75));
    }
    sfx.playShrine();
    this.spawnParticles(this.px, this.py, 20, '#38BDF8', 130, 0.4);
    this.showBanner('Admin: Héroes reanimados');
    this.emitHud();
  }

  adminChangeArchetype(arch: ArchetypeId) {
    if (this.pvpMode || this.coopMode) return;
    const def = ARCHETYPES[arch];
    if (!def) return;
    this.archetype = arch;
    this.equippedWeapon = structuredClone(def.startingWeapon);
    if (!this.unlockedNodeIds.includes(def.startingNodeId)) {
      this.unlockedNodeIds.push(def.startingNodeId);
    }
    for (const sk of def.startingSkills) {
      if (sk && !this.unlockedSkills.includes(sk)) {
        this.unlockedSkills.push(sk);
      }
    }
    this.recomputeStats();
    this.hp = Math.min(this.stats.maxHp, Math.max(this.hp, this.stats.maxHp));
    this.mana = this.stats.maxMana;
    sfx.playLevelUp();
    this.showBanner(`Admin: Clase cambiada a ${def.name}`);
    this.emitHud();
    this.triggerCheckpoint();
  }

  adminForgeItem(kind: WeaponKind | 'relic', rarity: Rarity, autoEquip = false) {
    const floorNum = Math.max(1, this.floor?.floorNumber || 1);
    let forged: ItemData | null = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      const candidate = generateLootItem(floorNum + 1, 5, rarity);
      if (kind === 'relic' && candidate.slot === 'relic') {
        forged = candidate;
        break;
      }
      if (kind !== 'relic' && candidate.slot === 'weapon' && candidate.weaponKind === kind) {
        forged = candidate;
        break;
      }
    }
    if (!forged) {
      forged = generateLootItem(floorNum + 1, 5, rarity);
      if (kind !== 'relic') {
        forged.slot = 'weapon';
        forged.weaponKind = kind;
      }
    }
    if (autoEquip) {
      if (forged.slot === 'weapon') {
        if (this.equippedWeapon) {
          this.inventory = [this.equippedWeapon, ...this.inventory].slice(0, 22);
        }
        this.equippedWeapon = forged;
      } else {
        if (this.equippedRelic) {
          this.inventory = [this.equippedRelic, ...this.inventory].slice(0, 22);
        }
        this.equippedRelic = forged;
      }
      this.recomputeStats();
      this.hp = Math.min(this.stats.maxHp, this.hp);
      this.sendCoopBuildUpdate();
    } else {
      this.inventory = [forged, ...this.inventory].slice(0, 22);
    }
    if (forged.rarity === 'relic') {
      this.callbacks.onAchievementEvent?.({ relicRarityObtained: { mode: 'max', value: 1 } });
    }
    sfx.playPickup(true);
    this.spawnFloatingText(this.px, this.py - 32, forged.name, RARITY_COLORS[rarity], 1.1);
    this.showBanner(`${autoEquip ? 'Forjado y equipado' : 'Forjado'}: ${forged.name}`);
    this.emitHud();
    this.triggerCheckpoint();
  }

  adminClearInventory() {
    this.inventory = [];
    this.showBanner('Admin: Inventario vaciado');
    this.emitHud();
    this.triggerCheckpoint();
  }

  adminSpawnProp(kind: 'chest' | 'shrine' | 'portal') {
    if (!this.floor || this.coopMode || this.pvpMode) return;
    if (kind === 'portal') {
      this.adminOpenBossPortal();
      return;
    }
    let sx = this.px + 54;
    let sy = this.py;
    if (this.collidesWall(sx, sy, 18)) {
      sx = this.px - 54;
      sy = this.py;
    }
    if (this.collidesWall(sx, sy, 18)) {
      sx = this.px;
      sy = this.py + 54;
    }
    const variants: Array<'blood' | 'arcane' | 'sanctum'> = ['blood', 'arcane', 'sanctum'];
    const shrineVariant = variants[this.idCounter % variants.length];
    this.floor.props.push({
      id: `admin_${kind}_${this.idCounter++}`,
      kind,
      shrineVariant: kind === 'shrine' ? shrineVariant : undefined,
      x: sx,
      y: sy,
      radius: 22,
      interacted: false,
      broken: false,
    });
    sfx.playShrine();
    this.spawnParticles(sx, sy, 16, kind === 'chest' ? '#F59E0B' : '#A78BFA', 95, 0.35);
    this.showBanner(kind === 'chest' ? 'Admin: Cofre del Tesoro invocado' : 'Admin: Santuario invocado');
    this.emitHud();
  }

  adminTeleportToRoom(type: 'start' | 'boss' | 'treasure' | 'shrine') {
    if (!this.floor) return;
    const targetRoom =
      type === 'boss'
        ? this.floor.rooms[this.floor.bossRoomId]
        : this.floor.rooms.find((r) => r.type === type) ?? this.floor.rooms[0];
    if (!targetRoom) return;
    const tx = (targetRoom.cx + 0.5) * this.floor.tileSize;
    const ty =
      type === 'boss'
        ? (targetRoom.y + 2) * this.floor.tileSize
        : (targetRoom.cy + 0.5) * this.floor.tileSize;
    this.px = tx;
    this.py = ty;
    this.camX = tx;
    this.camY = ty;
    if (this.p2) {
      this.p2.x = tx + 22;
      this.p2.y = ty;
    }
    this.updateVisibility();
    sfx.playShrine();
    const labelMap: Record<typeof type, string> = {
      start: 'Sala Inicial',
      boss: 'Santuario del Jefe',
      treasure: 'Sala del Tesoro',
      shrine: 'Santuario Arcano',
    };
    this.showBanner(`Admin: Teletransportado a ${labelMap[type]}`);
    this.emitHud();
  }

  adminRegenerateFloor(newSeedLabel?: string) {
    if (!this.floor || this.coopMode || this.pvpMode) return;
    const currentFloorNum = Math.max(1, this.floor.floorNumber || 1);
    if (newSeedLabel && newSeedLabel.trim()) {
      const normalized = normalizeSeedInput(newSeedLabel);
      this.runSeed = normalized.numeric;
      this.runSeedLabel = normalized.label;
    }
    this.initFloor(currentFloorNum, false);
    this.hp = this.stats.maxHp;
    this.mana = this.stats.maxMana;
    if (this.adminFlags.revealMinimap) this.adminRevealFullMap();
    sfx.playShrine();
    this.showBanner(`Admin: Piso ${currentFloorNum} regenerado (${this.runSeedLabel})`);
    this.emitHud();
    this.triggerCheckpoint();
  }

  getAdminDiagnostics(): AdminDiagnosticsSnapshot {
    const inRun = this.screen === 'PLAYING' || this.screen === 'PAUSED';
    const ts = this.floor?.tileSize || 44;
    const modeLabel = this.pvpMode
      ? this.pvpMode === 'online'
        ? 'Arena PvP Red'
        : 'Arena PvP Local'
      : this.coopMode
      ? 'Cooperativo en Línea'
      : this.localCoopMode
      ? '2 Jugadores Local'
      : inRun
      ? 'Solo'
      : 'Santuario';
    return {
      inRun,
      modeLabel,
      floorNumber: this.floor?.floorNumber ?? 0,
      floorName: this.floor?.name ?? 'Santuario Inicial',
      runSeedLabel: this.runSeedLabel,
      px: Math.round(this.px),
      py: Math.round(this.py),
      tileX: Math.floor(this.px / ts),
      tileY: Math.floor(this.py / ts),
      enemiesAlive: this.enemies.filter((e) => e.hp > 0).length,
      projectilesActive: this.projectiles.filter((p) => p.active).length,
      lootOnGround: this.loot.length,
      roomsTotal: this.floor?.rooms.length ?? 0,
      roomsDiscovered: this.floor?.rooms.filter((r) => r.discovered).length ?? 0,
      heroLevel: this.level,
      heroHp: Math.ceil(this.hp),
      heroMaxHp: this.stats?.maxHp ?? 0,
      heroBaseDamage: Math.round(this.stats?.baseDamage ?? 0),
      heroArcanePower: Math.round(this.stats?.arcanePower ?? 0),
      heroArmor: Math.round(this.stats?.armor ?? 0),
      heroCritChance: Math.round((this.stats?.critChance ?? 0) * 100),
      heroMoveSpeed: Math.round(this.stats?.moveSpeed ?? 0),
      heroKills: this.kills,
      heroGold: this.gold,
      inventoryCount: this.inventory.length,
    };
  }

  adminSpawnEnemy(type: EnemyType, count = 1) {
    if (!this.floor || this.coopMode) return;
    const f = this.floor.floorNumber;
    const scale = 1 + (f - 1) * ENEMY_SCALING.floorFactor;
    const currentRoom =
      this.floor.rooms.find(
        (r) =>
          this.px >= r.x * this.floor.tileSize &&
          this.px <= (r.x + r.w) * this.floor.tileSize &&
          this.py >= r.y * this.floor.tileSize &&
          this.py <= (r.y + r.h) * this.floor.tileSize
      ) ?? this.floor.rooms[0];

    for (let i = 0; i < count; i++) {
      const ang = (i / Math.max(1, count)) * Math.PI * 2 + Math.random() * 0.5;
      let sx = this.px + Math.cos(ang) * 105;
      let sy = this.py + Math.sin(ang) * 105;
      if (this.collidesWall(sx, sy, 22)) {
        sx = this.px + (Math.random() - 0.5) * 40;
        sy = this.py + (Math.random() - 0.5) * 40;
      }
      const spawned = this.createEnemy(type, sx, sy, scale, currentRoom.id, f);
      spawned.state = 'chase';
      this.enemies.push(spawned);
      this.spawnParticles(sx, sy, 14, spawned.isBoss ? '#EF4444' : '#A855F7', 110, 0.35);
    }
    this.showBanner(`Admin: Invocado ${ENEMY_DEFINITIONS[type]?.name ?? type}`);
    this.emitHud();
  }

  adminKillCurrentRoom() {
    if (!this.floor || this.coopMode) return;
    const ts = this.floor.tileSize;
    const currentRoom = this.floor.rooms.find(
      (r) =>
        this.px >= r.x * ts &&
        this.px <= (r.x + r.w) * ts &&
        this.py >= r.y * ts &&
        this.py <= (r.y + r.h) * ts
    );
    const targets = currentRoom
      ? this.enemies.filter((e) => e.roomId === currentRoom.id)
      : this.enemies.filter((e) => Math.hypot(e.x - this.px, e.y - this.py) < 420);
    for (const e of [...targets]) {
      this.damageEnemy(e, e.hp + 9999, true, '#F59E0B', 0, 0, false, this.getHeroState(1));
    }
    this.emitHud();
  }

  adminKillAllFloor() {
    if (!this.floor || this.coopMode) return;
    for (const e of [...this.enemies]) {
      this.damageEnemy(e, e.hp + 9999, true, '#F59E0B', 0, 0, false, this.getHeroState(1));
    }
    this.emitHud();
  }

  adminOpenBossPortal() {
    if (!this.floor) return;
    const existing = this.floor.props.find((p) => p.kind === 'portal');
    if (existing) {
      existing.x = this.px + 48;
      existing.y = this.py;
      this.showBanner('Admin: Portal trasladado junto a ti');
    } else {
      let portalX = this.px + 54;
      let portalY = this.py;
      if (this.collidesWall(portalX, portalY, 20)) {
        portalX = this.px;
        portalY = this.py;
      }
      this.floor.props.push({
        id: `portal_${this.idCounter++}`,
        kind: 'portal',
        x: portalX,
        y: portalY,
        radius: 26,
        interacted: false,
        broken: false,
      });
      this.showBanner('Admin: Portal de descenso invocado');
    }
    sfx.playShrine();
    this.emitHud();
  }

  adminJumpToFloor(floorNum: number) {
    if (this.coopMode) return;
    const targetFloor = Math.max(1, Math.min(999, Math.floor(floorNum)));
    if (this.screen === 'TITLE') {
      this.startRun(this.archetype, this.runSeedLabel);
    }
    this.runReported = false;
    this.screen = 'PLAYING';
    this.initFloor(targetFloor, false);
    this.isDowned = false;
    this.hp = this.stats.maxHp;
    this.mana = this.stats.maxMana;
    if (this.adminFlags.revealMinimap) this.adminRevealFullMap();
    sfx.playShrine();
    this.showBanner(`Admin: Salto directo al Piso ${targetFloor} · ${this.floor.name}`);
    this.emitHud();
    this.triggerCheckpoint();
  }

  adminTeleportToBoss() {
    if (!this.floor) return;
    const bossRoom = this.floor.rooms[this.floor.bossRoomId];
    if (!bossRoom) return;
    const tx = (bossRoom.cx + 0.5) * this.floor.tileSize;
    const ty = (bossRoom.y + 2) * this.floor.tileSize;
    this.px = tx;
    this.py = ty;
    this.camX = tx;
    this.camY = ty;
    if (this.p2) {
      this.p2.x = tx + 22;
      this.p2.y = ty;
    }
    this.updateVisibility();
    sfx.playShrine();
    this.showBanner('Admin: Teletransportado al Santuario del Jefe');
    this.emitHud();
  }

  adminRevealFullMap() {
    if (!this.floor) return;
    this.floor.visibility.fill(2);
    for (const r of this.floor.rooms) {
      r.discovered = true;
    }
    this.emitHud();
  }

  private sendCoopBuildUpdate() {
    if (!this.coopMode) return;
    coopClient.send({
      type: 'player:build',
      buildState: {
        archetype: this.archetype,
        level: this.level,
        unlockedNodeIds: [...this.unlockedNodeIds],
        unlockedSkills: [...this.unlockedSkills],
        equippedSlots: { ...this.equippedSlots },
        equippedWeapon: structuredClone(this.equippedWeapon),
        equippedRelic: this.equippedRelic ? structuredClone(this.equippedRelic) : null,
        inventory: structuredClone(this.inventory),
        blessings: { ...this.meta.blessings },
      },
    });
  }

  destroy() {
    this.destroyed = true;
    this.leaveCoopRoom();
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('pointercancel', this.handlePointerUp);
    this.canvas.removeEventListener('contextmenu', this.handleContextMenu);
  }

  private recomputeStats() {
    this.stats = computePlayerStats(
      this.archetype,
      this.level,
      this.unlockedNodeIds,
      this.equippedWeapon,
      this.equippedRelic,
      this.meta
    );
    if (this.p2) this.recomputeStatsForP2();
  }

  private recomputeStatsForP2() {
    if (!this.p2) return;
    this.p2.stats = computePlayerStats(
      this.p2.archetype,
      this.p2.level,
      this.p2.unlockedNodeIds,
      this.p2.equippedWeapon,
      this.p2.equippedRelic,
      this.meta
    );
  }

  private initFloor(floorNumber: number, silent = false) {
    const floorSeed = deriveFloorSeed(this.runSeed || 1, floorNumber);
    this.floor = generateDungeonFloor(floorNumber, floorSeed);
    this.px = this.localCoopMode ? this.floor.spawnX - 20 : this.floor.spawnX;
    this.py = this.floor.spawnY;
    if (this.p2) {
      this.p2.x = this.floor.spawnX + 20;
      this.p2.y = this.floor.spawnY;
      this.p2.vx = 0;
      this.p2.vy = 0;
      this.p2.isDowned = false;
    }
    this.camX = this.floor.spawnX;
    this.camY = this.floor.spawnY;

    this.enemies = [];
    this.loot = [];
    this.slashes = [];
    this.ghosts = [];
    this.rings = [];
    for (const p of this.projectiles) p.active = false;

    if (!silent) {
      this.populateFloorEnemies(floorSeed);
      this.updateVisibility();
    }
    this.callbacks.onAchievementEvent?.({ bestFloor: { mode: 'max', value: floorNumber } });
  }

  private populateFloorEnemies(floorSeed: number) {
    const rng = createSeededRng(floorSeed ^ 0x9e3779b9);
    const f = this.floor.floorNumber;
    const ts = this.floor.tileSize;
    const scale = 1 + (f - 1) * ENEMY_SCALING.floorFactor;

    for (const room of this.floor.rooms) {
      if (room.type === 'combat') {
        const count = Math.min(7, 3 + f + Math.floor(rng() * 2));
        for (let i = 0; i < count; i++) {
          const ex = (room.x + 1.5 + rng() * (room.w - 3)) * ts;
          const ey = (room.y + 1.5 + rng() * (room.h - 3)) * ts;
          const roll = rng();
          let type: EnemyType = 'skeleton';
          if (roll > 0.78 && f >= 1) type = 'golem';
          else if (roll > 0.52) type = 'cultist';
          else if (roll > 0.32 && (f >= 2 || rng() < 0.45)) type = 'wraith';

          this.enemies.push(this.createEnemy(type, ex, ey, scale, room.id, f));
        }
      } else if (room.type === 'boss') {
        const bossType: EnemyType = f % 2 === 1 ? 'boss_warden' : 'boss_archon';
        const bx = (room.cx + 0.5) * ts;
        const by = (room.cy + 0.5) * ts;
        this.enemies.push(this.createEnemy(bossType, bx, by, scale, room.id, f));
      }
    }
  }

  private createEnemy(
    type: EnemyType,
    x: number,
    y: number,
    scale: number,
    roomId: number,
    floorNumber = this.floor?.floorNumber || 1
  ): EnemyEntity {
    const def = ENEMY_DEFINITIONS[type] ?? ENEMY_DEFINITIONS.skeleton;
    if (def.isBoss) {
      const localCount = this.localCoopMode && this.p2 ? 2 : 1;
      const bm = getBossFloorMultipliers(floorNumber, localCount);
      const maxHp = Math.round(def.baseHp * bm.hpMult);
      return {
        id: `enemy_${this.idCounter++}`,
        type: def.type,
        name: getBossDisplayName(def.name, floorNumber),
        isBoss: true,
        x,
        y,
        vx: 0,
        vy: 0,
        radius: def.radius,
        hp: maxHp,
        maxHp,
        speed: Math.round(def.speed * bm.speedMult),
        damage: Math.round(def.damage * bm.damageMult),
        xpValue: Math.round(def.xpValue * bm.xpMult),
        goldValue: Math.round(def.goldValue * bm.goldMult),
        facing: 0,
        state: 'idle',
        stateTimer: 0,
        attackCooldown: Math.max(0.5, def.initialCooldown * bm.cooldownMult),
        hitFlash: 0,
        bleedTimer: 0,
        bleedDps: 0,
        slowTimer: 0,
        squashX: 1,
        squashY: 1,
        telegraph: null,
        bossPatternIndex: 0,
        roomId,
        enraged: false,
        floorNumber,
      };
    }

    const maxHp = Math.round(def.baseHp * scale);
    return {
      id: `enemy_${this.idCounter++}`,
      type: def.type,
      name: def.name,
      isBoss: false,
      x,
      y,
      vx: 0,
      vy: 0,
      radius: def.radius,
      hp: maxHp,
      maxHp,
      speed: def.speed,
      damage: Math.round(def.damage * scale),
      xpValue: Math.round(def.xpValue * scale),
      goldValue: Math.round(def.goldValue * scale),
      facing: 0,
      state: 'idle',
      stateTimer: 0,
      attackCooldown: def.initialCooldown,
      hitFlash: 0,
      bleedTimer: 0,
      bleedDps: 0,
      slowTimer: 0,
      squashX: 1,
      squashY: 1,
      telegraph: null,
      bossPatternIndex: 0,
      roomId,
    };
  }

  private bindEvents() {
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('pointercancel', this.handlePointerUp);
    this.canvas.addEventListener('contextmenu', this.handleContextMenu);
  }

  private handleResize = () => {
    const parent = this.canvas.parentElement;
    const w = parent ? parent.clientWidth : window.innerWidth;
    const h = parent ? parent.clientHeight : window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.viewW = Math.max(320, w);
    this.viewH = Math.max(240, h);
    const minDim = Math.min(this.viewW, this.viewH);
    this.baseCamScale = minDim < 620 ? Math.max(0.76, minDim / 640) : 1;
    this.camScale = this.baseCamScale;
    this.canvas.width = Math.floor(this.viewW * this.dpr);
    this.canvas.height = Math.floor(this.viewH * this.dpr);
    this.canvas.style.width = `${this.viewW}px`;
    this.canvas.style.height = `${this.viewH}px`;
  };

  private handleBlur = () => {
    this.heldKeys.clear();
    this.mouseDown = false;
    this.touchMoveX = 0;
    this.touchMoveY = 0;
    this.touchAttackHeld = false;
    if (this.p2) {
      this.p2.touchMoveX = 0;
      this.p2.touchMoveY = 0;
      this.p2.touchAttackHeld = false;
    }
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    const code = e.code;
    this.heldKeys.add(code);
    if (this.screen !== 'PLAYING') return;

    const now = performance.now();
    // P1 keyboard bindings
    if (code === 'Space') {
      e.preventDefault();
      this.bufferedAction = { type: 'dash', expires: now + 140 };
    } else if (code === 'KeyQ') {
      this.bufferedAction = { type: 'skill', slot: 'Q', expires: now + 140 };
    } else if (code === 'KeyE') {
      this.bufferedAction = { type: 'skill', slot: 'E', expires: now + 140 };
    } else if (code === 'KeyR') {
      this.bufferedAction = { type: 'skill', slot: 'R', expires: now + 140 };
    } else if (code === 'Digit1') {
      this.bufferedAction = { type: 'flask', expires: now + 140 };
    } else if (code === 'KeyF') {
      this.bufferedAction = { type: 'interact', expires: now + 140 };
    } else if (code === 'KeyG') {
      this.bufferedAction = { type: 'attack', expires: now + 120 };
    }

    // P2 keyboard bindings in Local Co-op
    if (this.localCoopMode && this.p2) {
      if (code === 'ArrowUp' || code === 'ArrowDown' || code === 'ArrowLeft' || code === 'ArrowRight') {
        e.preventDefault();
      }
      if (code === 'KeyM' || code === 'Numpad0' || code === 'Enter') {
        e.preventDefault();
        this.p2.bufferedAction = { type: 'attack', expires: now + 120 };
      } else if (code === 'ShiftRight' || code === 'NumpadDecimal') {
        this.p2.bufferedAction = { type: 'dash', expires: now + 140 };
      } else if (code === 'KeyU' || code === 'Numpad1') {
        this.p2.bufferedAction = { type: 'skill', slot: 'Q', expires: now + 140 };
      } else if (code === 'KeyI' || code === 'Numpad2') {
        this.p2.bufferedAction = { type: 'skill', slot: 'E', expires: now + 140 };
      } else if (code === 'KeyO' || code === 'Numpad3') {
        this.p2.bufferedAction = { type: 'skill', slot: 'R', expires: now + 140 };
      } else if (code === 'KeyP' || code === 'NumpadAdd') {
        this.p2.bufferedAction = { type: 'flask', expires: now + 140 };
      } else if (code === 'KeyL' || code === 'NumpadEnter') {
        this.p2.bufferedAction = { type: 'interact', expires: now + 140 };
      }
    }
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    this.heldKeys.delete(e.code);
  };

  private handlePointerMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') {
      this.lastInputType = 'touch';
      return;
    }
    this.lastInputType = 'mouse';
    const rect = this.canvas.getBoundingClientRect();
    this.mouseScreenX = e.clientX - rect.left;
    this.mouseScreenY = e.clientY - rect.top;
  };

  private handlePointerDown = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') {
      this.lastInputType = 'touch';
      this.mouseDown = false;
      return;
    }
    this.lastInputType = 'mouse';
    const rect = this.canvas.getBoundingClientRect();
    this.mouseScreenX = e.clientX - rect.left;
    this.mouseScreenY = e.clientY - rect.top;
    if (this.screen !== 'PLAYING') return;

    const now = performance.now();
    if (e.button === 0) {
      this.mouseDown = true;
      if (!this.bufferedAction || this.bufferedAction.type === 'attack') {
        this.bufferedAction = { type: 'attack', expires: now + 120 };
      }
    } else if (e.button === 2) {
      this.bufferedAction = { type: 'dash', expires: now + 140 };
    }
  };

  private handlePointerUp = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.button === 0) {
      this.mouseDown = false;
    }
  };

  private handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
  };

  private loop = (now: number) => {
    if (this.destroyed) return;
    const rawDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    const dt = Math.min(Math.max(rawDt, 0.001), 0.05);

    if (this.screen === 'PLAYING' || (this.coopMode && this.screen === 'PAUSED')) {
      this.updateSimulation(dt, now);
    } else if (this.screen === 'TITLE') {
      this.worldTime += dt;
    }

    this.render();
    this.rafId = requestAnimationFrame(this.loop);
  };

  private getHeroState(heroNum: 1 | 2) {
    if (heroNum === 2 && this.p2) {
      const p2 = this.p2;
      return {
        num: 2 as const,
        label: 'J2',
        color: '#38BDF8',
        get archetype() { return p2.archetype; },
        get x() { return p2.x; },
        set x(v: number) { p2.x = v; },
        get y() { return p2.y; },
        set y(v: number) { p2.y = v; },
        get vx() { return p2.vx; },
        set vx(v: number) { p2.vx = v; },
        get vy() { return p2.vy; },
        set vy(v: number) { p2.vy = v; },
        get facing() { return p2.facing; },
        set facing(v: number) { p2.facing = v; },
        get squashX() { return p2.squashX; },
        set squashX(v: number) { p2.squashX = v; },
        get squashY() { return p2.squashY; },
        set squashY(v: number) { p2.squashY = v; },
        get hitFlash() { return p2.hitFlash; },
        set hitFlash(v: number) { p2.hitFlash = v; },
        get invuln() { return p2.invuln; },
        set invuln(v: number) { p2.invuln = v; },
        get dashTimer() { return p2.dashTimer; },
        set dashTimer(v: number) { p2.dashTimer = v; },
        get dashDirX() { return p2.dashDirX; },
        set dashDirX(v: number) { p2.dashDirX = v; },
        get dashDirY() { return p2.dashDirY; },
        set dashDirY(v: number) { p2.dashDirY = v; },
        get dashCooldown() { return p2.dashCooldown; },
        set dashCooldown(v: number) { p2.dashCooldown = v; },
        get attackCooldown() { return p2.attackCooldown; },
        set attackCooldown(v: number) { p2.attackCooldown = v; },
        get comboStep() { return p2.comboStep; },
        set comboStep(v: number) { p2.comboStep = v; },
        get comboResetTimer() { return p2.comboResetTimer; },
        set comboResetTimer(v: number) { p2.comboResetTimer = v; },
        get guaranteedCrit() { return p2.guaranteedCrit; },
        set guaranteedCrit(v: boolean) { p2.guaranteedCrit = v; },
        get level() { return p2.level; },
        get hp() { return p2.hp; },
        set hp(v: number) { p2.hp = v; },
        get mana() { return p2.mana; },
        set mana(v: number) { p2.mana = v; },
        get shield() { return p2.shield; },
        set shield(v: number) { p2.shield = v; },
        get shieldTimer() { return p2.shieldTimer; },
        set shieldTimer(v: number) { p2.shieldTimer = v; },
        get flaskCharges() { return p2.flaskCharges; },
        set flaskCharges(v: number) { p2.flaskCharges = v; },
        get maxFlaskCharges() { return p2.maxFlaskCharges; },
        get equippedSlots() { return p2.equippedSlots; },
        get skillCooldowns() { return p2.skillCooldowns; },
        get equippedWeapon() { return p2.equippedWeapon; },
        get inventory() { return p2.inventory; },
        set inventory(v: ItemData[]) { p2.inventory = v; },
        get stats() { return p2.stats; },
        get isDowned() { return p2.isDowned; },
        set isDowned(v: boolean) { p2.isDowned = v; },
      };
    }
    const self = this;
    return {
      num: 1 as const,
      label: 'J1',
      color: ARCHETYPES[this.archetype].accentColor,
      get archetype() { return self.archetype; },
      get x() { return self.px; },
      set x(v: number) { self.px = v; },
      get y() { return self.py; },
      set y(v: number) { self.py = v; },
      get vx() { return self.pvx; },
      set vx(v: number) { self.pvx = v; },
      get vy() { return self.pvy; },
      set vy(v: number) { self.pvy = v; },
      get facing() { return self.pFacing; },
      set facing(v: number) { self.pFacing = v; },
      get squashX() { return self.pSquashX; },
      set squashX(v: number) { self.pSquashX = v; },
      get squashY() { return self.pSquashY; },
      set squashY(v: number) { self.pSquashY = v; },
      get hitFlash() { return self.pHitFlash; },
      set hitFlash(v: number) { self.pHitFlash = v; },
      get invuln() { return self.pInvuln; },
      set invuln(v: number) { self.pInvuln = v; },
      get dashTimer() { return self.dashTimer; },
      set dashTimer(v: number) { self.dashTimer = v; },
      get dashDirX() { return self.dashDirX; },
      set dashDirX(v: number) { self.dashDirX = v; },
      get dashDirY() { return self.dashDirY; },
      set dashDirY(v: number) { self.dashDirY = v; },
      get dashCooldown() { return self.dashCooldown; },
      set dashCooldown(v: number) { self.dashCooldown = v; },
      get attackCooldown() { return self.attackCooldown; },
      set attackCooldown(v: number) { self.attackCooldown = v; },
      get comboStep() { return self.comboStep; },
      set comboStep(v: number) { self.comboStep = v; },
      get comboResetTimer() { return self.comboResetTimer; },
      set comboResetTimer(v: number) { self.comboResetTimer = v; },
      get guaranteedCrit() { return self.guaranteedCrit; },
      set guaranteedCrit(v: boolean) { self.guaranteedCrit = v; },
      get level() { return self.level; },
      get hp() { return self.hp; },
      set hp(v: number) { self.hp = v; },
      get mana() { return self.mana; },
      set mana(v: number) { self.mana = v; },
      get shield() { return self.shield; },
      set shield(v: number) { self.shield = v; },
      get shieldTimer() { return self.shieldTimer; },
      set shieldTimer(v: number) { self.shieldTimer = v; },
      get flaskCharges() { return self.flaskCharges; },
      set flaskCharges(v: number) { self.flaskCharges = v; },
      get maxFlaskCharges() { return self.maxFlaskCharges; },
      get equippedSlots() { return self.equippedSlots; },
      get skillCooldowns() { return self.skillCooldowns; },
      get equippedWeapon() { return self.equippedWeapon; },
      get inventory() { return self.inventory; },
      set inventory(v: ItemData[]) { self.inventory = v; },
      get stats() { return self.stats; },
      get isDowned() { return self.isDowned; },
      set isDowned(v: boolean) { self.isDowned = v; },
    };
  }

  private pollGamepadForHero(pad: Gamepad | null, canControl: boolean, nowMs: number, heroNum: 1 | 2) {
    if (!pad) return { moveX: 0, moveY: 0, aimX: 0, aimY: 0, hasAimStick: false, attackHeld: false };

    const deadzone = 0.22;
    const rawLx = pad.axes[0] ?? 0;
    const rawLy = pad.axes[1] ?? 0;
    const moveX = Math.abs(rawLx) > deadzone ? rawLx : 0;
    const moveY = Math.abs(rawLy) > deadzone ? rawLy : 0;

    const rawRx = pad.axes[2] ?? 0;
    const rawRy = pad.axes[3] ?? 0;
    const hasAimStick = Math.hypot(rawRx, rawRy) > 0.28;

    const prev = this.prevGamepadButtons.get(pad.index) ?? [];
    const isDown = (idx: number) => {
      const b = pad.buttons[idx];
      return Boolean(b && (b.pressed || b.value > 0.45));
    };
    const justPressed = (idx: number) => isDown(idx) && !prev[idx];

    const setBuffered = (act: BufferedAction) => {
      if (heroNum === 2 && this.p2) this.p2.bufferedAction = act;
      else if (heroNum === 1) this.bufferedAction = act;
    };

    const attackHeld = canControl && (isDown(0) || isDown(7));
    if (canControl) {
      if (justPressed(0) || justPressed(7)) setBuffered({ type: 'attack', expires: nowMs + 130 });
      if (justPressed(1) || justPressed(4)) setBuffered({ type: 'dash', expires: nowMs + 150 });
      if (justPressed(2)) setBuffered({ type: 'skill', slot: 'Q', expires: nowMs + 150 });
      if (justPressed(3)) setBuffered({ type: 'skill', slot: 'E', expires: nowMs + 150 });
      if (justPressed(5)) setBuffered({ type: 'skill', slot: 'R', expires: nowMs + 150 });
      if (justPressed(6) || justPressed(13)) setBuffered({ type: 'flask', expires: nowMs + 150 });
      if (justPressed(12) || justPressed(8)) setBuffered({ type: 'interact', expires: nowMs + 150 });
    }

    this.prevGamepadButtons.set(
      pad.index,
      pad.buttons.map((_, i) => isDown(i))
    );

    return { moveX, moveY, aimX: rawRx, aimY: rawRy, hasAimStick, attackHeld };
  }

  private updateSimulation(dt: number, nowMs: number) {
    this.worldTime += dt;

    if (this.shakeTime > 0) this.shakeTime = Math.max(0, this.shakeTime - dt);
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerMessage = null;
    }
    if (this.levelUpToastTimer > 0) this.levelUpToastTimer = Math.max(0, this.levelUpToastTimer - dt);

    // Hitstop pauses gameplay entities briefly in solo mode for heavy impact feel
    if (this.hitstopTimer > 0) {
      this.hitstopTimer -= dt;
      if (!this.coopMode) return;
    }

    // Poll connected gamepads (USB / Bluetooth)
    const connectedPads =
      typeof navigator !== 'undefined' && navigator.getGamepads
        ? Array.from(navigator.getGamepads()).filter((g): g is Gamepad => Boolean(g && g.connected))
        : [];
    let p1Pad: Gamepad | null = null;
    let p2Pad: Gamepad | null = null;
    if (this.localCoopMode) {
      if (connectedPads.length >= 2) {
        p1Pad = connectedPads[0];
        p2Pad = connectedPads[1];
      } else if (connectedPads.length === 1) {
        p2Pad = connectedPads[0];
      }
    } else if (connectedPads.length >= 1) {
      p1Pad = connectedPads[0];
    }

    const pvpCanAct = !this.pvpMode || this.pvpPhase === 'fighting';
    const canControlP1 = this.screen === 'PLAYING' && !this.isDowned && pvpCanAct;
    const gp1 = this.pollGamepadForHero(p1Pad, canControlP1, nowMs, 1);

    // P1 Cooldowns & recovery
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.comboResetTimer = Math.max(0, this.comboResetTimer - dt);
    if (this.comboResetTimer <= 0) this.comboStep = 0;

    this.pHitFlash = Math.max(0, this.pHitFlash - dt);
    this.pInvuln = Math.max(0, this.pInvuln - dt);
    if (this.shieldTimer > 0) {
      this.shieldTimer -= dt;
      if (this.shieldTimer <= 0) this.shield = 0;
    }

    this.skillCooldowns.Q = Math.max(0, this.skillCooldowns.Q - dt);
    this.skillCooldowns.E = Math.max(0, this.skillCooldowns.E - dt);
    this.skillCooldowns.R = Math.max(0, this.skillCooldowns.R - dt);

    const zeroCooldownsActive = !this.pvpMode && this.adminFlags.zeroCooldowns;
    const infiniteManaActive = !this.pvpMode && this.adminFlags.infiniteMana;

    if (zeroCooldownsActive) {
      this.dashCooldown = 0;
      this.skillCooldowns.Q = 0;
      this.skillCooldowns.E = 0;
      this.skillCooldowns.R = 0;
    }

    if (!this.isDowned) {
      this.mana = infiniteManaActive
        ? this.stats.maxMana
        : Math.min(this.stats.maxMana, this.mana + this.stats.manaRegen * dt);
    }

    // P1 Movement input (WASD + touch + gamepad; Arrows belong to P2 during localCoopMode)
    let moveX = canControlP1 ? this.touchMoveX + gp1.moveX : 0;
    let moveY = canControlP1 ? this.touchMoveY + gp1.moveY : 0;
    if (canControlP1) {
      if (this.heldKeys.has('KeyW') || (!this.localCoopMode && this.heldKeys.has('ArrowUp'))) moveY -= 1;
      if (this.heldKeys.has('KeyS') || (!this.localCoopMode && this.heldKeys.has('ArrowDown'))) moveY += 1;
      if (this.heldKeys.has('KeyA') || (!this.localCoopMode && this.heldKeys.has('ArrowLeft'))) moveX -= 1;
      if (this.heldKeys.has('KeyD') || (!this.localCoopMode && this.heldKeys.has('ArrowRight'))) moveX += 1;
    }
    const moveLen = Math.hypot(moveX, moveY);
    if (moveLen > 1) {
      moveX /= moveLen;
      moveY /= moveLen;
    }

    // P1 Aim angle
    const mouseWorldX = this.camX + (this.mouseScreenX - this.viewW / 2) / this.camScale;
    const mouseWorldY = this.camY + (this.mouseScreenY - this.viewH / 2) / this.camScale;
    let aimTargetX = mouseWorldX;
    let aimTargetY = mouseWorldY;

    if (canControlP1) {
      if (gp1.hasAimStick) {
        this.pFacing = Math.atan2(gp1.aimY, gp1.aimX);
        aimTargetX = this.px + Math.cos(this.pFacing) * 160;
        aimTargetY = this.py + Math.sin(this.pFacing) * 160;
      } else if (this.lastInputType === 'touch' || this.heldKeys.has('KeyG') || p1Pad !== null) {
        const autoTarget = this.findAutoAimEnemyFrom(this.px, this.py, 340);
        if (autoTarget) {
          this.pFacing = Math.atan2(autoTarget.y - this.py, autoTarget.x - this.px);
          aimTargetX = autoTarget.x;
          aimTargetY = autoTarget.y;
        } else if (moveLen > 0.15) {
          this.pFacing = Math.atan2(moveY, moveX);
          aimTargetX = this.px + Math.cos(this.pFacing) * 140;
          aimTargetY = this.py + Math.sin(this.pFacing) * 140;
        } else {
          aimTargetX = this.px + Math.cos(this.pFacing) * 140;
          aimTargetY = this.py + Math.sin(this.pFacing) * 140;
        }
      } else {
        this.pFacing = Math.atan2(mouseWorldY - this.py, mouseWorldX - this.px);
      }
    }

    this.pSquashX += (1 - this.pSquashX) * Math.min(1, dt * 16);
    this.pSquashY += (1 - this.pSquashY) * Math.min(1, dt * 16);

    const speedMult = this.pvpMode ? 1 : this.adminFlags.speedMultiplier || 1;
    if (canControlP1 && this.dashTimer > 0) {
      this.dashTimer -= dt;
      const dashSpeed = this.stats.moveSpeed * speedMult * 2.85;
      this.pvx = this.dashDirX * dashSpeed;
      this.pvy = this.dashDirY * dashSpeed;
      if (Math.random() < 0.65) {
        this.ghosts.push({
          x: this.px,
          y: this.py,
          facing: this.pFacing,
          life: 0.2,
          maxLife: 0.2,
          color: resolveTrailColor(this.archetype, this.meta.equippedCosmetics),
        });
      }
    } else {
      const targetVx = moveX * this.stats.moveSpeed * speedMult;
      const targetVy = moveY * this.stats.moveSpeed * speedMult;
      const accel = Math.min(1, dt * 18);
      this.pvx += (targetVx - this.pvx) * accel;
      this.pvy += (targetVy - this.pvy) * accel;
    }

    const p1Hero = this.getHeroState(1);
    if (canControlP1) {
      this.moveHeroWithWallSlide(p1Hero, this.pvx * dt, this.pvy * dt);
    }

    if (canControlP1 && this.bufferedAction) {
      if (nowMs > this.bufferedAction.expires) {
        this.bufferedAction = null;
      } else {
        const act = this.bufferedAction;
        if (act.type === 'dash' && this.dashCooldown <= 0 && this.dashTimer <= 0) {
          this.triggerDashFor(p1Hero, moveX, moveY);
          this.bufferedAction = null;
        } else if (act.type === 'skill' && act.slot) {
          if (this.triggerSkillFor(p1Hero, act.slot, aimTargetX, aimTargetY)) {
            this.bufferedAction = null;
          }
        } else if (act.type === 'flask') {
          this.triggerFlaskFor(p1Hero);
          this.bufferedAction = null;
        } else if (act.type === 'interact') {
          this.triggerInteractFor(p1Hero);
          this.bufferedAction = null;
        } else if (act.type === 'attack' && this.attackCooldown <= 0 && this.dashTimer <= 0) {
          this.triggerPrimaryAttackFor(p1Hero);
          this.bufferedAction = null;
        }
      }
    }

    const p1KeyAttackHeld = this.heldKeys.has('KeyG');
    if (
      canControlP1 &&
      (this.mouseDown || this.touchAttackHeld || gp1.attackHeld || p1KeyAttackHeld) &&
      this.attackCooldown <= 0 &&
      this.dashTimer <= 0
    ) {
      this.triggerPrimaryAttackFor(p1Hero);
    }

    // ==================== PLAYER 2 (LOCAL OFFLINE CO-OP / PVP) ====================
    if (this.localCoopMode && this.p2) {
      const p2 = this.p2;
      const p2Hero = this.getHeroState(2);
      const canControlP2 = this.screen === 'PLAYING' && !p2.isDowned && pvpCanAct;
      const gp2 = this.pollGamepadForHero(p2Pad, canControlP2, nowMs, 2);

      p2.attackCooldown = Math.max(0, p2.attackCooldown - dt);
      p2.dashCooldown = Math.max(0, p2.dashCooldown - dt);
      p2.comboResetTimer = Math.max(0, p2.comboResetTimer - dt);
      if (p2.comboResetTimer <= 0) p2.comboStep = 0;
      p2.hitFlash = Math.max(0, p2.hitFlash - dt);
      p2.invuln = Math.max(0, p2.invuln - dt);
      if (p2.shieldTimer > 0) {
        p2.shieldTimer -= dt;
        if (p2.shieldTimer <= 0) p2.shield = 0;
      }
      p2.skillCooldowns.Q = Math.max(0, p2.skillCooldowns.Q - dt);
      p2.skillCooldowns.E = Math.max(0, p2.skillCooldowns.E - dt);
      p2.skillCooldowns.R = Math.max(0, p2.skillCooldowns.R - dt);

      if (!p2.isDowned) {
        p2.mana = Math.min(p2.stats.maxMana, p2.mana + p2.stats.manaRegen * dt);
      }

      let p2MoveX = canControlP2 ? p2.touchMoveX + gp2.moveX : 0;
      let p2MoveY = canControlP2 ? p2.touchMoveY + gp2.moveY : 0;
      if (canControlP2) {
        if (this.heldKeys.has('ArrowUp')) p2MoveY -= 1;
        if (this.heldKeys.has('ArrowDown')) p2MoveY += 1;
        if (this.heldKeys.has('ArrowLeft')) p2MoveX -= 1;
        if (this.heldKeys.has('ArrowRight')) p2MoveX += 1;
      }
      const p2MoveLen = Math.hypot(p2MoveX, p2MoveY);
      if (p2MoveLen > 1) {
        p2MoveX /= p2MoveLen;
        p2MoveY /= p2MoveLen;
      }

      let p2AimX = p2.x + Math.cos(p2.facing) * 140;
      let p2AimY = p2.y + Math.sin(p2.facing) * 140;
      if (canControlP2) {
        if (gp2.hasAimStick) {
          p2.facing = Math.atan2(gp2.aimY, gp2.aimX);
          p2AimX = p2.x + Math.cos(p2.facing) * 160;
          p2AimY = p2.y + Math.sin(p2.facing) * 160;
        } else {
          const autoTarget = this.findAutoAimEnemyFrom(p2.x, p2.y, 340);
          if (autoTarget) {
            p2.facing = Math.atan2(autoTarget.y - p2.y, autoTarget.x - p2.x);
            p2AimX = autoTarget.x;
            p2AimY = autoTarget.y;
          } else if (p2MoveLen > 0.15) {
            p2.facing = Math.atan2(p2MoveY, p2MoveX);
            p2AimX = p2.x + Math.cos(p2.facing) * 140;
            p2AimY = p2.y + Math.sin(p2.facing) * 140;
          }
        }
      }

      p2.squashX += (1 - p2.squashX) * Math.min(1, dt * 16);
      p2.squashY += (1 - p2.squashY) * Math.min(1, dt * 16);

      if (canControlP2 && p2.dashTimer > 0) {
        p2.dashTimer -= dt;
        const dashSpeed = p2.stats.moveSpeed * 2.85;
        p2.vx = p2.dashDirX * dashSpeed;
        p2.vy = p2.dashDirY * dashSpeed;
        if (Math.random() < 0.65) {
          this.ghosts.push({
            x: p2.x,
            y: p2.y,
            facing: p2.facing,
            life: 0.2,
            maxLife: 0.2,
            color: '#38BDF8',
          });
        }
      } else {
        const targetVx = p2MoveX * p2.stats.moveSpeed;
        const targetVy = p2MoveY * p2.stats.moveSpeed;
        const accel = Math.min(1, dt * 18);
        p2.vx += (targetVx - p2.vx) * accel;
        p2.vy += (targetVy - p2.vy) * accel;
      }

      if (canControlP2) {
        this.moveHeroWithWallSlide(p2Hero, p2.vx * dt, p2.vy * dt);
      }

      if (canControlP2 && p2.bufferedAction) {
        if (nowMs > p2.bufferedAction.expires) {
          p2.bufferedAction = null;
        } else {
          const act = p2.bufferedAction;
          if (act.type === 'dash' && p2.dashCooldown <= 0 && p2.dashTimer <= 0) {
            this.triggerDashFor(p2Hero, p2MoveX, p2MoveY);
            p2.bufferedAction = null;
          } else if (act.type === 'skill' && act.slot) {
            if (this.triggerSkillFor(p2Hero, act.slot, p2AimX, p2AimY)) {
              p2.bufferedAction = null;
            }
          } else if (act.type === 'flask') {
            this.triggerFlaskFor(p2Hero);
            p2.bufferedAction = null;
          } else if (act.type === 'interact') {
            this.triggerInteractFor(p2Hero);
            p2.bufferedAction = null;
          } else if (act.type === 'attack' && p2.attackCooldown <= 0 && p2.dashTimer <= 0) {
            this.triggerPrimaryAttackFor(p2Hero);
            p2.bufferedAction = null;
          }
        }
      }

      const p2KeyAttackHeld =
        this.heldKeys.has('KeyM') || this.heldKeys.has('Numpad0') || this.heldKeys.has('Enter');
      if (
        canControlP2 &&
        (p2.touchAttackHeld || gp2.attackHeld || p2KeyAttackHeld) &&
        p2.attackCooldown <= 0 &&
        p2.dashTimer <= 0
      ) {
        this.triggerPrimaryAttackFor(p2Hero);
      }
    }

    // Smoothly interpolate remote allied players in online co-op
    if (this.coopMode) {
      const lerpAlpha = Math.min(1, dt * 16);
      for (const ally of this.remotePlayers.values()) {
        ally.x += (ally.targetX - ally.x) * lerpAlpha;
        ally.y += (ally.targetY - ally.y) * lerpAlpha;
      }
    }

    // Update local PvP match loop & online PvP orb pickups
    if (this.pvpMode === 'local' && this.screen === 'PLAYING') {
      this.updateLocalPvpMatch(dt);
    } else if (this.pvpMode === 'online' && this.pvpPhase === 'fighting' && !this.isDowned) {
      const nowOrbMs = Date.now();
      for (const orb of this.pvpOrbs) {
        if (Math.hypot(orb.x - this.px, orb.y - this.py) <= this.pRadius + 18) {
          const prevSent = this.pvpPendingOrbPickups.get(orb.id) ?? 0;
          if (nowOrbMs - prevSent > 900) {
            this.pvpPendingOrbPickups.set(orb.id, nowOrbMs);
            if (orb.kind === 'mana') {
              this.mana = Math.min(this.stats.maxMana, this.mana + orb.amount);
              sfx.playPickup(true);
              this.spawnFloatingText(orb.x, orb.y - 12, `+${orb.amount} Maná`, '#A78BFA', 0.95);
            } else {
              sfx.playPickup(false);
              this.spawnFloatingText(orb.x, orb.y - 12, `+${orb.amount} Vida`, '#10B981', 0.95);
            }
            coopClient.send({ type: 'pvp:orb_pickup', orbId: orb.id });
          }
        }
      }
    }

    // Update dungeon props (traps) & visibility
    this.updateProps(dt);
    this.updateVisibility();

    // Update enemies
    this.updateEnemies(dt);

    // Update projectiles
    this.updateProjectiles(dt);

    // Update ground loot pickup
    if (!this.isDowned || (this.localCoopMode && this.p2 && !this.p2.isDowned)) {
      this.updateLoot(dt);
    }

    // Update visual effects
    this.updateEffects(dt);

    // Smooth shared camera follow (tracks midpoint + gentle zoom in local co-op / PvP)
    if (this.localCoopMode && this.p2) {
      const targetX = (this.px + this.p2.x) * 0.5;
      const targetY = (this.py + this.p2.y) * 0.5;
      this.camX += (targetX - this.camX) * Math.min(1, dt * 10);
      this.camY += (targetY - this.camY) * Math.min(1, dt * 10);

      const sepX = Math.abs(this.px - this.p2.x);
      const sepY = Math.abs(this.py - this.p2.y);
      const needScaleX = (this.viewW * 0.72) / Math.max(260, sepX + 200);
      const needScaleY = (this.viewH * 0.68) / Math.max(220, sepY + 180);
      const minScale = this.pvpMode === 'local' ? 0.54 : 0.62;
      const desiredScale = Math.max(minScale, Math.min(this.baseCamScale, needScaleX, needScaleY));
      this.camScale += (desiredScale - this.camScale) * Math.min(1, dt * 6);
    } else {
      const leadX = Math.cos(this.pFacing) * 28;
      const leadY = Math.sin(this.pFacing) * 28;
      this.camX += (this.px + leadX - this.camX) * Math.min(1, dt * 10);
      this.camY += (this.py + leadY - this.camY) * Math.min(1, dt * 10);
      this.camScale += (this.baseCamScale - this.camScale) * Math.min(1, dt * 8);
    }

    // 20Hz online co-op local state sync
    if (this.coopMode) {
      this.coopSyncTimer += dt;
      if (this.coopSyncTimer >= 0.05) {
        this.coopSyncTimer = 0;
        coopClient.send({
          type: 'player:state',
          x: this.px,
          y: this.py,
          facing: this.pFacing,
          hp: Math.ceil(this.hp),
          maxHp: this.stats.maxHp,
          shield: Math.ceil(this.shield),
          level: this.level,
          classTitle: computeHybridClassTitle(this.archetype, this.unlockedNodeIds),
          weaponKind: this.equippedWeapon.weaponKind ?? 'greatsword',
          alive: !this.isDowned,
          cosmetics: this.meta.equippedCosmetics,
        });
      }
    }

    // Emit HUD snapshot ~15fps
    this.hudEmitTimer += dt;
    if (this.hudEmitTimer >= 0.065) {
      this.hudEmitTimer = 0;
      this.emitHud();
    }
  }

  private moveHeroWithWallSlide(hero: ReturnType<GameEngine['getHeroState']>, dx: number, dy: number) {
    const r = this.pRadius;
    const maxSep = this.pvpMode === 'local' ? 1800 : 540;
    const other = this.localCoopMode && this.p2 ? (hero.num === 1 ? this.p2 : { x: this.px, y: this.py }) : null;

    if (dx !== 0) {
      const nextX = hero.x + dx;
      const oldDist = other ? Math.hypot(hero.x - other.x, hero.y - other.y) : 0;
      const newDist = other ? Math.hypot(nextX - other.x, hero.y - other.y) : 0;
      if (!this.collidesWall(nextX, hero.y, r) && (!other || newDist <= maxSep || newDist < oldDist)) {
        hero.x = nextX;
      }
    }
    if (dy !== 0) {
      const nextY = hero.y + dy;
      const oldDist = other ? Math.hypot(hero.x - other.x, hero.y - other.y) : 0;
      const newDist = other ? Math.hypot(hero.x - other.x, nextY - other.y) : 0;
      if (!this.collidesWall(hero.x, nextY, r) && (!other || newDist <= maxSep || newDist < oldDist)) {
        hero.y = nextY;
      }
    }
  }

  private collidesWall(wx: number, wy: number, radius: number): boolean {
    const ts = this.floor.tileSize;
    const minTx = Math.floor((wx - radius) / ts);
    const maxTx = Math.floor((wx + radius) / ts);
    const minTy = Math.floor((wy - radius) / ts);
    const maxTy = Math.floor((wy + radius) / ts);

    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        if (!isWalkableTile(this.floor, tx, ty)) {
          const rx = tx * ts;
          const ry = ty * ts;
          const closestX = Math.max(rx, Math.min(wx, rx + ts));
          const closestY = Math.max(ry, Math.min(wy, ry + ts));
          const distSq = (wx - closestX) ** 2 + (wy - closestY) ** 2;
          if (distSq < radius * radius) return true;
        }
      }
    }
    return false;
  }

  private triggerDashFor(hero: ReturnType<GameEngine['getHeroState']>, moveX: number, moveY: number) {
    if (moveX !== 0 || moveY !== 0) {
      hero.dashDirX = moveX;
      hero.dashDirY = moveY;
    } else {
      hero.dashDirX = Math.cos(hero.facing);
      hero.dashDirY = Math.sin(hero.facing);
    }
    hero.dashTimer = 0.16;
    hero.invuln = Math.max(hero.invuln, 0.24);
    hero.dashCooldown = !this.pvpMode && this.adminFlags.zeroCooldowns ? 0 : hero.stats.dashCooldown;
    hero.squashX = 1.32;
    hero.squashY = 0.72;
    sfx.playDash();
    this.spawnParticles(hero.x, hero.y, 10, '#949BA8', 90, 0.28);
    if (hero.num === 1) {
      this.sendCoopAction({
        kind: 'dash',
        x: hero.x,
        y: hero.y,
        angle: hero.facing,
        color: resolveTrailColor(hero.archetype, this.meta.equippedCosmetics, hero.color),
      });
    }

    if (hero.stats.dashLeavesShadow) {
      const originX = hero.x;
      const originY = hero.y;
      this.rings.push({
        x: originX,
        y: originY,
        radius: 10,
        maxRadius: 86,
        color: '#10B981',
        life: 0.28,
        maxLife: 0.28,
      });
      if (hero.num === 1) {
        this.sendCoopAction({ kind: 'ring', x: originX, y: originY, radius: 86, color: '#10B981' });
      }
      this.currentHitSkillId = 'dash_decoy';
      for (const e of this.enemies) {
        if (Math.hypot(e.x - originX, e.y - originY) <= 86 + e.radius) {
          this.damageEnemy(
            e,
            Math.round(hero.stats.baseDamage * 0.9 + hero.stats.arcanePower * 0.7),
            false,
            '#10B981',
            0,
            0,
            false,
            hero
          );
        }
      }
      if (this.pvpMode) {
        this.checkPvpAttackHit(
          hero,
          originX,
          originY,
          86,
          Math.PI * 2,
          0,
          Math.round(hero.stats.baseDamage * 0.9 + hero.stats.arcanePower * 0.7),
          false,
          '#10B981',
          0,
          'dash_decoy'
        );
      }
      this.currentHitSkillId = 'basic';
    }
  }

  private triggerPrimaryAttackFor(hero: ReturnType<GameEngine['getHeroState']>) {
    const kind = hero.equippedWeapon.weaponKind ?? 'greatsword';
    const baseCd = kind === 'daggers' ? 0.25 : kind === 'staff' ? 0.42 : kind === 'halberd' ? 0.48 : 0.44;
    hero.attackCooldown = !this.pvpMode && this.adminFlags.zeroCooldowns ? 0.1 : baseCd / hero.stats.attackSpeed;
    hero.comboStep = (hero.comboStep + 1) % 3;
    hero.comboResetTimer = 1.05;

    hero.squashX = 1.24;
    hero.squashY = 0.8;
    sfx.playSwing(kind);

    const isFinisher = hero.comboStep === 0;
    const angle = hero.facing;
    this.moveHeroWithWallSlide(hero, Math.cos(angle) * 7, Math.sin(angle) * 7);

    if (kind === 'staff') {
      const speed = 520;
      const isCrit = this.rollCritFor(hero);
      const rawDmg = hero.stats.baseDamage * 0.45 + hero.stats.arcanePower * 1.15;
      const dmg = Math.round(rawDmg * (isFinisher ? 1.3 : 1) * (isCrit ? hero.stats.critMultiplier : 1));
      const projX = hero.x + Math.cos(angle) * 18;
      const projY = hero.y + Math.sin(angle) * 18;
      const projVx = Math.cos(angle) * speed;
      const projVy = Math.sin(angle) * speed;
      const defaultProjColor = isCrit ? '#F59E0B' : hero.num === 2 ? '#38BDF8' : '#8B5CF6';
      const projColor =
        hero.num === 1
          ? resolveTrailColor(hero.archetype, this.meta.equippedCosmetics, defaultProjColor)
          : defaultProjColor;
      this.spawnProjectile({
        fromPlayer: true,
        ownerNum: hero.num,
        x: projX,
        y: projY,
        vx: projVx,
        vy: projVy,
        radius: isFinisher ? 9 : 7,
        damage: dmg,
        isCrit,
        color: projColor,
        maxLife: 0.95,
        pierce: isFinisher ? 2 : 0,
        applyBleed: hero.stats.bleedOnHit,
        applySlow: false,
        kind: 'bolt',
      });
      if (hero.num === 1) {
        this.sendCoopAction({
          kind: 'projectile',
          x: projX,
          y: projY,
          vx: projVx,
          vy: projVy,
          color: projColor,
          projKind: 'bolt',
        });
      }
      this.slashes.push({
        x: hero.x + Math.cos(angle) * 16,
        y: hero.y + Math.sin(angle) * 16,
        angle,
        arc: Math.PI * 0.55,
        radius: 42,
        color: projColor,
        life: 0.14,
        maxLife: 0.14,
        isSpin: false,
      });
      this.breakUrnsInConeFrom(hero.x, hero.y, angle, 48, Math.PI * 0.6);
      return;
    }

    const range =
      kind === 'halberd' ? 92 : kind === 'greatsword' ? 82 : kind === 'scythe' ? 86 : 62;
    const arc =
      kind === 'daggers' ? Math.PI * 0.65 : kind === 'scythe' ? Math.PI * 1.05 : Math.PI * 0.85;
    const defaultSwingColor =
      hero.num === 2
        ? isFinisher
          ? '#F59E0B'
          : '#38BDF8'
        : hero.archetype === 'occultist'
        ? '#A78BFA'
        : hero.archetype === 'stalker'
        ? '#34D399'
        : isFinisher
        ? '#F59E0B'
        : '#EF4444';
    const swingColor =
      hero.num === 1
        ? resolveTrailColor(hero.archetype, this.meta.equippedCosmetics, defaultSwingColor)
        : defaultSwingColor;

    this.slashes.push({
      x: hero.x,
      y: hero.y,
      angle,
      arc,
      radius: range,
      color: swingColor,
      life: 0.17,
      maxLife: 0.17,
      isSpin: false,
    });
    if (hero.num === 1) {
      this.sendCoopAction({
        kind: 'slash',
        x: hero.x,
        y: hero.y,
        angle,
        arc,
        radius: range,
        color: swingColor,
      });
    }

    this.breakUrnsInConeFrom(hero.x, hero.y, angle, range, arc);

    let hitAny = false;
    for (const e of [...this.enemies]) {
      const dx = e.x - hero.x;
      const dy = e.y - hero.y;
      const dist = Math.hypot(dx, dy);
      if (dist > range + e.radius) continue;
      const angToEnemy = Math.atan2(dy, dx);
      const diff = Math.abs(this.normalizeAngle(angToEnemy - angle));
      if (diff <= arc * 0.56 || dist < this.pRadius + e.radius + 8) {
        const isCrit = this.rollCritFor(hero);
        const mult = isFinisher ? 1.35 : 1.0;
        const dmg = Math.round(
          (hero.stats.baseDamage * mult + hero.stats.arcanePower * 0.15) *
            (isCrit ? hero.stats.critMultiplier : 1)
        );
        const kb = isFinisher ? 22 : 12;
        const knockX = dist > 0.1 ? (dx / dist) * kb : 0;
        const knockY = dist > 0.1 ? (dy / dist) * kb : 0;
        this.damageEnemy(e, dmg, isCrit, swingColor, knockX, knockY, false, hero);
        if (!this.coopMode && (knockX !== 0 || knockY !== 0)) {
          this.nudgeEnemy(e, knockX, knockY);
        }
        hitAny = true;
      }
    }

    if (this.pvpMode) {
      const isCritPvp = this.rollCritFor(hero);
      const multPvp = isFinisher ? 1.35 : 1.0;
      const dmgPvp = Math.round(
        (hero.stats.baseDamage * multPvp + hero.stats.arcanePower * 0.15) *
          (isCritPvp ? hero.stats.critMultiplier : 1)
      );
      if (
        this.checkPvpAttackHit(
          hero,
          hero.x,
          hero.y,
          range,
          arc,
          angle,
          dmgPvp,
          isCritPvp,
          swingColor,
          isFinisher ? 22 : 12,
          'basic'
        )
      ) {
        hitAny = true;
      }
    }

    if (hitAny && isFinisher) {
      this.addShake(4.5, 0.12);
    }
  }

  private triggerSkillFor(
    hero: ReturnType<GameEngine['getHeroState']>,
    slot: SkillSlotKey,
    targetWorldX: number,
    targetWorldY: number
  ): boolean {
    const skillId = hero.equippedSlots[slot];
    if (!skillId) return false;
    const zeroCd = !this.pvpMode && this.adminFlags.zeroCooldowns;
    const infMana = !this.pvpMode && this.adminFlags.infiniteMana;
    if (!zeroCd && hero.skillCooldowns[slot] > 0) return false;
    const def = ACTIVE_SKILLS[skillId];
    if (!infMana && hero.mana < def.manaCost) {
      this.spawnFloatingText(hero.x, hero.y - 26, 'Sin maná', '#8B5CF6', 0.9);
      return false;
    }

    if (!infMana) {
      hero.mana -= def.manaCost;
    }
    hero.skillCooldowns[slot] = zeroCd
      ? 0
      : Math.max(0.8, def.cooldown * (1 - hero.stats.cooldownReduction));
    sfx.playSkill(skillId);
    this.currentHitSkillId = skillId;

    switch (skillId) {
      case 'whirlwind': {
        const radius = 112;
        this.slashes.push({
          x: hero.x,
          y: hero.y,
          angle: hero.facing,
          arc: Math.PI * 2,
          radius,
          color: '#EF4444',
          life: 0.28,
          maxLife: 0.28,
          isSpin: true,
        });
        this.rings.push({
          x: hero.x,
          y: hero.y,
          radius: 18,
          maxRadius: radius,
          color: '#EF4444',
          life: 0.26,
          maxLife: 0.26,
        });
        if (hero.num === 1) {
          this.sendCoopAction({
            kind: 'slash',
            x: hero.x,
            y: hero.y,
            angle: hero.facing,
            arc: Math.PI * 2,
            radius,
            color: '#EF4444',
            isSpin: true,
          });
        }
        this.breakUrnsInConeFrom(hero.x, hero.y, 0, radius, Math.PI * 2);
        this.addShake(6, 0.16);
        for (const e of [...this.enemies]) {
          const dx = e.x - hero.x;
          const dy = e.y - hero.y;
          const dist = Math.hypot(dx, dy);
          if (dist <= radius + e.radius) {
            const isCrit = this.rollCritFor(hero);
            const dmg = Math.round(
              hero.stats.baseDamage * 1.85 * (isCrit ? hero.stats.critMultiplier : 1)
            );
            const knockX = dist > 1 ? (dx / dist) * 32 : 0;
            const knockY = dist > 1 ? (dy / dist) * 32 : 0;
            this.damageEnemy(e, dmg, isCrit, '#EF4444', knockX, knockY, false, hero);
            if (!this.coopMode && (knockX !== 0 || knockY !== 0)) this.nudgeEnemy(e, knockX, knockY);
          }
        }
        if (this.pvpMode) {
          const isCritPvp = this.rollCritFor(hero);
          const dmgPvp = Math.round(
            hero.stats.baseDamage * 1.85 * (isCritPvp ? hero.stats.critMultiplier : 1)
          );
          this.checkPvpAttackHit(
            hero,
            hero.x,
            hero.y,
            radius,
            Math.PI * 2,
            0,
            dmgPvp,
            isCritPvp,
            '#EF4444',
            32,
            'whirlwind'
          );
        }
        break;
      }

      case 'aegis': {
        hero.shield = Math.round(hero.stats.maxHp * 0.35);
        hero.shieldTimer = 5.0;
        if (this.pvpMode === 'online' && hero.num === 1) {
          coopClient.send({ type: 'pvp:skill', skillId: 'aegis' });
        } else if (this.coopMode && hero.num === 1) {
          coopClient.send({ type: 'player:skill', skillId: 'aegis' });
        }
        this.rings.push({
          x: hero.x,
          y: hero.y,
          radius: 16,
          maxRadius: 96,
          color: '#F59E0B',
          life: 0.32,
          maxLife: 0.32,
        });
        if (hero.num === 1) {
          this.sendCoopAction({ kind: 'ring', x: hero.x, y: hero.y, radius: 96, color: '#F59E0B' });
        }
        this.spawnFloatingText(hero.x, hero.y - 28, `+${hero.shield} Escudo`, '#F59E0B', 1.05);
        for (const e of [...this.enemies]) {
          const dx = e.x - hero.x;
          const dy = e.y - hero.y;
          const dist = Math.hypot(dx, dy);
          if (dist <= 96 + e.radius) {
            const knockX = dist > 1 ? (dx / dist) * 28 : 0;
            const knockY = dist > 1 ? (dy / dist) * 28 : 0;
            this.damageEnemy(
              e,
              Math.round(hero.stats.baseDamage * 0.9 + hero.stats.armor * 1.2),
              false,
              '#F59E0B',
              knockX,
              knockY,
              false,
              hero
            );
            if (!this.coopMode && (knockX !== 0 || knockY !== 0)) this.nudgeEnemy(e, knockX, knockY);
          }
        }
        if (this.pvpMode) {
          this.checkPvpAttackHit(
            hero,
            hero.x,
            hero.y,
            96,
            Math.PI * 2,
            0,
            Math.round(hero.stats.baseDamage * 0.9 + hero.stats.armor * 1.2),
            false,
            '#F59E0B',
            28,
            'aegis'
          );
        }
        break;
      }

      case 'shadow_step': {
        const originX = hero.x;
        const originY = hero.y;
        const angle = Math.atan2(targetWorldY - hero.y, targetWorldX - hero.x);
        const maxDist = Math.min(185, Math.hypot(targetWorldX - hero.x, targetWorldY - hero.y));
        let targetX = hero.x;
        let targetY = hero.y;
        const steps = 12;
        for (let i = 1; i <= steps; i++) {
          const testX = originX + Math.cos(angle) * ((maxDist * i) / steps);
          const testY = originY + Math.sin(angle) * ((maxDist * i) / steps);
          if (!this.collidesWall(testX, testY, this.pRadius)) {
            targetX = testX;
            targetY = testY;
          } else {
            break;
          }
        }
        this.spawnParticles(originX, originY, 16, '#10B981', 120, 0.35);
        hero.x = targetX;
        hero.y = targetY;
        hero.invuln = Math.max(hero.invuln, 0.25);
        hero.guaranteedCrit = true;
        this.spawnParticles(hero.x, hero.y, 16, '#34D399', 140, 0.35);
        this.rings.push({
          x: originX,
          y: originY,
          radius: 10,
          maxRadius: 76,
          color: '#10B981',
          life: 0.24,
          maxLife: 0.24,
        });
        if (hero.num === 1) {
          this.sendCoopAction({ kind: 'ring', x: originX, y: originY, radius: 76, color: '#10B981' });
        }
        for (const e of [...this.enemies]) {
          if (Math.hypot(e.x - originX, e.y - originY) <= 76 + e.radius) {
            this.damageEnemy(e, Math.round(hero.stats.baseDamage * 1.2), true, '#10B981', 0, 0, false, hero);
          }
        }
        if (this.pvpMode) {
          this.checkPvpAttackHit(
            hero,
            originX,
            originY,
            76,
            Math.PI * 2,
            0,
            Math.round(hero.stats.baseDamage * 1.2),
            true,
            '#10B981',
            0,
            'shadow_step'
          );
        }
        break;
      }

      case 'dagger_fan': {
        const baseAng = hero.facing;
        const spread = 0.2;
        for (let i = -2; i <= 2; i++) {
          const a = baseAng + i * spread;
          const isCrit = this.rollCritFor(hero);
          const dmg = Math.round(
            (hero.stats.baseDamage * 0.85 + hero.stats.arcanePower * 0.25) *
              (isCrit ? hero.stats.critMultiplier : 1)
          );
          const px = hero.x + Math.cos(a) * 14;
          const py = hero.y + Math.sin(a) * 14;
          const vx = Math.cos(a) * 560;
          const vy = Math.sin(a) * 560;
          this.spawnProjectile({
            fromPlayer: true,
            ownerNum: hero.num,
            skillId: 'dagger_fan',
            x: px,
            y: py,
            vx,
            vy,
            radius: 6,
            damage: dmg,
            isCrit,
            color: '#34D399',
            maxLife: 0.65,
            pierce: 1,
            applyBleed: true,
            applySlow: false,
            kind: 'dagger',
          });
          if (hero.num === 1) {
            this.sendCoopAction({ kind: 'projectile', x: px, y: py, vx, vy, color: '#34D399', projKind: 'dagger' });
          }
        }
        break;
      }

      case 'abyss_lance': {
        const a = hero.facing;
        const isCrit = this.rollCritFor(hero);
        const dmg = Math.round(
          (hero.stats.arcanePower * 2.1 + hero.stats.baseDamage * 0.5) *
            (isCrit ? hero.stats.critMultiplier : 1)
        );
        const px = hero.x + Math.cos(a) * 20;
        const py = hero.y + Math.sin(a) * 20;
        const vx = Math.cos(a) * 700;
        const vy = Math.sin(a) * 700;
        this.spawnProjectile({
          fromPlayer: true,
          ownerNum: hero.num,
          skillId: 'abyss_lance',
          x: px,
          y: py,
          vx,
          vy,
          radius: 11,
          damage: dmg,
          isCrit,
          color: '#A78BFA',
          maxLife: 0.85,
          pierce: 6,
          applyBleed: false,
          applySlow: true,
          kind: 'lance',
        });
        if (hero.num === 1) {
          this.sendCoopAction({ kind: 'projectile', x: px, y: py, vx, vy, color: '#A78BFA', projKind: 'lance' });
        }
        this.addShake(4, 0.1);
        break;
      }

      case 'eclipse_nova': {
        const radius = 148;
        this.rings.push({
          x: hero.x,
          y: hero.y,
          radius: 16,
          maxRadius: radius,
          color: '#8B5CF6',
          life: 0.36,
          maxLife: 0.36,
        });
        if (hero.num === 1) {
          this.sendCoopAction({ kind: 'ring', x: hero.x, y: hero.y, radius, color: '#8B5CF6' });
        }
        this.spawnParticles(hero.x, hero.y, 26, '#A78BFA', 190, 0.42);
        this.addShake(6.5, 0.18);
        this.breakUrnsInConeFrom(hero.x, hero.y, 0, radius, Math.PI * 2);

        let hits = 0;
        for (const e of [...this.enemies]) {
          const dist = Math.hypot(e.x - hero.x, e.y - hero.y);
          if (dist <= radius + e.radius) {
            const isCrit = this.rollCritFor(hero);
            const dmg = Math.round(
              (hero.stats.arcanePower * 1.9 + hero.stats.baseDamage * 0.6) *
                (isCrit ? hero.stats.critMultiplier : 1)
            );
            this.damageEnemy(e, dmg, isCrit, '#8B5CF6', 0, 0, false, hero);
            hits++;
          }
        }
        if (this.pvpMode) {
          const isCritPvp = this.rollCritFor(hero);
          const dmgPvp = Math.round(
            (hero.stats.arcanePower * 1.9 + hero.stats.baseDamage * 0.6) *
              (isCritPvp ? hero.stats.critMultiplier : 1)
          );
          if (
            this.checkPvpAttackHit(
              hero,
              hero.x,
              hero.y,
              radius,
              Math.PI * 2,
              0,
              dmgPvp,
              isCritPvp,
              '#8B5CF6',
              0,
              'eclipse_nova'
            )
          ) {
            hits++;
          }
        }
        if (hits > 0) {
          if (this.pvpMode === 'online' && hero.num === 1) {
            // Online PvP server grants +12 HP on verified eclipse_nova pvp:hit
          } else if (this.coopMode && hero.num === 1) {
            coopClient.send({ type: 'player:skill', skillId: 'eclipse_nova', hitsCount: hits });
          } else {
            const healAmount = this.pvpMode === 'local' ? 12 : hits * 7;
            const heal = Math.min(hero.stats.maxHp - hero.hp, healAmount);
            if (heal > 0) {
              hero.hp += heal;
              this.spawnFloatingText(hero.x, hero.y - 28, `+${heal}`, '#10B981', 1);
            }
          }
        }
        break;
      }
    }

    this.currentHitSkillId = 'basic';
    this.emitHud();
    return true;
  }

  private triggerFlaskFor(hero: ReturnType<GameEngine['getHeroState']>) {
    if (hero.flaskCharges <= 0 || hero.hp >= hero.stats.maxHp) return;
    hero.flaskCharges--;
    const heal = Math.round(hero.stats.maxHp * hero.stats.flaskHealPct);
    hero.hp = Math.min(hero.stats.maxHp, hero.hp + heal);
    sfx.playFlask();
    this.spawnParticles(hero.x, hero.y, 14, '#EF4444', 95, 0.45);
    this.spawnFloatingText(hero.x, hero.y - 28, `+${heal} Vida`, '#EF4444', 1.1);
    if (this.pvpMode === 'online' && hero.num === 1) {
      coopClient.send({ type: 'pvp:flask' });
    } else if (this.coopMode && hero.num === 1) {
      coopClient.send({ type: 'player:flask' });
    }
    this.emitHud();
  }

  private findNearestDownedAlly(): (CoopPlayerSync & { targetX: number; targetY: number }) | null {
    if (!this.coopMode) return null;
    let best: (CoopPlayerSync & { targetX: number; targetY: number }) | null = null;
    let bestDist = 72;
    for (const ally of this.remotePlayers.values()) {
      if (ally.alive) continue;
      const d = Math.hypot(ally.x - this.px, ally.y - this.py);
      if (d < bestDist) {
        bestDist = d;
        best = ally;
      }
    }
    return best;
  }

  private triggerInteractFor(hero: ReturnType<GameEngine['getHeroState']>) {
    if (this.coopMode) {
      const downedAlly = this.findNearestDownedAlly();
      if (downedAlly) {
        coopClient.send({ type: 'player:revive', targetPlayerId: downedAlly.id });
        return;
      }
    }

    // Local co-op revive check
    if (this.localCoopMode && this.p2) {
      const partner = this.getHeroState(hero.num === 1 ? 2 : 1);
      if (partner.isDowned && Math.hypot(partner.x - hero.x, partner.y - hero.y) <= 78) {
        partner.isDowned = false;
        partner.hp = Math.max(1, Math.round(partner.stats.maxHp * 0.5));
        partner.invuln = 1.5;
        sfx.playShrine();
        this.spawnParticles(partner.x, partner.y, 22, '#10B981', 140, 0.45);
        this.spawnFloatingText(partner.x, partner.y - 30, '¡Revivido!', '#10B981', 1.2);
        this.showBanner(`${hero.label} revivió a ${partner.label}`);
        this.emitHud();
        return;
      }
    }

    const prop = this.findNearestInteractableFrom(hero.x, hero.y);
    if (!prop) return;

    if (this.coopMode) {
      if ((prop.kind === 'chest' || prop.kind === 'shrine') && !prop.interacted) {
        coopClient.send({ type: 'prop:interact', propId: prop.id });
      } else if (prop.kind === 'portal') {
        coopClient.send({ type: 'floor:descend' });
      }
      return;
    }

    if (prop.kind === 'chest' && !prop.interacted) {
      prop.interacted = true;
      sfx.playChestOpen();
      this.spawnParticles(prop.x, prop.y, 22, '#F59E0B', 140, 0.5);
      const item = generateLootItem(this.floor.floorNumber, this.meta.blessings.fortune);
      this.loot.push({
        id: `loot_${this.idCounter++}`,
        x: prop.x,
        y: prop.y + 18,
        vx: (Math.random() - 0.5) * 80,
        vy: 60,
        kind: 'item',
        item,
        bobPhase: Math.random() * 6,
      });
      const goldCount = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < goldCount; i++) {
        this.loot.push({
          id: `loot_${this.idCounter++}`,
          x: prop.x,
          y: prop.y,
          vx: (Math.random() - 0.5) * 140,
          vy: (Math.random() - 0.5) * 140,
          kind: 'gold',
          amount: 10 + this.floor.floorNumber * 6,
          bobPhase: Math.random() * 6,
        });
      }
      this.callbacks.onAchievementEvent?.({ interactionsCount: { mode: 'inc', value: 1 } });
      this.triggerCheckpoint();
    } else if (prop.kind === 'shrine' && !prop.interacted) {
      prop.interacted = true;
      sfx.playShrine();
      this.spawnParticles(prop.x, prop.y, 24, '#8B5CF6', 130, 0.55);
      if (prop.shrineVariant === 'blood') {
        this.hp = this.stats.maxHp;
        this.flaskCharges = this.maxFlaskCharges;
        if (this.p2 && !this.p2.isDowned) {
          this.p2.hp = this.p2.stats.maxHp;
          this.p2.flaskCharges = this.p2.maxFlaskCharges;
        }
        this.showBanner('Altar Carmesí: Vida y Frascos restaurados');
        this.spawnFloatingText(hero.x, hero.y - 30, 'Restauración Total', '#EF4444', 1.15);
      } else if (prop.shrineVariant === 'arcane') {
        this.mana = this.stats.maxMana;
        this.skillPoints += 1;
        if (this.p2) {
          this.p2.mana = this.p2.stats.maxMana;
          this.p2.skillPoints += 1;
        }
        this.levelUpToastTimer = 4.5;
        this.showBanner('Altar del Eclipse: +1 Punto de Habilidad');
        this.spawnFloatingText(hero.x, hero.y - 30, '+1 Punto de Habilidad', '#A78BFA', 1.15);
      } else {
        this.soulsThisRun += 8 + this.floor.floorNumber * 3;
        this.grantXp(45 * this.floor.floorNumber);
        if (this.localCoopMode) this.grantXpP2(45 * this.floor.floorNumber);
        this.showBanner('Altar del Santuario: Fragmentos de Alma y Sabiduría');
      }
      this.callbacks.onAchievementEvent?.({ interactionsCount: { mode: 'inc', value: 1 } });
      this.emitHud();
      this.triggerCheckpoint();
    } else if (prop.kind === 'portal') {
      this.descendNextFloor();
    }
  }

  private descendNextFloor() {
    const clearedFloor = this.floor.floorNumber;
    const nextFloor = clearedFloor + 1;
    const isMilestone = clearedFloor % 3 === 0;
    const bonusSouls = isMilestone ? 15 + clearedFloor * 3 : 4 + clearedFloor;
    this.soulsThisRun += bonusSouls;

    this.initFloor(nextFloor, false);
    this.isDowned = false;
    this.hp = Math.min(this.stats.maxHp, Math.max(this.hp, Math.round(this.stats.maxHp * 0.5)) + Math.round(this.stats.maxHp * 0.25));
    this.mana = this.stats.maxMana;
    if (this.p2) {
      this.p2.isDowned = false;
      this.p2.hp = Math.min(this.p2.stats.maxHp, Math.max(this.p2.hp, Math.round(this.p2.stats.maxHp * 0.5)) + Math.round(this.p2.stats.maxHp * 0.25));
      this.p2.mana = this.p2.stats.maxMana;
    }
    if (isMilestone) {
      sfx.playVictory();
      this.showBanner(
        `¡Sello del Piso ${clearedFloor} superado (+${bonusSouls} Almas)! · Piso ${nextFloor} · Semilla ${this.runSeedLabel}`
      );
    } else {
      sfx.playShrine();
      this.showBanner(`Piso ${nextFloor} · ${this.floor.name} · Semilla ${this.runSeedLabel}`);
    }
    this.emitHud();
    this.triggerCheckpoint();
  }

  private findNearestInteractableFrom(x: number, y: number): DungeonProp | null {
    let best: DungeonProp | null = null;
    let bestDist = 66;
    for (const prop of this.floor.props) {
      if (prop.kind === 'chest' || prop.kind === 'shrine' || prop.kind === 'portal') {
        if (prop.kind !== 'portal' && prop.interacted) continue;
        const d = Math.hypot(prop.x - x, prop.y - y);
        if (d < bestDist) {
          bestDist = d;
          best = prop;
        }
      }
    }
    return best;
  }

  private rollCritFor(hero: ReturnType<GameEngine['getHeroState']>): boolean {
    if (hero.guaranteedCrit) {
      hero.guaranteedCrit = false;
      return true;
    }
    return Math.random() < hero.stats.critChance;
  }

  private damageEnemy(
    enemy: EnemyEntity,
    amount: number,
    isCrit: boolean,
    color: string,
    knockX = 0,
    knockY = 0,
    slow = false,
    attacker?: ReturnType<GameEngine['getHeroState']>
  ) {
    if (enemy.hp <= 0) return;
    const hero = attacker ?? this.getHeroState(1);
    const dmgMult = !this.pvpMode ? Math.max(1, this.adminFlags.damageMultiplier || 1) : 1;
    const effectiveAmount = this.adminFlags.oneHitKill
      ? Math.max(amount, 99999)
      : Math.round(amount * dmgMult);

    if (this.coopMode) {
      enemy.hitFlash = 0.08;
      coopClient.send({
        type: 'combat:hit',
        enemyId: enemy.id,
        damage: effectiveAmount,
        isCrit,
        color,
        knockX,
        knockY,
        bleedDps: hero.stats.bleedOnHit ? Math.round(hero.stats.baseDamage * 0.35) : undefined,
        slow,
        skillId: this.currentHitSkillId,
      });

      if (isCrit && hero.stats.critChainArcane) {
        for (const other of this.enemies) {
          if (other.id !== enemy.id && other.hp > 0) {
            if (Math.hypot(other.x - enemy.x, other.y - enemy.y) <= 135) {
              coopClient.send({
                type: 'combat:hit',
                enemyId: other.id,
                damage: Math.round(hero.stats.arcanePower * 0.85),
                isCrit: false,
                color: '#A78BFA',
                knockX: 0,
                knockY: 0,
                skillId: this.currentHitSkillId,
              });
              break;
            }
          }
        }
      }
      return;
    }

    enemy.hp -= effectiveAmount;
    enemy.hitFlash = 0.11;
    enemy.squashX = 1.25;
    enemy.squashY = 0.78;
    if (hero.stats.bleedOnHit) {
      enemy.bleedTimer = 3.0;
      enemy.bleedDps = Math.max(enemy.bleedDps, Math.round(hero.stats.baseDamage * 0.35));
    }

    sfx.playHit(isCrit);
    this.spawnParticles(enemy.x, enemy.y, isCrit ? 14 : 7, isCrit ? '#F59E0B' : color, 150, 0.32);
    this.spawnFloatingText(
      enemy.x + (Math.random() - 0.5) * 14,
      enemy.y - enemy.radius - 6,
      isCrit ? `${effectiveAmount}!` : `${effectiveAmount}`,
      isCrit ? '#F59E0B' : '#E5E0D5',
      isCrit ? 1.25 : 0.95
    );

    if (isCrit) {
      this.hitstopTimer = Math.max(this.hitstopTimer, 0.04);
      this.addShake(4, 0.1);
      if (hero.stats.critChainArcane) {
        for (const other of this.enemies) {
          if (other.id !== enemy.id && other.hp > 0) {
            if (Math.hypot(other.x - enemy.x, other.y - enemy.y) <= 135) {
              const arcDmg = Math.round(hero.stats.arcanePower * 0.85);
              other.hp -= arcDmg;
              other.hitFlash = 0.1;
              this.spawnParticles(other.x, other.y, 8, '#A78BFA', 110, 0.25);
              this.spawnFloatingText(other.x, other.y - 16, `${arcDmg}`, '#A78BFA', 0.9);
              if (other.hp <= 0) this.handleEnemyKilled(other, hero);
              break;
            }
          }
        }
      }
    }

    if (hero.stats.lifesteal > 0 && !hero.isDowned) {
      const leech = Math.max(1, Math.round(effectiveAmount * hero.stats.lifesteal));
      hero.hp = Math.min(hero.stats.maxHp, hero.hp + leech);
    }

    if (enemy.hp <= 0) {
      this.handleEnemyKilled(enemy, hero);
    }
  }

  private handleEnemyKilled(enemy: EnemyEntity, killer?: ReturnType<GameEngine['getHeroState']>) {
    const idx = this.enemies.findIndex((e) => e.id === enemy.id);
    if (idx === -1) return;
    this.enemies.splice(idx, 1);
    this.kills++;
    this.callbacks.onBestiaryEvent?.(enemy.type, true);
    const achUpdate: AchievementStatUpdate = { totalKills: { mode: 'inc', value: 1 } };
    if (enemy.type === 'boss_warden') achUpdate.bossWardenKills = { mode: 'inc', value: 1 };
    if (enemy.type === 'boss_archon') achUpdate.bossArchonKills = { mode: 'inc', value: 1 };
    this.callbacks.onAchievementEvent?.(achUpdate);
    this.hitstopTimer = Math.max(this.hitstopTimer, enemy.isBoss ? 0.07 : 0.03);
    this.addShake(enemy.isBoss ? 11 : 3.5, enemy.isBoss ? 0.35 : 0.09);
    this.spawnParticles(enemy.x, enemy.y, enemy.isBoss ? 44 : 18, enemy.isBoss ? '#F59E0B' : '#DC2626', 210, 0.45);

    const kHero = killer ?? this.getHeroState(1);
    if (kHero.stats.killHeal > 0 && !kHero.isDowned) {
      kHero.hp = Math.min(kHero.stats.maxHp, kHero.hp + kHero.stats.killHeal);
    }

    this.grantXp(enemy.xpValue);
    if (this.localCoopMode && this.p2) {
      this.grantXpP2(enemy.xpValue);
    }

    const soulChance = enemy.isBoss ? 1 : 0.28 + this.meta.blessings.fortune * 0.04;
    if (enemy.isBoss) {
      const bossSouls = 18 + this.floor.floorNumber * 8;
      this.soulsThisRun += bossSouls;
      this.spawnFloatingText(enemy.x, enemy.y - 24, `+${bossSouls} Fragmentos`, '#A78BFA', 1.3);
      const bossItem = generateLootItem(
        this.floor.floorNumber,
        this.meta.blessings.fortune,
        this.floor.floorNumber >= 2 ? 'relic' : 'epic'
      );
      this.loot.push({
        id: `loot_${this.idCounter++}`,
        x: enemy.x,
        y: enemy.y,
        vx: 0,
        vy: 30,
        kind: 'item',
        item: bossItem,
        bobPhase: 0,
      });
      const bossRoom = this.floor.rooms[this.floor.bossRoomId];
      this.floor.props.push({
        id: `portal_${this.idCounter++}`,
        kind: 'portal',
        x: (bossRoom.cx + 0.5) * this.floor.tileSize,
        y: (bossRoom.cy + 0.5) * this.floor.tileSize,
        radius: 26,
        interacted: false,
        broken: false,
      });
      this.showBanner('¡Guardián abatido! Portal de descenso abierto');
    } else {
      if (Math.random() < soulChance) {
        this.loot.push({
          id: `loot_${this.idCounter++}`,
          x: enemy.x,
          y: enemy.y,
          vx: (Math.random() - 0.5) * 90,
          vy: (Math.random() - 0.5) * 90,
          kind: 'soul',
          amount: 2 + Math.floor(this.floor.floorNumber * 0.8),
          bobPhase: Math.random() * 6,
        });
      }
      if (Math.random() < 0.72) {
        this.loot.push({
          id: `loot_${this.idCounter++}`,
          x: enemy.x,
          y: enemy.y,
          vx: (Math.random() - 0.5) * 80,
          vy: (Math.random() - 0.5) * 80,
          kind: 'gold',
          amount: enemy.goldValue,
          bobPhase: Math.random() * 6,
        });
      }
      if (Math.random() < 0.16) {
        this.loot.push({
          id: `loot_${this.idCounter++}`,
          x: enemy.x,
          y: enemy.y,
          vx: (Math.random() - 0.5) * 60,
          vy: (Math.random() - 0.5) * 60,
          kind: 'hp_orb',
          amount: Math.round(this.stats.maxHp * 0.14),
          bobPhase: Math.random() * 6,
        });
      }
      if (Math.random() < 0.11 + this.meta.blessings.fortune * 0.015) {
        this.loot.push({
          id: `loot_${this.idCounter++}`,
          x: enemy.x,
          y: enemy.y,
          vx: (Math.random() - 0.5) * 70,
          vy: (Math.random() - 0.5) * 70,
          kind: 'item',
          item: generateLootItem(this.floor.floorNumber, this.meta.blessings.fortune),
          bobPhase: Math.random() * 6,
        });
      }
    }

    const room = this.floor.rooms.find((r) => r.id === enemy.roomId);
    if (room && !this.enemies.some((e) => e.roomId === room.id)) {
      room.cleared = true;
      this.triggerCheckpoint();
    } else if (enemy.isBoss) {
      this.triggerCheckpoint();
    }
  }

  private grantXp(amount: number) {
    this.xp += amount;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level++;
      this.skillPoints++;
      this.xpToNext = Math.round(this.xpToNext * 1.32 + 25);
      this.recomputeStats();
      if (!this.isDowned) this.hp = this.stats.maxHp;
      this.mana = this.stats.maxMana;
      this.levelUpToastTimer = 5.5;
      sfx.playLevelUp();
      this.rings.push({
        x: this.px,
        y: this.py,
        radius: 12,
        maxRadius: 120,
        color: '#F59E0B',
        life: 0.45,
        maxLife: 0.45,
      });
      this.spawnFloatingText(this.px, this.py - 34, `¡Nivel ${this.level}!`, '#F59E0B', 1.35);
      this.callbacks.onAchievementEvent?.({ maxLevelReached: { mode: 'max', value: this.level } });
    }
  }

  private grantXpP2(amount: number) {
    if (!this.p2) return;
    const p2 = this.p2;
    p2.xp += amount;
    while (p2.xp >= p2.xpToNext) {
      p2.xp -= p2.xpToNext;
      p2.level++;
      p2.skillPoints++;
      p2.xpToNext = Math.round(p2.xpToNext * 1.32 + 25);
      this.recomputeStatsForP2();
      if (!p2.isDowned) p2.hp = p2.stats.maxHp;
      p2.mana = p2.stats.maxMana;
      this.levelUpToastTimer = 5.5;
      sfx.playLevelUp();
      this.rings.push({
        x: p2.x,
        y: p2.y,
        radius: 12,
        maxRadius: 120,
        color: '#38BDF8',
        life: 0.45,
        maxLife: 0.45,
      });
      this.spawnFloatingText(p2.x, p2.y - 34, `¡J2 Nivel ${p2.level}!`, '#38BDF8', 1.3);
      this.callbacks.onAchievementEvent?.({ maxLevelReached: { mode: 'max', value: p2.level } });
    }
  }

  private breakUrnsInConeFrom(ox: number, oy: number, angle: number, range: number, arc: number) {
    for (const prop of this.floor.props) {
      if (prop.kind !== 'urn' || prop.broken) continue;
      const dx = prop.x - ox;
      const dy = prop.y - oy;
      const dist = Math.hypot(dx, dy);
      if (dist > range + prop.radius) continue;
      const ang = Math.atan2(dy, dx);
      if (arc >= Math.PI * 1.9 || Math.abs(this.normalizeAngle(ang - angle)) <= arc * 0.6) {
        prop.broken = true;
        if (this.coopMode) coopClient.send({ type: 'prop:break', propId: prop.id });
        sfx.playHit(false);
        this.spawnParticles(prop.x, prop.y, 10, '#A1887F', 120, 0.35);
        if (!this.coopMode && Math.random() < 0.55) {
          this.loot.push({
            id: `loot_${this.idCounter++}`,
            x: prop.x,
            y: prop.y,
            vx: (Math.random() - 0.5) * 60,
            vy: (Math.random() - 0.5) * 60,
            kind: Math.random() < 0.25 ? 'hp_orb' : 'gold',
            amount: 5 + this.floor.floorNumber * 3,
            bobPhase: 0,
          });
        }
      }
    }
  }

  private getAliveLocalHeroes() {
    const list: ReturnType<GameEngine['getHeroState']>[] = [];
    if (!this.isDowned) list.push(this.getHeroState(1));
    if (this.localCoopMode && this.p2 && !this.p2.isDowned) {
      list.push(this.getHeroState(2));
    }
    return list;
  }

  private updateProps(dt: number) {
    const aliveHeroes = this.getAliveLocalHeroes();
    for (const prop of this.floor.props) {
      if (prop.kind !== 'trap') continue;
      if (prop.trapState === 'idle') {
        const triggered = aliveHeroes.some(
          (h) => Math.hypot(prop.x - h.x, prop.y - h.y) < prop.radius + this.pRadius + 10
        );
        if (triggered) {
          prop.trapState = 'arming';
          prop.trapTimer = 0.55;
        }
      } else if (prop.trapState === 'arming') {
        prop.trapTimer = (prop.trapTimer ?? 0) - dt;
        if ((prop.trapTimer ?? 0) <= 0) {
          prop.trapState = 'active';
          prop.trapTimer = 0.45;
          this.spawnParticles(prop.x, prop.y, 10, '#EF4444', 90, 0.3);
          for (const h of aliveHeroes) {
            if (Math.hypot(prop.x - h.x, prop.y - h.y) < prop.radius + this.pRadius) {
              this.damageHero(h, 14 + this.floor.floorNumber * 5);
            }
          }
        }
      } else if (prop.trapState === 'active') {
        prop.trapTimer = (prop.trapTimer ?? 0) - dt;
        if ((prop.trapTimer ?? 0) <= 0) {
          prop.trapState = 'idle';
        }
      }
    }
  }

  private updateVisibility() {
    const ts = this.floor.tileSize;
    const ptx = Math.floor(this.px / ts);
    const pty = Math.floor(this.py / ts);
    const w = this.floor.width;
    const h = this.floor.height;
    const vis = this.floor.visibility;

    for (let i = 0; i < vis.length; i++) {
      if (this.adminFlags.revealMinimap) {
        vis[i] = 2;
      } else if (vis[i] === 2) {
        vis[i] = 1;
      }
    }

    const revealCircle = (cx: number, cy: number, lightR: number) => {
      const rSq = lightR * lightR;
      for (let ty = Math.max(0, cy - lightR); ty <= Math.min(h - 1, cy + lightR); ty++) {
        for (let tx = Math.max(0, cx - lightR); tx <= Math.min(w - 1, cx + lightR); tx++) {
          if ((tx - cx) ** 2 + (ty - cy) ** 2 <= rSq) {
            vis[ty * w + tx] = 2;
          }
        }
      }
    };

    revealCircle(ptx, pty, 9);
    if (this.localCoopMode && this.p2) {
      revealCircle(Math.floor(this.p2.x / ts), Math.floor(this.p2.y / ts), 8);
    }
    if (this.coopMode) {
      for (const ally of this.remotePlayers.values()) {
        if (ally.alive) {
          revealCircle(Math.floor(ally.x / ts), Math.floor(ally.y / ts), 7);
        }
      }
    }

    for (const e of this.enemies) {
      if (!this.seenEnemyTypesThisSession.has(e.type)) {
        const etx = Math.floor(e.x / ts);
        const ety = Math.floor(e.y / ts);
        if (vis[ety * w + etx] === 2) {
          this.seenEnemyTypesThisSession.add(e.type);
          this.callbacks.onBestiaryEvent?.(e.type, false);
        }
      }
    }

    const checkCoords: Array<{ tx: number; ty: number }> = [{ tx: ptx, ty: pty }];
    if (this.localCoopMode && this.p2) {
      checkCoords.push({ tx: Math.floor(this.p2.x / ts), ty: Math.floor(this.p2.y / ts) });
    }

    for (const room of this.floor.rooms) {
      if (!room.discovered) {
        const entered = checkCoords.some(
          (c) =>
            c.tx >= room.x - 1 &&
            c.tx <= room.x + room.w &&
            c.ty >= room.y - 1 &&
            c.ty <= room.y + room.h
        );
        if (entered) {
          room.discovered = true;
          if (room.type === 'boss') {
            sfx.playBossRoar();
            this.showBanner('¡Has entrado al Santuario del Jefe!');
          }
        }
      }
    }
  }

  private findAutoAimEnemyFrom(ox: number, oy: number, maxRange: number): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestDist = maxRange;

    if (this.pvpMode) {
      if (this.pvpMode === 'local' && this.p2) {
        const isP1 = Math.hypot(this.px - ox, this.py - oy) < 4;
        const target = isP1 ? (!this.p2.isDowned ? this.p2 : null) : !this.isDowned ? { x: this.px, y: this.py } : null;
        if (target) {
          const d = Math.hypot(target.x - ox, target.y - oy);
          if (d <= maxRange) return { x: target.x, y: target.y };
        }
      } else if (this.pvpMode === 'online') {
        for (const foe of this.remotePlayers.values()) {
          if (!foe.alive) continue;
          const d = Math.hypot(foe.x - ox, foe.y - oy);
          if (d < bestDist) {
            bestDist = d;
            best = { x: foe.x, y: foe.y };
          }
        }
      }
      return best;
    }

    const ts = this.floor.tileSize;
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      const tx = Math.floor(e.x / ts);
      const ty = Math.floor(e.y / ts);
      if (tx < 0 || ty < 0 || tx >= this.floor.width || ty >= this.floor.height) continue;
      const vis = this.floor.visibility[ty * this.floor.width + tx];
      if (vis !== 2) continue;
      const d = Math.hypot(e.x - ox, e.y - oy);
      if (d < bestDist) {
        bestDist = d;
        best = e;
      }
    }
    return best;
  }

  private updateEnemies(dt: number) {
    if (this.coopMode) {
      const lerpAlpha = Math.min(1, dt * 16);
      for (const e of this.enemies) {
        e.hitFlash = Math.max(0, e.hitFlash - dt);
        e.squashX += (1 - e.squashX) * Math.min(1, dt * 14);
        e.squashY += (1 - e.squashY) * Math.min(1, dt * 14);
        const target = this.enemyNetTargets.get(e.id);
        if (target) {
          e.x += (target.x - e.x) * lerpAlpha;
          e.y += (target.y - e.y) * lerpAlpha;
        }
        if (e.telegraph && e.telegraph.timer > 0) {
          e.telegraph.timer = Math.max(0, e.telegraph.timer - dt);
        }
      }
      return;
    }

    const aliveHeroes = this.getAliveLocalHeroes();

    for (const e of [...this.enemies]) {
      if (e.hp <= 0) continue;

      e.hitFlash = Math.max(0, e.hitFlash - dt);
      e.squashX += (1 - e.squashX) * Math.min(1, dt * 14);
      e.squashY += (1 - e.squashY) * Math.min(1, dt * 14);

      if (!this.pvpMode && this.adminFlags.freezeEnemies) {
        continue;
      }

      e.attackCooldown = Math.max(0, e.attackCooldown - dt);
      e.slowTimer = Math.max(0, e.slowTimer - dt);

      if (e.bleedTimer > 0) {
        e.bleedTimer -= dt;
        const tickDmg = e.bleedDps * dt;
        e.hp -= tickDmg;
        if (Math.random() < dt * 6) {
          this.spawnParticles(e.x, e.y, 1, '#DC2626', 45, 0.25);
        }
        if (e.hp <= 0) {
          this.handleEnemyKilled(e);
          continue;
        }
      }

      let targetX = this.px;
      let targetY = this.py;
      if (aliveHeroes.length > 0) {
        let nearest = aliveHeroes[0];
        let bestD = Math.hypot(nearest.x - e.x, nearest.y - e.y);
        for (let h = 1; h < aliveHeroes.length; h++) {
          const cand = aliveHeroes[h];
          const d = Math.hypot(cand.x - e.x, cand.y - e.y);
          if (d < bestD) {
            bestD = d;
            nearest = cand;
          }
        }
        targetX = nearest.x;
        targetY = nearest.y;
      }

      const dx = targetX - e.x;
      const dy = targetY - e.y;
      const dist = Math.hypot(dx, dy);
      const aggroRange = e.isBoss ? 480 : 340;

      if (e.state === 'idle') {
        if (dist <= aggroRange) {
          e.state = 'chase';
        }
        continue;
      }

      if (e.state === 'windup' && e.telegraph) {
        e.telegraph.timer -= dt;
        if (e.telegraph.timer <= 0) {
          this.executeEnemyAttack(e, e.telegraph);
          e.telegraph = null;
          e.state = 'recover';
          e.stateTimer = e.isBoss ? 0.5 : 0.4;
        }
        continue;
      }

      if (e.state === 'recover') {
        e.stateTimer -= dt;
        if (e.stateTimer <= 0) {
          e.state = 'chase';
        }
        continue;
      }

      e.facing = Math.atan2(dy, dx);
      const spd = e.speed * (e.slowTimer > 0 ? 0.55 : 1);

      if (e.type === 'cultist') {
        if (dist > 220) {
          this.nudgeEnemy(e, (dx / dist) * spd * dt, (dy / dist) * spd * dt);
        } else if (dist < 120) {
          this.nudgeEnemy(e, -(dx / dist) * spd * 0.75 * dt, -(dy / dist) * spd * 0.75 * dt);
        }
        if (dist < 300 && e.attackCooldown <= 0) {
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
            targetX,
            targetY,
          };
        }
      } else if (e.type === 'golem') {
        if (dist > 56) {
          this.nudgeEnemy(e, (dx / dist) * spd * dt, (dy / dist) * spd * dt);
        }
        if (dist < 82 && e.attackCooldown <= 0) {
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
        if (dist > 64) {
          this.nudgeEnemy(e, (dx / dist) * spd * dt, (dy / dist) * spd * dt);
        }
        if (dist < 145 && e.attackCooldown <= 0) {
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
        const floorNum = e.floorNumber ?? this.floor.floorNumber;
        const localCount = this.localCoopMode && this.p2 ? 2 : 1;
        const bm = getBossFloorMultipliers(floorNum, localCount);

        if (floorNum >= 2 && !e.enraged && e.hp <= e.maxHp * 0.5) {
          e.enraged = true;
          e.attackCooldown = Math.min(e.attackCooldown, 0.35);
          e.speed = Math.round(e.speed * 1.15);
          sfx.playBossRoar();
          this.addShake(7, 0.25);
          this.rings.push({
            x: e.x,
            y: e.y,
            radius: 20,
            maxRadius: 145,
            color: '#EF4444',
            life: 0.4,
            maxLife: 0.4,
          });
          this.showBanner(`¡${e.name} desata la Furia del Eclipse!`);
        }

        const enragedCd = e.enraged ? 0.76 : 1;
        const enragedTele = e.enraged ? 0.85 : 1;
        const effectiveSpd = spd * (e.enraged ? 1.12 : 1);

        if (dist > 78) {
          this.nudgeEnemy(e, (dx / dist) * effectiveSpd * dt, (dy / dist) * effectiveSpd * dt);
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
              targetX,
              targetY,
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
            const windup = Math.max(0.38, 0.68 * bm.telegraphMult * enragedTele);
            if (e.type === 'boss_archon') {
              e.telegraph = {
                type: 'line',
                timer: windup,
                duration: windup,
                angle: e.facing,
                range: 340,
                radius: 10,
                damage: Math.round(e.damage * 0.95),
                targetX,
                targetY,
                orbCount: 3 + Math.min(4, Math.max(0, floorNum - 2)) + (e.enraged ? 2 : 0),
                orbSpeed: 310 + Math.min(140, (floorNum - 1) * 22),
                enraged: e.enraged,
              };
            } else {
              e.telegraph = {
                type: 'circle',
                timer: windup,
                duration: windup,
                angle: e.facing,
                range: 0,
                radius: 110 + bm.bonusSlamRadius,
                damage: Math.round(e.damage * 1.22),
                targetX,
                targetY,
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
              targetX,
              targetY,
              enraged: e.enraged,
            };
          }
        }
      } else {
        if (dist > 44) {
          this.nudgeEnemy(e, (dx / dist) * spd * dt, (dy / dist) * spd * dt);
        }
        if (dist < 62 && e.attackCooldown <= 0) {
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
            targetX,
            targetY,
          };
        }
      }
    }
  }

  private executeEnemyAttack(e: EnemyEntity, t: NonNullable<EnemyEntity['telegraph']>) {
    e.squashX = 1.25;
    e.squashY = 0.8;
    const targets = this.getAliveLocalHeroes();

    if (t.type === 'arc') {
      this.slashes.push({
        x: e.x,
        y: e.y,
        angle: t.angle,
        arc: t.radius,
        radius: t.range,
        color: '#DC2626',
        life: 0.18,
        maxLife: 0.18,
        isSpin: false,
      });
      for (const h of targets) {
        const dist = Math.hypot(h.x - e.x, h.y - e.y);
        const ang = Math.atan2(h.y - e.y, h.x - e.x);
        if (dist <= t.range + this.pRadius && Math.abs(this.normalizeAngle(ang - t.angle)) <= t.radius * 0.55) {
          this.damageHero(h, t.damage);
        }
      }
    } else if (t.type === 'circle') {
      this.rings.push({
        x: t.targetX,
        y: t.targetY,
        radius: 14,
        maxRadius: t.radius,
        color: '#EF4444',
        life: 0.3,
        maxLife: 0.3,
      });
      this.addShake(5, 0.16);
      for (const h of targets) {
        const dist = Math.hypot(h.x - t.targetX, h.y - t.targetY);
        if (dist <= t.radius + this.pRadius * 0.7) {
          this.damageHero(h, t.damage);
        }
      }
    } else if (t.type === 'line') {
      if (e.type === 'wraith') {
        if (!this.collidesWall(t.targetX, t.targetY, e.radius)) {
          e.x = t.targetX;
          e.y = t.targetY;
        }
        this.spawnParticles(e.x, e.y, 10, '#8B5CF6', 110, 0.25);
        for (const h of targets) {
          if (Math.hypot(h.x - e.x, h.y - e.y) <= e.radius + this.pRadius + 24) {
            this.damageHero(h, t.damage);
          }
        }
      } else if (e.isBoss) {
        if (t.enraged && !e.enraged) e.enraged = true;
        const count = Math.max(1, t.orbCount ?? 3);
        const speed = t.orbSpeed ?? 320;
        const spread = Math.min(Math.PI * 0.55, 0.16 * (count - 1));
        for (let i = 0; i < count; i++) {
          const offset = count === 1 ? 0 : (i / (count - 1) - 0.5) * spread;
          const a = t.angle + offset;
          this.spawnProjectile({
            fromPlayer: false,
            x: e.x + Math.cos(a) * 18,
            y: e.y + Math.sin(a) * 18,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed,
            radius: 8,
            damage: t.damage,
            isCrit: false,
            color: e.type === 'boss_archon' ? '#A855F7' : '#EF4444',
            maxLife: 1.6,
            pierce: 0,
            applyBleed: false,
            applySlow: false,
            kind: 'enemy_orb',
          });
        }
      } else {
        this.spawnProjectile({
          fromPlayer: false,
          x: e.x + Math.cos(t.angle) * 14,
          y: e.y + Math.sin(t.angle) * 14,
          vx: Math.cos(t.angle) * 320,
          vy: Math.sin(t.angle) * 320,
          radius: 7,
          damage: t.damage,
          isCrit: false,
          color: '#A855F7',
          maxLife: 1.4,
          pierce: 0,
          applyBleed: false,
          applySlow: false,
          kind: 'enemy_orb',
        });
      }
    } else if (t.type === 'nova') {
      if (t.enraged && !e.enraged) e.enraged = true;
      const orbs = t.orbCount ?? (e.type === 'boss_archon' ? 10 : 8);
      const orbSpeed = t.orbSpeed ?? 265;
      for (let i = 0; i < orbs; i++) {
        const a = t.angle + (i / orbs) * Math.PI * 2;
        this.spawnProjectile({
          fromPlayer: false,
          x: e.x + Math.cos(a) * 18,
          y: e.y + Math.sin(a) * 18,
          vx: Math.cos(a) * orbSpeed,
          vy: Math.sin(a) * orbSpeed,
          radius: 8,
          damage: Math.round(t.damage * 0.85),
          isCrit: false,
          color: e.type === 'boss_archon' ? '#8B5CF6' : '#EF4444',
          maxLife: 1.55,
          pierce: 0,
          applyBleed: false,
          applySlow: false,
          kind: 'enemy_orb',
        });
      }
      this.rings.push({
        x: e.x,
        y: e.y,
        radius: 18,
        maxRadius: t.radius,
        color: t.enraged ? '#EF4444' : '#F59E0B',
        life: 0.32,
        maxLife: 0.32,
      });
    }
  }

  private checkPvpAttackHit(
    attacker: ReturnType<GameEngine['getHeroState']>,
    originX: number,
    originY: number,
    range: number,
    arc: number,
    angle: number,
    damage: number,
    isCrit: boolean,
    color: string,
    knockForce: number,
    skillId: ActiveSkillId | 'basic' | 'dash_decoy'
  ): boolean {
    if (!this.pvpMode || this.pvpPhase !== 'fighting' || attacker.isDowned) return false;

    if (this.pvpMode === 'local' && this.p2) {
      const target = this.getHeroState(attacker.num === 1 ? 2 : 1);
      if (target.isDowned || target.invuln > 0) return false;
      const dx = target.x - originX;
      const dy = target.y - originY;
      const dist = Math.hypot(dx, dy);
      if (dist > range + this.pRadius) return false;
      if (arc < Math.PI * 1.95) {
        const diff = Math.abs(this.normalizeAngle(Math.atan2(dy, dx) - angle));
        if (diff > arc * 0.56 && dist > this.pRadius * 2 + 8) return false;
      }
      const kx = dist > 0.1 ? (dx / dist) * knockForce : 0;
      const ky = dist > 0.1 ? (dy / dist) * knockForce : 0;
      this.applyLocalPvpDamage(target, damage, isCrit, color, kx, ky, attacker);
      return true;
    }

    if (this.pvpMode === 'online' && attacker.num === 1) {
      for (const [id, foe] of this.remotePlayers.entries()) {
        if (!foe.alive) continue;
        const dx = foe.x - originX;
        const dy = foe.y - originY;
        const dist = Math.hypot(dx, dy);
        if (dist > range + this.pRadius + 10) continue;
        if (arc < Math.PI * 1.95) {
          const diff = Math.abs(this.normalizeAngle(Math.atan2(dy, dx) - angle));
          if (diff > arc * 0.58 && dist > this.pRadius * 2 + 12) continue;
        }
        const kx = dist > 0.1 ? (dx / dist) * knockForce : 0;
        const ky = dist > 0.1 ? (dy / dist) * knockForce : 0;
        coopClient.send({
          type: 'pvp:hit',
          targetId: id,
          damage,
          isCrit,
          color,
          knockX: kx,
          knockY: ky,
          skillId,
        });
        return true;
      }
    }

    return false;
  }

  private applyLocalPvpDamage(
    target: ReturnType<GameEngine['getHeroState']>,
    rawAmount: number,
    isCrit: boolean,
    color: string,
    knockX: number,
    knockY: number,
    attacker: ReturnType<GameEngine['getHeroState']> | null
  ) {
    if (this.pvpMode !== 'local' || this.pvpPhase !== 'fighting' || target.isDowned) return;

    const mitigation = attacker ? target.stats.armor / (target.stats.armor + 45) : 0;
    const mitigatedTotal = Math.max(2, Math.round(rawAmount * (1 - mitigation)));
    let remaining = mitigatedTotal;

    if (target.shield > 0) {
      const absorbed = Math.min(target.shield, remaining);
      target.shield -= absorbed;
      remaining -= absorbed;
      if (absorbed > 0) {
        this.spawnFloatingText(target.x, target.y - 30, `-${absorbed} Escudo`, '#F59E0B', 0.9);
      }
    }

    if (remaining > 0) {
      target.hp = Math.max(0, target.hp - remaining);
    }

    target.hitFlash = 0.16;
    target.invuln = attacker ? Math.max(target.invuln, 0.14) : target.invuln;
    if (knockX || knockY) {
      this.moveHeroWithWallSlide(target, knockX, knockY);
    }

    sfx.playHit(isCrit);
    this.spawnParticles(target.x, target.y, isCrit ? 12 : 7, isCrit ? '#F59E0B' : color, 145, 0.3);
    this.spawnFloatingText(
      target.x + (Math.random() - 0.5) * 14,
      target.y - 24,
      isCrit ? `${mitigatedTotal}!` : `${mitigatedTotal}`,
      isCrit ? '#F59E0B' : '#EF4444',
      isCrit ? 1.24 : 0.96
    );
    if (isCrit) {
      this.addShake(4, 0.1);
    }

    if (attacker && attacker.stats.lifesteal > 0 && !attacker.isDowned) {
      const leech = Math.max(1, Math.round(mitigatedTotal * attacker.stats.lifesteal));
      attacker.hp = Math.min(attacker.stats.maxHp, attacker.hp + leech);
    }

    if (target.hp <= 0) {
      target.hp = 0;
      target.isDowned = true;
      const winnerNum: 1 | 2 = target.num === 1 ? 2 : 1;
      this.resolveLocalPvpRound(winnerNum);
    } else {
      this.emitHud();
    }
  }

  private resolveLocalPvpRound(winnerNum: 1 | 2) {
    if (this.pvpMode !== 'local' || this.pvpPhase !== 'fighting') return;
    this.pvpLocalRoundsWon[winnerNum - 1] += 1;
    for (const p of this.projectiles) p.active = false;
    this.slashes = [];

    const winnerName = winnerNum === 1 ? 'Jugador 1' : 'Jugador 2';
    const loserName = winnerNum === 1 ? 'Jugador 2' : 'Jugador 1';

    if (this.pvpLocalRoundsWon[winnerNum - 1] >= PVP_ROUNDS_TO_WIN) {
      this.pvpPhase = 'match_end';
      this.pvpPhaseTimer = 0;
      this.pvpWinnerId = winnerNum === 1 ? 'local_p1' : 'local_p2';
      this.pvpWinnerName = winnerName;
      const result: PvpMatchResult = {
        mode: 'local',
        won: winnerNum === 1,
        winnerName,
        loserName,
        p1Rounds: this.pvpLocalRoundsWon[0],
        p2Rounds: this.pvpLocalRoundsWon[1],
        eloBefore: this.meta.pvpElo,
        eloAfter: this.meta.pvpElo,
        eloDelta: 0,
        tierName: 'Duelo Local',
        unlockedTitle: null,
        soulsReward: winnerNum === 1 ? 15 : 8,
      };
      this.pvpMatchResult = result;
      sfx.playVictory();
      if (!this.pvpReported) {
        this.pvpReported = true;
        this.callbacks.onPvpMatchFinished?.(result);
      }
      this.emitHud();
      return;
    }

    this.pvpPhase = 'round_end';
    this.pvpPhaseTimer = PVP_ROUND_END_SEC;
    sfx.playVictory();
    this.showBanner(`Ronda ${this.pvpRoundNumber}: ¡${winnerName} gana la ronda!`);
    this.emitHud();
  }

  private updateLocalPvpMatch(dt: number) {
    if (this.pvpMode !== 'local' || !this.p2) return;

    if (this.pvpPhase === 'countdown') {
      this.pvpPhaseTimer -= dt;
      this.px = PVP_SPAWN_P1.x;
      this.py = PVP_SPAWN_P1.y;
      this.pFacing = PVP_SPAWN_P1.facing;
      this.p2.x = PVP_SPAWN_P2.x;
      this.p2.y = PVP_SPAWN_P2.y;
      this.p2.facing = PVP_SPAWN_P2.facing;
      if (this.pvpPhaseTimer <= 0) {
        this.pvpPhase = 'fighting';
        this.pvpPhaseTimer = PVP_ROUND_DURATION_SEC;
        this.pvpRingRadius = PVP_RING_MAX_RADIUS;
        this.pvpOrbSpawnTimer = 8;
        this.pvpRingTickAccum = [0, 0];
        sfx.playBossRoar();
        this.showBanner(`¡RONDA ${this.pvpRoundNumber} · COMBATE!`);
        this.emitHud();
      }
      return;
    }

    if (this.pvpPhase === 'fighting') {
      this.pvpPhaseTimer = Math.max(0, this.pvpPhaseTimer - dt);
      const elapsed = PVP_ROUND_DURATION_SEC - this.pvpPhaseTimer;
      if (elapsed > PVP_RING_SHRINK_START_SEC) {
        const shrinkWindow = Math.max(1, PVP_ROUND_DURATION_SEC - PVP_RING_SHRINK_START_SEC);
        const progress = Math.min(1, (elapsed - PVP_RING_SHRINK_START_SEC) / shrinkWindow);
        this.pvpRingRadius =
          PVP_RING_MAX_RADIUS - (PVP_RING_MAX_RADIUS - PVP_RING_MIN_RADIUS) * progress;
      }

      // Eclipse storm tick outside shrinking ring
      const d1 = Math.hypot(this.px - PVP_ARENA_CENTER.x, this.py - PVP_ARENA_CENTER.y);
      if (d1 > this.pvpRingRadius && !this.isDowned) {
        this.pvpRingTickAccum[0] += dt;
        if (this.pvpRingTickAccum[0] >= 0.5) {
          this.pvpRingTickAccum[0] -= 0.5;
          this.applyLocalPvpDamage(this.getHeroState(1), 14, false, '#A855F7', 0, 0, null);
          if (this.pvpPhase !== 'fighting') return;
        }
      } else {
        this.pvpRingTickAccum[0] = 0;
      }

      const d2 = Math.hypot(this.p2.x - PVP_ARENA_CENTER.x, this.p2.y - PVP_ARENA_CENTER.y);
      if (d2 > this.pvpRingRadius && !this.p2.isDowned) {
        this.pvpRingTickAccum[1] += dt;
        if (this.pvpRingTickAccum[1] >= 0.5) {
          this.pvpRingTickAccum[1] -= 0.5;
          this.applyLocalPvpDamage(this.getHeroState(2), 14, false, '#A855F7', 0, 0, null);
          if (this.pvpPhase !== 'fighting') return;
        }
      } else {
        this.pvpRingTickAccum[1] = 0;
      }

      // Central energy / healing orbs
      this.pvpOrbSpawnTimer -= dt;
      if (this.pvpOrbSpawnTimer <= 0 && this.pvpOrbs.length < 2) {
        this.pvpOrbSpawnTimer = 11;
        const angle = Math.random() * Math.PI * 2;
        const dist = 35 + Math.random() * 85;
        const kind: 'heal' | 'mana' = this.pvpOrbSeq % 2 === 0 ? 'mana' : 'heal';
        this.pvpOrbs.push({
          id: `pvp_orb_${this.pvpOrbSeq++}`,
          x: PVP_ARENA_CENTER.x + Math.cos(angle) * dist,
          y: PVP_ARENA_CENTER.y + Math.sin(angle) * dist,
          kind,
          amount: kind === 'heal' ? 55 : 40,
        });
      }

      const heroes = [this.getHeroState(1), this.getHeroState(2)];
      for (let i = this.pvpOrbs.length - 1; i >= 0; i--) {
        const orb = this.pvpOrbs[i];
        let picked = false;
        for (const h of heroes) {
          if (h.isDowned) continue;
          if (Math.hypot(h.x - orb.x, h.y - orb.y) <= this.pRadius + 18) {
            if (orb.kind === 'heal') {
              h.hp = Math.min(h.stats.maxHp, h.hp + orb.amount);
              sfx.playPickup(false);
              this.spawnFloatingText(orb.x, orb.y - 12, `+${orb.amount} Vida`, '#10B981', 0.95);
            } else {
              h.mana = Math.min(h.stats.maxMana, h.mana + orb.amount);
              sfx.playPickup(true);
              this.spawnFloatingText(orb.x, orb.y - 12, `+${orb.amount} Maná`, '#A78BFA', 0.95);
            }
            picked = true;
            break;
          }
        }
        if (picked) {
          this.pvpOrbs.splice(i, 1);
          this.emitHud();
        }
      }

      if (this.pvpPhaseTimer <= 0 && !this.isDowned && !this.p2.isDowned) {
        const pct1 = this.hp / Math.max(1, this.stats.maxHp);
        const pct2 = this.p2.hp / Math.max(1, this.p2.stats.maxHp);
        this.resolveLocalPvpRound(pct1 >= pct2 ? 1 : 2);
      }
      return;
    }

    if (this.pvpPhase === 'round_end') {
      this.pvpPhaseTimer -= dt;
      if (this.pvpPhaseTimer <= 0) {
        this.pvpRoundNumber += 1;
        this.pvpPhase = 'countdown';
        this.pvpPhaseTimer = PVP_COUNTDOWN_SEC;
        this.pvpRingRadius = PVP_RING_MAX_RADIUS;
        this.pvpOrbs = [];
        this.pvpRingTickAccum = [0, 0];

        this.isDowned = false;
        this.hp = this.stats.maxHp;
        this.mana = this.stats.maxMana;
        this.shield = 0;
        this.shieldTimer = 0;
        this.flaskCharges = this.maxFlaskCharges;
        this.skillCooldowns = { Q: 0, E: 0, R: 0 };
        this.dashCooldown = 0;
        this.px = PVP_SPAWN_P1.x;
        this.py = PVP_SPAWN_P1.y;
        this.pFacing = PVP_SPAWN_P1.facing;

        this.p2.isDowned = false;
        this.p2.hp = this.p2.stats.maxHp;
        this.p2.mana = this.p2.stats.maxMana;
        this.p2.shield = 0;
        this.p2.shieldTimer = 0;
        this.p2.flaskCharges = this.p2.maxFlaskCharges;
        this.p2.skillCooldowns = { Q: 0, E: 0, R: 0 };
        this.p2.dashCooldown = 0;
        this.p2.x = PVP_SPAWN_P2.x;
        this.p2.y = PVP_SPAWN_P2.y;
        this.p2.facing = PVP_SPAWN_P2.facing;

        for (const p of this.projectiles) p.active = false;
        this.slashes = [];
        this.showBanner(`Ronda ${this.pvpRoundNumber} · Prepárate`);
        this.emitHud();
      }
    }
  }

  private damageHero(hero: ReturnType<GameEngine['getHeroState']>, rawAmount: number) {
    if (!this.pvpMode && this.adminFlags.godMode) return;
    if (hero.invuln > 0 || hero.isDowned) return;
    if (!this.coopMode && this.screen !== 'PLAYING') return;
    if (this.coopMode && this.screen !== 'PLAYING' && this.screen !== 'PAUSED') return;

    if (this.coopMode && hero.num === 1) {
      const mitigation = hero.stats.armor / (hero.stats.armor + 45);
      const estDmg = Math.max(2, Math.round(rawAmount * (1 - mitigation)));
      hero.hitFlash = 0.16;
      hero.invuln = 0.35;
      this.addShake(6, 0.16);
      sfx.playPlayerHurt();
      this.spawnParticles(hero.x, hero.y, 12, '#DC2626', 140, 0.32);
      this.spawnFloatingText(hero.x, hero.y - 28, `-${estDmg}`, '#EF4444', 1.1);
      coopClient.send({ type: 'player:hurt', rawDamage: rawAmount });
      return;
    }

    const mitigation = hero.stats.armor / (hero.stats.armor + 45);
    let dmg = Math.max(2, Math.round(rawAmount * (1 - mitigation)));

    if (hero.shield > 0) {
      const absorbed = Math.min(hero.shield, dmg);
      hero.shield -= absorbed;
      dmg -= absorbed;
      if (absorbed > 0) {
        this.spawnFloatingText(hero.x, hero.y - 28, `-${absorbed} Escudo`, '#F59E0B', 0.9);
      }
    }

    if (dmg > 0) {
      hero.hp -= dmg;
      hero.hitFlash = 0.16;
      hero.invuln = 0.35;
      this.addShake(6, 0.16);
      sfx.playPlayerHurt();
      this.spawnParticles(hero.x, hero.y, 12, '#DC2626', 140, 0.32);
      this.spawnFloatingText(hero.x, hero.y - 28, `-${dmg}`, '#EF4444', 1.1);
    }

    if (hero.hp <= 0) {
      hero.hp = 0;
      if (this.localCoopMode && this.p2) {
        hero.isDowned = true;
        const other = this.getHeroState(hero.num === 1 ? 2 : 1);
        if (!other.isDowned) {
          this.showBanner(`${hero.label} ha caído · ${other.label} puede revivirlo`);
        } else {
          this.finishRun(false);
        }
      } else {
        this.finishRun(false);
      }
    }
    this.emitHud();
  }

  private finishRun(victory: boolean) {
    if (this.runReported) return;
    this.runReported = true;
    this.screen = victory ? 'VICTORY' : 'GAME_OVER';
    this.heldKeys.clear();
    this.mouseDown = false;

    if (victory) {
      sfx.playVictory();
      this.soulsThisRun += 25 + this.floor.floorNumber * 5;
    }

    const record: RunRecord = {
      id: `run_${Date.now()}`,
      dateIso: new Date().toISOString(),
      archetype: this.archetype,
      classTitle: computeHybridClassTitle(this.archetype, this.unlockedNodeIds),
      floorReached: this.floor.floorNumber,
      kills: this.kills,
      soulsEarned: Math.max(4, this.soulsThisRun + Math.floor(this.kills * 0.4)),
      victory,
    };
    if (!this.coopMode) {
      this.callbacks.onClearCheckpoint?.();
    }
    this.callbacks.onRunFinished(record);
    this.emitHud();
  }

  private nudgeEnemy(e: EnemyEntity, dx: number, dy: number) {
    if (!this.collidesWall(e.x + dx, e.y, e.radius)) e.x += dx;
    if (!this.collidesWall(e.x, e.y + dy, e.radius)) e.y += dy;
  }

  private spawnProjectile(
    cfg: Omit<Projectile, 'active' | 'life' | 'hitIds'> & { ownerNum?: 1 | 2; skillId?: ActiveSkillId | 'basic' }
  ) {
    const slot = this.projectiles.find((p) => !p.active);
    if (!slot) return;
    slot.active = true;
    slot.fromPlayer = cfg.fromPlayer;
    slot.visualOnly = cfg.visualOnly;
    slot.ownerNum = cfg.ownerNum ?? 1;
    slot.skillId = cfg.skillId ?? 'basic';
    slot.x = cfg.x;
    slot.y = cfg.y;
    slot.vx = cfg.vx;
    slot.vy = cfg.vy;
    slot.radius = cfg.radius;
    slot.damage = cfg.damage;
    slot.isCrit = cfg.isCrit;
    slot.color = cfg.color;
    slot.life = cfg.maxLife;
    slot.maxLife = cfg.maxLife;
    slot.pierce = cfg.pierce;
    slot.hitIds.clear();
    slot.applyBleed = cfg.applyBleed;
    slot.applySlow = cfg.applySlow;
    slot.kind = cfg.kind;
  }

  private updateProjectiles(dt: number) {
    const aliveHeroes = this.getAliveLocalHeroes();
    for (const p of this.projectiles) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (this.collidesWall(p.x, p.y, p.radius * 0.6)) {
        p.active = false;
        this.spawnParticles(p.x, p.y, 6, p.color, 90, 0.22);
        continue;
      }

      if (p.fromPlayer) {
        for (const prop of this.floor.props) {
          if (prop.kind === 'urn' && !prop.broken) {
            if (Math.hypot(prop.x - p.x, prop.y - p.y) <= prop.radius + p.radius) {
              prop.broken = true;
              if (this.coopMode && !p.visualOnly) {
                coopClient.send({ type: 'prop:break', propId: prop.id });
              }
              this.spawnParticles(prop.x, prop.y, 8, '#A1887F', 100, 0.3);
            }
          }
        }

        if (p.visualOnly) continue;

        const ownerHero = this.getHeroState(p.ownerNum ?? 1);

        if (this.pvpMode && this.pvpPhase === 'fighting') {
          if (this.pvpMode === 'local' && this.p2) {
            const target = this.getHeroState(ownerHero.num === 1 ? 2 : 1);
            if (!target.isDowned && !p.hitIds.has(`pvp_${target.num}`)) {
              if (Math.hypot(target.x - p.x, target.y - p.y) <= this.pRadius + p.radius + 4) {
                p.hitIds.add(`pvp_${target.num}`);
                this.applyLocalPvpDamage(target, p.damage, p.isCrit, p.color, 0, 0, ownerHero);
                if (p.pierce > 0) {
                  p.pierce--;
                } else {
                  p.active = false;
                }
                continue;
              }
            }
          } else if (this.pvpMode === 'online' && ownerHero.num === 1) {
            let hitRemote = false;
            for (const [id, foe] of this.remotePlayers.entries()) {
              if (!foe.alive || p.hitIds.has(id)) continue;
              if (Math.hypot(foe.x - p.x, foe.y - p.y) <= this.pRadius + p.radius + 6) {
                p.hitIds.add(id);
                coopClient.send({
                  type: 'pvp:hit',
                  targetId: id,
                  damage: p.damage,
                  isCrit: p.isCrit,
                  color: p.color,
                  knockX: 0,
                  knockY: 0,
                  skillId: p.skillId ?? 'basic',
                });
                hitRemote = true;
                if (p.pierce > 0) {
                  p.pierce--;
                } else {
                  p.active = false;
                  break;
                }
              }
            }
            if (hitRemote && !p.active) continue;
          }
        }

        for (const e of [...this.enemies]) {
          if (p.hitIds.has(e.id)) continue;
          if (Math.hypot(e.x - p.x, e.y - p.y) <= e.radius + p.radius) {
            p.hitIds.add(e.id);
            if (!this.coopMode) {
              if (p.applySlow) e.slowTimer = Math.max(e.slowTimer, 2.2);
              if (p.applyBleed) {
                e.bleedTimer = Math.max(e.bleedTimer, 2.5);
                e.bleedDps = Math.max(e.bleedDps, Math.round(ownerHero.stats.baseDamage * 0.35));
              }
            }
            const prevCtx = this.currentHitSkillId;
            this.currentHitSkillId = p.skillId ?? 'basic';
            this.damageEnemy(e, p.damage, p.isCrit, p.color, 0, 0, p.applySlow, ownerHero);
            this.currentHitSkillId = prevCtx;
            if (p.pierce > 0) {
              p.pierce--;
            } else {
              p.active = false;
              break;
            }
          }
        }
      } else {
        for (const h of aliveHeroes) {
          if (Math.hypot(h.x - p.x, h.y - p.y) <= this.pRadius + p.radius) {
            p.active = false;
            this.damageHero(h, p.damage);
            break;
          }
        }
      }
    }
  }

  private updateLoot(dt: number) {
    const aliveHeroes = this.getAliveLocalHeroes();
    if (aliveHeroes.length === 0) return;

    const nowMs = Date.now();
    for (let i = this.loot.length - 1; i >= 0; i--) {
      const l = this.loot[i];
      l.bobPhase += dt * 4;
      l.vx *= Math.max(0, 1 - dt * 6);
      l.vy *= Math.max(0, 1 - dt * 6);
      if (!this.collidesWall(l.x + l.vx * dt, l.y + l.vy * dt, 6)) {
        l.x += l.vx * dt;
        l.y += l.vy * dt;
      }

      let picker = aliveHeroes[0];
      let dist = Math.hypot(picker.x - l.x, picker.y - l.y);
      for (let j = 1; j < aliveHeroes.length; j++) {
        const cand = aliveHeroes[j];
        const d = Math.hypot(cand.x - l.x, cand.y - l.y);
        if (d < dist) {
          dist = d;
          picker = cand;
        }
      }

      const dx = picker.x - l.x;
      const dy = picker.y - l.y;

      const pullRange = !this.pvpMode && !this.coopMode && this.adminFlags.autoLoot ? 9999 : 85;
      const pullSpeed = !this.pvpMode && !this.coopMode && this.adminFlags.autoLoot ? 540 : 240;
      if (dist < pullRange && dist > 1) {
        const pull = pullSpeed * dt;
        l.x += (dx / dist) * pull;
        l.y += (dy / dist) * pull;
      }

      if (dist <= this.pRadius + 14) {
        if (this.coopMode) {
          const pendingSince = this.pendingLootPickups.get(l.id) ?? 0;
          if (nowMs - pendingSince > 900) {
            this.pendingLootPickups.set(l.id, nowMs);
            coopClient.send({ type: 'loot:pickup', lootId: l.id });
          }
          continue;
        }

        if (l.kind === 'gold') {
          this.gold += l.amount ?? 5;
          sfx.playPickup(false);
          this.spawnFloatingText(l.x, l.y - 12, `+${l.amount} Oro`, '#F59E0B', 0.85);
        } else if (l.kind === 'soul') {
          this.soulsThisRun += l.amount ?? 2;
          sfx.playPickup(true);
          this.spawnFloatingText(l.x, l.y - 12, `+${l.amount} Alma`, '#A78BFA', 0.95);
        } else if (l.kind === 'hp_orb') {
          const heal = l.amount ?? 20;
          picker.hp = Math.min(picker.stats.maxHp, picker.hp + heal);
          sfx.playPickup(false);
          this.spawnFloatingText(l.x, l.y - 12, `+${heal} Vida`, '#10B981', 0.9);
        } else if (l.kind === 'item' && l.item) {
          picker.inventory = [l.item, ...picker.inventory].slice(0, 18);
          if (l.item.rarity === 'relic') {
            this.callbacks.onAchievementEvent?.({ relicRarityObtained: { mode: 'max', value: 1 } });
          }
          sfx.playPickup(l.item.rarity !== 'common');
          this.spawnFloatingText(
            l.x,
            l.y - 16,
            this.localCoopMode ? `${picker.label}: ${l.item.name}` : l.item.name,
            RARITY_COLORS[l.item.rarity],
            1.0
          );
        }
        this.loot.splice(i, 1);
        this.emitHud();
      }
    }
  }

  private updateEffects(dt: number) {
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      this.slashes[i].life -= dt;
      if (this.slashes[i].life <= 0) this.slashes.splice(i, 1);
    }
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      this.ghosts[i].life -= dt;
      if (this.ghosts[i].life <= 0) this.ghosts.splice(i, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      this.rings[i].life -= dt;
      if (this.rings[i].life <= 0) this.rings.splice(i, 1);
    }
    for (const pt of this.particles) {
      if (!pt.active) continue;
      pt.life -= dt;
      if (pt.life <= 0) {
        pt.active = false;
        continue;
      }
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= Math.max(0, 1 - dt * pt.drag);
      pt.vy *= Math.max(0, 1 - dt * pt.drag);
    }
    for (const ft of this.floatingTexts) {
      if (!ft.active) continue;
      ft.life -= dt;
      if (ft.life <= 0) {
        ft.active = false;
        continue;
      }
      ft.y += ft.vy * dt;
    }
  }

  private spawnParticles(
    x: number,
    y: number,
    count: number,
    color: string,
    speed: number,
    maxLife: number
  ) {
    let spawned = 0;
    for (const pt of this.particles) {
      if (pt.active) continue;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.7);
      pt.active = true;
      pt.x = x;
      pt.y = y;
      pt.vx = Math.cos(a) * s;
      pt.vy = Math.sin(a) * s;
      pt.size = 2 + Math.random() * 3;
      pt.color = color;
      pt.life = maxLife * (0.7 + Math.random() * 0.4);
      pt.maxLife = maxLife;
      pt.drag = 5;
      spawned++;
      if (spawned >= count) break;
    }
  }

  private spawnFloatingText(
    x: number,
    y: number,
    text: string,
    color: string,
    scale: number
  ) {
    const slot = this.floatingTexts.find((f) => !f.active);
    if (!slot) return;
    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.vy = -38;
    slot.text = text;
    slot.color = color;
    slot.scale = scale;
    slot.life = 0.75;
    slot.maxLife = 0.75;
  }

  private addShake(intensity: number, duration: number) {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  private showBanner(msg: string) {
    this.bannerMessage = msg;
    this.bannerTimer = 3.2;
  }

  private normalizeAngle(a: number): number {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  // ==================== RENDERING ====================
  private render() {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // Clear obsidian void
    ctx.fillStyle = '#090A0E';
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    if (this.screen === 'TITLE') {
      ctx.restore();
      return;
    }

    const shakeX = this.shakeTime > 0 ? (Math.random() - 0.5) * 2 * this.shakeIntensity : 0;
    const shakeY = this.shakeTime > 0 ? (Math.random() - 0.5) * 2 * this.shakeIntensity : 0;

    ctx.save();
    ctx.translate(this.viewW / 2 + shakeX, this.viewH / 2 + shakeY);
    ctx.scale(this.camScale, this.camScale);
    ctx.translate(-Math.round(this.camX), -Math.round(this.camY));

    this.renderDungeonTiles(ctx);
    this.renderProps(ctx);
    this.renderPvpArenaOverlays(ctx);
    this.renderEnemyTelegraphs(ctx);
    this.renderLoot(ctx);
    this.renderGhosts(ctx);
    this.renderEnemies(ctx);
    this.renderRemotePlayers(ctx);
    this.renderLocalPlayer2(ctx);
    this.renderPlayer(ctx);
    this.renderSlashesAndRings(ctx);
    this.renderProjectiles(ctx);
    this.renderParticles(ctx);
    this.renderAmbientMotes(ctx);
    this.renderFloatingTexts(ctx);
    if (this.adminFlags.showHitboxes && !this.pvpMode) {
      this.renderAdminDebugOverlay(ctx);
    }

    ctx.restore();

    // Soft gothic torchlight vignette around viewport
    const grad = ctx.createRadialGradient(
      this.viewW / 2,
      this.viewH / 2,
      Math.min(this.viewW, this.viewH) * 0.25,
      this.viewW / 2,
      this.viewH / 2,
      Math.max(this.viewW, this.viewH) * 0.72
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(6,7,10,0.62)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    // Custom Aim Reticle (desktop mouse only)
    if (this.screen === 'PLAYING' && this.lastInputType === 'mouse') {
      this.renderAimReticle(ctx);
    }

    ctx.restore();
  }

  private renderAdminDebugOverlay(ctx: CanvasRenderingContext2D) {
    ctx.save();
    // Hero hurtbox & melee reach ring
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(this.px, this.py, this.pRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(245, 158, 11, 0.35)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(this.px, this.py, 72, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Enemy hitboxes, aggro rings, and state labels
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      ctx.strokeStyle = e.isBoss ? 'rgba(239, 68, 68, 0.9)' : 'rgba(248, 113, 113, 0.75)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(167, 139, 250, 0.2)';
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.isBoss ? 480 : 340, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#E5E0D5';
      ctx.fillText(
        `${Math.ceil(e.hp)}/${e.maxHp} [${this.adminFlags.freezeEnemies ? 'frozen' : e.state}]`,
        e.x,
        e.y - e.radius - 8
      );
    }
    ctx.restore();
  }

  private renderAmbientMotes(ctx: CanvasRenderingContext2D) {
    for (const m of this.ambientMotes) {
      const mx =
        this.camX +
        ((((m.dx + this.worldTime * m.vx) % 900) + 900) % 900) -
        450;
      const my =
        this.camY +
        ((((m.dy + this.worldTime * m.vy) % 620) + 620) % 620) -
        310;
      const pulse = 0.7 + Math.sin(this.worldTime * 2.5 + m.dx) * 0.3;
      ctx.globalAlpha = m.alpha * pulse;
      ctx.fillStyle = m.hue === 'violet' ? '#A78BFA' : '#FBBF24';
      ctx.beginPath();
      ctx.arc(mx, my, m.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private renderDungeonTiles(ctx: CanvasRenderingContext2D) {
    const ts = this.floor.tileSize;
    const halfW = this.viewW / (2 * this.camScale);
    const halfH = this.viewH / (2 * this.camScale);
    const minTx = Math.max(0, Math.floor((this.camX - halfW) / ts) - 1);
    const maxTx = Math.min(this.floor.width - 1, Math.ceil((this.camX + halfW) / ts) + 1);
    const minTy = Math.max(0, Math.floor((this.camY - halfH) / ts) - 1);
    const maxTy = Math.min(this.floor.height - 1, Math.ceil((this.camY + halfH) / ts) + 1);

    const w = this.floor.width;

    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        const idx = ty * w + tx;
        const vis = this.floor.visibility[idx];
        if (vis === 0) continue;

        const tile = this.floor.tiles[idx];
        const px = tx * ts;
        const py = ty * ts;
        const decor = this.floor.wallDecor[idx];

        if (tile === 0) {
          // Raised gothic basalt wall masonry
          const southFloor = ty + 1 < this.floor.height && this.floor.tiles[(ty + 1) * w + tx] !== 0;
          const northFloor = ty - 1 >= 0 && this.floor.tiles[(ty - 1) * w + tx] !== 0;
          ctx.fillStyle = southFloor ? '#222735' : '#12151E';
          ctx.fillRect(px, py, ts, ts);
          if (southFloor) {
            // Stone masonry face + top lip highlight + drop shadow onto floor
            ctx.fillStyle = '#2B3244';
            ctx.fillRect(px, py + ts - 14, ts, 14);
            ctx.fillStyle = '#3E4860';
            ctx.fillRect(px, py + ts - 15, ts, 2);
            ctx.fillStyle = 'rgba(0,0,0,0.28)';
            ctx.fillRect(px + ts * 0.5, py + ts - 13, 1, 13);
            ctx.fillRect(px, py + ts, ts, 5);
          } else if (northFloor) {
            ctx.fillStyle = '#242A38';
            ctx.fillRect(px, py, ts, 3);
          }
          if (decor % 7 === 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.03)';
            ctx.fillRect(px + 6, py + 8, ts - 12, 8);
          }
        } else {
          // Multi-tone beveled gothic stone flagstones
          const baseColor =
            tile === 1
              ? decor % 3 === 0
                ? '#1A1E29'
                : decor % 2 === 0
                ? '#171B25'
                : '#151922'
              : '#131720';
          ctx.fillStyle = baseColor;
          ctx.fillRect(px, py, ts, ts);

          // Inner stone bevel highlight (top/left) & grout shadow (bottom/right)
          ctx.fillStyle = 'rgba(255,255,255,0.025)';
          ctx.fillRect(px + 1, py + 1, ts - 2, 1);
          ctx.fillRect(px + 1, py + 1, 1, ts - 2);
          ctx.fillStyle = 'rgba(0,0,0,0.22)';
          ctx.fillRect(px, py + ts - 1, ts, 1);
          ctx.fillRect(px + ts - 1, py, 1, ts);

          if (decor === 3 || decor === 11) {
            ctx.strokeStyle = 'rgba(0,0,0,0.34)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(px + 10, py + 14);
            ctx.lineTo(px + 24, py + 22);
            ctx.lineTo(px + 30, py + 34);
            ctx.stroke();
          } else if (decor === 5 || decor === 13) {
            // Subtle ash / moss patch in flagstone corner
            ctx.fillStyle = 'rgba(52, 211, 153, 0.05)';
            ctx.beginPath();
            ctx.arc(px + 11, py + ts - 10, 5, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        if (vis === 1) {
          ctx.fillStyle = 'rgba(8, 10, 14, 0.72)';
          ctx.fillRect(px, py, ts, ts);
        }
      }
    }
  }

  private renderProps(ctx: CanvasRenderingContext2D) {
    const ts = this.floor.tileSize;
    for (const prop of this.floor.props) {
      if (prop.broken) continue;
      const tx = Math.floor(prop.x / ts);
      const ty = Math.floor(prop.y / ts);
      const vis = this.floor.visibility[ty * this.floor.width + tx];
      if (vis === 0) continue;

      if (prop.kind === 'brazier') {
        const flicker = 0.86 + Math.sin(this.worldTime * 12 + prop.x) * 0.14;
        if (vis === 2) {
          const glow = ctx.createRadialGradient(prop.x, prop.y, 4, prop.x, prop.y, 96 * flicker);
          glow.addColorStop(0, 'rgba(245, 158, 11, 0.28)');
          glow.addColorStop(0.55, 'rgba(234, 88, 12, 0.1)');
          glow.addColorStop(1, 'rgba(245, 158, 11, 0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(prop.x, prop.y, 96 * flicker, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#2B3140';
        ctx.beginPath();
        ctx.arc(prop.x, prop.y, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#525C75';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#EA580C';
        ctx.beginPath();
        ctx.arc(prop.x, prop.y, 6.2 * flicker, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FDE68A';
        ctx.beginPath();
        ctx.arc(prop.x, prop.y - 1, 3.1 * flicker, 0, Math.PI * 2);
        ctx.fill();
      } else if (prop.kind === 'urn') {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.ellipse(prop.x, prop.y + 6, 10, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#6D584B';
        ctx.beginPath();
        ctx.arc(prop.x, prop.y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#9C8373';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#3B2F28';
        ctx.beginPath();
        ctx.arc(prop.x, prop.y - 2, 4, 0, Math.PI * 2);
        ctx.fill();
      } else if (prop.kind === 'chest') {
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(prop.x - 16, prop.y + 8, 32, 6);
        ctx.fillStyle = prop.interacted ? '#3B342D' : '#854D0E';
        ctx.fillRect(prop.x - 15, prop.y - 11, 30, 22);
        ctx.fillStyle = prop.interacted ? '#2E2822' : '#713F12';
        ctx.fillRect(prop.x - 15, prop.y - 11, 30, 8);
        ctx.strokeStyle = prop.interacted ? '#57534E' : '#F59E0B';
        ctx.lineWidth = 2;
        ctx.strokeRect(prop.x - 15, prop.y - 11, 30, 22);
        if (!prop.interacted) {
          ctx.fillStyle = '#FBBF24';
          ctx.fillRect(prop.x - 3, prop.y - 4, 6, 8);
        }
      } else if (prop.kind === 'shrine') {
        const col =
          prop.shrineVariant === 'blood'
            ? '#EF4444'
            : prop.shrineVariant === 'arcane'
            ? '#8B5CF6'
            : '#F59E0B';
        if (!prop.interacted) {
          const glow = ctx.createRadialGradient(prop.x, prop.y, 6, prop.x, prop.y, 54);
          glow.addColorStop(0, `${col}50`);
          glow.addColorStop(1, `${col}00`);
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(prop.x, prop.y, 54, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#252B3A';
        ctx.beginPath();
        ctx.arc(prop.x, prop.y, 19, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = prop.interacted ? '#4B5563' : col;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        if (!prop.interacted) {
          ctx.save();
          ctx.translate(prop.x, prop.y);
          ctx.rotate(this.worldTime * 1.4);
          ctx.strokeStyle = `${col}88`;
          ctx.lineWidth = 1.2;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.arc(0, 0, 13, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();

          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(prop.x, prop.y, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(prop.x, prop.y, 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (prop.kind === 'trap') {
        ctx.strokeStyle =
          prop.trapState === 'arming'
            ? '#EF4444'
            : prop.trapState === 'active'
            ? '#F59E0B'
            : 'rgba(148,155,168,0.32)';
        ctx.lineWidth = prop.trapState === 'idle' ? 1.2 : 2.5;
        ctx.strokeRect(prop.x - 16, prop.y - 16, 32, 32);
        if (prop.trapState === 'arming') {
          ctx.fillStyle = 'rgba(239, 68, 68, 0.28)';
          ctx.fillRect(prop.x - 16, prop.y - 16, 32, 32);
        } else if (prop.trapState === 'active') {
          ctx.fillStyle = 'rgba(245, 158, 11, 0.45)';
          ctx.fillRect(prop.x - 16, prop.y - 16, 32, 32);
        }
      } else if (prop.kind === 'portal') {
        const pulse = 1 + Math.sin(this.worldTime * 5) * 0.1;
        const glow = ctx.createRadialGradient(prop.x, prop.y, 4, prop.x, prop.y, 56 * pulse);
        glow.addColorStop(0, 'rgba(139, 92, 246, 0.8)');
        glow.addColorStop(0.55, 'rgba(245, 158, 11, 0.38)');
        glow.addColorStop(1, 'rgba(139, 92, 246, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(prop.x, prop.y, 56 * pulse, 0, Math.PI * 2);
        ctx.fill();

        ctx.save();
        ctx.translate(prop.x, prop.y);
        ctx.rotate(this.worldTime * 2);
        ctx.strokeStyle = '#F59E0B';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([8, 4]);
        ctx.beginPath();
        ctx.arc(0, 0, 21 * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.rotate(-this.worldTime * 4);
        ctx.strokeStyle = '#C4B5FD';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(0, 0, 14 * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
  }

  private renderEnemyTelegraphs(ctx: CanvasRenderingContext2D) {
    for (const e of this.enemies) {
      if (!e.telegraph) continue;
      const t = e.telegraph;
      const progress = 1 - Math.max(0, t.timer / t.duration);

      ctx.save();
      if (t.type === 'arc') {
        ctx.fillStyle = 'rgba(220, 38, 38, 0.18)';
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.arc(e.x, e.y, t.range, t.angle - t.radius * 0.5, t.angle + t.radius * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Filling inner indicator
        ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.arc(e.x, e.y, t.range * progress, t.angle - t.radius * 0.5, t.angle + t.radius * 0.5);
        ctx.closePath();
        ctx.fill();
      } else if (t.type === 'circle') {
        ctx.fillStyle = 'rgba(220, 38, 38, 0.16)';
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(t.targetX, t.targetY, t.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = 'rgba(239, 68, 68, 0.26)';
        ctx.beginPath();
        ctx.arc(t.targetX, t.targetY, t.radius * progress, 0, Math.PI * 2);
        ctx.fill();
      } else if (t.type === 'line') {
        ctx.strokeStyle = e.type === 'cultist' ? 'rgba(168, 85, 247, 0.7)' : 'rgba(239, 68, 68, 0.75)';
        ctx.lineWidth = 2 + progress * 3;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(
          e.x + Math.cos(t.angle) * t.range,
          e.y + Math.sin(t.angle) * t.range
        );
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (t.type === 'nova') {
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.x, e.y, t.radius * progress, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private renderLoot(ctx: CanvasRenderingContext2D) {
    for (const l of this.loot) {
      const bob = Math.sin(l.bobPhase) * 3;
      const y = l.y + bob;
      if (l.kind === 'gold') {
        ctx.fillStyle = '#F59E0B';
        ctx.beginPath();
        ctx.arc(l.x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FEF3C7';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else if (l.kind === 'soul') {
        ctx.fillStyle = '#8B5CF6';
        ctx.beginPath();
        ctx.moveTo(l.x, y - 7);
        ctx.lineTo(l.x + 6, y);
        ctx.lineTo(l.x, y + 7);
        ctx.lineTo(l.x - 6, y);
        ctx.closePath();
        ctx.fill();
      } else if (l.kind === 'hp_orb') {
        ctx.fillStyle = '#EF4444';
        ctx.beginPath();
        ctx.arc(l.x, y, 6, 0, Math.PI * 2);
        ctx.fill();
      } else if (l.kind === 'item' && l.item) {
        const col = RARITY_COLORS[l.item.rarity];
        // Vertical light pillar
        const pillar = ctx.createLinearGradient(l.x, y, l.x, y - 42);
        pillar.addColorStop(0, `${col}88`);
        pillar.addColorStop(1, `${col}00`);
        ctx.fillStyle = pillar;
        ctx.fillRect(l.x - 5, y - 42, 10, 42);

        ctx.fillStyle = '#1E2330';
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(l.x - 8, y - 8, 16, 16, 3);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  private renderGhosts(ctx: CanvasRenderingContext2D) {
    for (const g of this.ghosts) {
      const alpha = (g.life / g.maxLife) * 0.45;
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = g.color;
      ctx.beginPath();
      ctx.arc(0, 0, this.pRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private renderEnemies(ctx: CanvasRenderingContext2D) {
    const ts = this.floor.tileSize;
    for (const e of this.enemies) {
      const tx = Math.floor(e.x / ts);
      const ty = Math.floor(e.y / ts);
      const vis = this.floor.visibility[ty * this.floor.width + tx];
      if (vis !== 2 && !e.isBoss) continue;

      const isEnraged = Boolean(
        e.isBoss && (e.enraged || (this.floor.floorNumber >= 2 && e.hp <= e.maxHp * 0.5))
      );

      drawEnemySprite(ctx, {
        x: e.x,
        y: e.y,
        facing: e.facing,
        radius: e.radius,
        type: e.type,
        worldTime: this.worldTime,
        hitFlash: e.hitFlash,
        squashX: e.squashX,
        squashY: e.squashY,
        enraged: isEnraged,
        floorNumber: this.floor.floorNumber,
        isAttacking: e.state === 'windup',
      });

      // Overhead mini HP bar for damaged non-boss enemies
      if (!e.isBoss && e.hp < e.maxHp) {
        const bw = 28;
        const pct = Math.max(0, e.hp / e.maxHp);
        ctx.fillStyle = '#111319';
        ctx.fillRect(e.x - bw / 2, e.y - e.radius - 10, bw, 4);
        ctx.fillStyle = '#DC2626';
        ctx.fillRect(e.x - bw / 2, e.y - e.radius - 10, bw * pct, 4);
      }
    }
  }

  private renderPvpArenaOverlays(ctx: CanvasRenderingContext2D) {
    if (!this.pvpMode) return;

    // Subtle arena center dueling circle engraving
    ctx.save();
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(PVP_ARENA_CENTER.x, PVP_ARENA_CENTER.y, 128, 0, Math.PI * 2);
    ctx.stroke();

    // Shrinking Eclipse Storm Zone outside ringRadius
    const worldW = this.floor.width * this.floor.tileSize;
    const worldH = this.floor.height * this.floor.tileSize;
    const ringR = Math.max(16, this.pvpRingRadius);
    ctx.fillStyle = 'rgba(127, 29, 29, 0.24)';
    ctx.beginPath();
    ctx.rect(-320, -320, worldW + 640, worldH + 640);
    ctx.arc(PVP_ARENA_CENTER.x, PVP_ARENA_CENTER.y, ringR, 0, Math.PI * 2, true);
    ctx.fill();

    const pulse = 0.65 + Math.sin(this.worldTime * 6) * 0.28;
    ctx.strokeStyle = `rgba(239, 68, 68, ${pulse.toFixed(2)})`;
    ctx.lineWidth = 3.5;
    ctx.setLineDash([12, 6]);
    ctx.beginPath();
    ctx.arc(PVP_ARENA_CENTER.x, PVP_ARENA_CENTER.y, ringR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Arena energy / heal orbs
    for (const orb of this.pvpOrbs) {
      const bob = Math.sin(this.worldTime * 4.5 + orb.x * 0.05) * 3;
      const oy = orb.y + bob;
      const col = orb.kind === 'heal' ? '#10B981' : '#A78BFA';
      const glow = ctx.createRadialGradient(orb.x, oy, 3, orb.x, oy, 24);
      glow.addColorStop(0, `${col}AA`);
      glow.addColorStop(1, `${col}00`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(orb.x, oy, 24, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(orb.x, oy, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#E5E0D5';
      ctx.font = '700 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(orb.kind === 'heal' ? '+PV' : '+PM', orb.x, oy - 13);
    }
    ctx.restore();
  }

  private renderRemotePlayers(ctx: CanvasRenderingContext2D) {
    if (!this.coopMode) return;
    const ts = this.floor.tileSize;
    for (const ally of this.remotePlayers.values()) {
      const tx = Math.floor(ally.x / ts);
      const ty = Math.floor(ally.y / ts);
      const vis = this.floor.visibility[ty * this.floor.width + tx];
      if (this.pvpMode !== 'online' && vis === 0) continue;

      ctx.save();
      if (ally.connected === false) ctx.globalAlpha = 0.45;

      if (!ally.alive) {
        ctx.translate(ally.x, ally.y);
        const pulse = 1 + Math.sin(this.worldTime * 7) * 0.14;
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, 22 * pulse, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = 'rgba(127, 29, 29, 0.65)';
        ctx.beginPath();
        ctx.arc(0, 0, this.pRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#FCA5A5';
        ctx.font = '700 11px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`CAÍDO · ${ally.name}`, 0, -24);
        ctx.restore();
        continue;
      }

      drawHeroSprite(ctx, {
        x: ally.x,
        y: ally.y,
        facing: ally.facing,
        radius: this.pRadius,
        worldTime: this.worldTime,
        archetype: ally.archetype,
        weaponKind: ally.weaponKind ?? 'greatsword',
        shield: ally.shield,
        cosmetics: ally.cosmetics,
        overrideAccentColor: this.pvpMode === 'online' ? '#EF4444' : ally.color,
        isMoving: Math.hypot(ally.targetX - ally.x, ally.targetY - ally.y) > 2,
      });

      // Player name & mini HP / Shield bar
      ctx.translate(ally.x, ally.y);
      const bw = 38;
      const pct = Math.max(0, Math.min(1, ally.hp / Math.max(1, ally.maxHp)));
      ctx.fillStyle = '#0E1117';
      ctx.fillRect(-bw / 2, -26, bw, 4);
      ctx.fillStyle = this.pvpMode === 'online' ? '#EF4444' : ally.color;
      ctx.fillRect(-bw / 2, -26, bw * pct, 4);
      if (ally.shield > 0) {
        const shPct = Math.max(0, Math.min(1, ally.shield / Math.max(1, ally.maxHp * 0.4)));
        ctx.fillStyle = '#38BDF8';
        ctx.fillRect(-bw / 2, -29, bw * shPct, 2);
      }

      const allyLabel = ally.connected === false ? `Reconectando · ${ally.name}` : ally.name;
      ctx.textAlign = 'center';
      ctx.font = '600 10px "Plus Jakarta Sans", sans-serif';
      ctx.fillStyle = '#090A0E';
      ctx.fillText(allyLabel, 1, -32);
      ctx.fillStyle =
        ally.connected === false
          ? '#FBBF24'
          : this.pvpMode === 'online'
          ? '#FCA5A5'
          : '#E5E0D5';
      ctx.fillText(allyLabel, 0, -33);

      ctx.restore();
    }
  }

  private renderLocalPlayer2(ctx: CanvasRenderingContext2D) {
    if (!this.localCoopMode || !this.p2) return;
    const p2 = this.p2;
    ctx.save();

    if (p2.isDowned) {
      ctx.translate(p2.x, p2.y);
      const pulse = 1 + Math.sin(this.worldTime * 6) * 0.14;
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.9)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 24 * pulse, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#450A0A';
      ctx.beginPath();
      ctx.arc(0, 0, this.pRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FCA5A5';
      ctx.font = '700 10px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('J2 CAÍDO', 0, -24);
      ctx.restore();
      return;
    }

    const torch = ctx.createRadialGradient(p2.x, p2.y, 8, p2.x, p2.y, 165);
    torch.addColorStop(0, 'rgba(56, 189, 248, 0.16)');
    torch.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = torch;
    ctx.beginPath();
    ctx.arc(p2.x, p2.y, 165, 0, Math.PI * 2);
    ctx.fill();

    drawHeroSprite(ctx, {
      x: p2.x,
      y: p2.y,
      facing: p2.facing,
      radius: this.pRadius,
      worldTime: this.worldTime,
      archetype: p2.archetype,
      weaponKind: p2.equippedWeapon.weaponKind ?? 'greatsword',
      shield: p2.shield,
      hitFlash: p2.hitFlash,
      squashX: p2.squashX,
      squashY: p2.squashY,
      overrideAccentColor: '#38BDF8',
      isMoving: Math.hypot(p2.vx, p2.vy) > 15,
    });

    ctx.translate(p2.x, p2.y);
    ctx.textAlign = 'center';
    ctx.font = '700 10px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#090A0E';
    ctx.fillText('J2', 1, -24);
    ctx.fillStyle = '#7DD3FC';
    ctx.fillText('J2', 0, -25);

    ctx.restore();
  }

  private renderPlayer(ctx: CanvasRenderingContext2D) {
    ctx.save();

    if (this.isDowned) {
      ctx.translate(this.px, this.py);
      const pulse = 1 + Math.sin(this.worldTime * 6) * 0.14;
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.9)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 24 * pulse, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#450A0A';
      ctx.beginPath();
      ctx.arc(0, 0, this.pRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    // Torchlight pool under hero
    const flicker = 0.96 + Math.sin(this.worldTime * 7) * 0.04;
    const torch = ctx.createRadialGradient(this.px, this.py, 8, this.px, this.py, 185 * flicker);
    torch.addColorStop(0, 'rgba(245, 158, 11, 0.16)');
    torch.addColorStop(0.6, 'rgba(245, 158, 11, 0.05)');
    torch.addColorStop(1, 'rgba(245, 158, 11, 0)');
    ctx.fillStyle = torch;
    ctx.beginPath();
    ctx.arc(this.px, this.py, 185 * flicker, 0, Math.PI * 2);
    ctx.fill();

    drawHeroSprite(ctx, {
      x: this.px,
      y: this.py,
      facing: this.pFacing,
      radius: this.pRadius,
      worldTime: this.worldTime,
      archetype: this.archetype,
      weaponKind: this.equippedWeapon.weaponKind ?? 'greatsword',
      shield: this.shield,
      hitFlash: this.pHitFlash,
      squashX: this.pSquashX,
      squashY: this.pSquashY,
      cosmetics: this.meta.equippedCosmetics,
      isMoving: Math.hypot(this.pvx, this.pvy) > 15,
    });

    if (this.localCoopMode) {
      ctx.translate(this.px, this.py);
      ctx.textAlign = 'center';
      ctx.font = '700 10px "Plus Jakarta Sans", sans-serif';
      ctx.fillStyle = '#090A0E';
      ctx.fillText('J1', 1, -24);
      ctx.fillStyle = '#FCD34D';
      ctx.fillText('J1', 0, -25);
    }

    ctx.restore();
  }

  private renderSlashesAndRings(ctx: CanvasRenderingContext2D) {
    for (const s of this.slashes) {
      const alpha = s.life / s.maxLife;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.globalAlpha = alpha * 0.88;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.isSpin ? 13 : 11;
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (s.isSpin) {
        ctx.arc(0, 0, s.radius * 0.82, 0, Math.PI * 2);
      } else {
        ctx.arc(0, 0, s.radius * 0.85, s.angle - s.arc * 0.5, s.angle + s.arc * 0.5);
      }
      ctx.stroke();

      // Bright crisp inner blade highlight
      ctx.globalAlpha = alpha * 0.72;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 3;
      ctx.beginPath();
      if (s.isSpin) {
        ctx.arc(0, 0, s.radius * 0.84, 0, Math.PI * 2);
      } else {
        ctx.arc(0, 0, s.radius * 0.87, s.angle - s.arc * 0.45, s.angle + s.arc * 0.45);
      }
      ctx.stroke();

      ctx.globalAlpha = alpha * 0.18;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, s.radius, s.angle - s.arc * 0.5, s.angle + s.arc * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    for (const r of this.rings) {
      const progress = 1 - r.life / r.maxLife;
      const rad = r.radius + (r.maxRadius - r.radius) * progress;
      ctx.save();
      ctx.globalAlpha = r.life / r.maxLife;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private renderProjectiles(ctx: CanvasRenderingContext2D) {
    for (const p of this.projectiles) {
      if (!p.active) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.atan2(p.vy, p.vx));
      ctx.fillStyle = p.color;
      if (p.kind === 'dagger') {
        ctx.beginPath();
        ctx.moveTo(10, 0);
        ctx.lineTo(-6, 4);
        ctx.lineTo(-6, -4);
        ctx.closePath();
        ctx.fill();
      } else if (p.kind === 'lance') {
        ctx.fillRect(-18, -4, 34, 8);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(-12, -1.5, 24, 3);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(0, 0, p.radius * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private renderParticles(ctx: CanvasRenderingContext2D) {
    for (const pt of this.particles) {
      if (!pt.active) continue;
      ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;
  }

  private renderFloatingTexts(ctx: CanvasRenderingContext2D) {
    ctx.textAlign = 'center';
    for (const ft of this.floatingTexts) {
      if (!ft.active) continue;
      ctx.globalAlpha = Math.min(1, (ft.life / ft.maxLife) * 1.4);
      const px = Math.round(13 * ft.scale);
      ctx.font = `700 ${px}px "JetBrains Mono", monospace`;
      ctx.fillStyle = '#090A0E';
      ctx.fillText(ft.text, ft.x + 1, ft.y + 1);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
    }
    ctx.globalAlpha = 1;
  }

  private renderAimReticle(ctx: CanvasRenderingContext2D) {
    const x = this.mouseScreenX;
    const y = this.mouseScreenY;
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = 'rgba(229, 224, 213, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-13, 0);
    ctx.lineTo(-5, 0);
    ctx.moveTo(5, 0);
    ctx.lineTo(13, 0);
    ctx.moveTo(0, -13);
    ctx.lineTo(0, -5);
    ctx.moveTo(0, 5);
    ctx.lineTo(0, 13);
    ctx.stroke();
    ctx.restore();
  }

  private describePropPrompt(prop: DungeonProp, keyLabel: string): string {
    if (prop.kind === 'chest') return `[${keyLabel}] Abrir Cofre Antiguo`;
    if (prop.kind === 'shrine') return `[${keyLabel}] Activar Altar Rúnico`;
    return `[${keyLabel}] Descender al Piso ${this.floor.floorNumber + 1}`;
  }

  private emitHud() {
    const downedAlly = this.coopMode ? this.findNearestDownedAlly() : null;
    const near = this.findNearestInteractableFrom(this.px, this.py);
    let nearbyPrompt: string | null = null;
    if (downedAlly && !this.isDowned) {
      nearbyPrompt = `[F] Revivir a ${downedAlly.name}`;
    } else if (this.localCoopMode && this.p2 && this.p2.isDowned && !this.isDowned) {
      if (Math.hypot(this.p2.x - this.px, this.p2.y - this.py) <= 78) {
        nearbyPrompt = '[F] Revivir a Jugador 2';
      }
    }
    if (!nearbyPrompt && near && !this.isDowned) {
      nearbyPrompt = this.describePropPrompt(near, 'F');
    }

    const activeBoss = this.enemies.find((e) => e.isBoss && e.state !== 'idle') ?? null;

    const ts = this.floor.tileSize;
    let localP2: LocalCoopPlayerHud | null = null;
    if (this.localCoopMode && this.p2) {
      const p2 = this.p2;
      const p2Near = this.findNearestInteractableFrom(p2.x, p2.y);
      let p2Prompt: string | null = null;
      if (this.isDowned && !p2.isDowned && Math.hypot(this.px - p2.x, this.py - p2.y) <= 78) {
        p2Prompt = '[L] Revivir a Jugador 1';
      } else if (p2Near && !p2.isDowned) {
        p2Prompt = this.describePropPrompt(p2Near, 'L');
      }

      localP2 = {
        archetype: p2.archetype,
        classTitle: computeHybridClassTitle(p2.archetype, p2.unlockedNodeIds),
        level: p2.level,
        xp: p2.xp,
        xpToNext: p2.xpToNext,
        skillPoints: p2.skillPoints,
        hp: Math.ceil(p2.hp),
        maxHp: p2.stats.maxHp,
        mana: Math.floor(p2.mana),
        maxMana: p2.stats.maxMana,
        shield: Math.ceil(p2.shield),
        flaskCharges: p2.flaskCharges,
        maxFlaskCharges: p2.maxFlaskCharges,
        dashCooldownRemaining: p2.dashCooldown,
        dashCooldownMax: p2.stats.dashCooldown,
        equippedSlots: { ...p2.equippedSlots },
        skillCooldowns: { ...p2.skillCooldowns },
        skillMaxCooldowns: {
          Q: p2.equippedSlots.Q
            ? ACTIVE_SKILLS[p2.equippedSlots.Q].cooldown * (1 - p2.stats.cooldownReduction)
            : 1,
          E: p2.equippedSlots.E
            ? ACTIVE_SKILLS[p2.equippedSlots.E].cooldown * (1 - p2.stats.cooldownReduction)
            : 1,
          R: p2.equippedSlots.R
            ? ACTIVE_SKILLS[p2.equippedSlots.R].cooldown * (1 - p2.stats.cooldownReduction)
            : 1,
        },
        unlockedSkills: [...p2.unlockedSkills],
        unlockedNodeIds: [...p2.unlockedNodeIds],
        equippedWeapon: p2.equippedWeapon,
        equippedRelic: p2.equippedRelic,
        inventory: [...p2.inventory],
        computedStats: p2.stats,
        isDowned: p2.isDowned,
        nearbyPrompt: p2Prompt,
        tileX: Math.floor(p2.x / ts),
        tileY: Math.floor(p2.y / ts),
      };
    }

    const snapshot: HudSnapshot = {
      screen: this.screen,
      floorNumber: this.floor.floorNumber,
      floorName: this.floor.name,
      archetype: this.archetype,
      classTitle: computeHybridClassTitle(this.archetype, this.unlockedNodeIds),
      level: this.level,
      xp: this.xp,
      xpToNext: this.xpToNext,
      skillPoints: this.skillPoints,
      hp: Math.ceil(this.hp),
      maxHp: this.stats.maxHp,
      mana: Math.floor(this.mana),
      maxMana: this.stats.maxMana,
      shield: Math.ceil(this.shield),
      gold: this.gold,
      soulsThisRun: this.soulsThisRun,
      kills: this.kills,
      flaskCharges: this.flaskCharges,
      maxFlaskCharges: this.maxFlaskCharges,
      dashCooldownRemaining: this.dashCooldown,
      dashCooldownMax: this.stats.dashCooldown,
      equippedSlots: { ...this.equippedSlots },
      skillCooldowns: { ...this.skillCooldowns },
      skillMaxCooldowns: {
        Q: this.equippedSlots.Q
          ? ACTIVE_SKILLS[this.equippedSlots.Q].cooldown * (1 - this.stats.cooldownReduction)
          : 1,
        E: this.equippedSlots.E
          ? ACTIVE_SKILLS[this.equippedSlots.E].cooldown * (1 - this.stats.cooldownReduction)
          : 1,
        R: this.equippedSlots.R
          ? ACTIVE_SKILLS[this.equippedSlots.R].cooldown * (1 - this.stats.cooldownReduction)
          : 1,
      },
      unlockedSkills: [...this.unlockedSkills],
      unlockedNodeIds: [...this.unlockedNodeIds],
      equippedWeapon: this.equippedWeapon,
      equippedRelic: this.equippedRelic,
      inventory: [...this.inventory],
      computedStats: this.stats,
      boss: activeBoss
        ? {
            name: activeBoss.name,
            hp: Math.max(0, Math.ceil(activeBoss.hp)),
            maxHp: activeBoss.maxHp,
            floorTier: this.floor.floorNumber,
            enraged: Boolean(
              activeBoss.enraged ||
                (this.floor.floorNumber >= 2 && activeBoss.hp <= activeBoss.maxHp * 0.5)
            ),
            difficultyLabel: `Piso ${this.floor.floorNumber} · ${getBossFloorMultipliers(this.floor.floorNumber).difficultyPercent}%`,
          }
        : null,
      nearbyPrompt,
      levelUpToastTimer: this.levelUpToastTimer,
      bannerMessage: this.bannerMessage,
      minimap: {
        width: this.floor.width,
        height: this.floor.height,
        playerTileX: Math.floor(this.px / ts),
        playerTileY: Math.floor(this.py / ts),
        rooms: this.floor.rooms.map((r) => ({
          x: r.x,
          y: r.y,
          w: r.w,
          h: r.h,
          type: r.type,
          discovered: r.discovered,
          cleared: r.cleared,
        })),
        props: this.floor.props
          .filter((p) => p.kind === 'chest' || p.kind === 'shrine' || p.kind === 'portal')
          .map((p) => ({
            tx: Math.floor(p.x / ts),
            ty: Math.floor(p.y / ts),
            kind: p.kind,
            done: p.interacted,
          })),
      },
      coop:
        this.coopMode && this.pvpMode !== 'online' && this.coopRoomCode && this.coopPlayerId
          ? {
              roomCode: this.coopRoomCode,
              localPlayerId: this.coopPlayerId,
              runSeedLabel: this.runSeedLabel,
              allies: Array.from(this.remotePlayers.values()).map(({ targetX: _tx, targetY: _ty, ...rest }) => rest),
              isDowned: this.isDowned,
            }
          : null,
      pvp: this.pvpMode
        ? {
            mode: this.pvpMode,
            roomCode: this.coopRoomCode ?? undefined,
            phase: this.pvpPhase,
            roundNumber: this.pvpRoundNumber,
            bestOf: PVP_BEST_OF,
            phaseTimer: this.pvpPhaseTimer,
            ringRadius: this.pvpRingRadius,
            ringMaxRadius: PVP_RING_MAX_RADIUS,
            ringCenterX: PVP_ARENA_CENTER.x,
            ringCenterY: PVP_ARENA_CENTER.y,
            canAct: this.pvpPhase === 'fighting',
            winnerId: this.pvpWinnerId,
            winnerName: this.pvpWinnerName,
            matchResult: this.pvpMatchResult,
            fighters:
              this.pvpMode === 'online'
                ? this.pvpFighters.map(
                    (f): PvpFighterHud => ({
                      id: f.id,
                      name: f.name,
                      archetype: f.archetype,
                      classTitle: f.classTitle,
                      hp: Math.max(0, Math.ceil(f.hp)),
                      maxHp: f.maxHp,
                      shield: Math.ceil(f.shield),
                      roundsWon: f.roundsWon,
                      ready: f.ready,
                      elo: f.elo,
                      tierName: f.tierName,
                      color: f.color,
                      connected: f.connected,
                    })
                  )
                : this.p2
                ? [
                    {
                      id: 'local_p1',
                      name: 'Jugador 1',
                      archetype: this.archetype,
                      classTitle: PVP_LOADOUTS[this.archetype].classTitle,
                      hp: Math.max(0, Math.ceil(this.hp)),
                      maxHp: this.stats.maxHp,
                      shield: Math.ceil(this.shield),
                      roundsWon: this.pvpLocalRoundsWon[0],
                      ready: true,
                      color: '#F59E0B',
                      connected: true,
                    },
                    {
                      id: 'local_p2',
                      name: 'Jugador 2',
                      archetype: this.p2.archetype,
                      classTitle: PVP_LOADOUTS[this.p2.archetype].classTitle,
                      hp: Math.max(0, Math.ceil(this.p2.hp)),
                      maxHp: this.p2.stats.maxHp,
                      shield: Math.ceil(this.p2.shield),
                      roundsWon: this.pvpLocalRoundsWon[1],
                      ready: true,
                      color: '#38BDF8',
                      connected: true,
                    },
                  ]
                : [],
            localFighterId: this.pvpMode === 'online' ? this.coopPlayerId || '' : 'local_p1',
          }
        : null,
      runSeed: this.runSeed,
      runSeedLabel: this.runSeedLabel,
      localP2,
      localCoopControlMode: this.localCoopMode ? this.localCoopControlMode : undefined,
      adminFlags: { ...this.adminFlags },
      equippedCosmetics: { ...this.meta.equippedCosmetics },
    };

    this.callbacks.onHudUpdate(snapshot);
  }
}
