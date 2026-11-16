import {
  ACHIEVEMENTS_CATALOG,
  ARCHETYPES,
  COSMETICS_CATALOG,
  DEFAULT_EQUIPPED_COSMETICS,
  ENEMY_DEFINITIONS,
  ETERNAL_BLESSINGS,
  computeHybridClassTitle,
} from '../data/gameData';
import {
  AchievementDef,
  AchievementStats,
  ActiveRunSave,
  ActiveSkillId,
  ArchetypeId,
  BlessingId,
  CosmeticCategory,
  EnemyType,
  EquippedCosmetics,
  MetaSaveData,
  PvpMatchResult,
  RunRecord,
  SavedHeroState,
  SaveProfileData,
  SaveSlotId,
  SaveSlotSummary,
  SerializedDungeonFloor,
} from '../types/game';

const LEGACY_V1_KEY = 'criptas_del_eclipse_save_v1';
const STORAGE_V2_KEY = 'criptas_eclipse_save_v2';
const STORAGE_V2_BAK_KEY = 'criptas_eclipse_save_v2_bak';
const SERVER_SYNC_KEY_STORAGE = 'criptas_server_sync_key';

const IDB_NAME = 'criptas_del_eclipse_db';
const IDB_VERSION = 1;
const IDB_STORE = 'save_store';
const IDB_PRIMARY_KEY = 'main_v2';
const IDB_BACKUP_KEY = 'backup_v2';

export const SAVE_SLOT_IDS: SaveSlotId[] = ['slot1', 'slot2', 'slot3'];

const DEFAULT_SLOT_NAMES: Record<SaveSlotId, string> = {
  slot1: 'Crónica I',
  slot2: 'Crónica II',
  slot3: 'Crónica III',
};

const FREE_DEFAULT_COSMETIC_IDS = Object.values(DEFAULT_EQUIPPED_COSMETICS);

export const DEFAULT_ACHIEVEMENT_STATS: AchievementStats = {
  totalKills: 0,
  bossWardenKills: 0,
  bossArchonKills: 0,
  bestFloor: 0,
  maxLevelReached: 1,
  hybridClassesForged: 0,
  relicRarityObtained: 0,
  interactionsCount: 0,
  bestiaryDiscovered: 0,
  cosmeticsUnlocked: FREE_DEFAULT_COSMETIC_IDS.length,
  coopRunsPlayed: 0,
  blessingsBought: 0,
  pvpMatchesPlayed: 0,
  pvpWins: 0,
  pvpPeakElo: 1000,
};

export const DEFAULT_META_SAVE: MetaSaveData = {
  soulShards: 0,
  blessings: {
    vitality: 0,
    might: 0,
    alacrity: 0,
    fortune: 0,
    flask: 0,
  },
  bestFloor: 0,
  totalKills: 0,
  unlockedClassTitles: [],
  recentRuns: [],
  muted: false,
  unlockedCosmetics: [...FREE_DEFAULT_COSMETIC_IDS],
  equippedCosmetics: { ...DEFAULT_EQUIPPED_COSMETICS },
  discoveredEnemies: [],
  bestiaryKills: {},
  unlockedAchievements: [],
  achievementStats: { ...DEFAULT_ACHIEVEMENT_STATS },
  pvpElo: 1000,
  pvpWins: 0,
  pvpLosses: 0,
  pvpWinStreak: 0,
  pvpBestStreak: 0,
  pvpUnlockedTitles: ['Duelista de Bronce'],
};

interface SaveStoreV2 {
  version: 2;
  activeSlotId: SaveSlotId;
  updatedAtIso: string;
  profiles: Record<SaveSlotId, SaveProfileData>;
}

interface SignedEnvelope<T> {
  v: 2;
  savedAtIso: string;
  checksum: string;
  payload: T;
}

interface ExportBackupBundle {
  format: 'criptas-del-eclipse-backup';
  version: 2;
  exportedAtIso: string;
  checksum: string;
  profile: SaveProfileData;
}

export interface StorageHealthStatus {
  localStorageOk: boolean;
  indexedDbOk: boolean;
  recoveredFromBackup: boolean;
  lastSavedIso: string | null;
  activeSlotId: SaveSlotId;
}

export type ServerSyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

export interface ServerSyncState {
  syncKey: string;
  status: ServerSyncStatus;
  lastServerSyncIso: string | null;
  lastError: string | null;
}

let cachedStore: SaveStoreV2 | null = null;
let localStorageHealthy = true;
let indexedDbHealthy = typeof indexedDB !== 'undefined';
let recoveredFromBackupFlag = false;
let serverUrlResolver: (() => string) | null = null;
let serverSyncTimer: number | null = null;
const serverSyncListeners = new Set<(state: ServerSyncState) => void>();
let serverSyncState: ServerSyncState = {
  syncKey: '',
  status: 'idle',
  lastServerSyncIso: null,
  lastError: null,
};

export function uint8ToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    bin += String.fromCharCode(...slice);
  }
  return btoa(bin);
}

export function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function isValidArchetype(val: unknown): val is ArchetypeId {
  return val === 'crusader' || val === 'stalker' || val === 'occultist';
}

function isValidSlotId(val: unknown): val is SaveSlotId {
  return val === 'slot1' || val === 'slot2' || val === 'slot3';
}

function clampInt(val: unknown, min: number, fallback: number): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return fallback;
  return Math.max(min, Math.floor(val));
}

function isValidEnemyType(val: unknown): val is EnemyType {
  return typeof val === 'string' && val in ENEMY_DEFINITIONS;
}

