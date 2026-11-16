import { ARCHETYPES, DEFAULT_EQUIPPED_COSMETICS, getCosmeticById } from '../data/gameData';
import type { ArchetypeId, EnemyType, EquippedCosmetics, WeaponKind } from '../types/game';

export interface HeroRenderOptions {
  x: number;
  y: number;
  facing: number;
  radius: number;
  worldTime: number;
  archetype: ArchetypeId;
  weaponKind: WeaponKind;
  shield?: number;
  hitFlash?: number;
  squashX?: number;
  squashY?: number;
  cosmetics?: EquippedCosmetics;
  overrideAccentColor?: string;
  isMoving?: boolean;
}

export interface EnemyRenderOptions {
  x: number;
  y: number;
  facing: number;
  radius: number;
  type: EnemyType;
  worldTime: number;
  hitFlash?: number;
  squashX?: number;
  squashY?: number;
  enraged?: boolean;
  floorNumber?: number;
  isAttacking?: boolean;
}

export function resolveTrailColor(
  archetype: ArchetypeId,
  cosmetics?: EquippedCosmetics,
  fallback?: string
): string {
  const trail = getCosmeticById(cosmetics?.trail);
  if (trail && trail.styleTag !== 'default') {
    return trail.primaryColor;
  }
  return fallback ?? ARCHETYPES[archetype].accentColor;
}

