import React, { useState } from 'react';
import {
  Activity,
  BookMarked,
  BookOpen,
  Check,
  Copy,
  Gamepad2,
  MessageSquare,
  Music,
  Pause,
  QrCode,
  RefreshCw,
  Send,
  Swords,
  Trophy,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { ACTIVE_SKILLS } from '../data/gameData';
import { coopClient, type CoopTelemetry } from '../net/coopClient';
import { APP_VERSION } from '../shared/protocol';
import { didPvpRankIncrease, getPvpTierInfo } from '../shared/pvp';
import type { CoopChatMessage } from '../types/coop';
import { HudSnapshot, SkillSlotKey } from '../types/game';
import { QrCodeBox } from './QrCodeBox';
import { RankDisplay, RankEmblemSvg } from './RankDisplay';

interface GameHudProps {
  hud: HudSnapshot;
  coopTelemetry: CoopTelemetry;
  muted: boolean;
  musicEnabled: boolean;
  showTouchControls: boolean;
  chatMessages: CoopChatMessage[];
  onSendChat: (text: string) => void;
  onToggleTouchControls: () => void;
  onToggleMusic: () => void;
  onToggleMute: () => void;
  onOpenCharacter: () => void;
  onOpenBestiary: () => void;
  onOpenAchievements: () => void;
  onPause: () => void;
  onTogglePvpReady?: () => void;
  onPvpRematch?: () => void;
  onReturnToTitle?: () => void;
}

const QUICK_CALLOUTS = ['¡Aquí!', '¡Jefe!', 'Necesito cura', '¡Listo!'];

export const GameHud: React.FC<GameHudProps> = ({
  hud,
  coopTelemetry,
  muted,
  musicEnabled,
  showTouchControls,
  chatMessages,
  onSendChat,
  onToggleTouchControls,
  onToggleMusic,
  onToggleMute,
  onOpenCharacter,
  onOpenBestiary,
  onOpenAchievements,
  onPause,
  onTogglePvpReady,
  onPvpRematch,
  onReturnToTitle,
}) => {
  const [copiedCode, setCopiedCode] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const [p2pInviteOpen, setP2pInviteOpen] = useState(false);
  const [p2pOfferSlot, setP2pOfferSlot] = useState('');
  const [p2pOfferToken, setP2pOfferToken] = useState('');
  const [p2pAnswerDraft, setP2pAnswerDraft] = useState('');
  const [p2pInviteError, setP2pInviteError] = useState<string | null>(null);
  const [p2pInviteBusy, setP2pInviteBusy] = useState(false);

  const isP2PHost = coopClient.getMode() === 'p2p-host';

  const handleCopyInvite = async () => {
    if (!hud.coop) return;
    if (isP2PHost) {
      const host = coopClient.getHostSession();
      if (!host) return;
      setP2pInviteOpen(true);
      setP2pInviteError(null);
      setP2pInviteBusy(true);
      try {
        const invite = await host.createInviteOffer();
        setP2pOfferSlot(invite.slotId);
        setP2pOfferToken(invite.offerToken);
        setP2pAnswerDraft('');
      } catch (err) {
        setP2pInviteError(err instanceof Error ? err.message : 'Error generando invitación');
      } finally {
        setP2pInviteBusy(false);
      }
      return;
    }

    const base = coopClient.getHttpBaseUrl();
    const serverParam = coopClient.getServerOverride()
      ? `&servidor=${encodeURIComponent(coopClient.getServerOverride())}`
      : '';
    const url = `${base}${window.location.pathname}?sala=${hud.coop.roomCode}${serverParam}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedCode(true);
    window.setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleAcceptMidRunAnswer = async (e: React.FormEvent) => {
    e.preventDefault();
    const host = coopClient.getHostSession();
    if (!host || !p2pOfferSlot || !p2pAnswerDraft.trim()) return;
    setP2pInviteError(null);
    setP2pInviteBusy(true);
    try {
      await host.acceptGuestAnswer(p2pOfferSlot, p2pAnswerDraft);
      setP2pInviteOpen(false);
      setP2pAnswerDraft('');
    } catch (err) {
      setP2pInviteError(err instanceof Error ? err.message : 'No se pudo conectar');
    } finally {
      setP2pInviteBusy(false);
    }
  };

  const handleSubmitChat = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = chatDraft.trim();
    if (!clean) return;
    onSendChat(clean);
    setChatDraft('');
  };
  const hpPct = Math.max(0, Math.min(100, (hud.hp / hud.maxHp) * 100));
  const manaPct = Math.max(0, Math.min(100, (hud.mana / hud.maxMana) * 100));
  const xpPct = Math.max(0, Math.min(100, (hud.xp / hud.xpToNext) * 100));
  const p2 = hud.localP2;
  const p2HpPct = p2 ? Math.max(0, Math.min(100, (p2.hp / p2.maxHp) * 100)) : 0;
  const p2ManaPct = p2 ? Math.max(0, Math.min(100, (p2.mana / p2.maxMana) * 100)) : 0;
  const p2XpPct = p2 ? Math.max(0, Math.min(100, (p2.xp / p2.xpToNext) * 100)) : 0;
  const totalSkillPoints = hud.skillPoints + (p2?.skillPoints ?? 0);
  const slots: SkillSlotKey[] = ['Q', 'E', 'R'];
  const pvp = hud.pvp ?? null;
  const pvpF1 = pvp?.fighters[0] ?? null;
  const pvpF2 = pvp?.fighters[1] ?? null;
  const localPvpFighter = pvp?.fighters.find((f) => f.id === pvp.localFighterId) ?? pvpF1;
  const ringShrinking = Boolean(pvp && pvp.ringRadius < pvp.ringMaxRadius * 0.96);

  const handleCopyPvpCode = () => {
    if (!pvp?.roomCode) return;
    navigator.clipboard?.writeText(pvp.roomCode).catch(() => {});
    setCopiedCode(true);
    window.setTimeout(() => setCopiedCode(false), 1800);
  };

  if (pvp) {
    const f1HpPct = pvpF1 ? Math.max(0, Math.min(100, (pvpF1.hp / Math.max(1, pvpF1.maxHp)) * 100)) : 0;
    const f2HpPct = pvpF2 ? Math.max(0, Math.min(100, (pvpF2.hp / Math.max(1, pvpF2.maxHp)) * 100)) : 0;
    const matchRes = pvp.matchResult ?? null;
    const bothOnlineConnected =
      pvp.mode === 'local' ||
      (pvp.fighters.length >= 2 && pvp.fighters.every((f) => f.connected !== false));

    return (
      <div
        className="fixed inset-0 z-20 pointer-events-none select-none flex flex-col justify-between p-2.5 sm:p-4 md:p-5"
        style={{
          paddingTop: 'max(0.625rem, env(safe-area-inset-top))',
          paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))',
        }}
      >
        {/* PVP TOP ARENA SCOREBOARD */}
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-12 items-start gap-2 sm:gap-3">
            {/* Fighter 1 Card */}
            <div className="col-span-5 sm:col-span-4 bg-[#0E1117]/92 border border-amber-500/45 rounded-md p-2 sm:p-3 space-y-1.5">
              {pvpF1 ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex items-center gap-2">
                      {pvp.mode === 'online' && pvpF1.elo !== undefined && (
                        <RankEmblemSvg tierId={getPvpTierInfo(pvpF1.elo).id} size={24} />
                      )}
                      <div className="min-w-0">
                        <div className="font-display text-xs sm:text-sm font-bold text-[#E5E0D5] truncate">
                          {pvpF1.name}
                        </div>
                        <div className="text-[10px] text-[#949BA8] truncate">
                          {pvpF1.classTitle}
                          {pvp.mode === 'online' && pvpF1.elo !== undefined ? ` · ${pvpF1.elo} ELO` : ''}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0" aria-label={`Rondas ganadas: ${pvpF1.roundsWon} de 2`}>
                      {[0, 1].map((pip) => (
                        <span
                          key={pip}
                          className={`w-2.5 h-2.5 rounded-sm border ${
                            pip < pvpF1.roundsWon
                              ? 'bg-amber-400 border-amber-300'
                              : 'bg-[#171B24] border-[#384158]'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    <div className="flex justify-between text-[10px] font-mono-num">
                      <span className="text-red-400 font-semibold">VIDA</span>
                      <span className="text-[#E5E0D5]">
                        {Math.ceil(pvpF1.hp)}/{pvpF1.maxHp}
                        {pvpF1.shield > 0 ? ` (+${Math.ceil(pvpF1.shield)})` : ''}
                      </span>
                    </div>
                    <div className="h-2 w-full bg-[#191E29] rounded-sm overflow-hidden">
                      <div
                        className="h-full bg-amber-500 transition-all duration-100"
                        style={{ width: `${f1HpPct}%` }}
                      />
                    </div>
                  </div>
                  {(pvp.mode === 'local' || pvp.localFighterId === pvpF1.id) && (
                    <div className="space-y-0.5">
                      <div className="h-1 w-full bg-[#191E29] rounded-sm overflow-hidden">
                        <div className="h-full bg-violet-500 transition-all duration-100" style={{ width: `${manaPct}%` }} />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-xs text-[#949BA8]">Preparando...</div>
              )}
            </div>

            {/* Center Round & Timer Card */}
            <div className="col-span-2 sm:col-span-4 flex flex-col items-center gap-1">
              <div className="w-full max-w-[230px] bg-[#0E1117]/95 border border-[#2C3344] rounded-md px-2.5 py-2 text-center space-y-0.5">
                <div className="text-[10px] sm:text-xs font-display font-bold text-[#E5E0D5]">
                  Ronda {pvp.roundNumber} / {pvp.bestOf}
                </div>
                <div className="font-mono-num text-base sm:text-xl font-bold text-amber-300 leading-tight">
                  {pvp.phase === 'waiting'
                    ? 'ESPERANDO'
                    : pvp.phase === 'match_end'
                    ? 'FINAL'
                    : `${Math.max(0, Math.ceil(pvp.phaseTimer))}s`}
                </div>
                <div className="hidden sm:flex items-center justify-center gap-2 text-[10px] font-mono-num text-[#949BA8]">
                  <span>{pvp.mode === 'online' && pvp.roomCode ? `Sala #${pvp.roomCode}` : 'Duelo Local'}</span>
                  {pvp.mode === 'online' && coopTelemetry.latencyMs !== null && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className={coopTelemetry.latencyMs < 70 ? 'text-emerald-400' : coopTelemetry.latencyMs <= 150 ? 'text-amber-300' : 'text-red-400'}>
                        {coopTelemetry.latencyMs} ms
                      </span>
                    </>
                  )}
                </div>
              </div>
              {ringShrinking && pvp.phase === 'fighting' && (
                <div className="px-2.5 py-0.5 bg-red-950/90 border border-red-500/70 rounded text-[10px] font-semibold text-red-200 whitespace-nowrap">
                  Tormenta del Eclipse cerrándose
                </div>
              )}
              {hud.bannerMessage && (
                <div className="hidden sm:block px-3 py-1 bg-[#0E1117]/92 border border-amber-700/50 rounded text-[11px] font-display font-semibold text-amber-300">
                  {hud.bannerMessage}
                </div>
              )}
            </div>

            {/* Fighter 2 + Utility Row */}
            <div className="col-span-5 sm:col-span-4 flex flex-col items-end gap-1.5">
              <div className="w-full bg-[#0E1117]/92 border border-red-500/45 rounded-md p-2 sm:p-3 space-y-1.5">
                {pvpF2 ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1 shrink-0" aria-label={`Rondas ganadas: ${pvpF2.roundsWon} de 2`}>
                        {[0, 1].map((pip) => (
                          <span
                            key={pip}
                            className={`w-2.5 h-2.5 rounded-sm border ${
                              pip < pvpF2.roundsWon
                                ? 'bg-red-400 border-red-300'
                                : 'bg-[#171B24] border-[#384158]'
                            }`}
                          />
                        ))}
                      </div>
                      <div className="min-w-0 flex items-center justify-end gap-2">
                        <div className="min-w-0 text-right">
                          <div className="font-display text-xs sm:text-sm font-bold text-[#E5E0D5] truncate">
                            {pvpF2.name}
                          </div>
                          <div className="text-[10px] text-[#949BA8] truncate">
                            {pvpF2.classTitle}
                            {pvp.mode === 'online' && pvpF2.elo !== undefined ? ` · ${pvpF2.elo} ELO` : ''}
                          </div>
                        </div>
                        {pvp.mode === 'online' && pvpF2.elo !== undefined && (
                          <RankEmblemSvg tierId={getPvpTierInfo(pvpF2.elo).id} size={24} />
                        )}
                      </div>
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex justify-between text-[10px] font-mono-num">
                        <span className="text-[#E5E0D5]">
                          {Math.ceil(pvpF2.hp)}/{pvpF2.maxHp}
                          {pvpF2.shield > 0 ? ` (+${Math.ceil(pvpF2.shield)})` : ''}
                        </span>
                        <span className="text-red-400 font-semibold">VIDA</span>
                      </div>
                      <div className="h-2 w-full bg-[#191E29] rounded-sm overflow-hidden">
                        <div
                          className="h-full bg-red-500 transition-all duration-100 ml-auto"
                          style={{ width: `${f2HpPct}%` }}
                        />
                      </div>
                    </div>
                    {(pvp.mode === 'local' && p2) ? (
                      <div className="h-1 w-full bg-[#191E29] rounded-sm overflow-hidden">
                        <div className="h-full bg-sky-500 transition-all duration-100 ml-auto" style={{ width: `${p2ManaPct}%` }} />
                      </div>
                    ) : pvp.localFighterId === pvpF2.id ? (
                      <div className="h-1 w-full bg-[#191E29] rounded-sm overflow-hidden">
                        <div className="h-full bg-violet-500 transition-all duration-100 ml-auto" style={{ width: `${manaPct}%` }} />
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="py-1 text-right text-xs text-[#949BA8]">
                    Esperando retador en la Arena...
                  </div>
                )}
              </div>

              {/* Compact Utility Controls (Admin F9 hidden in PvP) */}
              <div className="pointer-events-auto flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onToggleTouchControls}
                  title={showTouchControls ? 'Ocultar controles táctiles' : 'Mostrar controles táctiles'}
                  aria-label="Alternar controles táctiles"
                  className={`min-w-[40px] min-h-[40px] sm:min-w-[34px] sm:min-h-[34px] flex items-center justify-center border rounded-md cursor-pointer ${
                    showTouchControls
                      ? 'bg-[#1D2434] text-amber-400 border-amber-500/60'
                      : 'bg-[#0E1117]/95 text-[#949BA8] border-[#2A3142] hover:border-[#475066]'
                  }`}
                >
                  <Gamepad2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={onToggleMusic}
                  title={musicEnabled ? 'Desactivar música' : 'Activar música'}
                  aria-label={musicEnabled ? 'Desactivar música' : 'Activar música'}
                  className={`min-w-[40px] min-h-[40px] sm:min-w-[34px] sm:min-h-[34px] flex items-center justify-center border rounded-md cursor-pointer ${
                    musicEnabled && !muted
                      ? 'bg-[#1D2434] text-amber-300 border-amber-500/50'
                      : 'bg-[#0E1117]/95 text-[#949BA8] border-[#2A3142] hover:border-[#475066]'
                  }`}
                >
                  <Music className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={onToggleMute}
                  aria-label={muted ? 'Activar audio' : 'Silenciar audio'}
                  className="min-w-[40px] min-h-[40px] sm:min-w-[34px] sm:min-h-[34px] flex items-center justify-center bg-[#0E1117]/95 text-[#D4CFC4] border border-[#2A3142] hover:border-[#475066] rounded-md cursor-pointer"
                >
                  {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={onPause}
                  aria-label="Menú de Arena"
                  className="min-w-[40px] min-h-[40px] sm:min-w-[34px] sm:min-h-[34px] flex items-center justify-center bg-[#0E1117]/95 text-[#D4CFC4] border border-[#2A3142] hover:border-[#475066] rounded-md cursor-pointer"
                >
                  <Pause className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* CENTER PVP PHASE OVERLAYS */}
        <div className="my-auto flex flex-col items-center justify-center px-3">
          {pvp.phase === 'waiting' && (
            <div className="pointer-events-auto w-full max-w-md bg-[#12151C]/95 border border-[#2C3344] rounded-lg p-5 space-y-4 shadow-2xl text-center">
              <div className="space-y-1">
                <div className="flex items-center justify-center gap-2 text-red-400">
                  <Swords className="w-5 h-5" />
                  <h3 className="font-display text-lg font-bold text-[#E5E0D5]">
                    Sala de Duelo {pvp.roomCode ? `#${pvp.roomCode}` : ''}
                  </h3>
                </div>
                <p className="text-xs text-[#949BA8]">
                  Comparte el código con tu oponente y pulsa Listo para iniciar la cuenta atrás.
                </p>
              </div>

              {pvp.roomCode && (
                <div className="flex items-center justify-center gap-2">
                  <span className="font-mono-num text-base font-bold tracking-widest text-amber-300 px-3 py-1.5 rounded bg-[#0C0E13] border border-[#2C3344]">
                    {pvp.roomCode}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyPvpCode}
                    className="min-h-[40px] px-3 py-1.5 rounded bg-[#1A202D] border border-[#323B52] hover:border-amber-400 text-xs text-[#E5E0D5] inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedCode ? 'Copiado' : 'Copiar código'}</span>
                  </button>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 text-xs text-left">
                {[0, 1].map((idx) => {
                  const fighter = pvp.fighters[idx];
                  return (
                    <div
                      key={idx}
                      className="p-2.5 rounded bg-[#161A23] border border-[#262C3C] space-y-0.5"
                    >
                      <div className="font-semibold text-[#E5E0D5] truncate">
                        {fighter ? fighter.name : `Retador ${idx + 1}`}
                      </div>
                      <div className="text-[11px] text-[#949BA8] truncate">
                        {fighter ? fighter.classTitle : 'Esperando conexión...'}
                      </div>
                      <div
                        className={`text-[11px] font-semibold ${
                          fighter?.ready ? 'text-emerald-400' : 'text-amber-300'
                        }`}
                      >
                        {fighter ? (fighter.ready ? 'Listo' : 'No listo') : 'Vacío'}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={onTogglePvpReady}
                  className={`flex-1 min-h-[46px] px-4 py-2.5 rounded-md font-semibold text-sm transition-colors cursor-pointer whitespace-nowrap ${
                    localPvpFighter?.ready
                      ? 'bg-[#212736] hover:bg-[#2B3348] text-amber-300 border border-amber-500/60'
                      : 'bg-red-600 hover:bg-red-500 text-white'
                  }`}
                >
                  {localPvpFighter?.ready ? 'Cancelar Listo' : 'Listo para el Duelo'}
                </button>
                <button
                  type="button"
                  onClick={onReturnToTitle}
                  className="min-h-[46px] px-4 py-2.5 rounded-md bg-[#161A23] hover:bg-[#1E2431] border border-[#2C3344] text-xs font-medium text-[#C2BDB2] cursor-pointer whitespace-nowrap"
                >
                  Salir de la Arena
                </button>
              </div>
            </div>
          )}

          {pvp.phase === 'countdown' && (
            <div className="px-6 py-4 rounded-lg bg-[#0E1117]/88 border border-amber-500/60 text-center">
              <div className="text-xs font-semibold text-amber-300 uppercase tracking-wider">
                Ronda {pvp.roundNumber} · ¡Prepárate!
              </div>
              <div className="font-mono-num text-5xl font-bold text-[#E5E0D5] mt-1">
                {Math.max(1, Math.ceil(pvp.phaseTimer))}
              </div>
            </div>
          )}

          {pvp.phase === 'round_end' && (
            <div className="px-6 py-4 rounded-lg bg-[#0E1117]/92 border border-amber-500/70 text-center space-y-1">
              <div className="font-display text-lg sm:text-xl font-bold text-amber-300">
                Ronda {pvp.roundNumber} Completada
              </div>
              {pvp.winnerName && (
                <div className="text-xs text-[#E5E0D5]">
                  Punto para {pvp.winnerName}
                </div>
              )}
            </div>
          )}

          {pvp.phase === 'match_end' && matchRes && (
            <div className="pointer-events-auto w-full max-w-md bg-[#12151C]/96 border border-[#2C3344] rounded-lg p-5 sm:p-6 space-y-4 shadow-2xl">
              <div className="text-center space-y-1">
                <div
                  className={`font-display text-2xl font-bold ${
                    matchRes.won ? 'text-amber-400' : 'text-red-400'
                  }`}
                >
                  {pvp.mode === 'local'
                    ? `Victoria de ${matchRes.winnerName}`
                    : matchRes.won
                    ? 'Victoria en la Arena'
                    : 'Derrota en la Arena'}
                </div>
                <p className="text-xs text-[#949BA8]">
                  {matchRes.winnerName} venció a {matchRes.loserName} · Marcador{' '}
                  <span className="font-mono-num text-[#E5E0D5] font-semibold">
                    {matchRes.p1Rounds} - {matchRes.p2Rounds}
                  </span>
                </p>
              </div>

              {matchRes.mode === 'online' ? (
                <div className="space-y-2.5">
                  <RankDisplay
                    elo={matchRes.eloAfter}
                    previousElo={matchRes.eloBefore}
                    rankUp={matchRes.won && didPvpRankIncrease(matchRes.eloBefore, matchRes.eloAfter)}
                    variant="celebration"
                  />
                  <div className="p-3 rounded bg-[#181C26] border border-[#232836] flex items-center justify-between gap-2 text-xs">
                    <div>
                      <div className="text-[#949BA8]">Recompensa de Arena</div>
                      <div className="font-mono-num font-bold text-violet-300 mt-0.5">
                        +{matchRes.soulsReward} Fragmentos de Alma
                      </div>
                    </div>
                    {matchRes.unlockedTitle && (
                      <div className="text-right">
                        <div className="text-[10px] text-[#949BA8]">Título</div>
                        <div className="text-[11px] font-semibold text-amber-300">
                          {matchRes.unlockedTitle}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  <div className="p-3 rounded bg-[#181C26] border border-[#232836]">
                    <div className="text-[#949BA8]">Formato</div>
                    <div className="font-display font-semibold text-[#E5E0D5] mt-0.5">
                      Duelo Local Bo3
                    </div>
                    <div className="text-[11px] text-[#949BA8] mt-0.5">Sin cambios de ELO</div>
                  </div>
                  <div className="p-3 rounded bg-[#181C26] border border-[#232836]">
                    <div className="text-[#949BA8]">Recompensa</div>
                    <div className="font-mono-num font-bold text-violet-300 mt-0.5">
                      +{matchRes.soulsReward} Almas
                    </div>
                    {matchRes.unlockedTitle && (
                      <div className="text-[11px] text-amber-300 mt-0.5 truncate">
                        Título: {matchRes.unlockedTitle}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2 pt-1">
                {bothOnlineConnected && onPvpRematch && (
                  <button
                    type="button"
                    onClick={onPvpRematch}
                    className="w-full min-h-[46px] py-2.5 bg-red-600 hover:bg-red-500 text-white font-semibold text-sm rounded-md transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Revancha
                  </button>
                )}
                <button
                  type="button"
                  onClick={onReturnToTitle}
                  className="w-full min-h-[44px] py-2.5 bg-[#181C26] hover:bg-[#222836] text-[#E5E0D5] border border-[#2C3344] text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap"
                >
                  Volver al Santuario
                </button>
              </div>
            </div>
          )}
        </div>

        {/* PVP BOTTOM ABILITY DOCK (Desktop when touch controls hidden) */}
        {!showTouchControls ? (
          <div className="flex flex-col items-center gap-1.5">
            <div className="bg-[#0E1117]/92 border border-[#2A3142] rounded-md px-3 py-2 flex items-center gap-2">
              <div className="w-12 h-12 rounded bg-[#161B26] border border-[#2C3344] flex flex-col items-center justify-center">
                <span className="text-[10px] font-mono-num text-[#949BA8]">Clic</span>
                <span className="text-[11px] font-medium text-[#E5E0D5]">Atacar</span>
              </div>

              <div className="relative w-12 h-12 rounded bg-[#161B26] border border-[#2C3344] flex flex-col items-center justify-center overflow-hidden">
                {hud.dashCooldownRemaining > 0 && (
                  <div
                    className="absolute inset-x-0 bottom-0 bg-black/70"
                    style={{
                      height: `${Math.min(100, (hud.dashCooldownRemaining / hud.dashCooldownMax) * 100)}%`,
                    }}
                  />
                )}
                <span className="relative text-[10px] font-mono-num text-[#949BA8]">Espacio</span>
                <span className="relative text-[11px] font-medium text-[#E5E0D5]">
                  {hud.dashCooldownRemaining > 0 ? hud.dashCooldownRemaining.toFixed(1) : 'Esquiva'}
                </span>
              </div>

              <div className="w-px h-8 bg-[#262D3D]" />

              {slots.map((slotKey) => {
                const skillId = hud.equippedSlots[slotKey];
                const skill = skillId ? ACTIVE_SKILLS[skillId] : null;
                const cd = hud.skillCooldowns[slotKey];
                const maxCd = hud.skillMaxCooldowns[slotKey] || 1;
                const noMana = skill ? hud.mana < skill.manaCost : false;

                return (
                  <div
                    key={slotKey}
                    className={`relative w-14 h-12 rounded border flex flex-col items-center justify-center px-1 overflow-hidden ${
                      skill
                        ? noMana
                          ? 'bg-[#141720] border-[#2C3344] opacity-65'
                          : 'bg-[#191E2A] border-[#384158]'
                        : 'bg-[#10131A] border-[#202634]'
                    }`}
                  >
                    {cd > 0 && (
                      <div
                        className="absolute inset-x-0 bottom-0 bg-black/75"
                        style={{ height: `${Math.min(100, (cd / maxCd) * 100)}%` }}
                      />
                    )}
                    <div className="relative flex items-center justify-between w-full px-0.5">
                      <span className="text-[10px] font-mono-num font-bold text-amber-400">
                        {slotKey}
                      </span>
                      {skill && (
                        <span className="text-[9px] font-mono-num text-violet-300">
                          {skill.manaCost}
                        </span>
                      )}
                    </div>
                    <span className="relative text-[10px] font-medium text-[#E5E0D5] truncate w-full text-center">
                      {cd > 0 ? `${cd.toFixed(1)}s` : skill ? skill.name.split(' ')[0] : 'Vacío'}
                    </span>
                  </div>
                );
              })}

              <div className="w-px h-8 bg-[#262D3D]" />

              <div className="w-13 h-12 rounded bg-[#1B1418] border border-red-900/60 flex flex-col items-center justify-center">
                <span className="text-[10px] font-mono-num text-red-300">1 · Frasco</span>
                <span className="text-xs font-mono-num font-bold text-[#E5E0D5]">
                  {hud.flaskCharges}/{hud.maxFlaskCharges}
                </span>
              </div>
            </div>

            {pvp.mode === 'local' && (
              <div className="hidden md:block px-3 py-1 rounded bg-[#0E1117]/85 border border-sky-900/50 text-[10px] font-mono-num text-sky-300">
                J1: WASD + G/Espacio + Q/E/R + 1 · J2: Flechas + M/Intro + Shift Der. + U/I/O + P
              </div>
            )}
          </div>
        ) : (
          <div />
        )}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-20 pointer-events-none select-none flex flex-col justify-between p-2.5 sm:p-4 md:p-5"
      style={{
        paddingTop: 'max(0.625rem, env(safe-area-inset-top))',
        paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))',
      }}
    >
      {/* TOP ROW */}
      <div className="flex items-start justify-between gap-2 sm:gap-4">
        {/* Top-Left Vitals Cluster */}
        <div className="flex flex-col gap-1.5">
          <div className="w-44 sm:w-64 bg-[#0E1117]/90 border border-[#2A3142] rounded-md p-2 sm:p-3 space-y-1.5 sm:space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-display text-[11px] sm:text-xs font-bold text-[#E5E0D5] truncate">
                {p2 ? `J1 · ${hud.classTitle}` : hud.classTitle}
              </span>
              <span className="font-mono-num text-[11px] sm:text-xs text-amber-400 shrink-0">
                Nv. {hud.level}
              </span>
            </div>

            {/* HP Bar */}
            <div className="space-y-0.5 sm:space-y-1">
              <div className="flex justify-between text-[10px] sm:text-[11px] font-mono-num">
                <span className="text-red-400 font-semibold">VIDA</span>
                <span className="text-[#E5E0D5]">
                  {hud.hp}/{hud.maxHp}
                  {hud.shield > 0 ? ` (+${hud.shield})` : ''}
                </span>
              </div>
              <div className="h-1.5 sm:h-2 w-full bg-[#191E29] rounded-sm overflow-hidden">
                <div
                  className="h-full bg-red-600 transition-all duration-100"
                  style={{ width: `${hpPct}%` }}
                />
              </div>
            </div>

            {/* Mana Bar */}
            <div className="space-y-0.5 sm:space-y-1">
              <div className="flex justify-between text-[10px] sm:text-[11px] font-mono-num">
                <span className="text-violet-400 font-semibold">MANÁ</span>
                <span className="text-[#D4CFC4]">
                  {hud.mana}/{hud.maxMana}
                </span>
              </div>
              <div className="h-1.5 w-full bg-[#191E29] rounded-sm overflow-hidden">
                <div
                  className="h-full bg-violet-500 transition-all duration-100"
                  style={{ width: `${manaPct}%` }}
                />
              </div>
            </div>

            {/* XP Thin Track + Currency */}
            <div className="pt-0.5 sm:pt-1 space-y-1">
              <div className="h-1 w-full bg-[#191E29] rounded-sm overflow-hidden">
                <div className="h-full bg-amber-500" style={{ width: `${xpPct}%` }} />
              </div>
              <div className="flex items-center justify-between text-[10px] sm:text-[11px] font-mono-num text-[#949BA8]">
                <span>Oro {hud.gold}</span>
                <span>+{hud.soulsThisRun} Alma</span>
                <span className="hidden sm:inline">Bajas {hud.kills}</span>
              </div>
            </div>

            {/* Online Co-op Party Panel */}
            {hud.coop && (
              <div className="pointer-events-auto pt-1.5 border-t border-[#232836] space-y-1.5">
                <div className="flex items-center justify-between gap-1.5">
                  <span className="font-mono-num text-[10px] sm:text-[11px] font-bold text-violet-300">
                    SALA #{hud.coop.roomCode}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyInvite}
                    className="inline-flex items-center gap-1 px-2 py-1 min-h-[28px] rounded bg-[#181D29] border border-[#2C3344] hover:border-violet-400 text-[10px] text-[#D4CFC4] cursor-pointer"
                  >
                    {isP2PHost ? (
                      <>
                        <QrCode className="w-3 h-3 text-sky-400" />
                        <span>Invitar P2P</span>
                      </>
                    ) : copiedCode ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span>Copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Invitar</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Unboxed tabular ping & version telemetry line */}
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[10px] font-mono-num">
                  <span
                    className={`inline-flex items-center gap-1 ${
                      isP2PHost
                        ? 'text-sky-300'
                        : coopTelemetry.latencyMs === null
                        ? 'text-[#949BA8]'
                        : coopTelemetry.latencyMs < 70
                        ? 'text-emerald-400'
                        : coopTelemetry.latencyMs <= 150
                        ? 'text-amber-300'
                        : 'text-red-400'
                    }`}
                  >
                    <Activity className="w-3 h-3 shrink-0" />
                    <span>
                      {isP2PHost
                        ? '0 ms · Local'
                        : coopTelemetry.latencyMs === null
                        ? 'Mid. ping'
                        : coopTelemetry.latencyMs < 70
                        ? `${coopTelemetry.latencyMs} ms · Óptima`
                        : coopTelemetry.latencyMs <= 150
                        ? `${coopTelemetry.latencyMs} ms · Estable`
                        : `${coopTelemetry.latencyMs} ms · Alta`}
                    </span>
                  </span>
                  <span
                    className={
                      coopTelemetry.versionCheck?.status === 'minor_mismatch'
                        ? 'text-amber-300'
                        : 'text-[#949BA8]'
                    }
                    title={coopTelemetry.versionCheck?.message ?? `Cliente v${APP_VERSION}`}
                  >
                    v{APP_VERSION}
                    {coopTelemetry.serverVersion && coopTelemetry.serverVersion !== APP_VERSION
                      ? ` / ${coopTelemetry.serverVersion}`
                      : ''}
                  </span>
                </div>

                {hud.coop.allies.length === 0 ? (
                  <div className="text-[10px] text-[#949BA8]">Esperando aliados...</div>
                ) : (
                  <div className="space-y-1">
                    {hud.coop.allies.map((ally) => {
                      const allyPct = Math.max(0, Math.min(100, (ally.hp / Math.max(1, ally.maxHp)) * 100));
                      const disconnected = ally.connected === false;
                      return (
                        <div key={ally.id} className={`space-y-0.5 ${disconnected ? 'opacity-65' : ''}`}>
                          <div className="flex items-center justify-between gap-1 text-[10px]">
                            <span className="flex items-center gap-1 truncate text-[#E5E0D5]">
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: ally.color }}
                              />
                              <span className="truncate">{ally.name}</span>
                            </span>
                            <span
                              className={`font-mono-num text-[9px] shrink-0 ${
                                disconnected ? 'text-amber-300' : 'text-[#949BA8]'
                              }`}
                            >
                              {disconnected
                                ? 'Reconectando…'
                                : ally.alive
                                ? `${ally.hp}/${ally.maxHp}`
                                : 'CAÍDO'}
                            </span>
                          </div>
                          <div className="h-1 w-full bg-[#191E29] rounded-sm overflow-hidden">
                            <div
                              className="h-full transition-all duration-150"
                              style={{
                                width: `${ally.alive ? allyPct : 100}%`,
                                backgroundColor: disconnected
                                  ? '#D97706'
                                  : ally.alive
                                  ? ally.color
                                  : '#991B1B',
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Local Co-op Player 2 Vitals Card */}
          {p2 && (
            <div className="w-44 sm:w-64 bg-[#0E1117]/90 border border-sky-500/45 rounded-md p-2 sm:p-2.5 space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-display text-[11px] sm:text-xs font-bold text-sky-300 truncate">
                  J2 · {p2.classTitle}
                </span>
                <span className="font-mono-num text-[10px] sm:text-[11px] text-sky-400 shrink-0">
                  {p2.isDowned ? 'CAÍDO' : `Nv. ${p2.level}`}
                </span>
              </div>

              <div className="space-y-0.5">
                <div className="flex justify-between text-[10px] font-mono-num">
                  <span className="text-red-400 font-semibold">VIDA</span>
                  <span className="text-[#E5E0D5]">
                    {p2.hp}/{p2.maxHp}
                    {p2.shield > 0 ? ` (+${p2.shield})` : ''}
                  </span>
                </div>
                <div className="h-1.5 w-full bg-[#191E29] rounded-sm overflow-hidden">
                  <div
                    className="h-full bg-red-600 transition-all duration-100"
                    style={{ width: `${p2HpPct}%` }}
                  />
                </div>
              </div>

              <div className="space-y-0.5">
                <div className="flex justify-between text-[10px] font-mono-num">
                  <span className="text-sky-400 font-semibold">MANÁ</span>
                  <span className="text-[#D4CFC4]">
                    {p2.mana}/{p2.maxMana}
                  </span>
                </div>
                <div className="h-1 w-full bg-[#191E29] rounded-sm overflow-hidden">
                  <div
                    className="h-full bg-sky-500 transition-all duration-100"
                    style={{ width: `${p2ManaPct}%` }}
                  />
                </div>
              </div>

              <div className="pt-0.5 space-y-1">
                <div className="h-1 w-full bg-[#191E29] rounded-sm overflow-hidden">
                  <div className="h-full bg-sky-400" style={{ width: `${p2XpPct}%` }} />
                </div>
                <div className="flex items-center justify-between text-[10px] font-mono-num text-[#949BA8]">
                  <span>Frascos {p2.flaskCharges}/{p2.maxFlaskCharges}</span>
                  <span>
                    {p2.skillPoints > 0 ? `+${p2.skillPoints} pt` : 'Local'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Top-Center Boss Health Bar, Reconnect Banner & Floor Banner */}
        <div className="hidden sm:flex flex-1 max-w-md flex-col items-center gap-2 pt-1">
          {hud.coop &&
            (coopTelemetry.connectionState === 'reconnecting' ||
              coopTelemetry.connectionState === 'connecting') && (
              <div className="px-3.5 py-1.5 bg-[#1B1610]/95 border border-amber-500/70 rounded text-xs font-mono-num text-amber-200 inline-flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
                <span>
                  Reconectando con sala #{hud.coop.roomCode} · intento{' '}
                  {coopTelemetry.reconnectAttempt + 1} · sesión protegida
                </span>
              </div>
            )}

          {hud.boss && (
            <div
              className={`w-full bg-[#0E1117]/95 rounded-md px-4 py-2.5 border ${
                hud.boss.enraged ? 'border-red-500/90' : 'border-red-900/70'
              }`}
            >
              <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
                <div className="min-w-0 flex items-center gap-2">
                  <span className="font-display font-bold text-[#E5E0D5] truncate">
                    {hud.boss.name}
                  </span>
                  {hud.boss.enraged && (
                    <span className="font-mono-num text-[10px] font-bold text-red-400 shrink-0">
                      FURIA
                    </span>
                  )}
                </div>
                <span className="font-mono-num text-red-400 shrink-0">
                  {hud.boss.hp}/{hud.boss.maxHp}
                  {hud.boss.difficultyLabel ? ` · ${hud.boss.difficultyLabel}` : ''}
                </span>
              </div>
              <div className="h-2.5 w-full bg-[#1A1216] rounded-sm overflow-hidden">
                <div
                  className={`h-full transition-all duration-100 ${
                    hud.boss.enraged
                      ? 'bg-gradient-to-r from-red-600 via-rose-500 to-amber-500'
                      : 'bg-gradient-to-r from-red-700 to-amber-600'
                  }`}
                  style={{ width: `${(hud.boss.hp / hud.boss.maxHp) * 100}%` }}
                />
              </div>
            </div>
          )}

          {hud.bannerMessage && (
            <div className="px-4 py-1.5 bg-[#0E1117]/92 border border-amber-700/50 rounded text-xs font-display font-semibold text-amber-300 tracking-wide">
              {hud.bannerMessage}
            </div>
          )}
        </div>

        {/* Top-Right Minimap & Action Controls */}
        <div className="flex flex-col items-end gap-1.5 sm:gap-2">
          <div className="bg-[#0E1117]/90 border border-[#2A3142] rounded-md p-1.5 sm:p-2 flex flex-col items-end gap-1 sm:gap-1.5">
            <div className="w-full flex items-center justify-between gap-2 text-[10px] sm:text-[11px]">
              <span className="font-display font-semibold text-[#E5E0D5]">
                Piso {hud.floorNumber}
              </span>
              <span className="hidden sm:inline text-[#949BA8] truncate max-w-[115px]">
                {hud.floorName}
              </span>
            </div>
            <svg
              viewBox={`0 0 ${hud.minimap.width} ${hud.minimap.height}`}
              className="w-16 h-16 sm:w-28 sm:h-28 md:w-32 md:h-32 bg-[#090A0E] border border-[#232836] rounded-sm"
            >
              {hud.minimap.rooms.map((r, idx) => {
                if (!r.discovered) return null;
                const fill =
                  r.type === 'boss'
                    ? '#7F1D1D'
                    : r.type === 'treasure'
                    ? '#78350F'
                    : r.type === 'shrine'
                    ? '#4C1D95'
                    : r.cleared
                    ? '#262D3D'
                    : '#3B445C';
                return (
                  <rect
                    key={idx}
                    x={r.x}
                    y={r.y}
                    width={r.w}
                    height={r.h}
                    fill={fill}
                    stroke="#475066"
                    strokeWidth="0.4"
                  />
                );
              })}
              {hud.minimap.props.map((pr, idx) => {
                const roomDiscovered = hud.minimap.rooms.some(
                  (r) =>
                    r.discovered &&
                    pr.tx >= r.x &&
                    pr.tx <= r.x + r.w &&
                    pr.ty >= r.y &&
                    pr.ty <= r.y + r.h
                );
                if (!roomDiscovered || (pr.done && pr.kind !== 'portal')) return null;
                const col =
                  pr.kind === 'portal'
                    ? '#A78BFA'
                    : pr.kind === 'chest'
                    ? '#F59E0B'
                    : '#38BDF8';
                return <circle key={idx} cx={pr.tx + 0.5} cy={pr.ty + 0.5} r="1.4" fill={col} />;
              })}
              {hud.coop?.allies.map((ally) => (
                <circle
                  key={ally.id}
                  cx={Math.floor(ally.x / 44) + 0.5}
                  cy={Math.floor(ally.y / 44) + 0.5}
                  r="1.7"
                  fill={ally.alive ? ally.color : '#EF4444'}
                />
              ))}
              {p2 && (
                <circle
                  cx={p2.tileX + 0.5}
                  cy={p2.tileY + 0.5}
                  r="1.8"
                  fill={p2.isDowned ? '#EF4444' : '#38BDF8'}
                />
              )}
              <circle
                cx={hud.minimap.playerTileX + 0.5}
                cy={hud.minimap.playerTileY + 0.5}
                r="1.8"
                fill={p2 ? '#F59E0B' : '#FFFFFF'}
              />
            </svg>
            <div className="w-full flex items-center justify-between gap-1.5 text-[9px] font-mono-num text-[#949BA8]">
              <span className="truncate max-w-[92px] sm:max-w-[112px]">
                Sem. {hud.runSeedLabel}
              </span>
              <span className="hidden sm:inline shrink-0">v{APP_VERSION}</span>
            </div>
          </div>

          {/* Clickable perimeter controls */}
          <div className="pointer-events-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={onOpenCharacter}
              className={`inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-[34px] px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                totalSkillPoints > 0
                  ? 'bg-amber-600 text-[#0B0C10] border-amber-500 font-semibold'
                  : 'bg-[#0E1117]/95 text-[#E5E0D5] border-[#2A3142] hover:border-[#475066]'
              }`}
            >
              <BookOpen className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
              <span className="hidden sm:inline">Árbol (K)</span>
              <span className="sm:hidden">Árbol</span>
              {totalSkillPoints > 0 && (
                <span className="font-mono-num">
                  {p2 && p2.skillPoints > 0
                    ? `J1:+${hud.skillPoints} J2:+${p2.skillPoints}`
                    : `+${totalSkillPoints}`}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={onOpenBestiary}
              title="Bestiario visual"
              aria-label="Abrir bestiario visual"
              className="min-w-[44px] min-h-[44px] sm:min-w-[34px] sm:min-h-[34px] flex items-center justify-center bg-[#0E1117]/95 text-red-300 border border-[#2A3142] hover:border-red-500/60 rounded-md cursor-pointer"
            >
              <BookMarked className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onOpenAchievements}
              title="Logros y Hazañas"
              aria-label="Abrir logros"
              className="min-w-[44px] min-h-[44px] sm:min-w-[34px] sm:min-h-[34px] flex items-center justify-center bg-[#0E1117]/95 text-amber-300 border border-[#2A3142] hover:border-amber-500/60 rounded-md cursor-pointer"
            >
              <Trophy className="w-4 h-4" />
            </button>
            {hud.coop && (
              <button
                type="button"
                onClick={() => setChatOpen((v) => !v)}
                aria-label="Abrir chat del grupo"
                className={`min-w-[44px] min-h-[44px] sm:min-w-[34px] sm:min-h-[34px] flex items-center justify-center border rounded-md cursor-pointer ${
                  chatOpen
                    ? 'bg-[#1D2434] text-violet-300 border-violet-500/70'
                    : 'bg-[#0E1117]/95 text-[#D4CFC4] border-[#2A3142] hover:border-[#475066]'
                }`}
              >
                <MessageSquare className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onToggleTouchControls}
              title={showTouchControls ? 'Ocultar controles táctiles' : 'Mostrar controles táctiles'}
              aria-label="Alternar controles táctiles"
              className={`min-w-[44px] min-h-[44px] sm:min-w-[34px] sm:min-h-[34px] flex items-center justify-center border rounded-md cursor-pointer ${
                showTouchControls
                  ? 'bg-[#1D2434] text-amber-400 border-amber-500/60'
                  : 'bg-[#0E1117]/95 text-[#949BA8] border-[#2A3142] hover:border-[#475066]'
              }`}
            >
              <Gamepad2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onToggleMusic}
              title={musicEnabled ? 'Desactivar música' : 'Activar música'}
              aria-label={musicEnabled ? 'Desactivar música' : 'Activar música'}
              className={`min-w-[44px] min-h-[44px] sm:min-w-[34px] sm:min-h-[34px] flex items-center justify-center border rounded-md cursor-pointer ${
                musicEnabled && !muted
                  ? 'bg-[#1D2434] text-amber-300 border-amber-500/50'
                  : 'bg-[#0E1117]/95 text-[#949BA8] border-[#2A3142] hover:border-[#475066]'
              }`}
            >
              <Music className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onToggleMute}
              aria-label={muted ? 'Activar audio' : 'Silenciar audio'}
              className="min-w-[44px] min-h-[44px] sm:min-w-[34px] sm:min-h-[34px] flex items-center justify-center bg-[#0E1117]/95 text-[#D4CFC4] border border-[#2A3142] hover:border-[#475066] rounded-md cursor-pointer"
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={onPause}
              aria-label="Pausar partida"
              className="min-w-[44px] min-h-[44px] sm:min-w-[34px] sm:min-h-[34px] flex items-center justify-center bg-[#0E1117]/95 text-[#D4CFC4] border border-[#2A3142] hover:border-[#475066] rounded-md cursor-pointer"
            >
              <Pause className="w-4 h-4" />
            </button>
          </div>

          {/* Collapsible Co-op Chat & Callouts Drawer */}
          {hud.coop && chatOpen && (
            <div className="pointer-events-auto w-64 sm:w-72 bg-[#0E1117]/95 border border-[#2C3344] rounded-md p-2.5 space-y-2 shadow-xl">
              <div className="max-h-28 overflow-y-auto crypt-scroll space-y-1 text-[11px]">
                {chatMessages.length === 0 ? (
                  <p className="text-[#949BA8]">Sin mensajes todavía.</p>
                ) : (
                  chatMessages.slice(-12).map((m) => (
                    <div key={m.id} className="leading-snug break-words">
                      <span className="font-semibold" style={{ color: m.senderColor }}>
                        {m.senderName}:{' '}
                      </span>
                      <span className="text-[#E5E0D5]">{m.text}</span>
                    </div>
                  ))
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {QUICK_CALLOUTS.map((callout) => (
                  <button
                    key={callout}
                    type="button"
                    onClick={() => onSendChat(callout)}
                    className="px-2 py-1 min-h-[28px] rounded bg-[#181D29] border border-[#2C3344] hover:border-amber-500/60 text-[10px] text-[#D4CFC4] cursor-pointer"
                  >
                    {callout}
                  </button>
                ))}
              </div>
              <form onSubmit={handleSubmitChat} className="flex items-center gap-1.5">
                <input
                  type="text"
                  maxLength={100}
                  value={chatDraft}
                  onChange={(e) => setChatDraft(e.target.value)}
                  placeholder="Mensaje..."
                  className="flex-1 min-w-0 min-h-[36px] px-2.5 py-1 rounded bg-[#090A0E] border border-[#2C3344] text-xs text-[#E5E0D5] focus:outline-none focus:border-violet-400"
                />
                <button
                  type="submit"
                  aria-label="Enviar mensaje"
                  className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded bg-amber-600 hover:bg-amber-500 text-[#0B0C10] cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Co-op Downed Notice */}
      {hud.coop?.isDowned && (
        <div className="mx-auto my-auto px-4 py-2.5 bg-[#1B0D12]/95 border border-red-700/80 rounded-md text-center space-y-0.5 pointer-events-none">
          <div className="font-display text-sm font-bold text-red-300">Has caído en la cripta</div>
          <div className="text-xs text-[#D4CFC4]">
            Un aliado puede revivirte acercándose y pulsando Interactuar (F)
          </div>
        </div>
      )}

      {p2 && (p2.isDowned || hud.hp <= 0) && (
        <div className="mx-auto my-auto px-4 py-2 bg-[#1B0D12]/95 border border-red-700/80 rounded-md text-center space-y-0.5 pointer-events-none">
          <div className="font-display text-xs sm:text-sm font-bold text-red-300">
            {hud.hp <= 0 ? 'Jugador 1 ha caído' : 'Jugador 2 ha caído'}
          </div>
          <div className="text-[11px] sm:text-xs text-[#D4CFC4]">
            {hud.hp <= 0
              ? 'Acércate con Jugador 2 y pulsa L (o botón interactuar) para revivirlo'
              : 'Acércate con Jugador 1 y pulsa F (o botón interactuar) para revivirlo'}
          </div>
        </div>
      )}

      {/* Mobile-only compact Boss Bar, Reconnect Banner, Floor Banner & Level-Up Prompt */}
      {(hud.boss ||
        hud.bannerMessage ||
        (showTouchControls && hud.levelUpToastTimer > 0) ||
        (hud.coop &&
          (coopTelemetry.connectionState === 'reconnecting' ||
            coopTelemetry.connectionState === 'connecting'))) && (
        <div className="sm:hidden flex flex-col items-center gap-1.5 my-auto pointer-events-none">
          {hud.coop &&
            (coopTelemetry.connectionState === 'reconnecting' ||
              coopTelemetry.connectionState === 'connecting') && (
              <div className="px-3 py-1 bg-[#1B1610]/95 border border-amber-500/70 rounded text-[11px] font-mono-num text-amber-200 inline-flex items-center gap-1.5">
                <RefreshCw className="w-3 h-3 text-amber-400 animate-spin shrink-0" />
                <span>
                  Reconectando #{hud.coop.roomCode} ({coopTelemetry.reconnectAttempt + 1})
                </span>
              </div>
            )}
          {hud.boss && (
            <div
              className={`w-full max-w-xs bg-[#0E1117]/92 rounded-md px-3 py-1.5 border ${
                hud.boss.enraged ? 'border-red-500/90' : 'border-red-900/70'
              }`}
            >
              <div className="flex items-center justify-between gap-1.5 text-[11px] mb-1">
                <span className="font-display font-bold text-[#E5E0D5] truncate">
                  {hud.boss.name}
                  {hud.boss.enraged ? ' · FURIA' : ''}
                </span>
                <span className="font-mono-num text-red-400 shrink-0">
                  {hud.boss.hp}/{hud.boss.maxHp}
                </span>
              </div>
              <div className="h-2 w-full bg-[#1A1216] rounded-sm overflow-hidden">
                <div
                  className={`h-full ${
                    hud.boss.enraged
                      ? 'bg-gradient-to-r from-red-600 via-rose-500 to-amber-500'
                      : 'bg-gradient-to-r from-red-700 to-amber-600'
                  }`}
                  style={{ width: `${(hud.boss.hp / hud.boss.maxHp) * 100}%` }}
                />
              </div>
            </div>
          )}
          {hud.bannerMessage && (
            <div className="px-3 py-1 bg-[#0E1117]/92 border border-amber-700/50 rounded text-[11px] font-display font-semibold text-amber-300 text-center">
              {hud.bannerMessage}
            </div>
          )}
          {showTouchControls && hud.levelUpToastTimer > 0 && (
            <button
              type="button"
              onClick={onOpenCharacter}
              className="pointer-events-auto px-3 py-1.5 bg-[#141821]/95 border border-amber-500/70 rounded text-[11px] font-semibold text-amber-300 cursor-pointer"
            >
              Punto de habilidad disponible · Toca Árbol
            </button>
          )}
        </div>
      )}

      {/* BOTTOM ROW (Desktop keyboard dock; hidden when touch controls are active) */}
      {!showTouchControls && (
        <div className="flex flex-col items-center gap-2">
          {(hud.nearbyPrompt || p2?.nearbyPrompt) && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {hud.nearbyPrompt && (
                <div className="px-3.5 py-1.5 bg-[#0E1117]/95 border border-amber-500/70 rounded text-xs font-semibold text-amber-300">
                  {p2 ? `J1: ${hud.nearbyPrompt}` : hud.nearbyPrompt}
                </div>
              )}
              {p2?.nearbyPrompt && (
                <div className="px-3.5 py-1.5 bg-[#0E1117]/95 border border-sky-400/70 rounded text-xs font-semibold text-sky-300">
                  J2: {p2.nearbyPrompt}
                </div>
              )}
            </div>
          )}

          {hud.levelUpToastTimer > 0 && (
            <div className="px-3.5 py-1 bg-[#141821]/95 border border-amber-500/60 rounded text-xs text-amber-300">
              Punto de habilidad disponible · Pulsa K para personalizar tu build
            </div>
          )}

          {/* Ability Dock */}
          <div className="bg-[#0E1117]/92 border border-[#2A3142] rounded-md px-3 py-2 flex items-center gap-2">
            {/* Primary Attack */}
            <div className="w-12 h-12 rounded bg-[#161B26] border border-[#2C3344] flex flex-col items-center justify-center">
              <span className="text-[10px] font-mono-num text-[#949BA8]">Clic</span>
              <span className="text-[11px] font-medium text-[#E5E0D5]">Atacar</span>
            </div>

            {/* Dash */}
            <div className="relative w-12 h-12 rounded bg-[#161B26] border border-[#2C3344] flex flex-col items-center justify-center overflow-hidden">
              {hud.dashCooldownRemaining > 0 && (
                <div
                  className="absolute inset-x-0 bottom-0 bg-black/70"
                  style={{
                    height: `${Math.min(100, (hud.dashCooldownRemaining / hud.dashCooldownMax) * 100)}%`,
                  }}
                />
              )}
              <span className="relative text-[10px] font-mono-num text-[#949BA8]">Espacio</span>
              <span className="relative text-[11px] font-medium text-[#E5E0D5]">
                {hud.dashCooldownRemaining > 0
                  ? hud.dashCooldownRemaining.toFixed(1)
                  : 'Esquiva'}
              </span>
            </div>

            <div className="w-px h-8 bg-[#262D3D]" />

            {/* Q / E / R Skill Slots */}
            {slots.map((slotKey) => {
              const skillId = hud.equippedSlots[slotKey];
              const skill = skillId ? ACTIVE_SKILLS[skillId] : null;
              const cd = hud.skillCooldowns[slotKey];
              const maxCd = hud.skillMaxCooldowns[slotKey] || 1;
              const noMana = skill ? hud.mana < skill.manaCost : false;

              return (
                <div
                  key={slotKey}
                  className={`relative w-14 h-12 rounded border flex flex-col items-center justify-center px-1 overflow-hidden ${
                    skill
                      ? noMana
                        ? 'bg-[#141720] border-[#2C3344] opacity-65'
                        : 'bg-[#191E2A] border-[#384158]'
                      : 'bg-[#10131A] border-[#202634]'
                  }`}
                >
                  {cd > 0 && (
                    <div
                      className="absolute inset-x-0 bottom-0 bg-black/75"
                      style={{ height: `${Math.min(100, (cd / maxCd) * 100)}%` }}
                    />
                  )}
                  <div className="relative flex items-center justify-between w-full px-0.5">
                    <span className="text-[10px] font-mono-num font-bold text-amber-400">
                      {slotKey}
                    </span>
                    {skill && (
                      <span className="text-[9px] font-mono-num text-violet-300">
                        {skill.manaCost}
                      </span>
                    )}
                  </div>
                  <span className="relative text-[10px] font-medium text-[#E5E0D5] truncate w-full text-center">
                    {cd > 0 ? `${cd.toFixed(1)}s` : skill ? skill.name.split(' ')[0] : 'Vacío'}
                  </span>
                </div>
              );
            })}

            <div className="w-px h-8 bg-[#262D3D]" />

            {/* Healing Flask */}
            <div className="w-13 h-12 rounded bg-[#1B1418] border border-red-900/60 flex flex-col items-center justify-center">
              <span className="text-[10px] font-mono-num text-red-300">1 · Frasco</span>
              <span className="text-xs font-mono-num font-bold text-[#E5E0D5]">
                {hud.flaskCharges}/{hud.maxFlaskCharges}
              </span>
            </div>
          </div>

          {p2 && (
            <div className="hidden md:block px-3 py-1 rounded bg-[#0E1117]/85 border border-sky-900/50 text-[10px] font-mono-num text-sky-300">
              J2: Flechas Mover · M/Intro Atacar · Shift Der. Esquiva · U/I/O Hab. · P Frasco · L Revivir (o usa un Mando)
            </div>
          )}
        </div>
      )}

      {/* Mid-run Hotspot P2P Invite Overlay */}
      {p2pInviteOpen && (
        <div className="pointer-events-auto fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#12151C] border border-[#2C3344] rounded-lg p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-base font-bold text-[#E5E0D5]">
                Invitar Aliado (Hotspot P2P)
              </h3>
              <button
                type="button"
                onClick={() => setP2pInviteOpen(false)}
                aria-label="Cerrar invitación"
                className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded bg-[#181C26] border border-[#2C3344] text-[#949BA8] hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {p2pInviteError && (
              <div className="p-2.5 rounded bg-red-950/60 border border-red-800 text-xs text-red-200">
                {p2pInviteError}
              </div>
            )}

            {p2pInviteBusy && !p2pOfferToken ? (
              <div className="py-6 text-center text-xs text-[#949BA8]">
                Generando invitación de red local...
              </div>
            ) : (
              p2pOfferToken && (
                <div className="space-y-3">
                  <div className="flex justify-center">
                    <QrCodeBox value={p2pOfferToken} size={156} label="1. Invitado escanea o copia C1" />
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={p2pOfferToken}
                      className="flex-1 min-w-0 min-h-[38px] px-2.5 rounded bg-[#0C0E13] border border-[#2C3344] text-[10px] font-mono-num text-[#D4CFC4]"
                    />
                    <button
                      type="button"
                      onClick={() => navigator.clipboard?.writeText(p2pOfferToken).catch(() => {})}
                      className="min-h-[38px] px-3 rounded bg-[#1D2434] border border-[#384158] text-xs font-medium text-[#E5E0D5] cursor-pointer"
                    >
                      Copiar C1
                    </button>
                  </div>
                </div>
              )
            )}

            <form onSubmit={handleAcceptMidRunAnswer} className="space-y-2 pt-2 border-t border-[#232836]">
              <label className="block text-xs text-sky-300 font-medium">
                2. Pega la respuesta (C2) del aliado
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={p2pAnswerDraft}
                  onChange={(e) => setP2pAnswerDraft(e.target.value)}
                  placeholder="C2Z:..."
                  className="flex-1 min-w-0 min-h-[40px] px-3 rounded bg-[#0C0E13] border border-[#2C3344] text-xs font-mono-num text-[#E5E0D5]"
                />
                <button
                  type="submit"
                  disabled={p2pInviteBusy || !p2pAnswerDraft.trim()}
                  className="min-h-[40px] px-4 rounded bg-sky-500 hover:bg-sky-400 disabled:opacity-45 text-[#0B0C10] text-xs font-semibold cursor-pointer"
                >
                  Conectar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