function sanitizeMetaSave(raw: unknown): MetaSaveData {
  if (!raw || typeof raw !== 'object') return structuredClone(DEFAULT_META_SAVE);
  const p = raw as Partial<MetaSaveData>;
  const blessingsRaw = (p.blessings ?? {}) as Partial<Record<BlessingId, number>>;

  const unlockedSet = new Set<string>(FREE_DEFAULT_COSMETIC_IDS);
  if (Array.isArray(p.unlockedCosmetics)) {
    for (const id of p.unlockedCosmetics) {
      if (typeof id === 'string' && COSMETICS_CATALOG.some((c) => c.id === id)) {
        unlockedSet.add(id);
      }
    }
  }

  const eqRaw = (p.equippedCosmetics ?? {}) as Partial<EquippedCosmetics>;
  const pickEquipped = (cat: CosmeticCategory, val: unknown, fallback: string): string => {
    if (
      typeof val === 'string' &&
      unlockedSet.has(val) &&
      COSMETICS_CATALOG.some((c) => c.id === val && c.category === cat)
    ) {
      return val;
    }
    return fallback;
  };

  const bestiaryKills: Partial<Record<EnemyType, number>> = {};
  const discoveredSet = new Set<EnemyType>();
  if (Array.isArray(p.discoveredEnemies)) {
    for (const et of p.discoveredEnemies) {
      if (isValidEnemyType(et)) discoveredSet.add(et);
    }
  }
  if (p.bestiaryKills && typeof p.bestiaryKills === 'object') {
    for (const [k, v] of Object.entries(p.bestiaryKills)) {
      if (isValidEnemyType(k)) {
        const count = clampInt(v, 0, 0);
        if (count > 0) {
          bestiaryKills[k] = count;
          discoveredSet.add(k);
        }
      }
    }
  }

  const validAchievementIds = new Set(ACHIEVEMENTS_CATALOG.map((a) => a.id));
  const unlockedAchievements = Array.isArray(p.unlockedAchievements)
    ? Array.from(
        new Set(
          p.unlockedAchievements.filter(
            (id): id is string => typeof id === 'string' && validAchievementIds.has(id)
          )
        )
      )
    : [];

  const totalBlessingsOwned =
    clampInt(blessingsRaw.vitality, 0, 0) +
    clampInt(blessingsRaw.might, 0, 0) +
    clampInt(blessingsRaw.alacrity, 0, 0) +
    clampInt(blessingsRaw.fortune, 0, 0) +
    clampInt(blessingsRaw.flask, 0, 0);

  const rawAchStats = (p.achievementStats ?? {}) as Partial<AchievementStats>;
  const safeKills = clampInt(p.totalKills, 0, 0);
  const safeBestFloor = clampInt(p.bestFloor, 0, 0);
  const achievementStats: AchievementStats = {
    totalKills: Math.max(safeKills, clampInt(rawAchStats.totalKills, 0, 0)),
    bossWardenKills: Math.max(
      bestiaryKills.boss_warden ?? 0,
      clampInt(rawAchStats.bossWardenKills, 0, 0)
    ),
    bossArchonKills: Math.max(
      bestiaryKills.boss_archon ?? 0,
      clampInt(rawAchStats.bossArchonKills, 0, 0)
    ),
    bestFloor: Math.max(safeBestFloor, clampInt(rawAchStats.bestFloor, 0, 0)),
    maxLevelReached: Math.max(1, clampInt(rawAchStats.maxLevelReached, 1, 1)),
    hybridClassesForged: clampInt(rawAchStats.hybridClassesForged, 0, 0),
    relicRarityObtained: clampInt(rawAchStats.relicRarityObtained, 0, 0),
    interactionsCount: clampInt(rawAchStats.interactionsCount, 0, 0),
    bestiaryDiscovered: Math.max(
      discoveredSet.size,
      clampInt(rawAchStats.bestiaryDiscovered, 0, 0)
    ),
    cosmeticsUnlocked: Math.max(
      unlockedSet.size,
      clampInt(rawAchStats.cosmeticsUnlocked, 0, 0)
    ),
    coopRunsPlayed: clampInt(rawAchStats.coopRunsPlayed, 0, 0),
    blessingsBought: Math.max(
      totalBlessingsOwned,
      clampInt(rawAchStats.blessingsBought, 0, 0)
    ),
    pvpMatchesPlayed: clampInt(rawAchStats.pvpMatchesPlayed, 0, 0),
    pvpWins: clampInt(rawAchStats.pvpWins, 0, 0),
    pvpPeakElo: Math.max(1000, clampInt(rawAchStats.pvpPeakElo, 600, 1000)),
  };

  const safePvpElo = clampInt(p.pvpElo, 600, 1000);
  const safePvpWins = clampInt(p.pvpWins, 0, 0);
  const safePvpWinStreak = clampInt(p.pvpWinStreak, 0, 0);
  const safePvpBestStreak = Math.max(safePvpWinStreak, clampInt(p.pvpBestStreak, 0, 0));
  const pvpUnlockedTitles = Array.isArray(p.pvpUnlockedTitles)
    ? Array.from(
        new Set([
          'Duelista de Bronce',
          ...p.pvpUnlockedTitles.filter((x): x is string => typeof x === 'string'),
        ])
      ).slice(0, 32)
    : ['Duelista de Bronce'];

  return {
    soulShards: clampInt(p.soulShards, 0, 0),
    blessings: {
      vitality: clampInt(blessingsRaw.vitality, 0, 0),
      might: clampInt(blessingsRaw.might, 0, 0),
      alacrity: clampInt(blessingsRaw.alacrity, 0, 0),
      fortune: clampInt(blessingsRaw.fortune, 0, 0),
      flask: clampInt(blessingsRaw.flask, 0, 0),
    },
    bestFloor: safeBestFloor,
    totalKills: safeKills,
    unlockedClassTitles: Array.isArray(p.unlockedClassTitles)
      ? p.unlockedClassTitles.filter((x): x is string => typeof x === 'string').slice(0, 64)
      : [],
    recentRuns: Array.isArray(p.recentRuns)
      ? (p.recentRuns.filter((r) => r && typeof r === 'object') as RunRecord[]).slice(0, 12)
      : [],
    muted: Boolean(p.muted),
    unlockedCosmetics: Array.from(unlockedSet),
    equippedCosmetics: {
      skin: pickEquipped('skin', eqRaw.skin, DEFAULT_EQUIPPED_COSMETICS.skin),
      aura: pickEquipped('aura', eqRaw.aura, DEFAULT_EQUIPPED_COSMETICS.aura),
      trail: pickEquipped('trail', eqRaw.trail, DEFAULT_EQUIPPED_COSMETICS.trail),
      pet: pickEquipped('pet', eqRaw.pet, DEFAULT_EQUIPPED_COSMETICS.pet),
    },
    discoveredEnemies: Array.from(discoveredSet),
    bestiaryKills,
    unlockedAchievements,
    achievementStats,
    pvpElo: safePvpElo,
    pvpWins: safePvpWins,
    pvpLosses: clampInt(p.pvpLosses, 0, 0),
    pvpWinStreak: safePvpWinStreak,
    pvpBestStreak: safePvpBestStreak,
    pvpUnlockedTitles,
  };
}

