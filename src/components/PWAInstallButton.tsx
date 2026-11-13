import React, { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWA';

export const PWAInstallButton: React.FC = () => {
  const { canInstall, isInstalled, promptInstall } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled || !canInstall) return null;

  const handleClick = async () => {
    const res = await promptInstall();
    if (res === 'ios') {
      setShowIOSGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex items-center gap-2 min-h-[44px] px-3.5 py-2 text-xs font-medium text-[#E5E0D5] bg-[#141821]/90 border border-[#2C3344] rounded-md hover:border-amber-500/70 hover:text-amber-300 transition-colors cursor-pointer"
      >
        <Download className="w-4 h-4 text-amber-400" />
        <span className="whitespace-nowrap">Instalar App Offline</span>
      </button>

      {showIOSGuide && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#12151C] border border-[#2C3344] rounded-lg p-5 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-display text-base font-bold text-[#E5E0D5]">
                Instalar para jugar sin conexión
              </h3>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                aria-label="Cerrar guía"
                className="min-w-[36px] min-h-[36px] flex items-center justify-center text-[#949BA8] hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-[#C2BDB2] leading-relaxed">
              Añade Criptas del Eclipse a tu pantalla de inicio en Safari para abrirla y jugar cooperativo local aunque no tengas internet:
            </p>
            <ol className="text-xs text-[#D4CFC4] space-y-2 list-decimal list-inside">
              <li>
                Pulsa el botón <Share className="inline w-3.5 h-3.5 text-amber-400 mx-0.5" />{' '}
                <strong>Compartir</strong> en la barra del navegador.
              </li>
              <li>
                Selecciona <strong>Añadir a pantalla de inicio</strong>.
              </li>
              <li>Pulsa <strong>Añadir</strong> arriba a la derecha.</li>
            </ol>
            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className="w-full min-h-[44px] py-2 bg-amber-600 hover:bg-amber-500 text-[#0B0C10] font-semibold text-xs rounded-md cursor-pointer"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
};
