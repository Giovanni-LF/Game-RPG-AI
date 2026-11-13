import { sfx } from '../audio/sfx';
import {
  ACTIVE_SKILLS,
  ARCHETYPES,
  computeHybridClassTitle,
  computePlayerStats,
  generateLootItem,
  RARITY_COLORS,
  SKILL_TREE_NODES,
} from '../data/gameData';
import { coopClient } from '../net/coopClient';
import type {
  CoopActionPayload,
  CoopEnemySync,
  CoopPlayerSync,
  CoopServerMessage,
} from '../types/coop';
import {
  ActiveSkillId,
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
  RunRecord,
  SkillSlotKey,
} from '../types/game';
import { generateDungeonFloor, isWalkableTile } from './dungeonGenerator';

interface Projectile {
  active: boolean;
  fromPlayer: boolean;
  ownerNum?: 1 | 2;
  visualOnly?: boolean;
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
  private isDowned = false;
  private remotePlayers = new Map<string, CoopPlayerSync & { targetX: number; targetY: number }>();
  private enemyNetTargets = new Map<string, { x: number; y: number }>();
  private coopSyncTimer = 0;

  // Offline local 2-player co-op state
  private localCoopMode = false;
  private localCoopControlMode: LocalCoopControlMode = 'auto';
  private p2: LocalPlayer2State | null = null;

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

  startRun(archetypeId: ArchetypeId) {
    this.leaveCoopRoom();
    this.localCoopMode = false;
    this.p2 = null;
    this.camScale = this.baseCamScale;
    this.resetRunState(archetypeId);
    this.screen = 'PLAYING';
    this.initFloor(1, false);
    this.showBanner(`Piso 1 · ${this.floor.name}`);
    this.emitHud();
  }

  startLocalCoopRun(
    p1Arch: ArchetypeId,
    p2Arch: ArchetypeId,
    controlMode: LocalCoopControlMode = 'auto'
  ) {
    this.leaveCoopRoom();
    this.localCoopMode = true;
    this.localCoopControlMode = controlMode;
    this.camScale = this.baseCamScale;
    this.resetRunState(p1Arch);
    this.p2 = this.createLocalPlayer2State(p2Arch);
    this.screen = 'PLAYING';
    this.initFloor(1, false);
    this.showBanner(`Cooperativo Local · Piso 1 · ${this.floor.name}`);
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
    this.isDowned = false;
    this.remotePlayers.clear();
    this.enemyNetTargets.clear();

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
      joinPayload.portalOpen
    );

    const me = joinPayload.players.find((p) => p.id === joinPayload.playerId);
    if (me) {
      this.px = me.x;
      this.py = me.y;
      this.camX = me.x;
      this.camY = me.y;
    }