export function drawHeroAura(
  ctx: CanvasRenderingContext2D,
  auraId: string | undefined,
  radius: number,
  worldTime: number
) {
  const aura = getCosmeticById(auraId);
  if (!aura || aura.styleTag === 'none') return;

  ctx.save();
  const r = radius + 11;
  const tag = aura.styleTag;

  if (tag === 'ember') {
    const grad = ctx.createRadialGradient(0, 0, radius * 0.4, 0, 0, r + 8);
    grad.addColorStop(0, 'rgba(245, 158, 11, 0)');
    grad.addColorStop(0.75, 'rgba(245, 158, 11, 0.22)');
    grad.addColorStop(1, 'rgba(234, 88, 12, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r + 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(245, 158, 11, 0.65)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.rotate(worldTime * 1.1);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + worldTime * 1.6;
      ctx.fillStyle = '#FDE68A';
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 2.3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (tag === 'eclipse') {
    ctx.rotate(worldTime * 0.8);
    ctx.strokeStyle = 'rgba(139, 92, 246, 0.72)';
    ctx.lineWidth = 1.75;
    ctx.beginPath();
    ctx.arc(0, 0, r + 1, 0, Math.PI * 2);
    ctx.stroke();

    ctx.rotate(-worldTime * 1.6);
    ctx.strokeStyle = 'rgba(233, 213, 255, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r - 4, 0.2, Math.PI - 0.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r - 4, Math.PI + 0.2, Math.PI * 2 - 0.2);
    ctx.stroke();

    for (let i = 0; i < 2; i++) {
      const a = i * Math.PI;
      ctx.fillStyle = '#C4B5FD';
      ctx.beginPath();
      ctx.arc(Math.cos(a) * (r + 1), Math.sin(a) * (r + 1), 3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (tag === 'frost') {
    ctx.rotate(worldTime * 0.65);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const sx = Math.cos(a) * (r + 2);
      const sy = Math.sin(a) * (r + 2);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(a);
      ctx.fillStyle = '#BAE6FD';
      ctx.beginPath();
      ctx.moveTo(4, 0);
      ctx.lineTo(0, 2.2);
      ctx.lineTo(-4, 0);
      ctx.lineTo(0, -2.2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  } else if (tag === 'blood') {
    const pulse = 1 + Math.sin(worldTime * 5) * 0.06;
    ctx.rotate(-worldTime * 1.0);
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.72)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r * pulse, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      ctx.fillStyle = '#FCA5A5';
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (r * pulse + 5), Math.sin(a) * (r * pulse + 5));
      ctx.lineTo(Math.cos(a + 0.14) * (r * pulse - 2), Math.sin(a + 0.14) * (r * pulse - 2));
      ctx.lineTo(Math.cos(a - 0.14) * (r * pulse - 2), Math.sin(a - 0.14) * (r * pulse - 2));
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

export function drawHeroPet(
  ctx: CanvasRenderingContext2D,
  petId: string | undefined,
  facing: number,
  worldTime: number
) {
  const pet = getCosmeticById(petId);
  if (!pet || pet.styleTag === 'none') return;

  const orbitAngle = facing + Math.PI * 0.78 + Math.sin(worldTime * 2.1) * 0.25;
  const dist = 27;
  const bob = Math.sin(worldTime * 4.5) * 3;
  const px = Math.cos(orbitAngle) * dist;
  const py = Math.sin(orbitAngle) * dist + bob - 4;

  ctx.save();
  ctx.translate(px, py);

  // Soft pet glow
  const glow = ctx.createRadialGradient(0, 0, 1, 0, 0, 14);
  glow.addColorStop(0, `${pet.primaryColor}88`);
  glow.addColorStop(1, `${pet.primaryColor}00`);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, 14, 0, Math.PI * 2);
  ctx.fill();

  if (pet.styleTag === 'wisp' || pet.styleTag === 'ember') {
    ctx.fillStyle = pet.primaryColor;
    ctx.beginPath();
    ctx.arc(0, 0, 5.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = pet.accentColor;
    ctx.beginPath();
    ctx.arc(-1, -1, 2.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (pet.styleTag === 'skull') {
    ctx.fillStyle = '#E5E0D5';
    ctx.beginPath();
    ctx.arc(0, -1, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-3.2, 2.5, 6.4, 3.2);
    ctx.fillStyle = pet.secondaryColor;
    ctx.fillRect(-2.8, -1.5, 2, 2);
    ctx.fillRect(0.8, -1.5, 2, 2);
    ctx.strokeStyle = pet.accentColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(-4, -5.5, 8, 9);
  } else if (pet.styleTag === 'eclipse') {
    ctx.fillStyle = '#090A0E';
    ctx.beginPath();
    ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#F59E0B';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, 0, 6.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.rotate(worldTime * 3);
    ctx.strokeStyle = '#C084FC';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, 0, 9.5, 3.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawHeroSprite(ctx: CanvasRenderingContext2D, opts: HeroRenderOptions) {
  const cosmetics = opts.cosmetics ?? DEFAULT_EQUIPPED_COSMETICS;
  const skin = getCosmeticById(cosmetics.skin) ?? getCosmeticById(DEFAULT_EQUIPPED_COSMETICS.skin)!;
  const trail = getCosmeticById(cosmetics.trail);
  const archColor = opts.overrideAccentColor ?? ARCHETYPES[opts.archetype].accentColor;

  const isCustomSkin = skin.id !== DEFAULT_EQUIPPED_COSMETICS.skin;
  const bodyPrimary = opts.hitFlash && opts.hitFlash > 0 ? '#FFFFFF' : skin.primaryColor;
  const bodyTrim = opts.hitFlash && opts.hitFlash > 0 ? '#FFFFFF' : isCustomSkin ? skin.secondaryColor : archColor;
  const eyeColor = isCustomSkin ? skin.accentColor : archColor;
  const weaponAccent =
    trail && trail.styleTag !== 'default'
      ? trail.primaryColor
      : opts.weaponKind === 'staff'
      ? '#A78BFA'
      : isCustomSkin
      ? skin.accentColor
      : '#E5E0D5';

  ctx.save();
  ctx.translate(opts.x, opts.y);

  // Equipped Aura (under hero)
  drawHeroAura(ctx, cosmetics.aura, opts.radius, opts.worldTime);

  // Shield ring
  if (opts.shield && opts.shield > 0) {
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.78)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, opts.radius + 7, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.52)';
  ctx.beginPath();
  ctx.ellipse(0, 11, 14.5, 7.2, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.rotate(opts.facing);
  ctx.scale(opts.squashX ?? 1, opts.squashY ?? 1);

  // Billowing Cloak behind hero
  const sway = Math.sin(opts.worldTime * (opts.isMoving ? 14 : 4)) * (opts.isMoving ? 3.5 : 1.5);
  ctx.fillStyle = opts.hitFlash && opts.hitFlash > 0 ? '#FFFFFF' : bodyTrim;
  ctx.beginPath();
  ctx.moveTo(-4, -11);
  ctx.quadraticCurveTo(-18, -8 + sway * 0.5, -20 - (opts.isMoving ? 3 : 0), sway);
  ctx.quadraticCurveTo(-18, 8 + sway * 0.5, -4, 11);
  ctx.closePath();
  ctx.fill();

  // Armored Pauldrons
  ctx.fillStyle = bodyPrimary;
  ctx.strokeStyle = bodyTrim;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, -11, 7, 4.8, 0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, 11, 7, 4.8, -0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Main Torso
  ctx.fillStyle = bodyPrimary;
  ctx.beginPath();
  ctx.arc(0, 0, opts.radius - 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = bodyTrim;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Detailed Weapon Silhouette with trail enchant glow
  ctx.save();
  if (opts.weaponKind === 'greatsword') {
    ctx.fillStyle = weaponAccent;
    ctx.fillRect(10, 8.5, 22, 4.5);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(12, 10, 17, 1.3);
    ctx.fillStyle = bodyTrim;
    ctx.fillRect(8, 5.5, 3.5, 10.5);
  } else if (opts.weaponKind === 'halberd') {
    ctx.fillStyle = '#A1887F';
    ctx.fillRect(6, 9, 25, 3);
    ctx.fillStyle = weaponAccent;
    ctx.beginPath();
    ctx.moveTo(26, 4);
    ctx.lineTo(35, 10.5);
    ctx.lineTo(26, 16);
    ctx.closePath();
    ctx.fill();
  } else if (opts.weaponKind === 'daggers') {
    ctx.fillStyle = weaponAccent;
    ctx.beginPath();
    ctx.moveTo(8, 9);
    ctx.lineTo(22, 11);
    ctx.lineTo(10, 13);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(8, -9);
    ctx.lineTo(22, -11);
    ctx.lineTo(10, -13);
    ctx.closePath();
    ctx.fill();
  } else if (opts.weaponKind === 'scythe') {
    ctx.fillStyle = '#64748B';
    ctx.fillRect(7, 8, 22, 3);
    ctx.fillStyle = weaponAccent;
    ctx.beginPath();
    ctx.moveTo(26, 9);
    ctx.quadraticCurveTo(32, -2, 22, -5);
    ctx.quadraticCurveTo(26, 4, 24, 11);
    ctx.closePath();
    ctx.fill();
  } else {
    // Staff
    ctx.fillStyle = '#6D584B';
    ctx.fillRect(7, 8, 20, 3);
    ctx.fillStyle = weaponAccent;
    ctx.beginPath();
    ctx.arc(28, 9.5, 4.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(28, 9.5, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Helm / Hood + Crest + Visor Eyes
  ctx.fillStyle = '#0D1119';
  ctx.beginPath();
  ctx.arc(2, 0, 8.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = bodyTrim;
  ctx.lineWidth = 1.4;
  ctx.stroke();

  if (skin.styleTag === 'seraph' || skin.styleTag === 'obsidian' || skin.styleTag === 'monarch') {
    ctx.fillStyle = eyeColor;
    ctx.beginPath();
    ctx.moveTo(-4, 0);
    ctx.lineTo(3, -3.5);
    ctx.lineTo(1, 0);
    ctx.lineTo(3, 3.5);
    ctx.closePath();
    ctx.fill();
  }

  // Glowing eyes
  ctx.fillStyle = eyeColor;
  ctx.fillRect(5.2, -4.2, 3.6, 2.5);
  ctx.fillRect(5.2, 1.7, 3.6, 2.5);
  ctx.restore();

  // Orbiting Spectral Pet
  drawHeroPet(ctx, cosmetics.pet, opts.facing, opts.worldTime);

  ctx.restore();
}

export function drawEnemySprite(ctx: CanvasRenderingContext2D, opts: EnemyRenderOptions) {
  const { x, y, facing, radius, type, worldTime } = opts;
  const hover =
    type === 'wraith' || type === 'boss_archon' ? Math.sin(worldTime * 4.5 + x * 0.05) * 2.5 : 0;
  const attackThrust = opts.isAttacking ? 4 : 0;

  ctx.save();
  ctx.translate(x, y);

  // Ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.48)';
  ctx.beginPath();
  ctx.ellipse(0, radius * 0.74, radius * 0.92, radius * 0.44, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.translate(0, hover);
  ctx.rotate(facing);
  ctx.scale(opts.squashX ?? 1, opts.squashY ?? 1);

  if (opts.hitFlash && opts.hitFlash > 0) {
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (type === 'skeleton') {
    // Tattered bone pauldrons & ribcage
    ctx.fillStyle = '#333A4A';
    ctx.beginPath();
    ctx.arc(-2, 0, radius - 1, 0, Math.PI * 2);
    ctx.fill();

    // Skull head
    ctx.fillStyle = '#DED8CC';
    ctx.beginPath();
    ctx.arc(1, 0, radius * 0.78, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#4B5563';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Small buckler shield on left
    ctx.fillStyle = '#475569';
    ctx.strokeStyle = '#94A3B8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(3, -radius * 0.85, 5.5, -Math.PI * 0.5, Math.PI * 0.5);
    ctx.fill();
    ctx.stroke();

    // Notched rusted sword
    ctx.fillStyle = '#949BA8';
    ctx.fillRect(6 + attackThrust, 5, 16, 4);
    ctx.fillStyle = '#E5E0D5';
    ctx.fillRect(8 + attackThrust, 6, 12, 1.4);

    // Crimson eye sockets
    ctx.fillStyle = '#DC2626';
    ctx.fillRect(4.5, -5, 3.8, 3);
    ctx.fillRect(4.5, 2, 3.8, 3);
  } else if (type === 'cultist') {
    // Hooded dark robe with trailing hem
    ctx.fillStyle = '#2E1065';
    ctx.beginPath();
    ctx.moveTo(-radius - 4, -8);
    ctx.quadraticCurveTo(0, -radius - 2, radius, 0);
    ctx.quadraticCurveTo(0, radius + 2, -radius - 4, 8);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#A855F7';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Inner cowl & glowing arcane eyes
    ctx.fillStyle = '#120826';
    ctx.beginPath();
    ctx.arc(2, 0, radius * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#E9D5FF';
    ctx.fillRect(4, -3.5, 3, 2);
    ctx.fillRect(4, 1.5, 3, 2);

    // Staff & pulsing arcane orb
    ctx.fillStyle = '#6D584B';
    ctx.fillRect(4, 7, 13, 2.5);
    const orbPulse = 3.8 + Math.sin(worldTime * 8) * 0.8;
    ctx.fillStyle = '#C084FC';
    ctx.beginPath();
    ctx.arc(16 + attackThrust * 0.6, 8.2, orbPulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(16 + attackThrust * 0.6, 8.2, 1.6, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'golem') {
    // Beveled basalt torso
    ctx.fillStyle = '#2A313D';
    ctx.beginPath();
    ctx.roundRect(-radius, -radius, radius * 2, radius * 2, 7);
    ctx.fill();
    ctx.strokeStyle = '#D97706';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Inner stone armor plates
    ctx.fillStyle = '#1F242D';
    ctx.beginPath();
    ctx.roundRect(-radius * 0.65, -radius * 0.65, radius * 1.3, radius * 1.3, 4);
    ctx.fill();

    // Magma rune cracks & core eye
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.72)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-10, -8);
    ctx.lineTo(-2, -2);
    ctx.lineTo(-9, 9);
    ctx.stroke();

    // Heavy stone fists
    ctx.fillStyle = '#374151';
    ctx.strokeStyle = '#F59E0B';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(radius * 0.65 + attackThrust, -radius * 0.72, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(radius * 0.65 + attackThrust, radius * 0.72, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Molten eye core
    ctx.fillStyle = '#F59E0B';
    ctx.beginPath();
    ctx.arc(7, 0, 5.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FEF3C7';
    ctx.beginPath();
    ctx.arc(8, 0, 2.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'wraith') {
    // Ethereal mist wisps trailing behind
    const wispSway = Math.sin(worldTime * 8) * 4;
    ctx.fillStyle = 'rgba(45, 212, 191, 0.25)';
    ctx.beginPath();
    ctx.moveTo(0, -radius);
    ctx.quadraticCurveTo(-radius * 1.6, -6 + wispSway, -radius * 1.8, wispSway);
    ctx.quadraticCurveTo(-radius * 1.4, 8 + wispSway, 0, radius);
    ctx.closePath();
    ctx.fill();

    // Spectral body
    ctx.fillStyle = '#0F766E';
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2DD4BF';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Twin spectral claws
    ctx.fillStyle = '#99F6E4';
    ctx.beginPath();
    ctx.moveTo(radius - 2, -7);
    ctx.lineTo(radius + 9 + attackThrust, -5);
    ctx.lineTo(radius - 1, -2);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(radius - 2, 7);
    ctx.lineTo(radius + 9 + attackThrust, 5);
    ctx.lineTo(radius - 1, 2);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#CCFBF1';
    ctx.fillRect(5, -4, 4, 2);
    ctx.fillRect(5, 2, 4, 2);
  } else {
    // BOSSES: boss_warden & boss_archon
    const isArchon = type === 'boss_archon';
    const floorNum = opts.floorNumber ?? 1;
    const isEnraged = Boolean(opts.enraged);
    const mainCol = isArchon ? '#4C1D95' : '#691414';
    const trimCol = isEnraged ? '#EF4444' : isArchon ? '#A78BFA' : '#F59E0B';

    // Outer boss aura ring (Floor 2+ or Enraged)
    if (floorNum >= 2 || isEnraged) {
      ctx.strokeStyle = isEnraged ? 'rgba(239, 68, 68, 0.72)' : `${trimCol}66`;
      ctx.lineWidth = isEnraged ? 3 : 2;
      ctx.beginPath();
      ctx.arc(0, 0, radius + 8 + Math.sin(worldTime * (isEnraged ? 9 : 4)) * 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (isArchon) {
      // Rotating eclipse halo & orbiting void shards
      ctx.save();
      ctx.rotate(worldTime * (isEnraged ? 2.4 : 1.1));
      ctx.strokeStyle = trimCol;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.arc(0, 0, radius + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        ctx.fillStyle = isEnraged ? '#FCA5A5' : '#E9D5FF';
        ctx.beginPath();
        ctx.arc(Math.cos(a) * (radius + 4), Math.sin(a) * (radius + 4), 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    } else {
      // Warden spiked iron shoulder pauldrons
      ctx.fillStyle = '#292524';
      ctx.strokeStyle = trimCol;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.ellipse(-2, -radius * 0.85, 11, 7, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(-2, radius * 0.85, 11, 7, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Main Boss Core
    ctx.fillStyle = mainCol;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = trimCol;
    ctx.lineWidth = 3.5;
    ctx.stroke();

    // Inner armored crest / rune ring
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.62, 0, Math.PI * 2);
    ctx.stroke();

    // Boss Weapon
    if (isArchon) {
      ctx.fillStyle = '#312E81';
      ctx.fillRect(8, 12, 24, 4);
      ctx.fillStyle = trimCol;
      ctx.beginPath();
      ctx.arc(34 + attackThrust, 14, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(34 + attackThrust, 14, 2.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = trimCol;
      ctx.fillRect(10 + attackThrust, 10, 28, 6);
      ctx.fillStyle = '#FEF3C7';
      ctx.fillRect(16 + attackThrust, 11.8, 18, 2);
    }

    // Horned Crown / Visor Eyes
    ctx.fillStyle = '#090A0E';
    ctx.beginPath();
    ctx.arc(4, 0, radius * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = isEnraged ? '#FCA5A5' : '#FEF3C7';
    ctx.beginPath();
    ctx.arc(9, -6, 3.6, 0, Math.PI * 2);
    ctx.arc(9, 6, 3.6, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
