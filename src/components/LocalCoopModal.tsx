import React, { useEffect, useState } from 'react';
import { Gamepad2, Keyboard, Smartphone, Users, WifiOff, X } from 'lucide-react';
import { ARCHETYPES } from '../data/gameData';
import { ArchetypeId, LocalCoopControlMode } from '../types/game';

interface LocalCoopModalProps {
  p1Archetype: ArchetypeId;
  defaultControlMode: LocalCoopControlMode;
  onStartLocalCoop: (p2Archetype: ArchetypeId, controlMode: LocalCoopControlMode) => void;
  onClose: () => void;
}

function getConnectedGamepadNames(): string[] {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return [];
  const pads = navigator.getGamepads();
  const names: string[] = [];
  for (let i = 0; i < pads.length; i++) {
    const pad = pads[i];
    if (pad && pad.connected) {
      names.push(pad.id || `Mando ${i + 1}`);
    }
  }
  return names;
}

export const LocalCoopModal: React.FC<LocalCoopModalProps> = ({
  p1Archetype,
  defaultControlMode,
  onStartLocalCoop,
  onClose,
}) => {
  const [p2Archetype, setP2Archetype] = useState<ArchetypeId>(() =>
    p1Archetype === 'crusader' ? 'stalker' : 'crusader'
  );
  const [controlMode, setControlMode] = useState<LocalCoopControlMode>(defaultControlMode);
  const [gamepads, setGamepads] = useState<string[]>(() => getConnectedGamepadNames());

  useEffect(() => {
    const syncPads = () => setGamepads(getConnectedGamepadNames());
    syncPads();
    window.addEventListener('gamepadconnected', syncPads);
    window.addEventListener('gamepaddisconnected', syncPads);
    const interval = window.setInterval(syncPads, 1000);
    return () => {
      window.removeEventListener('gamepadconnected', syncPads);
      window.removeEventListener('gamepaddisconnected', syncPads);
      window.clearInterval(interval);
    };
  }, []);

  const archetypes = Object.values(ARCHETYPES);

  const controlOptions: Array<{
    id: LocalCoopControlMode;
    label: string;
    detail: string;
    icon: React.ReactNode;
  }> = [
    {
      id: 'auto',
      label: 'Teclado + Mando (o 2 Mandos)',
      detail:
        gamepads.length >= 2
          ? '2 mandos detectados: Mando 1 controla a J1 y Mando 2 a J2.'
          : gamepads.length === 1
          ? '1 mando detectado: J1 usa WASD/Ratón y J2 usa el mando conectado.'
          : 'Conecta 1 o 2 mandos USB/Bluetooth, o usa también el teclado compartido.',
      icon: <Gamepad2 className="w-4 h-4 text-sky-400 shrink-0" />,
    },
    {
      id: 'keyboard_split',
      label: 'Mismo Teclado (Sin Mandos)',
      detail: 'J1 usa WASD + G/Espacio/QER y J2 usa Flechas + M/Shift Der./UIO.',
      icon: <Keyboard className="w-4 h-4 text-amber-400 shrink-0" />,
    },
    {
      id: 'dual_touch',
      label: 'Pantalla Táctil Dual (Móvil/Tablet)',
      detail: 'Divide la pantalla en dos zonas táctiles completas para jugar juntos en un solo dispositivo.',
      icon: <Smartphone className="w-4 h-4 text-emerald-400 shrink-0" />,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/82 flex items-center justify-center p-3 sm:p-4">
      <div className="w-full max-w-2xl max-h-[92dvh] flex flex-col bg-[#12151C] border border-[#2C3344] rounded-lg overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-[#232836] flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-sky-400" />
              <h2 className="font-display text-lg sm:text-xl font-bold text-[#E5E0D5]">
                Cooperativo Local (Sin Internet)
              </h2>
            </div>
            <p className="text-xs text-[#949BA8] mt-0.5 flex items-center gap-1.5">
              <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>
                2 jugadores en el mismo dispositivo · Progreso, botín y resurrección compartidos
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar cooperativo local"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md bg-[#181C26] border border-[#2C3344] text-[#949BA8] hover:text-[#E5E0D5] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto crypt-scroll p-4 sm:p-6 space-y-5">
          {/* Squad Preview & P2 Archetype Selection */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-[#D4CFC4] font-medium">
                Jugador 1 (Ámbar):{' '}
                <strong className="text-amber-400 font-display">
                  {ARCHETYPES[p1Archetype].name}
                </strong>
              </span>
              <span className="text-[#949BA8]">Elige el arquetipo del Jugador 2 (Cian)</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {archetypes.map((arch) => {
                const selected = p2Archetype === arch.id;
                return (
                  <button
                    key={arch.id}
                    type="button"
                    onClick={() => setP2Archetype(arch.id)}
                    className={`text-left p-3 rounded-lg border transition-colors cursor-pointer min-h-[44px] ${
                      selected
                        ? 'bg-[#172130] border-sky-400 shadow-[0_0_0_1px_rgba(56,189,248,0.3)]'
                        : 'bg-[#161A23] border-[#262C3C] hover:border-[#3F485E]'
                    }`}
                  >
                    <div className="font-display text-sm font-bold text-[#E5E0D5]">
                      {arch.name}
                    </div>
                    <div className="text-[11px] text-sky-300/90 mt-0.5">{arch.subtitle}</div>
                    <div className="mt-2 pt-1.5 border-t border-[#232836] flex items-center justify-between text-[11px] font-mono-num text-[#949BA8]">
                      <span>Vida {arch.baseStats.maxHp}</span>
                      <span>Daño {arch.baseStats.baseDamage}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Control Mode Selection */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-[#D4CFC4]">Esquema de controles</span>
              <span className="font-mono-num text-[11px] text-[#949BA8]">
                Mandos detectados: {gamepads.length}
              </span>
            </div>

            <div className="space-y-2">
              {controlOptions.map((opt) => {
                const active = controlMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setControlMode(opt.id)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors cursor-pointer flex items-start gap-3 ${
                      active
                        ? 'bg-[#1A202D] border-amber-500/80'
                        : 'bg-[#151922] border-[#262C3C] hover:border-[#3F485E]'
                    }`}
                  >
                    <div className="mt-0.5">{opt.icon}</div>
                    <div className="min-w-0">
                      <div className="text-xs sm:text-sm font-semibold text-[#E5E0D5]">
                        {opt.label}
                      </div>
                      <p className="text-[11px] text-[#949BA8] mt-0.5 leading-relaxed">
                        {opt.detail}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Compact Control Reference */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
            <div className="p-3 rounded-md bg-[#141720] border border-amber-700/35 space-y-1">
              <div className="font-display font-bold text-amber-400">Controles Jugador 1</div>
              {controlMode === 'dual_touch' ? (
                <p className="text-[#C2BDB2] leading-relaxed">
                  Mitad izquierda de la pantalla: Joystick táctil para moverse + botones de ataque, esquiva, habilidades y frasco.
                </p>
              ) : (
                <p className="text-[#C2BDB2] leading-relaxed font-mono-num">
                  Mover: WASD · Atacar: Clic o G · Esquiva: Espacio · Hab.: Q / E / R · Frasco: 1 · Interactuar/Revivir: F
                </p>
              )}
            </div>
            <div className="p-3 rounded-md bg-[#141720] border border-sky-700/35 space-y-1">
              <div className="font-display font-bold text-sky-400">Controles Jugador 2</div>
              {controlMode === 'dual_touch' ? (
                <p className="text-[#C2BDB2] leading-relaxed">
                  Mitad derecha de la pantalla: Joystick táctil propio + botones de ataque automático, esquiva, habilidades y frasco.
                </p>
              ) : (
                <p className="text-[#C2BDB2] leading-relaxed font-mono-num">
                  Mover: Flechas (o Mando) · Atacar: M / Intro / Num0 · Esquiva: Shift Der. · Hab.: U / I / O (o Num1/2/3) · Frasco: P · Revivir: L
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Footer CTA */}
        <div className="px-4 sm:px-6 py-4 border-t border-[#232836] bg-[#101319] flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 py-2 rounded-md bg-[#171B24] border border-[#2C3344] text-xs font-medium text-[#C2BDB2] hover:text-white cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onStartLocalCoop(p2Archetype, controlMode)}
            className="min-h-[46px] px-6 py-2.5 rounded-md bg-sky-500 hover:bg-sky-400 active:bg-sky-300 text-[#0B0C10] font-semibold text-sm transition-colors cursor-pointer"
          >
            Iniciar Cooperativo Local
          </button>
        </div>
      </div>
    </div>
  );
};
