import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  PVP_BASE_ELO,
  PVP_K_FACTOR,
  calculateEloDelta,
  getPvpTierInfo,
} from '../shared/pvp.ts';
import type { PvpLeaderboardEntry, PvpMatchHistoryEntry } from '../types/coop.ts';
import type { ArchetypeId } from '../types/game.ts';

interface PvpDatabaseShape {
  version: 1;
  updatedAtIso: string;
  players: Record<string, PvpLeaderboardEntry>;
  recentMatches: PvpMatchHistoryEntry[];
}

interface PvpDatabaseEnvelope {
  format: 'criptas-pvp-leaderboard';
  version: 1;
  updatedAtIso: string;
  checksum: string;
  data: PvpDatabaseShape;
}

const SAVES_DIR = path.resolve(process.cwd(), '.saves');
const PRIMARY_FILE = path.join(SAVES_DIR, 'pvp_leaderboard.json');
const BACKUP_FILE = path.join(SAVES_DIR, 'pvp_leaderboard.bak.json');

let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.catch(() => undefined).then(task);
  queue = next.catch(() => undefined);
  return next;
}

function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function normalizePlayerKey(raw: string): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, '')
    .slice(0, 48);
  return cleaned.length >= 4 ? cleaned : `ANON-${sha256Hex(String(raw || 'anon')).slice(0, 8).toUpperCase()}`;
}

function sanitizeName(raw: string, fallback = 'Duelista'): string {
  const cleaned = String(raw || '').trim().slice(0, 20);
  return cleaned || fallback;
}

function createEmptyDb(): PvpDatabaseShape {
  return {
    version: 1,
    updatedAtIso: new Date().toISOString(),
    players: {},
    recentMatches: [],
  };
}

function createDefaultPlayerEntry(
  playerKey: string,
  name = 'Duelista',
  archetype: ArchetypeId = 'crusader'
): PvpLeaderboardEntry {
  const tier = getPvpTierInfo(PVP_BASE_ELO);
  return {
    playerKey,
    name: sanitizeName(name),
    elo: PVP_BASE_ELO,
    tierId: tier.id,
    tierName: tier.name,
    tierColor: tier.color,
    wins: 0,
    losses: 0,
    winStreak: 0,
    bestStreak: 0,
    favoriteArchetype: archetype,
    unlockedTitles: ['Duelista de Bronce'],
    updatedAtIso: new Date().toISOString(),
  };
}

async function tryReadEnvelope(filePath: string): Promise<PvpDatabaseShape | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PvpDatabaseEnvelope>;
    if (
      !parsed ||
      parsed.format !== 'criptas-pvp-leaderboard' ||
      parsed.version !== 1 ||
      typeof parsed.checksum !== 'string' ||
      !parsed.data ||
      typeof parsed.data !== 'object'
    ) {
      return null;
    }
    const expected = sha256Hex(JSON.stringify(parsed.data));
    if (expected !== parsed.checksum) {
      return null;
    }
    const db = parsed.data;
    return {
      version: 1,
      updatedAtIso: typeof db.updatedAtIso === 'string' ? db.updatedAtIso : new Date().toISOString(),
      players: db.players && typeof db.players === 'object' ? db.players : {},
      recentMatches: Array.isArray(db.recentMatches) ? db.recentMatches.slice(0, 40) : [],
    };
  } catch {
    return null;
  }
}

async function readDbUnsafe(): Promise<PvpDatabaseShape> {
  const primary = await tryReadEnvelope(PRIMARY_FILE);
  if (primary) return primary;

  const backup = await tryReadEnvelope(BACKUP_FILE);
  if (backup) {
    await writeDbUnsafe(backup).catch(() => undefined);
    return backup;
  }

  return createEmptyDb();
}

async function writeDbUnsafe(db: PvpDatabaseShape): Promise<void> {
  await fs.mkdir(SAVES_DIR, { recursive: true });
  const normalized: PvpDatabaseShape = {
    version: 1,
    updatedAtIso: new Date().toISOString(),
    players: db.players,
    recentMatches: db.recentMatches.slice(0, 40),
  };
  const checksum = sha256Hex(JSON.stringify(normalized));
  const envelope: PvpDatabaseEnvelope = {
    format: 'criptas-pvp-leaderboard',
    version: 1,
    updatedAtIso: normalized.updatedAtIso,
    checksum,
    data: normalized,
  };
  const serialized = JSON.stringify(envelope, null, 2);

  const existing = await tryReadEnvelope(PRIMARY_FILE);
  if (existing) {
    await fs.copyFile(PRIMARY_FILE, BACKUP_FILE).catch(() => undefined);
  }

  const tempFile = path.join(SAVES_DIR, `pvp_leaderboard.tmp.${process.pid}.${Date.now()}.json`);
  await fs.writeFile(tempFile, serialized, 'utf8');
  await fs.rename(tempFile, PRIMARY_FILE);
}