function sanitizeHeroState(raw: unknown): SavedHeroState | null {
  if (!raw || typeof raw !== 'object') return null;
  const h = raw as Partial<SavedHeroState>;
  const arch: ArchetypeId = isValidArchetype(h.archetype) ? h.archetype : 'crusader';
  const def = ARCHETYPES[arch];
  if (!h.equippedWeapon || typeof h.equippedWeapon !== 'object') return null;

  const validSkill = (s: unknown): s is ActiveSkillId => typeof s === 'string';
  const slots = h.equippedSlots ?? { Q: def.startingSkills[0], E: null, R: null };

  return {
    archetype: arch,
    x: typeof h.x === 'number' && Number.isFinite(h.x) ? h.x : 0,
    y: typeof h.y === 'number' && Number.isFinite(h.y) ? h.y : 0,
    facing: typeof h.facing === 'number' && Number.isFinite(h.facing) ? h.facing : 0,
    level: clampInt(h.level, 1, 1),
    xp: clampInt(h.xp, 0, 0),
    xpToNext: clampInt(h.xpToNext, 10, 80),
    skillPoints: clampInt(h.skillPoints, 0, 0),
    hp: typeof h.hp === 'number' && Number.isFinite(h.hp) ? Math.max(0, h.hp) : def.baseStats.maxHp,
    mana: typeof h.mana === 'number' && Number.isFinite(h.mana) ? Math.max(0, h.mana) : def.baseStats.maxMana,
    shield: typeof h.shield === 'number' && Number.isFinite(h.shield) ? Math.max(0, h.shield) : 0,
    flaskCharges: clampInt(h.flaskCharges, 0, 3),
    maxFlaskCharges: clampInt(h.maxFlaskCharges, 1, 3),
    unlockedNodeIds:
      Array.isArray(h.unlockedNodeIds) && h.unlockedNodeIds.length > 0
        ? h.unlockedNodeIds.filter((x): x is string => typeof x === 'string')
        : ['origin', def.startingNodeId],
    unlockedSkills: Array.isArray(h.unlockedSkills)
      ? h.unlockedSkills.filter(validSkill)
      : [def.startingSkills[0]],
    equippedSlots: {
      Q: validSkill(slots.Q) ? slots.Q : null,
      E: validSkill(slots.E) ? slots.E : null,
      R: validSkill(slots.R) ? slots.R : null,
    },
    equippedWeapon: structuredClone(h.equippedWeapon),
    equippedRelic: h.equippedRelic ? structuredClone(h.equippedRelic) : null,
    inventory: Array.isArray(h.inventory) ? structuredClone(h.inventory).slice(0, 24) : [],
    isDowned: Boolean(h.isDowned),
  };
}

function sanitizeFloor(raw: unknown): SerializedDungeonFloor | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Partial<SerializedDungeonFloor>;
  if (
    typeof f.floorNumber !== 'number' ||
    typeof f.width !== 'number' ||
    typeof f.height !== 'number' ||
    typeof f.tileSize !== 'number' ||
    typeof f.tilesB64 !== 'string' ||
    typeof f.visibilityB64 !== 'string' ||
    typeof f.wallDecorB64 !== 'string' ||
    !Array.isArray(f.rooms) ||
    !Array.isArray(f.props)
  ) {
    return null;
  }
  try {
    const expectedLen = f.width * f.height;
    const t = base64ToUint8(f.tilesB64);
    const v = base64ToUint8(f.visibilityB64);
    const w = base64ToUint8(f.wallDecorB64);
    if (t.length !== expectedLen || v.length !== expectedLen || w.length !== expectedLen) {
      return null;
    }
  } catch {
    return null;
  }

  return {
    floorNumber: clampInt(f.floorNumber, 1, 1),
    name: typeof f.name === 'string' && f.name.trim() ? f.name : `Piso ${f.floorNumber}`,
    width: f.width,
    height: f.height,
    tileSize: f.tileSize,
    tilesB64: f.tilesB64,
    visibilityB64: f.visibilityB64,
    wallDecorB64: f.wallDecorB64,
    rooms: structuredClone(f.rooms),
    props: structuredClone(f.props),
    spawnX: typeof f.spawnX === 'number' ? f.spawnX : 0,
    spawnY: typeof f.spawnY === 'number' ? f.spawnY : 0,
    bossRoomId: typeof f.bossRoomId === 'number' ? f.bossRoomId : 0,
  };
}

function sanitizeActiveRun(raw: unknown): ActiveRunSave | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<ActiveRunSave>;
  const floor = sanitizeFloor(r.floor);
  const p1 = sanitizeHeroState(r.p1);
  if (!floor || !p1) return null;
  const p2 = r.p2 ? sanitizeHeroState(r.p2) : null;

  return {
    version: 2,
    savedAtIso: typeof r.savedAtIso === 'string' ? r.savedAtIso : new Date().toISOString(),
    localCoopMode: Boolean(r.localCoopMode && p2),
    localCoopControlMode:
      r.localCoopControlMode === 'keyboard_split' || r.localCoopControlMode === 'dual_touch'
        ? r.localCoopControlMode
        : 'auto',
    floor,
    p1,
    p2,
    gold: clampInt(r.gold, 0, 0),
    soulsThisRun: clampInt(r.soulsThisRun, 0, 0),
    kills: clampInt(r.kills, 0, 0),
    enemies: Array.isArray(r.enemies) ? structuredClone(r.enemies) : [],
    loot: Array.isArray(r.loot) ? structuredClone(r.loot) : [],
    idCounter: clampInt(r.idCounter, 1, 100),
  };
}

function createEmptyProfile(id: SaveSlotId): SaveProfileData {
  return {
    id,
    name: DEFAULT_SLOT_NAMES[id],
    updatedAtIso: new Date(0).toISOString(),
    meta: structuredClone(DEFAULT_META_SAVE),
    activeRun: null,
  };
}

function sanitizeProfile(id: SaveSlotId, raw: unknown): SaveProfileData {
  if (!raw || typeof raw !== 'object') return createEmptyProfile(id);
  const p = raw as Partial<SaveProfileData>;
  return {
    id,
    name:
      typeof p.name === 'string' && p.name.trim()
        ? p.name.trim().slice(0, 26)
        : DEFAULT_SLOT_NAMES[id],
    updatedAtIso: typeof p.updatedAtIso === 'string' ? p.updatedAtIso : new Date().toISOString(),
    meta: sanitizeMetaSave(p.meta),
    activeRun: sanitizeActiveRun(p.activeRun),
  };
}

function createDefaultStore(): SaveStoreV2 {
  return {
    version: 2,
    activeSlotId: 'slot1',
    updatedAtIso: new Date(0).toISOString(),
    profiles: {
      slot1: createEmptyProfile('slot1'),
      slot2: createEmptyProfile('slot2'),
      slot3: createEmptyProfile('slot3'),
    },
  };
}

function sanitizeStore(raw: unknown): SaveStoreV2 {
  if (!raw || typeof raw !== 'object') return createDefaultStore();
  const s = raw as Partial<SaveStoreV2>;
  const profilesRaw = (s.profiles ?? {}) as Partial<Record<SaveSlotId, unknown>>;
  return {
    version: 2,
    activeSlotId: isValidSlotId(s.activeSlotId) ? s.activeSlotId : 'slot1',
    updatedAtIso: typeof s.updatedAtIso === 'string' ? s.updatedAtIso : new Date().toISOString(),
    profiles: {
      slot1: sanitizeProfile('slot1', profilesRaw.slot1),
      slot2: sanitizeProfile('slot2', profilesRaw.slot2),
      slot3: sanitizeProfile('slot3', profilesRaw.slot3),
    },
  };
}

