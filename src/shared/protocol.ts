export const APP_VERSION = '2.4.0';

export type VersionCompatibility = 'ok' | 'minor_mismatch' | 'major_mismatch';

export interface ParsedSemVer {
  major: number;
  minor: number;
  patch: number;
}

export interface VersionCheckResult {
  status: VersionCompatibility;
  compatible: boolean;
  clientVersion: string;
  serverVersion: string;
  message: string | null;
}

export function parseSemVer(version: string): ParsedSemVer | null {
  const clean = (version || '').trim().replace(/^v/i, '');
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(clean);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function compareVersions(clientVersion: string, serverVersion: string): VersionCheckResult {
  const client = parseSemVer(clientVersion);
  const server = parseSemVer(serverVersion);

  if (!client || !server) {
    return {
      status: 'major_mismatch',
      compatible: false,
      clientVersion,
      serverVersion,
      message: `Versión inválida (cliente v${clientVersion || '?'} / servidor v${serverVersion || '?'}).`,
    };
  }

  if (client.major !== server.major) {
    return {
      status: 'major_mismatch',
      compatible: false,
      clientVersion,
      serverVersion,
      message: `Versión mayor incompatible: tu cliente es v${clientVersion} y el servidor usa v${serverVersion}. Actualiza o recarga la aplicación para entrar.`,
    };
  }

  if (client.minor !== server.minor || client.patch !== server.patch) {
    return {
      status: 'minor_mismatch',
      compatible: true,
      clientVersion,
      serverVersion,
      message: `Versión menor distinta (cliente v${clientVersion} · servidor v${serverVersion}). Conexión permitida.`,
    };
  }

  return {
    status: 'ok',
    compatible: true,
    clientVersion,
    serverVersion,
    message: null,
  };
}

const SEED_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface NormalizedSeed {
  label: string;
  numeric: number;
}

export function hashSeedString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) || 0x13572468;
}

export function normalizeSeedInput(raw: string): NormalizedSeed {
  const trimmed = (raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!trimmed) {
    return generateRandomRunSeed();
  }
  if (/^\d+$/.test(trimmed)) {
    const numeric = (Number(trimmed) >>> 0) || 1;
    return { label: String(numeric), numeric };
  }
  return {
    label: trimmed.slice(0, 20),
    numeric: hashSeedString(trimmed),
  };
}

export function generateRandomRunSeed(): NormalizedSeed {
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += SEED_ALPHABET[Math.floor(Math.random() * SEED_ALPHABET.length)];
  }
  const label = `ECLIPSE-${suffix}`;
  return {
    label,
    numeric: hashSeedString(label),
  };
}

export function deriveFloorSeed(baseSeed: number, floorNumber: number): number {
  let mixed = (baseSeed ^ Math.imul(floorNumber + 1, 0x9e3779b1)) >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x85ebca6b) >>> 0;
  mixed ^= mixed >>> 13;
  return (mixed >>> 0) || 1;
}

export function createSeededRng(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
