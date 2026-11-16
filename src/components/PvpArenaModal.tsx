import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Crown,
  Gamepad2,
  Globe,
  Keyboard,
  Lock,
  RefreshCw,
  Server,
  ShieldAlert,
  Smartphone,
  Swords,
  Trophy,
  Wifi,
  X,
} from 'lucide-react';
import { ACTIVE_SKILLS, ARCHETYPES } from '../data/gameData';
import { coopClient, type CoopTelemetry } from '../net/coopClient';
import { APP_VERSION, compareVersions } from '../shared/protocol';
import {
  PVP_LOADOUTS,
  PVP_TIERS,
  computePvpHeroStats,
  didPvpRankIncrease,
  getPvpTierInfo,
} from '../shared/pvp';
import { getServerSyncKey } from '../storage/persistence';
import type {
  PvpLeaderboardEntry,
  PvpMatchHistoryEntry,
  PvpRoomSummary,
} from '../types/coop';
import type { ArchetypeId, LocalCoopControlMode, MetaSaveData } from '../types/game';
import { RankDisplay, RankEmblemSvg } from './RankDisplay';

interface PvpArenaModalProps {
  playerName: string;
  onChangePlayerName: (name: string) => void;
  selectedArchetype: ArchetypeId;
  onSelectArchetype: (id: ArchetypeId) => void;
  meta: MetaSaveData;
  recentRankUp?: { eloBefore: number; eloAfter: number } | null;
  rooms: PvpRoomSummary[];
  loadingRooms: boolean;
  wsConnected: boolean;
  coopTelemetry: CoopTelemetry;
  errorMessage: string | null;
  onRefreshRooms: () => void;
  onCreatePvpRoom: (isPublic: boolean) => void;
  onJoinPvpRoom: (code: string) => void;
  onStartLocalPvp: (
    p1Arch: ArchetypeId,
    p2Arch: ArchetypeId,
    controlMode: LocalCoopControlMode
  ) => void;
  onClose: () => void;
}

interface LanInfoResponse {
  version?: string;
  urls: string[];
}

function getConnectedGamepadCount(): number {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return 0;
  const pads = navigator.getGamepads();
  let count = 0;
  for (let i = 0; i < pads.length; i++) {
    if (pads[i]?.connected) count++;
  }
  return count;
}