function signEnvelope(store: SaveStoreV2): SignedEnvelope<SaveStoreV2> {
  const payloadJson = JSON.stringify(store);
  return {
    v: 2,
    savedAtIso: store.updatedAtIso,
    checksum: fnv1aHex(payloadJson),
    payload: store,
  };
}

function parseEnvelope(rawText: string | null): SaveStoreV2 | null {
  if (!rawText) return null;
  try {
    const parsed = JSON.parse(rawText) as Partial<SignedEnvelope<SaveStoreV2>>;
    if (!parsed || parsed.v !== 2 || !parsed.payload) return null;
    if (typeof parsed.checksum === 'string') {
      const check = fnv1aHex(JSON.stringify(parsed.payload));
      if (check !== parsed.checksum) {
        return null;
      }
    }
    return sanitizeStore(parsed.payload);
  } catch {
    return null;
  }
}

function openSaveDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    indexedDbHealthy = false;
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => {
        indexedDbHealthy = true;
        resolve(req.result);
      };
      req.onerror = () => {
        indexedDbHealthy = false;
        resolve(null);
      };
    } catch {
      indexedDbHealthy = false;
      resolve(null);
    }
  });
}

async function idbWriteEnvelope(envelope: SignedEnvelope<SaveStoreV2>): Promise<void> {
  const db = await openSaveDb();
  if (!db) return;
  try {
    const json = JSON.stringify(envelope);
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const getPrev = store.get(IDB_PRIMARY_KEY);
      getPrev.onsuccess = () => {
        if (typeof getPrev.result === 'string') {
          store.put(getPrev.result, IDB_BACKUP_KEY);
        }
        store.put(json, IDB_PRIMARY_KEY);
      };
      getPrev.onerror = () => {
        store.put(json, IDB_PRIMARY_KEY);
      };
      tx.oncomplete = () => {
        indexedDbHealthy = true;
        db.close();
        resolve();
      };
      tx.onerror = () => {
        indexedDbHealthy = false;
        db.close();
        resolve();
      };
    });
  } catch {
    indexedDbHealthy = false;
    db.close();
  }
}

async function idbReadEnvelope(): Promise<SaveStoreV2 | null> {
  const db = await openSaveDb();
  if (!db) return null;
  try {
    return await new Promise<SaveStoreV2 | null>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const reqPrimary = store.get(IDB_PRIMARY_KEY);
      reqPrimary.onsuccess = () => {
        const primaryParsed = parseEnvelope(typeof reqPrimary.result === 'string' ? reqPrimary.result : null);
        if (primaryParsed) {
          db.close();
          resolve(primaryParsed);
          return;
        }
        const reqBak = store.get(IDB_BACKUP_KEY);
        reqBak.onsuccess = () => {
          const bakParsed = parseEnvelope(typeof reqBak.result === 'string' ? reqBak.result : null);
          db.close();
          resolve(bakParsed);
        };
        reqBak.onerror = () => {
          db.close();
          resolve(null);
        };
      };
      reqPrimary.onerror = () => {
        db.close();
        resolve(null);
      };
    });
  } catch {
    db.close();
    return null;
  }
}

function writeStoreSync(store: SaveStoreV2, skipRemoteSchedule = false): void {
  store.updatedAtIso = new Date().toISOString();
  cachedStore = store;
  const envelope = signEnvelope(store);
  const serialized = JSON.stringify(envelope);

  try {
    const prevRaw = localStorage.getItem(STORAGE_V2_KEY);
    if (prevRaw && parseEnvelope(prevRaw)) {
      localStorage.setItem(STORAGE_V2_BAK_KEY, prevRaw);
    }
    localStorage.setItem(STORAGE_V2_KEY, serialized);
    localStorageHealthy = true;
  } catch {
    localStorageHealthy = false;
  }

  void idbWriteEnvelope(envelope);

  if (!skipRemoteSchedule && typeof window !== 'undefined' && serverUrlResolver) {
    if (serverSyncTimer !== null) {
      window.clearTimeout(serverSyncTimer);
    }
    serverSyncTimer = window.setTimeout(() => {
      serverSyncTimer = null;
      const baseUrl = serverUrlResolver?.();
      if (baseUrl !== undefined) {
        void pushSaveStoreToServer(baseUrl);
      }
    }, 850);
  }
}

function migrateLegacyV1(): SaveStoreV2 | null {
  try {
    const rawV1 = localStorage.getItem(LEGACY_V1_KEY);
    if (!rawV1) return null;
    const parsed = JSON.parse(rawV1) as Partial<MetaSaveData>;
    const store = createDefaultStore();
    const nowIso = new Date().toISOString();
    store.updatedAtIso = nowIso;
    store.profiles.slot1 = {
      id: 'slot1',
      name: DEFAULT_SLOT_NAMES.slot1,
      updatedAtIso: nowIso,
      meta: sanitizeMetaSave(parsed),
      activeRun: null,
    };
    writeStoreSync(store);
    return store;
  } catch {
    return null;
  }
}

function loadStoreSync(): SaveStoreV2 {
  if (cachedStore) return cachedStore;

  try {
    const rawPrimary = localStorage.getItem(STORAGE_V2_KEY);
    const primary = parseEnvelope(rawPrimary);
    if (primary) {
      cachedStore = primary;
      localStorageHealthy = true;
      return primary;
    }

    const rawBackup = localStorage.getItem(STORAGE_V2_BAK_KEY);
    const backup = parseEnvelope(rawBackup);
    if (backup) {
      recoveredFromBackupFlag = true;
      cachedStore = backup;
      try {
        if (rawBackup) localStorage.setItem(STORAGE_V2_KEY, rawBackup);
      } catch {
        // ignore quota error
      }
      return backup;
    }
  } catch {
    localStorageHealthy = false;
  }

  const migrated = migrateLegacyV1();
  if (migrated) {
    cachedStore = migrated;
    return migrated;
  }

  const fresh = createDefaultStore();
  cachedStore = fresh;
  return fresh;
}

export async function hydrateSaveStoreFromIndexedDB(): Promise<{
  restored: boolean;
  activeProfile: SaveProfileData;
}> {
  const local = loadStoreSync();
  const idbStore = await idbReadEnvelope();
  if (!idbStore) {
    return { restored: false, activeProfile: structuredClone(local.profiles[local.activeSlotId]) };
  }

  const localTs = Date.parse(local.updatedAtIso || '') || 0;
  const idbTs = Date.parse(idbStore.updatedAtIso || '') || 0;

  if (idbTs > localTs) {
    cachedStore = idbStore;
    recoveredFromBackupFlag = true;
    try {
      const env = JSON.stringify(signEnvelope(idbStore));
      localStorage.setItem(STORAGE_V2_KEY, env);
      localStorage.setItem(STORAGE_V2_BAK_KEY, env);
      localStorageHealthy = true;
    } catch {
      // keep in-memory cache + IDB intact
    }
    return {
      restored: true,
      activeProfile: structuredClone(idbStore.profiles[idbStore.activeSlotId]),
    };
  }

  // Ensure IDB has the latest copy if local is newer
  if (localTs > idbTs && localTs > 0) {
    void idbWriteEnvelope(signEnvelope(local));
  }

  return { restored: false, activeProfile: structuredClone(local.profiles[local.activeSlotId]) };
}

