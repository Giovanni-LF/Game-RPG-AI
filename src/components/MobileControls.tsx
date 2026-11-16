import React, { useEffect, useRef, useState } from 'react';
import { Flame, Hand, Shield, Sparkles, Sword, Wind } from 'lucide-react';
import { music } from '../audio/music';
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
  const zoneRef = useRef<HTMLDivElement | null>(null);
  const activePointerId = useRef<number | null>(null);
  const attackPointerId = useRef<number | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);

  const [ringCenter, setRingCenter] = useState<{ x: number; y: number } | null>(null);
  const [knobOffset, setKnobOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [attackPressed, setAttackPressed] = useState(false);

  const maxRadius = 42;
  const deadZone = 0.1;

  const updateJoystick = (clientX: number, clientY: number) => {
    const zone = zoneRef.current;
    if (!zone) return;
    const rect = zone.getBoundingClientRect();
    const origin = originRef.current ?? {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };

    let dx = clientX - origin.x;
    let dy = clientY - origin.y;
    const dist = Math.hypot(dx, dy);
    if (dist > maxRadius) {
      dx = (dx / dist) * maxRadius;
      dy = (dy / dist) * maxRadius;
    }

    setKnobOffset({ x: dx, y: dy });

    const norm = dist / maxRadius;
    if (norm < deadZone) {
      onMove(0, 0);
      return;
    }
    const scaled = Math.min(1, (norm - deadZone) / (1 - deadZone));
    const ux = dist > 0 ? dx / dist : 0;
    const uy = dist > 0 ? dy / dist : 0;
    onMove(ux * scaled, uy * scaled);
  };

  const resetJoystick = () => {
    activePointerId.current = null;
    originRef.current = null;
    setRingCenter(null);
    setKnobOffset({ x: 0, y: 0 });
    onMove(0, 0);
  };

  const releaseAttack = () => {
    attackPointerId.current = null;
    setAttackPressed(false);
    onAttackHold(false);
  };

  // Guarantee zero stuck inputs on unmount or window blur
  useEffect(() => {
    const onBlur = () => {
      resetJoystick();
      releaseAttack();
    };
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('blur', onBlur);
      onMove(0, 0);
      onAttackHold(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const slots: SkillSlotKey[] = ['Q', 'E', 'R'];

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30 pointer-events-none flex items-end justify-between px-3 sm:px-6 pb-3 sm:pb-5 touch-game-surface"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      {/* Left Thumb Zone: Large capture area with dynamic floating origin */}
      <div
        ref={zoneRef}
        role="slider"
        aria-label="Joystick virtual de movimiento"
        aria-valuetext="Control direccional"
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          music.unlock();
          if (activePointerId.current !== null) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const padInset = 44;
          const clampedX = Math.max(rect.left + padInset, Math.min(rect.right - padInset, e.clientX));
          const clampedY = Math.max(rect.top + padInset, Math.min(rect.bottom - padInset, e.clientY));
          originRef.current = { x: clampedX, y: clampedY };
          setRingCenter({ x: clampedX - rect.left, y: clampedY - rect.top });
          activePointerId.current = e.pointerId;
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Ignore synthetic capture failures
          }
          updateJoystick(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (activePointerId.current !== e.pointerId) return;
          e.preventDefault();
          updateJoystick(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          if (activePointerId.current === e.pointerId) {
            try {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
              }
            } catch {
              // Ignore
            }
            resetJoystick();
          }
        }}
        onPointerCancel={(e) => {
          if (activePointerId.current === e.pointerId) resetJoystick();
        }}
        onLostPointerCapture={(e) => {
          if (activePointerId.current === e.pointerId) resetJoystick();
        }}
        onContextMenu={(e) => e.preventDefault()}
        className="pointer-events-auto relative w-36 h-36 sm:w-44 sm:h-44 flex items-center justify-center touch-none select-none"
      >
        {/* Visual Joystick Base Ring (re-centers dynamically to thumb touch point) */}
        <div
          className="absolute w-28 h-28 sm:w-32 sm:h-32 rounded-full bg-[#0E1117]/72 border-2 border-[#3A4358]/85 flex items-center justify-center pointer-events-none transition-[left,top] duration-75"
          style={
            ringCenter
              ? {
                  left: `${ringCenter.x}px`,
                  top: `${ringCenter.y}px`,
                  transform: 'translate(-50%, -50%)',
                }
              : undefined
          }
        >
          <div className="w-14 h-14 rounded-full border border-[#2C3344]/65 pointer-events-none" />
          <div
            className="absolute w-11 h-11 rounded-full bg-[#242B3B]/95 border-2 border-amber-500/85 shadow-md pointer-events-none"
            style={{
              transform: `translate(${knobOffset.x}px, ${knobOffset.y}px)`,
            }}
          />
        </div>
      </div>

      {/* Right Thumb Zone: Combat Action Cluster */}
      <div
        onContextMenu={(e) => e.preventDefault()}
        className="pointer-events-auto flex flex-col items-end gap-2 touch-none select-none"
      >
        {/* Contextual Interact CTA when near Chest / Shrine / Portal */}
        {hud.nearbyPrompt && (
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              music.unlock();
              onInteract();
            }}
            className="min-h-[44px] max-w-[190px] px-3.5 py-2 rounded-md bg-amber-600 active:bg-amber-500 text-[#0B0C10] font-semibold text-xs flex items-center gap-2 shadow-lg border border-amber-400 touch-none"
          >
            <Hand className="w-4 h-4 shrink-0" />
            <span className="truncate">{hud.nearbyPrompt.replace(/^\[[A-Z]\]\s*/, '')}</span>
          </button>
        )}

        {/* Top arc: Flask + Active Skills (Q, E, R) */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            aria-label="Usar frasco curativo"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              music.unlock();
              onFlask();
            }}
            className={`relative min-w-[44px] min-h-[44px] w-11 h-11 sm:w-12 sm:h-12 rounded-full border flex flex-col items-center justify-center transition-transform active:scale-95 touch-none ${
              hud.flaskCharges > 0
                ? 'bg-[#211317]/92 border-red-600/85 text-red-200'
                : 'bg-[#12151C]/80 border-[#2C3344] text-[#6B7280]'
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
            const noMana = !skill || hud.mana < skill.manaCost;

            return (
              <button
                key={slot}
                type="button"
                disabled={!skill}
                aria-label={skill ? skill.name : `Ranura ${slot} vacía`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  music.unlock();
                  if (skill) onSkill(slot);
                }}
                className={`relative min-w-[44px] min-h-[44px] w-11 h-11 sm:w-12 sm:h-12 rounded-full border flex flex-col items-center justify-center overflow-hidden transition-transform active:scale-95 touch-none ${
                  !skill
                    ? 'bg-[#10131A]/75 border-[#222836] text-[#475066]'
                    : noMana
                    ? 'bg-[#141822]/88 border-[#2C3344] text-[#949BA8]'
                    : 'bg-[#1A1F2E]/94 border-violet-500/85 text-[#E5E0D5]'
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
        <div className="flex items-center gap-2.5 sm:gap-3">
          <button
            type="button"
            aria-label="Esquivar"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              music.unlock();
              onDash();
            }}
            className="relative min-w-[52px] min-h-[52px] w-13 h-13 sm:w-14 sm:h-14 rounded-full bg-[#161B26]/92 border-2 border-[#3E4861] active:border-amber-400 flex flex-col items-center justify-center overflow-hidden active:scale-95 transition-transform touch-none"
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
              music.unlock();
              attackPointerId.current = e.pointerId;
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                // Ignore
              }
              setAttackPressed(true);
              onAttackHold(true);
            }}
            onPointerUp={(e) => {
              if (attackPointerId.current === e.pointerId) {
                try {
                  if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  }
                } catch {
                  // Ignore
                }
                releaseAttack();
              }
            }}
            onPointerCancel={(e) => {
              if (attackPointerId.current === e.pointerId) releaseAttack();
            }}
            onLostPointerCapture={(e) => {
              if (attackPointerId.current === e.pointerId) releaseAttack();
            }}
            className={`min-w-[66px] min-h-[66px] w-[68px] h-[68px] sm:w-[72px] sm:h-[72px] rounded-full border-2 flex flex-col items-center justify-center transition-transform touch-none ${
              attackPressed
                ? 'bg-red-700 border-amber-400 scale-95'
                : 'bg-red-800/92 border-amber-500/90'
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
