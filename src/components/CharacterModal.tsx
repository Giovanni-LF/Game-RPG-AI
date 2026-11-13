import React, { useState } from 'react';
import { X } from 'lucide-react';
import {
  ACTIVE_SKILLS,
  RARITY_COLORS,
  RARITY_LABELS,
  SKILL_TREE_NODES,
} from '../data/gameData';
import {
  ActiveSkillId,
  HudSnapshot,
  ItemData,
  SkillSlotKey,
  SkillTreeNode,
} from '../types/game';

interface CharacterModalProps {
  hud: HudSnapshot;
  onUnlockNode: (nodeId: string, playerNum: 1 | 2) => void;
  onAssignSlot: (slot: SkillSlotKey, skillId: ActiveSkillId | null, playerNum: 1 | 2) => void;
  onEquipItem: (itemId: string, playerNum: 1 | 2) => void;
  onSalvageItem: (itemId: string, playerNum: 1 | 2) => void;
  onClose: () => void;
}

const BRANCH_COLORS: Record<SkillTreeNode['branch'], string> = {
  origin: '#F59E0B',
  steel: '#EF4444',
  shadow: '#10B981',
  arcane: '#8B5CF6',
  hybrid: '#F59E0B',
};

function formatItemStats(item: ItemData): string {
  const parts: string[] = [];
  const s = item.stats;
  if (s.damageBonus) parts.push(`+${s.damageBonus} Daño`);
  if (s.arcaneBonus) parts.push(`+${s.arcaneBonus} Arcano`);
  if (s.maxHpBonus) parts.push(`+${s.maxHpBonus} Vida`);
  if (s.maxManaBonus) parts.push(`+${s.maxManaBonus} Maná`);
  if (s.armorBonus) parts.push(`+${s.armorBonus} Armadura`);
  if (s.critChanceBonus) parts.push(`+${Math.round(s.critChanceBonus * 100)}% Crít.`);
  if (s.critMultBonus) parts.push(`+${Math.round(s.critMultBonus * 100)}% Daño Crít.`);
  if (s.attackSpeedBonus) parts.push(`+${Math.round(s.attackSpeedBonus * 100)}% Vel. Atq.`);
  if (s.moveSpeedBonus) parts.push(`+${s.moveSpeedBonus} Vel. Mov.`);
  if (s.lifestealBonus) parts.push(`+${Math.round(s.lifestealBonus * 100)}% Robo Vida`);
  if (s.cooldownReduction) parts.push(`-${Math.round(s.cooldownReduction * 100)}% Enfriam.`);
  return parts.join(' · ');
}

