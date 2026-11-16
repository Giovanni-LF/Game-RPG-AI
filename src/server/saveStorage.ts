import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export type ServerSaveSlotId = 'slot1' | 'slot2' | 'slot3';

export interface ServerSaveStoreShape {
  version: 2;
  activeSlotId: ServerSaveSlotId;
  updatedAtIso: string;
  profiles: Record<ServerSaveSlotId, Record<string, unknown>>;
}

export interface ServerSaveEnvelope {
  format: 'criptas-server-save';
  version: 2;
  syncKey: string;
  updatedAtIso: string;
  checksum: string;
  store: ServerSaveStoreShape;
}

export interface ServerSaveReadResult {
  found: boolean;
  recoveredFromBackup?: boolean;
  updatedAtIso?: string;
  checksum?: string;
  bytes?: number;
  store?: ServerSaveStoreShape;
}

const SAVES_DIR = path.resolve(process.cwd(), '.saves');
const writeQueues = new Map<string, Promise<unknown>>();

export function normalizeSyncKey(raw: string): string | null {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, '')
    .slice(0, 48);
  if (cleaned.length < 4) return null;
  return cleaned;
}

export function isValidSlotId(val: string): val is ServerSaveSlotId {
  return val === 'slot1' || val === 'slot2' || val === 'slot3';
}

function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function getFilePaths(syncKey: string) {
  const hash = sha256Hex(syncKey.toLowerCase());
  return {
    hash,
    primary: path.join(SAVES_DIR, `save_${hash}.json`),
    backup: path.join(SAVES_DIR, `save_${hash}.bak.json`),
    temp: path.join(SAVES_DIR, `save_${hash}.tmp.${process.pid}.${Date.now()}.json`),
  };
}

function enqueueKeyTask<T>(syncKey: string, task: () => Promise<T>): Promise<T> {
  const key = syncKey.toLowerCase();
  const prev = writeQueues.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(task);
  const tracked = next.finally(() => {
    if (writeQueues.get(key) === tracked) {
      writeQueues.delete(key);
    }
  });
  writeQueues.set(key, tracked);
  return next;
}

function isValidStoreShape(raw: unknown): raw is ServerSaveStoreShape {
  if (!raw || typeof raw !== 'object') return false;
  const s = raw as Partial<ServerSaveStoreShape>;
  if (s.version !== 2) return false;
  if (!s.activeSlotId || !isValidSlotId(s.activeSlotId)) return false;
  if (!s.profiles || typeof s.profiles !== 'object') return false;
  const p = s.profiles as Record<string, unknown>;
  return Boolean(
    p.slot1 &&
      typeof p.slot1 === 'object' &&
      p.slot2 &&
      typeof p.slot2 === 'object' &&
      p.slot3 &&
      typeof p.slot3 === 'object'
  );
}

async function tryParseEnvelopeFile(filePath: string): Promise<{
  envelope: ServerSaveEnvelope;
  bytes: number;
} | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<ServerSaveEnvelope>;
    if (
      !parsed ||
      parsed.format !== 'criptas-server-save' ||
      parsed.version !== 2 ||
      typeof parsed.checksum !== 'string' ||
      !isValidStoreShape(parsed.store)
    ) {
      return null;
    }
    const expected = sha256Hex(JSON.stringify(parsed.store));
    if (expected !== parsed.checksum) {
      return null;
    }
    return {
      envelope: parsed as ServerSaveEnvelope,
      bytes: Buffer.byteLength(raw, 'utf8'),
    };
  } catch {
    return null;
  }
}

export async function readServerSave(syncKey: string): Promise<ServerSaveReadResult> {
  const { primary, backup } = getFilePaths(syncKey);

  const primaryRes = await tryParseEnvelopeFile(primary);
  if (primaryRes) {
    return {
      found: true,
      recoveredFromBackup: false,
      updatedAtIso: primaryRes.envelope.updatedAtIso,
      checksum: primaryRes.envelope.checksum,
      bytes: primaryRes.bytes,
      store: primaryRes.envelope.store,
    };
  }

  const backupRes = await tryParseEnvelopeFile(backup);
  if (backupRes) {
    // Self-heal primary from valid backup
    try {
      await fs.mkdir(SAVES_DIR, { recursive: true });
      await fs.writeFile(primary, JSON.stringify(backupRes.envelope, null, 2), 'utf8');
    } catch {
      // ignore repair error
    }
    return {
      found: true,
      recoveredFromBackup: true,
      updatedAtIso: backupRes.envelope.updatedAtIso,
      checksum: backupRes.envelope.checksum,
      bytes: backupRes.bytes,
      store: backupRes.envelope.store,
    };
  }

  return { found: false };
}

