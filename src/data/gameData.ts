import {
  ActiveSkillDef,
  ActiveSkillId,
  ArchetypeDef,
  ArchetypeId,
  BlessingId,
  ComputedStats,
  EternalBlessingDef,
  ItemData,
  MetaSaveData,
  Rarity,
  SkillTreeNode,
  WeaponKind,
} from '../types/game';

export const ARCHETYPES: Record<ArchetypeId, ArchetypeDef> = {
  crusader: {
    id: 'crusader',
    name: 'Cruzado de Hierro',
    subtitle: 'Vanguardia · Acero y Bastión',
    description:
      'Guerrero acorazado que barre hordas con amplios tajos de espadón y resiste embestidas mediante escudos óseos.',
    primaryBranch: 'steel',
    accentColor: '#DC2626',
    startingNodeId: 'steel_1',
    startingSkills: ['whirlwind', 'aegis', null],
    startingWeapon: {
      id: 'starter_greatsword',
      name: 'Espadón de Hierro Frío',
      slot: 'weapon',
      weaponKind: 'greatsword',
      rarity: 'common',
      level: 1,
      description: 'Hoja ancha de acero templado con gran arco de barrido.',
      stats: { damageBonus: 12, maxHpBonus: 20 },
      valueGold: 25,
    },
    baseStats: {
      maxHp: 150,
      maxMana: 65,
      armor: 14,
      moveSpeed: 215,
      baseDamage: 24,
      arcanePower: 10,
      attackSpeed: 1.0,
      critChance: 0.1,
      critMultiplier: 1.65,
    },
  },
  stalker: {
    id: 'stalker',
    name: 'Acechador Sombrío',
    subtitle: 'Letalidad · Sombra y Crítico',
    description:
      'Asesino ágil de las criptas que encadena golpes críticos veloces, hemorragias y desplazamientos entre sombras.',
    primaryBranch: 'shadow',
    accentColor: '#10B981',
    startingNodeId: 'shadow_1',
    startingSkills: ['shadow_step', 'dagger_fan', null],
    startingWeapon: {
      id: 'starter_daggers',
      name: 'Dagas Gemelas de Ceniza',
      slot: 'weapon',
      weaponKind: 'daggers',
      rarity: 'common',
      level: 1,
      description: 'Cuchillas ligeras ideales para ráfagas rápidas y estocadas críticas.',
      stats: { damageBonus: 8, attackSpeedBonus: 0.25, critChanceBonus: 0.08 },
      valueGold: 25,
    },
    baseStats: {
      maxHp: 115,
      maxMana: 75,
      armor: 6,
      moveSpeed: 248,
      baseDamage: 20,
      arcanePower: 14,
      attackSpeed: 1.22,
      critChance: 0.18,
      critMultiplier: 1.85,
    },
  },
  occultist: {
    id: 'occultist',
    name: 'Ocultista Abisal',
    subtitle: 'Arcano · Vacío y Drenaje',
    description:
      'Erudito de artes prohibidas que desata lanzas perforantes del abismo, novas eclipsadas y drenaje vital.',
    primaryBranch: 'arcane',
    accentColor: '#8B5CF6',
    startingNodeId: 'arcane_1',
    startingSkills: ['abyss_lance', 'eclipse_nova', null],
    startingWeapon: {
      id: 'starter_staff',
      name: 'Báculo de Obsidiana',
      slot: 'weapon',
      weaponKind: 'staff',
      rarity: 'common',
      level: 1,
      description: 'Canaliza energía del vacío en descargas arcanas a distancia.',
      stats: { damageBonus: 7, arcaneBonus: 14, maxManaBonus: 20 },
      valueGold: 25,
    },
    baseStats: {
      maxHp: 105,
      maxMana: 115,
      armor: 5,
      moveSpeed: 224,
      baseDamage: 16,
      arcanePower: 26,
      attackSpeed: 1.05,
      critChance: 0.12,
      critMultiplier: 1.7,
    },
  },
};

