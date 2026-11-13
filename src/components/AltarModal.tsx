import React from 'react';
import { X } from 'lucide-react';
import altarArt from '../assets/images/altar_sanctum_art_1794586357332.jpg';
import { ETERNAL_BLESSINGS, getBlessingCost } from '../data/gameData';
import { BlessingId, MetaSaveData } from '../types/game';

interface AltarModalProps {
  meta: MetaSaveData;
  onBuyBlessing: (id: BlessingId) => void;
  onClose: () => void;
}

export const AltarModal: React.FC<AltarModalProps> = ({ meta, onBuyBlessing, onClose }) => {
  return (
    <div className="fixed inset-0 z-40 bg-black/80 flex items-center justify-center sm:p-4 md:p-8">
      <div className="w-full max-w-5xl h-[100dvh] sm:h-auto sm:max-h-[90dvh] bg-[#12151C] sm:border border-[#2C3344] sm:rounded-lg overflow-hidden grid grid-cols-1 lg:grid-cols-12">
        {/* Left Atmospheric Art Panel */}
        <div className="lg:col-span-5 relative h-44 sm:h-52 lg:h-full bg-[#0B0C10]">
          <img
            src={altarArt}
            alt="Altar rúnico de las criptas"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, rgba(11,12,16,0.2) 0%, rgba(18,21,28,0.94) 100%)',
            }}
          />
          <div className="absolute bottom-4 left-4 right-4 sm:bottom-5 sm:left-5 sm:right-5 space-y-1.5">
            <h2 className="font-display text-xl sm:text-2xl font-bold text-[#E5E0D5]">Altar Eterno</h2>
            <p className="text-xs text-[#C2BDB2] leading-relaxed line-clamp-2 sm:line-clamp-none">
              Ofrenda Fragmentos de Alma recuperados en tus incursiones para grabar bendiciones permanentes en tu estirpe.
            </p>
            <div className="pt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono-num text-amber-400">
              <span>Almas disponibles: {meta.soulShards}</span>
              <span aria-hidden="true">·</span>
              <span className="text-[#949BA8]">Clases forjadas: {meta.unlockedClassTitles.length}</span>
            </div>
          </div>
        </div>

        {/* Right Blessings & Run History */}
        <div className="lg:col-span-7 flex flex-col min-h-0 flex-1">
          <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-[#232836]">
            <div>
              <h3 className="font-display text-base sm:text-lg font-bold text-[#E5E0D5]">Bendiciones Permanentes</h3>
              <p className="text-xs text-[#949BA8]">Se aplican automáticamente al inicio de cada partida</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar altar"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[#949BA8] hover:text-white rounded-md hover:bg-[#1C212D] transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-4 sm:p-6 space-y-6 overflow-y-auto crypt-scroll flex-1">
            <div className="space-y-3">
              {ETERNAL_BLESSINGS.map((b) => {
                const lvl = meta.blessings[b.id] ?? 0;
                const maxed = lvl >= b.maxLevel;
                const cost = getBlessingCost(b, lvl);
                const canAfford = !maxed && meta.soulShards >= cost;

                return (
                  <div
                    key={b.id}
                    className="p-4 rounded-md bg-[#181C26] border border-[#262C3B] flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2.5">
                        <span className="text-sm font-semibold text-[#E5E0D5]">{b.name}</span>
                        <span className="text-xs font-mono-num text-amber-400">
                          Nv. {lvl}/{b.maxLevel}
                        </span>
                      </div>
                      <p className="text-xs text-[#949BA8]">{b.description}</p>
                      <p className="text-xs font-mono-num text-emerald-400">{b.bonusPerLevelLabel}</p>
                    </div>
                    <button
                      type="button"
                      disabled={!canAfford}
                      onClick={() => onBuyBlessing(b.id)}
                      className={`min-h-[44px] px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                        maxed
                          ? 'bg-[#12151C] text-[#6B7280] border border-[#232836] cursor-default'
                          : canAfford
                          ? 'bg-amber-600 hover:bg-amber-500 text-[#0B0C10] cursor-pointer'
                          : 'bg-[#12151C] text-[#6B7280] border border-[#2C3344] cursor-not-allowed'
                      }`}
                    >
                      {maxed ? 'Nivel Máximo' : `Mejorar (${cost} Almas)`}
                    </button>
                  </div>
                );
              })}
            </div>

            {meta.recentRuns.length > 0 && (
              <div className="space-y-2.5 pt-2 border-t border-[#232836]">
                <h4 className="text-xs font-semibold text-[#949BA8]">Incursiones recientes</h4>
                <div className="space-y-1.5">
                  {meta.recentRuns.slice(0, 4).map((run) => (
                    <div
                      key={run.id}
                      className="flex items-center justify-between text-xs py-2 px-3 bg-[#151821] rounded border border-[#232836]"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={run.victory ? 'text-amber-400 font-semibold' : 'text-[#C2BDB2]'}>
                          {run.victory ? 'Victoria' : 'Caída'}
                        </span>
                        <span aria-hidden="true" className="text-[#475066]">·</span>
                        <span className="text-[#E5E0D5] truncate">{run.classTitle}</span>
                      </div>
                      <div className="flex items-center gap-3 font-mono-num text-[#949BA8] shrink-0">
                        <span>Piso {run.floorReached}</span>
                        <span>{run.kills} bajas</span>
                        <span className="text-violet-400">+{run.soulsEarned} Almas</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