export const PvpArenaModal: React.FC<PvpArenaModalProps> = ({
  playerName,
  onChangePlayerName,
  selectedArchetype,
  onSelectArchetype,
  meta,
  recentRankUp,
  rooms,
  loadingRooms,
  wsConnected,
  coopTelemetry,
  errorMessage,
  onRefreshRooms,
  onCreatePvpRoom,
  onJoinPvpRoom,
  onStartLocalPvp,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'online' | 'local' | 'leaderboard'>('online');
  const [isPublic, setIsPublic] = useState(true);
  const [joinCode, setJoinCode] = useState('');
  const [serverInput, setServerInput] = useState(() => coopClient.getServerOverride());
  const [lanUrls, setLanUrls] = useState<string[]>([]);
  const [lanServerVersion, setLanServerVersion] = useState<string | null>(null);

  // Server ELO & Leaderboard state
  const [serverStanding, setServerStanding] = useState<PvpLeaderboardEntry | null>(null);
  const [leaderboard, setLeaderboard] = useState<PvpLeaderboardEntry[]>([]);
  const [recentMatches, setRecentMatches] = useState<PvpMatchHistoryEntry[]>([]);
  const [loadingBoard, setLoadingBoard] = useState(false);

  // Local 2P Duel state
  const [localP1Arch, setLocalP1Arch] = useState<ArchetypeId>(selectedArchetype);
  const [localP2Arch, setLocalP2Arch] = useState<ArchetypeId>(() =>
    selectedArchetype === 'crusader' ? 'stalker' : 'crusader'
  );
  const [controlMode, setControlMode] = useState<LocalCoopControlMode>(() => {
    if (typeof window !== 'undefined' && (window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window)) {
      return 'dual_touch';
    }
    return 'auto';
  });
  const [gamepadCount, setGamepadCount] = useState(() => getConnectedGamepadCount());

  const localPlayerKey = getServerSyncKey();

  const fetchServerPvpData = async () => {
    const base = coopClient.getHttpBaseUrl();
    setLoadingBoard(true);
    try {
      const [playerRes, boardRes, lanRes] = await Promise.all([
        fetch(
          `${base}/api/pvp/player/${encodeURIComponent(localPlayerKey)}?name=${encodeURIComponent(
            playerName.trim() || 'Duelista'
          )}`
        )
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch(`${base}/api/pvp/leaderboard?limit=30`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch(`${base}/api/lan-info`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);

      if (playerRes?.ok && playerRes.player) {
        setServerStanding(playerRes.player as PvpLeaderboardEntry);
      }
      if (boardRes?.ok) {
        setLeaderboard(Array.isArray(boardRes.entries) ? boardRes.entries : []);
        setRecentMatches(Array.isArray(boardRes.recentMatches) ? boardRes.recentMatches : []);
      }
      if (lanRes) {
        const info = lanRes as LanInfoResponse;
        setLanUrls(info.urls ?? []);
        setLanServerVersion(info.version ?? null);
      }
    } finally {
      setLoadingBoard(false);
    }
  };

  useEffect(() => {
    void fetchServerPvpData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsConnected]);

  useEffect(() => {
    const syncPads = () => setGamepadCount(getConnectedGamepadCount());
    syncPads();
    window.addEventListener('gamepadconnected', syncPads);
    window.addEventListener('gamepaddisconnected', syncPads);
    const id = window.setInterval(syncPads, 1200);
    return () => {
      window.removeEventListener('gamepadconnected', syncPads);
      window.removeEventListener('gamepaddisconnected', syncPads);
      window.clearInterval(id);
    };
  }, []);

  const effectiveVersionCheck =
    coopTelemetry.versionCheck ??
    (lanServerVersion ? compareVersions(APP_VERSION, lanServerVersion) : null);
  const versionBlocked = effectiveVersionCheck?.status === 'major_mismatch';

  const displayElo = serverStanding?.elo ?? meta.pvpElo;
  const displayWins = serverStanding?.wins ?? meta.pvpWins;
  const displayLosses = serverStanding?.losses ?? meta.pvpLosses;
  const displayStreak = serverStanding?.winStreak ?? meta.pvpWinStreak;
  const displayTier = getPvpTierInfo(displayElo);

  const handleApplyServerUrl = (e: React.FormEvent) => {
    e.preventDefault();
    coopClient.setServerOverride(serverInput);
    onRefreshRooms();
    void fetchServerPvpData();
  };

  const handleResetServerUrl = () => {
    setServerInput('');
    coopClient.setServerOverride('');
    onRefreshRooms();
    void fetchServerPvpData();
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (versionBlocked) return;
    const cleaned = joinCode.trim().toUpperCase();
    if (!cleaned) return;
    onJoinPvpRoom(cleaned);
  };

  const archetypes = Object.values(ARCHETYPES);

  return (
    <div className="fixed inset-0 z-50 bg-black/82 flex items-center justify-center p-3 sm:p-4">
      <div className="w-full max-w-3xl max-h-[92dvh] flex flex-col bg-[#12151C] border border-[#2C3344] rounded-lg overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-[#232836] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Swords className="w-5 h-5 text-red-400 shrink-0" />
              <h2 className="font-display text-lg sm:text-xl font-bold text-[#E5E0D5] truncate">
                Arena Competitiva (PvP)
              </h2>
            </div>
            <p className="text-xs text-[#949BA8] mt-0.5">
              Coliseo del Eclipse al mejor de 3 rondas · Estadísticas equilibradas · ELO persistente en red local
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar Arena PvP"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md bg-[#181C26] border border-[#2C3344] text-[#949BA8] hover:text-[#E5E0D5] cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="grid grid-cols-3 gap-1.5 p-2 bg-[#0E1117] border-b border-[#232836]">
          <button
            type="button"
            onClick={() => setActiveTab('online')}
            className={`min-h-[44px] px-2.5 py-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
              activeTab === 'online'
                ? 'bg-[#26161C] text-red-300 border border-red-500/60'
                : 'text-[#949BA8] hover:text-[#E5E0D5] border border-transparent'
            }`}
          >
            <Server className="w-4 h-4 shrink-0" />
            <span>Duelo en Red (ELO)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('local')}
            className={`min-h-[44px] px-2.5 py-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
              activeTab === 'local'
                ? 'bg-[#152433] text-sky-300 border border-sky-500/60'
                : 'text-[#949BA8] hover:text-[#E5E0D5] border border-transparent'
            }`}
          >
            <Gamepad2 className="w-4 h-4 shrink-0" />
            <span>Duelo Local (2J)</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('leaderboard');
              void fetchServerPvpData();
            }}
            className={`min-h-[44px] px-2.5 py-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
              activeTab === 'leaderboard'
                ? 'bg-[#251E12] text-amber-300 border border-amber-500/60'
                : 'text-[#949BA8] hover:text-[#E5E0D5] border border-transparent'
            }`}
          >
            <Trophy className="w-4 h-4 shrink-0" />
            <span>Clasificación LAN</span>
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto crypt-scroll p-4 sm:p-6 space-y-5">
          {errorMessage && (
            <div className="p-3 rounded-md bg-red-950/55 border border-red-700/80 text-xs text-red-200">
              {errorMessage}
            </div>
          )}

          {/* Player Competitive Standing Banner */}
          <div className="space-y-2">
            <RankDisplay
              elo={displayElo}
              previousElo={recentRankUp?.eloBefore}
              rankUp={Boolean(
                recentRankUp &&
                  recentRankUp.eloAfter === displayElo &&
                  didPvpRankIncrease(recentRankUp.eloBefore, recentRankUp.eloAfter)
              )}
              wins={displayWins}
              losses={displayLosses}
              winStreak={displayStreak}
              variant="card"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 rounded bg-[#0E1117] border border-[#232836] text-[11px] font-mono-num text-[#949BA8]">
              <span>Online (Bo3): +35 Almas (V) / +12 Almas (D)</span>
              <span>Local 2J: +15 Almas (V) / +8 Almas (D)</span>
            </div>
          </div>

          {activeTab === 'online' && (
            <>
              {/* Duelist Name + LAN Status */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="pvp-player-name" className="block text-xs font-medium text-[#D4CFC4]">
                    Nombre de duelista en la clasificación
                  </label>
                  <input
                    id="pvp-player-name"
                    type="text"
                    maxLength={18}
                    value={playerName}
                    onChange={(e) => onChangePlayerName(e.target.value)}
                    placeholder="Ej. Valerius"
                    className="w-full min-h-[44px] px-3.5 py-2 rounded-md bg-[#0C0E13] border border-[#2C3344] focus:border-red-500/80 focus:outline-none text-sm text-[#E5E0D5]"
                  />
                </div>

                <div className="p-3 rounded-md bg-[#141821] border border-[#262C3C] flex flex-col justify-center gap-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Wifi className={`w-4 h-4 ${wsConnected ? 'text-emerald-400' : 'text-[#949BA8]'}`} />
                      <span className="text-xs font-semibold text-[#E5E0D5]">
                        {wsConnected ? 'Arena LAN conectada' : 'Conectando al servidor...'}
                      </span>
                    </div>
                    {wsConnected && coopTelemetry.latencyMs !== null && (
                      <span
                        className={`inline-flex items-center gap-1 font-mono-num text-[11px] ${
                          coopTelemetry.latencyMs < 70
                            ? 'text-emerald-400'
                            : coopTelemetry.latencyMs <= 150
                            ? 'text-amber-300'
                            : 'text-red-400'
                        }`}
                      >
                        <Activity className="w-3.5 h-3.5" />
                        <span>{coopTelemetry.latencyMs} ms</span>
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] font-mono-num text-[#949BA8]">
                    Cliente v{APP_VERSION}
                    {effectiveVersionCheck?.serverVersion ? ` · Servidor v${effectiveVersionCheck.serverVersion}` : ''}
                    {lanUrls[0] ? ` · ${lanUrls[0]}` : ''}
                  </div>
                </div>
              </div>

              {effectiveVersionCheck?.status === 'major_mismatch' && (
                <div className="p-3 rounded bg-red-950/60 border border-red-700/80 text-xs text-red-200 flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span>
                    {effectiveVersionCheck.message ||
                      `Versión mayor incompatible (Cliente v${APP_VERSION}, Servidor v${effectiveVersionCheck.serverVersion}).`}
                  </span>
                </div>
              )}

              {effectiveVersionCheck?.status === 'minor_mismatch' && (
                <div className="p-2.5 rounded bg-amber-950/45 border border-amber-700/60 text-xs text-amber-200 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    {effectiveVersionCheck.message ||
                      `Diferencia menor de versión (Cliente v${APP_VERSION}, Servidor v${effectiveVersionCheck.serverVersion}). Compatible.`}
                  </span>
                </div>
              )}

              {/* Standardized PvP Archetype Selector */}
              <div className="space-y-2">
                <div className="text-xs font-medium text-[#D4CFC4]">
                  Clase de duelo estandarizada (equipamiento y estadísticas equilibradas de Arena)
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  {archetypes.map((arch) => {
                    const active = selectedArchetype === arch.id;
                    const loadout = PVP_LOADOUTS[arch.id];
                    const pStats = computePvpHeroStats(arch.id);
                    const skillNames = loadout.skills.map((sid) => ACTIVE_SKILLS[sid].name.split(' ')[0]).join(' · ');
                    return (
                      <button
                        key={arch.id}
                        type="button"
                        onClick={() => onSelectArchetype(arch.id)}
                        className={`text-left p-3 rounded-lg border transition-colors cursor-pointer min-h-[44px] ${
                          active
                            ? 'bg-[#22161B] border-red-500/85'
                            : 'bg-[#161A23] border-[#262C3C] hover:border-[#475066]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-display text-sm font-bold text-[#E5E0D5]">
                            {loadout.classTitle}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#949BA8] mt-1">{skillNames}</div>
                        <div className="mt-2 pt-1.5 border-t border-[#232836] flex items-center justify-between text-[11px] font-mono-num text-[#C2BDB2]">
                          <span>PV {pStats.maxHp}</span>
                          <span>ATQ {pStats.baseDamage}</span>
                          <span>ARC {pStats.arcanePower}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Create / Join PvP Room */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-lg bg-[#161A23] border border-[#262C3C] space-y-3">
                  <h3 className="font-display text-sm font-bold text-[#E5E0D5]">
                    Abrir Sala de Duelo (Bo3)
                  </h3>
                  <p className="text-xs text-[#949BA8] leading-relaxed">
                    Crea una sala en el Coliseo del Eclipse y espera a un retador en la misma red local.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setIsPublic(true)}
                      className={`min-h-[44px] px-2.5 py-2 rounded-md border text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                        isPublic
                          ? 'bg-[#26181E] border-red-500/80 text-red-300'
                          : 'bg-[#10131A] border-[#262C3C] text-[#949BA8]'
                      }`}
                    >
                      <Globe className="w-3.5 h-3.5" />
                      <span>Pública</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsPublic(false)}
                      className={`min-h-[44px] px-2.5 py-2 rounded-md border text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                        !isPublic
                          ? 'bg-[#26181E] border-red-500/80 text-red-300'
                          : 'bg-[#10131A] border-[#262C3C] text-[#949BA8]'
                      }`}
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>Solo código</span>
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={!wsConnected || versionBlocked}
                    onClick={() => onCreatePvpRoom(isPublic)}
                    className="w-full min-h-[46px] py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-45 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-md transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Crear Sala de Duelo
                  </button>
                </div>

                <form
                  onSubmit={handleJoinSubmit}
                  className="p-4 rounded-lg bg-[#161A23] border border-[#262C3C] flex flex-col justify-between space-y-3"
                >
                  <div className="space-y-2">
                    <h3 className="font-display text-sm font-bold text-[#E5E0D5]">
                      Retar por Código
                    </h3>
                    <p className="text-xs text-[#949BA8] leading-relaxed">
                      Introduce el código de 5 caracteres de la sala rival en este servidor local.
                    </p>
                    <input
                      type="text"
                      maxLength={6}
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                      placeholder="EJ. K8R2M"
                      className="w-full min-h-[44px] px-3.5 py-2 rounded-md bg-[#0C0E13] border border-[#2C3344] focus:border-red-500/80 focus:outline-none text-sm font-mono-num tracking-widest uppercase text-[#E5E0D5]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!wsConnected || versionBlocked || !joinCode.trim()}
                    className="w-full min-h-[46px] py-2.5 bg-[#202636] hover:bg-[#293145] disabled:opacity-45 disabled:cursor-not-allowed text-[#E5E0D5] border border-[#384158] font-semibold text-sm rounded-md transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Unirse al Duelo
                  </button>
                </form>
              </div>

              {/* Open PvP Rooms List */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-sm font-bold text-[#E5E0D5]">
                    Arenas Abiertas en la Red
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      onRefreshRooms();
                      void fetchServerPvpData();
                    }}
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-3 py-1.5 rounded-md bg-[#161A23] border border-[#2C3344] hover:border-[#475066] text-xs text-[#D4CFC4] cursor-pointer whitespace-nowrap"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingRooms ? 'animate-spin' : ''}`} />
                    <span>Actualizar</span>
                  </button>
                </div>

                {rooms.length === 0 ? (
                  <div className="p-4 rounded-md bg-[#0E1117] border border-[#232836] text-xs text-[#949BA8] text-center">
                    No hay salas de duelo abiertas ahora mismo. Crea una sala pública para aceptar retadores.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {rooms.map((room) => (
                      <div
                        key={room.code}
                        className="p-3 rounded-md bg-[#161A23] border border-[#262C3C] flex flex-wrap items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono-num text-xs font-bold text-red-400">
                              #{room.code}
                            </span>
                            <span className="text-sm font-semibold text-[#E5E0D5] truncate">
                              {room.hostName}
                            </span>
                          </div>
                          <div className="text-xs text-[#949BA8] font-mono-num mt-0.5">
                            {room.hostElo} ELO ({room.hostTierName}) · {room.playerCount}/{room.maxPlayers} duelistas
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={versionBlocked || room.playerCount >= room.maxPlayers}
                          onClick={() => onJoinPvpRoom(room.code)}
                          className="min-h-[44px] px-4 py-2 rounded-md bg-red-600 hover:bg-red-500 disabled:bg-[#232836] disabled:text-[#6B7280] text-white font-semibold text-xs cursor-pointer transition-colors whitespace-nowrap"
                        >
                          {room.playerCount >= room.maxPlayers ? 'En duelo' : 'Aceptar Reto'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Optional Server IP Override */}
              <form
                onSubmit={handleApplyServerUrl}
                className="p-3 rounded-md bg-[#10131A] border border-[#232836] space-y-1.5"
              >
                <label className="block text-[11px] text-[#949BA8]">
                  IP del servidor LAN / Hotspot (opcional, ej. 192.168.43.12:3000)
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={serverInput}
                    onChange={(e) => setServerInput(e.target.value)}
                    placeholder="192.168.43.12:3000"
                    className="flex-1 min-w-0 min-h-[40px] px-3 py-1.5 rounded bg-[#0C0E13] border border-[#2C3344] focus:border-red-500/80 focus:outline-none text-xs font-mono-num text-[#E5E0D5]"
                  />
                  <div className="flex items-center gap-1.5">
                    <button
                      type="submit"
                      className="min-h-[40px] px-3.5 py-1.5 rounded bg-[#22293A] hover:bg-[#2B3348] border border-[#384158] text-xs font-semibold text-[#E5E0D5] cursor-pointer whitespace-nowrap"
                    >
                      Conectar IP
                    </button>
                    {coopClient.getServerOverride() && (
                      <button
                        type="button"
                        onClick={handleResetServerUrl}
                        className="min-h-[40px] px-3 py-1.5 rounded bg-[#12151C] border border-[#2C3344] text-xs text-[#949BA8] hover:text-white cursor-pointer whitespace-nowrap"
                      >
                        Local
                      </button>
                    )}
                  </div>
                </div>
              </form>
            </>
          )}

          {activeTab === 'local' && (
            <div className="space-y-5">
              <div className="p-3 rounded-md bg-[#13202E] border border-sky-700/45 text-xs text-[#C2BDB2] leading-relaxed">
                Combate directo <strong className="text-sky-300">2 Jugadores en el mismo dispositivo</strong> sin conexión. Las estadísticas están estandarizadas para un duelo justo al mejor de 3 rondas (+15 Almas al ganador).
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* P1 Class */}
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-amber-400">
                    Jugador 1 (Ámbar · Izquierda)
                  </div>
                  <div className="space-y-2">
                    {archetypes.map((arch) => {
                      const active = localP1Arch === arch.id;
                      const loadout = PVP_LOADOUTS[arch.id];
                      return (
                        <button
                          key={arch.id}
                          type="button"
                          onClick={() => setLocalP1Arch(arch.id)}
                          className={`w-full text-left p-3 rounded-md border transition-colors cursor-pointer min-h-[44px] ${
                            active
                              ? 'bg-[#211C13] border-amber-500/85'
                              : 'bg-[#161A23] border-[#262C3C] hover:border-[#475066]'
                          }`}
                        >
                          <div className="font-display text-sm font-bold text-[#E5E0D5]">
                            {loadout.classTitle}
                          </div>
                          <div className="text-[11px] font-mono-num text-[#949BA8] mt-0.5">
                            PV {loadout.maxHp} · ATQ {loadout.baseDamage} · ARC {loadout.arcanePower}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* P2 Class */}
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-sky-400">
                    Jugador 2 (Cian · Derecha)
                  </div>
                  <div className="space-y-2">
                    {archetypes.map((arch) => {
                      const active = localP2Arch === arch.id;
                      const loadout = PVP_LOADOUTS[arch.id];
                      return (
                        <button
                          key={arch.id}
                          type="button"
                          onClick={() => setLocalP2Arch(arch.id)}
                          className={`w-full text-left p-3 rounded-md border transition-colors cursor-pointer min-h-[44px] ${
                            active
                              ? 'bg-[#142030] border-sky-400/90'
                              : 'bg-[#161A23] border-[#262C3C] hover:border-[#475066]'
                          }`}
                        >
                          <div className="font-display text-sm font-bold text-[#E5E0D5]">
                            {loadout.classTitle}
                          </div>
                          <div className="text-[11px] font-mono-num text-[#949BA8] mt-0.5">
                            PV {loadout.maxHp} · ATQ {loadout.baseDamage} · ARC {loadout.arcanePower}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Control Scheme */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-[#D4CFC4]">Esquema de controles</span>
                  <span className="font-mono-num text-[#949BA8]">
                    Mandos detectados: {gamepadCount}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setControlMode('auto')}
                    className={`p-3 rounded-md border text-left cursor-pointer min-h-[44px] ${
                      controlMode === 'auto'
                        ? 'bg-[#1A202D] border-amber-500/80'
                        : 'bg-[#151922] border-[#262C3C]'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-[#E5E0D5]">
                      <Gamepad2 className="w-4 h-4 text-sky-400 shrink-0" />
                      <span>Teclado + Mando</span>
                    </div>
                    <p className="text-[11px] text-[#949BA8] mt-1">
                      Mandos automáticos o teclado dividido.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setControlMode('keyboard_split')}
                    className={`p-3 rounded-md border text-left cursor-pointer min-h-[44px] ${
                      controlMode === 'keyboard_split'
                        ? 'bg-[#1A202D] border-amber-500/80'
                        : 'bg-[#151922] border-[#262C3C]'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-[#E5E0D5]">
                      <Keyboard className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>Mismo Teclado</span>
                    </div>
                    <p className="text-[11px] text-[#949BA8] mt-1">
                      J1 WASD/G/QER · J2 Flechas/M/UIO.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setControlMode('dual_touch')}
                    className={`p-3 rounded-md border text-left cursor-pointer min-h-[44px] ${
                      controlMode === 'dual_touch'
                        ? 'bg-[#1A202D] border-amber-500/80'
                        : 'bg-[#151922] border-[#262C3C]'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-[#E5E0D5]">
                      <Smartphone className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>Táctil Dual</span>
                    </div>
                    <p className="text-[11px] text-[#949BA8] mt-1">
                      Pantalla dividida izquierda y derecha.
                    </p>
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onStartLocalPvp(localP1Arch, localP2Arch, controlMode)}
                className="w-full min-h-[48px] py-3 bg-sky-500 hover:bg-sky-400 active:bg-sky-300 text-[#0B0C10] font-semibold text-sm rounded-md transition-colors cursor-pointer whitespace-nowrap"
              >
                Iniciar Duelo Local (Bo3)
              </button>
            </div>
          )}

          {activeTab === 'leaderboard' && (
            <div className="space-y-5">
              {/* Leaderboard Table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Crown className="w-4 h-4 text-amber-400" />
                    <h3 className="font-display text-sm font-bold text-[#E5E0D5]">
                      Tabla de Clasificación Persistente (LAN / Hotspot)
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => void fetchServerPvpData()}
                    className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-md bg-[#161A23] border border-[#2C3344] hover:border-[#475066] text-xs text-[#D4CFC4] cursor-pointer whitespace-nowrap"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingBoard ? 'animate-spin' : ''}`} />
                    <span>Actualizar</span>
                  </button>
                </div>

                {leaderboard.length === 0 ? (
                  <div className="p-5 rounded-md bg-[#0E1117] border border-[#232836] text-xs text-[#949BA8] text-center">
                    {loadingBoard
                      ? 'Cargando clasificación de la red local...'
                      : 'Aún no hay duelos en red registrados en este servidor. ¡Completa un duelo online para inaugurar la tabla!'}
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-[#262C3C] bg-[#0E1117]">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-[#232836] text-[#949BA8]">
                          <th className="py-2.5 px-3 font-medium">#</th>
                          <th className="py-2.5 px-3 font-medium">Duelista</th>
                          <th className="py-2.5 px-3 font-medium">División</th>
                          <th className="py-2.5 px-3 font-medium text-right">ELO</th>
                          <th className="py-2.5 px-3 font-medium text-right">V - D</th>
                          <th className="py-2.5 px-3 font-medium text-right">Racha</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1C212E]">
                        {leaderboard.map((entry, idx) => {
                          const isMe = entry.playerKey === localPlayerKey;
                          return (
                            <tr
                              key={entry.playerKey}
                              className={isMe ? 'bg-amber-500/10' : 'hover:bg-[#151A24]'}
                            >
                              <td className="py-2.5 px-3 font-mono-num text-[#949BA8]">
                                {idx + 1}
                              </td>
                              <td className="py-2.5 px-3 font-semibold text-[#E5E0D5]">
                                {entry.name}
                                {isMe ? ' (Tú)' : ''}
                              </td>
                              <td className="py-2.5 px-3 font-medium" style={{ color: entry.tierColor }}>
                                {entry.tierName}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono-num font-bold text-[#E5E0D5]">
                                {entry.elo}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono-num text-[#C2BDB2]">
                                {entry.wins} - {entry.losses}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono-num text-amber-300">
                                {entry.winStreak > 0 ? `${entry.winStreak} (Máx ${entry.bestStreak})` : `Máx ${entry.bestStreak}`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Recent Matches Feed */}
              {recentMatches.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-display text-xs font-bold text-[#D4CFC4]">
                    Últimos Duelos Oficiales
                  </h4>
                  <div className="space-y-1.5">
                    {recentMatches.slice(0, 6).map((m) => (
                      <div
                        key={m.id}
                        className="px-3 py-2 rounded bg-[#151923] border border-[#232836] flex flex-wrap items-center justify-between gap-2 text-xs"
                      >
                        <div className="text-[#E5E0D5]">
                          <span className="font-semibold text-emerald-300">{m.winnerName}</span>
                          <span className="text-[#949BA8]"> venció a </span>
                          <span className="font-semibold text-red-300">{m.loserName}</span>
                        </div>
                        <div className="font-mono-num text-[11px] text-[#949BA8]">
                          Marcador {m.score} · +{m.eloDelta} ELO ({m.winnerEloAfter})
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 5 Competitive Tiers */}
              <div className="space-y-2">
                <h4 className="font-display text-xs font-bold text-[#D4CFC4]">
                  Divisiones y Títulos Desbloqueables
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                  {PVP_TIERS.map((tier) => {
                    const isCurrent = displayTier.id === tier.id;
                    return (
                      <div
                        key={tier.id}
                        className={`p-2.5 rounded-md border space-y-1.5 ${
                          isCurrent
                            ? 'bg-[#1B202C] border-amber-500/70'
                            : 'bg-[#141821] border-[#262C3C]'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <RankEmblemSvg tierId={tier.id} size={24} glowing={isCurrent} />
                          <div className="font-display text-xs font-bold" style={{ color: tier.color }}>
                            {tier.name}
                          </div>
                        </div>
                        <div className="font-mono-num text-[11px] text-[#E5E0D5]">
                          {tier.minElo === 0 ? 'Base < 1015' : `${tier.minElo}+ ELO`}
                        </div>
                        <div className="text-[10px] text-[#949BA8] leading-snug">
                          {tier.title}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