export function getActiveSlotId(): SaveSlotId {
  return loadStoreSync().activeSlotId;
}

export function getActiveProfile(): SaveProfileData {
  const store = loadStoreSync();
  return structuredClone(store.profiles[store.activeSlotId]);
}

export function setActiveSlotId(slotId: SaveSlotId): SaveProfileData {
  const store = loadStoreSync();
  store.activeSlotId = slotId;
  writeStoreSync(store);
  return structuredClone(store.profiles[slotId]);
}

export function getStorageHealthStatus(): StorageHealthStatus {
  const store = loadStoreSync();
  const hasRealSave = Date.parse(store.updatedAtIso || '') > 0;
  return {
    localStorageOk: localStorageHealthy,
    indexedDbOk: indexedDbHealthy,
    recoveredFromBackup: recoveredFromBackupFlag,
    lastSavedIso: hasRealSave ? store.updatedAtIso : null,
    activeSlotId: store.activeSlotId,
  };
}

export function getSaveSlotSummaries(): SaveSlotSummary[] {
  const store = loadStoreSync();
  return SAVE_SLOT_IDS.map((id) => {
    const prof = store.profiles[id];
    const blessingsTotal = Object.values(prof.meta.blessings).reduce((acc, n) => acc + n, 0);
    const run = prof.activeRun;
    return {
      id,
      name: prof.name,
      updatedAtIso: prof.updatedAtIso,
      soulShards: prof.meta.soulShards,
      bestFloor: prof.meta.bestFloor,
      totalKills: prof.meta.totalKills,
      blessingsTotal,
      hasActiveRun: Boolean(run),
      activeRunSummary: run
        ? {
            floorNumber: run.floor.floorNumber,
            floorName: run.floor.name,
            p1ClassTitle: computeHybridClassTitle(run.p1.archetype, run.p1.unlockedNodeIds),
            p1Level: run.p1.level,
            localCoopMode: run.localCoopMode,
            kills: run.kills,
            savedAtIso: run.savedAtIso,
          }
        : null,
    };
  });
}

export function renameSaveSlot(slotId: SaveSlotId, name: string): SaveProfileData {
  const store = loadStoreSync();
  const clean = name.trim().slice(0, 26) || DEFAULT_SLOT_NAMES[slotId];
  store.profiles[slotId] = {
    ...store.profiles[slotId],
    name: clean,
    updatedAtIso: new Date().toISOString(),
  };
  writeStoreSync(store);
  return structuredClone(store.profiles[slotId]);
}

export function saveActiveRunCheckpoint(
  runSave: ActiveRunSave,
  slotId?: SaveSlotId
): SaveProfileData {
  const store = loadStoreSync();
  const target = slotId ?? store.activeSlotId;
  const nowIso = new Date().toISOString();
  const prevProfile = store.profiles[target];
  const updatedBestFloor = Math.max(prevProfile.meta.bestFloor, runSave.floor.floorNumber);
  store.profiles[target] = {
    ...prevProfile,
    updatedAtIso: nowIso,
    meta:
      updatedBestFloor !== prevProfile.meta.bestFloor
        ? { ...prevProfile.meta, bestFloor: updatedBestFloor }
        : prevProfile.meta,
    activeRun: structuredClone({ ...runSave, savedAtIso: nowIso }),
  };
  writeStoreSync(store);
  return structuredClone(store.profiles[target]);
}

export function clearActiveRunCheckpoint(slotId?: SaveSlotId): SaveProfileData {
  const store = loadStoreSync();
  const target = slotId ?? store.activeSlotId;
  if (!store.profiles[target].activeRun) {
    return structuredClone(store.profiles[target]);
  }
  store.profiles[target] = {
    ...store.profiles[target],
    updatedAtIso: new Date().toISOString(),
    activeRun: null,
  };
  writeStoreSync(store);
  return structuredClone(store.profiles[target]);
}

export function resetSaveSlot(slotId: SaveSlotId): SaveProfileData {
  const store = loadStoreSync();
  const fresh = createEmptyProfile(slotId);
  fresh.updatedAtIso = new Date().toISOString();
  store.profiles[slotId] = fresh;
  writeStoreSync(store);
  return structuredClone(fresh);
}

export function exportSlotBackupJson(slotId: SaveSlotId): string {
  const store = loadStoreSync();
  const profile = structuredClone(store.profiles[slotId]);
  const bundle: ExportBackupBundle = {
    format: 'criptas-del-eclipse-backup',
    version: 2,
    exportedAtIso: new Date().toISOString(),
    checksum: fnv1aHex(JSON.stringify(profile)),
    profile,
  };
  return JSON.stringify(bundle, null, 2);
}

export function importSlotBackupJson(
  rawText: string,
  targetSlotId: SaveSlotId
): { ok: true; profile: SaveProfileData } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(rawText) as Partial<ExportBackupBundle>;
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: 'El archivo no tiene formato JSON válido.' };
    }

    // Support both v2 bundle and raw v1 MetaSaveData JSON
    if (parsed.format === 'criptas-del-eclipse-backup' && parsed.profile) {
      if (typeof parsed.checksum === 'string') {
        const expected = fnv1aHex(JSON.stringify(parsed.profile));
        if (expected !== parsed.checksum) {
          return {
            ok: false,
            error: 'La suma de verificación del respaldo no coincide (archivo dañado o alterado).',
          };
        }
      }
      const store = loadStoreSync();
      const restored = sanitizeProfile(targetSlotId, parsed.profile);
      restored.id = targetSlotId;
      restored.updatedAtIso = new Date().toISOString();
      store.profiles[targetSlotId] = restored;
      writeStoreSync(store);
      return { ok: true, profile: structuredClone(restored) };
    }

    // Fallback: raw MetaSaveData object
    const maybeMeta = parsed as Partial<MetaSaveData>;
    if (typeof maybeMeta.soulShards === 'number' && maybeMeta.blessings) {
      const store = loadStoreSync();
      const current = store.profiles[targetSlotId];
      const updated: SaveProfileData = {
        ...current,
        updatedAtIso: new Date().toISOString(),
        meta: sanitizeMetaSave(maybeMeta),
      };
      store.profiles[targetSlotId] = updated;
      writeStoreSync(store);
      return { ok: true, profile: structuredClone(updated) };
    }

    return { ok: false, error: 'El archivo no corresponde a una partida de Criptas del Eclipse.' };
  } catch {
    return { ok: false, error: 'No se pudo leer el archivo JSON seleccionado.' };
  }
}