export const ACTIVE_SKILLS: Record<ActiveSkillId, ActiveSkillDef> = {
  whirlwind: {
    id: 'whirlwind',
    name: 'Tajo Torbellino',
    branch: 'steel',
    manaCost: 18,
    cooldown: 4.5,
    description: 'Gira con tu arma infligiendo 185% de daño físico en 360° y empujando enemigos.',
    color: '#EF4444',
  },
  aegis: {
    id: 'aegis',
    name: 'Égida de Hueso',
    branch: 'steel',
    manaCost: 22,
    cooldown: 8.0,
    description: 'Genera un escudo protector equivalente al 35% de tu vida máxima durante 5s y libera una onda.',
    color: '#F59E0B',
  },
  shadow_step: {
    id: 'shadow_step',
    name: 'Paso de Sombra',
    branch: 'shadow',
    manaCost: 16,
    cooldown: 4.0,
    description: 'Teletranspórtate hacia el cursor dejando una explosión sombría y garantizando crítico en el siguiente golpe.',
    color: '#10B981',
  },
  dagger_fan: {
    id: 'dagger_fan',
    name: 'Lluvia de Dagas',
    branch: 'shadow',
    manaCost: 18,
    cooldown: 4.8,
    description: 'Lanza 5 dagas en abanico que perforan ligeramente y aplican sangrado continuo.',
    color: '#34D399',
  },
  abyss_lance: {
    id: 'abyss_lance',
    name: 'Lanza del Abismo',
    branch: 'arcane',
    manaCost: 20,
    cooldown: 3.8,
    description: 'Dispara un rayo perforante de energía abisal que atraviesa filas enemigas y ralentiza.',
    color: '#8B5CF6',
  },
  eclipse_nova: {
    id: 'eclipse_nova',
    name: 'Nova del Eclipse',
    branch: 'arcane',
    manaCost: 28,
    cooldown: 7.5,
    description: 'Detona un anillo gravitatorio a tu alrededor que daña en área y te cura por cada enemigo golpeado.',
    color: '#A78BFA',
  },
};

