import React, { useRef, useState } from 'react';
import { Flame, Hand, Shield, Sparkles, Sword, Wind } from 'lucide-react';
import { ACTIVE_SKILLS } from '../data/gameData';
import { HudSnapshot, SkillSlotKey } from '../types/game';

interface MobileControlsProps {
  hud: HudSnapshot;
  onMove: (dx: number, dy: number) => void;
  onAttackHold: (held: boolean) => void;
  onDash: () => void;
  onSkill: (slot: SkillSlotKey) => void;
  onFlask: () => void;
  onInteract: () => void;
}

export const MobileControls: React.FC<MobileControlsProps> = ({
  hud,
  onMove,
  onAttackHold,
  onDash,
  onSkill,
  onFlask,
  onInteract,
}) => {
  const padRef = useRef<HTMLDivElement | null>(null);
  const activePointerId = useRef<number | null>(null);
  const attackPointerId = useRef<number | null>(null);
  const [knobOffset, setKnobOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [attackPressed, setAttackPressed] = useState(false);

  const maxRadius = 42;

  const updateJoystick = (clientX: number, clientY: number) => {
    const pad = padRef.current;
    if (!pad) return;
    const rect = pad.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > maxRadius) {
      dx = (dx / dist) * maxRadius;
      dy = (dy / dist) * maxRadius;
    }
    setKnobOffset({ x: dx, y: dy });
    onMove(dx / maxRadius, dy / maxRadius);
  };

  const resetJoystick = () => {
    activePointerId.current = null;
    setKnobOffset({ x: 0, y: 0 });
    onMove(0, 0);
  };

  const slots: SkillSlotKey[] = ['Q', 'E', 'R'];

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30 pointer-events-none flex items-end justify-between px-4 sm:px-6 pb-4 sm:pb-6 touch-game-surface"
      style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
    >
      {/* Left Thumb Zone: Virtual Movement Joystick */}
      <div
        ref={padRef}
        role="slider"
        aria-label="Joystick virtual de movimiento"
        aria-valuetext="Control direccional"
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (activePointerId.current !== null) return;
          activePointerId.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          updateJoystick(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (activePointerId.current !== e.pointerId) return;
          updateJoystick(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          if (activePointerId.current === e.pointerId) {
            resetJoystick();
          }
        }}
        onPointerCancel={(e) => {
          if (activePointerId.current === e.pointerId) {
            resetJoystick();
          }
        }}
        className="pointer-events-auto relative w-28 h-28 sm:w-32 sm:h-32 rounded-full bg-[#0E1117]/70 border-2 border-[#3A4358]/80 flex items-center justify-center touch-none"
      >
        {/* Crosshair ticks */}
        <div className="w-16 h-16 rounded-full border border-[#2C3344]/60 pointer-events-none" />
        {/* Thumb puck */}
        <div
          className="absolute w-12 h-12 rounded-full bg-[#242B3B]/95 border-2 border-amber-500/80 shadow-md pointer-events-none"
          style={{
            transform: `translate(${knobOffset.x}px, ${knobOffset.y}px)`,
          }}
        />
      </div>

      {/* Right Thumb Zone: Combat Action Cluster */}
      <div className="pointer-events-auto flex flex-col items-end gap-2.5 touch-none">
        {/* Contextual Interact CTA when near Chest / Shrine / Portal */}
        {hud.nearbyPrompt && (
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onInteract();
            }}
            className="min-h-[44px] px-4 py-2 rounded-full bg-amber-600 active:bg-amber-500 text-[#0B0C10] font-semibold text-xs flex items-center gap-2 shadow-lg border border-amber-400"
          >
            <Hand className="w-4 h-4" />
            <span>{hud.nearbyPrompt.replace('[F] ', '')}</span>
          </button>
        )}

        {/* Top arc: Flask + Active Skills (Q, E, R) */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Usar frasco curativo"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onFlask();
            }}
            className={`relative min-w-[46px] min-h-[46px] w-12 h-12 rounded-full border flex flex-col items-center justify-center transition-transform active:scale-95 ${
              hud.flaskCharges > 0
                ? 'bg-[#211317]/90 border-red-600/80 text-red-200'
                : 'bg-[#12151C]/75 border-[#2C3344] text-[#6B7280]'
            }`}
          >
            <Flame className="w-4 h-4 text-red-400" />
            <span className="text-[10px] font-mono-num font-bold leading-none mt-0.5">
              {hud.flaskCharges}
            </span>
          </button>

          {slots.map((slot) => {
            const skillId = hud.equippedSlots[slot];
            const skill = skillId ? ACTIVE_SKILLS[skillId] : null;
            const cd = hud.skillCooldowns[slot];
            const maxCd = hud.skillMaxCooldowns[slot] || 1;
            const disabled = !skill || hud.mana < skill.manaCost;

            return (
              <button
                key={slot}
                type="button"
                disabled={!skill}
                aria-label={skill ? skill.name : `Ranura ${slot} vacía`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (skill) onSkill(slot);
                }}
                className={`relative min-w-[48px] min-h-[48px] w-12 h-12 rounded-full border flex flex-col items-center justify-center overflow-hidden transition-transform active:scale-95 ${
                  !skill
                    ? 'bg-[#10131A]/70 border-[#222836] text-[#475066]'
                    : disabled
                    ? 'bg-[#141822]/85 border-[#2C3344] text-[#949BA8]'
                    : 'bg-[#1A1F2E]/92 border-violet-500/80 text-[#E5E0D5]'
                }`}
              >
                {cd > 0 && (
                  <div
                    className="absolute inset-x-0 bottom-0 bg-black/75"
                    style={{ height: `${Math.min(100, (cd / maxCd) * 100)}%` }}
                  />
                )}
                <Sparkles className="relative w-3.5 h-3.5 text-amber-400" />
                <span className="relative text-[10px] font-mono-num font-bold leading-none mt-0.5">
                  {cd > 0 ? cd.toFixed(0) : slot}
                </span>
              </button>
            );
          })}
        </div>

        {/* Bottom row: Dash + Primary Hold-to-Combo Attack */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Esquivar"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDash();
            }}
            className="relative min-w-[54px] min-h-[54px] w-14 h-14 rounded-full bg-[#161B26]/90 border-2 border-[#3E4861] active:border-amber-400 flex flex-col items-center justify-center overflow-hidden active:scale-95 transition-transform"
          >
            {hud.dashCooldownRemaining > 0 && (
              <div
                className="absolute inset-x-0 bottom-0 bg-black/75"
                style={{
                  height: `${Math.min(100, (hud.dashCooldownRemaining / hud.dashCooldownMax) * 100)}%`,
                }}
              />
            )}
            <Wind className="relative w-5 h-5 text-emerald-300" />
            <span className="relative text-[10px] font-medium text-[#E5E0D5]">
              {hud.dashCooldownRemaining > 0
                ? hud.dashCooldownRemaining.toFixed(1)
                : 'Esquiva'}
            </span>
          </button>

          <button
            type="button"
            aria-label="Atacar"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              attackPointerId.current = e.pointerId;
              e.currentTarget.setPointerCapture(e.pointerId);
              setAttackPressed(true);
              onAttackHold(true);
            }}
            onPointerUp={(e) => {
              if (attackPointerId.current === e.pointerId) {
                attackPointerId.current = null;
                setAttackPressed(false);
                onAttackHold(false);
              }
            }}
            onPointerCancel={(e) => {
              if (attackPointerId.current === e.pointerId) {
                attackPointerId.current = null;
                setAttackPressed(false);
                onAttackHold(false);
              }
            }}
            className={`min-w-[68px] min-h-[68px] w-[72px] h-[72px] rounded-full border-2 flex flex-col items-center justify-center transition-transform ${
              attackPressed
                ? 'bg-red-700 border-amber-400 scale-95'
                : 'bg-red-800/90 border-amber-500/90'
            }`}
          >
            {hud.shield > 0 ? (
              <Shield className="w-6 h-6 text-amber-200" />
            ) : (
              <Sword className="w-6 h-6 text-[#FEF3C7]" />
            )}
            <span className="text-[10px] font-semibold text-[#FEF3C7] mt-0.5">Atacar</span>
          </button>
        </div>
      </div>
    </div>
  );
};
