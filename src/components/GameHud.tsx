import React, { useState } from 'react';
import { BookOpen, Check, Copy, Gamepad2, MessageSquare, Pause, QrCode, Send, Volume2, VolumeX, X } from 'lucide-react';
import { ACTIVE_SKILLS } from '../data/gameData';
import { coopClient } from '../net/coopClient';
import type { CoopChatMessage } from '../types/coop';
import { HudSnapshot, SkillSlotKey } from '../types/game';
import { QrCodeBox } from './QrCodeBox';

interface GameHudProps {
  hud: HudSnapshot;
  muted: boolean;
  showTouchControls: boolean;
  chatMessages: CoopChatMessage[];
  onSendChat: (text: string) => void;
  onToggleTouchControls: () => void;
  onToggleMute: () => void;
  onOpenCharacter: () => void;
  onPause: () => void;
}

const QUICK_CALLOUTS = ['¡Aquí!', '¡Jefe!', 'Necesito cura', '¡Listo!'];

export const GameHud: React.FC<GameHudProps> = ({
  hud,
  muted,
  showTouchControls,
  chatMessages,
  onSendChat,
  onToggleTouchControls,
  onToggleMute,
  onOpenCharacter,
  onPause,
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
                {hud.coop.allies.length === 0 ? (
                  <div className="text-[10px] text-[#949BA8]">Esperando aliados...</div>
                ) : (
                  <div className="space-y-1">
                    {hud.coop.allies.map((ally) => {
                      const allyPct = Math.max(0, Math.min(100, (ally.hp / Math.max(1, ally.maxHp)) * 100));
                      return (
                        <div key={ally.id} className="space-y-0.5">
                          <div className="flex items-center justify-between gap-1 text-[10px]">
                            <span className="flex items-center gap-1 truncate text-[#E5E0D5]">
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: ally.color }}
                              />
                              <span className="truncate">{ally.name}</span>
                            </span>
                            <span className="font-mono-num text-[9px] shrink-0 text-[#949BA8]">
                              {ally.alive ? `${ally.hp}/${ally.maxHp}` : 'CAÍDO'}
                            </span>
                          </div>
                          <div className="h-1 w-full bg-[#191E29] rounded-sm overflow-hidden">
                            <div
                              className="h-full transition-all duration-150"
                              style={{
                                width: `${ally.alive ? allyPct : 100}%`,
                                backgroundColor: ally.alive ? ally.color : '#991B1B',
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

        {/* Top-Center Boss Health Bar & Floor Banner */}
        <div className="hidden sm:flex flex-1 max-w-md flex-col items-center gap-2 pt-1">
          {hud.boss && (
            <div className="w-full bg-[#0E1117]/95 border border-red-900/70 rounded-md px-4 py-2.5">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="font-display font-bold text-[#E5E0D5] truncate">
                  {hud.boss.name}
                </span>
                <span className="font-mono-num text-red-400 shrink-0">
                  {hud.boss.hp}/{hud.boss.maxHp}
                </span>
              </div>
              <div className="h-2.5 w-full bg-[#1A1216] rounded-sm overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-red-700 to-amber-600 transition-all duration-100"
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

      {/* Mobile-only compact Boss Bar & Floor Banner */}
      {(hud.boss || hud.bannerMessage) && (
        <div className="sm:hidden flex flex-col items-center gap-1.5 my-auto pointer-events-none">
          {hud.boss && (
            <div className="w-full max-w-xs bg-[#0E1117]/92 border border-red-900/70 rounded-md px-3 py-1.5">
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="font-display font-bold text-[#E5E0D5] truncate">
                  {hud.boss.name}
                </span>
                <span className="font-mono-num text-red-400 shrink-0">
                  {hud.boss.hp}/{hud.boss.maxHp}
                </span>
              </div>
              <div className="h-2 w-full bg-[#1A1216] rounded-sm overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-red-700 to-amber-600"
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