export const SKILL_TREE_NODES: SkillTreeNode[] = [
  {
    id: 'origin',
    name: 'Despertar del Eclipse',
    branch: 'origin',
    tier: 0,
    x: 400,
    y: 300,
    requires: [],
    description: 'Núcleo central que conecta todas las sendas. +10 Vida, +10 Maná, +4 Daño.',
    statBonuses: { maxHpBonus: 10, maxManaBonus: 10, damageBonus: 4 },
  },
  // STEEL BRANCH (Upper Left)
  {
    id: 'steel_1',
    name: 'Senda del Acero',
    branch: 'steel',
    tier: 1,
    x: 295,
    y: 230,
    requires: ['origin'],
    description: 'Base de vanguardia. +25 Vida máxima, +5 Armadura y desbloquea Tajo Torbellino.',
    unlocksSkill: 'whirlwind',
    statBonuses: { maxHpBonus: 25, armorBonus: 5 },
  },
  {
    id: 'steel_2',
    name: 'Templado Carmesí',
    branch: 'steel',
    tier: 2,
    x: 205,
    y: 165,
    requires: ['steel_1'],
    description: '+10 Daño físico y +5% Probabilidad crítica.',
    statBonuses: { damageBonus: 10, critChanceBonus: 0.05 },
  },
  {
    id: 'steel_guard',
    name: 'Bastión de Hueso',
    branch: 'steel',
    tier: 2,
    x: 175,
    y: 270,
    requires: ['steel_1'],
    description: '+8 Armadura, +30 Vida y desbloquea Égida de Hueso.',
    unlocksSkill: 'aegis',
    statBonuses: { armorBonus: 8, maxHpBonus: 30 },
  },
  {
    id: 'steel_3',
    name: 'Sed de Batalla',
    branch: 'steel',
    tier: 3,
    x: 115,
    y: 115,
    requires: ['steel_2'],
    description: '+5% Robo de vida con golpes cuerpo a cuerpo y +8 Daño.',
    statBonuses: { lifestealBonus: 0.05, damageBonus: 8 },
  },
  {
    id: 'steel_cap',
    name: 'Coloso Imparable',
    branch: 'steel',
    tier: 4,
    x: 80,
    y: 215,
    requires: ['steel_guard', 'steel_3'],
    description: 'Maestría de Acero: +50 Vida, +10 Armadura y +14 Daño base.',
    statBonuses: { maxHpBonus: 50, armorBonus: 10, damageBonus: 14 },
  },

  // SHADOW BRANCH (Upper Right)
  {
    id: 'shadow_1',
    name: 'Senda de la Sombra',
    branch: 'shadow',
    tier: 1,
    x: 505,
    y: 230,
    requires: ['origin'],
    description: 'Base de sigilo letal. +18 Velocidad, +6% Crítico y desbloquea Paso de Sombra.',
    unlocksSkill: 'shadow_step',
    statBonuses: { moveSpeedBonus: 18, critChanceBonus: 0.06 },
  },
  {
    id: 'shadow_2',
    name: 'Acero Envenenado',
    branch: 'shadow',
    tier: 2,
    x: 595,
    y: 165,
    requires: ['shadow_1'],
    description: '+15% Velocidad de ataque y tus golpes provocan sangrado prolongado.',
    statBonuses: { attackSpeedBonus: 0.15, bleedOnHit: true },
  },
  {
    id: 'shadow_fan',
    name: 'Danza de Cuchillas',
    branch: 'shadow',
    tier: 2,
    x: 625,
    y: 270,
    requires: ['shadow_1'],
    description: '+12% Velocidad de ataque y desbloquea Lluvia de Dagas.',
    unlocksSkill: 'dagger_fan',
    statBonuses: { attackSpeedBonus: 0.12, damageBonus: 6 },
  },
  {
    id: 'shadow_3',
    name: 'Ejecutor Silencioso',
    branch: 'shadow',
    tier: 3,
    x: 685,
    y: 115,
    requires: ['shadow_2'],
    description: '+8% Probabilidad crítica y +35% Multiplicador de daño crítico.',
    statBonuses: { critChanceBonus: 0.08, critMultBonus: 0.35 },
  },
  {
    id: 'shadow_cap',
    name: 'Espectro Letal',
    branch: 'shadow',
    tier: 4,
    x: 720,
    y: 215,
    requires: ['shadow_fan', 'shadow_3'],
    description: 'Maestría de Sombra: Esquivar deja un señuelo explosivo y +25 Velocidad.',
    statBonuses: { dashLeavesShadow: true, moveSpeedBonus: 25, critChanceBonus: 0.07 },
  },

  // ARCANE BRANCH (Bottom)
  {
    id: 'arcane_1',
    name: 'Senda del Arcano',
    branch: 'arcane',
    tier: 1,
    x: 400,
    y: 405,
    requires: ['origin'],
    description: 'Base abisal. +25 Maná, +10 Poder Arcano y desbloquea Lanza del Abismo.',
    unlocksSkill: 'abyss_lance',
    statBonuses: { maxManaBonus: 25, arcaneBonus: 10 },
  },
  {
    id: 'arcane_2',
    name: 'Flujo del Vacío',
    branch: 'arcane',
    tier: 2,
    x: 315,
    y: 470,
    requires: ['arcane_1'],
    description: '+12% Reducción de enfriamiento y +20 Maná máximo.',
    statBonuses: { cooldownReduction: 0.12, maxManaBonus: 20 },
  },
  {
    id: 'arcane_nova',
    name: 'Corazón de Eclipse',
    branch: 'arcane',
    tier: 2,
    x: 485,
    y: 470,
    requires: ['arcane_1'],
    description: '+12 Poder Arcano y desbloquea Nova del Eclipse.',
    unlocksSkill: 'eclipse_nova',
    statBonuses: { arcaneBonus: 12, maxHpBonus: 15 },
  },
  {
    id: 'arcane_3',
    name: 'Pacto Sanguíneo',
    branch: 'arcane',
    tier: 3,
    x: 245,
    y: 545,
    requires: ['arcane_2'],
    description: 'Cura 8 de vida al matar enemigos y +10 Poder Arcano.',
    statBonuses: { killHeal: 8, arcaneBonus: 10 },
  },
  {
    id: 'arcane_cap',
    name: 'Arconte Abisal',
    branch: 'arcane',
    tier: 4,
    x: 555,
    y: 545,
    requires: ['arcane_nova'],
    description: 'Maestría Arcana: Los golpes críticos desatan chispas arcanas encadenadas.',
    statBonuses: { critChainArcane: true, arcaneBonus: 16, cooldownReduction: 0.08 },
  },

  // HYBRID BRIDGES
  {
    id: 'hybrid_steel_shadow',
    name: 'Filo Sangriento',
    branch: 'hybrid',
    tier: 3,
    x: 400,
    y: 140,
    requires: ['steel_2', 'shadow_2'],
    description: 'Puente Acero–Sombra: +12 Daño físico, +6% Crítico y +4% Robo de vida.',
    statBonuses: { damageBonus: 12, critChanceBonus: 0.06, lifestealBonus: 0.04 },
  },
  {
    id: 'hybrid_steel_arcane',
    name: 'Armadura Rúnica',
    branch: 'hybrid',
    tier: 3,
    x: 245,
    y: 365,
    requires: ['steel_1', 'arcane_1'],
    description: 'Puente Acero–Arcano: Convierte 25% de tu Maná máximo en Armadura y +10 Daño.',
    statBonuses: { manaShieldRatio: 0.25, damageBonus: 10, maxManaBonus: 20 },
  },
  {
    id: 'hybrid_shadow_arcane',
    name: 'Velo Etéreo',
    branch: 'hybrid',
    tier: 3,
    x: 555,
    y: 365,
    requires: ['shadow_1', 'arcane_1'],
    description: 'Puente Sombra–Arcano: +12% Velocidad de ataque, +10 Poder Arcano y +10% Reducción CD.',
    statBonuses: { attackSpeedBonus: 0.12, arcaneBonus: 10, cooldownReduction: 0.1 },
  },
  {
    id: 'eclipse_apex',
    name: 'Heraldo del Eclipse',
    branch: 'hybrid',
    tier: 4,
    x: 400,
    y: 62,
    requires: ['hybrid_steel_shadow', 'steel_3', 'shadow_3'],
    description: 'Convergencia Suprema: +15 Daño, +15 Poder Arcano, +8% Crítico y +30 Vida.',
    statBonuses: {
      damageBonus: 15,
      arcaneBonus: 15,
      critChanceBonus: 0.08,
      maxHpBonus: 30,
    },
  },
];

