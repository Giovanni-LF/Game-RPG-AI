import React, { useState } from 'react';
import { BookMarked, Check, Copy, Dices, Gamepad2, Music, Play, Save, Sparkles, Swords, Trophy, Users, Volume2, VolumeX, WifiOff } from 'lucide-react';
import titleBackdrop from '../assets/images/title_crypt_backdrop_1794586357122.jpg';
import { ACHIEVEMENTS_CATALOG, ARCHETYPES, computeHybridClassTitle, ENEMY_DEFINITIONS, getCosmeticById } from '../data/gameData';
import { APP_VERSION } from '../shared/protocol';
import { ActiveRunSave, ArchetypeId, MetaSaveData } from '../types/game';
import { PWAInstallButton } from './PWAInstallButton';
import { RankDisplay } from './RankDisplay';

interface TitleScreenProps {
  selectedArchetype: ArchetypeId;
  onSelectArchetype: (id: ArchetypeId) => void;
  runSeedLabel: string;
  onChangeRunSeed: (val: string) => void;
  onRandomizeRunSeed: () => void;
  onStartGame: () => void;
  onResumeRun: () => void;
  onOpenLocalCoop: () => void;
  onOpenCoop: () => void;
  onOpenPvp: () => void;
  onOpenAltar: () => void;
  onOpenShop: () => void;
  onOpenBestiary: () => void;
  onOpenAchievements: () => void;
  onOpenSaveManager: () => void;
  activeSlotName: string;
  activeRun: ActiveRunSave | null;
  isOnline: boolean;
  meta: MetaSaveData;
  recentRankUp?: { eloBefore: number; eloAfter: number } | null;
  musicEnabled: boolean;
  onToggleMusic: () => void;
  onToggleMute: () => void;
}