export function loadMetaSave(): MetaSaveData {
  return structuredClone(getActiveProfile().meta);
}

export function saveMetaSave(data: MetaSaveData): void {
  const store = loadStoreSync();
  const target = store.activeSlotId;
  store.profiles[target] = {
    ...store.profiles[target],
    updatedAtIso: new Date().toISOString(),
    meta: sanitizeMetaSave(data),
  };
  writeStoreSync(store);
}

export function purchaseBlessing(
  save: MetaSaveData,
  id: BlessingId,
  maxLevel: number,
  cost: number
): MetaSaveData | null {
  const current = save.blessings[id] ?? 0;
  if (current >= maxLevel || save.soulShards < cost) return null;
  const next: MetaSaveData = {
    ...save,
    soulShards: save.soulShards - cost,
    blessings: {
      ...save.blessings,
      [id]: current + 1,
    },
  };
  saveMetaSave(next);
  return next;
}

export function recordCompletedRun(save: MetaSaveData, record: RunRecord): MetaSaveData {
  const titles = save.unlockedClassTitles.includes(record.classTitle)
    ? save.unlockedClassTitles
    : [...save.unlockedClassTitles, record.classTitle];
  const next: MetaSaveData = {
    ...save,
    soulShards: save.soulShards + record.soulsEarned,
    bestFloor: Math.max(save.bestFloor, record.floorReached),
    totalKills: save.totalKills + record.kills,
    unlockedClassTitles: titles,
    recentRuns: [record, ...save.recentRuns].slice(0, 12),
  };
  saveMetaSave(next);
  return next;
}

export function recordLocalPvpResult(save: MetaSaveData, result: PvpMatchResult): MetaSaveData {
  const titles = new Set(save.pvpUnlockedTitles);
  if (result.unlockedTitle) {
    titles.add(result.unlockedTitle);
  }
  const nextStreak =
    result.mode === 'online'
      ? result.won
        ? save.pvpWinStreak + 1
        : 0
      : save.pvpWinStreak;
  const nextElo = result.mode === 'online' ? Math.max(600, result.eloAfter) : save.pvpElo;

  const next: MetaSaveData = {
    ...save,
    soulShards: save.soulShards + Math.max(0, result.soulsReward),
    pvpElo: nextElo,
    pvpWins: result.mode === 'online' && result.won ? save.pvpWins + 1 : save.pvpWins,
    pvpLosses: result.mode === 'online' && !result.won ? save.pvpLosses + 1 : save.pvpLosses,
    pvpWinStreak: nextStreak,
    pvpBestStreak: Math.max(save.pvpBestStreak, nextStreak),
    pvpUnlockedTitles: Array.from(titles),
  };
  saveMetaSave(next);
  return next;
}

export function purchaseCosmetic(save: MetaSaveData, cosmeticId: string): MetaSaveData | null {
  const item = COSMETICS_CATALOG.find((c) => c.id === cosmeticId);
  if (!item) return null;
  if (save.unlockedCosmetics.includes(cosmeticId)) {
    return equipCosmetic(save, item.category, cosmeticId);
  }
  if (save.soulShards < item.cost) return null;
  const next: MetaSaveData = {
    ...save,
    soulShards: save.soulShards - item.cost,
    unlockedCosmetics: [...save.unlockedCosmetics, cosmeticId],
    equippedCosmetics: {
      ...save.equippedCosmetics,
      [item.category]: cosmeticId,
    },
  };
  saveMetaSave(next);
  return next;
}

export function equipCosmetic(
  save: MetaSaveData,
  category: CosmeticCategory,
  cosmeticId: string
): MetaSaveData | null {
  const item = COSMETICS_CATALOG.find((c) => c.id === cosmeticId && c.category === category);
  if (!item || !save.unlockedCosmetics.includes(cosmeticId)) return null;
  const next: MetaSaveData = {
    ...save,
    equippedCosmetics: {
      ...save.equippedCosmetics,
      [category]: cosmeticId,
    },
  };
  saveMetaSave(next);
  return next;
}

export function recordBestiaryProgress(
  save: MetaSaveData,
  enemyType: EnemyType,
  killed: boolean
): MetaSaveData {
  const discovered = save.discoveredEnemies.includes(enemyType)
    ? save.discoveredEnemies
    : [...save.discoveredEnemies, enemyType];
  const prevKills = save.bestiaryKills[enemyType] ?? 0;
  const nextKills = killed ? prevKills + 1 : prevKills;
  if (discovered === save.discoveredEnemies && nextKills === prevKills) {
    return save;
  }
  const next: MetaSaveData = {
    ...save,
    discoveredEnemies: discovered,
    bestiaryKills: killed ? { ...save.bestiaryKills, [enemyType]: nextKills } : save.bestiaryKills,
  };
  saveMetaSave(next);
  return next;
}

export function adminGrantSoulShards(save: MetaSaveData, delta: number): MetaSaveData {
  const next: MetaSaveData = {
    ...save,
    soulShards: Math.max(0, save.soulShards + Math.round(delta)),
  };
  saveMetaSave(next);
  return next;
}

export function adminSetSoulShards(save: MetaSaveData, amount: number): MetaSaveData {
  const next: MetaSaveData = {
    ...save,
    soulShards: Math.max(0, Math.round(amount)),
  };
  saveMetaSave(next);
  return next;
}

export function adminSetPvpStats(
  save: MetaSaveData,
  patch: { elo?: number; wins?: number; losses?: number; streak?: number; reset?: boolean }
): MetaSaveData {
  if (patch.reset) {
    const next: MetaSaveData = {
      ...save,
      pvpElo: 1000,
      pvpWins: 0,
      pvpLosses: 0,
      pvpWinStreak: 0,
      pvpBestStreak: 0,
      pvpUnlockedTitles: ['Duelista de Bronce'],
    };
    saveMetaSave(next);
    return next;
  }
  const nextElo =
    typeof patch.elo === 'number' && Number.isFinite(patch.elo)
      ? Math.max(600, Math.min(3500, Math.round(patch.elo)))
      : save.pvpElo;
  const nextWins =
    typeof patch.wins === 'number' && Number.isFinite(patch.wins)
      ? Math.max(0, Math.round(patch.wins))
      : save.pvpWins;
  const nextLosses =
    typeof patch.losses === 'number' && Number.isFinite(patch.losses)
      ? Math.max(0, Math.round(patch.losses))
      : save.pvpLosses;
  const nextStreak =
    typeof patch.streak === 'number' && Number.isFinite(patch.streak)
      ? Math.max(0, Math.round(patch.streak))
      : save.pvpWinStreak;
  const next: MetaSaveData = {
    ...save,
    pvpElo: nextElo,
    pvpWins: nextWins,
    pvpLosses: nextLosses,
    pvpWinStreak: nextStreak,
    pvpBestStreak: Math.max(save.pvpBestStreak, nextStreak),
  };
  saveMetaSave(next);
  return next;
}

