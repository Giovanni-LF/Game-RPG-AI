import React, { useState } from 'react';
import { Check, Lock, Trophy, X } from 'lucide-react';
import { ACHIEVEMENTS_CATALOG } from '../data/gameData';
import type { AchievementCategory, MetaSaveData } from '../types/game';

interface AchievementsModalProps {
  meta: MetaSaveData;
  onClose: () => void;
}

const CATEGORY_TABS: Array<{ id: 'all' | AchievementCategory; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'combat', label: 'Combate' },
  { id: 'exploration', label: 'Exploración' },
  { id: 'mastery', label: 'Maestría' },
  { id: 'collection', label: 'Colección' },
];

const CATEGORY_LABEL: Record<AchievementCategory, string> = {
  combat: 'Combate',
  exploration: 'Exploración',
  mastery: 'Maestría',
  collection: 'Colección',
};

export const AchievementsModal: React.FC<AchievementsModalProps> = ({ meta, onClose }) => {
  const [filter, setFilter] = useState<'all' | AchievementCategory>('all');

  const unlockedCount = meta.unlockedAchievements.length;
  const totalCount = ACHIEVEMENTS_CATALOG.length;
  const completionPct = totalCount > 0 ? Math.round((unlockedCount / totalCount) * 100) : 0;
  const earnedSoulsFromAchievements = ACHIEVEMENTS_CATALOG.filter((a) =>
    meta.unlockedAchievements.includes(a.id)
  ).reduce((acc, a) => acc + a.rewardSouls, 0);

  const visibleItems =
    filter === 'all'
      ? ACHIEVEMENTS_CATALOG
      : ACHIEVEMENTS_CATALOG.filter((a) => a.category === filter);

  return (
    <div className="fixed inset-0 z-50 bg-black/82 flex items-center justify-center p-3 sm:p-5">
      <div className="w-full max-w-4xl max-h-[92dvh] bg-[#12151C] border border-[#2C3344] rounded-lg flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-[#232836] bg-[#0F1218]">
          <div>
            <div className="flex items-center gap-2.5">
              <Trophy className="w-5 h-5 text-amber-400 shrink-0" />
              <h2 className="font-display text-lg sm:text-xl font-bold text-[#E5E0D5]">
                Hazañas del Eclipse · Logros
              </h2>
            </div>
            <p className="text-xs text-[#949BA8] mt-0.5 font-mono-num">
              {unlockedCount}/{totalCount} desbloqueados ({completionPct}%) · +{earnedSoulsFromAchievements} Fragmentos ganados
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar logros"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md bg-[#181C26] border border-[#2C3344] hover:border-[#475066] text-[#949BA8] hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Overall Completion Bar + Filters */}
        <div className="px-4 sm:px-6 py-3.5 border-b border-[#202634] bg-[#0E1117] space-y-3">
          <div className="h-2 w-full bg-[#191E29] rounded-sm overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-600 to-amber-400 transition-all duration-300"
              style={{ width: `${completionPct}%` }}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {CATEGORY_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`min-h-[40px] px-3.5 py-1.5 rounded-md text-xs font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
                  filter === tab.id
                    ? 'bg-amber-600 text-[#0B0C10] border-amber-500'
                    : 'bg-[#171B24] text-[#C2BDB2] border-[#2C3344] hover:border-[#475066] hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Achievement Cards */}
        <div className="flex-1 overflow-y-auto crypt-scroll p-4 sm:p-6 grid grid-cols-1 md:grid-cols-2 gap-3">
          {visibleItems.map((ach) => {
            const unlocked = meta.unlockedAchievements.includes(ach.id);
            const rawVal = meta.achievementStats[ach.statKey] ?? 0;
            const currentVal = unlocked ? ach.target : Math.min(ach.target, rawVal);
            const pct = Math.max(0, Math.min(100, (currentVal / Math.max(1, ach.target)) * 100));

            return (
              <div
                key={ach.id}
                className={`p-4 rounded-lg border flex flex-col justify-between gap-3 ${
                  unlocked
                    ? 'bg-[#171D28] border-amber-500/65'
                    : 'bg-[#141821] border-[#262D3D]'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`w-10 h-10 rounded-md border flex items-center justify-center shrink-0 ${
                      unlocked
                        ? 'bg-[#231D12] border-amber-500/70 text-amber-300'
                        : 'bg-[#10131A] border-[#262D3D] text-[#6B7280]'
                    }`}
                  >
                    {unlocked ? <Trophy className="w-5 h-5" /> : <Lock className="w-4 h-4" />}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-display text-sm font-bold text-[#E5E0D5] truncate">
                        {ach.name}
                      </h3>
                      {unlocked && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 shrink-0">
                          <Check className="w-3.5 h-3.5" />
                          Completado
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-mono-num text-[#949BA8] mt-0.5">
                      <span>{CATEGORY_LABEL[ach.category]}</span>
                      <span aria-hidden="true"> · </span>
                      <span className="text-violet-300">+{ach.rewardSouls} Almas</span>
                    </div>
                    <p className="text-xs text-[#C2BDB2] leading-snug mt-1.5">
                      {ach.description}
                    </p>
                  </div>
                </div>

                {/* Progress Track */}
                <div className="space-y-1 pt-1">
                  <div className="flex items-center justify-between text-[11px] font-mono-num text-[#949BA8]">
                    <span>Progreso</span>
                    <span className={unlocked ? 'text-amber-300 font-semibold' : ''}>
                      {currentVal}/{ach.target}
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-[#0D1017] rounded-sm overflow-hidden">
                    <div
                      className="h-full transition-all duration-300"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: unlocked ? '#F59E0B' : ach.accentColor,
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