function ArchetypeEmblem({ id, color }: { id: ArchetypeId; color: string }) {
  if (id === 'crusader') {
    return (
      <svg viewBox="0 0 40 40" className="w-9 h-9 shrink-0" fill="none" aria-hidden="true">
        <path
          d="M20 4L33 10V20C33 28.5 27.2 34.5 20 37C12.8 34.5 7 28.5 7 20V10L20 4Z"
          stroke={color}
          strokeWidth="2"
          fill={`${color}18`}
        />
        <path d="M20 10V29M13 18H27" stroke="#E5E0D5" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (id === 'stalker') {
    return (
      <svg viewBox="0 0 40 40" className="w-9 h-9 shrink-0" fill="none" aria-hidden="true">
        <path
          d="M9 31L29 9L31 11L13 33L9 31Z"
          stroke={color}
          strokeWidth="2"
          fill={`${color}22`}
        />
        <path
          d="M31 31L11 9L9 11L27 33L31 31Z"
          stroke="#E5E0D5"
          strokeWidth="1.75"
          fill="rgba(229,224,213,0.08)"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 40 40" className="w-9 h-9 shrink-0" fill="none" aria-hidden="true">
      <circle cx="20" cy="20" r="13" stroke={color} strokeWidth="2" fill={`${color}18`} />
      <circle cx="23" cy="18" r="7" fill="#0B0C10" />
      <path d="M20 4V9M20 31V36M4 20H9M31 20H36" stroke="#F59E0B" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

export const TitleScreen: React.FC<TitleScreenProps> = ({
  selectedArchetype,
  onSelectArchetype,
  runSeedLabel,
  onChangeRunSeed,
  onRandomizeRunSeed,
  onStartGame,
  onResumeRun,
  onOpenLocalCoop,
  onOpenCoop,
  onOpenPvp,
  onOpenAltar,
  onOpenShop,
  onOpenBestiary,
  onOpenAchievements,
  onOpenSaveManager,
  activeSlotName,
  activeRun,
  isOnline,
  meta,
  recentRankUp,
  musicEnabled,
  onToggleMusic,
  onToggleMute,
}) => {
  const archetypeList = Object.values(ARCHETYPES);
  const [confirmOverwriteNew, setConfirmOverwriteNew] = useState(false);
  const [copiedSeed, setCopiedSeed] = useState(false);
  const equippedSkin = getCosmeticById(meta.equippedCosmetics.skin);
  const totalBestiaryCount = Object.keys(ENEMY_DEFINITIONS).length;
  const discoveredBestiaryCount = meta.discoveredEnemies.length;

  const handleCopySeed = () => {
    const text = runSeedLabel.trim();
    if (!text) return;
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedSeed(true);
    window.setTimeout(() => setCopiedSeed(false), 1600);
  };

  const savedClassTitle = activeRun
    ? computeHybridClassTitle(activeRun.p1.archetype, activeRun.p1.unlockedNodeIds)
    : '';

  const handleClickNewRun = () => {
    if (activeRun && !confirmOverwriteNew) {
      setConfirmOverwriteNew(true);
      return;
    }
    setConfirmOverwriteNew(false);
    onStartGame();
  };

  return (
    <div className="relative w-full h-[100dvh] overflow-y-auto crypt-scroll bg-gradient-to-br from-[#0B0C10] via-[#12151C] to-[#1A1421]">
      {/* Key-Art Backdrop (fixed behind scroll) */}
      <img
        src={titleBackdrop}
        alt="Entrada de las Criptas del Eclipse"
        referrerPolicy="no-referrer"
        className="fixed inset-0 w-full h-full object-cover object-center opacity-75 pointer-events-none select-none"
      />
      {/* Left-focused directional scrim for crisp readability */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(90deg, rgba(11,12,16,0.95) 0%, rgba(11,12,16,0.85) 48%, rgba(11,12,16,0.45) 100%)',
        }}
      />

      <div className="relative z-10 min-h-full flex flex-col justify-between gap-6">
        {/* Top utility row */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-8 pt-4 sm:pt-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#949BA8] font-mono-num">
            <span>Fragmentos de Alma: {meta.soulShards}</span>
            <span aria-hidden="true">·</span>
            <span>Piso máx: {meta.bestFloor || 0}</span>
            <span aria-hidden="true">·</span>
            <span>Abatidos: {meta.totalKills}</span>
            <span aria-hidden="true">·</span>
            <span className="text-[#D4CFC4]">v{APP_VERSION}</span>
            {!isOnline && (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1 text-amber-300">
                  <WifiOff className="w-3.5 h-3.5" />
                  <span>Sin internet · Hotspot y Modo Local listos</span>
                </span>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onOpenSaveManager}
              className="inline-flex items-center gap-2 min-h-[44px] px-3.5 py-2 text-xs font-medium text-[#E5E0D5] bg-[#141821]/90 border border-amber-500/45 rounded-md hover:border-amber-400 hover:text-white transition-colors cursor-pointer"
            >
              <Save className="w-4 h-4 text-amber-400" />
              <span className="whitespace-nowrap">{activeSlotName} · Guardado</span>
            </button>
            <PWAInstallButton />
            <button
              type="button"
              onClick={onToggleMusic}
              aria-label={musicEnabled ? 'Desactivar música' : 'Activar música'}
              className={`inline-flex items-center gap-2 min-h-[44px] px-3.5 py-2 text-xs font-medium bg-[#141821]/90 border rounded-md transition-colors cursor-pointer ${
                musicEnabled && !meta.muted
                  ? 'text-amber-200 border-amber-500/45 hover:border-amber-400'
                  : 'text-[#949BA8] border-[#2C3344] hover:border-[#475066] hover:text-white'
              }`}
            >
              <Music className="w-4 h-4" />
              <span className="whitespace-nowrap">{musicEnabled ? 'Música' : 'Sin música'}</span>
            </button>
            <button
              type="button"
              onClick={onToggleMute}
              aria-label={meta.muted ? 'Activar sonido' : 'Silenciar sonido'}
              className="inline-flex items-center gap-2 min-h-[44px] px-3.5 py-2 text-xs font-medium text-[#D4CFC4] bg-[#141821]/90 border border-[#2C3344] rounded-md hover:border-[#475066] hover:text-white transition-colors cursor-pointer"
            >
              {meta.muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              <span className="whitespace-nowrap">{meta.muted ? 'Silenciado' : 'Audio activo'}</span>
            </button>
          </div>
        </div>

        {/* Main Left-Aligned Hero & Archetype Selection */}
        <div className="flex-1 flex items-center px-4 sm:px-8 md:px-14 max-w-4xl">
          <div className="w-full space-y-5 sm:space-y-6">
            {/* Bespoke SVG Title Lockup */}
            <div>
              <svg
                viewBox="0 0 540 88"
                className="w-full max-w-[520px] h-auto"
                role="img"
                aria-label="Criptas del Eclipse"
              >
                <circle cx="38" cy="44" r="24" stroke="#D97706" strokeWidth="2.5" fill="#12151C" />
                <circle cx="45" cy="40" r="17" fill="#0B0C10" />
                <path
                  d="M38 12V20M38 68V76M6 44H14M62 44H70"
                  stroke="#D97706"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <text
                  x="84"
                  y="45"
                  fill="#E5E0D5"
                  fontFamily="Cinzel, Georgia, serif"
                  fontSize="34"
                  fontWeight="700"
                  letterSpacing="2"
                >
                  CRIPTAS DEL ECLIPSE
                </text>
                <line x1="84" y1="56" x2="495" y2="56" stroke="#2C3344" strokeWidth="1" />
                <text
                  x="84"
                  y="75"
                  fill="#949BA8"
                  fontFamily="Plus Jakarta Sans, sans-serif"
                  fontSize="13"
                  fontWeight="500"
                  letterSpacing="1.2"
                >
                  Mazmorras procedurales · Combate en tiempo real · Clases híbridas
                </text>
              </svg>
            </div>

            {/* Active Suspended Run Card */}
            {activeRun && (
              <div className="p-3.5 sm:p-4 rounded-lg bg-[#151A25]/95 border border-amber-500/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-0.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-amber-300">
                      Partida Guardada · Piso {activeRun.floor.floorNumber} ({activeRun.floor.name})
                    </span>
                    {activeRun.localCoopMode && (
                      <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-sky-500/15 border border-sky-500/40 text-sky-300 rounded">
                        2J Local
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#C2BDB2] font-mono-num truncate">
                    {savedClassTitle} · Nv. {activeRun.p1.level} · {Math.ceil(activeRun.p1.hp)} PV · {activeRun.kills} abatidos · {activeRun.gold} oro
                    {activeRun.runSeedLabel ? ` · Sem. ${activeRun.runSeedLabel}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmOverwriteNew(false);
                    onResumeRun();
                  }}
                  className="min-h-[44px] px-5 py-2.5 bg-amber-600 hover:bg-amber-500 active:bg-amber-400 text-[#0B0C10] font-semibold text-sm rounded-md transition-colors cursor-pointer whitespace-nowrap inline-flex items-center justify-center gap-2 shrink-0"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>Continuar Incursión</span>
                </button>
              </div>
            )}

            {/* Archetype Selector */}
            <div className="space-y-2.5">
              <p className="text-xs font-medium text-[#949BA8]">
                Elige tu arquetipo inicial (podrás combinar todas las sendas en partida)
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {archetypeList.map((arch) => {
                  const active = selectedArchetype === arch.id;
                  return (
                    <button
                      key={arch.id}
                      type="button"
                      onClick={() => onSelectArchetype(arch.id)}
                      className={`text-left p-3.5 sm:p-4 rounded-lg border transition-all cursor-pointer min-h-[44px] ${
                        active
                          ? 'bg-[#1A1F2B] border-amber-500/80 shadow-[0_0_0_1px_rgba(245,158,11,0.3)]'
                          : 'bg-[#12151C]/90 border-[#2C3344] hover:border-[#475066] hover:bg-[#171B24]'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <ArchetypeEmblem id={arch.id} color={arch.accentColor} />
                        <div className="min-w-0">
                          <h3 className="font-display text-sm font-bold text-[#E5E0D5] truncate">
                            {arch.name}
                          </h3>
                          <p className="text-xs text-[#949BA8] mt-0.5">{arch.subtitle}</p>
                        </div>
                      </div>
                      <p className="text-xs text-[#C2BDB2] leading-relaxed mt-2.5 line-clamp-3">
                        {arch.description}
                      </p>
                      <div className="mt-2.5 pt-2 border-t border-[#232836] flex items-center justify-between text-[11px] font-mono-num text-[#949BA8]">
                        <span>Vida {arch.baseStats.maxHp}</span>
                        <span>Daño {arch.baseStats.baseDamage}</span>
                        <span>Arcano {arch.baseStats.arcanePower}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Inline Overwrite Notice when Active Run Exists */}
            {confirmOverwriteNew && activeRun && (
              <div className="p-3.5 rounded-lg bg-[#1A1518] border border-amber-500/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <p className="text-[#E5E0D5]">
                  Ya tienes una incursión guardada en <strong>Piso {activeRun.floor.floorNumber}</strong>. ¿Iniciar una nueva partida y reemplazarla?
                </p>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleClickNewRun}
                    className="min-h-[40px] px-3.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-[#0B0C10] font-semibold rounded cursor-pointer"
                  >
                    Sí, nueva incursión
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmOverwriteNew(false)}
                    className="min-h-[40px] px-3.5 py-1.5 bg-[#1B202C] text-[#C2BDB2] rounded cursor-pointer"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {/* Shared Deterministic Run Seed Selector */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-lg bg-[#12151C]/90 border border-[#262C3C]">
              <div className="min-w-0">
                <label htmlFor="title-run-seed" className="block text-xs font-medium text-[#D4CFC4]">
                  Semilla compartida de mazmorra
                </label>
                <p className="text-[11px] text-[#949BA8]">
                  Comparte el mismo código para generar salas, enemigos y botín idénticos en Solo, Local o Red
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <input
                  id="title-run-seed"
                  type="text"
                  maxLength={24}
                  value={runSeedLabel}
                  onChange={(e) => onChangeRunSeed(e.target.value)}
                  placeholder="ECLIPSE-XXXX"
                  className="w-36 sm:w-40 min-h-[44px] px-3 py-1.5 rounded-md bg-[#0B0D12] border border-[#2C3344] focus:border-amber-500/80 focus:outline-none text-xs font-mono-num uppercase tracking-wider text-amber-300"
                />
                <button
                  type="button"
                  onClick={onRandomizeRunSeed}
                  title="Generar nueva semilla aleatoria"
                  aria-label="Generar nueva semilla aleatoria"
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md bg-[#181D29] border border-[#2C3344] hover:border-amber-500/60 text-[#E5E0D5] cursor-pointer"
                >
                  <Dices className="w-4 h-4 text-amber-400" />
                </button>
                <button
                  type="button"
                  onClick={handleCopySeed}
                  title="Copiar semilla"
                  aria-label="Copiar semilla"
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md bg-[#181D29] border border-[#2C3344] hover:border-amber-500/60 text-[#E5E0D5] cursor-pointer"
                >
                  {copiedSeed ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4 text-[#949BA8]" />
                  )}
                </button>
              </div>
            </div>

            {/* Primary Actions */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleClickNewRun}
                className={`min-h-[48px] px-6 py-3 font-semibold text-sm rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  activeRun
                    ? 'bg-[#1D222F] hover:bg-[#272E3F] text-[#E5E0D5] border border-amber-500/50'
                    : 'bg-amber-600 hover:bg-amber-500 active:bg-amber-400 text-[#0B0C10]'
                }`}
              >
                {activeRun ? 'Nueva Incursión' : 'Entrar a la Cripta'}
              </button>
              <button
                type="button"
                onClick={onOpenCoop}
                className="min-h-[48px] px-5 py-3 bg-[#1B1829] hover:bg-[#241F36] text-[#E5E0D5] border border-violet-500/60 hover:border-violet-400 font-semibold text-sm rounded-md transition-colors cursor-pointer whitespace-nowrap inline-flex items-center justify-center gap-2"
              >
                <Users className="w-4 h-4 text-violet-300" />
                <span>Cooperativo Red / Hotspot</span>
              </button>
              <button
                type="button"
                onClick={onOpenLocalCoop}
                className="min-h-[48px] px-5 py-3 bg-[#13202E] hover:bg-[#192B3D] text-[#E5E0D5] border border-sky-500/60 hover:border-sky-400 font-semibold text-sm rounded-md transition-colors cursor-pointer whitespace-nowrap inline-flex items-center justify-center gap-2"
              >
                <Gamepad2 className="w-4 h-4 text-sky-400" />
                <span>2 Jugadores Mismo Equipo</span>
              </button>
              <button
                type="button"
                onClick={onOpenPvp}
                className="min-h-[48px] px-4 py-2 bg-[#241319] hover:bg-[#311820] text-[#E5E0D5] border border-red-500/65 hover:border-red-400 font-semibold text-sm rounded-md transition-colors cursor-pointer whitespace-nowrap inline-flex items-center justify-center gap-2.5"
              >
                <Swords className="w-4 h-4 text-red-400 shrink-0" />
                <span>Arena PvP</span>
                <RankDisplay
                  elo={meta.pvpElo}
                  previousElo={recentRankUp?.eloBefore}
                  rankUp={Boolean(recentRankUp)}
                  variant="compact"
                />
              </button>
              <button
                type="button"
                onClick={onOpenAltar}
                className="min-h-[48px] px-5 py-3 bg-[#171B24] hover:bg-[#1F2533] text-[#E5E0D5] border border-[#2C3344] hover:border-[#475066] font-medium text-sm rounded-md transition-colors cursor-pointer whitespace-nowrap"
              >
                Altar Eterno ({meta.soulShards} Almas)
              </button>
              <button
                type="button"
                onClick={onOpenShop}
                className="min-h-[48px] px-5 py-3 bg-[#181B26] hover:bg-[#212636] text-[#E5E0D5] border border-amber-500/45 hover:border-amber-400 font-semibold text-sm rounded-md transition-colors cursor-pointer whitespace-nowrap inline-flex items-center justify-center gap-2"
              >
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>Tienda ({equippedSkin ? equippedSkin.name.split(' ')[0] : 'Cosméticos'})</span>
              </button>
              <button
                type="button"
                onClick={onOpenBestiary}
                className="min-h-[48px] px-5 py-3 bg-[#18161E] hover:bg-[#231F2C] text-[#E5E0D5] border border-red-500/45 hover:border-red-400 font-semibold text-sm rounded-md transition-colors cursor-pointer whitespace-nowrap inline-flex items-center justify-center gap-2"
              >
                <BookMarked className="w-4 h-4 text-red-400" />
                <span>Bestiario ({discoveredBestiaryCount}/{totalBestiaryCount})</span>
              </button>
              <button
                type="button"
                onClick={onOpenAchievements}
                className="min-h-[48px] px-5 py-3 bg-[#1A1813] hover:bg-[#252119] text-[#E5E0D5] border border-amber-500/45 hover:border-amber-400 font-semibold text-sm rounded-md transition-colors cursor-pointer whitespace-nowrap inline-flex items-center justify-center gap-2"
              >
                <Trophy className="w-4 h-4 text-amber-400" />
                <span>Logros ({meta.unlockedAchievements.length}/{ACHIEVEMENTS_CATALOG.length})</span>
              </button>
            </div>
          </div>
        </div>

        {/* Single flat control-hint footer line */}
        <div
          className="px-4 sm:px-8 pb-4 sm:pb-5 flex items-center justify-between text-[11px] sm:text-xs text-[#949BA8]"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          <p className="hidden md:block">
            WASD Mover · Ratón Apuntar/Atacar · Espacio Esquivar · Q/E/R Habilidades · 1 Frasco · F Interactuar · K Árbol · Esc Pausa
          </p>
          <p className="md:hidden">
            Joystick táctil o pantalla dual para 2 jugadores · Toca Árbol para personalizar tu clase
          </p>
          <span className="hidden md:inline font-mono-num text-[#949BA8]">Enter para comenzar</span>
        </div>
      </div>
    </div>
  );
};

