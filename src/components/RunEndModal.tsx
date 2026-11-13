import React from 'react';
import { HudSnapshot } from '../types/game';

interface RunEndModalProps {
  hud: HudSnapshot;
  onResume: () => void;
  onContinueEndless: () => void;
  onRestart: () => void;
  onReturnTitle: () => void;
}

export const RunEndModal: React.FC<RunEndModalProps> = ({
  hud,
  onResume,
  onContinueEndless,
  onRestart,
  onReturnTitle,
}) => {
  const isPause = hud.screen === 'PAUSED';
  const isVictory = hud.screen === 'VICTORY';
  const isOnlineCoop = Boolean(hud.coop);
  const isLocalCoop = Boolean(hud.localP2);
  const isAnyCoop = isOnlineCoop || isLocalCoop;

  const title = isPause
    ? isOnlineCoop
      ? 'Menú de Sala'
      : isLocalCoop
      ? 'Cooperativo Local Pausado'
      : 'Incursión Pausada'
    : isVictory
    ? 'Santuario Conquistado'
    : isAnyCoop
    ? 'Escuadra Derrotada'
    : 'Has Caído en la Cripta';

  const subtitle = isPause
    ? isOnlineCoop
      ? `Sala #${hud.coop?.roomCode} · El combate cooperativo continúa en tiempo real mientras gestionas tu menú.`
      : isLocalCoop
      ? 'Ambos héroes aguardan en la penumbra de la cripta.'
      : 'El eco de la batalla aguarda tu regreso.'
    : isVictory
    ? 'Has superado el tercer sello del eclipse. Puedes descender al abismo infinito o asegurar tus Fragmentos de Alma.'
    : 'Tu espíritu regresa al Altar Eterno con los Fragmentos de Alma recolectados.';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="w-full max-w-md max-h-[92dvh] overflow-y-auto crypt-scroll bg-[#12151C] border border-[#2C3344] rounded-lg p-5 sm:p-6 space-y-5">
        <div className="space-y-1.5">
          <h2
            className={`font-display text-2xl font-bold ${
              isVictory ? 'text-amber-400' : isPause ? 'text-[#E5E0D5]' : 'text-red-400'
            }`}
          >
            {title}
          </h2>
          <p className="text-xs text-[#949BA8] leading-relaxed">{subtitle}</p>
        </div>

        {/* Summary Metrics */}
        <div className="grid grid-cols-2 gap-2.5 text-xs">
          <div className="p-3 rounded bg-[#181C26] border border-[#232836]">
            <div className="text-[#949BA8]">{isLocalCoop ? 'Escuadra forjada' : 'Clase forjada'}</div>
            <div className="font-display font-semibold text-[#E5E0D5] mt-0.5 truncate">
              {isLocalCoop && hud.localP2
                ? `J1 ${hud.classTitle} · J2 ${hud.localP2.classTitle}`
                : hud.classTitle}
            </div>
          </div>
          <div className="p-3 rounded bg-[#181C26] border border-[#232836]">
            <div className="text-[#949BA8]">Piso alcanzado</div>
            <div className="font-mono-num font-semibold text-[#E5E0D5] mt-0.5">
              Piso {hud.floorNumber} · Nv. {hud.level}
            </div>
          </div>
          <div className="p-3 rounded bg-[#181C26] border border-[#232836]">
            <div className="text-[#949BA8]">Enemigos abatidos</div>
            <div className="font-mono-num font-semibold text-[#E5E0D5] mt-0.5">
              {hud.kills}
            </div>
          </div>
          <div className="p-3 rounded bg-[#181C26] border border-[#232836]">
            <div className="text-[#949BA8]">Almas aseguradas</div>
            <div className="font-mono-num font-semibold text-violet-400 mt-0.5">
              +{Math.max(4, hud.soulsThisRun + Math.floor(hud.kills * 0.4))} Fragmentos
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2.5 pt-1">
          {isPause && (
            <button
              type="button"
              onClick={onResume}
              className="w-full min-h-[46px] py-2.5 bg-amber-600 hover:bg-amber-500 text-[#0B0C10] font-semibold text-sm rounded-md transition-colors cursor-pointer"
            >
              Reanudar Combate
            </button>
          )}
          {isVictory && (
            <button
              type="button"
              onClick={onContinueEndless}
              className="w-full min-h-[46px] py-2.5 bg-amber-600 hover:bg-amber-500 text-[#0B0C10] font-semibold text-sm rounded-md transition-colors cursor-pointer"
            >
              Descender al Abismo Infinito (Piso {hud.floorNumber + 1})
            </button>
          )}
          {!isOnlineCoop && (
            <button
              type="button"
              onClick={onRestart}
              className={`w-full min-h-[46px] py-2.5 font-semibold text-sm rounded-md transition-colors cursor-pointer ${
                !isPause && !isVictory
                  ? 'bg-amber-600 hover:bg-amber-500 text-[#0B0C10]'
                  : 'bg-[#181C26] hover:bg-[#222836] text-[#E5E0D5] border border-[#2C3344]'
              }`}
            >
              Nueva Incursión
            </button>
          )}
          <button
            type="button"
            onClick={onReturnTitle}
            className="w-full min-h-[44px] py-2.5 bg-[#12151C] hover:bg-[#181C26] text-[#949BA8] hover:text-[#E5E0D5] border border-[#232836] text-xs font-medium rounded-md transition-colors cursor-pointer"
          >
            {isOnlineCoop ? 'Abandonar Sala y Volver al Santuario' : 'Volver al Santuario Inicial'}
          </button>
        </div>
      </div>
    </div>
  );
};