export async function getPvpLeaderboard(limit = 30): Promise<{
  entries: PvpLeaderboardEntry[];
  recentMatches: PvpMatchHistoryEntry[];
}> {
  const db = await readDbUnsafe();
  const entries = Object.values(db.players)
    .sort((a, b) => {
      if (b.elo !== a.elo) return b.elo - a.elo;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return a.losses - b.losses;
    })
    .slice(0, Math.max(1, limit));

  return {
    entries,
    recentMatches: db.recentMatches.slice(0, 20),
  };
}

export async function getPvpPlayerStanding(
  rawKey: string,
  playerName?: string
): Promise<PvpLeaderboardEntry> {
  const key = normalizePlayerKey(rawKey);
  const db = await readDbUnsafe();
  const existing = db.players[key];
  if (existing) {
    const tier = getPvpTierInfo(existing.elo);
    return {
      ...existing,
      tierId: tier.id,
      tierName: tier.name,
      tierColor: tier.color,
    };
  }
  return createDefaultPlayerEntry(key, playerName);
}

export async function recordPvpMatchOutcome(params: {
  winnerKey: string;
  winnerName: string;
  winnerArchetype: ArchetypeId;
  loserKey: string;
  loserName: string;
  loserArchetype: ArchetypeId;
  score: string;
}): Promise<{
  winner: PvpLeaderboardEntry;
  loser: PvpLeaderboardEntry;
  winnerBefore: number;
  loserBefore: number;
  winnerDelta: number;
  loserDelta: number;
  winnerNewTitle: string | null;
  loserNewTitle: string | null;
  winnerSouls: number;
  loserSouls: number;
}> {
  return enqueue(async () => {
    const db = await readDbUnsafe();
    const wKey = normalizePlayerKey(params.winnerKey);
    const lKey = normalizePlayerKey(params.loserKey);

    const prevWinner =
      db.players[wKey] ?? createDefaultPlayerEntry(wKey, params.winnerName, params.winnerArchetype);
    const prevLoser =
      db.players[lKey] ?? createDefaultPlayerEntry(lKey, params.loserName, params.loserArchetype);

    const winnerBefore = prevWinner.elo;
    const loserBefore = prevLoser.elo;
    const { winnerDelta, loserDelta, winnerAfter, loserAfter } = calculateEloDelta(
      winnerBefore,
      loserBefore,
      PVP_K_FACTOR
    );

    const winnerTier = getPvpTierInfo(winnerAfter);
    const loserTier = getPvpTierInfo(loserAfter);
    const nowIso = new Date().toISOString();

    const winnerTitles = new Set(prevWinner.unlockedTitles);
    let winnerNewTitle: string | null = null;
    if (!winnerTitles.has(winnerTier.title)) {
      winnerTitles.add(winnerTier.title);
      winnerNewTitle = winnerTier.title;
    }

    const nextWinStreak = prevWinner.winStreak + 1;
    if (nextWinStreak >= 3 && !winnerTitles.has('Imparable del Coliseo')) {
      winnerTitles.add('Imparable del Coliseo');
      winnerNewTitle = winnerNewTitle ?? 'Imparable del Coliseo';
    }

    const loserTitles = new Set(prevLoser.unlockedTitles);
    let loserNewTitle: string | null = null;
    if (!loserTitles.has(loserTier.title)) {
      loserTitles.add(loserTier.title);
      loserNewTitle = loserTier.title;
    }

    const updatedWinner: PvpLeaderboardEntry = {
      playerKey: wKey,
      name: sanitizeName(params.winnerName, prevWinner.name),
      elo: winnerAfter,
      tierId: winnerTier.id,
      tierName: winnerTier.name,
      tierColor: winnerTier.color,
      wins: prevWinner.wins + 1,
      losses: prevWinner.losses,
      winStreak: nextWinStreak,
      bestStreak: Math.max(prevWinner.bestStreak, nextWinStreak),
      favoriteArchetype: params.winnerArchetype,
      unlockedTitles: Array.from(winnerTitles),
      updatedAtIso: nowIso,
    };

    const updatedLoser: PvpLeaderboardEntry = {
      playerKey: lKey,
      name: sanitizeName(params.loserName, prevLoser.name),
      elo: loserAfter,
      tierId: loserTier.id,
      tierName: loserTier.name,
      tierColor: loserTier.color,
      wins: prevLoser.wins,
      losses: prevLoser.losses + 1,
      winStreak: 0,
      bestStreak: prevLoser.bestStreak,
      favoriteArchetype: params.loserArchetype,
      unlockedTitles: Array.from(loserTitles),
      updatedAtIso: nowIso,
    };

    db.players[wKey] = updatedWinner;
    db.players[lKey] = updatedLoser;

    const historyItem: PvpMatchHistoryEntry = {
      id: `pvp_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      timestampIso: nowIso,
      winnerKey: wKey,
      winnerName: updatedWinner.name,
      winnerArchetype: params.winnerArchetype,
      loserKey: lKey,
      loserName: updatedLoser.name,
      loserArchetype: params.loserArchetype,
      score: params.score,
      winnerEloAfter: winnerAfter,
      loserEloAfter: loserAfter,
      eloDelta: winnerDelta,
    };
    db.recentMatches = [historyItem, ...db.recentMatches].slice(0, 40);

    await writeDbUnsafe(db);

    const winnerSouls = 35 + Math.min(25, (nextWinStreak - 1) * 5);
    const loserSouls = 12;

    return {
      winner: updatedWinner,
      loser: updatedLoser,
      winnerBefore,
      loserBefore,
      winnerDelta,
      loserDelta,
      winnerNewTitle,
      loserNewTitle,
      winnerSouls,
      loserSouls,
    };
  });
}

export async function adminUpdatePvpLeaderboardPlayer(
  rawKey: string,
  patch: {
    name?: string;
    elo?: number;
    wins?: number;
    losses?: number;
    winStreak?: number;
    reset?: boolean;
  }
): Promise<PvpLeaderboardEntry> {
  return enqueue(async () => {
    const db = await readDbUnsafe();
    const key = normalizePlayerKey(rawKey);
    const existing = db.players[key] ?? createDefaultPlayerEntry(key, patch.name || 'Duelista');
    const nowIso = new Date().toISOString();

    if (patch.reset) {
      const resetTier = getPvpTierInfo(PVP_BASE_ELO);
      const resetEntry: PvpLeaderboardEntry = {
        ...existing,
        elo: PVP_BASE_ELO,
        tierId: resetTier.id,
        tierName: resetTier.name,
        tierColor: resetTier.color,
        wins: 0,
        losses: 0,
        winStreak: 0,
        bestStreak: 0,
        unlockedTitles: ['Duelista de Bronce'],
        updatedAtIso: nowIso,
      };
      db.players[key] = resetEntry;
      await writeDbUnsafe(db);
      return resetEntry;
    }

    const nextElo =
      typeof patch.elo === 'number' && Number.isFinite(patch.elo)
        ? Math.max(600, Math.min(3500, Math.round(patch.elo)))
        : existing.elo;
    const nextWins =
      typeof patch.wins === 'number' && Number.isFinite(patch.wins)
        ? Math.max(0, Math.round(patch.wins))
        : existing.wins;
    const nextLosses =
      typeof patch.losses === 'number' && Number.isFinite(patch.losses)
        ? Math.max(0, Math.round(patch.losses))
        : existing.losses;
    const nextStreak =
      typeof patch.winStreak === 'number' && Number.isFinite(patch.winStreak)
        ? Math.max(0, Math.round(patch.winStreak))
        : existing.winStreak;

    const nextTier = getPvpTierInfo(nextElo);
    const titles = new Set(existing.unlockedTitles);
    titles.add(nextTier.title);

    const updated: PvpLeaderboardEntry = {
      ...existing,
      name: patch.name !== undefined ? sanitizeName(patch.name, existing.name) : existing.name,
      elo: nextElo,
      tierId: nextTier.id,
      tierName: nextTier.name,
      tierColor: nextTier.color,
      wins: nextWins,
      losses: nextLosses,
      winStreak: nextStreak,
      bestStreak: Math.max(existing.bestStreak, nextStreak),
      unlockedTitles: Array.from(titles),
      updatedAtIso: nowIso,
    };

    db.players[key] = updated;
    await writeDbUnsafe(db);
    return updated;
  });
}

export async function adminDeletePvpPlayer(rawKey: string): Promise<boolean> {
  return enqueue(async () => {
    const db = await readDbUnsafe();
    const key = normalizePlayerKey(rawKey);
    if (!db.players[key]) return false;
    delete db.players[key];
    await writeDbUnsafe(db);
    return true;
  });
}

export async function adminResetPvpLeaderboard(): Promise<void> {
  return enqueue(async () => {
    await writeDbUnsafe(createEmptyDb());
  });
}
