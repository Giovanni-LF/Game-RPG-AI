import React, { useRef, useState } from 'react';
import {
  Check,
  Cloud,
  CloudDownload,
  CloudUpload,
  Database,
  Download,
  Edit3,
  HardDrive,
  RotateCcw,
  Server,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { ServerSyncState, StorageHealthStatus } from '../storage/persistence';
import { SaveSlotId, SaveSlotSummary } from '../types/game';

interface SaveManagerModalProps {
  activeSlotId: SaveSlotId;
  slots: SaveSlotSummary[];
  storageHealth: StorageHealthStatus;
  serverSync: ServerSyncState;
  serverBaseUrl: string;
  onChangeSyncKey: (newKey: string) => Promise<{ ok: boolean; message: string }>;
  onPushToServer: () => Promise<{ ok: boolean; message: string }>;
  onPullFromServer: () => Promise<{ ok: boolean; message: string }>;
  onDeleteFromServer: () => Promise<{ ok: boolean; message: string }>;
  onSelectSlot: (slotId: SaveSlotId) => void;
  onRenameSlot: (slotId: SaveSlotId, name: string) => void;
  onExportSlot: (slotId: SaveSlotId) => void;
  onImportSlot: (slotId: SaveSlotId, rawJson: string) => { ok: boolean; error?: string };
  onClearActiveRun: (slotId: SaveSlotId) => void;
  onResetSlot: (slotId: SaveSlotId) => void;
  onClose: () => void;
}

function formatSavedDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!ms || ms <= 0) return 'Sin registros';
  try {
    return new Intl.DateTimeFormat('es-ES', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ms));
  } catch {
    return 'Guardado';
  }
}