export const ETERNAL_BLESSINGS: EternalBlessingDef[] = [
  {
    id: 'vitality',
    name: 'Vitalidad Ancestral',
    description: 'Aumenta tu vida máxima inicial en cada incursión.',
    maxLevel: 6,
    baseCost: 12,
    costStep: 10,
    bonusPerLevelLabel: '+15 Vida máxima',
  },
  {
    id: 'might',
    name: 'Temple del Eclipse',
    description: 'Potencia todo tu daño físico y poder arcano base.',
    maxLevel: 6,
    baseCost: 15,
    costStep: 12,
    bonusPerLevelLabel: '+4 Daño y +4 Arcano',
  },
  {
    id: 'alacrity',
    name: 'Paso de Ceniza',
    description: 'Incrementa tu agilidad de desplazamiento y acelera enfriamientos.',
    maxLevel: 5,
    baseCost: 14,
    costStep: 12,
    bonusPerLevelLabel: '+6 Vel. mov. · +3% Red. CD',
  },
  {
    id: 'fortune',
    name: 'Ojo de Reliquia',
    description: 'Mejora la rareza del botín encontrado y los Fragmentos de Alma obtenidos.',
    maxLevel: 5,
    baseCost: 16,
    costStep: 14,
    bonusPerLevelLabel: '+12% Botín y Almas',
  },
  {
    id: 'flask',
    name: 'Frasco Carmesí Reforzado',
    description: 'Aumenta la curación de tus frascos y añade cargas máximas en niveles altos.',
    maxLevel: 4,
    baseCost: 18,
    costStep: 15,
    bonusPerLevelLabel: '+8% Curación (+1 carga nv. 2 y 4)',
  },
];

