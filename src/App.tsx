import { useEffect, useRef, useState } from 'react';
import { sfx } from './audio/sfx';
import { AltarModal } from './components/AltarModal';
import { CharacterModal } from './components/CharacterModal';
import { CoopLobbyModal } from './components/CoopLobbyModal';
import { DualTouchControls } from './components/DualTouchControls';
import { GameHud } from './components/GameHud';
import { LocalCoopModal } from './components/LocalCoopModal';
import { MobileControls } from './components/MobileControls';
import { RunEndModal } from './components/RunEndModal';
import { TitleScreen } from './components/TitleScreen';
import {
  ARCHETYPES,
  computePlayerStats,
  ETERNAL_BLESSINGS,
  getBlessingCost,
} from './data/gameData';
import { GameEngine } from './engine/GameEngine';
import { ensureOfflineServiceWorker, useOnlineStatus } from './hooks/usePWA';
import { coopClient } from './net/coopClient';
import {
  loadMetaSave,
  purchaseBlessing,
  recordCompletedRun,
  saveMetaSave,
} from './storage/persistence';
import type { CoopChatMessage, CoopRoomSummary } from './types/coop';
import {
  ArchetypeId,
  BlessingId,
  HudSnapshot,
  LocalCoopControlMode,
  MetaSaveData,
  RunRecord,
} from './types/game';

function detectTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(pointer: coarse)').matches ||
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0
  );
}

function getInitialInviteCode(): string {
  if (typeof window === 'undefined') return '';
  const code = new URLSearchParams(window.location.search).get('sala');
  return code ? code.trim().toUpperCase().slice(0, 6) : '';
}

function loadSavedPlayerName(): string {
  try {
    return localStorage.getItem('criptas_coop_name') || 'Aventurero';
  } catch {
    return 'Aventurero';
  }
}

