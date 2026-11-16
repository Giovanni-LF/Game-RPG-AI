import React, { useEffect, useRef, useState } from 'react';
import { BookMarked, Eye, Flame, ShieldAlert, Skull, X } from 'lucide-react';
import {
  ENEMY_BESTIARY,
  ENEMY_DEFINITIONS,
  ENEMY_SCALING,
  getBossDisplayName,
  getBossFloorMultipliers,
} from '../data/gameData';
import { drawEnemySprite } from '../engine/entityRenderer';
import type { EnemyType, MetaSaveData } from '../types/game';

interface BestiaryModalProps {
  meta: MetaSaveData;
  onClose: () => void;
}

const ENEMY_ORDER: EnemyType[] = [
  'skeleton',
  'cultist',
  'golem',
  'wraith',
  'boss_warden',
  'boss_archon',
];

export const BestiaryModal: React.FC<BestiaryModalProps> = ({ meta, onClose }) => {
  const [filter, setFilter] = useState<'all' | 'common' | 'boss'>('all');
  const [selectedType, setSelectedType] = useState<EnemyType>('skeleton');
  const [poseMode, setPoseMode] = useState<'idle' | 'attack' | 'enraged'>('idle');
  const [inspectFloor, setInspectFloor] = useState<number>(1);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const def = ENEMY_DEFINITIONS[selectedType];
  const lore = ENEMY_BESTIARY[selectedType];
  const isDiscovered = meta.discoveredEnemies.includes(selectedType);
  const killCount = meta.bestiaryKills[selectedType] ?? 0;

  // Compute scaled stats for inspectFloor
  const bossMult = def.isBoss ? getBossFloorMultipliers(inspectFloor, 1) : null;
  const normalScale = 1 + (inspectFloor - 1) * ENEMY_SCALING.floorFactor;
  const scaledHp = bossMult
    ? Math.round(def.baseHp * bossMult.hpMult)
    : Math.round(def.baseHp * normalScale);
  const scaledDmg = bossMult
    ? Math.round(def.damage * bossMult.damageMult)
    : Math.round(def.damage * (1 + (inspectFloor - 1) * 0.24));
  const scaledSpeed = bossMult
    ? Math.round(def.speed * bossMult.speedMult)
    : Math.round(def.speed * Math.min(1.35, 1 + (inspectFloor - 1) * 0.04));
  const scaledXp = bossMult
    ? Math.round(def.xpValue * bossMult.xpMult)
    : Math.round(def.xpValue * normalScale);
  const scaledGold = bossMult
    ? Math.round(def.goldValue * bossMult.goldMult)
    : Math.round(def.goldValue * normalScale);

  // Live animated enemy canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    const start = performance.now();

    const render = (now: number) => {
      const t = (now - start) / 1000;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cssW = canvas.clientWidth || 300;
      const cssH = canvas.clientHeight || 220;
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, cssW, cssH);

      const bg = ctx.createRadialGradient(
        cssW * 0.5,
        cssH * 0.5,
        10,
        cssW * 0.5,
        cssH * 0.5,
        cssW * 0.65
      );
      bg.addColorStop(0, def.isBoss ? '#22131E' : '#161B26');
      bg.addColorStop(1, '#08090C');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, cssW, cssH);

      // Subtle arena ring
      ctx.strokeStyle = `${lore.accentColor}33`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(cssW * 0.5, cssH * 0.62, 60, 22, 0, 0, Math.PI * 2);
      ctx.stroke();

      const scaleFactor = def.isBoss ? 1.75 : 2.15;
      ctx.save();
      ctx.translate(cssW * 0.5, cssH * 0.5);
      ctx.scale(scaleFactor, scaleFactor);
      drawEnemySprite(ctx, {
        x: 0,
        y: 0,
        facing: Math.sin(t * 0.9) * 0.55 + 0.35,
        radius: def.radius,
        type: selectedType,
        worldTime: t,
        enraged: poseMode === 'enraged' && def.isBoss,
        floorNumber: inspectFloor,
        isAttacking: poseMode === 'attack' || (poseMode === 'enraged' && Math.sin(t * 6) > 0.3),
      });
      ctx.restore();

      if (!isDiscovered) {
        ctx.fillStyle = 'rgba(8, 9, 13, 0.52)';
        ctx.fillRect(0, 0, cssW, cssH);
      }

      ctx.restore();
      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [selectedType, def.radius, def.isBoss, lore.accentColor, poseMode, inspectFloor, isDiscovered]);

  const visibleEnemies = ENEMY_ORDER.filter((type) => {
    const entry = ENEMY_DEFINITIONS[type];
    if (filter === 'common') return !entry.isBoss;
    if (filter === 'boss') return entry.isBoss;
    return true;
  });

  const totalDiscovered = ENEMY_ORDER.filter((t) => meta.discoveredEnemies.includes(t)).length;

  return (
    <div className="fixed inset-0 z-50 bg-black/82 flex items-center justify-center p-3 sm:p-5">
      <div className="w-full max-w-5xl max-h-[92dvh] bg-[#12151C] border border-[#2C3344] rounded-lg flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-[#232836] bg-[#0F1218]">
          <div>
            <div className="flex items-center gap-2.5">
              <BookMarked className="w-5 h-5 text-red-400 shrink-0" />
              <h2 className="font-display text-lg sm:text-xl font-bold text-[#E5E0D5]">
                Bestiario de las Criptas
              </h2>
            </div>
            <p className="text-xs text-[#949BA8] mt-0.5 font-mono-num">
              Registro ilustrado de amenazas · {totalDiscovered}/{ENEMY_ORDER.length} especies avistadas
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar bestiario"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md bg-[#181C26] border border-[#2C3344] hover:border-[#475066] text-[#949BA8] hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto crypt-scroll grid grid-cols-1 lg:grid-cols-12">
          {/* Left Species Index */}
          <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-[#232836] p-4 space-y-3 bg-[#0E1117]">
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { id: 'all', label: 'Todos' },
                { id: 'common', label: 'Criaturas' },
                { id: 'boss', label: 'Jefes' },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setFilter(t.id as 'all' | 'common' | 'boss')}
                  className={`min-h-[38px] px-2.5 py-1.5 rounded text-xs font-semibold border cursor-pointer ${
                    filter === t.id
                      ? 'bg-amber-600 text-[#0B0C10] border-amber-500'
                      : 'bg-[#151922] text-[#C2BDB2] border-[#262D3D] hover:text-white'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              {visibleEnemies.map((type) => {
                const eDef = ENEMY_DEFINITIONS[type];
                const eLore = ENEMY_BESTIARY[type];
                const active = selectedType === type;
                const seen = meta.discoveredEnemies.includes(type);
                const kills = meta.bestiaryKills[type] ?? 0;

                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      setSelectedType(type);
                      if (!eDef.isBoss && poseMode === 'enraged') {
                        setPoseMode('idle');
                      }
                    }}
                    className={`w-full text-left p-3 rounded-lg border transition-colors cursor-pointer min-h-[44px] ${
                      active
                        ? 'bg-[#191F2C] border-amber-500/80'
                        : 'bg-[#141821] border-[#262D3D] hover:border-[#3A4359]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-sm font-bold text-[#E5E0D5] truncate">
                        {eDef.name}
                      </span>
                      <span
                        className="text-[11px] font-mono-num font-semibold shrink-0"
                        style={{ color: eLore.accentColor }}
                      >
                        {eLore.dangerRank}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-1 text-[11px] font-mono-num text-[#949BA8]">
                      <span>{seen ? 'Avistado' : 'Sin avistar en combate'}</span>
                      <span>Abatidos: {kills}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Animated Inspector */}
          <div className="lg:col-span-8 p-4 sm:p-6 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch">
              {/* Live Sprite Canvas */}
              <div className="md:col-span-5 flex flex-col gap-2">
                <div className="relative rounded-lg overflow-hidden border border-[#283042] bg-[#08090C]">
                  <canvas ref={canvasRef} className="w-full h-52 block" />
                  <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between text-[11px] font-mono-num">
                    <span className="px-2 py-0.5 rounded bg-[#0B0D12]/90 border border-[#2C3344] text-[#D4CFC4]">
                      {lore.faction}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded bg-[#0B0D12]/90 border ${
                        isDiscovered
                          ? 'border-emerald-500/45 text-emerald-300'
                          : 'border-[#2C3344] text-[#949BA8]'
                      }`}
                    >
                      {isDiscovered ? `Abatidos: ${killCount}` : 'Muestra preliminar'}
                    </span>
                  </div>
                </div>

                {/* Animation Pose Controls */}
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPoseMode('idle')}
                    className={`min-h-[38px] px-2 rounded text-xs font-medium border cursor-pointer inline-flex items-center justify-center gap-1 ${
                      poseMode === 'idle'
                        ? 'bg-[#1D2434] border-amber-500/70 text-amber-300'
                        : 'bg-[#141821] border-[#262D3D] text-[#949BA8] hover:text-white'
                    }`}
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Reposo</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPoseMode('attack')}
                    className={`min-h-[38px] px-2 rounded text-xs font-medium border cursor-pointer inline-flex items-center justify-center gap-1 ${
                      poseMode === 'attack'
                        ? 'bg-[#1D2434] border-amber-500/70 text-amber-300'
                        : 'bg-[#141821] border-[#262D3D] text-[#949BA8] hover:text-white'
                    }`}
                  >
                    <Skull className="w-3.5 h-3.5" />
                    <span>Ataque</span>
                  </button>
                  <button
                    type="button"
                    disabled={!def.isBoss}
                    onClick={() => setPoseMode('enraged')}
                    className={`min-h-[38px] px-2 rounded text-xs font-medium border inline-flex items-center justify-center gap-1 ${
                      !def.isBoss
                        ? 'bg-[#11141B] border-[#1F2430] text-[#4B5563] cursor-not-allowed'
                        : poseMode === 'enraged'
                        ? 'bg-red-950/70 border-red-500/80 text-red-300 cursor-pointer'
                        : 'bg-[#141821] border-[#262D3D] text-[#949BA8] hover:text-white cursor-pointer'
                    }`}
                  >
                    <Flame className="w-3.5 h-3.5" />
                    <span>Furia</span>
                  </button>
                </div>
              </div>

              {/* Lore & Floor Scaling Inspector */}
              <div className="md:col-span-7 flex flex-col justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-display text-xl font-bold text-[#E5E0D5]">
                      {def.isBoss && inspectFloor > 1
                        ? getBossDisplayName(def.name, inspectFloor)
                        : def.name}
                    </h3>
                  </div>
                  <div className="text-xs font-mono-num text-[#949BA8]">
                    <span>{lore.title}</span>
                    <span aria-hidden="true"> · </span>
                    <span style={{ color: lore.accentColor }}>Rango {lore.dangerRank}</span>
                  </div>
                  <p className="text-xs sm:text-sm text-[#C2BDB2] leading-relaxed">{lore.lore}</p>
                </div>

                {/* Floor Depth Slider */}
                <div className="p-3.5 rounded-lg bg-[#151923] border border-[#262D3D] space-y-2.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-[#D4CFC4]">
                      Simular escalado por profundidad
                    </span>
                    <span className="font-mono-num font-bold text-amber-300">
                      Piso {inspectFloor}
                      {bossMult ? ` · ${bossMult.tierLabel}` : ''}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={25}
                    value={inspectFloor}
                    onChange={(e) => setInspectFloor(Number(e.target.value))}
                    aria-label="Seleccionar piso para inspeccionar escalado"
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono-num">
                    <div className="p-2 rounded bg-[#0F1219] border border-[#222836]">
                      <div className="text-[10px] text-[#949BA8]">Vida</div>
                      <div className="font-bold text-red-400">{scaledHp}</div>
                    </div>
                    <div className="p-2 rounded bg-[#0F1219] border border-[#222836]">
                      <div className="text-[10px] text-[#949BA8]">Daño</div>
                      <div className="font-bold text-amber-300">{scaledDmg}</div>
                    </div>
                    <div className="p-2 rounded bg-[#0F1219] border border-[#222836]">
                      <div className="text-[10px] text-[#949BA8]">Velocidad</div>
                      <div className="font-bold text-sky-300">{scaledSpeed}</div>
                    </div>
                    <div className="p-2 rounded bg-[#0F1219] border border-[#222836]">
                      <div className="text-[10px] text-[#949BA8]">Botín</div>
                      <div className="font-bold text-violet-300">
                        {scaledXp}XP · {scaledGold}O
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Abilities & Tactical Weakness */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3.5 rounded-lg bg-[#151923] border border-[#262D3D] space-y-2">
                <h4 className="font-display text-xs font-bold uppercase tracking-wider text-amber-400">
                  Patrones y Habilidades
                </h4>
                <ul className="space-y-1.5 text-xs text-[#D4CFC4]">
                  {lore.abilities.map((ab, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-amber-400 mt-0.5">◆</span>
                      <span>{ab}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="p-3.5 rounded-lg bg-[#151923] border border-[#262D3D] space-y-2">
                <h4 className="font-display text-xs font-bold uppercase tracking-wider text-emerald-400 inline-flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>Debilidad Táctica</span>
                </h4>
                <p className="text-xs text-[#D4CFC4] leading-relaxed">{lore.weakness}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
