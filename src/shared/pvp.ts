import { ARCHETYPES } from '../data/gameData.ts';
import type {
  ActiveSkillId,
  ArchetypeId,
  ComputedStats,
  DungeonFloor,
  DungeonProp,
  PvpTierId,
  SkillSlotKey,
} from '../types/game.ts';

export const PVP_BASE_ELO = 1000;
export const PVP_MIN_ELO = 600;
export const PVP_K_FACTOR = 32;
export const PVP_BEST_OF = 3;
export const PVP_ROUNDS_TO_WIN = 2;
export const PVP_COUNTDOWN_SEC = 3;
export const PVP_ROUND_END_SEC = 2.5;
export const PVP_ROUND_DURATION_SEC = 60;
export const PVP_RING_SHRINK_START_SEC = 40;
export const PVP_ARENA_TILE_SIZE = 48;
export const PVP_ARENA_WIDTH_TILES = 27;
export const PVP_ARENA_HEIGHT_TILES = 21;

export const PVP_ARENA_CENTER = {
  x: 13.5 * PVP_ARENA_TILE_SIZE,
  y: 10.5 * PVP_ARENA_TILE_SIZE,
};

export const PVP_SPAWN_P1 = {
  x: 4.5 * PVP_ARENA_TILE_SIZE,
  y: 10.5 * PVP_ARENA_TILE_SIZE,
  facing: 0,
};

export const PVP_SPAWN_P2 = {
  x: 22.5 * PVP_ARENA_TILE_SIZE,
  y: 10.5 * PVP_ARENA_TILE_SIZE,
  facing: Math.PI,
};

export const PVP_RING_MAX_RADIUS = 12.2 * PVP_ARENA_TILE_SIZE;
export const PVP_RING_MIN_RADIUS = 2.4 * PVP_ARENA_TILE_SIZE;

export interface PvpTierInfo {
  id: PvpTierId;
  name: string;
  minElo: number;
  nextElo: number | null;
  color: string;
  title: string;
}

export const PVP_TIERS: PvpTierInfo[] = [
  {
    id: 'bronze',
    name: 'Bronce',
    minElo: 0,
    nextElo: 1015,
    color: '#CD7F32',
    title: 'Duelista de Bronce',
  },
  {
    id: 'silver',
    name: 'Plata',
    minElo: 1015,
    nextElo: 1150,
    color: '#CBD5E1',
    title: 'Centinela de Plata',
  },
  {
    id: 'gold',
    name: 'Oro',
    minElo: 1150,
    nextElo: 1325,
    color: '#F59E0B',
    title: 'Campeón de Oro',
  },
  {
    id: 'platinum',
    name: 'Platino',
    minElo: 1325,
    nextElo: 1525,
    color: '#2DD4BF',
    title: 'Verdugo de Platino',
  },
  {
    id: 'diamond',
    name: 'Diamante',
    minElo: 1525,
    nextElo: null,
    color: '#60A5FA',
    title: 'Soberano de Diamante',
  },
];

export function getPvpTierInfo(elo: number): PvpTierInfo {
  let matched = PVP_TIERS[0];
  for (const tier of PVP_TIERS) {
    if (elo >= tier.minElo) {
      matched = tier;
    }
  }
  return matched;
}

export function getPvpTierIndex(elo: number): number {
  let idx = 0;
  for (let i = 0; i < PVP_TIERS.length; i++) {
    if (elo >= PVP_TIERS[i].minElo) {
      idx = i;
    }
  }
  return idx;
}

export function didPvpRankIncrease(eloBefore: number, eloAfter: number): boolean {
  return eloAfter > eloBefore && getPvpTierIndex(eloAfter) > getPvpTierIndex(eloBefore);
}

export function calculateEloDelta(
  winnerElo: number,
  loserElo: number,
  kFactor = PVP_K_FACTOR
): {
  winnerDelta: number;
  loserDelta: number;
  winnerAfter: number;
  loserAfter: number;
} {
  const expectedWinner = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
  const rawGain = Math.max(6, Math.round(kFactor * (1 - expectedWinner)));
  const winnerAfter = winnerElo + rawGain;
  const loserAfter = Math.max(PVP_MIN_ELO, loserElo - rawGain);
  return {
    winnerDelta: rawGain,
    loserDelta: loserAfter - loserElo,
    winnerAfter,
    loserAfter,
  };
}

export const PVP_LOADOUTS: Record<
  ArchetypeId,
  {
    classTitle: string;
    skills: [ActiveSkillId, ActiveSkillId, ActiveSkillId];
    slots: Record<SkillSlotKey, ActiveSkillId>;
    maxHp: number;
    maxMana: number;
    armor: number;
    moveSpeed: number;
    baseDamage: number;
    arcanePower: number;
    attackSpeed: number;
    critChance: number;
    critMultiplier: number;
    dashCooldown: number;
    manaRegen: number;
  }
