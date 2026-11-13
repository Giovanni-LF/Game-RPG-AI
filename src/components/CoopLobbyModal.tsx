import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Globe,
  Lock,
  Plus,
  QrCode,
  RefreshCw,
  Server,
  Smartphone,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import { coopClient } from '../net/coopClient';
import {
  HostSetupPayload,
  HotspotGuestSession,
  HotspotHostSession,
} from '../net/hotspotP2P';
import type { CoopPlayerSync, CoopRoomSummary } from '../types/coop';
import { QrCodeBox } from './QrCodeBox';

interface CoopLobbyModalProps {
  playerName: string;
  onChangePlayerName: (name: string) => void;
  rooms: CoopRoomSummary[];
  loadingRooms: boolean;
  wsConnected: boolean;
  errorMessage: string | null;
  initialJoinCode?: string;
  getHostPayload: () => HostSetupPayload;
  onRefreshRooms: () => void;
  onCreateRoom: (isPublic: boolean) => void;
  onJoinRoom: (code: string) => void;
  onClose: () => void;
}

interface LanInfoResponse {
  port: number;
  ips: string[];
  urls: string[];
}

export const CoopLobbyModal: React.FC<CoopLobbyModalProps> = ({
  playerName,
  onChangePlayerName,
  rooms,
  loadingRooms,
  wsConnected,
  errorMessage,
  initialJoinCode = '',
  getHostPayload,
  onRefreshRooms,
  onCreateRoom,
  onJoinRoom,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'lan_server' | 'hotspot_p2p'>('lan_server');

  // LAN / Server tab state
  const [isPublic, setIsPublic] = useState(true);
  const [joinCode, setJoinCode] = useState(initialJoinCode);
  const [serverInput, setServerInput] = useState<string>(() => coopClient.getServerOverride());
  const [lanUrls, setLanUrls] = useState<string[]>([]);
  const [showServerQr, setShowServerQr] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Hotspot P2P (Browser-to-Browser) tab state
  const [p2pRole, setP2pRole] = useState<'host' | 'guest'>('host');
  const [p2pBusy, setP2pBusy] = useState(false);
  const [p2pError, setP2pError] = useState<string | null>(null);

  // P2P Host state
  const hostSessionRef = useRef<HotspotHostSession | null>(null);
  const [hostRoomCode, setHostRoomCode] = useState('');
  const [hostPlayers, setHostPlayers] = useState<CoopPlayerSync[]>([]);
  const [activeOfferSlotId, setActiveOfferSlotId] = useState('');
  const [activeOfferToken, setActiveOfferToken] = useState('');
  const [answerDraft, setAnswerDraft] = useState('');

  // P2P Guest state
  const guestSessionRef = useRef<HotspotGuestSession | null>(null);
  const [guestOfferInput, setGuestOfferInput] = useState('');
  const [guestAnswerToken, setGuestAnswerToken] = useState('');
  const [guestTargetCode, setGuestTargetCode] = useState('');
  const [guestConnected, setGuestConnected] = useState(false);

  useEffect(() => {
    if (initialJoinCode) {
      setJoinCode(initialJoinCode);
    }
  }, [initialJoinCode]);

  // Fetch LAN/Hotspot IP info from Node server if reachable
  useEffect(() => {
    let cancelled = false;
    const base = coopClient.getHttpBaseUrl();
    fetch(`${base}/api/lan-info`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: LanInfoResponse | null) => {
        if (!cancelled && data?.urls) {
          setLanUrls(data.urls);
        }
      })
      .catch(() => {
        if (!cancelled) setLanUrls([]);
      });
    return () => {
      cancelled = true;
    };
  }, [wsConnected]);

  // Cleanup unlaunched P2P sessions if modal closes without entering game
  useEffect(() => {
    return () => {
      if (hostSessionRef.current && coopClient.getHostSession() !== hostSessionRef.current) {
        hostSessionRef.current.destroy();
      }
      if (guestSessionRef.current && coopClient.getMode() !== 'p2p-guest') {
        guestSessionRef.current.destroy();
      }
    };
  }, []);

  const copyText = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedKey(key);
    window.setTimeout(() => {
      setCopiedKey((curr) => (curr === key ? null : curr));
    }, 1800);
  };

  const handleApplyServerUrl = (e: React.FormEvent) => {
    e.preventDefault();
    coopClient.setServerOverride(serverInput);
    onRefreshRooms();
  };

  const handleResetServerUrl = () => {
    setServerInput('');
    coopClient.setServerOverride('');
    onRefreshRooms();
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = joinCode.trim().toUpperCase();
    if (!cleaned) return;
    onJoinRoom(cleaned);
  };

  // --- Hotspot P2P Host handlers ---
  const handleStartP2PHost = async () => {
    setP2pError(null);
    setP2pBusy(true);
    try {
      hostSessionRef.current?.destroy();
      const session = new HotspotHostSession(getHostPayload());
      hostSessionRef.current = session;
      setHostRoomCode(session.getRoomCode());
      setHostPlayers(session.getPlayers());
      session.onGuestsChange((players) => {
        setHostPlayers([...players]);
      });
      const invite = await session.createInviteOffer();
      setActiveOfferSlotId(invite.slotId);
      setActiveOfferToken(invite.offerToken);
      setAnswerDraft('');
    } catch (err) {
      setP2pError(err instanceof Error ? err.message : 'No se pudo iniciar la sala Hotspot.');
    } finally {
      setP2pBusy(false);
    }
  };

  const handleGenerateNextOffer = async () => {
    if (!hostSessionRef.current) return;
    setP2pError(null);
    setP2pBusy(true);
    try {
      const invite = await hostSessionRef.current.createInviteOffer();
      setActiveOfferSlotId(invite.slotId);
      setActiveOfferToken(invite.offerToken);
      setAnswerDraft('');
    } catch (err) {
      setP2pError(err instanceof Error ? err.message : 'Error generando invitación.');
    } finally {
      setP2pBusy(false);
    }
  };

  const handleHostAcceptAnswer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hostSessionRef.current || !activeOfferSlotId || !answerDraft.trim()) return;
    setP2pError(null);
    setP2pBusy(true);
    try {
      await hostSessionRef.current.acceptGuestAnswer(activeOfferSlotId, answerDraft);
      setAnswerDraft('');
    } catch (err) {
      setP2pError(err instanceof Error ? err.message : 'No se pudo emparejar al invitado.');
    } finally {
      setP2pBusy(false);
    }
  };

  const handleHostEnterDungeon = () => {
    const session = hostSessionRef.current;
    if (!session) return;
    coopClient.useHotspotHost(session);
    session.enterRoomNow();
  };

  // --- Hotspot P2P Guest handlers ---
  const handleGuestCreateAnswer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guestOfferInput.trim()) return;
    setP2pError(null);
    setP2pBusy(true);
    setGuestConnected(false);
    try {
      guestSessionRef.current?.destroy();
      const guest = new HotspotGuestSession();
      guestSessionRef.current = guest;
      guest.onStatus((ok) => setGuestConnected(ok));
      coopClient.useHotspotGuest(guest);

      const { answerToken, roomCode } = await guest.acceptOfferAndCreateAnswer(
        guestOfferInput,
        getHostPayload()
      );
      setGuestAnswerToken(answerToken);
      setGuestTargetCode(roomCode);
    } catch (err) {
      setP2pError(err instanceof Error ? err.message : 'No se pudo procesar la invitación.');
    } finally {
      setP2pBusy(false);
    }
  };

  const primaryLanShareUrl =
    lanUrls[0] || (typeof window !== 'undefined' ? window.location.origin : '');

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3 sm:p-4">
      <div className="w-full max-w-2xl max-h-[92dvh] flex flex-col bg-[#12151C] border border-[#2C3344] rounded-lg overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-[#232836] flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg sm:text-xl font-bold text-[#E5E0D5]">
              Multijugador en Red / Hotspot
            </h2>
            <p className="text-xs text-[#949BA8] mt-0.5">
              Hasta 4 jugadores por servidor local, Wi-Fi o Hotspot del celular sin internet
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar sala cooperativa"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md bg-[#181C26] border border-[#2C3344] text-[#949BA8] hover:text-[#E5E0D5] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Switcher Tabs */}
        <div className="grid grid-cols-2 gap-1.5 p-2 bg-[#0E1117] border-b border-[#232836]">
          <button
            type="button"
            onClick={() => setActiveTab('lan_server')}
            className={`min-h-[44px] px-3 py-2 rounded-md text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
              activeTab === 'lan_server'
                ? 'bg-[#1D2434] text-amber-300 border border-amber-500/60'
                : 'text-[#949BA8] hover:text-[#E5E0D5] border border-transparent'
            }`}
          >
            <Server className="w-4 h-4" />
            <span>Servidor Local / Red</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('hotspot_p2p')}
            className={`min-h-[44px] px-3 py-2 rounded-md text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
              activeTab === 'hotspot_p2p'
                ? 'bg-[#152433] text-sky-300 border border-sky-500/60'
                : 'text-[#949BA8] hover:text-[#E5E0D5] border border-transparent'
            }`}
          >
            <Smartphone className="w-4 h-4" />
            <span>Hotspot P2P (Sin Servidor)</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto crypt-scroll p-4 sm:p-6 space-y-5">
          {(errorMessage || p2pError) && (
            <div className="p-3 rounded-md bg-red-950/50 border border-red-800/80 text-xs text-red-200">
              {p2pError || errorMessage}
            </div>
          )}

          {/* Player Name */}
          <div className="space-y-1.5">
            <label htmlFor="coop-player-name" className="block text-xs font-medium text-[#D4CFC4]">
              Nombre en la incursión
            </label>
            <input
              id="coop-player-name"
              type="text"
              maxLength={18}
              value={playerName}
              onChange={(e) => onChangePlayerName(e.target.value)}
              placeholder="Ej. Valerius"
              className="w-full min-h-[44px] px-3.5 py-2 rounded-md bg-[#0C0E13] border border-[#2C3344] focus:border-amber-500/80 focus:outline-none text-sm text-[#E5E0D5]"
            />
          </div>

          {activeTab === 'lan_server' ? (
            <>
              {/* LAN / Hotspot Server Discovery & Custom IP */}
              <div className="p-3.5 rounded-lg bg-[#151923] border border-[#262C3C] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Wifi
                      className={`w-4 h-4 ${wsConnected ? 'text-emerald-400' : 'text-[#949BA8]'}`}
                    />
                    <span className="text-xs font-semibold text-[#E5E0D5]">
                      {wsConnected
                        ? 'Servidor local conectado'
                        : 'Sin enlace con servidor WebSocket'}
                    </span>
                  </div>
                  {primaryLanShareUrl && (
                    <button
                      type="button"
                      onClick={() => setShowServerQr((v) => !v)}
                      className="inline-flex items-center gap-1.5 min-h-[34px] px-2.5 py-1 rounded bg-[#1B2130] border border-[#323B52] hover:border-amber-500/60 text-[11px] text-amber-300 cursor-pointer"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      <span>{showServerQr ? 'Ocultar QR' : 'QR para Hotspot'}</span>
                    </button>
                  )}
                </div>

                {lanUrls.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[11px] text-[#949BA8]">
                      Comparte esta dirección con otros celulares conectados al mismo Wi-Fi o Hotspot:
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {lanUrls.map((url) => (
                        <button
                          key={url}
                          type="button"
                          onClick={() => copyText(url, url)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[#0E1117] border border-[#2C3344] hover:border-amber-500/70 text-xs font-mono-num text-amber-300 cursor-pointer"
                        >
                          <span>{url}</span>
                          {copiedKey === url ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5 text-[#949BA8]" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {showServerQr && primaryLanShareUrl && (
                  <div className="pt-1 flex justify-center">
                    <QrCodeBox
                      value={primaryLanShareUrl}
                      size={160}
                      label="Escanea desde otro celular en el Hotspot"
                    />
                  </div>
                )}

                <form onSubmit={handleApplyServerUrl} className="space-y-1.5 pt-1 border-t border-[#232836]">
                  <label className="block text-[11px] text-[#949BA8]">
                    Conectar a la IP del servidor local del anfitrión (opcional, ej. 192.168.43.12:3000)
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={serverInput}
                      onChange={(e) => setServerInput(e.target.value)}
                      placeholder="192.168.43.12:3000"
                      className="flex-1 min-w-0 min-h-[40px] px-3 py-1.5 rounded bg-[#0C0E13] border border-[#2C3344] focus:border-amber-500/80 focus:outline-none text-xs font-mono-num text-[#E5E0D5]"
                    />
                    <div className="flex items-center gap-1.5">
                      <button
                        type="submit"
                        className="min-h-[40px] px-3.5 py-1.5 rounded bg-[#22293A] hover:bg-[#2B3348] border border-[#384158] text-xs font-semibold text-[#E5E0D5] cursor-pointer"
                      >
                        Conectar IP
                      </button>
                      {coopClient.getServerOverride() && (
                        <button
                          type="button"
                          onClick={handleResetServerUrl}
                          className="min-h-[40px] px-3 py-1.5 rounded bg-[#12151C] border border-[#2C3344] text-xs text-[#949BA8] hover:text-white cursor-pointer"
                        >
                          Local
                        </button>
                      )}
                    </div>
                  </div>
                </form>
              </div>

              {/* Two-column Create / Join */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-lg bg-[#161A23] border border-[#262C3C] space-y-3">
                  <h3 className="font-display text-sm font-bold text-[#E5E0D5]">Crear Nueva Sala</h3>
                  <p className="text-xs text-[#949BA8] leading-relaxed">
                    Inicia una mazmorra cooperativa y comparte el código de 5 letras con tus aliados.
                  </p>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setIsPublic(true)}
                      className={`min-h-[44px] px-2.5 py-2 rounded-md border text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                        isPublic
                          ? 'bg-[#222838] border-amber-500/80 text-amber-300'
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
                          ? 'bg-[#222838] border-amber-500/80 text-amber-300'
                          : 'bg-[#10131A] border-[#262C3C] text-[#949BA8]'
                      }`}
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>Solo código</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={!wsConnected}
                    onClick={() => onCreateRoom(isPublic)}
                    className="w-full min-h-[46px] py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-45 disabled:cursor-not-allowed active:bg-amber-400 text-[#0B0C10] font-semibold text-sm rounded-md transition-colors cursor-pointer"
                  >
                    Crear y Entrar
                  </button>
                </div>

                <form
                  onSubmit={handleJoinSubmit}
                  className="p-4 rounded-lg bg-[#161A23] border border-[#262C3C] flex flex-col justify-between space-y-3"
                >
                  <div className="space-y-2">
                    <h3 className="font-display text-sm font-bold text-[#E5E0D5]">
                      Unirse por Código
                    </h3>
                    <p className="text-xs text-[#949BA8] leading-relaxed">
                      Introduce el código de sala del anfitrión en esta red local.
                    </p>
                    <input
                      type="text"
                      maxLength={6}
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                      placeholder="EJ. A7K2Q"
                      className="w-full min-h-[44px] px-3.5 py-2 rounded-md bg-[#0C0E13] border border-[#2C3344] focus:border-amber-500/80 focus:outline-none text-sm font-mono-num tracking-widest uppercase text-[#E5E0D5]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!wsConnected || !joinCode.trim()}
                    className="w-full min-h-[46px] py-2.5 bg-[#202636] hover:bg-[#293145] disabled:opacity-45 disabled:cursor-not-allowed text-[#E5E0D5] border border-[#384158] font-semibold text-sm rounded-md transition-colors cursor-pointer"
                  >
                    Unirse a la Sala
                  </button>
                </form>
              </div>

              {/* Public Rooms List */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-amber-400" />
                    <h3 className="font-display text-sm font-bold text-[#E5E0D5]">
                      Salas Activas en este Servidor
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={onRefreshRooms}
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-3 py-1.5 rounded-md bg-[#161A23] border border-[#2C3344] hover:border-[#475066] text-xs text-[#D4CFC4] cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingRooms ? 'animate-spin' : ''}`} />
                    <span>Actualizar</span>
                  </button>
                </div>

                {rooms.length === 0 ? (
                  <div className="p-4 rounded-md bg-[#0E1117] border border-[#232836] text-xs text-[#949BA8] text-center">
                    {wsConnected
                      ? 'No hay salas públicas abiertas ahora mismo. Crea una para que tus aliados puedan unirse.'
                      : 'Si estás usando solo el Hotspot del celular sin un servidor Node encendido, cambia a la pestaña Hotspot P2P (Sin Servidor).'}
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
                            <span className="font-mono-num text-xs font-bold text-amber-400">
                              #{room.code}
                            </span>
                            <span className="text-sm font-semibold text-[#E5E0D5] truncate">
                              Cripta de {room.hostName}
                            </span>
                          </div>
                          <div className="text-xs text-[#949BA8] font-mono-num mt-0.5">
                            Piso {room.floorNumber} · {room.playerCount}/{room.maxPlayers} jugadores
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={room.playerCount >= room.maxPlayers}
                          onClick={() => onJoinRoom(room.code)}
                          className="min-h-[44px] px-4 py-2 rounded-md bg-amber-600 hover:bg-amber-500 disabled:bg-[#232836] disabled:text-[#6B7280] text-[#0B0C10] font-semibold text-xs cursor-pointer transition-colors"
                        >
                          {room.playerCount >= room.maxPlayers ? 'Llena' : 'Unirse'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* HOTSPOT P2P (SERVERLESS WEBRTC LAN) */
            <div className="space-y-4">
              <div className="p-3 rounded-md bg-[#13202E] border border-sky-700/40 text-xs text-[#C2BDB2] leading-relaxed">
                Conecta directamente 2 a 4 celulares o PCs usando el{' '}
                <strong className="text-sky-300">Hotspot del celular (sin datos ni internet)</strong>{' '}
                y sin ejecutar ningún servidor externo.
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setP2pRole('host')}
                  className={`min-h-[44px] px-3 py-2 rounded-md border text-xs font-semibold cursor-pointer transition-colors ${
                    p2pRole === 'host'
                      ? 'bg-[#172636] border-sky-400 text-sky-300'
                      : 'bg-[#151922] border-[#262C3C] text-[#949BA8]'
                  }`}
                >
                  Crear Sala (Anfitrión)
                </button>
                <button
                  type="button"
                  onClick={() => setP2pRole('guest')}
                  className={`min-h-[44px] px-3 py-2 rounded-md border text-xs font-semibold cursor-pointer transition-colors ${
                    p2pRole === 'guest'
                      ? 'bg-[#172636] border-sky-400 text-sky-300'
                      : 'bg-[#151922] border-[#262C3C] text-[#949BA8]'
                  }`}
                >
                  Unirse a Anfitrión
                </button>
              </div>

              {p2pRole === 'host' ? (
                <div className="p-4 rounded-lg bg-[#161A23] border border-[#262C3C] space-y-4">
                  {!hostRoomCode ? (
                    <div className="space-y-3 text-center">
                      <p className="text-xs text-[#C2BDB2]">
                        Tu navegador actuará como servidor local de la sala para todos los dispositivos conectados a tu Hotspot o Wi-Fi.
                      </p>
                      <button
                        type="button"
                        disabled={p2pBusy}
                        onClick={handleStartP2PHost}
                        className="w-full min-h-[46px] py-2.5 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-[#0B0C10] font-semibold text-sm rounded-md cursor-pointer"
                      >
                        {p2pBusy ? 'Preparando red local...' : 'Crear Sala Hotspot'}
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#232836]">
                        <div>
                          <div className="text-xs text-[#949BA8]">Sala local activa</div>
                          <div className="font-mono-num text-sm font-bold text-sky-300">
                            #{hostRoomCode} · {hostPlayers.length}/4 jugadores
                          </div>
                        </div>
                        {hostPlayers.length < 4 && (
                          <button
                            type="button"
                            disabled={p2pBusy}
                            onClick={handleGenerateNextOffer}
                            className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded bg-[#1C2333] border border-[#333E57] hover:border-sky-400 text-xs text-[#E5E0D5] cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5 text-sky-400" />
                            <span>Nueva invitación</span>
                          </button>
                        )}
                      </div>

                      {/* Connected Players */}
                      <div className="flex flex-wrap gap-2">
                        {hostPlayers.map((p) => (
                          <div
                            key={p.id}
                            className="px-2.5 py-1 rounded bg-[#0E1117] border border-[#2C3344] text-xs flex items-center gap-1.5"
                          >
                            <span
                              className="w-2 h-2 rounded-full"
                              style={{ backgroundColor: p.color }}
                            />
                            <span className="text-[#E5E0D5] font-medium">{p.name}</span>
                            <span className="text-[10px] text-[#949BA8]">
                              {p.isHost ? '(Tú)' : '(Listo)'}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* Step 1: Share Offer Token / QR */}
                      {activeOfferToken && (
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center p-3 rounded-md bg-[#0E1117] border border-[#232836]">
                          <div className="sm:col-span-5 flex justify-center">
                            <QrCodeBox
                              value={activeOfferToken}
                              size={146}
                              label="1. Invitado escanea o copia"
                            />
                          </div>
                          <div className="sm:col-span-7 space-y-2">
                            <div className="text-xs font-semibold text-amber-300">
                              Paso 1: Pasa esta invitación al otro celular
                            </div>
                            <textarea
                              readOnly
                              rows={3}
                              value={activeOfferToken}
                              className="w-full p-2 rounded bg-[#141821] border border-[#2C3344] text-[10px] font-mono-num text-[#D4CFC4] resize-none"
                            />
                            <button
                              type="button"
                              onClick={() => copyText('p2p-offer', activeOfferToken)}
                              className="w-full min-h-[40px] px-3 py-1.5 rounded bg-[#1D2434] hover:bg-[#252E42] border border-[#384158] text-xs font-medium text-[#E5E0D5] inline-flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              {copiedKey === 'p2p-offer' ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                  <span>Invitación copiada</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" />
                                  <span>Copiar invitación (C1)</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Step 2: Paste Guest Answer */}
                      <form onSubmit={handleHostAcceptAnswer} className="space-y-2">
                        <label className="block text-xs font-semibold text-sky-300">
                          Paso 2: Pega el código de respuesta (C2) que generó tu aliado
                        </label>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="text"
                            value={answerDraft}
                            onChange={(e) => setAnswerDraft(e.target.value)}
                            placeholder="C2Z:..."
                            className="flex-1 min-w-0 min-h-[42px] px-3 py-2 rounded bg-[#0C0E13] border border-[#2C3344] focus:border-sky-400 focus:outline-none text-xs font-mono-num text-[#E5E0D5]"
                          />
                          <button
                            type="submit"
                            disabled={p2pBusy || !answerDraft.trim()}
                            className="min-h-[42px] px-4 py-2 rounded bg-[#1D2B3A] hover:bg-[#25374B] disabled:opacity-45 border border-sky-500/60 text-xs font-semibold text-sky-200 cursor-pointer"
                          >
                            Conectar Aliado
                          </button>
                        </div>
                      </form>

                      <button
                        type="button"
                        onClick={handleHostEnterDungeon}
                        className="w-full min-h-[48px] py-2.5 bg-amber-600 hover:bg-amber-500 text-[#0B0C10] font-semibold text-sm rounded-md cursor-pointer transition-colors"
                      >
                        Entrar a la Cripta ({hostPlayers.length}{' '}
                        {hostPlayers.length === 1 ? 'jugador' : 'jugadores'})
                      </button>
                    </>
                  )}
                </div>
              ) : (
                /* P2P Guest Panel */
                <div className="p-4 rounded-lg bg-[#161A23] border border-[#262C3C] space-y-4">
                  <form onSubmit={handleGuestCreateAnswer} className="space-y-2">
                    <label className="block text-xs font-semibold text-amber-300">
                      Paso 1: Pega la invitación (C1) del anfitrión
                    </label>
                    <textarea
                      rows={3}
                      value={guestOfferInput}
                      onChange={(e) => setGuestOfferInput(e.target.value)}
                      placeholder="Pega aquí el código C1Z:... o C1R:..."
                      className="w-full p-2.5 rounded bg-[#0C0E13] border border-[#2C3344] focus:border-sky-400 focus:outline-none text-xs font-mono-num text-[#E5E0D5] resize-none"
                    />
                    <button
                      type="submit"
                      disabled={p2pBusy || !guestOfferInput.trim()}
                      className="w-full min-h-[44px] py-2 bg-sky-500 hover:bg-sky-400 disabled:opacity-45 text-[#0B0C10] font-semibold text-xs sm:text-sm rounded-md cursor-pointer"
                    >
                      {p2pBusy ? 'Generando respuesta...' : 'Aceptar Invitación y Generar Respuesta'}
                    </button>
                  </form>

                  {guestAnswerToken && (
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center p-3 rounded-md bg-[#0E1117] border border-sky-700/50">
                      <div className="sm:col-span-5 flex justify-center">
                        <QrCodeBox
                          value={guestAnswerToken}
                          size={146}
                          label="2. Anfitrión escanea o copia"
                        />
                      </div>
                      <div className="sm:col-span-7 space-y-2">
                        <div className="text-xs font-semibold text-sky-300">
                          Paso 2: Envía esta respuesta (C2) al anfitrión (#{guestTargetCode})
                        </div>
                        <textarea
                          readOnly
                          rows={3}
                          value={guestAnswerToken}
                          className="w-full p-2 rounded bg-[#141821] border border-[#2C3344] text-[10px] font-mono-num text-[#D4CFC4] resize-none"
                        />
                        <button
                          type="button"
                          onClick={() => copyText('p2p-answer', guestAnswerToken)}
                          className="w-full min-h-[40px] px-3 py-1.5 rounded bg-[#1D2434] hover:bg-[#252E42] border border-[#384158] text-xs font-medium text-[#E5E0D5] inline-flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          {copiedKey === 'p2p-answer' ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Respuesta copiada</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copiar respuesta (C2)</span>
                            </>
                          )}
                        </button>
                        <div className="text-[11px] text-[#949BA8]">
                          {guestConnected
                            ? 'Conexión Hotspot establecida · Entrando a la sala...'
                            : 'En cuanto el anfitrión pegue tu respuesta, entrarás automáticamente a la partida.'}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
