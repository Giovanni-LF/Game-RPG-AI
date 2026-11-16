import { useEffect, useRef, useState } from 'react';
import { Trophy } from 'lucide-react';
import { music } from './audio/music';
import { sfx } from './audio/sfx';
import { AchievementsModal } from './components/AchievementsModal';
import { AltarModal } from './components/AltarModal';
import { BestiaryModal } from './components/BestiaryModal';
import { CharacterModal } from './components/CharacterModal';
import { CoopLobbyModal } from './components/CoopLobbyModal';
import { CosmeticsShopModal } from './components/CosmeticsShopModal';
import { DualTouchControls } from './components/DualTouchControls';
import { GameHud } from './components/GameHud';
import { LocalCoopModal } from './components/LocalCoopModal';
import { MobileControls } from './components/MobileControls';
import { PvpArenaModal } from './components/PvpArenaModal';
import { RunEndModal } from './components/RunEndModal';
import { SaveManagerModal } from './components/SaveManagerModal';
import { TitleScreen } from './components/TitleScreen';
import {
  ARCHETYPES,
  computePlayerStats,
  ETERNAL_BLESSINGS,
  getBlessingCost,
} from './data/gameData';
import { GameEngine } from './engine/GameEngine';
import { ensureOfflineServiceWorker, useOnlineStatus } from './hooks/usePWA';
import { coopClient, type CoopTelemetry } from './net/coopClient';
import { getOrCreateAdminAgentClientId, RemoteAdminAgent } from './net/remoteAdminAgent';
import type { GameClientStateReport, RemoteAdminCommand } from './shared/adminProtocol';
import {
  APP_VERSION,
  generateRandomRunSeed,
  normalizeSeedInput,
} from './shared/protocol';
import { didPvpRankIncrease } from './shared/pvp';
import {
  AchievementStatUpdate,
  adminGrantSoulShards,
  adminMaxAllBlessings,
  adminResetMetaProgress,
  adminSetPvpStats,
  adminSetSoulShards,
  adminUnlockAllAchievements,
  adminUnlockAllBestiary,
  adminUnlockAllCosmetics,
  clearActiveRunCheckpoint,
  deleteServerSaveRemote,
  equipCosmetic,
  evaluateAndUnlockAchievements,
  exportSlotBackupJson,
  getActiveProfile,
  getSaveSlotSummaries,
  getServerSyncKey,
  getServerSyncState,
  getStorageHealthStatus,
  hydrateSaveStoreFromIndexedDB,
  importSlotBackupJson,
  onServerSyncChange,
  pullSaveStoreFromServer,
  purchaseBlessing,
  purchaseCosmetic,
  pushSaveStoreToServer,
  recordBestiaryProgress,
  recordCompletedRun,
  recordLocalPvpResult,
  renameSaveSlot,
  resetSaveSlot,
  saveActiveRunCheckpoint,
  saveMetaSave,
  ServerSyncState,
  setActiveSlotId,
  setServerSyncKey,
  setServerUrlResolver,
  StorageHealthStatus,
  syncSaveStoreWithServer,
} from './storage/persistence';
import type {
  CoopChatMessage,
  CoopHeroBuildState,
  CoopRoomSummary,
  PvpRoomSummary,
} from './types/coop';
import {
  AchievementDef,
  AdminFlags,
  ArchetypeId,
  BlessingId,
  CosmeticCategory,
  HudSnapshot,
  LocalCoopControlMode,
  MetaSaveData,
  PvpMatchResult,
  RunRecord,
  SaveProfileData,
  SaveSlotId,
  SaveSlotSummary,
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

const RUN_SEED_STORAGE_KEY = 'criptas_run_seed_v1';

function loadSavedRunSeed(): string {
  try {
    const saved = localStorage.getItem(RUN_SEED_STORAGE_KEY);
    if (saved && saved.trim()) return saved.trim().toUpperCase().slice(0, 20);
  } catch {
    // Ignore storage error
  }
  const initial = generateRandomRunSeed().label;
  try {
    localStorage.setItem(RUN_SEED_STORAGE_KEY, initial);
  } catch {
    // Ignore storage error
  }
  return initial;
}

export default function App() {
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const selectedArchetypeRef = useRef<ArchetypeId>('crusader');

  const isOnline = useOnlineStatus();

  const [activeProfile, setActiveProfile] = useState<SaveProfileData>(() => {
    const prof = getActiveProfile();
    sfx.setMuted(prof.meta.muted);
    music.setMuted(prof.meta.muted);
    return prof;
  });
  const [meta, setMeta] = useState<MetaSaveData>(() => activeProfile.meta);
  const [slotSummaries, setSlotSummaries] = useState<SaveSlotSummary[]>(() =>
    getSaveSlotSummaries()
  );
  const [storageHealth, setStorageHealth] = useState<StorageHealthStatus>(() =>
    getStorageHealthStatus()
  );
  const [serverSync, setServerSync] = useState<ServerSyncState>(() => getServerSyncState());
  const [selectedArchetype, setSelectedArchetype] = useState<ArchetypeId>('crusader');
  selectedArchetypeRef.current = selectedArchetype;

  const [showAltar, setShowAltar] = useState(false);
  const [showShop, setShowShop] = useState(false);
  const [showBestiary, setShowBestiary] = useState(false);
  const [showAchievements, setShowAchievements] = useState(false);
  const [achievementToasts, setAchievementToasts] = useState<AchievementDef[]>([]);
  const [recentRankUp, setRecentRankUp] = useState<{ eloBefore: number; eloAfter: number } | null>(null);
  const [adminFlags, setAdminFlags] = useState<AdminFlags>({
    godMode: false,
    infiniteMana: false,
    zeroCooldowns: false,
    oneHitKill: false,
    revealMinimap: false,
    freezeEnemies: false,
    autoLoot: false,
    showHitboxes: false,
    speedMultiplier: 1,
    damageMultiplier: 1,
  });
  const [showSaveManager, setShowSaveManager] = useState(false);
  const [showLocalCoop, setShowLocalCoop] = useState(false);
  const [lastLocalCoopCfg, setLastLocalCoopCfg] = useState<{
    p2Archetype: ArchetypeId;
    controlMode: LocalCoopControlMode;
  } | null>(null);

  const [initialInviteCode] = useState<string>(() => getInitialInviteCode());
  const [showCoopLobby, setShowCoopLobby] = useState<boolean>(() => Boolean(getInitialInviteCode()));
  const [showPvpModal, setShowPvpModal] = useState(false);
  const [playerName, setPlayerName] = useState<string>(() => loadSavedPlayerName());
  const [coopRooms, setCoopRooms] = useState<CoopRoomSummary[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [pvpRooms, setPvpRooms] = useState<PvpRoomSummary[]>([]);
  const [loadingPvpRooms, setLoadingPvpRooms] = useState(false);
  const [wsConnected, setWsConnected] = useState<boolean>(() => coopClient.isConnected());
  const [coopTelemetry, setCoopTelemetry] = useState<CoopTelemetry>(() => coopClient.getTelemetry());
  const [coopError, setCoopError] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<CoopChatMessage[]>([]);
  const [runSeedInput, setRunSeedInput] = useState<string>(() => loadSavedRunSeed());

  const updateRunSeed = (val: string) => {
    const clean = val.toUpperCase().slice(0, 24);
    setRunSeedInput(clean);
    try {
      if (clean.trim()) {
        localStorage.setItem(RUN_SEED_STORAGE_KEY, clean.trim());
      }
    } catch {
      // Ignore storage error
    }
  };

  const [showCharacter, setShowCharacter] = useState(false);
  const [showTouchControls, setShowTouchControls] = useState<boolean>(() => detectTouchDevice());
  const [musicEnabled, setMusicEnabled] = useState<boolean>(() => music.isMusicEnabled());
  const [hud, setHud] = useState<HudSnapshot | null>(null);

  const syncSaveUiState = (overrideProfile?: SaveProfileData) => {
    const prof = overrideProfile ?? getActiveProfile();
    setActiveProfile(prof);
    setMeta(prof.meta);
    sfx.setMuted(prof.meta.muted);
    music.setMuted(prof.meta.muted);
    setSlotSummaries(getSaveSlotSummaries());
    setStorageHealth(getStorageHealthStatus());
    engineRef.current?.updateMeta(prof.meta);
  };

  const pushAchievementToasts = (unlocked: AchievementDef[]) => {
    if (unlocked.length === 0) return;
    sfx.playLevelUp();
    setAchievementToasts((prev) => [...prev, ...unlocked].slice(-4));
    for (const item of unlocked) {
      window.setTimeout(() => {
        setAchievementToasts((prev) => prev.filter((t) => t.id !== item.id));
      }, 4200);
    }
  };

  const applyAchievementCheck = (updates?: AchievementStatUpdate, showToast = true) => {
    const currentMeta = getActiveProfile().meta;
    const res = evaluateAndUnlockAchievements(currentMeta, updates);
    if (res.changed) {
      syncSaveUiState();
      if (showToast && res.newlyUnlocked.length > 0) {
        pushAchievementToasts(res.newlyUnlocked);
      }
    }
  };

  // Register offline Service Worker, hydrate IndexedDB, and sync with server.ts on mount
  useEffect(() => {
    ensureOfflineServiceWorker();
    setServerUrlResolver(() => coopClient.getHttpBaseUrl());
    const unsubSync = onServerSyncChange(setServerSync);

    void hydrateSaveStoreFromIndexedDB()
      .then(({ restored, activeProfile: hydrated }) => {
        if (restored) {
          syncSaveUiState(hydrated);
        } else {
          setStorageHealth(getStorageHealthStatus());
        }
        applyAchievementCheck(undefined, false);
        return syncSaveStoreWithServer(coopClient.getHttpBaseUrl());
      })
      .then((res) => {
        if (res.action === 'pulled') {
          syncSaveUiState(res.activeProfile);
          applyAchievementCheck(undefined, false);
        }
      });

    return () => {
      unsubSync();
    };
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
        const currentMeta = getActiveProfile().meta;
        recordCompletedRun(currentMeta, record);
        applyAchievementCheck();
        syncSaveUiState();
      },
      onSaveCheckpoint: (snapshot) => {
        const updatedProfile = saveActiveRunCheckpoint(snapshot);
        syncSaveUiState(updatedProfile);
      },
      onClearCheckpoint: () => {
        const updatedProfile = clearActiveRunCheckpoint();
        syncSaveUiState(updatedProfile);
      },
      onBestiaryEvent: (enemyType, killed) => {
        const currentMeta = getActiveProfile().meta;
        const updated = recordBestiaryProgress(currentMeta, enemyType, killed);
        if (updated !== currentMeta) {
          syncSaveUiState();
          applyAchievementCheck();
        }
      },
      onAchievementEvent: (updates) => {
        applyAchievementCheck(updates);
      },
      onAdminGrantSouls: (delta) => {
        const currentMeta = getActiveProfile().meta;
        adminGrantSoulShards(currentMeta, delta);
        syncSaveUiState();
      },
      onPvpMatchFinished: (result: PvpMatchResult) => {
        const currentMeta = getActiveProfile().meta;
        recordLocalPvpResult(currentMeta, result);
        if (
          result.mode === 'online' &&
          result.won &&
          didPvpRankIncrease(result.eloBefore, result.eloAfter)
        ) {
          setRecentRankUp({ eloBefore: result.eloBefore, eloAfter: result.eloAfter });
        }
        applyAchievementCheck({
          pvpMatchesPlayed: { mode: 'inc', value: 1 },
          ...(result.won && result.mode === 'online'
            ? {
                pvpWins: { mode: 'inc', value: 1 },
                pvpPeakElo: { mode: 'max', value: result.eloAfter },
              }
            : {}),
        });
        syncSaveUiState();
        void pushSaveStoreToServer(coopClient.getHttpBaseUrl());
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

  // Auto-save mid-run checkpoint on backgrounding / tab close + periodic 12s safety save
  useEffect(() => {
    const flushCheckpoint = () => {
      const snap = engineRef.current?.exportActiveRunSave();
      if (snap) {
        saveActiveRunCheckpoint(snap);
        void pushSaveStoreToServer(coopClient.getHttpBaseUrl(), { keepalive: true });
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushCheckpoint();
      }
    };
    window.addEventListener('pagehide', flushCheckpoint);
    window.addEventListener('beforeunload', flushCheckpoint);
    document.addEventListener('visibilitychange', onVisibilityChange);

    const timer = window.setInterval(() => {
      const snap = engineRef.current?.exportActiveRunSave();
      if (snap) {
        const updated = saveActiveRunCheckpoint(snap);
        setActiveProfile(updated);
        setSlotSummaries(getSaveSlotSummaries());
        setStorageHealth(getStorageHealthStatus());
      }
    }, 12000);

    return () => {
      window.removeEventListener('pagehide', flushCheckpoint);
      window.removeEventListener('beforeunload', flushCheckpoint);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(timer);
    };
  }, []);

  // Wire WebSocket / P2P cooperative multiplayer listeners & auto-resume session token on reload
  useEffect(() => {
    const unsubStatus = coopClient.onStatus((ok) => {
      setWsConnected(ok);
    });
    const unsubTelemetry = coopClient.onTelemetry((telemetry) => {
      setCoopTelemetry(telemetry);
    });
    if (coopClient.getSavedSession()) {
      coopClient.connect();
    }
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
        setShowShop(false);
        setShowBestiary(false);
        setShowAchievements(false);
        setShowCharacter(false);
        setLastLocalCoopCfg(null);
        setChatMessages([]);
        updateRunSeed(msg.runSeedLabel);
        engineRef.current?.startCoopRun(selectedArchetypeRef.current, msg);
        return;
      }
      if (msg.type === 'room:reconnected') {
        setCoopError(null);
        setShowPvpModal(false);
        setShowCoopLobby(false);
        setShowLocalCoop(false);
        setShowAltar(false);
        setShowShop(false);
        setShowBestiary(false);
        setShowAchievements(false);
        setShowCharacter(false);
        setLastLocalCoopCfg(null);
        if (msg.mode === 'pvp' && msg.pvpState) {
          engineRef.current?.reconnectPvpRun(msg);
        } else {
          updateRunSeed(msg.runSeedLabel);
          engineRef.current?.reconnectCoopRun(msg);
        }
        return;
      }
      if (msg.type === 'pvp:list') {
        setPvpRooms(msg.rooms);
        setLoadingPvpRooms(false);
        return;
      }
      if (msg.type === 'pvp:joined') {
        setCoopError(null);
        setShowPvpModal(false);
        setShowCoopLobby(false);
        setShowLocalCoop(false);
        setShowAltar(false);
        setShowShop(false);
        setShowBestiary(false);
        setShowAchievements(false);
        setShowCharacter(false);
        setLastLocalCoopCfg(null);
        engineRef.current?.startNetworkPvpRun(selectedArchetypeRef.current, msg);
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
      unsubTelemetry();
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

  // Fetch PvP Arena room list whenever PvP modal opens
  useEffect(() => {
    if (!showPvpModal) return;
    setCoopError(null);
    setLoadingPvpRooms(true);
    coopClient.connect();
    coopClient.send({ type: 'pvp:list' });
    const fallbackTimer = window.setTimeout(() => {
      setLoadingPvpRooms(false);
    }, 1800);
    return () => window.clearTimeout(fallbackTimer);
  }, [showPvpModal]);

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
        if (
          e.code === 'Enter' &&
          !showAltar &&
          !showShop &&
          !showBestiary &&
          !showAchievements &&
          !showCoopLobby &&
          !showLocalCoop &&
          !showPvpModal &&
          !showSaveManager
        ) {
          e.preventDefault();
          if (activeProfile.activeRun) {
            handleResumeSavedRun();
          } else {
            handleStartGame();
          }
        } else if (e.code === 'Escape') {
          if (showAchievements) setShowAchievements(false);
          else if (showBestiary) setShowBestiary(false);
          else if (showShop) setShowShop(false);
          else if (showSaveManager) setShowSaveManager(false);
          else if (showAltar) setShowAltar(false);
          else if (showPvpModal) setShowPvpModal(false);
          else if (showCoopLobby) setShowCoopLobby(false);
          else if (showLocalCoop) setShowLocalCoop(false);
        }
        return;
      }

      if (e.code === 'KeyK' || e.code === 'Tab') {
        if (hud?.pvp) return;
        if (screen === 'PLAYING' || screen === 'PAUSED') {
          e.preventDefault();
          setShowBestiary(false);
          setShowAchievements(false);
          setShowCharacter((prev) => {
            const next = !prev;
            engineRef.current?.setScreen(next ? 'PAUSED' : 'PLAYING');
            return next;
          });
        }
        return;
      }

      if (e.code === 'Escape') {
        if (showAchievements) {
          setShowAchievements(false);
          if (!showCharacter && !showBestiary) {
            engineRef.current?.setScreen('PLAYING');
          }
        } else if (showBestiary) {
          setShowBestiary(false);
          if (!showCharacter) {
            engineRef.current?.setScreen('PLAYING');
          }
        } else if (showCharacter) {
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

  // Sync procedural soundtrack mode with current screen, floor depth, and boss encounter
  useEffect(() => {
    const scr = hud?.screen ?? 'TITLE';
    if (scr === 'TITLE') {
      music.setState({ mode: 'title', floorNumber: 1, paused: false });
    } else if (scr === 'VICTORY') {
      music.setState({ mode: 'victory', floorNumber: hud?.floorNumber ?? 1, paused: false });
    } else if (scr === 'GAME_OVER') {
      music.setState({ mode: 'gameover', floorNumber: hud?.floorNumber ?? 1, paused: false });
    } else if (hud?.pvp) {
      if (hud.pvp.phase === 'match_end') {
        music.setState({
          mode: hud.pvp.matchResult?.won ?? true ? 'victory' : 'gameover',
          floorNumber: 3,
          paused: false,
        });
      } else {
        music.setState({
          mode: 'boss',
          floorNumber: 3,
          paused: scr === 'PAUSED',
        });
      }
    } else {
      music.setState({
        mode: hud?.boss ? 'boss' : 'crypt',
        floorNumber: hud?.floorNumber ?? 1,
        paused: scr === 'PAUSED',
      });
    }
  }, [hud?.screen, hud?.boss, hud?.floorNumber, hud?.pvp?.phase, hud?.pvp?.matchResult?.won]);

  const handleToggleMute = () => {
    setMeta((prev) => {
      const next: MetaSaveData = { ...prev, muted: !prev.muted };
      sfx.setMuted(next.muted);
      music.setMuted(next.muted);
      if (!next.muted) music.unlock();
      saveMetaSave(next);
      syncSaveUiState();
      return next;
    });
  };

  const handleToggleMusic = () => {
    setMusicEnabled((prev) => {
      const next = !prev;
      music.setMusicEnabled(next);
      if (next && !meta.muted) music.unlock();
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
      syncSaveUiState();
      applyAchievementCheck({ blessingsBought: { mode: 'inc', value: 1 } });
    }
  };

  const handlePurchaseOrEquipCosmetic = (cosmeticId: string) => {
    const wasUnlocked = meta.unlockedCosmetics.includes(cosmeticId);
    const updated = purchaseCosmetic(meta, cosmeticId);
    if (updated) {
      sfx.playPickup(true);
      syncSaveUiState();
      if (!wasUnlocked) {
        applyAchievementCheck();
      }
    }
  };

  const handleEquipCosmetic = (category: CosmeticCategory, cosmeticId: string) => {
    const updated = equipCosmetic(meta, category, cosmeticId);
    if (updated) {
      sfx.playPickup(false);
      syncSaveUiState();
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
    const unlockedNodeIds = ['origin', arch.startingNodeId];
    const stats = computePlayerStats(
      selectedArchetype,
      1,
      unlockedNodeIds,
      arch.startingWeapon,
      null,
      meta
    );
    const normalizedSeed = normalizeSeedInput(runSeedInput);
    const unlockedSkills = arch.startingSkills.filter(
      (s): s is NonNullable<typeof s> => Boolean(s)
    );
    const buildState: CoopHeroBuildState = {
      archetype: selectedArchetype,
      level: 1,
      unlockedNodeIds,
      unlockedSkills,
      equippedSlots: {
        Q: arch.startingSkills[0] ?? null,
        E: arch.startingSkills[1] ?? null,
        R: arch.startingSkills[2] ?? null,
      },
      equippedWeapon: arch.startingWeapon,
      equippedRelic: null,
      inventory: [],
      blessings: { ...meta.blessings },
    };
    return {
      playerName: playerName.trim() || 'Aventurero',
      archetype: selectedArchetype,
      weaponKind: arch.startingWeapon.weaponKind ?? 'greatsword',
      classTitle: arch.name,
      maxHp: stats.maxHp,
      runSeed: normalizedSeed.numeric,
      runSeedLabel: normalizedSeed.label,
      buildState,
    };
  };

  const handleCreateCoopRoom = (isPublic: boolean) => {
    setCoopError(null);
    coopClient.send({
      type: 'room:create',
      version: APP_VERSION,
      ...getStartingCoopPayload(),
      isPublic,
    });
  };

  const handleJoinCoopRoom = (code: string) => {
    setCoopError(null);
    coopClient.send({
      type: 'room:join',
      version: APP_VERSION,
      code,
      ...getStartingCoopPayload(),
    });
  };

  const handleRefreshRooms = () => {
    setLoadingRooms(true);
    coopClient.send({ type: 'room:list' });
    window.setTimeout(() => setLoadingRooms(false), 1500);
  };

  const handleCreatePvpRoom = (isPublic: boolean) => {
    setCoopError(null);
    setRecentRankUp(null);
    coopClient.send({
      type: 'pvp:create',
      version: APP_VERSION,
      playerKey: getServerSyncKey(),
      playerName: playerName.trim() || 'Duelista',
      archetype: selectedArchetype,
      isPublic,
      cosmetics: meta.equippedCosmetics,
    });
  };

  const handleJoinPvpRoom = (code: string) => {
    setCoopError(null);
    setRecentRankUp(null);
    coopClient.send({
      type: 'pvp:join',
      version: APP_VERSION,
      code,
      playerKey: getServerSyncKey(),
      playerName: playerName.trim() || 'Duelista',
      archetype: selectedArchetype,
      cosmetics: meta.equippedCosmetics,
    });
  };

  const handleRefreshPvpRooms = () => {
    setLoadingPvpRooms(true);
    coopClient.send({ type: 'pvp:list' });
    window.setTimeout(() => setLoadingPvpRooms(false), 1500);
  };

  const handleStartLocalPvp = (
    p1Arch: ArchetypeId,
    p2Arch: ArchetypeId,
    controlMode: LocalCoopControlMode
  ) => {
    setLastLocalCoopCfg(null);
    setShowAltar(false);
    setShowShop(false);
    setShowBestiary(false);
    setShowAchievements(false);
    setShowSaveManager(false);
    setShowCoopLobby(false);
    setShowLocalCoop(false);
    setShowPvpModal(false);
    setShowCharacter(false);
    if (controlMode === 'dual_touch') {
      setShowTouchControls(true);
    }
    engineRef.current?.startLocalPvpRun(p1Arch, p2Arch, controlMode);
  };

  const handleStartGame = () => {
    setLastLocalCoopCfg(null);
    setShowAltar(false);
    setShowShop(false);
    setShowBestiary(false);
    setShowAchievements(false);
    setShowSaveManager(false);
    setShowCoopLobby(false);
    setShowLocalCoop(false);
    setShowCharacter(false);
    const seedToUse = normalizeSeedInput(runSeedInput);
    updateRunSeed(seedToUse.label);
    engineRef.current?.startRun(selectedArchetype, seedToUse.label);
  };

  const handleResumeSavedRun = () => {
    const runSave = activeProfile.activeRun;
    if (!runSave) return;
    if (runSave.runSeedLabel) {
      updateRunSeed(runSave.runSeedLabel);
    }
    if (runSave.localCoopMode && runSave.p2) {
      setLastLocalCoopCfg({
        p2Archetype: runSave.p2.archetype,
        controlMode: runSave.localCoopControlMode,
      });
      if (runSave.localCoopControlMode === 'dual_touch') {
        setShowTouchControls(true);
      }
    } else {
      setLastLocalCoopCfg(null);
    }
    setShowAltar(false);
    setShowShop(false);
    setShowBestiary(false);
    setShowAchievements(false);
    setShowSaveManager(false);
    setShowCoopLobby(false);
    setShowLocalCoop(false);
    setShowCharacter(false);
    engineRef.current?.resumeSavedRun(runSave);
  };

  const handleStartLocalCoop = (p2Archetype: ArchetypeId, controlMode: LocalCoopControlMode) => {
    setLastLocalCoopCfg({ p2Archetype, controlMode });
    setShowAltar(false);
    setShowShop(false);
    setShowBestiary(false);
    setShowAchievements(false);
    setShowSaveManager(false);
    setShowCoopLobby(false);
    setShowLocalCoop(false);
    setShowCharacter(false);
    if (controlMode === 'dual_touch') {
      setShowTouchControls(true);
    }
    const seedToUse = normalizeSeedInput(runSeedInput);
    updateRunSeed(seedToUse.label);
    engineRef.current?.startLocalCoopRun(selectedArchetype, p2Archetype, controlMode, seedToUse.label);
  };

  const handleManualSaveRun = (): boolean => {
    const snap = engineRef.current?.exportActiveRunSave();
    if (!snap) return false;
    const updated = saveActiveRunCheckpoint(snap);
    syncSaveUiState(updated);
    void pushSaveStoreToServer(coopClient.getHttpBaseUrl());
    return true;
  };

  const handleExportSlot = (slotId: SaveSlotId) => {
    const json = exportSlotBackupJson(slotId);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `criptas-del-eclipse-${slotId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const agentClientIdRef = useRef<string>(getOrCreateAdminAgentClientId());
  const remoteAdminBridgeRef = useRef<RemoteAdminAgent | null>(null);
  const remoteStateRef = useRef({
    hud,
    meta,
    playerName,
    runSeedInput,
    selectedArchetype,
    musicEnabled,
    adminFlags,
  });
  remoteStateRef.current = {
    hud,
    meta,
    playerName,
    runSeedInput,
    selectedArchetype,
    musicEnabled,
    adminFlags,
  };

  const buildRemoteClientReport = (overrideFlags?: AdminFlags): GameClientStateReport => {
    const cur = remoteStateRef.current;
    const prof = getActiveProfile();
    const curMeta = prof.meta;
    const curHud = cur.hud;
    return {
      clientId: agentClientIdRef.current,
      appVersion: APP_VERSION,
      playerName: cur.playerName.trim() || 'Aventurero',
      syncKey: getServerSyncKey(),
      screen: curHud?.screen ?? 'TITLE',
      floorNumber: curHud?.floorNumber ?? 1,
      runSeedLabel: curHud?.runSeedLabel ?? cur.runSeedInput,
      isOnlineCoop: Boolean(curHud?.coop),
      isPvp: Boolean(curHud?.pvp),
      muted: curMeta.muted,
      musicEnabled: cur.musicEnabled,
      soulShards: curMeta.soulShards,
      pvpElo: curMeta.pvpElo,
      pvpWins: curMeta.pvpWins,
      pvpLosses: curMeta.pvpLosses,
      pvpWinStreak: curMeta.pvpWinStreak,
      adminFlags: overrideFlags ?? curHud?.adminFlags ?? cur.adminFlags,
      diagnostics: engineRef.current?.getAdminDiagnostics() ?? null,
    };
  };

  useEffect(() => {
    const agent = new RemoteAdminAgent({
      getState: () => buildRemoteClientReport(),
      executeCommand: (cmd: RemoteAdminCommand) => {
        const cur = remoteStateRef.current;
        const eng = engineRef.current;
        const curScreen = cur.hud?.screen ?? 'TITLE';

        switch (cmd.type) {
          case 'update_flags': {
            const nextFlags: AdminFlags = { ...cur.adminFlags, ...cmd.patch };
            setAdminFlags(nextFlags);
            eng?.setAdminFlag(nextFlags);
            return {
              ok: true,
              message: 'Modificadores aplicados en tiempo real.',
              state: buildRemoteClientReport(nextFlags),
            };
          }
          case 'reset_flags': {
            const reset: AdminFlags = {
              godMode: false,
              infiniteMana: false,
              zeroCooldowns: false,
              oneHitKill: false,
              revealMinimap: false,
              freezeEnemies: false,
              autoLoot: false,
              showHitboxes: false,
              speedMultiplier: 1,
              damageMultiplier: 1,
            };
            setAdminFlags(reset);
            eng?.adminResetFlags();
            return {
              ok: true,
              message: 'Modificadores de combate restablecidos.',
              state: buildRemoteClientReport(reset),
            };
          }
          case 'heal_full':
            eng?.adminHealFull();
            return { ok: true, message: 'Vida y maná restaurados al máximo.' };
          case 'refill_flasks':
            eng?.adminRefillFlasks();
            return { ok: true, message: 'Frascos de vida recargados.' };
          case 'revive_heroes':
            eng?.adminReviveHeroes();
            return { ok: true, message: 'Héroes revividos.' };
          case 'change_archetype':
            setSelectedArchetype(cmd.archetype);
            eng?.adminChangeArchetype(cmd.archetype);
            return { ok: true, message: `Arquetipo cambiado a ${cmd.archetype}.` };
          case 'add_gold':
            eng?.adminAddGold(cmd.amount);
            return { ok: true, message: `+${cmd.amount} de oro otorgados.` };
          case 'add_souls':
            if (curScreen === 'PLAYING' || curScreen === 'PAUSED') {
              eng?.adminAddSouls(cmd.amount);
            } else {
              adminGrantSoulShards(getActiveProfile().meta, cmd.amount);
              syncSaveUiState();
            }
            return { ok: true, message: `+${cmd.amount} Fragmentos de Alma otorgados.` };
          case 'set_souls':
            adminSetSoulShards(getActiveProfile().meta, cmd.amount);
            syncSaveUiState();
            return { ok: true, message: `Fragmentos fijados en ${cmd.amount}.` };
          case 'level_up':
            eng?.adminLevelUp(cmd.levels);
            return { ok: true, message: `+${cmd.levels} nivel(es) aplicados.` };
          case 'add_skill_points':
            eng?.adminAddSkillPoints(cmd.points);
            return { ok: true, message: `+${cmd.points} puntos de habilidad otorgados.` };
          case 'unlock_all_skills':
            eng?.adminUnlockAllSkills();
            return { ok: true, message: 'Todas las sendas y habilidades desbloqueadas.' };
          case 'forge_item':
            eng?.adminForgeItem(cmd.kind, cmd.rarity, cmd.autoEquip);
            return { ok: true, message: `Objeto ${cmd.rarity} (${cmd.kind}) forjado.` };
          case 'clear_inventory':
            eng?.adminClearInventory();
            return { ok: true, message: 'Mochila vaciada.' };
          case 'spawn_enemy':
            eng?.adminSpawnEnemy(cmd.enemyType, cmd.count);
            return { ok: true, message: `Invocados ${cmd.count}x ${cmd.enemyType}.` };
          case 'spawn_prop':
            eng?.adminSpawnProp(cmd.kind);
            return { ok: true, message: `Elemento '${cmd.kind}' invocado.` };
          case 'kill_current_room':
            eng?.adminKillCurrentRoom();
            return { ok: true, message: 'Sala actual limpiada.' };
          case 'kill_all_floor':
            eng?.adminKillAllFloor();
            return { ok: true, message: 'Todos los enemigos del piso eliminados.' };
          case 'open_boss_portal':
            eng?.adminOpenBossPortal();
            return { ok: true, message: 'Portal de jefe abierto.' };
          case 'jump_to_floor': {
            if (curScreen === 'TITLE') {
              const seedToUse = normalizeSeedInput(cur.runSeedInput);
              updateRunSeed(seedToUse.label);
              eng?.startRun(cur.selectedArchetype, seedToUse.label);
            }
            eng?.adminJumpToFloor(cmd.floorNumber);
            return { ok: true, message: `Salto ejecutado al Piso ${cmd.floorNumber}.` };
          }
          case 'teleport_to_room':
            eng?.adminTeleportToRoom(cmd.roomType);
            return { ok: true, message: `Teletransportado a sala '${cmd.roomType}'.` };
          case 'regenerate_floor': {
            if (cmd.seedLabel && cmd.seedLabel.trim()) {
              const normalized = normalizeSeedInput(cmd.seedLabel);
              updateRunSeed(normalized.label);
              eng?.adminRegenerateFloor(normalized.label);
              return { ok: true, message: `Piso regenerado con semilla ${normalized.label}.` };
            }
            eng?.adminRegenerateFloor();
            return { ok: true, message: 'Piso actual regenerado.' };
          }
          case 'unlock_all_cosmetics':
            adminUnlockAllCosmetics(getActiveProfile().meta);
            syncSaveUiState();
            applyAchievementCheck();
            return { ok: true, message: 'Todos los cosméticos desbloqueados.' };
          case 'unlock_all_bestiary':
            adminUnlockAllBestiary(getActiveProfile().meta);
            syncSaveUiState();
            applyAchievementCheck();
            return { ok: true, message: 'Todo el bestiario desbloqueado.' };
          case 'unlock_all_achievements':
            adminUnlockAllAchievements(getActiveProfile().meta);
            syncSaveUiState();
            return { ok: true, message: 'Todos los logros desbloqueados.' };
          case 'max_all_blessings':
            adminMaxAllBlessings(getActiveProfile().meta);
            syncSaveUiState();
            applyAchievementCheck();
            return { ok: true, message: 'Todas las bendiciones al nivel máximo.' };
          case 'reset_meta_progress':
            adminResetMetaProgress(getActiveProfile().meta);
            setRecentRankUp(null);
            syncSaveUiState();
            return { ok: true, message: 'Meta-progreso de la ranura reiniciado.' };
          case 'set_pvp_elo': {
            const metaBefore = getActiveProfile().meta;
            const prevElo = metaBefore.pvpElo;
            adminSetPvpStats(metaBefore, {
              elo: cmd.elo,
              ...(cmd.incrementWin
                ? { wins: metaBefore.pvpWins + 1, streak: metaBefore.pvpWinStreak + 1 }
                : {}),
            });
            if (didPvpRankIncrease(prevElo, cmd.elo)) {
              setRecentRankUp({ eloBefore: prevElo, eloAfter: cmd.elo });
            }
            syncSaveUiState();
            return { ok: true, message: `ELO PvP del cliente fijado en ${cmd.elo}.` };
          }
          case 'reset_pvp_stats':
            adminSetPvpStats(getActiveProfile().meta, { reset: true });
            setRecentRankUp(null);
            syncSaveUiState();
            return { ok: true, message: 'Estadísticas PvP del cliente reiniciadas.' };
          case 'save_checkpoint_now': {
            const ok = handleManualSaveRun();
            return {
              ok,
              message: ok
                ? 'Partida guardada y sincronizada con el servidor.'
                : 'No hay una incursión activa para guardar.',
            };
          }
          case 'play_test_sound':
            if (cmd.kind === 'victory') sfx.playVictory();
            else if (cmd.kind === 'level') sfx.playLevelUp();
            else if (cmd.kind === 'loot') sfx.playPickup(true);
            else sfx.playHit(true);
            return { ok: true, message: `Sonido de prueba '${cmd.kind}' reproducido.` };
          case 'toggle_music':
            handleToggleMusic();
            return { ok: true, message: 'Estado de música alternado.' };
          case 'toggle_mute':
            handleToggleMute();
            return { ok: true, message: 'Estado de silencio alternado.' };
          case 'request_diagnostics':
            return { ok: true, message: 'Diagnóstico actualizado.', state: buildRemoteClientReport() };
        }
      },
    });
    remoteAdminBridgeRef.current = agent;
    agent.start();
    return () => {
      agent.stop();
      remoteAdminBridgeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    remoteAdminBridgeRef.current?.notifyStateChanged();
  }, [
    hud?.screen,
    hud?.floorNumber,
    hud?.runSeedLabel,
    meta.soulShards,
    meta.pvpElo,
    meta.pvpWins,
    meta.muted,
    musicEnabled,
    playerName,
    adminFlags,
  ]);

  const currentScreen = hud?.screen ?? 'TITLE';
  const pvpBlocksTouch = Boolean(hud?.pvp && hud.pvp.phase !== 'fighting');
  const showDualTouch =
    Boolean(hud?.localP2) &&
    currentScreen === 'PLAYING' &&
    !pvpBlocksTouch &&
    !showCharacter &&
    !showBestiary &&
    !showAchievements &&
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
            runSeedLabel={runSeedInput}
            onChangeRunSeed={updateRunSeed}
            onRandomizeRunSeed={() => updateRunSeed(generateRandomRunSeed().label)}
            onStartGame={handleStartGame}
            onResumeRun={handleResumeSavedRun}
            onOpenLocalCoop={() => setShowLocalCoop(true)}
            onOpenCoop={() => setShowCoopLobby(true)}
            onOpenPvp={() => setShowPvpModal(true)}
            onOpenAltar={() => setShowAltar(true)}
            onOpenShop={() => setShowShop(true)}
            onOpenBestiary={() => setShowBestiary(true)}
            onOpenAchievements={() => setShowAchievements(true)}
            onOpenSaveManager={() => setShowSaveManager(true)}
            activeSlotName={activeProfile.name}
            activeRun={activeProfile.activeRun}
            isOnline={isOnline}
            meta={meta}
            recentRankUp={recentRankUp}
            musicEnabled={musicEnabled}
            onToggleMusic={handleToggleMusic}
            onToggleMute={handleToggleMute}
          />
          {showAltar && (
            <AltarModal
              meta={meta}
              activeSlotName={activeProfile.name}
              onBuyBlessing={handleBuyBlessing}
              onOpenSaveManager={() => setShowSaveManager(true)}
              onClose={() => setShowAltar(false)}
            />
          )}
          {showShop && (
            <CosmeticsShopModal
              meta={meta}
              selectedArchetype={selectedArchetype}
              onPurchaseOrEquip={handlePurchaseOrEquipCosmetic}
              onEquip={handleEquipCosmetic}
              onClose={() => setShowShop(false)}
            />
          )}
          {showSaveManager && (
            <SaveManagerModal
              activeSlotId={activeProfile.id}
              slots={slotSummaries}
              storageHealth={storageHealth}
              serverSync={serverSync}
              serverBaseUrl={coopClient.getHttpBaseUrl()}
              onChangeSyncKey={async (newKey) => {
                const res = setServerSyncKey(newKey);
                if (!res.ok) return { ok: false, message: res.error };
                const syncRes = await syncSaveStoreWithServer(coopClient.getHttpBaseUrl());
                if (syncRes.action === 'pulled') {
                  syncSaveUiState(syncRes.activeProfile);
                  return {
                    ok: true,
                    message: `Código ${res.syncKey} aplicado y partidas descargadas desde el servidor.`,
                  };
                }
                if (syncRes.action === 'pushed') {
                  return {
                    ok: true,
                    message: `Código ${res.syncKey} aplicado y progreso local respaldado en el servidor.`,
                  };
                }
                if (syncRes.action === 'offline') {
                  return {
                    ok: false,
                    message: `Código ${res.syncKey} guardado localmente, pero no se pudo contactar al servidor.`,
                  };
                }
                return { ok: true, message: `Código ${res.syncKey} sincronizado con el servidor.` };
              }}
              onPushToServer={async () => {
                const res = await pushSaveStoreToServer(coopClient.getHttpBaseUrl());
                return res.ok
                  ? { ok: true, message: 'Todas las ranuras se subieron al servidor correctamente.' }
                  : { ok: false, message: res.error || 'No se pudo subir al servidor.' };
              }}
              onPullFromServer={async () => {
                const res = await pullSaveStoreFromServer(coopClient.getHttpBaseUrl());
                if (!res.ok) {
                  return { ok: false, message: res.error || 'No se pudo descargar del servidor.' };
                }
                if (!res.found) {
                  return { ok: false, message: 'No existe ningún guardado en el servidor para este código.' };
                }
                syncSaveUiState(res.activeProfile);
                return { ok: true, message: 'Partidas restauradas desde el servidor correctamente.' };
              }}
              onDeleteFromServer={async () => {
                const res = await deleteServerSaveRemote(coopClient.getHttpBaseUrl());
                if (!res.ok) {
                  return { ok: false, message: res.error || 'No se pudo borrar en el servidor.' };
                }
                return {
                  ok: true,
                  message: res.deleted
                    ? 'Respaldo eliminado del disco del servidor (tu copia local sigue intacta).'
                    : 'No había archivo guardado en el servidor para este código.',
                };
              }}
              onSelectSlot={(slotId) => {
                const prof = setActiveSlotId(slotId);
                syncSaveUiState(prof);
              }}
              onRenameSlot={(slotId, name) => {
                renameSaveSlot(slotId, name);
                syncSaveUiState();
              }}
              onExportSlot={handleExportSlot}
              onImportSlot={(slotId, raw) => {
                const res = importSlotBackupJson(raw, slotId);
                if (res.ok) {
                  syncSaveUiState();
                  return { ok: true };
                }
                return { ok: false, error: res.error };
              }}
              onClearActiveRun={(slotId) => {
                clearActiveRunCheckpoint(slotId);
                syncSaveUiState();
              }}
              onResetSlot={(slotId) => {
                resetSaveSlot(slotId);
                syncSaveUiState();
              }}
              onClose={() => setShowSaveManager(false)}
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
              runSeedLabel={runSeedInput}
              onChangeRunSeed={updateRunSeed}
              onRandomizeRunSeed={() => updateRunSeed(generateRandomRunSeed().label)}
              rooms={coopRooms}
              loadingRooms={loadingRooms}
              wsConnected={wsConnected}
              coopTelemetry={coopTelemetry}
              errorMessage={coopError}
              initialJoinCode={initialInviteCode}
              getHostPayload={getStartingCoopPayload}
              onRefreshRooms={handleRefreshRooms}
              onCreateRoom={handleCreateCoopRoom}
              onJoinRoom={handleJoinCoopRoom}
              onClose={() => setShowCoopLobby(false)}
            />
          )}
          {showPvpModal && (
            <PvpArenaModal
              playerName={playerName}
              onChangePlayerName={handleChangePlayerName}
              selectedArchetype={selectedArchetype}
              onSelectArchetype={setSelectedArchetype}
              meta={meta}
              recentRankUp={recentRankUp}
              rooms={pvpRooms}
              loadingRooms={loadingPvpRooms}
              wsConnected={wsConnected}
              coopTelemetry={coopTelemetry}
              errorMessage={coopError}
              onRefreshRooms={handleRefreshPvpRooms}
              onCreatePvpRoom={handleCreatePvpRoom}
              onJoinPvpRoom={handleJoinPvpRoom}
              onStartLocalPvp={handleStartLocalPvp}
              onClose={() => setShowPvpModal(false)}
            />
          )}
        </div>
      )}

      {/* Active Low-Occlusion HUD */}
      {hud && currentScreen !== 'TITLE' && (
        <GameHud
          hud={hud}
          coopTelemetry={coopTelemetry}
          muted={meta.muted}
          musicEnabled={musicEnabled}
          showTouchControls={showDualTouch || (showTouchControls && !hud.localP2)}
          chatMessages={chatMessages}
          onSendChat={(text) => coopClient.send({ type: 'chat:send', text })}
          onToggleTouchControls={() => setShowTouchControls((v) => !v)}
          onToggleMusic={handleToggleMusic}
          onToggleMute={handleToggleMute}
          onOpenCharacter={() => {
            if (hud.pvp) return;
            setShowBestiary(false);
            setShowAchievements(false);
            setShowCharacter(true);
            engineRef.current?.setScreen('PAUSED');
          }}
          onOpenBestiary={() => {
            setShowCharacter(false);
            setShowAchievements(false);
            setShowBestiary(true);
            engineRef.current?.setScreen('PAUSED');
          }}
          onOpenAchievements={() => {
            setShowCharacter(false);
            setShowBestiary(false);
            setShowAchievements(true);
            engineRef.current?.setScreen('PAUSED');
          }}
          onPause={() => engineRef.current?.setScreen('PAUSED')}
          onTogglePvpReady={() => engineRef.current?.togglePvpReady()}
          onPvpRematch={() => engineRef.current?.requestPvpRematch()}
          onReturnToTitle={() => {
            setShowCharacter(false);
            engineRef.current?.setScreen('TITLE');
          }}
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
        !pvpBlocksTouch &&
        showTouchControls &&
        !showCharacter &&
        !showBestiary &&
        !showAchievements &&
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

      {/* Visual Bestiary Modal (accessible from Title & In-Game) */}
      {showBestiary && (
        <BestiaryModal
          meta={meta}
          onClose={() => {
            setShowBestiary(false);
            if (currentScreen === 'PAUSED' && !showCharacter && !showAchievements) {
              engineRef.current?.setScreen('PLAYING');
            }
          }}
        />
      )}

      {/* Achievements Modal (accessible from Title & In-Game) */}
      {showAchievements && (
        <AchievementsModal
          meta={meta}
          onClose={() => {
            setShowAchievements(false);
            if (currentScreen === 'PAUSED' && !showCharacter && !showBestiary) {
              engineRef.current?.setScreen('PLAYING');
            }
          }}
        />
      )}

      {/* Pause / Victory / Game Over Modal */}
      {hud &&
        !showCharacter &&
        !showBestiary &&
        !showAchievements &&
        (currentScreen === 'PAUSED' ||
          currentScreen === 'VICTORY' ||
          currentScreen === 'GAME_OVER') && (
          <RunEndModal
            hud={hud}
            onResume={() => engineRef.current?.setScreen('PLAYING')}
            onContinueEndless={() => engineRef.current?.continueEndless()}
            onSaveRun={handleManualSaveRun}
            onSaveAndReturnTitle={() => {
              handleManualSaveRun();
              setShowCharacter(false);
              engineRef.current?.setScreen('TITLE');
            }}
            onOpenBestiary={() => setShowBestiary(true)}
            onOpenAchievements={() => setShowAchievements(true)}
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

      {/* Non-blocking Achievement Unlocked Toast Stack */}
      {achievementToasts.length > 0 && (
        <div
          className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] pointer-events-none flex flex-col items-center gap-2 w-full max-w-xs px-3"
          style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}
        >
          {achievementToasts.map((ach) => (
            <div
              key={ach.id}
              className="w-full px-3.5 py-2.5 rounded-lg bg-[#12151C]/95 border border-amber-500/80 shadow-2xl flex items-center gap-3"
            >
              <div className="w-9 h-9 rounded-md bg-[#231D12] border border-amber-500/60 flex items-center justify-center shrink-0">
                <Trophy className="w-4 h-4 text-amber-400" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-mono-num font-bold uppercase tracking-wider text-amber-400">
                  Logro desbloqueado · +{ach.rewardSouls} Almas
                </div>
                <div className="font-display text-xs font-bold text-[#E5E0D5] truncate">
                  {ach.name}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
