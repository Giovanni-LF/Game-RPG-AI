import React, { useEffect, useRef, useState } from 'react';
import { Flame, Hand, Shield, Sparkles, Sword, Wind } from 'lucide-react';
import { music } from '../audio/music';
import { ACTIVE_SKILLS } from '../data/gameData';
import { ActiveSkillId, HudSnapshot, SkillSlotKey } from '../types/game';

interface DualTouchControlsProps {
  hud: HudSnapshot;
  onP1Move: (dx: number, dy: number) => void;
  onP1AttackHold: (held: boolean) => void;
  onP1Dash: () => void;
  onP1Skill: (slot: SkillSlotKey) => void;
  onP1Flask: () => void;
  onP1Interact: () => void;
  onP2Move: (dx: number, dy: number) => void;
  onP2AttackHold: (held: boolean) => void;
  onP2Dash: () => void;
  onP2Skill: (slot: SkillSlotKey) => void;
  onP2Flask: () => void;
  onP2Interact: () => void;
}

interface PlayerPadProps {
  label: string;
  accentHex: string;
  accentBorderClass: string;
  hp: number;
  mana: number;
  shield: number;
  flaskCharges: number;
  dashCooldownRemaining: number;
  dashCooldownMax: number;
  equippedSlots: Record<SkillSlotKey, ActiveSkillId | null>;
  skillCooldowns: Record<SkillSlotKey, number>;
  skillMaxCooldowns: Record<SkillSlotKey, number>;
  nearbyPrompt: string | null;
  isDowned: boolean;
  alignRight?: boolean;
  onMove: (dx: number, dy: number) => void;
  onAttackHold: (held: boolean) => void;
  onDash: () => void;
  onSkill: (slot: SkillSlotKey) => void;
  onFlask: () => void;
  onInteract: () => void;
}