export function getBlessingCost(def: EternalBlessingDef, currentLevel: number): number {
  return def.baseCost + currentLevel * def.costStep;
}

export function computeHybridClassTitle(
  archetype: ArchetypeId,
  unlockedNodeIds: string[]
): string {
  let steel = 0;
  let shadow = 0;
  let arcane = 0;
  let hybrids = 0;

  for (const id of unlockedNodeIds) {
    const node = SKILL_TREE_NODES.find((n) => n.id === id);
    if (!node) continue;
    if (node.branch === 'steel') steel++;
    else if (node.branch === 'shadow') shadow++;
    else if (node.branch === 'arcane') arcane++;
    else if (node.branch === 'hybrid') hybrids++;
  }

  const activeBranches = [steel > 0, shadow > 0, arcane > 0].filter(Boolean).length;
  if (activeBranches === 3 && (hybrids >= 2 || unlockedNodeIds.includes('eclipse_apex'))) {
    return 'Avatar del Eclipse';
  }
  if (steel >= 2 && shadow >= 2 && arcane === 0) return 'Verdugo Carmesí';
  if (steel >= 2 && arcane >= 2 && shadow === 0) return 'Paladín Abisal';
  if (shadow >= 2 && arcane >= 2 && steel === 0) return 'Hoja Espectral';
  if (steel >= 2 && shadow >= 1 && arcane >= 1) return 'Inquisidor del Vacío';
  if (shadow >= 2 && arcane >= 1 && steel >= 1) return 'Segador de Ceniza';
  if (arcane >= 2 && steel >= 1 && shadow >= 1) return 'Tejedor Rúnico';

  if (steel >= 4) return 'Señor del Bastión';
  if (shadow >= 4) return 'Sombra Soberana';
  if (arcane >= 4) return 'Archimago del Abismo';

  return ARCHETYPES[archetype].name;
}

export function computePlayerStats(
  archetypeId: ArchetypeId,
  level: number,
  unlockedNodeIds: string[],
  weapon: ItemData,
  relic: ItemData | null,
  meta: MetaSaveData
): ComputedStats {
  const base = ARCHETYPES[archetypeId].baseStats;
  const b = meta.blessings;

  let maxHp = base.maxHp + (level - 1) * 14 + b.vitality * 15;
  let maxMana = base.maxMana + (level - 1) * 6;
  let armor = base.armor + (level - 1) * 1;
  let moveSpeed = base.moveSpeed + b.alacrity * 6;
  let baseDamage = base.baseDamage + (level - 1) * 3 + b.might * 4;
  let arcanePower = base.arcanePower + (level - 1) * 3 + b.might * 4;
  let attackSpeed = base.attackSpeed;
  let critChance = base.critChance;
  let critMultiplier = base.critMultiplier;
  let lifesteal = 0;
  let cooldownReduction = b.alacrity * 0.03;
  let dashLeavesShadow = false;
  let critChainArcane = false;
  let bleedOnHit = false;
  let manaShieldRatio = 0;
  let killHeal = 0;

  const applyStats = (s: ItemData['stats']) => {
    if (s.damageBonus) baseDamage += s.damageBonus;
    if (s.arcaneBonus) arcanePower += s.arcaneBonus;
    if (s.maxHpBonus) maxHp += s.maxHpBonus;
    if (s.maxManaBonus) maxMana += s.maxManaBonus;
    if (s.armorBonus) armor += s.armorBonus;
    if (s.critChanceBonus) critChance += s.critChanceBonus;
    if (s.critMultBonus) critMultiplier += s.critMultBonus;
    if (s.attackSpeedBonus) attackSpeed += s.attackSpeedBonus;
    if (s.moveSpeedBonus) moveSpeed += s.moveSpeedBonus;
    if (s.lifestealBonus) lifesteal += s.lifestealBonus;
    if (s.cooldownReduction) cooldownReduction += s.cooldownReduction;
  };

  applyStats(weapon.stats);
  if (relic) applyStats(relic.stats);

  for (const id of unlockedNodeIds) {
    const node = SKILL_TREE_NODES.find((n) => n.id === id);
    if (!node) continue;
    applyStats(node.statBonuses);
    if (node.statBonuses.dashLeavesShadow) dashLeavesShadow = true;
    if (node.statBonuses.critChainArcane) critChainArcane = true;
    if (node.statBonuses.bleedOnHit) bleedOnHit = true;
    if (node.statBonuses.manaShieldRatio) manaShieldRatio += node.statBonuses.manaShieldRatio;
    if (node.statBonuses.killHeal) killHeal += node.statBonuses.killHeal;
  }

  if (manaShieldRatio > 0) {
    armor += Math.round(maxMana * manaShieldRatio);
  }

  return {
    maxHp: Math.round(maxHp),
    maxMana: Math.round(maxMana),
    armor: Math.min(65, Math.round(armor)),
    moveSpeed: Math.round(moveSpeed),
    baseDamage: Math.round(baseDamage),
    arcanePower: Math.round(arcanePower),
    attackSpeed: Number(Math.min(2.4, attackSpeed).toFixed(2)),
    critChance: Number(Math.min(0.75, critChance).toFixed(2)),
    critMultiplier: Number(critMultiplier.toFixed(2)),
    lifesteal: Number(Math.min(0.35, lifesteal).toFixed(2)),
    cooldownReduction: Number(Math.min(0.45, cooldownReduction).toFixed(2)),
    dashCooldown: Math.max(0.7, 1.35 * (1 - Math.min(0.4, cooldownReduction))),
    flaskHealPct: 0.36 + b.flask * 0.08,
    manaRegen: 6 + arcanePower * 0.14,
    dashLeavesShadow,
    critChainArcane,
    bleedOnHit,
    manaShieldRatio,
    killHeal,
  };
}

