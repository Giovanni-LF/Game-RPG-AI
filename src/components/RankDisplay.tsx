import React from 'react';
import { didPvpRankIncrease, getPvpTierInfo } from '../shared/pvp';
import type { PvpTierId } from '../types/game';

interface RankDisplayProps {
  elo: number;
  previousElo?: number;
  rankUp?: boolean;
  variant?: 'compact' | 'card' | 'celebration';
  wins?: number;
  losses?: number;
  winStreak?: number;
  showProgress?: boolean;
  className?: string;
}

interface TierVisualTheme {
  glowRgba: string;
  ringStroke: string;
  bgGradient: string;
  secondaryColor: string;
  highlightColor: string;
}

const TIER_THEMES: Record<PvpTierId, TierVisualTheme> = {
  bronze: {
    glowRgba: 'rgba(205, 127, 50, 0.45)',
    ringStroke: '#CD7F32',
    bgGradient: 'linear-gradient(135deg, rgba(120, 53, 15, 0.34), rgba(18, 21, 28, 0.96))',
    secondaryColor: '#92400E',
    highlightColor: '#FDBA74',
  },
  silver: {
    glowRgba: 'rgba(203, 213, 225, 0.48)',
    ringStroke: '#CBD5E1',
    bgGradient: 'linear-gradient(135deg, rgba(100, 116, 139, 0.32), rgba(18, 21, 28, 0.96))',
    secondaryColor: '#64748B',
    highlightColor: '#F8FAFC',
  },
  gold: {
    glowRgba: 'rgba(245, 158, 11, 0.55)',
    ringStroke: '#F59E0B',
    bgGradient: 'linear-gradient(135deg, rgba(180, 83, 9, 0.38), rgba(18, 21, 28, 0.96))',
    secondaryColor: '#B45309',
    highlightColor: '#FDE68A',
  },
  platinum: {
    glowRgba: 'rgba(45, 212, 191, 0.55)',
    ringStroke: '#2DD4BF',
    bgGradient: 'linear-gradient(135deg, rgba(15, 118, 110, 0.38), rgba(18, 21, 28, 0.96))',
    secondaryColor: '#0F766E',
    highlightColor: '#99F6E4',
  },
  diamond: {
    glowRgba: 'rgba(96, 165, 250, 0.62)',
    ringStroke: '#60A5FA',
    bgGradient: 'linear-gradient(135deg, rgba(37, 99, 235, 0.4), rgba(18, 21, 28, 0.96))',
    secondaryColor: '#2563EB',
    highlightColor: '#DBEAFE',
  },
};