> = {
  crusader: {
    classTitle: 'Cruzado de Arena',
    skills: ['whirlwind', 'aegis', 'shadow_step'],
    slots: { Q: 'whirlwind', E: 'aegis', R: 'shadow_step' },
    maxHp: 390,
    maxMana: 90,
    armor: 16,
    moveSpeed: 204,
    baseDamage: 27,
    arcanePower: 14,
    attackSpeed: 1.0,
    critChance: 0.14,
    critMultiplier: 1.65,
    dashCooldown: 1.05,
    manaRegen: 6.5,
  },
  stalker: {
    classTitle: 'Acechador de Arena',
    skills: ['shadow_step', 'dagger_fan', 'whirlwind'],
    slots: { Q: 'shadow_step', E: 'dagger_fan', R: 'whirlwind' },
    maxHp: 325,
    maxMana: 95,
    armor: 10,
    moveSpeed: 228,
    baseDamage: 24,
    arcanePower: 16,
    attackSpeed: 1.18,
    critChance: 0.24,
    critMultiplier: 1.75,
    dashCooldown: 0.85,
    manaRegen: 7.2,
  },
  occultist: {
    classTitle: 'Ocultista de Arena',
    skills: ['abyss_lance', 'eclipse_nova', 'aegis'],
    slots: { Q: 'abyss_lance', E: 'eclipse_nova', R: 'aegis' },
    maxHp: 315,
    maxMana: 135,
    armor: 10,
    moveSpeed: 208,
    baseDamage: 16,
    arcanePower: 31,
    attackSpeed: 1.04,
    critChance: 0.16,
    critMultiplier: 1.68,
    dashCooldown: 1.0,
    manaRegen: 9.8,
  },
};

export function computePvpHeroStats(archetype: ArchetypeId): ComputedStats {
  const cfg = PVP_LOADOUTS[archetype] ?? PVP_LOADOUTS.crusader;
  return {
    maxHp: cfg.maxHp,
    maxMana: cfg.maxMana,
    armor: cfg.armor,
    moveSpeed: cfg.moveSpeed,
    baseDamage: cfg.baseDamage,
    arcanePower: cfg.arcanePower,
    attackSpeed: cfg.attackSpeed,
    critChance: cfg.critChance,
    critMultiplier: cfg.critMultiplier,
    lifesteal: 0.04,
    cooldownReduction: 0.08,
    dashCooldown: cfg.dashCooldown,
    flaskHealPct: 0.3,
    manaRegen: cfg.manaRegen,
    dashLeavesShadow: false,
    critChainArcane: false,
    bleedOnHit: archetype === 'stalker',
    manaShieldRatio: 0,
    killHeal: 0,
  };
}

export function getPvpStartingWeapon(archetype: ArchetypeId) {
  return structuredClone((ARCHETYPES[archetype] ?? ARCHETYPES.crusader).startingWeapon);
}

export function generatePvpArenaFloor(): DungeonFloor {
  const width = PVP_ARENA_WIDTH_TILES;
  const height = PVP_ARENA_HEIGHT_TILES;
  const tileSize = PVP_ARENA_TILE_SIZE;
  const tiles = new Uint8Array(width * height);
  const visibility = new Uint8Array(width * height);
  const wallDecor = new Uint8Array(width * height);

  visibility.fill(2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      wallDecor[idx] = (x * 7 + y * 13) % 16;

      // Outer obsidian boundary (2 tiles thick)
      if (x < 2 || x >= width - 2 || y < 2 || y >= height - 2) {
        tiles[idx] = 0;
        continue;
      }

      // Octagonal corners trimmed into walls for an arena colosseum silhouette
      const cornerLeft = x - 2;
      const cornerRight = width - 3 - x;
      const cornerTop = y - 2;
      const cornerBottom = height - 3 - y;
      if (
        cornerLeft + cornerTop < 2 ||
        cornerRight + cornerTop < 2 ||
        cornerLeft + cornerBottom < 2 ||
        cornerRight + cornerBottom < 2
      ) {
        tiles[idx] = 0;
        continue;
      }

      // Center dueling ring / accent border floor (tile type 2)
      const dx = x - 13;
      const dy = y - 10;
      const distSq = dx * dx + dy * dy;
      if (distSq <= 10 || (x >= 12 && x <= 14 && (y === 3 || y === 17))) {
        tiles[idx] = 2;
      } else {
        tiles[idx] = 1;
      }
    }
  }

  // 4 Symmetric basalt cover pillars
  const pillars: Array<[number, number]> = [
    [7, 6],
    [18, 6],
    [7, 13],
    [18, 13],
  ];
  for (const [px, py] of pillars) {
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        tiles[(py + dy) * width + (px + dx)] = 0;
      }
    }
  }

  const props: DungeonProp[] = [
    { id: 'arena_brazier_1', kind: 'brazier', x: 3.5 * tileSize, y: 4.5 * tileSize, radius: 12, interacted: false, broken: false },
    { id: 'arena_brazier_2', kind: 'brazier', x: 23.5 * tileSize, y: 4.5 * tileSize, radius: 12, interacted: false, broken: false },
    { id: 'arena_brazier_3', kind: 'brazier', x: 3.5 * tileSize, y: 16.5 * tileSize, radius: 12, interacted: false, broken: false },
    { id: 'arena_brazier_4', kind: 'brazier', x: 23.5 * tileSize, y: 16.5 * tileSize, radius: 12, interacted: false, broken: false },
  ];

  return {
    floorNumber: 1,
    name: 'Coliseo del Eclipse',
    width,
    height,
    tileSize,
    tiles,
    visibility,
    wallDecor,
    rooms: [
      {
        id: 0,
        x: 2,
        y: 2,
        w: width - 4,
        h: height - 4,
        cx: 13,
        cy: 10,
        type: 'boss',
        cleared: false,
        discovered: true,
      },
    ],
    props,
    spawnX: PVP_SPAWN_P1.x,
    spawnY: PVP_SPAWN_P1.y,
    bossRoomId: 0,
  };
}