    this.showBanner(`Sala ${joinPayload.roomCode} · Piso ${joinPayload.floorNumber}`);
    this.emitHud();
  }

  leaveCoopRoom() {
    if (this.coopMode) {
      coopClient.send({ type: 'room:leave' });
    }
    if (coopClient.getMode() !== 'ws') {
      coopClient.disconnect();
    }
    this.coopMode = false;
    this.coopRoomCode = null;
    this.coopPlayerId = null;
    this.isDowned = false;
    this.remotePlayers.clear();
    this.enemyNetTargets.clear();
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
      const ex = idx !== -1 ? this.enemies[idx].x : msg.x;
      const ey = idx !== -1 ? this.enemies[idx].y : msg.y;
      if (idx !== -1) this.enemies.splice(idx, 1);
      this.enemyNetTargets.delete(msg.enemyId);

      this.kills++;
      this.spawnParticles(ex, ey, msg.isBoss ? 44 : 18, msg.isBoss ? '#F59E0B' : '#DC2626', 210, 0.45);
      if (msg.killerId === this.coopPlayerId && this.stats.killHeal > 0 && !this.isDowned) {
        this.hp = Math.min(this.stats.maxHp, this.hp + this.stats.killHeal);
      }
      this.grantXp(msg.xpValue);

      // Shared individual loot drops at defeated enemy's coordinates
      if (msg.isBoss) {
        const bossSouls = 18 + this.floor.floorNumber * 8;
        this.soulsThisRun += bossSouls;
        this.spawnFloatingText(ex, ey - 24, `+${bossSouls} Fragmentos`, '#A78BFA', 1.3);
        const bossItem = generateLootItem(
          this.floor.floorNumber,
          this.meta.blessings.fortune,
          this.floor.floorNumber >= 2 ? 'relic' : 'epic'
        );
        this.loot.push({
          id: `loot_${this.idCounter++}`,
          x: ex,
          y: ey,
          vx: 0,
          vy: 30,
          kind: 'item',
          item: bossItem,
          bobPhase: 0,
        });
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
      } else {
        if (Math.random() < 0.28 + this.meta.blessings.fortune * 0.04) {
          this.loot.push({
            id: `loot_${this.idCounter++}`,
            x: ex,
            y: ey,
            vx: (Math.random() - 0.5) * 85,
            vy: (Math.random() - 0.5) * 85,
            kind: 'soul',
            amount: 2 + Math.floor(this.floor.floorNumber * 0.8),
            bobPhase: Math.random() * 6,
          });
        }
        if (Math.random() < 0.72) {
          this.loot.push({
            id: `loot_${this.idCounter++}`,
            x: ex,
            y: ey,
            vx: (Math.random() - 0.5) * 75,
            vy: (Math.random() - 0.5) * 75,
            kind: 'gold',
            amount: msg.goldValue,
            bobPhase: Math.random() * 6,
          });
        }
        if (Math.random() < 0.16) {
          this.loot.push({
            id: `loot_${this.idCounter++}`,
            x: ex,
            y: ey,
            vx: (Math.random() - 0.5) * 60,
            vy: (Math.random() - 0.5) * 60,
            kind: 'hp_orb',
            amount: Math.round(this.stats.maxHp * 0.14),
            bobPhase: Math.random() * 6,
          });
        }
        if (Math.random() < 0.12 + this.meta.blessings.fortune * 0.015) {
          this.loot.push({
            id: `loot_${this.idCounter++}`,
            x: ex,
            y: ey,
            vx: (Math.random() - 0.5) * 70,
            vy: (Math.random() - 0.5) * 70,
            kind: 'item',
            item: generateLootItem(this.floor.floorNumber, this.meta.blessings.fortune),
            bobPhase: Math.random() * 6,
          });
        }
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
        for (let i = 0; i < 2; i++) {
          this.loot.push({
            id: `loot_${this.idCounter++}`,
            x: prop.x,
            y: prop.y,
            vx: (Math.random() - 0.5) * 120,
            vy: (Math.random() - 0.5) * 120,
            kind: 'gold',
            amount: 10 + this.floor.floorNumber * 6,
            bobPhase: Math.random() * 6,
          });
        }
        this.showBanner(`${msg.actorName} abrió un Cofre Antiguo`);
      } else if (msg.kind === 'shrine') {
        sfx.playShrine();
        this.spawnParticles(prop.x, prop.y, 24, '#8B5CF6', 130, 0.55);
        if (msg.shrineVariant === 'blood') {
          if (!this.isDowned) this.hp = this.stats.maxHp;
          this.flaskCharges = this.maxFlaskCharges;
          this.showBanner(`${msg.actorName} activó Altar Carmesí: Vida y Frascos`);
        } else if (msg.shrineVariant === 'arcane') {
          this.mana = this.stats.maxMana;
          this.skillPoints += 1;
          this.levelUpToastTimer = 4.5;
          this.showBanner(`${msg.actorName} activó Altar del Eclipse: +1 Habilidad`);
        } else {
          this.soulsThisRun += 8 + this.floor.floorNumber * 3;
          this.grantXp(45 * this.floor.floorNumber);
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
      this.hp = Math.max(this.hp, Math.round(this.stats.maxHp * 0.5));
      this.mana = this.stats.maxMana;
      this.initFloorWithSeed(msg.floorNumber, msg.floorSeed, msg.enemies, [], [], false);
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
    portalOpen: boolean
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

    this.loot = [];
    this.slashes = [];
    this.ghosts = [];
    this.rings = [];
    for (const p of this.projectiles) p.active = false;
    this.updateVisibility();
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
    if (held && this.screen === 'PLAYING') {
      this.bufferedAction = { type: 'attack', expires: performance.now() + 140 };
    }
  }

  triggerTouchDash() {
    this.lastInputType = 'touch';
    if (this.screen !== 'PLAYING') return;
    this.bufferedAction = { type: 'dash', expires: performance.now() + 160 };
  }

  triggerTouchSkill(slot: SkillSlotKey) {
    this.lastInputType = 'touch';
    if (this.screen !== 'PLAYING') return;
    this.bufferedAction = { type: 'skill', slot, expires: performance.now() + 160 };
  }

  triggerTouchFlask() {
    this.lastInputType = 'touch';
    if (this.screen !== 'PLAYING') return;
    this.bufferedAction = { type: 'flask', expires: performance.now() + 160 };
  }

  triggerTouchInteract() {
    this.lastInputType = 'touch';
    if (this.screen !== 'PLAYING') return;
    this.bufferedAction = { type: 'interact', expires: performance.now() + 160 };
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
    if (held && this.screen === 'PLAYING') {
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
    sfx.playPickup(true);
    this.emitHud();
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
    this.emitHud();
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
    sfx.playPickup(false);
    this.emitHud();
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
      return;
    }

    const idx = this.inventory.findIndex((i) => i.id === itemId);
    if (idx === -1) return;
    const item = this.inventory[idx];
    this.gold += item.valueGold;
    this.inventory = this.inventory.filter((i) => i.id !== itemId);
    sfx.playPickup(false);
    this.emitHud();
  }

  destroy() {
    this.destroyed = true;
    this.leaveCoopRoom();
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mouseup', this.handleMouseUp);
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
    this.floor = generateDungeonFloor(floorNumber);
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
      this.populateFloorEnemies();
      this.updateVisibility();
    }
  }

  private populateFloorEnemies() {
    const f = this.floor.floorNumber;
    const ts = this.floor.tileSize;
    const scale = 1 + (f - 1) * 0.36;

    for (const room of this.floor.rooms) {
      if (room.type === 'combat') {
        const count = Math.min(7, 3 + f + Math.floor(Math.random() * 2));
        for (let i = 0; i < count; i++) {
          const ex = (room.x + 1.5 + Math.random() * (room.w - 3)) * ts;
          const ey = (room.y + 1.5 + Math.random() * (room.h - 3)) * ts;
          const roll = Math.random();
          let type: EnemyType = 'skeleton';
          if (roll > 0.78 && f >= 1) type = 'golem';
          else if (roll > 0.52) type = 'cultist';
          else if (roll > 0.32 && (f >= 2 || Math.random() < 0.45)) type = 'wraith';

          this.enemies.push(this.createEnemy(type, ex, ey, scale, room.id));
        }
      } else if (room.type === 'boss') {
        const bossType: EnemyType = f % 2 === 1 ? 'boss_warden' : 'boss_archon';
        const bx = (room.cx + 0.5) * ts;
        const by = (room.cy + 0.5) * ts;
        this.enemies.push(this.createEnemy(bossType, bx, by, scale, room.id));
      }
    }
  }

  private createEnemy(
    type: EnemyType,
    x: number,
    y: number,
    scale: number,
    roomId: number
  ): EnemyEntity {
    const id = `enemy_${this.idCounter++}`;
    switch (type) {
      case 'skeleton':
        return {
          id,
          type,
          name: 'Esqueleto Errante',
          isBoss: false,
          x,
          y,
          vx: 0,
          vy: 0,
          radius: 14,
          hp: Math.round(52 * scale),
          maxHp: Math.round(52 * scale),
          speed: 118,
          damage: Math.round(14 * scale),
          xpValue: Math.round(22 * scale),
          goldValue: Math.round(6 * scale),
          facing: 0,
          state: 'idle',
          stateTimer: 0,
          attackCooldown: 0.4,
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
      case 'cultist':
        return {
          id,
          type,
          name: 'Cultista del Eclipse',
          isBoss: false,
          x,
          y,
          vx: 0,
          vy: 0,
          radius: 14,
          hp: Math.round(44 * scale),
          maxHp: Math.round(44 * scale),
          speed: 88,
          damage: Math.round(16 * scale),
          xpValue: Math.round(26 * scale),
          goldValue: Math.round(8 * scale),
          facing: 0,
          state: 'idle',
          stateTimer: 0,
          attackCooldown: 0.8,
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
      case 'golem':
        return {
          id,
          type,
          name: 'Gólem de Basalto',
          isBoss: false,
          x,
          y,
          vx: 0,
          vy: 0,
          radius: 21,
          hp: Math.round(118 * scale),
          maxHp: Math.round(118 * scale),
          speed: 68,
          damage: Math.round(24 * scale),
          xpValue: Math.round(42 * scale),
          goldValue: Math.round(14 * scale),
          facing: 0,
          state: 'idle',
          stateTimer: 0,
          attackCooldown: 1.0,
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
      case 'wraith':
        return {
          id,
          type,
          name: 'Espectro Umbrío',
          isBoss: false,
          x,
          y,
          vx: 0,
          vy: 0,
          radius: 14,
          hp: Math.round(58 * scale),
          maxHp: Math.round(58 * scale),
          speed: 138,
          damage: Math.round(18 * scale),
          xpValue: Math.round(30 * scale),
          goldValue: Math.round(10 * scale),
          facing: 0,
          state: 'idle',
          stateTimer: 0,
          attackCooldown: 0.6,
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
      case 'boss_warden':
        return {
          id,
          type,
          name: 'Alcaide Osario, Guardián de Hierro',
          isBoss: true,
          x,
          y,
          vx: 0,
          vy: 0,
          radius: 27,
          hp: Math.round(460 * scale),
          maxHp: Math.round(460 * scale),
          speed: 96,
          damage: Math.round(28 * scale),
          xpValue: Math.round(140 * scale),
          goldValue: Math.round(55 * scale),
          facing: 0,
          state: 'idle',
          stateTimer: 0,
          attackCooldown: 1.1,
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
      case 'boss_archon':
        return {
          id,
          type,
          name: 'Arconte del Eclipse',
          isBoss: true,
          x,
          y,
          vx: 0,
          vy: 0,
          radius: 26,
          hp: Math.round(520 * scale),
          maxHp: Math.round(520 * scale),
          speed: 105,
          damage: Math.round(30 * scale),
          xpValue: Math.round(170 * scale),
          goldValue: Math.round(70 * scale),
          facing: 0,
          state: 'idle',
          stateTimer: 0,
          attackCooldown: 1.0,
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
  }

  private bindEvents() {
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    this.canvas.addEventListener('mousemove', this.handleMouseMove);
    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mouseup', this.handleMouseUp);
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

  private handleMouseMove = (e: MouseEvent) => {
    this.lastInputType = 'mouse';
    const rect = this.canvas.getBoundingClientRect();
    this.mouseScreenX = e.clientX - rect.left;
    this.mouseScreenY = e.clientY - rect.top;
  };

  private handleMouseDown = (e: MouseEvent) => {
    this.lastInputType = 'mouse';
    const rect = this.canvas.getBoundingClientRect();
    this.mouseScreenX = e.clientX - rect.left;
    this.mouseScreenY = e.clientY - rect.top;
    if (this.screen !== 'PLAYING') return;

    const now = performance.now();
    if (e.button === 0) {
      this.mouseDown = true;
      this.bufferedAction = { type: 'attack', expires: now + 120 };
    } else if (e.button === 2) {
      this.bufferedAction = { type: 'dash', expires: now + 140 };
    }
  };

  private handleMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.mouseDown = false;
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

    const canControlP1 = this.screen === 'PLAYING' && !this.isDowned;
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

    if (!this.isDowned) {
      this.mana = Math.min(this.stats.maxMana, this.mana + this.stats.manaRegen * dt);
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

    if (canControlP1 && this.dashTimer > 0) {
      this.dashTimer -= dt;
      const dashSpeed = this.stats.moveSpeed * 2.85;
      this.pvx = this.dashDirX * dashSpeed;
      this.pvy = this.dashDirY * dashSpeed;
      if (Math.random() < 0.65) {
        this.ghosts.push({
          x: this.px,
          y: this.py,
          facing: this.pFacing,
          life: 0.2,
          maxLife: 0.2,
          color: ARCHETYPES[this.archetype].accentColor,
        });
      }
    } else {
      const targetVx = moveX * this.stats.moveSpeed;
      const targetVy = moveY * this.stats.moveSpeed;
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

    // ==================== PLAYER 2 (LOCAL OFFLINE CO-OP) ====================
    if (this.localCoopMode && this.p2) {
      const p2 = this.p2;
      const p2Hero = this.getHeroState(2);
      const canControlP2 = this.screen === 'PLAYING' && !p2.isDowned;
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

    // Smooth shared camera follow (tracks midpoint + gentle zoom in local co-op)
    if (this.localCoopMode && this.p2) {
      const targetX = (this.px + this.p2.x) * 0.5;
      const targetY = (this.py + this.p2.y) * 0.5;
      this.camX += (targetX - this.camX) * Math.min(1, dt * 10);
      this.camY += (targetY - this.camY) * Math.min(1, dt * 10);

      const sepX = Math.abs(this.px - this.p2.x);
      const sepY = Math.abs(this.py - this.p2.y);
      const needScaleX = (this.viewW * 0.72) / Math.max(260, sepX + 200);
      const needScaleY = (this.viewH * 0.68) / Math.max(220, sepY + 180);
      const desiredScale = Math.max(0.62, Math.min(this.baseCamScale, needScaleX, needScaleY));
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
    const maxSep = 540;
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
    hero.dashCooldown = hero.stats.dashCooldown;
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
        color: hero.color,
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
    }
  }

  private triggerPrimaryAttackFor(hero: ReturnType<GameEngine['getHeroState']>) {
    const kind = hero.equippedWeapon.weaponKind ?? 'greatsword';
    const baseCd = kind === 'daggers' ? 0.25 : kind === 'staff' ? 0.42 : kind === 'halberd' ? 0.48 : 0.44;
    hero.attackCooldown = baseCd / hero.stats.attackSpeed;
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
      const projColor = isCrit ? '#F59E0B' : hero.num === 2 ? '#38BDF8' : '#8B5CF6';
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
    const swingColor =
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
    if (hero.skillCooldowns[slot] > 0) return false;
    const def = ACTIVE_SKILLS[skillId];
    if (hero.mana < def.manaCost) {
      this.spawnFloatingText(hero.x, hero.y - 26, 'Sin maná', '#8B5CF6', 0.9);
      return false;
    }

    hero.mana -= def.manaCost;
    hero.skillCooldowns[slot] = Math.max(0.8, def.cooldown * (1 - hero.stats.cooldownReduction));
    sfx.playSkill(skillId);

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
        break;
      }

      case 'aegis': {
        hero.shield = Math.round(hero.stats.maxHp * 0.35);
        hero.shieldTimer = 5.0;
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
        if (hits > 0) {
          const heal = Math.min(hero.stats.maxHp - hero.hp, hits * 7);
          if (heal > 0) {
            hero.hp += heal;
            this.spawnFloatingText(hero.x, hero.y - 28, `+${heal}`, '#10B981', 1);
          }
        }
        break;
      }
    }

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
      this.emitHud();
    } else if (prop.kind === 'portal') {
      if (this.floor.floorNumber === 3 && !this.runReported) {
        this.finishRun(true);
      } else {
        this.descendNextFloor();
      }
    }
  }

  private descendNextFloor() {
    const nextFloor = this.floor.floorNumber + 1;
    this.initFloor(nextFloor, false);
    this.isDowned = false;
    this.hp = Math.min(this.stats.maxHp, Math.max(this.hp, Math.round(this.stats.maxHp * 0.5)) + Math.round(this.stats.maxHp * 0.25));
    this.mana = this.stats.maxMana;
    if (this.p2) {
      this.p2.isDowned = false;
      this.p2.hp = Math.min(this.p2.stats.maxHp, Math.max(this.p2.hp, Math.round(this.p2.stats.maxHp * 0.5)) + Math.round(this.p2.stats.maxHp * 0.25));
      this.p2.mana = this.p2.stats.maxMana;
    }
    sfx.playShrine();
    this.showBanner(`Piso ${nextFloor} · ${this.floor.name}`);
    this.emitHud();
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

    if (this.coopMode) {
      enemy.hitFlash = 0.08;
      coopClient.send({
        type: 'combat:hit',
        enemyId: enemy.id,
        damage: amount,
        isCrit,
        color,
        knockX,
        knockY,
        bleedDps: hero.stats.bleedOnHit ? Math.round(hero.stats.baseDamage * 0.35) : undefined,
        slow,
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
              });
              break;
            }
          }
        }
      }
      return;
    }

    enemy.hp -= amount;
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
      isCrit ? `${amount}!` : `${amount}`,
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
      const leech = Math.max(1, Math.round(amount * hero.stats.lifesteal));
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
        if (Math.random() < 0.55) {
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
      if (vis[i] === 2) vis[i] = 1;
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

  private findAutoAimEnemyFrom(ox: number, oy: number, maxRange: number): EnemyEntity | null {
    let best: EnemyEntity | null = null;
    let bestDist = maxRange;
    const ts = this.floor.tileSize;
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      const tx = Math.floor(e.x / ts);
      const ty = Math.floor(e.y / ts);
      const vis = this.floor.visibility[ty * this.floor.width + tx];
      if (vis !== 2 && !e.isBoss) continue;
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
      e.attackCooldown = Math.max(0, e.attackCooldown - dt);
      e.slowTimer = Math.max(0, e.slowTimer - dt);
      e.squashX += (1 - e.squashX) * Math.min(1, dt * 14);
      e.squashY += (1 - e.squashY) * Math.min(1, dt * 14);

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
        if (dist > 78) {
          this.nudgeEnemy(e, (dx / dist) * spd * dt, (dy / dist) * spd * dt);
        }
        if (e.attackCooldown <= 0) {
          e.bossPatternIndex = (e.bossPatternIndex + 1) % 3;
          e.state = 'windup';
          e.attackCooldown = e.type === 'boss_archon' ? 1.85 : 2.1;

          if (e.bossPatternIndex === 0 && dist < 130) {
            e.telegraph = {
              type: 'arc',
              timer: 0.72,
              duration: 0.72,
              angle: e.facing,
              range: 120,
              radius: Math.PI * 0.9,
              damage: Math.round(e.damage * 1.15),
              targetX,
              targetY,
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
              targetX,
              targetY,
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
      const orbs = e.type === 'boss_archon' ? 10 : 8;
      for (let i = 0; i < orbs; i++) {
        const a = t.angle + (i / orbs) * Math.PI * 2;
        this.spawnProjectile({
          fromPlayer: false,
          x: e.x + Math.cos(a) * 18,
          y: e.y + Math.sin(a) * 18,
          vx: Math.cos(a) * 265,
          vy: Math.sin(a) * 265,
          radius: 8,
          damage: Math.round(t.damage * 0.85),
          isCrit: false,
          color: e.type === 'boss_archon' ? '#8B5CF6' : '#EF4444',
          maxLife: 1.5,
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
        color: '#F59E0B',
        life: 0.32,
        maxLife: 0.32,
      });
    }
  }

  private damageHero(hero: ReturnType<GameEngine['getHeroState']>, rawAmount: number) {
    if (hero.invuln > 0 || hero.isDowned) return;
    if (!this.coopMode && this.screen !== 'PLAYING') return;
    if (this.coopMode && this.screen !== 'PLAYING' && this.screen !== 'PAUSED') return;

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
      if (this.coopMode) {
        const anyAllyAlive = Array.from(this.remotePlayers.values()).some((a) => a.alive);
        if (anyAllyAlive) {
          hero.isDowned = true;
          this.heldKeys.clear();
          this.mouseDown = false;
          this.touchMoveX = 0;
          this.touchMoveY = 0;
          this.touchAttackHeld = false;
          this.showBanner('Has caído · Un aliado puede revivirte');
          coopClient.send({
            type: 'player:state',
            x: this.px,
            y: this.py,
            facing: this.pFacing,
            hp: 0,
            maxHp: this.stats.maxHp,
            shield: 0,
            level: this.level,
            classTitle: computeHybridClassTitle(this.archetype, this.unlockedNodeIds),
            weaponKind: this.equippedWeapon.weaponKind ?? 'greatsword',
            alive: false,
          });
        } else {
          hero.isDowned = true;
          this.finishRun(false);
        }
      } else if (this.localCoopMode && this.p2) {
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
    this.callbacks.onRunFinished(record);
    this.emitHud();
  }

  private nudgeEnemy(e: EnemyEntity, dx: number, dy: number) {
    if (!this.collidesWall(e.x + dx, e.y, e.radius)) e.x += dx;
    if (!this.collidesWall(e.x, e.y + dy, e.radius)) e.y += dy;
  }

  private spawnProjectile(cfg: Omit<Projectile, 'active' | 'life' | 'hitIds'> & { ownerNum?: 1 | 2 }) {
    const slot = this.projectiles.find((p) => !p.active);
    if (!slot) return;
    slot.active = true;
    slot.fromPlayer = cfg.fromPlayer;
    slot.visualOnly = cfg.visualOnly;
    slot.ownerNum = cfg.ownerNum ?? 1;
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
            this.damageEnemy(e, p.damage, p.isCrit, p.color, 0, 0, p.applySlow, ownerHero);
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

      if (dist < 85 && dist > 1) {
        const pull = 240 * dt;
        l.x += (dx / dist) * pull;
        l.y += (dy / dist) * pull;
      }

      if (dist <= this.pRadius + 14) {
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
    this.renderFloatingTexts(ctx);

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
          // Check if adjacent to floor to draw raised basalt wall cap
          const southFloor = ty + 1 < this.floor.height && this.floor.tiles[(ty + 1) * w + tx] !== 0;
          ctx.fillStyle = southFloor ? '#222734' : '#141720';
          ctx.fillRect(px, py, ts, ts);
          if (southFloor) {
            ctx.fillStyle = '#2E3547';
            ctx.fillRect(px, py + ts - 12, ts, 12);
            ctx.fillStyle = '#3B4358';
            ctx.fillRect(px, py + ts - 14, ts, 2);
          }
        } else {
          // Stone crypt floor
          ctx.fillStyle = tile === 1 ? (decor % 2 === 0 ? '#181C26' : '#161A23') : '#141821';
          ctx.fillRect(px, py, ts, ts);
          // Subtle mortar hairline
          ctx.strokeStyle = 'rgba(255,255,255,0.035)';
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 0.5, py + 0.5, ts - 1, ts - 1);
          if (decor === 3 || decor === 11) {
            ctx.strokeStyle = 'rgba(0,0,0,0.28)';
            ctx.beginPath();
            ctx.moveTo(px + 10, py + 14);
            ctx.lineTo(px + 24, py + 22);
            ctx.lineTo(px + 30, py + 34);
            ctx.stroke();
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
        const flicker = 0.85 + Math.sin(this.worldTime * 11 + prop.x) * 0.15;
        if (vis === 2) {
          const glow = ctx.createRadialGradient(prop.x, prop.y, 4, prop.x, prop.y, 82 * flicker);
          glow.addColorStop(0, 'rgba(245, 158, 11, 0.24)');
          glow.addColorStop(1, 'rgba(245, 158, 11, 0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(prop.x, prop.y, 82 * flicker, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#333A4B';
        ctx.beginPath();
        ctx.arc(prop.x, prop.y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#F59E0B';
        ctx.beginPath();
        ctx.arc(prop.x, prop.y, 5 * flicker, 0, Math.PI * 2);
        ctx.fill();
      } else if (prop.kind === 'urn') {
        ctx.fillStyle = '#6D584B';
        ctx.beginPath();
        ctx.arc(prop.x, prop.y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#9C8373';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else if (prop.kind === 'chest') {
        ctx.fillStyle = prop.interacted ? '#3B342D' : '#854D0E';
        ctx.fillRect(prop.x - 15, prop.y - 11, 30, 22);
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
          const glow = ctx.createRadialGradient(prop.x, prop.y, 6, prop.x, prop.y, 46);
          glow.addColorStop(0, `${col}44`);
          glow.addColorStop(1, `${col}00`);
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(prop.x, prop.y, 46, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#2B3140';
        ctx.beginPath();
        ctx.arc(prop.x, prop.y, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = prop.interacted ? '#4B5563' : col;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        if (!prop.interacted) {
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(prop.x, prop.y, 6, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (prop.kind === 'trap') {
        ctx.strokeStyle =
          prop.trapState === 'arming'
            ? '#EF4444'
            : prop.trapState === 'active'
            ? '#F59E0B'
            : 'rgba(148,155,168,0.28)';
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
        const glow = ctx.createRadialGradient(prop.x, prop.y, 4, prop.x, prop.y, 48 * pulse);
        glow.addColorStop(0, 'rgba(139, 92, 246, 0.7)');
        glow.addColorStop(0.55, 'rgba(245, 158, 11, 0.35)');
        glow.addColorStop(1, 'rgba(139, 92, 246, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(prop.x, prop.y, 48 * pulse, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#F59E0B';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(prop.x, prop.y, 20 * pulse, 0, Math.PI * 2);
        ctx.stroke();
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

      ctx.save();
      ctx.translate(e.x, e.y);

      // Ground shadow
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.ellipse(0, e.radius * 0.72, e.radius * 0.9, e.radius * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.rotate(e.facing);
      ctx.scale(e.squashX, e.squashY);

      if (e.hitFlash > 0) {
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(0, 0, e.radius, 0, Math.PI * 2);
        ctx.fill();
      } else if (e.type === 'skeleton') {
        ctx.fillStyle = '#D4CFC4';
        ctx.beginPath();
        ctx.arc(0, 0, e.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#3F4454';
        ctx.lineWidth = 2;
        ctx.stroke();
        // Rusted blade
        ctx.fillStyle = '#949BA8';
        ctx.fillRect(6, 5, 16, 4);
        // Eyes
        ctx.fillStyle = '#DC2626';
        ctx.fillRect(4, -5, 4, 3);
        ctx.fillRect(4, 2, 4, 3);
      } else if (e.type === 'cultist') {
        ctx.fillStyle = '#4C1D95';
        ctx.beginPath();
        ctx.arc(0, 0, e.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#A855F7';
        ctx.lineWidth = 2;
        ctx.stroke();
        // Glowing orb staff tip
        ctx.fillStyle = '#C084FC';
        ctx.beginPath();
        ctx.arc(12, 6, 4, 0, Math.PI * 2);
        ctx.fill();
      } else if (e.type === 'golem') {
        ctx.fillStyle = '#374151';
        ctx.beginPath();
        ctx.roundRect(-e.radius, -e.radius, e.radius * 2, e.radius * 2, 7);
        ctx.fill();
        ctx.strokeStyle = '#F59E0B';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.fillStyle = '#F59E0B';
        ctx.beginPath();
        ctx.arc(6, 0, 5, 0, Math.PI * 2);
        ctx.fill();
      } else if (e.type === 'wraith') {
        ctx.fillStyle = '#0F766E';
        ctx.beginPath();
        ctx.arc(0, 0, e.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#2DD4BF';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#99F6E4';
        ctx.fillRect(5, -4, 4, 2);
        ctx.fillRect(5, 2, 4, 2);
      } else if (e.isBoss) {
        const mainCol = e.type === 'boss_archon' ? '#5B21B6' : '#7F1D1D';
        const trimCol = e.type === 'boss_archon' ? '#A78BFA' : '#F59E0B';
        ctx.fillStyle = mainCol;
        ctx.beginPath();
        ctx.arc(0, 0, e.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = trimCol;
        ctx.lineWidth = 3.5;
        ctx.stroke();
        // Boss weapon / sigil
        ctx.fillStyle = trimCol;
        ctx.fillRect(10, 10, 26, 6);
        ctx.fillStyle = '#FEF3C7';
        ctx.beginPath();
        ctx.arc(9, -6, 3.5, 0, Math.PI * 2);
        ctx.arc(9, 6, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();

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

  private renderRemotePlayers(ctx: CanvasRenderingContext2D) {
    if (!this.coopMode) return;
    const ts = this.floor.tileSize;
    for (const ally of this.remotePlayers.values()) {
      const tx = Math.floor(ally.x / ts);
      const ty = Math.floor(ally.y / ts);
      const vis = this.floor.visibility[ty * this.floor.width + tx];
      if (vis === 0) continue;

      ctx.save();
      ctx.translate(ally.x, ally.y);

      if (!ally.alive) {
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

      if (ally.shield > 0) {
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.75)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, this.pRadius + 6, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.ellipse(0, 11, 14, 7, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.rotate(ally.facing);

      ctx.fillStyle = '#1C2230';
      ctx.beginPath();
      ctx.arc(0, 0, this.pRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = ally.color;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      const wKind = ally.weaponKind ?? 'greatsword';
      ctx.fillStyle = wKind === 'staff' ? '#A78BFA' : '#E5E0D5';
      if (wKind === 'greatsword' || wKind === 'halberd') {
        ctx.fillRect(8, 8, 22, 4);
      } else if (wKind === 'daggers') {
        ctx.fillRect(8, 8, 13, 3);
        ctx.fillRect(8, -11, 13, 3);
      } else if (wKind === 'scythe') {
        ctx.fillRect(8, 7, 20, 3);
        ctx.fillRect(24, 0, 4, 12);
      } else {
        ctx.fillRect(8, 7, 19, 3);
        ctx.beginPath();
        ctx.arc(28, 8.5, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = '#0F131C';
      ctx.beginPath();
      ctx.arc(2, 0, 8.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = ally.color;
      ctx.fillRect(5, -4, 3.5, 2.5);
      ctx.fillRect(5, 1.5, 3.5, 2.5);
      ctx.restore();

      // Ally name & mini HP bar
      const bw = 34;
      const pct = Math.max(0, Math.min(1, ally.hp / Math.max(1, ally.maxHp)));
      ctx.fillStyle = '#0E1117';
      ctx.fillRect(-bw / 2, -26, bw, 4);
      ctx.fillStyle = ally.color;
      ctx.fillRect(-bw / 2, -26, bw * pct, 4);

      ctx.textAlign = 'center';
      ctx.font = '600 10px "Plus Jakarta Sans", sans-serif';
      ctx.fillStyle = '#090A0E';
      ctx.fillText(ally.name, 1, -30);
      ctx.fillStyle = '#E5E0D5';
      ctx.fillText(ally.name, 0, -31);

      ctx.restore();
    }
  }

  private renderLocalPlayer2(ctx: CanvasRenderingContext2D) {
    if (!this.localCoopMode || !this.p2) return;
    const p2 = this.p2;
    ctx.save();
    ctx.translate(p2.x, p2.y);

    if (p2.isDowned) {
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

    const torch = ctx.createRadialGradient(0, 0, 8, 0, 0, 155);
    torch.addColorStop(0, 'rgba(56, 189, 248, 0.14)');
    torch.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = torch;
    ctx.beginPath();
    ctx.arc(0, 0, 155, 0, Math.PI * 2);
    ctx.fill();

    if (p2.shield > 0) {
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.75)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, this.pRadius + 7, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.ellipse(0, 11, 14, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.rotate(p2.facing);
    ctx.scale(p2.squashX, p2.squashY);

    const p2Color = '#38BDF8';
    ctx.fillStyle = p2.hitFlash > 0 ? '#FFFFFF' : '#182433';
    ctx.beginPath();
    ctx.arc(0, 0, this.pRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = p2.hitFlash > 0 ? '#FFFFFF' : p2Color;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    const wKind = p2.equippedWeapon.weaponKind ?? 'greatsword';
    ctx.fillStyle = wKind === 'staff' ? '#A78BFA' : '#E5E0D5';
    if (wKind === 'greatsword' || wKind === 'halberd') {
      ctx.fillRect(8, 8, 22, 4);
    } else if (wKind === 'daggers') {
      ctx.fillRect(8, 8, 13, 3);
      ctx.fillRect(8, -11, 13, 3);
    } else if (wKind === 'scythe') {
      ctx.fillRect(8, 7, 20, 3);
      ctx.fillRect(24, 0, 4, 12);
    } else {
      ctx.fillRect(8, 7, 19, 3);
      ctx.beginPath();
      ctx.arc(28, 8.5, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#0F131C';
    ctx.beginPath();
    ctx.arc(2, 0, 8.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p2Color;
    ctx.fillRect(5, -4, 3.5, 2.5);
    ctx.fillRect(5, 1.5, 3.5, 2.5);
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.font = '700 10px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#090A0E';
    ctx.fillText('J2', 1, -22);
    ctx.fillStyle = '#7DD3FC';
    ctx.fillText('J2', 0, -23);

    ctx.restore();
  }

  private renderPlayer(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.translate(this.px, this.py);

    if (this.isDowned) {
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
    const torch = ctx.createRadialGradient(0, 0, 8, 0, 0, 175);
    torch.addColorStop(0, 'rgba(245, 158, 11, 0.14)');
    torch.addColorStop(1, 'rgba(245, 158, 11, 0)');
    ctx.fillStyle = torch;
    ctx.beginPath();
    ctx.arc(0, 0, 175, 0, Math.PI * 2);
    ctx.fill();

    // Shield aura
    if (this.shield > 0) {
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.75)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, this.pRadius + 7, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.ellipse(0, 11, 14, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.rotate(this.pFacing);
    ctx.scale(this.pSquashX, this.pSquashY);

    const archColor = ARCHETYPES[this.archetype].accentColor;

    // Cloak / shoulders
    ctx.fillStyle = this.pHitFlash > 0 ? '#FFFFFF' : '#1E2433';
    ctx.beginPath();
    ctx.arc(0, 0, this.pRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = this.pHitFlash > 0 ? '#FFFFFF' : archColor;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Weapon silhouette
    const wKind = this.equippedWeapon.weaponKind ?? 'greatsword';
    ctx.fillStyle = wKind === 'staff' ? '#A78BFA' : '#E5E0D5';
    if (wKind === 'greatsword' || wKind === 'halberd') {
      ctx.fillRect(8, 8, 22, 4);
    } else if (wKind === 'daggers') {
      ctx.fillRect(8, 8, 13, 3);
      ctx.fillRect(8, -11, 13, 3);
    } else if (wKind === 'scythe') {
      ctx.fillRect(8, 7, 20, 3);
      ctx.fillRect(24, 0, 4, 12);
    } else {
      ctx.fillRect(8, 7, 19, 3);
      ctx.beginPath();
      ctx.arc(28, 8.5, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Helm / eyes
    ctx.fillStyle = '#0F131C';
    ctx.beginPath();
    ctx.arc(2, 0, 8.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = archColor;
    ctx.fillRect(5, -4, 3.5, 2.5);
    ctx.fillRect(5, 1.5, 3.5, 2.5);
    ctx.restore();

    if (this.localCoopMode) {
      ctx.textAlign = 'center';
      ctx.font = '700 10px "Plus Jakarta Sans", sans-serif';
      ctx.fillStyle = '#090A0E';
      ctx.fillText('J1', 1, -22);
      ctx.fillStyle = '#FCD34D';
      ctx.fillText('J1', 0, -23);
    }

    ctx.restore();
  }

  private renderSlashesAndRings(ctx: CanvasRenderingContext2D) {
    for (const s of this.slashes) {
      const alpha = s.life / s.maxLife;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.globalAlpha = alpha * 0.85;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.isSpin ? 12 : 10;
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (s.isSpin) {
        ctx.arc(0, 0, s.radius * 0.82, 0, Math.PI * 2);
      } else {
        ctx.arc(0, 0, s.radius * 0.85, s.angle - s.arc * 0.5, s.angle + s.arc * 0.5);
      }
      ctx.stroke();

      ctx.globalAlpha = alpha * 0.2;
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
    return !this.coopMode && this.floor.floorNumber === 3
      ? `[${keyLabel}] Sellar la Victoria del Eclipse`
      : `[${keyLabel}] Descender al Piso ${this.floor.floorNumber + 1}`;
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
        this.coopMode && this.coopRoomCode && this.coopPlayerId
          ? {
              roomCode: this.coopRoomCode,
              localPlayerId: this.coopPlayerId,
              allies: Array.from(this.remotePlayers.values()).map(({ targetX: _tx, targetY: _ty, ...rest }) => rest),
              isDowned: this.isDowned,
            }
          : null,
      localP2,
      localCoopControlMode: this.localCoopMode ? this.localCoopControlMode : undefined,
    };

    this.callbacks.onHudUpdate(snapshot);
  }
}
