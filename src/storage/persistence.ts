import { BlessingId, MetaSaveData, RunRecord } from '../types/game';

const STORAGE_KEY = 'criptas_del_eclipse_save_v1';

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
};

export function loadMetaSave(): MetaSaveData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_META_SAVE);
    const parsed = JSON.parse(raw) as Partial<MetaSaveData>;
    return {
      soulShards: typeof parsed.soulShards === 'number' ? Math.max(0, parsed.soulShards) : 0,
      blessings: {
        vitality: parsed.blessings?.vitality ?? 0,
        might: parsed.blessings?.might ?? 0,
        alacrity: parsed.blessings?.alacrity ?? 0,
        fortune: parsed.blessings?.fortune ?? 0,
        flask: parsed.blessings?.flask ?? 0,
      },
      bestFloor: typeof parsed.bestFloor === 'number' ? parsed.bestFloor : 0,
      totalKills: typeof parsed.totalKills === 'number' ? parsed.totalKills : 0,
      unlockedClassTitles: Array.isArray(parsed.unlockedClassTitles)
        ? parsed.unlockedClassTitles
        : [],
      recentRuns: Array.isArray(parsed.recentRuns) ? parsed.recentRuns.slice(0, 8) : [],
      muted: Boolean(parsed.muted),
    };
  } catch {
    return structuredClone(DEFAULT_META_SAVE);
  }
}

export function saveMetaSave(data: MetaSaveData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore quota errors gracefully
  }
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
    recentRuns: [record, ...save.recentRuns].slice(0, 8),
  };
  saveMetaSave(next);
  return next;
}
