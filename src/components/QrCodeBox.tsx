import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface QrCodeBoxProps {
  value: string;
  size?: number;
  label?: string;
}

export const QrCodeBox: React.FC<QrCodeBoxProps> = ({ value, size = 168, label }) => {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!value) {
      setDataUrl(null);
      return;
    }
    QRCode.toDataURL(value, {
      width: size * 2,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0B0C10',
        light: '#F3EFE6',
      },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!value || !dataUrl) return null;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className="p-2 rounded-md bg-[#F3EFE6] border border-[#2C3344] inline-flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        <img
          src={dataUrl}
          alt={label || 'Código QR de conexión local'}
          className="w-full h-full object-contain select-none"
        />
      </div>
      {label && <span className="text-[11px] text-[#949BA8] text-center">{label}</span>}
    </div>
  );
};