export const RankEmblemSvg: React.FC<{
  tierId: PvpTierId;
  size?: number;
  glowing?: boolean;
}> = ({ tierId, size = 40, glowing = false }) => {
  const theme = TIER_THEMES[tierId] ?? TIER_THEMES.bronze;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 ${glowing ? 'rank-up-crest-anim' : ''}`}
      style={
        glowing
          ? { filter: `drop-shadow(0 0 10px ${theme.glowRgba})` }
          : undefined
      }
    >
      {/* Outer metallic frame */}
      <path
        d="M24 3L41 11V24C41 34.4 33.6 41.8 24 45C14.4 41.8 7 34.4 7 24V11L24 3Z"
        fill="#0E1117"
        stroke={theme.ringStroke}
        strokeWidth="2.2"
      />
      <path
        d="M24 7L37 13.2V23.8C37 32.1 31.3 38 24 40.8C16.7 38 11 32.1 11 23.8V13.2L24 7Z"
        fill={`${theme.secondaryColor}33`}
        stroke={theme.highlightColor}
        strokeOpacity="0.45"
        strokeWidth="1"
      />

      {tierId === 'bronze' && (
        <>
          <path d="M24 14V33" stroke={theme.highlightColor} strokeWidth="2.2" strokeLinecap="round" />
          <path d="M17 21H31" stroke={theme.ringStroke} strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="24" cy="21" r="3" fill={theme.ringStroke} />
        </>
      )}

      {tierId === 'silver' && (
        <>
          <path
            d="M15 26L24 14L33 26L24 34L15 26Z"
            fill={`${theme.ringStroke}35`}
            stroke={theme.highlightColor}
            strokeWidth="1.8"
          />
          <path d="M24 11V37" stroke={theme.highlightColor} strokeWidth="1.8" strokeLinecap="round" />
        </>
      )}

      {tierId === 'gold' && (
        <>
          <path
            d="M14 29L17 17L24 22L31 17L34 29H14Z"
            fill={`${theme.ringStroke}45`}
            stroke={theme.highlightColor}
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <circle cx="24" cy="14" r="2.2" fill={theme.highlightColor} />
          <path d="M15 33H33" stroke={theme.ringStroke} strokeWidth="2" strokeLinecap="round" />
        </>
      )}

      {tierId === 'platinum' && (
        <>
          <path
            d="M24 11L29 20L38 24L29 28L24 37L19 28L10 24L19 20L24 11Z"
            fill={`${theme.ringStroke}38`}
            stroke={theme.highlightColor}
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <circle cx="24" cy="24" r="3.4" fill={theme.highlightColor} />
        </>
      )}

      {tierId === 'diamond' && (
        <>
          <path
            d="M24 10L35 20L24 37L13 20L24 10Z"
            fill={`${theme.ringStroke}44`}
            stroke={theme.highlightColor}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path d="M13 20H35M24 10L20 20L24 37L28 20L24 10Z" stroke={theme.highlightColor} strokeOpacity="0.7" strokeWidth="1.2" />
          <circle cx="24" cy="20" r="2.2" fill="#FFFFFF" />
        </>
      )}
    </svg>
  );
};

export const RankDisplay: React.FC<RankDisplayProps> = ({
  elo,
  previousElo,
  rankUp,
  variant = 'card',
  wins,
  losses,
  winStreak,
  showProgress = true,
  className = '',
}) => {
  const safeElo = Math.max(600, Math.round(elo));
  const tier = getPvpTierInfo(safeElo);
  const prevTier = previousElo !== undefined ? getPvpTierInfo(previousElo) : null;
  const promoted = Boolean(
    rankUp || (previousElo !== undefined && didPvpRankIncrease(previousElo, safeElo))
  );
  const theme = TIER_THEMES[tier.id] ?? TIER_THEMES.bronze;

  const span = tier.nextElo ? Math.max(1, tier.nextElo - tier.minElo) : 1;
  const progressPct = tier.nextElo
    ? Math.max(4, Math.min(100, ((safeElo - tier.minElo) / span) * 100))
    : 100;

  if (variant === 'compact') {
    return (
      <div
        className={`inline-flex items-center gap-2 min-w-0 ${
          promoted ? 'rank-up-glow-card rounded-md px-2 py-1' : ''
        } ${className}`}
        style={
          promoted
            ? {
                boxShadow: `0 0 18px ${theme.glowRgba}`,
                border: `1px solid ${theme.ringStroke}`,
                background: theme.bgGradient,
              }
            : undefined
        }
      >
        {promoted && <span className="rank-up-shimmer" aria-hidden="true" />}
        <RankEmblemSvg tierId={tier.id} size={24} glowing={promoted} />
        <span className="font-display text-xs font-bold truncate" style={{ color: tier.color }}>
          {tier.name}
        </span>
        <span aria-hidden="true" className="text-[#475066] text-xs">·</span>
        <span className="font-mono-num text-xs font-semibold text-[#E5E0D5] whitespace-nowrap">
          {safeElo} ELO
        </span>
      </div>
    );
  }

  const eloDelta = previousElo !== undefined ? safeElo - Math.round(previousElo) : null;

  return (
    <div
      role={promoted ? 'status' : undefined}
      className={`rounded-lg border p-3.5 transition-shadow ${
        promoted ? 'rank-up-glow-card' : 'bg-[#151923] border-[#262C3C]'
      } ${className}`}
      style={
        promoted
          ? {
              borderColor: theme.ringStroke,
              background: theme.bgGradient,
              boxShadow: `0 0 26px ${theme.glowRgba}, inset 0 0 16px ${theme.glowRgba}`,
            }
          : undefined
      }
    >
      {promoted && <span className="rank-up-shimmer" aria-hidden="true" />}

      <div className="relative z-10 flex items-center gap-3.5">
        <RankEmblemSvg
          tierId={tier.id}
          size={variant === 'celebration' ? 52 : 46}
          glowing={promoted}
        />

        <div className="min-w-0 flex-1 space-y-1">
          {promoted && (
            <div
              className="text-[11px] font-display font-bold tracking-wide"
              style={{ color: theme.highlightColor }}
            >
              ¡Ascenso de Rango!
              {prevTier && prevTier.id !== tier.id ? ` · ${prevTier.name} → ${tier.name}` : ` · ${tier.name}`}
            </div>
          )}

          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex flex-wrap items-baseline gap-2 min-w-0">
              <span
                className="font-display text-base font-bold truncate"
                style={{ color: tier.color }}
              >
                {tier.name}
              </span>
              <span aria-hidden="true" className="text-[#475066] text-xs">·</span>
              <span className="font-mono-num text-sm font-bold text-[#E5E0D5]">
                {safeElo} ELO
              </span>
              {eloDelta !== null && (
                <span
                  className={`font-mono-num text-xs font-semibold ${
                    eloDelta >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  ({eloDelta >= 0 ? `+${eloDelta}` : eloDelta})
                </span>
              )}
            </div>

            {wins !== undefined && losses !== undefined && (
              <div className="text-[11px] font-mono-num text-[#949BA8] whitespace-nowrap">
                {wins}V - {losses}D
                {winStreak && winStreak > 0 ? ` · Racha ${winStreak}` : ''}
              </div>
            )}
          </div>

          <div className="text-[11px] text-[#949BA8] truncate">
            Título: <span className="text-[#D4CFC4]">{tier.title}</span>
          </div>

          {showProgress && (
            <div className="pt-1 space-y-1">
              <div className="h-1.5 w-full bg-[#0E1117] rounded-sm overflow-hidden border border-[#232836]">
                <div
                  className="h-full transition-all duration-300"
                  style={{
                    width: `${progressPct}%`,
                    backgroundColor: tier.color,
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] font-mono-num text-[#949BA8]">
                <span>{tier.minElo} ELO</span>
                <span>
                  {tier.nextElo
                    ? `Faltan ${Math.max(0, tier.nextElo - safeElo)} ELO para ${getPvpTierInfo(tier.nextElo).name}`
                    : 'División máxima alcanzada'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
