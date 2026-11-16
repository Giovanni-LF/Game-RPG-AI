import type {
  AchievementDef,
  ActiveSkillDef,
  ActiveSkillId,
  ArchetypeDef,
  ArchetypeId,
  BestiaryEnemyLore,
  ComputedStats,
  CosmeticItemDef,
  EnemyType,
  EquippedCosmetics,
  EternalBlessingDef,
  ItemData,
  MetaSaveData,
  Rarity,
  SkillTreeNode,
  WeaponKind,
} from '../types/game.ts';
import achievementsJson from './catalog/achievements.json' with { type: 'json' };
import archetypesJson from './catalog/archetypes.json' with { type: 'json' };
import blessingsJson from './catalog/blessings.json' with { type: 'json' };
import cosmeticsJson from './catalog/cosmetics.json' with { type: 'json' };
import enemiesJson from './catalog/enemies.json' with { type: 'json' };
import lootJson from './catalog/loot.json' with { type: 'json' };
import skillsJson from './catalog/skills.json' with { type: 'json' };
import skillTreeJson from './catalog/skillTree.json' with { type: 'json' };

export interface ActiveSkillCatalogEntry extends ActiveSkillDef {
  maxRange: number;
  physicalScale: number;
  arcaneScale: number;
  shieldHpRatio?: number;
  shieldDuration?: number;
}

export interface EnemyCatalogEntry {
  type: EnemyType;
  name: string;
  isBoss: boolean;
  baseHp: number;
  radius: number;
  speed: number;
  damage: number;
  xpValue: number;
  goldValue: number;
  initialCooldown: number;
  aggroRange: number;
}

export const ARCHETYPES = archetypesJson as Record<ArchetypeId, ArchetypeDef>;

export const ACTIVE_SKILLS = skillsJson as Record<ActiveSkillId, ActiveSkillCatalogEntry>;

export const SKILL_TREE_NODES = skillTreeJson.nodes as SkillTreeNode[];

const HYBRID_TITLES = skillTreeJson.hybridTitles;

export const ETERNAL_BLESSINGS = blessingsJson.blessings as EternalBlessingDef[];
export const BLESSING_SCALING = blessingsJson.scaling;

export const ENEMY_DEFINITIONS = enemiesJson.enemies as Record<EnemyType, EnemyCatalogEntry>;
export const ENEMY_BESTIARY = enemiesJson.bestiary as Record<EnemyType, BestiaryEnemyLore>;
export const ENEMY_SCALING = enemiesJson.scaling;
export const BOSS_SCALING = enemiesJson.bossScaling;
export const FLOOR_NAMES = enemiesJson.floorNames as string[];

export const DEFAULT_EQUIPPED_COSMETICS = cosmeticsJson.defaults as EquippedCosmetics;
export const COSMETICS_CATALOG = cosmeticsJson.items as CosmeticItemDef[];
export const ACHIEVEMENTS_CATALOG = achievementsJson.items as AchievementDef[];

export function getCosmeticById(id: string | undefined): CosmeticItemDef | undefined {
  if (!id) return undefined;
  return COSMETICS_CATALOG.find((c) => c.id === id);
}

export interface BossFloorMultipliers {
  floorNumber: number;
  hpMult: number;
  damageMult: number;
  speedMult: number;
  cooldownMult: number;
  telegraphMult: number;
  bonusOrbs: number;
  bonusSlamRadius: number;
  xpMult: number;
  goldMult: number;
  tierLabel: string;
  difficultyPercent: number;
}

export function getBossFloorMultipliers(
  floorNumber: number,
  coopPlayerCount = 1
): BossFloorMultipliers {
  const f = Math.max(1, Math.floor(floorNumber));
  const extraFloors = f - 1;
  const coopMult = 1 + Math.max(0, coopPlayerCount - 1) * ENEMY_SCALING.coopPlayerFactor;
  const hpMult =
    (1 + extraFloors * BOSS_SCALING.hpPerFloor) *
    (1 + Math.max(0, extraFloors - 1) * BOSS_SCALING.hpCompoundPerFloor) *
    coopMult;
  const damageMult = (1 + extraFloors * BOSS_SCALING.damagePerFloor) * coopMult;
  const speedMult = Math.min(
    BOSS_SCALING.maxSpeedMultiplier,
    1 + extraFloors * BOSS_SCALING.speedPerFloor
  );
  const cooldownMult = Math.max(
    BOSS_SCALING.minCooldownMultiplier,
    1 - extraFloors * BOSS_SCALING.cooldownReductionPerFloor
  );
  const telegraphMult = Math.max(
    BOSS_SCALING.minTelegraphMultiplier,
    1 - extraFloors * BOSS_SCALING.telegraphSpeedupPerFloor
  );
  const bonusOrbs = Math.min(BOSS_SCALING.maxBonusOrbs, extraFloors * BOSS_SCALING.extraOrbsPerFloor);
  const bonusSlamRadius = Math.min(
    BOSS_SCALING.maxBonusSlamRadius,
    extraFloors * BOSS_SCALING.slamRadiusPerFloor
  );
  const xpMult = (1 + extraFloors * BOSS_SCALING.xpPerFloor) * coopMult;
  const goldMult = (1 + extraFloors * BOSS_SCALING.goldPerFloor) * coopMult;

  let tierLabel = 'Guardián';
  if (f === 2) tierLabel = 'Despertado';
  else if (f === 3) tierLabel = 'Implacable';
  else if (f === 4) tierLabel = 'Cataclísmico';
  else if (f >= 5) tierLabel = 'Eclipse Eterno';

  return {
    floorNumber: f,
    hpMult,
    damageMult,
    speedMult,
    cooldownMult,
    telegraphMult,
    bonusOrbs,
    bonusSlamRadius,
    xpMult,
    goldMult,
    tierLabel,
    difficultyPercent: Math.round(hpMult * 100),
  };
}

