import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Box,
  Check,
  Compass,
  Copy,
  Crosshair,
  Crown,
  Database,
  Eye,
  Flame,
  Hammer,
  Heart,
  Link2,
  Lock,
  Magnet,
  Monitor,
  Music,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  Shield,
  Skull,
  Snowflake,
  Sparkles,
  Swords,
  Terminal,
  Trash2,
  Trophy,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import { RankDisplay } from '../components/RankDisplay';
import { ARCHETYPES, ENEMY_DEFINITIONS, RARITY_LABELS } from '../data/gameData';
import type {
  AdminServerSaveSummary,
  AdminServerSnapshot,
  ConnectedGameClientSummary,
  RemoteAdminCommand,
} from '../shared/adminProtocol';
import { APP_VERSION } from '../shared/protocol';
import { didPvpRankIncrease } from '../shared/pvp';
import type { PvpLeaderboardEntry, PvpMatchHistoryEntry } from '../types/coop';
import type { ArchetypeId, EnemyType, Rarity, WeaponKind } from '../types/game';
import {
  ExternalAdminClient,
  loadInitialAdminConfig,
  normalizeAdminServerUrl,
} from './adminClient';

type AdminSection =
  | 'combat'
  | 'forge'
  | 'progress'
  | 'pvp_server'
  | 'diagnostics'
  | 'connect_external';

const WEAPON_OPTIONS: Array<{ value: WeaponKind | 'relic'; label: string }> = [
  { value: 'greatsword', label: 'Mandoble' },
  { value: 'daggers', label: 'Dagas' },
  { value: 'staff', label: 'Báculo' },
  { value: 'halberd', label: 'Alabarda' },
  { value: 'scythe', label: 'Guadaña' },
  { value: 'relic', label: 'Reliquia' },
];

const RARITY_OPTIONS: Rarity[] = ['common', 'rare', 'epic', 'relic'];

const ENEMY_OPTIONS: EnemyType[] = [
  'skeleton',
  'cultist',
  'golem',
  'wraith',
  'boss_warden',
  'boss_archon',
];

const PVP_PRESETS: Array<{ label: string; elo: number }> = [
  { label: 'Bronce (980)', elo: 980 },
  { label: 'Plata (1020)', elo: 1020 },
  { label: 'Oro (1160)', elo: 1160 },
  { label: 'Platino (1340)', elo: 1340 },
  { label: 'Diamante (1540)', elo: 1540 },
];