export const SaveManagerModal: React.FC<SaveManagerModalProps> = ({
  activeSlotId,
  slots,
  storageHealth,
  serverSync,
  serverBaseUrl,
  onChangeSyncKey,
  onPushToServer,
  onPullFromServer,
  onDeleteFromServer,
  onSelectSlot,
  onRenameSlot,
  onExportSlot,
  onImportSlot,
  onClearActiveRun,
  onResetSlot,
  onClose,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importTargetSlot, setImportTargetSlot] = useState<SaveSlotId>('slot1');
  const [editingSlot, setEditingSlot] = useState<SaveSlotId | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftSyncKey, setDraftSyncKey] = useState(serverSync.syncKey);
  const [serverBusy, setServerBusy] = useState(false);
  const [confirmServerDelete, setConfirmServerDelete] = useState(false);
  const [confirmResetSlot, setConfirmResetSlot] = useState<SaveSlotId | null>(null);
  const [confirmDiscardRunSlot, setConfirmDiscardRunSlot] = useState<SaveSlotId | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const handleStartRename = (slot: SaveSlotSummary) => {
    setEditingSlot(slot.id);
    setDraftName(slot.name);
    setConfirmResetSlot(null);
    setConfirmDiscardRunSlot(null);
  };

  const handleSaveRename = (slotId: SaveSlotId) => {
    onRenameSlot(slotId, draftName);
    setEditingSlot(null);
    setFeedback({ kind: 'ok', text: 'Nombre de crónica actualizado.' });
  };

  const handleTriggerImport = (slotId: SaveSlotId) => {
    setImportTargetSlot(slotId);
    setFeedback(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const res = onImportSlot(importTargetSlot, text);
      if (res.ok) {
        setFeedback({
          kind: 'ok',
          text: `Respaldo restaurado correctamente en la ranura seleccionada.`,
        });
      } else {
        setFeedback({
          kind: 'err',
          text: res.error || 'El archivo no es un respaldo válido.',
        });
      }
    } catch {
      setFeedback({
        kind: 'err',
        text: 'No se pudo leer el archivo desde el dispositivo.',
      });
    }
  };

  const handleApplySyncKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerBusy(true);
    const res = await onChangeSyncKey(draftSyncKey);
    setServerBusy(false);
    setFeedback({ kind: res.ok ? 'ok' : 'err', text: res.message });
  };

  const handleServerAction = async (fn: () => Promise<{ ok: boolean; message: string }>) => {
    setServerBusy(true);
    const res = await fn();
    setServerBusy(false);
    setFeedback({ kind: res.ok ? 'ok' : 'err', text: res.message });
  };

  const syncStatusLabel =
    serverSync.status === 'syncing'
      ? 'Sincronizando...'
      : serverSync.status === 'synced'
      ? 'Sincronizado en servidor'
      : serverSync.status === 'offline'
      ? 'Sin conexión al servidor (guardado local activo)'
      : serverSync.status === 'error'
      ? serverSync.lastError || 'Error de sincronización'
      : 'Listo para sincronizar';

  const syncStatusColor =
    serverSync.status === 'synced'
      ? 'text-emerald-400'
      : serverSync.status === 'syncing'
      ? 'text-sky-300'
      : serverSync.status === 'error'
      ? 'text-red-400'
      : 'text-amber-300';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center sm:p-4 md:p-6">
      <div className="w-full max-w-3xl h-[100dvh] sm:h-auto sm:max-h-[90dvh] bg-[#12151C] sm:border border-[#2C3344] sm:rounded-lg flex flex-col overflow-hidden">
        {/* Hidden File Input for Offline JSON Restore */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleFileChange}
          className="hidden"
        />

        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-[#232836] bg-[#10131A]">
          <div className="min-w-0">
            <h2 className="font-display text-lg sm:text-xl font-bold text-[#E5E0D5]">
              Ranuras de Guardado y Respaldos
            </h2>
            <p className="text-xs text-[#949BA8] mt-0.5">
              3 crónicas independientes con guardado local redundante, respaldo .json y sincronización en server.ts
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar gestor de guardado"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[#949BA8] hover:text-white rounded-md hover:bg-[#1C212D] transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Storage Health Strip */}
        <div className="px-4 sm:px-6 py-2.5 bg-[#0E1117] border-b border-[#232836] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#949BA8]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5 text-emerald-400">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Integridad FNV-1a / SHA-256</span>
            </span>
            <span
              className={`inline-flex items-center gap-1.5 ${
                storageHealth.localStorageOk ? 'text-[#C2BDB2]' : 'text-amber-400'
              }`}
            >
              <HardDrive className="w-3.5 h-3.5" />
              <span>
                LocalStorage ({storageHealth.localStorageOk ? 'OK' : 'Solo memoria'})
              </span>
            </span>
            <span
              className={`inline-flex items-center gap-1.5 ${
                storageHealth.indexedDbOk ? 'text-sky-300' : 'text-[#949BA8]'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              <span>
                IndexedDB ({storageHealth.indexedDbOk ? 'OK' : 'N/D'})
              </span>
            </span>
            <span className={`inline-flex items-center gap-1.5 ${syncStatusColor}`}>
              <Server className="w-3.5 h-3.5" />
              <span>{syncStatusLabel}</span>
            </span>
          </div>
          <span className="font-mono-num">
            Local: {storageHealth.lastSavedIso ? formatSavedDate(storageHealth.lastSavedIso) : 'Inicial'}
          </span>
        </div>

        {/* Feedback banner */}
        {feedback && (
          <div
            className={`mx-4 sm:mx-6 mt-4 px-3.5 py-2.5 rounded-md border text-xs flex items-center justify-between gap-2 ${
              feedback.kind === 'ok'
                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                : 'bg-red-950/40 border-red-500/40 text-red-300'
            }`}
          >
            <span>{feedback.text}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-current opacity-70 hover:opacity-100 cursor-pointer px-1"
            >
              ×
            </button>
          </div>
        )}

        {/* Slots & Server Sync Body */}
        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto crypt-scroll flex-1">
          {/* Server Sync Box */}
          <div className="p-4 rounded-lg bg-[#10141D] border border-sky-500/35 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Cloud className="w-4 h-4 text-sky-400" />
                <h3 className="font-display text-sm font-bold text-[#E5E0D5]">
                  Guardado en Servidor (server.ts)
                </h3>
              </div>
              <span className="text-[11px] font-mono-num text-[#949BA8] truncate max-w-full">
                {serverBaseUrl}/api/saves/{serverSync.syncKey}
              </span>
            </div>

            <p className="text-xs text-[#949BA8] leading-relaxed">
              Tus 3 ranuras se respaldan automáticamente en disco del servidor bajo tu{' '}
              <strong className="text-[#E5E0D5]">Código de Crónica</strong>. Usa el mismo código en otro dispositivo conectado al servidor o hotspot para sincronizar tus partidas.
            </p>

            <form onSubmit={handleApplySyncKey} className="flex flex-wrap items-center gap-2">
              <label htmlFor="server-sync-key" className="sr-only">
                Código de Crónica en el servidor
              </label>
              <input
                id="server-sync-key"
                type="text"
                maxLength={48}
                value={draftSyncKey}
                onChange={(e) => setDraftSyncKey(e.target.value.toUpperCase())}
                placeholder="ECLIPSE-XXXXXX"
                className="flex-1 min-w-[170px] min-h-[40px] px-3 py-1.5 text-xs font-mono-num bg-[#0B0C10] border border-[#2C3344] focus:border-sky-400 rounded-md text-[#E5E0D5] focus:outline-none"
              />
              <button
                type="submit"
                disabled={serverBusy}
                className="min-h-[40px] px-3.5 py-1.5 bg-[#1B2538] hover:bg-[#24324B] text-sky-300 border border-sky-500/40 text-xs font-semibold rounded-md transition-colors cursor-pointer disabled:opacity-50"
              >
                Usar Código y Sincronizar
              </button>
            </form>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={serverBusy}
                  onClick={() => handleServerAction(onPushToServer)}
                  className="min-h-[40px] px-3 py-1.5 text-xs font-semibold text-[#E5E0D5] bg-[#182230] hover:bg-[#213044] border border-emerald-500/40 rounded-md inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <CloudUpload className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Subir al Servidor</span>
                </button>
                <button
                  type="button"
                  disabled={serverBusy}
                  onClick={() => handleServerAction(onPullFromServer)}
                  className="min-h-[40px] px-3 py-1.5 text-xs font-semibold text-[#E5E0D5] bg-[#182230] hover:bg-[#213044] border border-sky-500/40 rounded-md inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <CloudDownload className="w-3.5 h-3.5 text-sky-400" />
                  <span>Descargar del Servidor</span>
                </button>
              </div>

              <div className="flex items-center gap-2 text-[11px] font-mono-num text-[#949BA8]">
                {serverSync.lastServerSyncIso && (
                  <span>Sync: {formatSavedDate(serverSync.lastServerSyncIso)}</span>
                )}
                {confirmServerDelete ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={serverBusy}
                      onClick={() => {
                        setConfirmServerDelete(false);
                        void handleServerAction(onDeleteFromServer);
                      }}
                      className="min-h-[34px] px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white text-[11px] font-semibold rounded cursor-pointer"
                    >
                      Confirmar borrado
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmServerDelete(false)}
                      className="min-h-[34px] px-2.5 py-1 bg-[#1B202C] text-[#C2BDB2] text-[11px] rounded cursor-pointer"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={serverBusy}
                    onClick={() => setConfirmServerDelete(true)}
                    className="min-h-[34px] px-2.5 py-1 text-[11px] text-[#949BA8] hover:text-red-300 bg-[#151822] border border-[#262C3B] rounded cursor-pointer"
                  >
                    Borrar en Servidor
                  </button>
                )}
              </div>
            </div>
          </div>
          {slots.map((slot) => {
            const isActive = slot.id === activeSlotId;
            const isEditing = editingSlot === slot.id;
            const hasData =
              slot.soulShards > 0 ||
              slot.bestFloor > 0 ||
              slot.totalKills > 0 ||
              slot.blessingsTotal > 0 ||
              slot.hasActiveRun;

            return (
              <div
                key={slot.id}
                className={`p-4 rounded-lg border transition-colors ${
                  isActive
                    ? 'bg-[#171C28] border-amber-500/70'
                    : 'bg-[#151822] border-[#262C3B] hover:border-[#394258]'
                }`}
              >
                {/* Top row: name + active badge + edit */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {isEditing ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleSaveRename(slot.id);
                        }}
                        className="flex items-center gap-2"
                      >
                        <input
                          type="text"
                          maxLength={26}
                          value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                          autoFocus
                          className="px-2.5 py-1.5 text-sm bg-[#0B0C10] border border-amber-500/60 rounded text-[#E5E0D5] focus:outline-none w-44 sm:w-56"
                        />
                        <button
                          type="submit"
                          className="min-h-[36px] px-3 py-1 bg-amber-600 hover:bg-amber-500 text-[#0B0C10] font-semibold text-xs rounded cursor-pointer inline-flex items-center gap-1"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Guardar</span>
                        </button>
                      </form>
                    ) : (
                      <>
                        <h3 className="font-display text-base font-bold text-[#E5E0D5] truncate">
                          {slot.name}
                        </h3>
                        <button
                          type="button"
                          onClick={() => handleStartRename(slot)}
                          aria-label={`Renombrar ${slot.name}`}
                          className="p-1.5 text-[#949BA8] hover:text-[#E5E0D5] rounded hover:bg-[#222838] transition-colors cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                    {isActive && (
                      <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded">
                        Activa
                      </span>
                    )}
                  </div>

                  <div className="text-[11px] font-mono-num text-[#949BA8]">
                    {hasData ? `Actualizado: ${formatSavedDate(slot.updatedAtIso)}` : 'Ranura vacía'}
                  </div>
                </div>

                {/* Meta Stats */}
                <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono-num text-[#C2BDB2]">
                  <span>Almas: {slot.soulShards}</span>
                  <span className="text-[#475066]">·</span>
                  <span>Piso máx: {slot.bestFloor}</span>
                  <span className="text-[#475066]">·</span>
                  <span>Abatidos: {slot.totalKills}</span>
                  <span className="text-[#475066]">·</span>
                  <span>Bendiciones: {slot.blessingsTotal}</span>
                </div>

                {/* Suspended Run Box */}
                {slot.activeRunSummary && (
                  <div className="mt-3 p-3 rounded bg-[#10141D] border border-amber-500/35 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-amber-300">
                          Incursión en curso · Piso {slot.activeRunSummary.floorNumber}
                        </span>
                        <span className="text-[#949BA8]">({slot.activeRunSummary.floorName})</span>
                        {slot.activeRunSummary.localCoopMode && (
                          <span className="px-1.5 py-0.5 text-[10px] bg-sky-500/15 border border-sky-500/40 text-sky-300 rounded">
                            2J Local
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#949BA8] font-mono-num">
                        {slot.activeRunSummary.p1ClassTitle} Nv.{slot.activeRunSummary.p1Level} ·{' '}
                        {slot.activeRunSummary.kills} abatidos ·{' '}
                        {formatSavedDate(slot.activeRunSummary.savedAtIso)}
                      </div>
                    </div>

                    {confirmDiscardRunSlot === slot.id ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            onClearActiveRun(slot.id);
                            setConfirmDiscardRunSlot(null);
                            setFeedback({ kind: 'ok', text: 'Incursión en curso descartada.' });
                          }}
                          className="min-h-[34px] px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white text-[11px] font-semibold rounded cursor-pointer"
                        >
                          Confirmar
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDiscardRunSlot(null)}
                          className="min-h-[34px] px-2.5 py-1 bg-[#1C2230] text-[#C2BDB2] text-[11px] rounded cursor-pointer"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDiscardRunSlot(slot.id);
                          setConfirmResetSlot(null);
                        }}
                        className="min-h-[34px] px-2.5 py-1 text-[11px] text-[#949BA8] hover:text-red-300 bg-[#171C28] border border-[#2C3344] rounded inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Descartar incursión</span>
                      </button>
                    )}
                  </div>
                )}

                {/* Action Row */}
                <div className="mt-3.5 pt-3 border-t border-[#222836] flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={isActive}
                      onClick={() => {
                        onSelectSlot(slot.id);
                        setFeedback({ kind: 'ok', text: `Ranura "${slot.name}" activada.` });
                      }}
                      className={`min-h-[40px] px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                        isActive
                          ? 'bg-amber-600/20 text-amber-300 border border-amber-500/40 cursor-default'
                          : 'bg-amber-600 hover:bg-amber-500 text-[#0B0C10] cursor-pointer'
                      }`}
                    >
                      {isActive ? 'Ranura Seleccionada' : 'Usar esta Ranura'}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        onExportSlot(slot.id);
                        setFeedback({
                          kind: 'ok',
                          text: `Respaldo .json exportado para "${slot.name}".`,
                        });
                      }}
                      className="min-h-[40px] px-3 py-1.5 text-xs font-medium text-[#E5E0D5] bg-[#1B202C] hover:bg-[#242B3B] border border-[#2E3648] rounded-md transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Exportar .json</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleTriggerImport(slot.id)}
                      className="min-h-[40px] px-3 py-1.5 text-xs font-medium text-[#E5E0D5] bg-[#1B202C] hover:bg-[#242B3B] border border-[#2E3648] rounded-md transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5 text-sky-400" />
                      <span>Importar .json</span>
                    </button>
                  </div>

                  {hasData && (
                    <div>
                      {confirmResetSlot === slot.id ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              onResetSlot(slot.id);
                              setConfirmResetSlot(null);
                              setFeedback({
                                kind: 'ok',
                                text: `Ranura "${slot.name}" reiniciada por completo.`,
                              });
                            }}
                            className="min-h-[40px] px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold rounded-md cursor-pointer"
                          >
                            Confirmar reinicio
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmResetSlot(null)}
                            className="min-h-[40px] px-3 py-1.5 bg-[#1B202C] text-[#C2BDB2] text-xs rounded-md cursor-pointer"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmResetSlot(slot.id);
                            setConfirmDiscardRunSlot(null);
                          }}
                          className="min-h-[40px] px-3 py-1.5 text-xs text-[#949BA8] hover:text-red-300 bg-[#141720] hover:bg-[#1E1A22] border border-[#262C3B] rounded-md transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Reiniciar</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