export function getBossDisplayName(baseName: string, floorNumber: number): string {
  const f = Math.max(1, Math.floor(floorNumber));
  if (f <= 1) return baseName;
  const { tierLabel } = getBossFloorMultipliers(f);
  return `${baseName} · ${tierLabel} (P${f})`;
}

const WEAPON_TEMPLATES = lootJson.weaponTemplates as Array<{
  kind: WeaponKind;
  names: string[];
  desc: string;
}>;
const RELIC_NAMES = lootJson.relicNames as string[];
const RARITY_PREFIX = lootJson.rarityPrefixes as Record<Rarity, string[]>;
export const RARITY_COLORS = lootJson.rarityColors as Record<Rarity, string>;
export const RARITY_LABELS = lootJson.rarityLabels as Record<Rarity, string>;
const RARITY_MULTIPLIERS = lootJson.rarityMultipliers as Record<Rarity, number>;

export const GAME_CATALOG = {
  archetypes: ARCHETYPES,
  skills: ACTIVE_SKILLS,
  skillTree: SKILL_TREE_NODES,
  hybridTitles: HYBRID_TITLES,
  blessings: ETERNAL_BLESSINGS,
  blessingScaling: BLESSING_SCALING,
  loot: lootJson,
  enemies: ENEMY_DEFINITIONS,
  bestiary: ENEMY_BESTIARY,
  enemyScaling: ENEMY_SCALING,
  bossScaling: BOSS_SCALING,
  floorNames: FLOOR_NAMES,
  cosmetics: COSMETICS_CATALOG,
  achievements: ACHIEVEMENTS_CATALOG,
};

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
    return HYBRID_TITLES.avatar;
  }
  if (steel >= 2 && shadow >= 2 && arcane === 0) return HYBRID_TITLES.steelShadow;
  if (steel >= 2 && arcane >= 2 && shadow === 0) return HYBRID_TITLES.steelArcane;
  if (shadow >= 2 && arcane >= 2 && steel === 0) return HYBRID_TITLES.shadowArcane;
  if (steel >= 2 && shadow >= 1 && arcane >= 1) return HYBRID_TITLES.triSteel;
  if (shadow >= 2 && arcane >= 1 && steel >= 1) return HYBRID_TITLES.triShadow;
  if (arcane >= 2 && steel >= 1 && shadow >= 1) return HYBRID_TITLES.triArcane;

  if (steel >= 4) return HYBRID_TITLES.pureSteel;
  if (shadow >= 4) return HYBRID_TITLES.pureShadow;
  if (arcane >= 4) return HYBRID_TITLES.pureArcane;

  return ARCHETYPES[archetype].name;
}

export function computePlayerStats(
  archetypeId: ArchetypeId,
  level: number,
  unlockedNodeIds: string[],
  weapon: ItemData,
  relic: ItemData | null,
  meta: Pick<MetaSaveData, 'blessings'>
): ComputedStats {
  const base = ARCHETYPES[archetypeId].baseStats;
  const b = meta.blessings;

  let maxHp = base.maxHp + (level - 1) * 14 + b.vitality * BLESSING_SCALING.vitalityHpPerLevel;
  let maxMana = base.maxMana + (level - 1) * 6;
  let armor = base.armor + (level - 1) * 1;
  let moveSpeed = base.moveSpeed + b.alacrity * BLESSING_SCALING.alacritySpeedPerLevel;
  let baseDamage = base.baseDamage + (level - 1) * 3 + b.might * BLESSING_SCALING.mightDamagePerLevel;
  let arcanePower = base.arcanePower + (level - 1) * 3 + b.might * BLESSING_SCALING.mightArcanePerLevel;
  let attackSpeed = base.attackSpeed;
  let critChance = base.critChance;
  let critMultiplier = base.critMultiplier;
  let lifesteal = 0;
  let cooldownReduction = b.alacrity * BLESSING_SCALING.alacrityCdrPerLevel;
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
    flaskHealPct: BLESSING_SCALING.flaskBaseHealPct + b.flask * BLESSING_SCALING.flaskHealPctPerLevel,
    manaRegen: 6 + arcanePower * 0.14,
    dashLeavesShadow,
    critChainArcane,
    bleedOnHit,
    manaShieldRatio,
    killHeal,
  };
}

let lootCounter = 1;

export function generateLootItem(
  floor: number,
  fortuneLevel: number,
  forcedRarity?: Rarity,
  rng: () => number = Math.random,
  customId?: string
): ItemData {
  const roll = rng() + fortuneLevel * 0.04 + floor * 0.03;
  const rarity: Rarity =
    forcedRarity ??
    (roll > 1.05 ? 'relic' : roll > 0.82 ? 'epic' : roll > 0.45 ? 'rare' : 'common');

  const mult = RARITY_MULTIPLIERS[rarity] ?? 1.0;
  const isWeapon = rng() < 0.65;
  const prefixList = RARITY_PREFIX[rarity];
  const prefix = prefixList[Math.floor(rng() * prefixList.length)];
  const id = customId ?? `item_${Date.now()}_${lootCounter++}`;

  if (isWeapon) {
    const tpl = WEAPON_TEMPLATES[Math.floor(rng() * WEAPON_TEMPLATES.length)];
    const baseName = tpl.names[Math.floor(rng() * tpl.names.length)];
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

  const relicBase = RELIC_NAMES[Math.floor(rng() * RELIC_NAMES.length)];
  const stats: ItemData['stats'] = {
    maxHpBonus: Math.round((16 + floor * 8) * mult),
    armorBonus: Math.round((2 + floor * 1.5) * mult),
  };

  const rollExtra = rng();
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
