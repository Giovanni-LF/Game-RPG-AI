import type {
  AdminDiagnosticsSnapshot,
  AdminFlags,
  ArchetypeId,
  EnemyType,
  GameScreen,
  PvpMatchPhase,
  Rarity,
  WeaponKind,
} from '../types/game.ts';

export type RemoteAdminCommand =
  | { type: 'update_flags'; patch: Partial<AdminFlags> }
  | { type: 'reset_flags' }
  | { type: 'heal_full' }
  | { type: 'refill_flasks' }
  | { type: 'revive_heroes' }
  | { type: 'change_archetype'; archetype: ArchetypeId }
  | { type: 'add_gold'; amount: number }
  | { type: 'add_souls'; amount: number }
  | { type: 'set_souls'; amount: number }
  | { type: 'level_up'; levels: number }
  | { type: 'add_skill_points'; points: number }
  | { type: 'unlock_all_skills' }
  | { type: 'forge_item'; kind: WeaponKind | 'relic'; rarity: Rarity; autoEquip: boolean }
  | { type: 'clear_inventory' }
  | { type: 'spawn_enemy'; enemyType: EnemyType; count: number }
  | { type: 'spawn_prop'; kind: 'chest' | 'shrine' | 'portal' }
  | { type: 'kill_current_room' }
  | { type: 'kill_all_floor' }
  | { type: 'open_boss_portal' }
  | { type: 'jump_to_floor'; floorNumber: number }
  | { type: 'teleport_to_room'; roomType: 'start' | 'boss' | 'treasure' | 'shrine' }
  | { type: 'regenerate_floor'; seedLabel?: string }
  | { type: 'unlock_all_cosmetics' }
  | { type: 'unlock_all_bestiary' }
  | { type: 'unlock_all_achievements' }
  | { type: 'max_all_blessings' }
  | { type: 'reset_meta_progress' }
  | { type: 'set_pvp_elo'; elo: number; incrementWin?: boolean }
  | { type: 'reset_pvp_stats' }
  | { type: 'save_checkpoint_now' }
  | { type: 'play_test_sound'; kind: 'victory' | 'level' | 'loot' | 'hit' }
  | { type: 'toggle_music' }
  | { type: 'toggle_mute' }
  | { type: 'request_diagnostics' };

export interface GameClientStateReport {
  clientId: string;
  appVersion?: string;
  playerName: string;
  syncKey: string;
  screen: GameScreen;
  floorNumber: number;
  runSeedLabel: string;
  isOnlineCoop: boolean;
  isPvp: boolean;
  muted: boolean;
  musicEnabled: boolean;
  soulShards: number;
  pvpElo: number;
  pvpWins: number;
  pvpLosses: number;
  pvpWinStreak: number;
  adminFlags: AdminFlags;
  diagnostics: AdminDiagnosticsSnapshot | null;
}

export interface ConnectedGameClientSummary extends GameClientStateReport {
  connectedAtIso: string;
  lastSeenIso: string;
}

export interface AdminRoomSummary {
  code: string;
  mode: 'coop' | 'pvp';
  isPublic: boolean;
  playerCount: number;
  maxPlayers: number;
  floorNumber: number;
  phase?: PvpMatchPhase;
  players: Array<{ id: string; name: string; connected: boolean }>;
}

export interface AdminServerSaveSummary {
  syncKey: string;
  updatedAtIso: string;
  activeSlotId: string;
  slotName: string;
  bestFloor: number;
  soulShards: number;
  totalKills: number;
  pvpElo: number;
  bytes: number;
}

export interface AdminCommandResult {
  requestId: string;
  clientId: string;
  ok: boolean;
  message: string;
}

export interface AdminServerSnapshot {
  serverVersion: string;
  uptimeSec: number;
  lanUrls: string[];
  clients: ConnectedGameClientSummary[];
  rooms: AdminRoomSummary[];
  leaderboardCount: number;
  savesCount: number;
}

export type AgentWsClientMessage =
  | { type: 'agent:register'; state: GameClientStateReport }
  | { type: 'agent:state'; state: GameClientStateReport }
  | {
      type: 'agent:command_ack';
      requestId: string;
      ok: boolean;
      message: string;
      state?: GameClientStateReport;
    };

export type AgentWsServerMessage = {
  type: 'agent:command';
  requestId: string;
  command: RemoteAdminCommand;
};

export type AdminWsClientMessage =
  | { type: 'admin:auth'; key: string }
  | { type: 'admin:refresh' }
  | {
      type: 'admin:command';
      requestId: string;
      targetClientId: string;
      command: RemoteAdminCommand;
    };

export type AdminWsServerMessage =
  | { type: 'admin:welcome'; snapshot: AdminServerSnapshot }
  | { type: 'admin:snapshot'; snapshot: AdminServerSnapshot }
  | { type: 'admin:command_result'; result: AdminCommandResult }
  | { type: 'admin:error'; message: string };
