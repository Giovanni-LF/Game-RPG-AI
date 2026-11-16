import React, { useEffect, useRef, useState } from 'react';
import { Check, Lock, Sparkles, X } from 'lucide-react';
import {
  ARCHETYPES,
  COSMETICS_CATALOG,
  getCosmeticById,
  RARITY_COLORS,
  RARITY_LABELS,
} from '../data/gameData';
import { drawHeroSprite } from '../engine/entityRenderer';
import type {
  ArchetypeId,
  CosmeticCategory,
  CosmeticItemDef,
  EquippedCosmetics,
  MetaSaveData,
  WeaponKind,
} from '../types/game';

interface CosmeticsShopModalProps {
  meta: MetaSaveData;
  selectedArchetype: ArchetypeId;
  onPurchaseOrEquip: (cosmeticId: string) => void;
  onEquip: (category: CosmeticCategory, cosmeticId: string) => void;
  onClose: () => void;
}

const CATEGORY_TABS: Array<{ id: 'all' | CosmeticCategory; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'skin', label: 'Atuendos' },
  { id: 'aura', label: 'Auras' },
  { id: 'trail', label: 'Estelas' },
  { id: 'pet', label: 'Familiares' },
];

const CATEGORY_LABEL: Record<CosmeticCategory, string> = {
  skin: 'Atuendo',
  aura: 'Aura',
  trail: 'Estela',
  pet: 'Familiar',
};

const WEAPON_PREVIEWS: Array<{ kind: WeaponKind; label: string }> = [
  { kind: 'greatsword', label: 'Mandoble' },
  { kind: 'daggers', label: 'Dagas' },
  { kind: 'staff', label: 'Báculo' },
  { kind: 'halberd', label: 'Alabarda' },
  { kind: 'scythe', label: 'Guadaña' },
];