export const AdminApp: React.FC = () => {
  const clientRef = useRef<ExternalAdminClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = new ExternalAdminClient();
  }
  const initialCfg = useMemo(() => loadInitialAdminConfig(), []);

  const [serverInput, setServerInput] = useState(initialCfg.serverUrl);
  const [adminKeyInput, setAdminKeyInput] = useState(initialCfg.adminKey);
  const [connStatus, setConnStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>(
    'disconnected'
  );
  const [connError, setConnError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<AdminServerSnapshot | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [section, setSection] = useState<AdminSection>('combat');

  // Action feedback banner
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  // Forge / Spawn / World inputs
  const [forgeKind, setForgeKind] = useState<WeaponKind | 'relic'>('greatsword');
  const [forgeRarity, setForgeRarity] = useState<Rarity>('relic');
  const [autoEquipForge, setAutoEquipForge] = useState(true);
  const [spawnType, setSpawnType] = useState<EnemyType>('skeleton');
  const [floorDraft, setFloorDraft] = useState<string>('1');
  const [seedDraft, setSeedDraft] = useState<string>('ECLIPSE-0001');
  const [soulsDraft, setSoulsDraft] = useState<string>('0');
  const [pvpBeforePreview, setPvpBeforePreview] = useState<number | undefined>(undefined);
  const [confirmMetaReset, setConfirmMetaReset] = useState(false);

  // Server PvP Leaderboard & Saves state
  const [leaderboard, setLeaderboard] = useState<PvpLeaderboardEntry[]>([]);
  const [recentMatches, setRecentMatches] = useState<PvpMatchHistoryEntry[]>([]);
  const [serverSaves, setServerSaves] = useState<AdminServerSaveSummary[]>([]);
  const [loadingServerData, setLoadingServerData] = useState(false);
  const [confirmLeaderboardReset, setConfirmLeaderboardReset] = useState(false);
  const [editEloDrafts, setEditEloDrafts] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedSaveJson, setSelectedSaveJson] = useState<{
    syncKey: string;
    json: string;
  } | null>(null);

  const notify = (text: string, ok = true) => {
    setNotice({ ok, text });
    window.setTimeout(() => {
      setNotice((cur) => (cur?.text === text ? null : cur));
    }, 3200);
  };

  useEffect(() => {
    const cli = clientRef.current!;
    const unsubStatus = cli.onStatus((status, err) => {
      setConnStatus(status);
      setConnError(err ?? null);
    });
    const unsubSnap = cli.onSnapshot((snap) => {
      setSnapshot(snap);
      setSelectedClientId((cur) => {
        if (cur && snap.clients.some((c) => c.clientId === cur)) return cur;
        return snap.clients[0]?.clientId ?? '';
      });
    });

    if (initialCfg.autoConnect || typeof window !== 'undefined') {
      cli.connect(initialCfg.serverUrl, initialCfg.adminKey);
    }

    return () => {
      unsubStatus();
      unsubSnap();
      cli.disconnect();
    };
  }, [initialCfg]);

  const activeClient: ConnectedGameClientSummary | null = useMemo(() => {
    if (!snapshot?.clients.length) return null;
    return (
      snapshot.clients.find((c) => c.clientId === selectedClientId) ?? snapshot.clients[0] ?? null
    );
  }, [snapshot, selectedClientId]);

  useEffect(() => {
    if (!activeClient) return;
    setSoulsDraft(String(activeClient.soulShards));
    if (activeClient.runSeedLabel) setSeedDraft(activeClient.runSeedLabel);
    if (activeClient.floorNumber > 0) setFloorDraft(String(activeClient.floorNumber));
  }, [
    activeClient?.clientId,
    activeClient?.soulShards,
    activeClient?.runSeedLabel,
    activeClient?.floorNumber,
  ]);

  const refreshServerData = async () => {
    if (connStatus !== 'connected') return;
    setLoadingServerData(true);
    try {
      const [lbData, savesData] = await Promise.all([
        clientRef.current!.fetchPvpLeaderboard(),
        clientRef.current!.fetchServerSaves(),
      ]);
      setLeaderboard(lbData.entries);
      setRecentMatches(lbData.recentMatches);
      setServerSaves(savesData);
      const drafts: Record<string, string> = {};
      for (const e of lbData.entries) {
        drafts[e.playerKey] = String(e.elo);
      }
      setEditEloDrafts(drafts);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Error leyendo datos del servidor', false);
    } finally {
      setLoadingServerData(false);
    }
  };

  useEffect(() => {
    if (connStatus === 'connected' && section === 'pvp_server') {
      void refreshServerData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connStatus, section]);

  const handleConnectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setConnError(null);
    clientRef.current!.connect(serverInput, adminKeyInput);
  };

  const runRemote = async (command: RemoteAdminCommand, successLabel?: string) => {
    if (!activeClient) {
      notify('No hay ningún cliente de juego conectado seleccionado.', false);
      return;
    }
    const res = await clientRef.current!.sendCommand(activeClient.clientId, command);
    notify(res.ok && successLabel ? successLabel : res.message, res.ok);
  };

  const copyText = (id: string, text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1800);
  };

  const normalizedServer = normalizeAdminServerUrl(serverInput);
  const wsEndpointUrl = (() => {
    try {
      const parsed = new URL(normalizedServer);
      const proto = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${parsed.host}/ws/admin`;
    } catch {
      return `${normalizedServer}/ws/admin`;
    }
  })();
  const directShareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/admin?server=${encodeURIComponent(normalizedServer)}&key=${encodeURIComponent(adminKeyInput.trim())}`
      : '';

  const inRun = Boolean(
    activeClient && (activeClient.screen === 'PLAYING' || activeClient.screen === 'PAUSED')
  );
  const soloOrLocalInRun = Boolean(inRun && activeClient && !activeClient.isOnlineCoop && !activeClient.isPvp);
  const flags = activeClient?.adminFlags;
  const isClientOutdated = (cli: ConnectedGameClientSummary): boolean =>
    (cli.appVersion || '') !== APP_VERSION;
  const activeClientOutdated = activeClient ? isClientOutdated(activeClient) : false;

  const navItems: Array<{ id: AdminSection; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'combat', label: 'Combate y Héroe', icon: Shield },
    { id: 'forge', label: 'Forjar e Invocar', icon: Hammer },
    { id: 'progress', label: 'Progreso y Mundo', icon: Compass },
    { id: 'pvp_server', label: 'Arena PvP y Servidor', icon: Trophy },
    { id: 'diagnostics', label: 'Diagnóstico y Audio', icon: Activity },
    { id: 'connect_external', label: 'Conectar Otra App', icon: Link2 },
  ];

  return (
    <div className="min-h-screen bg-[#0B0C10] text-[#E5E0D5] flex flex-col">
      {/* Top Bar (3 zones: Brand Wordmark — Server Target — Primary Action) */}
      <header className="border-b border-[#232836] bg-[#0E1117] px-4 sm:px-6 py-3 flex items-center justify-between gap-8">
        <div className="flex items-center gap-2.5 min-w-0">
          <Terminal className="w-5 h-5 text-amber-400 shrink-0" />
          <span className="font-display text-sm sm:text-base font-bold text-[#E5E0D5] whitespace-nowrap shrink-0">
            Criptas del Eclipse · Admin
          </span>
        </div>

        <div className="hidden md:flex items-center gap-3 text-xs text-[#949BA8] font-mono-num truncate">
          <span>
            {connStatus === 'connected'
              ? 'Conectado'
              : connStatus === 'connecting'
              ? 'Conectando'
              : connStatus === 'error'
              ? 'Error de clave'
              : 'Desconectado'}
          </span>
          <span aria-hidden="true">·</span>
          <span className="text-amber-300">v{APP_VERSION}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate max-w-[240px] text-[#D4CFC4]">{normalizedServer}</span>
          {snapshot && (
            <>
              <span aria-hidden="true">·</span>
              <span>Clientes: {snapshot.clients.length}</span>
              <span aria-hidden="true">·</span>
              <span>Salas: {snapshot.rooms.length}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {connStatus === 'connected' ? (
            <button
              type="button"
              onClick={() => clientRef.current!.disconnect()}
              className="min-h-[40px] px-4 py-2 rounded-md bg-[#23181C] hover:bg-[#312026] border border-red-500/50 text-xs font-semibold text-red-200 cursor-pointer whitespace-nowrap shrink-0"
            >
              Desconectar
            </button>
          ) : (
            <button
              type="button"
              onClick={() => clientRef.current!.connect(serverInput, adminKeyInput)}
              className="min-h-[40px] px-4 py-2 rounded-md bg-amber-600 hover:bg-amber-500 text-xs font-semibold text-[#0B0C10] cursor-pointer whitespace-nowrap shrink-0"
            >
              Conectar Servidor
            </button>
          )}
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex-1 flex flex-col lg:flex-row">
        {/* Sidebar Navigation & Server Connection Panel */}
        <aside className="w-full lg:w-72 border-b lg:border-b-0 lg:border-r border-[#232836] bg-[#0F1219] p-4 space-y-5 shrink-0">
          {/* Server Connection Form */}
          <form onSubmit={handleConnectSubmit} className="space-y-2.5 pb-4 border-b border-[#202634]">
            <div className="flex items-center justify-between text-xs font-semibold text-[#D4CFC4]">
              <span className="inline-flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-amber-400" />
                <span>Servidor Destino</span>
              </span>
              <span
                className={`text-[11px] font-mono-num ${
                  connStatus === 'connected'
                    ? 'text-emerald-400'
                    : connStatus === 'error'
                    ? 'text-red-400'
                    : 'text-[#949BA8]'
                }`}
              >
                {connStatus === 'connected'
                  ? 'En línea'
                  : connStatus === 'connecting'
                  ? 'Conectando...'
                  : connStatus === 'error'
                  ? 'Rechazado'
                  : 'Inactivo'}
              </span>
            </div>

            <input
              type="text"
              value={serverInput}
              onChange={(e) => setServerInput(e.target.value)}
              placeholder="http://localhost:3000"
              aria-label="URL del servidor"
              className="w-full min-h-[40px] px-3 rounded bg-[#0B0C10] border border-[#2C3344] focus:border-amber-500 focus:outline-none text-xs font-mono-num text-[#E5E0D5]"
            />
            <div className="relative">
              <Lock className="w-3.5 h-3.5 text-[#949BA8] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                value={adminKeyInput}
                onChange={(e) => setAdminKeyInput(e.target.value)}
                placeholder="Clave de administrador"
                aria-label="Clave de administrador"
                className="w-full min-h-[40px] pl-8 pr-3 rounded bg-[#0B0C10] border border-[#2C3344] focus:border-amber-500 focus:outline-none text-xs font-mono-num text-[#E5E0D5]"
              />
            </div>
            {connError && (
              <div className="text-[11px] text-red-300 bg-red-950/50 border border-red-700/60 rounded px-2.5 py-1.5">
                {connError}
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                className="flex-1 min-h-[40px] px-3 rounded bg-amber-600 hover:bg-amber-500 text-[#0B0C10] text-xs font-semibold cursor-pointer whitespace-nowrap"
              >
                Aplicar Conexión
              </button>
              <button
                type="button"
                onClick={() => clientRef.current!.requestRefresh()}
                aria-label="Actualizar estado del servidor"
                className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded bg-[#161A24] border border-[#2C3344] hover:border-amber-500/60 text-[#D4CFC4] cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>

          {/* Connected Game Client Target Selector */}
          <div className="space-y-2 pb-4 border-b border-[#202634]">
            <div className="flex items-center justify-between text-xs font-semibold text-[#D4CFC4]">
              <span className="inline-flex items-center gap-1.5">
                <Monitor className="w-3.5 h-3.5 text-sky-400" />
                <span>Clientes del Juego ({snapshot?.clients.length ?? 0})</span>
              </span>
            </div>

            {!snapshot || snapshot.clients.length === 0 ? (
              <div className="p-3 rounded bg-[#12151C] border border-[#232836] text-[11px] text-[#949BA8] leading-relaxed">
                Abre el juego principal en otra pestaña o dispositivo conectado al servidor para controlarlo en tiempo real.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-56 overflow-y-auto crypt-scroll">
                {snapshot.clients.map((cli) => {
                  const selected = activeClient?.clientId === cli.clientId;
                  const outdated = isClientOutdated(cli);
                  return (
                    <button
                      key={cli.clientId}
                      type="button"
                      onClick={() => setSelectedClientId(cli.clientId)}
                      className={`w-full text-left p-2.5 rounded-md border transition-colors cursor-pointer ${
                        outdated
                          ? selected
                            ? 'bg-red-950/75 border-red-400 shadow-[0_0_0_1px_rgba(248,113,113,0.35)]'
                            : 'bg-red-950/45 border-red-600/70 hover:border-red-400'
                          : selected
                          ? 'bg-[#1A202D] border-amber-500/80'
                          : 'bg-[#12151C] border-[#232836] hover:border-[#384158]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                        <span className={`truncate ${outdated ? 'text-red-100' : 'text-[#E5E0D5]'}`}>
                          {cli.playerName || 'Aventurero'}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {outdated && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-600/30 border border-red-400/70 text-[10px] font-bold text-red-200 uppercase tracking-wide">
                              <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
                              Desactualizado
                            </span>
                          )}
                          <span
                            className={`font-mono-num text-[10px] ${
                              outdated ? 'text-red-300' : 'text-amber-300'
                            }`}
                          >
                            {cli.screen === 'TITLE' ? 'Santuario' : `Piso ${cli.floorNumber}`}
                          </span>
                        </div>
                      </div>
                      <div
                        className={`text-[10px] font-mono-num truncate mt-0.5 ${
                          outdated ? 'text-red-200/80' : 'text-[#949BA8]'
                        }`}
                      >
                        v{cli.appVersion || '?'} · {cli.syncKey} · {cli.pvpElo} ELO · {cli.soulShards} Almas
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section Navigation */}
          <nav className="flex lg:flex-col gap-1.5 overflow-x-auto pb-1 lg:pb-0">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSection(item.id)}
                  className={`min-h-[42px] px-3 py-2 rounded-md text-xs font-semibold flex items-center gap-2.5 border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-[#1D222F] text-amber-300 border-amber-500/60'
                      : 'bg-transparent text-[#C2BDB2] border-transparent hover:bg-[#151923] hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-5xl space-y-6">
          {notice && (
            <div
              role="status"
              className={`px-4 py-2.5 rounded-md border text-xs font-medium ${
                notice.ok
                  ? 'bg-emerald-950/60 border-emerald-500/60 text-emerald-200'
                  : 'bg-red-950/60 border-red-500/60 text-red-200'
              }`}
            >
              {notice.text}
            </div>
          )}

          {/* Active Client Summary Strip when applicable */}
          {activeClient && section !== 'pvp_server' && section !== 'connect_external' && (
            <div
              className={`p-4 rounded-lg border flex flex-wrap items-center justify-between gap-3 transition-colors ${
                activeClientOutdated
                  ? 'bg-red-950/50 border-red-500/80'
                  : 'bg-[#12151C] border-[#262C3C]'
              }`}
            >
              <div className="space-y-0.5 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`text-sm font-display font-bold truncate ${
                      activeClientOutdated ? 'text-red-100' : 'text-[#E5E0D5]'
                    }`}
                  >
                    Cliente Activo: {activeClient.playerName}
                  </span>
                  {activeClientOutdated ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-600/30 border border-red-400/80 text-[10px] font-bold text-red-100 uppercase tracking-wide">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      Desactualizado (v{activeClient.appVersion || '?'} ≠ v{APP_VERSION})
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-950/70 border border-emerald-500/40 text-[10px] font-mono-num text-emerald-300">
                      v{activeClient.appVersion}
                    </span>
                  )}
                </div>
                <div
                  className={`text-xs font-mono-num ${
                    activeClientOutdated ? 'text-red-200/85' : 'text-[#949BA8]'
                  }`}
                >
                  {activeClient.screen === 'TITLE'
                    ? 'En Santuario Inicial'
                    : `En partida · Piso ${activeClient.floorNumber}`}
                  {' · '}Semilla {activeClient.runSeedLabel || 'N/D'}
                  {' · '}Almas {activeClient.soulShards}
                  {' · '}ELO {activeClient.pvpElo}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void runRemote({ type: 'reset_flags' }, 'Modificadores restablecidos.')}
                className="min-h-[40px] px-3.5 py-2 rounded-md bg-[#23181C] hover:bg-[#311F25] border border-red-500/50 text-xs font-semibold text-red-200 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Desactivar Flags</span>
              </button>
            </div>
          )}

          {/* SECTION 1: COMBATE Y HÉROE */}
          {section === 'combat' && (
            <section className="space-y-5">
              <div>
                <h1 className="font-display text-xl font-bold text-[#E5E0D5]">
                  Combate y Héroe Remoto
                </h1>
                <p className="text-xs text-[#949BA8] mt-1">
                  Modificadores de combate, velocidad, daño y control de sala aplicados en vivo sobre el cliente conectado.
                </p>
              </div>

              {!activeClient ? (
                <div className="p-6 rounded-lg bg-[#12151C] border border-[#262C3C] text-xs text-[#949BA8]">
                  No hay un cliente del juego conectado. Abre la URL del juego principal para habilitar el control remoto de combate.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {[
                      {
                        key: 'godMode' as const,
                        label: 'Modo Dios (Invulnerable)',
                        icon: Shield,
                        active: Boolean(flags?.godMode),
                      },
                      {
                        key: 'infiniteMana' as const,
                        label: 'Maná Infinito',
                        icon: Zap,
                        active: Boolean(flags?.infiniteMana),
                      },
                      {
                        key: 'zeroCooldowns' as const,
                        label: 'Sin Enfriamiento (0s)',
                        icon: Flame,
                        active: Boolean(flags?.zeroCooldowns),
                      },
                      {
                        key: 'oneHitKill' as const,
                        label: 'Daño Letal (Instakill)',
                        icon: Skull,
                        active: Boolean(flags?.oneHitKill),
                      },
                      {
                        key: 'revealMinimap' as const,
                        label: 'Revelar Mapa Completo',
                        icon: Compass,
                        active: Boolean(flags?.revealMinimap),
                      },
                      {
                        key: 'freezeEnemies' as const,
                        label: 'Congelar Enemigos',
                        icon: Snowflake,
                        active: Boolean(flags?.freezeEnemies),
                      },
                      {
                        key: 'autoLoot' as const,
                        label: 'Imán de Botín Global',
                        icon: Magnet,
                        active: Boolean(flags?.autoLoot),
                      },
                      {
                        key: 'showHitboxes' as const,
                        label: 'Ver Hitboxes y Radios',
                        icon: Eye,
                        active: Boolean(flags?.showHitboxes),
                      },
                    ].map((toggle) => {
                      const Icon = toggle.icon;
                      return (
                        <button
                          key={toggle.key}
                          type="button"
                          onClick={() =>
                            void runRemote({
                              type: 'update_flags',
                              patch: { [toggle.key]: !toggle.active },
                            })
                          }
                          className={`min-h-[44px] px-4 py-2 rounded-md border flex items-center justify-between gap-2 text-xs font-semibold cursor-pointer ${
                            toggle.active
                              ? 'bg-[#1D2824] border-emerald-500/80 text-emerald-300'
                              : 'bg-[#12151C] border-[#262C3C] text-[#D4CFC4] hover:border-[#475066]'
                          }`}
                        >
                          <span className="inline-flex items-center gap-2 min-w-0">
                            <Icon className="w-4 h-4 shrink-0" />
                            <span className="truncate">{toggle.label}</span>
                          </span>
                          <span className="font-mono-num shrink-0">
                            {toggle.active ? 'ON' : 'OFF'}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Multipliers */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="p-4 rounded-lg bg-[#12151C] border border-[#262C3C] flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium text-[#D4CFC4]">Velocidad</span>
                      <div className="flex flex-wrap gap-1.5">
                        {[0.5, 1, 1.5, 2, 3].map((mult) => (
                          <button
                            key={mult}
                            type="button"
                            onClick={() =>
                              void runRemote({
                                type: 'update_flags',
                                patch: { speedMultiplier: mult },
                              })
                            }
                            className={`min-h-[36px] px-2.5 rounded text-xs font-mono-num font-bold border cursor-pointer ${
                              flags?.speedMultiplier === mult
                                ? 'bg-amber-600 text-[#0B0C10] border-amber-500'
                                : 'bg-[#0E1117] text-[#C2BDB2] border-[#2C3344] hover:text-white'
                            }`}
                          >
                            {mult}x
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="p-4 rounded-lg bg-[#12151C] border border-[#262C3C] flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium text-[#D4CFC4]">
                        Multiplicador de Daño
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {[1, 2, 5, 10].map((mult) => (
                          <button
                            key={mult}
                            type="button"
                            onClick={() =>
                              void runRemote({
                                type: 'update_flags',
                                patch: { damageMultiplier: mult },
                              })
                            }
                            className={`min-h-[36px] px-2.5 rounded text-xs font-mono-num font-bold border cursor-pointer ${
                              flags?.damageMultiplier === mult
                                ? 'bg-red-600 text-white border-red-400'
                                : 'bg-[#0E1117] text-[#C2BDB2] border-[#2C3344] hover:text-white'
                            }`}
                          >
                            {mult}x
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Archetype Switcher */}
                  <div className="p-4 rounded-lg bg-[#12151C] border border-[#262C3C] space-y-2.5">
                    <div className="text-xs font-semibold text-[#D4CFC4]">
                      Cambiar Arquetipo en Vivo (Solo / Local)
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {(Object.keys(ARCHETYPES) as ArchetypeId[]).map((archId) => (
                        <button
                          key={archId}
                          type="button"
                          disabled={!soloOrLocalInRun}
                          onClick={() =>
                            void runRemote({ type: 'change_archetype', archetype: archId })
                          }
                          className="min-h-[42px] px-3 rounded bg-[#0E1117] hover:bg-[#1A202D] border border-[#2C3344] hover:border-amber-500/60 disabled:opacity-40 text-xs font-semibold text-[#E5E0D5] cursor-pointer disabled:cursor-not-allowed"
                        >
                          {ARCHETYPES[archId].name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Hero & Room Actions */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    <button
                      type="button"
                      disabled={!inRun}
                      onClick={() => void runRemote({ type: 'heal_full' })}
                      className="min-h-[44px] px-4 py-2 rounded-md bg-emerald-700/85 hover:bg-emerald-600 disabled:opacity-40 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
                    >
                      <Heart className="w-4 h-4 shrink-0" />
                      <span>Curar 100%</span>
                    </button>
                    <button
                      type="button"
                      disabled={!inRun}
                      onClick={() => void runRemote({ type: 'refill_flasks' })}
                      className="min-h-[44px] px-4 py-2 rounded-md bg-[#2A181C] hover:bg-[#3A2026] border border-red-600/60 disabled:opacity-40 text-red-100 text-xs font-semibold cursor-pointer disabled:cursor-not-allowed"
                    >
                      Rellenar Frascos
                    </button>
                    <button
                      type="button"
                      disabled={!soloOrLocalInRun}
                      onClick={() => void runRemote({ type: 'revive_heroes' })}
                      className="min-h-[44px] px-4 py-2 rounded-md bg-[#162535] hover:bg-[#1E3349] border border-sky-500/55 disabled:opacity-40 text-sky-100 text-xs font-semibold cursor-pointer disabled:cursor-not-allowed"
                    >
                      Revivir Héroes
                    </button>
                    <button
                      type="button"
                      disabled={!soloOrLocalInRun}
                      onClick={() => void runRemote({ type: 'kill_current_room' })}
                      className="min-h-[44px] px-4 py-2 rounded-md bg-[#2A171C] hover:bg-[#3A1E25] border border-red-700/60 disabled:opacity-40 text-red-200 text-xs font-semibold cursor-pointer disabled:cursor-not-allowed"
                    >
                      Limpiar Sala Actual
                    </button>
                    <button
                      type="button"
                      disabled={!soloOrLocalInRun}
                      onClick={() => void runRemote({ type: 'kill_all_floor' })}
                      className="min-h-[44px] px-4 py-2 rounded-md bg-[#2A171C] hover:bg-[#3A1E25] border border-red-700/60 disabled:opacity-40 text-red-200 text-xs font-semibold cursor-pointer disabled:cursor-not-allowed"
                    >
                      Limpiar Todo el Piso
                    </button>
                    <button
                      type="button"
                      disabled={!soloOrLocalInRun}
                      onClick={() => void runRemote({ type: 'open_boss_portal' })}
                      className="min-h-[44px] px-4 py-2 rounded-md bg-violet-700/80 hover:bg-violet-600 disabled:opacity-40 text-white text-xs font-semibold cursor-pointer disabled:cursor-not-allowed"
                    >
                      Abrir Portal Aquí
                    </button>
                  </div>
                </>
              )}
            </section>
          )}

          {/* SECTION 2: FORJAR E INVOCAR */}
          {section === 'forge' && (
            <section className="space-y-5">
              <div>
                <h1 className="font-display text-xl font-bold text-[#E5E0D5]">
                  Forjar Botín e Invocar Entidades
                </h1>
                <p className="text-xs text-[#949BA8] mt-1">
                  Genera equipamiento personalizado, invoca oleadas de enemigos o coloca cofres, santuarios y portales.
                </p>
              </div>

              {/* Forge Panel */}
              <div className="p-4 rounded-lg bg-[#12151C] border border-[#262C3C] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-display font-bold text-amber-300">
                    <Hammer className="w-4 h-4" />
                    <span>Forjar Arma o Reliquia</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAutoEquipForge((v) => !v)}
                    className={`min-h-[34px] px-3 rounded border text-xs font-semibold cursor-pointer ${
                      autoEquipForge
                        ? 'bg-amber-600/20 border-amber-500/70 text-amber-300'
                        : 'bg-[#0E1117] border-[#2C3344] text-[#949BA8]'
                    }`}
                  >
                    Equipar al forjar: {autoEquipForge ? 'SÍ' : 'NO'}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <select
                    value={forgeKind}
                    onChange={(e) => setForgeKind(e.target.value as WeaponKind | 'relic')}
                    className="min-h-[44px] px-3 rounded bg-[#0B0C10] border border-[#2C3344] text-xs text-[#E5E0D5]"
                  >
                    {WEAPON_OPTIONS.map((w) => (
                      <option key={w.value} value={w.value}>
                        {w.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={forgeRarity}
                    onChange={(e) => setForgeRarity(e.target.value as Rarity)}
                    className="min-h-[44px] px-3 rounded bg-[#0B0C10] border border-[#2C3344] text-xs text-[#E5E0D5]"
                  >
                    {RARITY_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        Rareza: {RARITY_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!inRun}
                    onClick={() =>
                      void runRemote({
                        type: 'forge_item',
                        kind: forgeKind,
                        rarity: forgeRarity,
                        autoEquip: autoEquipForge,
                      })
                    }
                    className="flex-1 min-h-[44px] px-4 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-[#0B0C10] text-xs font-bold cursor-pointer disabled:cursor-not-allowed"
                  >
                    {autoEquipForge ? 'Forjar y Equipar Ahora' : 'Forjar al Inventario'}
                  </button>
                  <button
                    type="button"
                    disabled={!inRun}
                    onClick={() => void runRemote({ type: 'clear_inventory' })}
                    className="min-h-[44px] px-4 rounded bg-[#21171B] hover:bg-[#2E1E24] border border-red-800/60 disabled:opacity-40 text-red-200 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Vaciar Mochila</span>
                  </button>
                </div>
              </div>

              {/* Enemy Spawner */}
              <div className="p-4 rounded-lg bg-[#12151C] border border-[#262C3C] space-y-3">
                <div className="flex items-center gap-2 text-xs font-display font-bold text-red-300">
                  <Skull className="w-4 h-4" />
                  <span>Invocar Criaturas o Jefes</span>
                </div>
                <select
                  value={spawnType}
                  onChange={(e) => setSpawnType(e.target.value as EnemyType)}
                  className="w-full min-h-[44px] px-3 rounded bg-[#0B0C10] border border-[#2C3344] text-xs text-[#E5E0D5]"
                >
                  {ENEMY_OPTIONS.map((type) => (
                    <option key={type} value={type}>
                      {ENEMY_DEFINITIONS[type]?.name ?? type}
                      {ENEMY_DEFINITIONS[type]?.isBoss ? ' (Jefe)' : ''}
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[1, 3, 5, 10].map((qty) => (
                    <button
                      key={qty}
                      type="button"
                      disabled={!soloOrLocalInRun}
                      onClick={() =>
                        void runRemote({ type: 'spawn_enemy', enemyType: spawnType, count: qty })
                      }
                      className="min-h-[44px] px-3 rounded bg-red-800/80 hover:bg-red-700 disabled:opacity-40 text-white text-xs font-mono-num font-semibold cursor-pointer disabled:cursor-not-allowed"
                    >
                      Invocar x{qty}
                    </button>
                  ))}
                </div>
              </div>

              {/* Prop Spawner */}
              <div className="p-4 rounded-lg bg-[#12151C] border border-[#262C3C] space-y-3">
                <div className="flex items-center gap-2 text-xs font-display font-bold text-sky-300">
                  <Box className="w-4 h-4" />
                  <span>Invocar Objetos de Mazmorra Junto al Héroe</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    disabled={!soloOrLocalInRun}
                    onClick={() => void runRemote({ type: 'spawn_prop', kind: 'chest' })}
                    className="min-h-[44px] px-3 rounded bg-[#231D12] hover:bg-[#312817] border border-amber-500/50 disabled:opacity-40 text-amber-200 text-xs font-semibold cursor-pointer disabled:cursor-not-allowed"
                  >
                    Cofre del Tesoro
                  </button>
                  <button
                    type="button"
                    disabled={!soloOrLocalInRun}
                    onClick={() => void runRemote({ type: 'spawn_prop', kind: 'shrine' })}
                    className="min-h-[44px] px-3 rounded bg-[#1B162C] hover:bg-[#261E3E] border border-violet-500/50 disabled:opacity-40 text-violet-200 text-xs font-semibold cursor-pointer disabled:cursor-not-allowed"
                  >
                    Santuario Arcano
                  </button>
                  <button
                    type="button"
                    disabled={!soloOrLocalInRun}
                    onClick={() => void runRemote({ type: 'spawn_prop', kind: 'portal' })}
                    className="min-h-[44px] px-3 rounded bg-[#142030] hover:bg-[#1B2C42] border border-sky-500/50 disabled:opacity-40 text-sky-200 text-xs font-semibold cursor-pointer disabled:cursor-not-allowed"
                  >
                    Portal de Descenso
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* SECTION 3: PROGRESO Y MUNDO */}
          {section === 'progress' && (
            <section className="space-y-5">
              <div>
                <h1 className="font-display text-xl font-bold text-[#E5E0D5]">
                  Progreso, Meta y Control de Mundo
                </h1>
                <p className="text-xs text-[#949BA8] mt-1">
                  Administra economía, niveles, desbloqueos de meta-progresión, salto entre pisos, semillas y teletransporte.
                </p>
              </div>

              {/* Currency */}
              <div className="p-4 rounded-lg bg-[#12151C] border border-[#262C3C] space-y-3">
                <div className="text-xs font-display font-bold text-[#E5E0D5]">
                  Economía y Fragmentos de Alma
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <button
                    type="button"
                    disabled={!inRun}
                    onClick={() => void runRemote({ type: 'add_gold', amount: 500 })}
                    className="min-h-[42px] px-3 rounded bg-[#0E1117] hover:bg-[#1A202D] border border-amber-500/45 disabled:opacity-40 text-amber-300 text-xs font-mono-num font-semibold cursor-pointer disabled:cursor-not-allowed"
                  >
                    +500 Oro
                  </button>
                  <button
                    type="button"
                    disabled={!inRun}
                    onClick={() => void runRemote({ type: 'add_gold', amount: 5000 })}
                    className="min-h-[42px] px-3 rounded bg-[#0E1117] hover:bg-[#1A202D] border border-amber-500/45 disabled:opacity-40 text-amber-300 text-xs font-mono-num font-semibold cursor-pointer disabled:cursor-not-allowed"
                  >
                    +5,000 Oro
                  </button>
                  <button
                    type="button"
                    disabled={!activeClient}
                    onClick={() => void runRemote({ type: 'add_souls', amount: 50 })}
                    className="min-h-[42px] px-3 rounded bg-[#1D182C] hover:bg-[#28203D] border border-violet-500/45 disabled:opacity-40 text-violet-300 text-xs font-mono-num font-semibold cursor-pointer"
                  >
                    +50 Almas
                  </button>
                  <button
                    type="button"
                    disabled={!activeClient}
                    onClick={() => void runRemote({ type: 'add_souls', amount: 500 })}
                    className="min-h-[42px] px-3 rounded bg-[#1D182C] hover:bg-[#28203D] border border-violet-500/45 disabled:opacity-40 text-violet-300 text-xs font-mono-num font-semibold cursor-pointer"
                  >
                    +500 Almas
                  </button>
                  <button
                    type="button"
                    disabled={!activeClient}
                    onClick={() => void runRemote({ type: 'add_souls', amount: 5000 })}
                    className="min-h-[42px] px-3 rounded bg-[#1D182C] hover:bg-[#28203D] border border-violet-500/45 disabled:opacity-40 text-violet-300 text-xs font-mono-num font-semibold cursor-pointer"
                  >
                    +5,000 Almas
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <label htmlFor="ext-admin-souls" className="text-xs text-[#949BA8]">
                    Fijar Almas exactas:
                  </label>
                  <input
                    id="ext-admin-souls"
                    type="number"
                    min={0}
                    max={9999999}
                    value={soulsDraft}
                    onChange={(e) => setSoulsDraft(e.target.value)}
                    className="w-28 min-h-[40px] px-3 rounded bg-[#0B0C10] border border-[#2C3344] text-xs font-mono-num text-violet-300"
                  />
                  <button
                    type="button"
                    disabled={!activeClient}
                    onClick={() =>
                      void runRemote({
                        type: 'set_souls',
                        amount: Math.max(0, Math.floor(Number(soulsDraft) || 0)),
                      })
                    }
                    className="min-h-[40px] px-4 rounded bg-violet-700 hover:bg-violet-600 disabled:opacity-40 text-white text-xs font-semibold cursor-pointer"
                  >
                    Aplicar Almas
                  </button>
                </div>
              </div>

              {/* Levels & Skills */}
              <div className="p-4 rounded-lg bg-[#12151C] border border-[#262C3C] space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[1, 5, 10].map((lv) => (
                    <button
                      key={lv}
                      type="button"
                      disabled={!inRun}
                      onClick={() => void runRemote({ type: 'level_up', levels: lv })}
                      className="min-h-[42px] px-3 rounded bg-[#0E1117] hover:bg-[#1A202D] border border-[#2C3344] disabled:opacity-40 text-[#E5E0D5] text-xs font-semibold cursor-pointer disabled:cursor-not-allowed"
                    >
                      +{lv} {lv === 1 ? 'Nivel' : 'Niveles'}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={!inRun}
                    onClick={() => void runRemote({ type: 'add_skill_points', points: 20 })}
                    className="min-h-[42px] px-3 rounded bg-[#0E1117] hover:bg-[#1A202D] border border-[#2C3344] disabled:opacity-40 text-amber-300 text-xs font-semibold cursor-pointer disabled:cursor-not-allowed"
                  >
                    +20 Puntos Árbol
                  </button>
                </div>
                <button
                  type="button"
                  disabled={!inRun}
                  onClick={() => void runRemote({ type: 'unlock_all_skills' })}
                  className="w-full min-h-[44px] px-4 rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-[#0B0C10] text-xs font-bold cursor-pointer disabled:cursor-not-allowed"
                >
                  Desbloquear Todo el Árbol de Habilidades en Partida
                </button>
              </div>

              {/* Floor & World */}
              <div className="p-4 rounded-lg bg-[#12151C] border border-[#262C3C] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-display font-bold text-[#E5E0D5]">
                    Salto a Cualquier Piso (1 - 999) y Semilla
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={!activeClient || activeClient.isOnlineCoop || activeClient.floorNumber <= 1}
                      onClick={() =>
                        void runRemote({
                          type: 'jump_to_floor',
                          floorNumber: Math.max(1, (activeClient?.floorNumber || 1) - 1),
                        })
                      }
                      className="min-h-[36px] px-3 rounded bg-[#0E1117] hover:bg-[#1A202D] border border-[#2C3344] disabled:opacity-40 text-xs font-mono-num text-[#E5E0D5] cursor-pointer"
                    >
                      Piso -1
                    </button>
                    <button
                      type="button"
                      disabled={!activeClient || activeClient.isOnlineCoop}
                      onClick={() =>
                        void runRemote({
                          type: 'jump_to_floor',
                          floorNumber: Math.min(999, Math.max(1, activeClient?.floorNumber || 1) + 1),
                        })
                      }
                      className="min-h-[36px] px-3 rounded bg-[#0E1117] hover:bg-[#1A202D] border border-[#2C3344] disabled:opacity-40 text-xs font-mono-num text-[#E5E0D5] cursor-pointer"
                    >
                      Piso +1
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={floorDraft}
                    onChange={(e) => setFloorDraft(e.target.value)}
                    className="w-28 min-h-[42px] px-3 rounded bg-[#0B0C10] border border-[#2C3344] text-sm font-mono-num text-amber-300"
                  />
                  <button
                    type="button"
                    disabled={!activeClient || activeClient.isOnlineCoop}
                    onClick={() =>
                      void runRemote({
                        type: 'jump_to_floor',
                        floorNumber: Math.max(1, Math.min(999, Math.floor(Number(floorDraft) || 1))),
                      })
                    }
                    className="min-h-[42px] px-4 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-[#0B0C10] text-xs font-bold cursor-pointer"
                  >
                    Ir al Piso {Math.max(1, Math.min(999, Math.floor(Number(floorDraft) || 1)))}
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {[1, 3, 5, 10, 20, 50, 100].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      disabled={!activeClient || activeClient.isOnlineCoop}
                      onClick={() => {
                        setFloorDraft(String(preset));
                        void runRemote({ type: 'jump_to_floor', floorNumber: preset });
                      }}
                      className="min-h-[36px] px-3 rounded bg-[#0E1117] hover:bg-[#1A202D] border border-[#2C3344] disabled:opacity-40 text-xs font-mono-num text-[#D4CFC4] cursor-pointer"
                    >
                      Piso {preset}
                    </button>
                  ))}
                </div>

                <div className="pt-2 border-t border-[#202634] flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    maxLength={24}
                    value={seedDraft}
                    onChange={(e) => setSeedDraft(e.target.value.toUpperCase())}
                    placeholder="ECLIPSE-XXXX"
                    className="flex-1 min-w-[160px] min-h-[42px] px-3 rounded bg-[#0B0C10] border border-[#2C3344] text-xs font-mono-num uppercase text-amber-300"
                  />
                  <button
                    type="button"
                    disabled={!soloOrLocalInRun}
                    onClick={() =>
                      void runRemote({ type: 'regenerate_floor', seedLabel: seedDraft })
                    }
                    className="min-h-[42px] px-4 rounded bg-[#1D2434] hover:bg-[#283248] border border-amber-500/50 disabled:opacity-40 text-amber-200 text-xs font-semibold cursor-pointer"
                  >
                    Regenerar Piso con Semilla
                  </button>
                </div>

                <div className="pt-2 border-t border-[#202634] grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { type: 'start' as const, label: 'Sala Inicial' },
                    { type: 'boss' as const, label: 'Santuario Jefe' },
                    { type: 'treasure' as const, label: 'Sala Tesoro' },
                    { type: 'shrine' as const, label: 'Santuario Arcano' },
                  ].map((rm) => (
                    <button
                      key={rm.type}
                      type="button"
                      disabled={!inRun}
                      onClick={() =>
                        void runRemote({ type: 'teleport_to_room', roomType: rm.type })
                      }
                      className="min-h-[42px] px-3 rounded bg-[#0E1117] hover:bg-[#1A202D] border border-[#2C3344] disabled:opacity-40 text-xs font-semibold text-[#E5E0D5] inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
                    >
                      <Crosshair className="w-3.5 h-3.5 text-red-400" />
                      <span>{rm.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Meta Unlocks & Reset */}
              <div className="p-4 rounded-lg bg-[#12151C] border border-[#262C3C] space-y-3">
                <div className="text-xs font-display font-bold text-[#E5E0D5]">
                  Desbloqueos de Meta-Progresión del Cliente
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    disabled={!activeClient}
                    onClick={() => void runRemote({ type: 'unlock_all_cosmetics' })}
                    className="min-h-[42px] px-3 rounded bg-[#0E1117] hover:bg-[#1A202D] border border-amber-500/45 disabled:opacity-40 text-amber-200 text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Todos los Cosméticos</span>
                  </button>
                  <button
                    type="button"
                    disabled={!activeClient}
                    onClick={() => void runRemote({ type: 'unlock_all_bestiary' })}
                    className="min-h-[42px] px-3 rounded bg-[#0E1117] hover:bg-[#1A202D] border border-red-500/45 disabled:opacity-40 text-red-200 text-xs font-semibold cursor-pointer"
                  >
                    Completar Bestiario
                  </button>
                  <button
                    type="button"
                    disabled={!activeClient}
                    onClick={() => void runRemote({ type: 'unlock_all_achievements' })}
                    className="min-h-[42px] px-3 rounded bg-[#0E1117] hover:bg-[#1A202D] border border-amber-500/45 disabled:opacity-40 text-amber-200 text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Trophy className="w-3.5 h-3.5" />
                    <span>Todos los Logros</span>
                  </button>
                  <button
                    type="button"
                    disabled={!activeClient}
                    onClick={() => void runRemote({ type: 'max_all_blessings' })}
                    className="min-h-[42px] px-3 rounded bg-[#0E1117] hover:bg-[#1A202D] border border-violet-500/45 disabled:opacity-40 text-violet-200 text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Crown className="w-3.5 h-3.5" />
                    <span>Maxear Altar Eterno</span>
                  </button>
                </div>

                <div className="p-3 rounded bg-[#191216] border border-red-900/50 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-red-200">
                    {confirmMetaReset
                      ? '¿Confirmas reiniciar toda la meta-progresión del cliente?'
                      : 'Reiniciar meta-progresión (Almas, Altar, Logros, PvP local)'}
                  </span>
                  {confirmMetaReset ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={!activeClient}
                        onClick={() => {
                          setConfirmMetaReset(false);
                          setPvpBeforePreview(undefined);
                          void runRemote({ type: 'reset_meta_progress' });
                        }}
                        className="min-h-[38px] px-3 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-bold cursor-pointer"
                      >
                        Sí, Reiniciar
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmMetaReset(false)}
                        className="min-h-[38px] px-3 rounded bg-[#1E2430] text-[#D4CFC4] text-xs cursor-pointer"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={!activeClient}
                      onClick={() => setConfirmMetaReset(true)}
                      className="min-h-[38px] px-3 rounded bg-[#2A151B] hover:bg-[#3A1B24] border border-red-700/60 disabled:opacity-40 text-red-200 text-xs font-semibold cursor-pointer"
                    >
                      Reiniciar Meta
                    </button>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* SECTION 4: ARENA PVP Y SERVIDOR */}
          {section === 'pvp_server' && (
            <section className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="font-display text-xl font-bold text-[#E5E0D5]">
                    Arena PvP, Salas y Datos del Servidor
                  </h1>
                  <p className="text-xs text-[#949BA8] mt-1">
                    Prueba el rango del cliente conectado y gestiona la clasificación persistente, salas activas y guardados en disco del servidor.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    clientRef.current!.requestRefresh();
                    void refreshServerData();
                  }}
                  className="min-h-[42px] px-4 py-2 rounded-md bg-[#161A24] border border-[#2C3344] hover:border-amber-500/60 text-xs font-semibold text-[#E5E0D5] inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingServerData ? 'animate-spin' : ''}`} />
                  <span>Actualizar Datos</span>
                </button>
              </div>

              {/* Client Live Rank Tester */}
              {activeClient && (
                <div className="p-4 rounded-lg bg-[#12151C] border border-[#262C3C] space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-display font-bold text-red-300">
                      <Swords className="w-4 h-4" />
                      <span>Probador de Rango PvP del Cliente ({activeClient.playerName})</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setPvpBeforePreview(undefined);
                        void runRemote({ type: 'reset_pvp_stats' });
                      }}
                      className="min-h-[34px] px-3 rounded bg-[#0E1117] hover:bg-[#1A202D] border border-[#2C3344] text-xs text-[#949BA8] hover:text-white cursor-pointer"
                    >
                      Reiniciar PvP Local
                    </button>
                  </div>

                  <RankDisplay
                    elo={activeClient.pvpElo}
                    previousElo={pvpBeforePreview}
                    rankUp={
                      pvpBeforePreview !== undefined &&
                      didPvpRankIncrease(pvpBeforePreview, activeClient.pvpElo)
                    }
                    wins={activeClient.pvpWins}
                    losses={activeClient.pvpLosses}
                    winStreak={activeClient.pvpWinStreak}
                    variant="card"
                  />

                  <div className="flex flex-wrap gap-1.5">
                    {PVP_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setPvpBeforePreview(activeClient.pvpElo);
                          void runRemote({ type: 'set_pvp_elo', elo: preset.elo });
                        }}
                        className="min-h-[38px] px-3 py-1.5 rounded bg-[#0E1117] hover:bg-[#1A202D] border border-[#2C3344] text-xs font-mono-num text-[#D4CFC4] cursor-pointer"
                      >
                        {preset.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setPvpBeforePreview(activeClient.pvpElo);
                        void runRemote({
                          type: 'set_pvp_elo',
                          elo: Math.min(3500, activeClient.pvpElo + 32),
                          incrementWin: true,
                        });
                      }}
                      className="min-h-[38px] px-3.5 py-1.5 rounded bg-emerald-800/80 hover:bg-emerald-700 border border-emerald-500/60 text-xs font-semibold text-white cursor-pointer"
                    >
                      Simular Victoria (+32 ELO)
                    </button>
                  </div>
                </div>
              )}

              {/* Server Persistent PvP Leaderboard Manager */}
              <div className="p-4 rounded-lg bg-[#12151C] border border-[#262C3C] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-display font-bold text-amber-300">
                    <Crown className="w-4 h-4" />
                    <span>Clasificación PvP del Servidor ({leaderboard.length} duelistas)</span>
                  </div>
                  {confirmLeaderboardReset ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          await clientRef.current!.resetPvpLeaderboard();
                          setConfirmLeaderboardReset(false);
                          await refreshServerData();
                          notify('Clasificación PvP del servidor reiniciada.');
                        }}
                        className="min-h-[34px] px-3 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-bold cursor-pointer"
                      >
                        Confirmar Vaciar Tabla
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmLeaderboardReset(false)}
                        className="min-h-[34px] px-3 rounded bg-[#1E2430] text-[#D4CFC4] text-xs cursor-pointer"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmLeaderboardReset(true)}
                      className="min-h-[34px] px-3 rounded bg-[#23181C] border border-red-700/50 text-xs text-red-200 cursor-pointer"
                    >
                      Reiniciar Clasificación
                    </button>
                  )}
                </div>

                {leaderboard.length === 0 ? (
                  <div className="p-4 rounded bg-[#0E1117] border border-[#202634] text-xs text-[#949BA8] text-center">
                    No hay registros en la clasificación PvP del servidor todavía.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded border border-[#232836] bg-[#0E1117]">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-[#232836] text-[#949BA8]">
                          <th className="py-2.5 px-3 font-medium">Duelista</th>
                          <th className="py-2.5 px-3 font-medium">División</th>
                          <th className="py-2.5 px-3 font-medium">ELO</th>
                          <th className="py-2.5 px-3 font-medium text-right">V - D</th>
                          <th className="py-2.5 px-3 font-medium text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1C212E]">
                        {leaderboard.map((entry) => (
                          <tr key={entry.playerKey} className="hover:bg-[#141923]">
                            <td className="py-2 px-3">
                              <div className="font-semibold text-[#E5E0D5]">{entry.name}</div>
                              <div className="text-[10px] font-mono-num text-[#949BA8]">
                                {entry.playerKey}
                              </div>
                            </td>
                            <td className="py-2 px-3 font-semibold" style={{ color: entry.tierColor }}>
                              {entry.tierName}
                            </td>
                            <td className="py-2 px-3">
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="number"
                                  min={600}
                                  max={3500}
                                  value={editEloDrafts[entry.playerKey] ?? String(entry.elo)}
                                  onChange={(e) =>
                                    setEditEloDrafts((prev) => ({
                                      ...prev,
                                      [entry.playerKey]: e.target.value,
                                    }))
                                  }
                                  className="w-20 min-h-[34px] px-2 rounded bg-[#0B0C10] border border-[#2C3344] font-mono-num text-xs text-amber-300"
                                />
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const nextElo = Number(editEloDrafts[entry.playerKey] ?? entry.elo);
                                    await clientRef.current!.updatePvpPlayer(entry.playerKey, {
                                      elo: nextElo,
                                    });
                                    await refreshServerData();
                                    notify(`ELO de ${entry.name} actualizado.`);
                                  }}
                                  className="min-h-[34px] px-2.5 rounded bg-amber-600 hover:bg-amber-500 text-[#0B0C10] text-[11px] font-bold cursor-pointer"
                                >
                                  Fijar
                                </button>
                              </div>
                            </td>
                            <td className="py-2 px-3 text-right font-mono-num text-[#C2BDB2]">
                              {entry.wins} - {entry.losses}
                            </td>
                            <td className="py-2 px-3 text-right">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await clientRef.current!.updatePvpPlayer(entry.playerKey, {
                                      reset: true,
                                    });
                                    await refreshServerData();
                                    notify(`Estadísticas de ${entry.name} reiniciadas.`);
                                  }}
                                  className="min-h-[32px] px-2 rounded bg-[#161A24] border border-[#2C3344] text-[11px] text-[#D4CFC4] cursor-pointer"
                                >
                                  Reset
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await clientRef.current!.deletePvpPlayer(entry.playerKey);
                                    await refreshServerData();
                                    notify(`Jugador ${entry.name} eliminado.`);
                                  }}
                                  aria-label={`Eliminar a ${entry.name}`}
                                  className="min-h-[32px] px-2 rounded bg-[#23181C] border border-red-800/50 text-red-300 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {recentMatches.length > 0 && (
                  <div className="pt-2 space-y-1.5">
                    <div className="text-[11px] font-semibold text-[#949BA8]">
                      Últimos Duelos Oficiales ({recentMatches.length})
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {recentMatches.slice(0, 6).map((m) => (
                        <div
                          key={m.id}
                          className="px-3 py-2 rounded bg-[#0E1117] border border-[#202634] flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="truncate">
                            <strong className="text-emerald-300">{m.winnerName}</strong> venció a{' '}
                            <strong className="text-red-300">{m.loserName}</strong>
                          </span>
                          <span className="font-mono-num text-[11px] text-[#949BA8] shrink-0">
                            {m.score} · +{m.eloDelta}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Active Rooms */}
              <div className="p-4 rounded-lg bg-[#12151C] border border-[#262C3C] space-y-3">
                <div className="text-xs font-display font-bold text-[#E5E0D5]">
                  Salas Activas en el Servidor ({snapshot?.rooms.length ?? 0})
                </div>
                {!snapshot || snapshot.rooms.length === 0 ? (
                  <div className="p-3 rounded bg-[#0E1117] border border-[#202634] text-xs text-[#949BA8]">
                    No hay salas Co-op ni PvP abiertas actualmente.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {snapshot.rooms.map((rm) => (
                      <div
                        key={rm.code}
                        className="p-3 rounded bg-[#0E1117] border border-[#232836] flex flex-wrap items-center justify-between gap-3 text-xs"
                      >
                        <div>
                          <div className="font-semibold text-[#E5E0D5]">
                            <span className="font-mono-num text-amber-300">#{rm.code}</span> ·{' '}
                            {rm.mode === 'pvp' ? 'Arena PvP' : `Cooperativo Piso ${rm.floorNumber}`}
                            {rm.phase ? ` · ${rm.phase}` : ''}
                          </div>
                          <div className="text-[11px] font-mono-num text-[#949BA8] mt-0.5">
                            {rm.playerCount}/{rm.maxPlayers} jugadores ·{' '}
                            {rm.players.map((p) => p.name).join(', ')}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            await clientRef.current!.closeRoom(rm.code);
                            clientRef.current!.requestRefresh();
                            notify(`Sala #${rm.code} cerrada.`);
                          }}
                          className="min-h-[38px] px-3 rounded bg-[#23181C] hover:bg-[#311F25] border border-red-600/50 text-xs font-semibold text-red-200 cursor-pointer"
                        >
                          Cerrar Sala
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Server Cloud Saves */}
              <div className="p-4 rounded-lg bg-[#12151C] border border-[#262C3C] space-y-3">
                <div className="flex items-center gap-2 text-xs font-display font-bold text-sky-300">
                  <Database className="w-4 h-4" />
                  <span>Partidas Sincronizadas en Disco ({serverSaves.length})</span>
                </div>
                {serverSaves.length === 0 ? (
                  <div className="p-3 rounded bg-[#0E1117] border border-[#202634] text-xs text-[#949BA8]">
                    Sin archivos de guardado sincronizados en el servidor.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {serverSaves.map((sv) => (
                      <div
                        key={sv.syncKey}
                        className="p-3 rounded bg-[#0E1117] border border-[#232836] flex flex-wrap items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-mono-num font-bold text-[#E5E0D5]">
                            {sv.syncKey} · {sv.slotName}
                          </div>
                          <div className="text-[11px] font-mono-num text-[#949BA8] mt-0.5">
                            Piso máx {sv.bestFloor} · {sv.soulShards} Almas · {sv.pvpElo} ELO ·{' '}
                            {(sv.bytes / 1024).toFixed(1)} KB
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={async () => {
                              const detail = await clientRef.current!.fetchSaveDetail(sv.syncKey);
                              setSelectedSaveJson({
                                syncKey: sv.syncKey,
                                json: JSON.stringify(detail, null, 2),
                              });
                            }}
                            className="min-h-[36px] px-3 rounded bg-[#161A24] border border-[#2C3344] text-xs text-[#D4CFC4] cursor-pointer"
                          >
                            Ver JSON
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await clientRef.current!.deleteServerSave(sv.syncKey);
                              await refreshServerData();
                              if (selectedSaveJson?.syncKey === sv.syncKey) {
                                setSelectedSaveJson(null);
                              }
                              notify(`Respaldo ${sv.syncKey} eliminado del servidor.`);
                            }}
                            className="min-h-[36px] px-3 rounded bg-[#23181C] border border-red-800/50 text-xs text-red-200 cursor-pointer"
                          >
                            Eliminar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {selectedSaveJson && (
                  <div className="space-y-2 pt-2 border-t border-[#202634]">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono-num text-amber-300">
                        Inspección: {selectedSaveJson.syncKey}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedSaveJson(null)}
                        className="text-xs text-[#949BA8] hover:text-white cursor-pointer"
                      >
                        Cerrar vista
                      </button>
                    </div>
                    <pre className="max-h-64 overflow-auto crypt-scroll p-3 rounded bg-[#090A0E] border border-[#232836] text-[11px] font-mono-num text-[#C2BDB2]">
                      {selectedSaveJson.json}
                    </pre>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* SECTION 5: DIAGNÓSTICO Y AUDIO */}
          {section === 'diagnostics' && (
            <section className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="font-display text-xl font-bold text-[#E5E0D5]">
                    Diagnóstico en Tiempo Real y Audio Remoto
                  </h1>
                  <p className="text-xs text-[#949BA8] mt-1">
                    Telemetría viva del motor del cliente seleccionado, disparo de audio y guardado de respaldo.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!activeClient}
                  onClick={() => void runRemote({ type: 'request_diagnostics' }, 'Lectura actualizada.')}
                  className="min-h-[42px] px-4 rounded-md bg-[#161A24] border border-[#2C3344] hover:border-amber-500/60 disabled:opacity-40 text-xs font-semibold text-[#E5E0D5] inline-flex items-center gap-2 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Refrescar Motor</span>
                </button>
              </div>

              {!activeClient?.diagnostics ? (
                <div className="p-6 rounded-lg bg-[#12151C] border border-[#262C3C] text-xs text-[#949BA8]">
                  Conecta y selecciona un cliente de juego para visualizar sus métricas en vivo.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    { label: 'Modo', val: activeClient.diagnostics.modeLabel },
                    {
                      label: 'Piso',
                      val: activeClient.diagnostics.inRun
                        ? `${activeClient.diagnostics.floorNumber} · ${activeClient.diagnostics.floorName}`
                        : 'Santuario Inicial',
                    },
                    { label: 'Semilla', val: activeClient.diagnostics.runSeedLabel },
                    {
                      label: 'Posición / Casilla',
                      val: `${activeClient.diagnostics.px}, ${activeClient.diagnostics.py} (${activeClient.diagnostics.tileX},${activeClient.diagnostics.tileY})`,
                    },
                    { label: 'Enemigos vivos', val: String(activeClient.diagnostics.enemiesAlive) },
                    {
                      label: 'Proyectiles / Botín',
                      val: `${activeClient.diagnostics.projectilesActive} / ${activeClient.diagnostics.lootOnGround}`,
                    },
                    {
                      label: 'Salas descubiertas',
                      val: `${activeClient.diagnostics.roomsDiscovered}/${activeClient.diagnostics.roomsTotal}`,
                    },
                    {
                      label: 'Héroe',
                      val: `Nv.${activeClient.diagnostics.heroLevel} · ${activeClient.diagnostics.heroHp}/${activeClient.diagnostics.heroMaxHp} PV`,
                    },
                    {
                      label: 'ATQ / ARC / CRIT',
                      val: `${activeClient.diagnostics.heroBaseDamage} / ${activeClient.diagnostics.heroArcanePower} / ${activeClient.diagnostics.heroCritChance}%`,
                    },
                    {
                      label: 'Armadura / Inventario',
                      val: `${activeClient.diagnostics.heroArmor} ARM · ${activeClient.diagnostics.inventoryCount} ítems`,
                    },
                  ].map((row) => (
                    <div
                      key={row.label}
                      className="p-3.5 rounded-lg bg-[#12151C] border border-[#262C3C]"
                    >
                      <div className="text-[11px] text-[#949BA8]">{row.label}</div>
                      <div className="font-mono-num text-xs font-semibold text-[#E5E0D5] mt-1 truncate">
                        {row.val}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Remote Audio & Checkpoint */}
              <div className="p-4 rounded-lg bg-[#12151C] border border-[#262C3C] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-display font-bold text-[#E5E0D5]">
                    Audio Remoto y Guardado de Partida
                  </span>
                  {activeClient && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void runRemote({ type: 'toggle_music' })}
                        className="min-h-[36px] px-3 rounded bg-[#0E1117] border border-[#2C3344] text-xs text-[#D4CFC4] inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Music className="w-3.5 h-3.5 text-amber-400" />
                        <span>{activeClient.musicEnabled ? 'Música ON' : 'Música OFF'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void runRemote({ type: 'toggle_mute' })}
                        className="min-h-[36px] px-3 rounded bg-[#0E1117] border border-[#2C3344] text-xs text-[#D4CFC4] inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        {activeClient.muted ? (
                          <VolumeX className="w-3.5 h-3.5 text-red-400" />
                        ) : (
                          <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                        )}
                        <span>{activeClient.muted ? 'Silenciado' : 'Audio ON'}</span>
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {[
                    { id: 'victory' as const, label: 'Sonido Victoria' },
                    { id: 'level' as const, label: 'Sonido Nivel' },
                    { id: 'loot' as const, label: 'Sonido Botín' },
                    { id: 'hit' as const, label: 'Sonido Golpe' },
                  ].map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      disabled={!activeClient}
                      onClick={() => void runRemote({ type: 'play_test_sound', kind: s.id })}
                      className="min-h-[42px] px-3 rounded bg-[#0E1117] hover:bg-[#1A202D] border border-[#2C3344] disabled:opacity-40 text-xs text-[#E5E0D5] cursor-pointer"
                    >
                      {s.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={!inRun}
                    onClick={() => void runRemote({ type: 'save_checkpoint_now' })}
                    className="min-h-[42px] px-3 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-[#0B0C10] text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Guardar Partida</span>
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* SECTION 6: CONECTAR OTRA WEB APP EXTERNA */}
          {section === 'connect_external' && (
            <section className="space-y-5">
              <div>
                <h1 className="font-display text-xl font-bold text-[#E5E0D5]">
                  Conectar Otra Web App Externa al Servidor
                </h1>
                <p className="text-xs text-[#949BA8] mt-1">
                  El servidor habilita CORS completo y autenticación por clave en REST y WebSocket para que cualquier aplicación web externa (en otro puerto, dominio o dispositivo) administre el juego y la base PvP.
                </p>
              </div>

              <div className="p-4 rounded-lg bg-[#12151C] border border-[#262C3C] space-y-3">
                {[
                  { id: 'rest', label: 'Base API REST (CORS Habilitado)', val: `${normalizedServer}/api/admin` },
                  { id: 'ws', label: 'Endpoint WebSocket Tiempo Real', val: wsEndpointUrl },
                  { id: 'header', label: 'Cabecera de Autenticación', val: `X-Admin-Key: ${adminKeyInput.trim()}` },
                  { id: 'link', label: 'Enlace Directo de Autoconexión', val: directShareUrl },
                ].map((item) => (
                  <div
                    key={item.id}
                    className="p-3 rounded bg-[#0E1117] border border-[#232836] flex flex-wrap items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-[11px] text-[#949BA8]">{item.label}</div>
                      <div className="font-mono-num text-xs text-amber-300 truncate max-w-xl mt-0.5">
                        {item.val}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyText(item.id, item.val)}
                      className="min-h-[36px] px-3 rounded bg-[#161A24] border border-[#2C3344] hover:border-amber-500/60 text-xs text-[#E5E0D5] inline-flex items-center gap-1.5 cursor-pointer shrink-0"
                    >
                      {copiedId === item.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedId === item.id ? 'Copiado' : 'Copiar'}</span>
                    </button>
                  </div>
                ))}
              </div>

              {snapshot?.lanUrls && snapshot.lanUrls.length > 0 && (
                <div className="p-4 rounded-lg bg-[#12151C] border border-[#262C3C] space-y-2">
                  <div className="text-xs font-display font-bold text-[#E5E0D5]">
                    Direcciones LAN / Hotspot Disponibles
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {snapshot.lanUrls.map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => copyText(u, `${u}/admin`)}
                        className="min-h-[36px] px-3 rounded bg-[#0E1117] border border-[#2C3344] hover:border-amber-500/60 text-xs font-mono-num text-sky-300 cursor-pointer"
                      >
                        {u}/admin
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="p-4 rounded-lg bg-[#12151C] border border-[#262C3C] space-y-2">
                <div className="text-xs font-display font-bold text-[#E5E0D5]">
                  Ejemplo de Integración desde Otra Web App (Fetch / WebSocket)
                </div>
                <pre className="p-3 rounded bg-[#090A0E] border border-[#232836] text-[11px] font-mono-num text-[#C2BDB2] overflow-x-auto">
{`// 1. Consultar estado y clientes conectados
const res = await fetch("${normalizedServer}/api/admin/status", {
  headers: { "X-Admin-Key": "${adminKeyInput.trim()}" }
});

// 2. Enviar comando remoto a un cliente conectado
await fetch("${normalizedServer}/api/admin/command", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Admin-Key": "${adminKeyInput.trim()}"
  },
  body: JSON.stringify({
    targetClientId: "${activeClient?.clientId || 'CLIENT_ID'}",
    command: { type: "jump_to_floor", floorNumber: 10 }
  })
});`}
                </pre>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
};