const PlayerTouchZone: React.FC<PlayerPadProps> = ({
  label,
  accentHex,
  accentBorderClass,
  hp,
  mana,
  shield,
  flaskCharges,
  dashCooldownRemaining,
  dashCooldownMax,
  equippedSlots,
  skillCooldowns,
  skillMaxCooldowns,
  nearbyPrompt,
  isDowned,
  alignRight = false,
  onMove,
  onAttackHold,
  onDash,
  onSkill,
  onFlask,
  onInteract,
}) => {
  const padRef = useRef<HTMLDivElement | null>(null);
  const movePointerId = useRef<number | null>(null);
  const attackPointerId = useRef<number | null>(null);
  const [knobOffset, setKnobOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [attackPressed, setAttackPressed] = useState(false);

  const maxRadius = 32;
  const deadZone = 0.1;

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
    movePointerId.current = null;
    setKnobOffset({ x: 0, y: 0 });
    onMove(0, 0);
  };

  const releaseAttack = () => {
    attackPointerId.current = null;
    setAttackPressed(false);
    onAttackHold(false);
  };

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

  if (isDowned || hp <= 0) {
    return (
      <div className="pointer-events-none flex items-end justify-center pb-3">
        <div className="px-3 py-1.5 rounded bg-[#1B0D12]/90 border border-red-800/80 text-[11px] font-semibold text-red-200">
          {label} caído · Acércate para revivir
        </div>
      </div>
    );
  }

  const joystickBlock = (
    <div className="pointer-events-auto flex flex-col items-center gap-1 touch-none select-none">
      <span
        className="text-[10px] font-mono-num font-bold tracking-wider"
        style={{ color: accentHex }}
      >
        {label}
      </span>
      <div
        ref={padRef}
        role="slider"
        aria-label={`Joystick táctil ${label}`}
        aria-valuetext="Control direccional"
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          music.unlock();
          if (movePointerId.current !== null) return;
          movePointerId.current = e.pointerId;
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Ignore
          }
          updateJoystick(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (movePointerId.current !== e.pointerId) return;
          e.preventDefault();
          updateJoystick(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          if (movePointerId.current === e.pointerId) {
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
          if (movePointerId.current === e.pointerId) resetJoystick();
        }}
        onLostPointerCapture={(e) => {
          if (movePointerId.current === e.pointerId) resetJoystick();
        }}
        onContextMenu={(e) => e.preventDefault()}
        className={`relative w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-[#0E1117]/75 border-2 ${accentBorderClass} flex items-center justify-center touch-none`}
      >
        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full border border-[#2C3344]/70 pointer-events-none" />
        <div
          className="absolute w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#242B3B]/95 border-2 shadow-md pointer-events-none"
          style={{
            borderColor: accentHex,
            transform: `translate(${knobOffset.x}px, ${knobOffset.y}px)`,
          }}
        />
      </div>
    </div>
  );

  const actionsBlock = (
    <div
      onContextMenu={(e) => e.preventDefault()}
      className={`pointer-events-auto flex flex-col ${
        alignRight ? 'items-end' : 'items-start'
      } gap-1.5 touch-none select-none`}
    >
      {nearbyPrompt && (
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            music.unlock();
            onInteract();
          }}
          className="min-h-[40px] max-w-[140px] px-2.5 py-1.5 rounded-md bg-amber-500 active:bg-amber-400 text-[#0B0C10] font-semibold text-[11px] flex items-center gap-1.5 shadow border border-amber-300 touch-none"
        >
          <Hand className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{nearbyPrompt.replace(/^\[[A-Z]\]\s*/, '')}</span>
        </button>
      )}

      {/* Compact Flask + Skills */}
      <div className="flex items-center gap-1 sm:gap-1.5">
        <button
          type="button"
          aria-label={`Frasco ${label}`}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            music.unlock();
            onFlask();
          }}
          className={`min-w-[40px] min-h-[40px] w-10 h-10 sm:w-11 sm:h-11 rounded-full border flex flex-col items-center justify-center active:scale-95 touch-none ${
            flaskCharges > 0
              ? 'bg-[#211317]/90 border-red-600/80 text-red-200'
              : 'bg-[#12151C]/75 border-[#2C3344] text-[#6B7280]'
          }`}
        >
          <Flame className="w-3.5 h-3.5 text-red-400" />
          <span className="text-[9px] font-mono-num font-bold leading-none mt-0.5">
            {flaskCharges}
          </span>
        </button>

        {slots.map((slot) => {
          const skillId = equippedSlots[slot];
          const skill = skillId ? ACTIVE_SKILLS[skillId] : null;
          const cd = skillCooldowns[slot];
          const maxCd = skillMaxCooldowns[slot] || 1;
          const noMana = !skill || mana < skill.manaCost;

          return (
            <button
              key={slot}
              type="button"
              disabled={!skill}
              aria-label={skill ? `${label} ${skill.name}` : `${label} Ranura ${slot} vacía`}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                music.unlock();
                if (skill) onSkill(slot);
              }}
              className={`relative min-w-[40px] min-h-[40px] w-10 h-10 sm:w-11 sm:h-11 rounded-full border flex flex-col items-center justify-center overflow-hidden active:scale-95 touch-none ${
                !skill
                  ? 'bg-[#10131A]/70 border-[#222836] text-[#475066]'
                  : noMana
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
              <Sparkles className="relative w-3 h-3 text-amber-400" />
              <span className="relative text-[9px] font-mono-num font-bold leading-none mt-0.5">
                {cd > 0 ? cd.toFixed(0) : slot}
              </span>
            </button>
          );
        })}
      </div>

      {/* Dash + Attack */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        <button
          type="button"
          aria-label={`Esquivar ${label}`}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            music.unlock();
            onDash();
          }}
          className="relative min-w-[44px] min-h-[44px] w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-[#161B26]/90 border-2 border-[#3E4861] active:border-amber-400 flex flex-col items-center justify-center overflow-hidden active:scale-95 touch-none"
        >
          {dashCooldownRemaining > 0 && (
            <div
              className="absolute inset-x-0 bottom-0 bg-black/75"
              style={{
                height: `${Math.min(100, (dashCooldownRemaining / dashCooldownMax) * 100)}%`,
              }}
            />
          )}
          <Wind className="relative w-4 h-4 text-emerald-300" />
          <span className="relative text-[9px] font-medium text-[#E5E0D5]">
            {dashCooldownRemaining > 0 ? dashCooldownRemaining.toFixed(1) : 'Esquiva'}
          </span>
        </button>

        <button
          type="button"
          aria-label={`Atacar ${label}`}
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
          className={`min-w-[50px] min-h-[50px] w-13 h-13 sm:w-14 sm:h-14 rounded-full border-2 flex flex-col items-center justify-center transition-transform touch-none ${
            attackPressed ? 'bg-red-700 scale-95' : 'bg-red-800/90'
          }`}
          style={{ borderColor: accentHex }}
        >
          {shield > 0 ? (
            <Shield className="w-5 h-5 text-amber-200" />
          ) : (
            <Sword className="w-5 h-5 text-[#FEF3C7]" />
          )}
          <span className="text-[9px] font-semibold text-[#FEF3C7]">Atacar</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex items-end justify-between gap-1.5 sm:gap-2 w-full">
      {alignRight ? (
        <>
          {actionsBlock}
          {joystickBlock}
        </>
      ) : (
        <>
          {joystickBlock}
          {actionsBlock}
        </>
      )}
    </div>
  );
};

export const DualTouchControls: React.FC<DualTouchControlsProps> = ({
  hud,
  onP1Move,
  onP1AttackHold,
  onP1Dash,
  onP1Skill,
  onP1Flask,
  onP1Interact,
  onP2Move,
  onP2AttackHold,
  onP2Dash,
  onP2Skill,
  onP2Flask,
  onP2Interact,
}) => {
  const p2 = hud.localP2;
  if (!p2) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30 pointer-events-none grid grid-cols-2 gap-2 sm:gap-6 px-2 sm:px-5 pb-2.5 sm:pb-3 touch-game-surface"
      style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))' }}
    >
      {/* Left Half: J1 (Amber) */}
      <PlayerTouchZone
        label="J1"
        accentHex="#F59E0B"
        accentBorderClass="border-amber-500/75"
        hp={hud.hp}
        mana={hud.mana}
        shield={hud.shield}
        flaskCharges={hud.flaskCharges}
        dashCooldownRemaining={hud.dashCooldownRemaining}
        dashCooldownMax={hud.dashCooldownMax}
        equippedSlots={hud.equippedSlots}
        skillCooldowns={hud.skillCooldowns}
        skillMaxCooldowns={hud.skillMaxCooldowns}
        nearbyPrompt={hud.nearbyPrompt}
        isDowned={hud.hp <= 0}
        onMove={onP1Move}
        onAttackHold={onP1AttackHold}
        onDash={onP1Dash}
        onSkill={onP1Skill}
        onFlask={onP1Flask}
        onInteract={onP1Interact}
      />

      {/* Right Half: J2 (Sky Cyan) */}
      <PlayerTouchZone
        label="J2"
        accentHex="#38BDF8"
        accentBorderClass="border-sky-400/75"
        hp={p2.hp}
        mana={p2.mana}
        shield={p2.shield}
        flaskCharges={p2.flaskCharges}
        dashCooldownRemaining={p2.dashCooldownRemaining}
        dashCooldownMax={p2.dashCooldownMax}
        equippedSlots={p2.equippedSlots}
        skillCooldowns={p2.skillCooldowns}
        skillMaxCooldowns={p2.skillMaxCooldowns}
        nearbyPrompt={p2.nearbyPrompt}
        isDowned={p2.isDowned}
        alignRight
        onMove={onP2Move}
        onAttackHold={onP2AttackHold}
        onDash={onP2Dash}
        onSkill={onP2Skill}
        onFlask={onP2Flask}
        onInteract={onP2Interact}
      />
    </div>
  );
};