export function adminResetMetaProgress(save: MetaSaveData): MetaSaveData {
  const next: MetaSaveData = {
    ...structuredClone(DEFAULT_META_SAVE),
    muted: save.muted,
  };
  saveMetaSave(next);
  return next;
}

export function adminUnlockAllCosmetics(save: MetaSaveData): MetaSaveData {
  const next: MetaSaveData = {
    ...save,
    unlockedCosmetics: COSMETICS_CATALOG.map((c) => c.id),
  };
  saveMetaSave(next);
  return next;
}

export function adminUnlockAllBestiary(save: MetaSaveData): MetaSaveData {
  const allTypes = Object.keys(ENEMY_DEFINITIONS) as EnemyType[];
  const nextKills = { ...save.bestiaryKills };
  for (const t of allTypes) {
    if (!nextKills[t]) nextKills[t] = 1;
  }
  const next: MetaSaveData = {
    ...save,
    discoveredEnemies: allTypes,
    bestiaryKills: nextKills,
  };
  saveMetaSave(next);
  return next;
}

export function adminMaxAllBlessings(save: MetaSaveData): MetaSaveData {
  const blessings = { ...save.blessings };
  for (const b of ETERNAL_BLESSINGS) {
    blessings[b.id] = b.maxLevel;
  }
  const next: MetaSaveData = {
    ...save,
    blessings,
  };
  saveMetaSave(next);
  return next;
}

export type AchievementStatUpdate = Partial<
  Record<keyof AchievementStats, { mode: 'inc' | 'max'; value: number }>
>;

export function evaluateAndUnlockAchievements(
  save: MetaSaveData,
  updates?: AchievementStatUpdate
): { meta: MetaSaveData; newlyUnlocked: AchievementDef[]; changed: boolean } {
  const stats: AchievementStats = { ...save.achievementStats };
  let statsChanged = false;

  if (updates) {
    for (const [k, upd] of Object.entries(updates) as Array<
      [keyof AchievementStats, { mode: 'inc' | 'max'; value: number }]
    >) {
      if (!upd || !Number.isFinite(upd.value)) continue;
      const prev = stats[k] ?? 0;
      const nextVal =
        upd.mode === 'inc' ? Math.max(0, prev + Math.round(upd.value)) : Math.max(prev, Math.round(upd.value));
      if (nextVal !== prev) {
        stats[k] = nextVal;
        statsChanged = true;
      }
    }
  }

  // Keep synced with derived meta fields
  const derivedBestiary = save.discoveredEnemies.length;
  const derivedCosmetics = save.unlockedCosmetics.length;
  const derivedBlessings = Object.values(save.blessings).reduce((acc, n) => acc + n, 0);
  if (derivedBestiary > stats.bestiaryDiscovered) {
    stats.bestiaryDiscovered = derivedBestiary;
    statsChanged = true;
  }
  if (derivedCosmetics > stats.cosmeticsUnlocked) {
    stats.cosmeticsUnlocked = derivedCosmetics;
    statsChanged = true;
  }
  if (derivedBlessings > stats.blessingsBought) {
    stats.blessingsBought = derivedBlessings;
    statsChanged = true;
  }
  if (save.bestFloor > stats.bestFloor) {
    stats.bestFloor = save.bestFloor;
    statsChanged = true;
  }

  const unlockedSet = new Set(save.unlockedAchievements);
  const newlyUnlocked: AchievementDef[] = [];
  let bonusSouls = 0;

  for (const ach of ACHIEVEMENTS_CATALOG) {
    if (unlockedSet.has(ach.id)) continue;
    if ((stats[ach.statKey] ?? 0) >= ach.target) {
      unlockedSet.add(ach.id);
      newlyUnlocked.push(ach);
      bonusSouls += ach.rewardSouls;
    }
  }

  if (!statsChanged && newlyUnlocked.length === 0) {
    return { meta: save, newlyUnlocked: [], changed: false };
  }

  const next: MetaSaveData = {
    ...save,
    soulShards: save.soulShards + bonusSouls,
    unlockedAchievements: Array.from(unlockedSet),
    achievementStats: stats,
  };
  saveMetaSave(next);
  return { meta: next, newlyUnlocked, changed: true };
}

export function adminUnlockAllAchievements(save: MetaSaveData): MetaSaveData {
  const unlockedSet = new Set(save.unlockedAchievements);
  const stats: AchievementStats = { ...save.achievementStats };
  let bonusSouls = 0;
  for (const ach of ACHIEVEMENTS_CATALOG) {
    stats[ach.statKey] = Math.max(stats[ach.statKey] ?? 0, ach.target);
    if (!unlockedSet.has(ach.id)) {
      unlockedSet.add(ach.id);
      bonusSouls += ach.rewardSouls;
    }
  }
  const next: MetaSaveData = {
    ...save,
    soulShards: save.soulShards + bonusSouls,
    unlockedAchievements: Array.from(unlockedSet),
    achievementStats: stats,
  };
  saveMetaSave(next);
  return next;
}

function generateSyncKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'ECLIPSE-';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function normalizeClientSyncKey(raw: string): string {
  return raw
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, '')
    .slice(0, 48);
}

export function getServerSyncKey(): string {
  if (serverSyncState.syncKey) return serverSyncState.syncKey;
  let stored = '';
  try {
    stored = normalizeClientSyncKey(localStorage.getItem(SERVER_SYNC_KEY_STORAGE) || '');
  } catch {
    stored = '';
  }
  if (stored.length < 4) {
    stored = generateSyncKey();
    try {
      localStorage.setItem(SERVER_SYNC_KEY_STORAGE, stored);
    } catch {
      // ignore
    }
  }
  serverSyncState = { ...serverSyncState, syncKey: stored };
  return stored;
}

function emitServerSyncState(patch: Partial<ServerSyncState>) {
  const syncKey = patch.syncKey ?? getServerSyncKey();
  serverSyncState = { ...serverSyncState, ...patch, syncKey };
  for (const cb of serverSyncListeners) {
    cb(serverSyncState);
  }
}

export function getServerSyncState(): ServerSyncState {
  getServerSyncKey();
  return serverSyncState;
}

export function onServerSyncChange(cb: (state: ServerSyncState) => void): () => void {
  serverSyncListeners.add(cb);
  cb(getServerSyncState());
  return () => {
    serverSyncListeners.delete(cb);
  };
}

export function setServerUrlResolver(resolver: () => string): void {
  serverUrlResolver = resolver;
}