const WEAPON_TEMPLATES: Array<{
  kind: WeaponKind;
  names: string[];
  desc: string;
}> = [
  {
    kind: 'greatsword',
    names: ['Espadón de Cripta', 'Hoja del Verdugo', 'Mandoble de Eclipse', 'Quebrantahuesos'],
    desc: 'Barrido pesado de largo alcance capaz de golpear múltiples enemigos.',
  },
  {
    kind: 'daggers',
    names: ['Dagas de Obsidiana', 'Colmillos Umbríos', 'Garras de Ceniza', 'Filos Gemelos'],
    desc: 'Ataques dobles ultrarrápidos con alta probabilidad crítica.',
  },
  {
    kind: 'staff',
    names: ['Báculo del Vacío', 'Cetro de Almas', 'Vara de Eclipse', 'Orbe Profano'],
    desc: 'Proyecta descargas arcanas de medio-largo alcance que potencian hechizos.',
  },
  {
    kind: 'halberd',
    names: ['Alabarda Sepulcral', 'Guja de Hierro', 'Pica del Guardián', 'Lanza de Basalto'],
    desc: 'Alcance extendido ideal para mantener a raya a bestias y esqueletos.',
  },
  {
    kind: 'scythe',
    names: ['Guadaña Lunar', 'Segadora Carmesí', 'Hoz del Osario', 'Filo del Ocaso'],
    desc: 'Arco amplio con afinidad híbrida física y arcana.',
  },
];

const RELIC_NAMES = [
  'Sello del Osario',
  'Anillo de Brasa',
  'Amuleto del Eclipse',
  'Corazón de Basalto',
  'Cáliz de Sangre Fría',
  'Talismán Espectral',
];

const RARITY_PREFIX: Record<Rarity, string[]> = {
  common: ['Desgastado', 'Antiguo', 'Forjado'],
  rare: ['Rúnico', 'Templado', 'Sombreado'],
  epic: ['Maldito', 'Carmesí', 'Abisal'],
  relic: ['Eterno', 'Soberano', 'Primordial'],
};