export default function App() {
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const selectedArchetypeRef = useRef<ArchetypeId>('crusader');

  const isOnline = useOnlineStatus();

  const [meta, setMeta] = useState<MetaSaveData>(() => {
    const loaded = loadMetaSave();
    sfx.setMuted(loaded.muted);
    return loaded;
  });
  const [selectedArchetype, setSelectedArchetype] = useState<ArchetypeId>('crusader');
  selectedArchetypeRef.current = selectedArchetype;

  const [showAltar, setShowAltar] = useState(false);
  const [showLocalCoop, setShowLocalCoop] = useState(false);
  const [lastLocalCoopCfg, setLastLocalCoopCfg] = useState<{
    p2Archetype: ArchetypeId;
    controlMode: LocalCoopControlMode;
  } | null>(null);

  const [initialInviteCode] = useState<string>(() => getInitialInviteCode());
  const [showCoopLobby, setShowCoopLobby] = useState<boolean>(() => Boolean(getInitialInviteCode()));
  const [playerName, setPlayerName] = useState<string>(() => loadSavedPlayerName());
  const [coopRooms, setCoopRooms] = useState<CoopRoomSummary[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [wsConnected, setWsConnected] = useState<boolean>(() => coopClient.isConnected());
  const [coopError, setCoopError] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<CoopChatMessage[]>([]);

  const [showCharacter, setShowCharacter] = useState(false);
  const [showTouchControls, setShowTouchControls] = useState<boolean>(() => detectTouchDevice());
  const [hud, setHud] = useState<HudSnapshot | null>(null);

  // Register offline Service Worker on mount
  useEffect(() => {
    ensureOfflineServiceWorker();
  }, []);

  // Initialize isolated 60fps Canvas GameEngine once
  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;

    const canvas = document.createElement('canvas');
    canvas.className = 'block w-full h-full cursor-crosshair touch-game-surface';
    host.appendChild(canvas);

    const engine = new GameEngine(canvas, meta, {
      onHudUpdate: (snapshot) => {
        setHud(snapshot);
      },
      onRunFinished: (record: RunRecord) => {
        setMeta((prev) => {
          const updated = recordCompletedRun(prev, record);
          engine.updateMeta(updated);
          return updated;
        });
      },
    });
    engineRef.current = engine;

    return () => {
      engine.destroy();
      engineRef.current = null;
      if (canvas.parentElement === host) {
        host.removeChild(canvas);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wire WebSocket / P2P cooperative multiplayer listeners
  useEffect(() => {
    const unsubStatus = coopClient.onStatus((ok) => {
      setWsConnected(ok);
    });
    const unsub = coopClient.onMessage((msg) => {
      if (msg.type === 'room:list') {
        setCoopRooms(msg.rooms);
        setLoadingRooms(false);
        return;
      }
      if (msg.type === 'room:error') {
        setCoopError(msg.message);
        return;
      }
      if (msg.type === 'room:joined') {
        setCoopError(null);
        setShowCoopLobby(false);
        setShowLocalCoop(false);
        setShowAltar(false);
        setShowCharacter(false);
        setLastLocalCoopCfg(null);
        setChatMessages([]);
        engineRef.current?.startCoopRun(selectedArchetypeRef.current, msg);
        return;
      }
      if (msg.type === 'chat:message') {
        setChatMessages((prev) => [...prev.slice(-29), msg.message]);
        return;
      }
      engineRef.current?.handleCoopMessage(msg);
    });
    return () => {
      unsubStatus();
      unsub();
    };
  }, []);

  // Fetch room list whenever lobby opens
  useEffect(() => {
    if (!showCoopLobby) return;
    setCoopError(null);
    setLoadingRooms(true);
    coopClient.connect();
    coopClient.send({ type: 'room:list' });
    const fallbackTimer = window.setTimeout(() => {
      setLoadingRooms(false);
    }, 1800);
    return () => window.clearTimeout(fallbackTimer);
  }, [showCoopLobby]);

  // Automatically enable touch overlay if a touch input occurs on hybrid devices
  useEffect(() => {
    const onFirstTouch = () => {
      setShowTouchControls(true);
    };
    window.addEventListener('touchstart', onFirstTouch, { once: true, passive: true });
    return () => window.removeEventListener('touchstart', onFirstTouch);
  }, []);

  // Global keyboard shortcuts (Enter on title, K/Tab for Character tree, Esc for Pause)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement | null)?.tagName;
      if (targetTag === 'INPUT' || targetTag === 'TEXTAREA') return;

      const screen = hud?.screen ?? 'TITLE';

      if (screen === 'TITLE') {
        if (e.code === 'Enter' && !showAltar && !showCoopLobby && !showLocalCoop) {
          e.preventDefault();
          handleStartGame();
        } else if (e.code === 'Escape') {
          if (showAltar) setShowAltar(false);
          if (showCoopLobby) setShowCoopLobby(false);
          if (showLocalCoop) setShowLocalCoop(false);
        }
        return;
      }

      if (e.code === 'KeyK' || e.code === 'Tab') {
        if (screen === 'PLAYING' || screen === 'PAUSED') {
          e.preventDefault();
          setShowCharacter((prev) => {
            const next = !prev;
            engineRef.current?.setScreen(next ? 'PAUSED' : 'PLAYING');
            return next;
          });
        }
        return;
      }

      if (e.code === 'Escape') {
        if (showCharacter) {
          setShowCharacter(false);
          engineRef.current?.setScreen('PLAYING');
        } else if (screen === 'PLAYING') {
          engineRef.current?.setScreen('PAUSED');
        } else if (screen === 'PAUSED') {
          engineRef.current?.setScreen('PLAYING');
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const handleToggleMute = () => {
    setMeta((prev) => {
      const next: MetaSaveData = { ...prev, muted: !prev.muted };
      sfx.setMuted(next.muted);
      saveMetaSave(next);
      return next;
    });
  };

  const handleBuyBlessing = (id: BlessingId) => {
    const def = ETERNAL_BLESSINGS.find((b) => b.id === id);
    if (!def) return;
    const cost = getBlessingCost(def, meta.blessings[id] ?? 0);
    const updated = purchaseBlessing(meta, id, def.maxLevel, cost);
    if (updated) {
      sfx.playPickup(true);
      setMeta(updated);
      engineRef.current?.updateMeta(updated);
    }
  };

  const handleChangePlayerName = (name: string) => {
    setPlayerName(name);
    try {
      localStorage.setItem('criptas_coop_name', name);
    } catch {
      // Ignore storage failure
    }
  };

  const getStartingCoopPayload = () => {
    const arch = ARCHETYPES[selectedArchetype];
    const stats = computePlayerStats(
      selectedArchetype,
      1,
      ['origin', arch.startingNodeId],
      arch.startingWeapon,
      null,
      meta
    );
    return {
      playerName: playerName.trim() || 'Aventurero',
      archetype: selectedArchetype,
      weaponKind: arch.startingWeapon.weaponKind ?? 'greatsword',
      classTitle: arch.name,
      maxHp: stats.maxHp,
    };
  };

  const handleCreateCoopRoom = (isPublic: boolean) => {
    setCoopError(null);
    coopClient.send({
      type: 'room:create',
      ...getStartingCoopPayload(),
      isPublic,
    });
  };

  const handleJoinCoopRoom = (code: string) => {
    setCoopError(null);
    coopClient.send({
      type: 'room:join',
      code,
      ...getStartingCoopPayload(),
    });
  };

  const handleRefreshRooms = () => {
    setLoadingRooms(true);
    coopClient.send({ type: 'room:list' });
    window.setTimeout(() => setLoadingRooms(false), 1500);
  };

  const handleStartGame = () => {
    setLastLocalCoopCfg(null);
    setShowAltar(false);
    setShowCoopLobby(false);
    setShowLocalCoop(false);
    setShowCharacter(false);
    engineRef.current?.startRun(selectedArchetype);
  };

  const handleStartLocalCoop = (p2Archetype: ArchetypeId, controlMode: LocalCoopControlMode) => {
    setLastLocalCoopCfg({ p2Archetype, controlMode });
    setShowAltar(false);
    setShowCoopLobby(false);
    setShowLocalCoop(false);
    setShowCharacter(false);
    if (controlMode === 'dual_touch') {
      setShowTouchControls(true);
    }
    engineRef.current?.startLocalCoopRun(selectedArchetype, p2Archetype, controlMode);
  };

  const currentScreen = hud?.screen ?? 'TITLE';
  const showDualTouch =
    Boolean(hud?.localP2) &&
    currentScreen === 'PLAYING' &&
    !showCharacter &&
    (hud?.localCoopControlMode === 'dual_touch' || showTouchControls);

  return (
    <div className="relative w-screen h-[100dvh] overflow-hidden bg-[#0B0C10]">
      {/* Isolated Canvas Host Container */}
      <div ref={canvasHostRef} className="absolute inset-0 w-full h-full touch-game-surface" />

      {/* Title Screen */}
      {currentScreen === 'TITLE' && (
        <div className="absolute inset-0 z-30">
          <TitleScreen
            selectedArchetype={selectedArchetype}
            onSelectArchetype={setSelectedArchetype}
            onStartGame={handleStartGame}
            onOpenLocalCoop={() => setShowLocalCoop(true)}
            onOpenCoop={() => setShowCoopLobby(true)}
            onOpenAltar={() => setShowAltar(true)}
            isOnline={isOnline}
            meta={meta}
            onToggleMute={handleToggleMute}
          />
          {showAltar && (
            <AltarModal
              meta={meta}
              onBuyBlessing={handleBuyBlessing}
              onClose={() => setShowAltar(false)}
            />
          )}
          {showLocalCoop && (
            <LocalCoopModal
              p1Archetype={selectedArchetype}
              defaultControlMode={detectTouchDevice() ? 'dual_touch' : 'auto'}
              onStartLocalCoop={handleStartLocalCoop}
              onClose={() => setShowLocalCoop(false)}
            />
          )}
          {showCoopLobby && (
            <CoopLobbyModal
              playerName={playerName}
              onChangePlayerName={handleChangePlayerName}
              rooms={coopRooms}
              loadingRooms={loadingRooms}
              wsConnected={wsConnected}
              errorMessage={coopError}
              initialJoinCode={initialInviteCode}
              getHostPayload={getStartingCoopPayload}
              onRefreshRooms={handleRefreshRooms}
              onCreateRoom={handleCreateCoopRoom}
              onJoinRoom={handleJoinCoopRoom}
              onClose={() => setShowCoopLobby(false)}
            />
          )}
        </div>
      )}

      {/* Active Low-Occlusion HUD */}
      {hud && currentScreen !== 'TITLE' && (
        <GameHud
          hud={hud}
          muted={meta.muted}
          showTouchControls={showDualTouch || (showTouchControls && !hud.localP2)}
          chatMessages={chatMessages}
          onSendChat={(text) => coopClient.send({ type: 'chat:send', text })}
          onToggleTouchControls={() => setShowTouchControls((v) => !v)}
          onToggleMute={handleToggleMute}
          onOpenCharacter={() => {
            setShowCharacter(true);
            engineRef.current?.setScreen('PAUSED');
          }}
          onPause={() => engineRef.current?.setScreen('PAUSED')}
        />
      )}

      {/* Dual-Player Touch Controls for Local Offline Co-op */}
      {hud && showDualTouch && (
        <DualTouchControls
          hud={hud}
          onP1Move={(dx, dy) => engineRef.current?.setTouchMove(dx, dy)}
          onP1AttackHold={(held) => engineRef.current?.setTouchAttackHeld(held)}
          onP1Dash={() => engineRef.current?.triggerTouchDash()}
          onP1Skill={(slot) => engineRef.current?.triggerTouchSkill(slot)}
          onP1Flask={() => engineRef.current?.triggerTouchFlask()}
          onP1Interact={() => engineRef.current?.triggerTouchInteract()}
          onP2Move={(dx, dy) => engineRef.current?.setP2TouchMove(dx, dy)}
          onP2AttackHold={(held) => engineRef.current?.setP2TouchAttackHeld(held)}
          onP2Dash={() => engineRef.current?.triggerP2TouchDash()}
          onP2Skill={(slot) => engineRef.current?.triggerP2TouchSkill(slot)}
          onP2Flask={() => engineRef.current?.triggerP2TouchFlask()}
          onP2Interact={() => engineRef.current?.triggerP2TouchInteract()}
        />
      )}

      {/* Single-Player Multi-Touch Virtual Joystick & Action Buttons */}
      {hud &&
        !hud.localP2 &&
        currentScreen === 'PLAYING' &&
        showTouchControls &&
        !showCharacter &&
        !hud.coop?.isDowned && (
          <MobileControls
            hud={hud}
            onMove={(dx, dy) => engineRef.current?.setTouchMove(dx, dy)}
            onAttackHold={(held) => engineRef.current?.setTouchAttackHeld(held)}
            onDash={() => engineRef.current?.triggerTouchDash()}
            onSkill={(slot) => engineRef.current?.triggerTouchSkill(slot)}
            onFlask={() => engineRef.current?.triggerTouchFlask()}
            onInteract={() => engineRef.current?.triggerTouchInteract()}
          />
        )}

      {/* Hybrid Skill Tree & Equipment Modal */}
      {hud && showCharacter && (
        <CharacterModal
          hud={hud}
          onUnlockNode={(nodeId, playerNum) => engineRef.current?.unlockSkillNode(nodeId, playerNum)}
          onAssignSlot={(slot, skillId, playerNum) =>
            engineRef.current?.assignSkillSlot(slot, skillId, playerNum)
          }
          onEquipItem={(itemId, playerNum) => engineRef.current?.equipItem(itemId, playerNum)}
          onSalvageItem={(itemId, playerNum) => engineRef.current?.salvageItem(itemId, playerNum)}
          onClose={() => {
            setShowCharacter(false);
            engineRef.current?.setScreen('PLAYING');
          }}
        />
      )}

      {/* Pause / Victory / Game Over Modal */}
      {hud &&
        !showCharacter &&
        (currentScreen === 'PAUSED' ||
          currentScreen === 'VICTORY' ||
          currentScreen === 'GAME_OVER') && (
          <RunEndModal
            hud={hud}
            onResume={() => engineRef.current?.setScreen('PLAYING')}
            onContinueEndless={() => engineRef.current?.continueEndless()}
            onRestart={() => {
              if (hud.localP2 && lastLocalCoopCfg) {
                handleStartLocalCoop(lastLocalCoopCfg.p2Archetype, lastLocalCoopCfg.controlMode);
              } else {
                handleStartGame();
              }
            }}
            onReturnTitle={() => {
              setShowCharacter(false);
              engineRef.current?.setScreen('TITLE');
            }}
          />
        )}
    </div>
  );
}