export async function writeServerSave(
  syncKey: string,
  storeInput: unknown
): Promise<{ updatedAtIso: string; checksum: string; bytes: number }> {
  if (!isValidStoreShape(storeInput)) {
    throw new Error('Estructura de guardado inválida para el servidor.');
  }

  return enqueueKeyTask(syncKey, async () => {
    await fs.mkdir(SAVES_DIR, { recursive: true });
    const { primary, backup, temp } = getFilePaths(syncKey);

    const updatedAtIso =
      typeof storeInput.updatedAtIso === 'string' && storeInput.updatedAtIso
        ? storeInput.updatedAtIso
        : new Date().toISOString();

    const normalizedStore: ServerSaveStoreShape = {
      ...storeInput,
      version: 2,
      updatedAtIso,
    };

    const checksum = sha256Hex(JSON.stringify(normalizedStore));
    const envelope: ServerSaveEnvelope = {
      format: 'criptas-server-save',
      version: 2,
      syncKey,
      updatedAtIso,
      checksum,
      store: normalizedStore,
    };
    const serialized = JSON.stringify(envelope, null, 2);
    const bytes = Buffer.byteLength(serialized, 'utf8');

    // Rotate previous valid primary into .bak.json before atomic swap
    const existing = await tryParseEnvelopeFile(primary);
    if (existing) {
      await fs.copyFile(primary, backup).catch(() => undefined);
    }

    await fs.writeFile(temp, serialized, 'utf8');
    await fs.rename(temp, primary);

    return { updatedAtIso, checksum, bytes };
  });
}

function createEmptyDefaultStore(): ServerSaveStoreShape {
  const epoch = new Date(0).toISOString();
  const makeSlot = (id: ServerSaveSlotId, name: string) => ({
    id,
    name,
    updatedAtIso: epoch,
    meta: {
      soulShards: 0,
      blessings: { vitality: 0, might: 0, alacrity: 0, fortune: 0, flask: 0 },
      bestFloor: 0,
      totalKills: 0,
      unlockedClassTitles: [],
      recentRuns: [],
      muted: false,
    },
    activeRun: null,
  });

  return {
    version: 2,
    activeSlotId: 'slot1',
    updatedAtIso: epoch,
    profiles: {
      slot1: makeSlot('slot1', 'Crónica I'),
      slot2: makeSlot('slot2', 'Crónica II'),
      slot3: makeSlot('slot3', 'Crónica III'),
    },
  };
}

export async function writeServerSlot(
  syncKey: string,
  slotId: ServerSaveSlotId,
  profileInput: unknown
): Promise<{ updatedAtIso: string; checksum: string; bytes: number }> {
  if (!profileInput || typeof profileInput !== 'object') {
    throw new Error('Datos de ranura inválidos.');
  }

  const existing = await readServerSave(syncKey);
  const store = existing.found && existing.store ? existing.store : createEmptyDefaultStore();
  const nowIso = new Date().toISOString();
  store.updatedAtIso = nowIso;
  store.profiles[slotId] = {
    ...(profileInput as Record<string, unknown>),
    id: slotId,
    updatedAtIso: nowIso,
  };

  return writeServerSave(syncKey, store);
}

export async function deleteServerSave(syncKey: string): Promise<boolean> {
  return enqueueKeyTask(syncKey, async () => {
    const { primary, backup } = getFilePaths(syncKey);
    let removed = false;
    for (const file of [primary, backup]) {
      try {
        await fs.unlink(file);
        removed = true;
      } catch {
        // file may not exist
      }
    }
    return removed;
  });
}

export async function listServerSaves(): Promise<
  Array<{
    syncKey: string;
    updatedAtIso: string;
    activeSlotId: string;
    slotName: string;
    bestFloor: number;
    soulShards: number;
    totalKills: number;
    pvpElo: number;
    bytes: number;
  }>
> {
  try {
    const files = await fs.readdir(SAVES_DIR);
    const primaryFiles = files.filter(
      (f) => f.startsWith('save_') && f.endsWith('.json') && !f.includes('.bak.') && !f.includes('.tmp.')
    );
    const out: Array<{
      syncKey: string;
      updatedAtIso: string;
      activeSlotId: string;
      slotName: string;
      bestFloor: number;
      soulShards: number;
      totalKills: number;
      pvpElo: number;
      bytes: number;
    }> = [];
    for (const file of primaryFiles) {
      const parsed = await tryParseEnvelopeFile(path.join(SAVES_DIR, file));
      if (!parsed) continue;
      const env = parsed.envelope;
      const activeId = env.store.activeSlotId;
      const activeProf = env.store.profiles?.[activeId] as Record<string, unknown> | undefined;
      const meta = (activeProf?.meta as Record<string, unknown> | undefined) ?? {};
      out.push({
        syncKey: env.syncKey,
        updatedAtIso: env.updatedAtIso,
        activeSlotId: activeId,
        slotName: typeof activeProf?.name === 'string' ? activeProf.name : 'Crónica I',
        bestFloor: typeof meta.bestFloor === 'number' ? meta.bestFloor : 0,
        soulShards: typeof meta.soulShards === 'number' ? meta.soulShards : 0,
        totalKills: typeof meta.totalKills === 'number' ? meta.totalKills : 0,
        pvpElo: typeof meta.pvpElo === 'number' ? meta.pvpElo : 1000,
        bytes: parsed.bytes,
      });
    }
    return out.sort((a, b) => b.updatedAtIso.localeCompare(a.updatedAtIso));
  } catch {
    return [];
  }
}