export const RARITY_COLORS: Record<Rarity, string> = {
  common: '#949BA8',
  rare: '#38BDF8',
  epic: '#A855F7',
  relic: '#F59E0B',
};

export const RARITY_LABELS: Record<Rarity, string> = {
  common: 'Común',
  rare: 'Raro',
  epic: 'Épico',
  relic: 'Reliquia',
};

let lootCounter = 1;

export function generateLootItem(
  floor: number,
  fortuneLevel: number,
  forcedRarity?: Rarity
): ItemData {
  const roll = Math.random() + fortuneLevel * 0.04 + floor * 0.03;
  const rarity: Rarity =
    forcedRarity ??
    (roll > 1.05 ? 'relic' : roll > 0.82 ? 'epic' : roll > 0.45 ? 'rare' : 'common');

  const mult = rarity === 'relic' ? 2.15 : rarity === 'epic' ? 1.65 : rarity === 'rare' ? 1.3 : 1.0;
  const isWeapon = Math.random() < 0.65;
  const prefixList = RARITY_PREFIX[rarity];
  const prefix = prefixList[Math.floor(Math.random() * prefixList.length)];
  const id = `item_${Date.now()}_${lootCounter++}`;

  if (isWeapon) {
    const tpl = WEAPON_TEMPLATES[Math.floor(Math.random() * WEAPON_TEMPLATES.length)];
    const baseName = tpl.names[Math.floor(Math.random() * tpl.names.length)];
    const dmg = Math.round((8 + floor * 5) * mult);
    const stats: ItemData['stats'] = { damageBonus: dmg };

    if (tpl.kind === 'staff') {
      stats.arcaneBonus = Math.round((10 + floor * 5) * mult);
      stats.maxManaBonus = Math.round(14 * mult);
    } else if (tpl.kind === 'daggers') {
      stats.attackSpeedBonus = Number((0.16 * mult).toFixed(2));
      stats.critChanceBonus = Number((0.05 * mult).toFixed(2));
    } else if (tpl.kind === 'greatsword') {
      stats.maxHpBonus = Math.round(18 * mult);
      stats.armorBonus = Math.round(3 * mult);
    } else if (tpl.kind === 'scythe') {
      stats.arcaneBonus = Math.round((5 + floor * 3) * mult);
      stats.lifestealBonus = Number((0.03 * mult).toFixed(2));
    } else {
      stats.critChanceBonus = Number((0.04 * mult).toFixed(2));
      stats.armorBonus = Math.round(4 * mult);
    }

    if (rarity === 'epic' || rarity === 'relic') {
      stats.critMultBonus = Number((0.2 * (rarity === 'relic' ? 1.5 : 1)).toFixed(2));
    }

    return {
      id,
      name: `${baseName} ${prefix}`,
      slot: 'weapon',
      weaponKind: tpl.kind,
      rarity,
      level: floor,
      description: tpl.desc,
      stats,
      valueGold: Math.round(20 * floor * mult),
    };
  }

  const relicBase = RELIC_NAMES[Math.floor(Math.random() * RELIC_NAMES.length)];
  const stats: ItemData['stats'] = {
    maxHpBonus: Math.round((16 + floor * 8) * mult),
    armorBonus: Math.round((2 + floor * 1.5) * mult),
  };

  const rollExtra = Math.random();
  if (rollExtra < 0.34) {
    stats.critChanceBonus = Number((0.05 * mult).toFixed(2));
    stats.lifestealBonus = Number((0.03 * mult).toFixed(2));
  } else if (rollExtra < 0.67) {
    stats.arcaneBonus = Math.round((7 + floor * 3) * mult);
    stats.cooldownReduction = Number((0.06 * mult).toFixed(2));
  } else {
    stats.moveSpeedBonus = Math.round(14 * mult);
    stats.damageBonus = Math.round((5 + floor * 2) * mult);
  }

  return {
    id,
    name: `${relicBase} ${prefix}`,
    slot: 'relic',
    rarity,
    level: floor,
    description: 'Reliquia antigua imbuida con ecos de la cripta.',
    stats,
    valueGold: Math.round(24 * floor * mult),
  };
}