export const CosmeticsShopModal: React.FC<CosmeticsShopModalProps> = ({
  meta,
  selectedArchetype,
  onPurchaseOrEquip,
  onEquip,
  onClose,
}) => {
  const [activeCategory, setActiveCategory] = useState<'all' | CosmeticCategory>('all');
  const [previewArchetype, setPreviewArchetype] = useState<ArchetypeId>(selectedArchetype);
  const [previewWeapon, setPreviewWeapon] = useState<WeaponKind>(
    ARCHETYPES[selectedArchetype].startingWeapon.weaponKind ?? 'greatsword'
  );
  const [previewItem, setPreviewItem] = useState<CosmeticItemDef | null>(null);
  const [rotatePreview, setRotatePreview] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const previewCosmetics: EquippedCosmetics = previewItem
    ? {
        ...meta.equippedCosmetics,
        [previewItem.category]: previewItem.id,
      }
    : meta.equippedCosmetics;

  // Live 60fps Canvas showcase of hero + equipped/previewed cosmetics
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
      const cssW = canvas.clientWidth || 260;
      const cssH = canvas.clientHeight || 220;
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, cssW, cssH);

      // Gothic slate showcase floor
      const bg = ctx.createRadialGradient(
        cssW * 0.5,
        cssH * 0.5,
        12,
        cssW * 0.5,
        cssH * 0.5,
        cssW * 0.65
      );
      bg.addColorStop(0, '#1A1F2D');
      bg.addColorStop(1, '#090A0E');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, cssW, cssH);

      // Subtle floor tile grid
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      for (let gx = 0; gx < cssW; gx += 32) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, cssH);
        ctx.stroke();
      }
      for (let gy = 0; gy < cssH; gy += 32) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(cssW, gy);
        ctx.stroke();
      }

      // Pedestal ring
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.22)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(cssW * 0.5, cssH * 0.58, 48, 20, 0, 0, Math.PI * 2);
      ctx.stroke();

      // Trail preview arc if a trail is previewed/equipped
      const activeTrail = getCosmeticById(previewCosmetics.trail);
      if (activeTrail) {
        const arcR = 42;
        const baseA = rotatePreview ? t * 1.15 : 0.25;
        ctx.strokeStyle = `${activeTrail.primaryColor}AA`;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(cssW * 0.5, cssH * 0.5, arcR, baseA - 0.65, baseA + 0.65);
        ctx.stroke();
      }

      ctx.save();
      ctx.translate(cssW * 0.5, cssH * 0.5);
      ctx.scale(1.65, 1.65);
      drawHeroSprite(ctx, {
        x: 0,
        y: 0,
        facing: rotatePreview ? t * 1.15 : 0.25,
        radius: 15,
        worldTime: t,
        archetype: previewArchetype,
        weaponKind: previewWeapon,
        cosmetics: previewCosmetics,
        isMoving: true,
      });
      ctx.restore();

      ctx.restore();
      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [previewArchetype, previewWeapon, previewCosmetics, rotatePreview]);

  const filteredItems =
    activeCategory === 'all'
      ? COSMETICS_CATALOG
      : COSMETICS_CATALOG.filter((item) => item.category === activeCategory);

  const unlockedCount = meta.unlockedCosmetics.length;
  const totalCount = COSMETICS_CATALOG.length;

  return (
    <div className="fixed inset-0 z-50 bg-black/82 flex items-center justify-center p-3 sm:p-5">
      <div className="w-full max-w-5xl max-h-[92dvh] bg-[#12151C] border border-[#2C3344] rounded-lg flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-[#232836] bg-[#0F1218]">
          <div>
            <div className="flex items-center gap-2.5">
              <Sparkles className="w-5 h-5 text-amber-400 shrink-0" />
              <h2 className="font-display text-lg sm:text-xl font-bold text-[#E5E0D5]">
                Bazar del Eclipse · Cosméticos
              </h2>
            </div>
            <p className="text-xs text-[#949BA8] mt-0.5">
              Personaliza tu armadura, auras, estelas de arma y familiares espectrales ({unlockedCount}/{totalCount} desbloqueados)
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="px-3 py-1.5 rounded bg-[#181C26] border border-violet-500/40 font-mono-num text-xs sm:text-sm font-semibold text-violet-300">
              {meta.soulShards} Fragmentos de Alma
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar tienda cosmética"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md bg-[#181C26] border border-[#2C3344] hover:border-[#475066] text-[#949BA8] hover:text-white cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto crypt-scroll grid grid-cols-1 lg:grid-cols-12">
          {/* Left Live Showcase */}
          <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-[#232836] p-4 sm:p-5 flex flex-col gap-3.5 bg-[#0E1117]">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-display font-semibold text-[#E5E0D5]">
                Vista Previa en Vivo
              </span>
              <button
                type="button"
                onClick={() => setRotatePreview((v) => !v)}
                className="min-h-[32px] px-2.5 py-1 rounded bg-[#181D29] border border-[#2C3344] text-[11px] text-[#D4CFC4] hover:border-amber-500/60 cursor-pointer"
              >
                {rotatePreview ? 'Pausar giro' : 'Girar héroe'}
              </button>
            </div>

            <div className="relative rounded-lg overflow-hidden border border-[#262D3D] bg-[#090A0E]">
              <canvas ref={canvasRef} className="w-full h-56 block" />
              {previewItem && (
                <div className="absolute bottom-2 inset-x-2 px-2.5 py-1.5 rounded bg-[#0B0D12]/90 border border-amber-500/45 flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-amber-300 truncate">
                    Probando: {previewItem.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPreviewItem(null)}
                    className="text-[#949BA8] hover:text-white shrink-0 cursor-pointer"
                  >
                    Restaurar
                  </button>
                </div>
              )}
            </div>

            {/* Archetype & Weapon Preview Switchers */}
            <div className="space-y-2">
              <div className="text-[11px] font-medium text-[#949BA8]">Arquetipo en vitrina</div>
              <div className="grid grid-cols-3 gap-1.5">
                {Object.values(ARCHETYPES).map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setPreviewArchetype(a.id)}
                    className={`min-h-[36px] px-2 py-1 rounded text-[11px] font-medium border cursor-pointer truncate ${
                      previewArchetype === a.id
                        ? 'bg-[#1D2434] border-amber-500/70 text-amber-300'
                        : 'bg-[#141821] border-[#262D3D] text-[#949BA8] hover:text-white'
                    }`}
                  >
                    {a.name.split(' ')[0]}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-[11px] font-medium text-[#949BA8]">Arma para probar estela</div>
              <div className="flex flex-wrap gap-1.5">
                {WEAPON_PREVIEWS.map((w) => (
                  <button
                    key={w.kind}
                    type="button"
                    onClick={() => setPreviewWeapon(w.kind)}
                    className={`min-h-[34px] px-2.5 py-1 rounded text-[11px] font-medium border cursor-pointer ${
                      previewWeapon === w.kind
                        ? 'bg-[#1D2434] border-violet-500/70 text-violet-200'
                        : 'bg-[#141821] border-[#262D3D] text-[#949BA8] hover:text-white'
                    }`}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Active Loadout Summary */}
            <div className="mt-auto pt-3 border-t border-[#232836] space-y-1.5 text-xs">
              <div className="text-[11px] font-medium text-[#949BA8]">Equipamiento actual</div>
              {(['skin', 'aura', 'trail', 'pet'] as CosmeticCategory[]).map((cat) => {
                const eq = getCosmeticById(meta.equippedCosmetics[cat]);
                return (
                  <div key={cat} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-[#949BA8]">{CATEGORY_LABEL[cat]}</span>
                    <span className="text-[#E5E0D5] font-medium truncate">
                      {eq?.name ?? 'Predeterminado'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Catalog Grid */}
          <div className="lg:col-span-8 p-4 sm:p-5 flex flex-col gap-4">
            {/* Category Tabs */}
            <div className="flex flex-wrap items-center gap-2">
              {CATEGORY_TABS.map((tab) => {
                const active = activeCategory === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveCategory(tab.id)}
                    className={`min-h-[40px] px-3.5 py-1.5 rounded-md text-xs font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
                      active
                        ? 'bg-amber-600 text-[#0B0C10] border-amber-500'
                        : 'bg-[#171B24] text-[#C2BDB2] border-[#2C3344] hover:border-[#475066] hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Item Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filteredItems.map((item) => {
                const unlocked = meta.unlockedCosmetics.includes(item.id);
                const equipped = meta.equippedCosmetics[item.category] === item.id;
                const canAfford = meta.soulShards >= item.cost;
                const rarityCol = RARITY_COLORS[item.rarity] ?? '#949BA8';
                const isPreviewing = previewItem?.id === item.id;

                return (
                  <div
                    key={item.id}
                    className={`p-3.5 rounded-lg border flex flex-col justify-between gap-3 transition-colors ${
                      equipped
                        ? 'bg-[#181E2B] border-amber-500/80'
                        : isPreviewing
                        ? 'bg-[#171B26] border-violet-400/70'
                        : 'bg-[#141821] border-[#262D3D] hover:border-[#3A4359]'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Dual-tone Color Swatch */}
                      <div
                        className="w-11 h-11 rounded-md border border-white/15 shrink-0 relative overflow-hidden"
                        style={{
                          background: `linear-gradient(135deg, ${item.primaryColor} 0%, ${item.secondaryColor} 65%, ${item.accentColor} 100%)`,
                        }}
                      >
                        <span
                          className="absolute bottom-1 right-1 w-2.5 h-2.5 rounded-sm border border-black/50"
                          style={{ backgroundColor: item.accentColor }}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="font-display text-sm font-bold text-[#E5E0D5] truncate">
                            {item.name}
                          </h3>
                          {equipped && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-300 shrink-0">
                              <Check className="w-3.5 h-3.5" />
                              Equipado
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-mono-num text-[#949BA8] mt-0.5">
                          <span>{CATEGORY_LABEL[item.category]}</span>
                          <span aria-hidden="true"> · </span>
                          <span style={{ color: rarityCol }}>{RARITY_LABELS[item.rarity]}</span>
                        </div>
                        <p className="text-xs text-[#C2BDB2] leading-snug mt-1.5">
                          {item.description}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#222836]">
                      <button
                        type="button"
                        onClick={() => setPreviewItem(isPreviewing ? null : item)}
                        className="min-h-[40px] px-3 py-1.5 rounded bg-[#1A202C] hover:bg-[#232B3B] border border-[#2E3648] text-xs font-medium text-[#D4CFC4] cursor-pointer whitespace-nowrap"
                      >
                        {isPreviewing ? 'Quitar prueba' : 'Probar'}
                      </button>

                      {unlocked ? (
                        <button
                          type="button"
                          disabled={equipped}
                          onClick={() => onEquip(item.category, item.id)}
                          className={`min-h-[40px] px-4 py-1.5 rounded text-xs font-semibold transition-colors whitespace-nowrap ${
                            equipped
                              ? 'bg-[#1D2430] text-amber-300/80 border border-amber-500/35 cursor-default'
                              : 'bg-amber-600 hover:bg-amber-500 text-[#0B0C10] cursor-pointer'
                          }`}
                        >
                          {equipped ? 'En uso' : 'Equipar'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={!canAfford}
                          onClick={() => onPurchaseOrEquip(item.id)}
                          className={`min-h-[40px] px-4 py-1.5 rounded text-xs font-semibold font-mono-num inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                            canAfford
                              ? 'bg-violet-600 hover:bg-violet-500 text-white cursor-pointer'
                              : 'bg-[#1A1D26] text-[#6B7280] border border-[#262C3A] cursor-not-allowed'
                          }`}
                        >
                          {!canAfford && <Lock className="w-3.5 h-3.5 shrink-0" />}
                          <span>Comprar · {item.cost} Almas</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