export const CharacterModal: React.FC<CharacterModalProps> = ({
  hud,
  onUnlockNode,
  onAssignSlot,
  onEquipItem,
  onSalvageItem,
  onClose,
}) => {
  const [selectedPlayer, setSelectedPlayer] = useState<1 | 2>(1);
  const [selectedNodeId, setSelectedNodeId] = useState<string>('origin');
  const [activeSlotPicker, setActiveSlotPicker] = useState<SkillSlotKey>('Q');
  const [rightTab, setRightTab] = useState<'stats' | 'gear'>('stats');
  const [mobileSection, setMobileSection] = useState<'tree' | 'stats' | 'gear'>('tree');

  const activePlayerNum: 1 | 2 = selectedPlayer === 2 && hud.localP2 ? 2 : 1;
  const activeHero = activePlayerNum === 2 && hud.localP2 ? hud.localP2 : hud;

  const unlockedSet = new Set(activeHero.unlockedNodeIds);

  const isNodeUnlockable = (node: SkillTreeNode) => {
    if (unlockedSet.has(node.id)) return false;
    return node.requires.length === 0 || node.requires.some((r) => unlockedSet.has(r));
  };

  const selectedNode =
    SKILL_TREE_NODES.find((n) => n.id === selectedNodeId) ?? SKILL_TREE_NODES[0];
  const selectedUnlocked = unlockedSet.has(selectedNode.id);
  const selectedUnlockable = isNodeUnlockable(selectedNode);

  return (
    <div className="fixed inset-0 z-40 bg-black/82 flex items-center justify-center sm:p-4 md:p-6">
      <div className="w-full max-w-6xl h-[100dvh] sm:h-[90dvh] bg-[#10131A] sm:border border-[#2C3344] sm:rounded-lg overflow-hidden flex flex-col">
        {/* Header */}
        <div
          className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-3 border-b border-[#232836] bg-[#12161F]"
          style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
            {hud.localP2 && (
              <div className="inline-flex items-center rounded-md bg-[#0B0D12] border border-[#2C3344] p-0.5">
                <button
                  type="button"
                  onClick={() => setSelectedPlayer(1)}
                  className={`min-h-[34px] px-2.5 py-1 text-xs font-semibold rounded transition-colors cursor-pointer ${
                    activePlayerNum === 1
                      ? 'bg-amber-600 text-[#0B0C10]'
                      : 'text-[#C2BDB2] hover:text-white'
                  }`}
                >
                  J1 {hud.skillPoints > 0 ? `(+${hud.skillPoints})` : ''}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPlayer(2)}
                  className={`min-h-[34px] px-2.5 py-1 text-xs font-semibold rounded transition-colors cursor-pointer ${
                    activePlayerNum === 2
                      ? 'bg-sky-500 text-[#0B0C10]'
                      : 'text-[#C2BDB2] hover:text-white'
                  }`}
                >
                  J2 {hud.localP2.skillPoints > 0 ? `(+${hud.localP2.skillPoints})` : ''}
                </button>
              </div>
            )}

            <h2 className="font-display text-sm sm:text-lg font-bold text-[#E5E0D5] truncate">
              {activeHero.classTitle}
            </h2>
            <span className="text-xs font-mono-num text-[#949BA8] whitespace-nowrap">
              Nv. {activeHero.level}
            </span>
            <span
              className={`text-xs font-mono-num font-semibold whitespace-nowrap ${
                activePlayerNum === 2 ? 'text-sky-400' : 'text-amber-400'
              }`}
            >
              Puntos: {activeHero.skillPoints}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-[36px] px-3 py-1.5 text-xs font-medium text-[#D4CFC4] bg-[#181D29] border border-[#2C3344] hover:border-[#475066] rounded-md cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
            <span className="hidden sm:inline">Cerrar (K)</span>
            <span className="sm:hidden">Cerrar</span>
          </button>
        </div>

        {/* Mobile Section Tabs (< lg) */}
        <div className="lg:hidden grid grid-cols-3 gap-1 p-1.5 bg-[#0D1016] border-b border-[#232836]">
          {(
            [
              ['tree', 'Árbol'],
              ['stats', 'Atributos'],
              ['gear', `Mochila (${activeHero.inventory.length})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setMobileSection(key);
                if (key === 'stats' || key === 'gear') setRightTab(key);
              }}
              className={`min-h-[44px] text-xs font-medium rounded transition-colors cursor-pointer ${
                mobileSection === key
                  ? 'bg-[#1D2330] text-amber-400'
                  : 'text-[#949BA8]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12">
          {/* Left 7 cols: Constellation Tree + Active Skill Slots */}
          <div
            className={`${
              mobileSection === 'tree' ? 'flex' : 'hidden lg:flex'
            } lg:col-span-7 flex-col lg:border-r border-[#232836] min-h-0 overflow-y-auto lg:overflow-hidden crypt-scroll`}
          >
            <div className="relative flex-1 bg-[#0B0D12] min-h-[270px]">
              <svg viewBox="0 0 800 600" className="w-full h-full select-none">
                {/* Subtle Sector Labels */}
                <text x="86" y="54" fill="#EF4444" opacity="0.65" fontSize="13" fontFamily="Cinzel, serif" fontWeight="700">
                  SENDA DEL ACERO
                </text>
                <text x="580" y="54" fill="#10B981" opacity="0.65" fontSize="13" fontFamily="Cinzel, serif" fontWeight="700">
                  SENDA DE LA SOMBRA
                </text>
                <text x="336" y="582" fill="#8B5CF6" opacity="0.65" fontSize="13" fontFamily="Cinzel, serif" fontWeight="700">
                  SENDA DEL ARCANO
                </text>

                {/* Edges */}
                {SKILL_TREE_NODES.map((node) =>
                  node.requires.map((reqId) => {
                    const parent = SKILL_TREE_NODES.find((p) => p.id === reqId);
                    if (!parent) return null;
                    const bothUnlocked = unlockedSet.has(node.id) && unlockedSet.has(parent.id);
                    const oneUnlocked = unlockedSet.has(node.id) || unlockedSet.has(parent.id);
                    const col = bothUnlocked
                      ? BRANCH_COLORS[node.branch]
                      : oneUnlocked
                      ? '#475066'
                      : '#1F2430';
                    return (
                      <line
                        key={`${parent.id}-${node.id}`}
                        x1={parent.x}
                        y1={parent.y}
                        x2={node.x}
                        y2={node.y}
                        stroke={col}
                        strokeWidth={bothUnlocked ? 3 : 1.75}
                        strokeDasharray={bothUnlocked ? undefined : oneUnlocked ? '4 4' : undefined}
                        opacity={bothUnlocked ? 0.9 : 0.65}
                      />
                    );
                  })
                )}

                {/* Nodes */}
                {SKILL_TREE_NODES.map((node) => {
                  const unlocked = unlockedSet.has(node.id);
                  const unlockable = isNodeUnlockable(node);
                  const selected = selectedNode.id === node.id;
                  const col = BRANCH_COLORS[node.branch];
                  const r = node.tier === 0 ? 22 : node.unlocksSkill || node.tier === 4 ? 19 : 15;

                  return (
                    <g
                      key={node.id}
                      transform={`translate(${node.x}, ${node.y})`}
                      className="cursor-pointer"
                      onClick={() => {
                        setSelectedNodeId(node.id);
                        if (unlockable && activeHero.skillPoints > 0 && selected) {
                          onUnlockNode(node.id, activePlayerNum);
                        }
                      }}
                    >
                      {/* Generous invisible hit circle for mobile thumb taps */}
                      <circle r={30} fill="transparent" />
                      {selected && (
                        <circle
                          r={r + 6}
                          fill="none"
                          stroke="#E5E0D5"
                          strokeWidth="1.5"
                          strokeDasharray="3 3"
                        />
                      )}
                      {unlockable && activeHero.skillPoints > 0 && !unlocked && (
                        <circle r={r + 4} fill="none" stroke="#F59E0B" strokeWidth="1.5" opacity="0.7" />
                      )}
                      <circle
                        r={r}
                        fill={unlocked ? `${col}33` : '#141821'}
                        stroke={unlocked ? col : unlockable ? '#949BA8' : '#2C3344'}
                        strokeWidth={unlocked ? 2.5 : 1.75}
                      />
                      {node.unlocksSkill && (
                        <circle r={5} fill={unlocked ? col : '#475066'} />
                      )}
                      <text
                        y={r + 14}
                        textAnchor="middle"
                        fill={unlocked ? '#E5E0D5' : unlockable ? '#C2BDB2' : '#6B7280'}
                        fontSize="11"
                        fontWeight={unlocked ? '600' : '400'}
                        fontFamily="Plus Jakarta Sans, sans-serif"
                      >
                        {node.name}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Selected Node Inspector & Active Skill Mapper */}
            <div className="p-3.5 sm:p-4 bg-[#12161F] border-t border-[#232836] space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: BRANCH_COLORS[selectedNode.branch] }}
                    />
                    <h3 className="font-display text-sm font-bold text-[#E5E0D5]">
                      {selectedNode.name}
                    </h3>
                    <span className="text-xs text-[#949BA8]">
                      · {selectedUnlocked ? 'Desbloqueado' : selectedUnlockable ? 'Disponible' : 'Bloqueado'}
                    </span>
                  </div>
                  <p className="text-xs text-[#C2BDB2] leading-relaxed">
                    {selectedNode.description}
                  </p>
                </div>

                {!selectedUnlocked && (
                  <button
                    type="button"
                    disabled={!selectedUnlockable || activeHero.skillPoints <= 0}
                    onClick={() => onUnlockNode(selectedNode.id, activePlayerNum)}
                    className={`min-h-[44px] sm:min-h-[36px] px-4 py-2 text-xs font-semibold rounded-md whitespace-nowrap shrink-0 transition-colors ${
                      selectedUnlockable && activeHero.skillPoints > 0
                        ? 'bg-amber-600 hover:bg-amber-500 text-[#0B0C10] cursor-pointer'
                        : 'bg-[#181C26] text-[#6B7280] border border-[#2C3344] cursor-not-allowed'
                    }`}
                  >
                    {activeHero.skillPoints <= 0
                      ? 'Sin puntos'
                      : selectedUnlockable
                      ? 'Desbloquear (1 pt)'
                      : 'Requiere nodo previo'}
                  </button>
                )}
              </div>

              {/* Active Skills Assignment Bar */}
              <div className="pt-2.5 border-t border-[#232836] flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-[#949BA8]">Ranura:</span>
                  {(['Q', 'E', 'R'] as SkillSlotKey[]).map((slot) => {
                    const assigned = activeHero.equippedSlots[slot];
                    const active = activeSlotPicker === slot;
                    return (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => setActiveSlotPicker(slot)}
                        className={`min-h-[40px] sm:min-h-[32px] px-2.5 py-1.5 text-xs rounded border transition-colors cursor-pointer ${
                          active
                            ? 'bg-[#1E2433] border-amber-500 text-[#E5E0D5]'
                            : 'bg-[#151923] border-[#2C3344] text-[#949BA8] hover:text-[#E5E0D5]'
                        }`}
                      >
                        <span className="font-mono-num font-bold text-amber-400">{slot}:</span>{' '}
                        <span>{assigned ? ACTIVE_SKILLS[assigned].name : 'Vacío'}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {activeHero.unlockedSkills.map((skId) => {
                    const sk = ACTIVE_SKILLS[skId];
                    const inSelectedSlot = activeHero.equippedSlots[activeSlotPicker] === skId;
                    return (
                      <button
                        key={skId}
                        type="button"
                        title={sk.description}
                        onClick={() => onAssignSlot(activeSlotPicker, skId, activePlayerNum)}
                        className={`min-h-[40px] sm:min-h-[32px] px-2.5 py-1 text-xs rounded border transition-colors cursor-pointer ${
                          inSelectedSlot
                            ? 'bg-amber-600/20 border-amber-500 text-amber-300'
                            : 'bg-[#171B24] border-[#2C3344] text-[#D4CFC4] hover:border-[#475066]'
                        }`}
                      >
                        {sk.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Right 5 cols: Stats & Equipment / Inventory */}
          <div
            className={`${
              mobileSection !== 'tree' ? 'flex' : 'hidden lg:flex'
            } lg:col-span-5 flex-col min-h-0 bg-[#12151C]`}
          >
            <div className="hidden lg:flex items-center gap-1 p-2 border-b border-[#232836]">
              <button
                type="button"
                onClick={() => setRightTab('stats')}
                className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
                  rightTab === 'stats'
                    ? 'bg-[#1D2330] text-[#E5E0D5]'
                    : 'text-[#949BA8] hover:text-[#E5E0D5]'
                }`}
              >
                Atributos y Equipo
              </button>
              <button
                type="button"
                onClick={() => setRightTab('gear')}
                className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
                  rightTab === 'gear'
                    ? 'bg-[#1D2330] text-[#E5E0D5]'
                    : 'text-[#949BA8] hover:text-[#E5E0D5]'
                }`}
              >
                Mochila ({activeHero.inventory.length}) · Oro {hud.gold}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto crypt-scroll p-5 space-y-5">
              {rightTab === 'stats' ? (
                <>
                  {/* Stats Grid */}
                  <div className="grid grid-cols-2 gap-2.5">
                    {[
                      ['Vida máxima', `${activeHero.computedStats.maxHp}`],
                      ['Maná máximo', `${activeHero.computedStats.maxMana}`],
                      ['Daño físico', `${activeHero.computedStats.baseDamage}`],
                      ['Poder arcano', `${activeHero.computedStats.arcanePower}`],
                      ['Armadura', `${activeHero.computedStats.armor}`],
                      ['Prob. crítica', `${Math.round(activeHero.computedStats.critChance * 100)}%`],
                      ['Daño crítico', `${Math.round(activeHero.computedStats.critMultiplier * 100)}%`],
                      ['Vel. ataque', `${activeHero.computedStats.attackSpeed}x`],
                      ['Robo de vida', `${Math.round(activeHero.computedStats.lifesteal * 100)}%`],
                      ['Reducción CD', `${Math.round(activeHero.computedStats.cooldownReduction * 100)}%`],
                    ].map(([label, val]) => (
                      <div
                        key={label}
                        className="px-3 py-2 rounded bg-[#171B24] border border-[#232836] flex items-center justify-between text-xs"
                      >
                        <span className="text-[#949BA8]">{label}</span>
                        <span className="font-mono-num font-semibold text-[#E5E0D5]">{val}</span>
                      </div>
                    ))}
                  </div>

                  {/* Equipped Weapon & Relic */}
                  <div className="space-y-2.5 pt-2 border-t border-[#232836]">
                    <h4 className="text-xs font-semibold text-[#949BA8]">Equipo activo</h4>
                    <div className="p-3.5 rounded bg-[#171B24] border border-[#2C3344] space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span
                          className="font-semibold"
                          style={{ color: RARITY_COLORS[activeHero.equippedWeapon.rarity] }}
                        >
                          {activeHero.equippedWeapon.name}
                        </span>
                        <span className="text-[#949BA8]">
                          Arma · {RARITY_LABELS[activeHero.equippedWeapon.rarity]}
                        </span>
                      </div>
                      <p className="text-xs font-mono-num text-[#D4CFC4]">
                        {formatItemStats(activeHero.equippedWeapon)}
                      </p>
                    </div>

                    {activeHero.equippedRelic ? (
                      <div className="p-3.5 rounded bg-[#171B24] border border-[#2C3344] space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span
                            className="font-semibold"
                            style={{ color: RARITY_COLORS[activeHero.equippedRelic.rarity] }}
                          >
                            {activeHero.equippedRelic.name}
                          </span>
                          <span className="text-[#949BA8]">
                            Reliquia · {RARITY_LABELS[activeHero.equippedRelic.rarity]}
                          </span>
                        </div>
                        <p className="text-xs font-mono-num text-[#D4CFC4]">
                          {formatItemStats(activeHero.equippedRelic)}
                        </p>
                      </div>
                    ) : (
                      <div className="p-3.5 rounded bg-[#141720] border border-dashed border-[#262C3B] text-xs text-[#6B7280]">
                        Sin reliquia equipada · Explora cofres y jefes para encontrar reliquias.
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="space-y-2.5">
                  {activeHero.inventory.length === 0 ? (
                    <div className="p-6 text-center text-xs text-[#949BA8] bg-[#161A23] rounded border border-[#232836]">
                      La mochila está vacía. Abre cofres o derrota enemigos para obtener armas y reliquias.
                    </div>
                  ) : (
                    activeHero.inventory.map((item) => (
                      <div
                        key={item.id}
                        className="p-3.5 rounded bg-[#171B24] border border-[#262C3B] space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div
                              className="text-xs font-semibold"
                              style={{ color: RARITY_COLORS[item.rarity] }}
                            >
                              {item.name}
                            </div>
                            <div className="text-[11px] text-[#949BA8]">
                              {item.slot === 'weapon' ? 'Arma' : 'Reliquia'} · {RARITY_LABELS[item.rarity]} · Nv. {item.level}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => onEquipItem(item.id, activePlayerNum)}
                              className="px-2.5 py-1 text-xs font-medium bg-amber-600 hover:bg-amber-500 text-[#0B0C10] rounded cursor-pointer"
                            >
                              Equipar
                            </button>
                            <button
                              type="button"
                              onClick={() => onSalvageItem(item.id, activePlayerNum)}
                              className="px-2.5 py-1 text-xs font-medium bg-[#12151C] hover:bg-[#1E2330] text-[#C2BDB2] border border-[#2C3344] rounded cursor-pointer"
                            >
                              +{item.valueGold} Oro
                            </button>
                          </div>
                        </div>
                        <p className="text-xs font-mono-num text-[#D4CFC4]">
                          {formatItemStats(item)}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