export function setServerSyncKey(raw: string): { ok: true; syncKey: string } | { ok: false; error: string } {
  const clean = normalizeClientSyncKey(raw);
  if (clean.length < 4) {
    return { ok: false, error: 'El código debe tener al menos 4 caracteres (letras, números, - o _).' };
  }
  try {
    localStorage.setItem(SERVER_SYNC_KEY_STORAGE, clean);
  } catch {
    // ignore
  }
  emitServerSyncState({ syncKey: clean, status: 'idle', lastError: null });
  return { ok: true, syncKey: clean };
}

function applyExternalStoreLocally(store: SaveStoreV2): SaveProfileData {
  const clean = sanitizeStore(store);
  cachedStore = clean;
  const env = signEnvelope(clean);
  try {
    const serialized = JSON.stringify(env);
    const prevRaw = localStorage.getItem(STORAGE_V2_KEY);
    if (prevRaw && parseEnvelope(prevRaw)) {
      localStorage.setItem(STORAGE_V2_BAK_KEY, prevRaw);
    }
    localStorage.setItem(STORAGE_V2_KEY, serialized);
    localStorageHealthy = true;
  } catch {
    localStorageHealthy = false;
  }
  void idbWriteEnvelope(env);
  return structuredClone(clean.profiles[clean.activeSlotId]);
}

function buildApiUrl(baseUrl: string, syncKey: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  return `${cleanBase}/api/saves/${encodeURIComponent(syncKey)}`;
}

export async function pushSaveStoreToServer(
  baseUrl: string,
  opts?: { keepalive?: boolean }
): Promise<{ ok: boolean; updatedAtIso?: string; error?: string }> {
  const syncKey = getServerSyncKey();
  const store = loadStoreSync();
  if (!opts?.keepalive) {
    emitServerSyncState({ status: 'syncing', lastError: null });
  }

  try {
    const res = await fetch(buildApiUrl(baseUrl, syncKey), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store }),
      keepalive: Boolean(opts?.keepalive),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      updatedAtIso?: string;
      error?: string;
    };
    if (!res.ok || !data.ok) {
      const msg = data.error || `Error HTTP ${res.status}`;
      emitServerSyncState({ status: 'error', lastError: msg });
      return { ok: false, error: msg };
    }
    const ts = data.updatedAtIso || new Date().toISOString();
    emitServerSyncState({ status: 'synced', lastServerSyncIso: ts, lastError: null });
    return { ok: true, updatedAtIso: ts };
  } catch {
    emitServerSyncState({ status: 'offline', lastError: 'Servidor no disponible' });
    return { ok: false, error: 'No se pudo conectar con el servidor.' };
  }
}

export async function pullSaveStoreFromServer(baseUrl: string): Promise<{
  ok: boolean;
  found: boolean;
  activeProfile?: SaveProfileData;
  error?: string;
}> {
  const syncKey = getServerSyncKey();
  emitServerSyncState({ status: 'syncing', lastError: null });
  try {
    const res = await fetch(buildApiUrl(baseUrl, syncKey), { cache: 'no-store' });
    const data = (await res.json()) as {
      ok?: boolean;
      found?: boolean;
      updatedAtIso?: string;
      store?: SaveStoreV2;
      error?: string;
    };
    if (!res.ok || !data.ok) {
      const msg = data.error || `Error HTTP ${res.status}`;
      emitServerSyncState({ status: 'error', lastError: msg });
      return { ok: false, found: false, error: msg };
    }
    if (!data.found || !data.store) {
      emitServerSyncState({ status: 'synced', lastError: null });
      return { ok: true, found: false };
    }
    const profile = applyExternalStoreLocally(data.store);
    emitServerSyncState({
      status: 'synced',
      lastServerSyncIso: data.updatedAtIso || new Date().toISOString(),
      lastError: null,
    });
    return { ok: true, found: true, activeProfile: profile };
  } catch {
    emitServerSyncState({ status: 'offline', lastError: 'Servidor no disponible' });
    return { ok: false, found: false, error: 'No se pudo conectar con el servidor.' };
  }
}

export async function syncSaveStoreWithServer(baseUrl: string): Promise<{
  action: 'pulled' | 'pushed' | 'noop' | 'offline';
  activeProfile: SaveProfileData;
}> {
  const local = loadStoreSync();
  const localTs = Date.parse(local.updatedAtIso || '') || 0;
  const syncKey = getServerSyncKey();
  emitServerSyncState({ status: 'syncing', lastError: null });

  try {
    const res = await fetch(buildApiUrl(baseUrl, syncKey), { cache: 'no-store' });
    const data = (await res.json()) as {
      ok?: boolean;
      found?: boolean;
      updatedAtIso?: string;
      store?: SaveStoreV2;
    };
    if (!res.ok || !data.ok) {
      emitServerSyncState({ status: 'error', lastError: 'Respuesta inválida del servidor' });
      return { action: 'offline', activeProfile: structuredClone(local.profiles[local.activeSlotId]) };
    }

    if (data.found && data.store) {
      const serverTs = Date.parse(data.updatedAtIso || data.store.updatedAtIso || '') || 0;
      if (serverTs > localTs) {
        const profile = applyExternalStoreLocally(data.store);
        emitServerSyncState({
          status: 'synced',
          lastServerSyncIso: data.updatedAtIso || new Date().toISOString(),
          lastError: null,
        });
        return { action: 'pulled', activeProfile: profile };
      }
    }

    if (localTs > 0) {
      const pushed = await pushSaveStoreToServer(baseUrl);
      if (pushed.ok) {
        return { action: 'pushed', activeProfile: structuredClone(local.profiles[local.activeSlotId]) };
      }
    }

    emitServerSyncState({
      status: 'synced',
      lastServerSyncIso: data.updatedAtIso ?? serverSyncState.lastServerSyncIso,
      lastError: null,
    });
    return { action: 'noop', activeProfile: structuredClone(local.profiles[local.activeSlotId]) };
  } catch {
    emitServerSyncState({ status: 'offline', lastError: 'Modo sin conexión activo' });
    return { action: 'offline', activeProfile: structuredClone(local.profiles[local.activeSlotId]) };
  }
}

export async function deleteServerSaveRemote(
  baseUrl: string
): Promise<{ ok: boolean; deleted: boolean; error?: string }> {
  const syncKey = getServerSyncKey();
  emitServerSyncState({ status: 'syncing', lastError: null });
  try {
    const res = await fetch(buildApiUrl(baseUrl, syncKey), { method: 'DELETE' });
    const data = (await res.json()) as { ok?: boolean; deleted?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      const msg = data.error || `Error HTTP ${res.status}`;
      emitServerSyncState({ status: 'error', lastError: msg });
      return { ok: false, deleted: false, error: msg };
    }
    emitServerSyncState({ status: 'idle', lastServerSyncIso: null, lastError: null });
    return { ok: true, deleted: Boolean(data.deleted) };
  } catch {
    emitServerSyncState({ status: 'offline', lastError: 'Servidor no disponible' });
    return { ok: false, deleted: false, error: 'No se pudo conectar con el servidor.' };
  }
}

