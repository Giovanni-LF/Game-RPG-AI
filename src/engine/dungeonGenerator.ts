import { FLOOR_NAMES } from '../data/gameData.ts';
import { createSeededRng } from '../shared/protocol.ts';
import type { DungeonFloor, DungeonProp, DungeonRoom, RoomType } from '../types/game.ts';

export function generateDungeonFloor(floorNumber: number, seed?: number): DungeonFloor {
  const rng = createSeededRng(seed ?? ((Date.now() ^ (floorNumber * 2654435761)) >>> 0));
  const width = 58;
  const height = 58;
  const tileSize = 48;
  const tiles = new Uint8Array(width * height);
  const visibility = new Uint8Array(width * height);
  const wallDecor = new Uint8Array(width * height);

  for (let i = 0; i < wallDecor.length; i++) {
    wallDecor[i] = Math.floor(rng() * 16);
  }

  const rooms: DungeonRoom[] = [];
  const targetRooms = Math.min(13, 8 + floorNumber);

  const overlaps = (x: number, y: number, w: number, h: number): boolean => {
    for (const r of rooms) {
      if (x <= r.x + r.w + 3 && x + w + 3 >= r.x && y <= r.y + r.h + 3 && y + h + 3 >= r.y) {
        return true;
      }
    }
    return false;
  };

  // Start room near center-left
  const startW = 9;
  const startH = 9;
  const startX = 6;
  const startY = Math.floor(height / 2 - startH / 2);
  rooms.push({
    id: 0,
    x: startX,
    y: startY,
    w: startW,
    h: startH,
    cx: Math.floor(startX + startW / 2),
    cy: Math.floor(startY + startH / 2),
    type: 'start',
    cleared: true,
    discovered: true,
  });

  let attempts = 0;
  while (rooms.length < targetRooms && attempts < 360) {
    attempts++;
    const w = 7 + Math.floor(rng() * 6);
    const h = 7 + Math.floor(rng() * 6);
    const x = 3 + Math.floor(rng() * (width - w - 6));
    const y = 3 + Math.floor(rng() * (height - h - 6));
    if (!overlaps(x, y, w, h)) {
      rooms.push({
        id: rooms.length,
        x,
        y,
        w,
        h,
        cx: Math.floor(x + w / 2),
        cy: Math.floor(y + h / 2),
        type: 'combat',
        cleared: false,
        discovered: false,
      });
    }
  }

  // Assign Boss room to furthest from start
  let bossIdx = 1;
  let maxDist = -1;
  for (let i = 1; i < rooms.length; i++) {
    const dx = rooms[i].cx - rooms[0].cx;
    const dy = rooms[i].cy - rooms[0].cy;
    const d = dx * dx + dy * dy;
    if (d > maxDist) {
      maxDist = d;
      bossIdx = i;
    }
  }
  rooms[bossIdx].type = 'boss';
  if (rooms[bossIdx].w < 11 && rooms[bossIdx].x + 11 < width - 2) {
    rooms[bossIdx].w = 11;
    rooms[bossIdx].cx = Math.floor(rooms[bossIdx].x + 5);
  }
  if (rooms[bossIdx].h < 11 && rooms[bossIdx].y + 11 < height - 2) {
    rooms[bossIdx].h = 11;
    rooms[bossIdx].cy = Math.floor(rooms[bossIdx].y + 5);
  }

  // Assign Treasure & Shrine rooms among remaining rooms
  const candidates = rooms.filter((r) => r.id !== 0 && r.id !== bossIdx);
  if (candidates.length >= 1) {
    candidates[0].type = 'treasure';
    candidates[0].cleared = true;
  }
  if (candidates.length >= 2) {
    candidates[1].type = 'shrine';
    candidates[1].cleared = true;
  }
  if (candidates.length >= 5 && rng() < 0.7) {
    candidates[candidates.length - 1].type = 'treasure';
    candidates[candidates.length - 1].cleared = true;
  }

  const carveTile = (tx: number, ty: number, val: 1 | 2) => {
    if (tx >= 1 && tx < width - 1 && ty >= 1 && ty < height - 1) {
      tiles[ty * width + tx] = val;
    }
  };

  for (const r of rooms) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        carveTile(x, y, 1);
      }
    }
  }

  // Connect rooms via Prim's MST + extra loop corridors
  const connected = new Set<number>([0]);
  const edges: Array<[number, number]> = [];
  while (connected.size < rooms.length) {
    let bestA = 0;
    let bestB = 0;
    let bestD = Infinity;
    for (const a of connected) {
      for (let b = 0; b < rooms.length; b++) {
        if (connected.has(b)) continue;
        const dx = rooms[a].cx - rooms[b].cx;
        const dy = rooms[a].cy - rooms[b].cy;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          bestA = a;
          bestB = b;
        }
      }
    }
    connected.add(bestB);
    edges.push([bestA, bestB]);
  }

  if (rooms.length > 4) {
    edges.push([1, Math.min(rooms.length - 1, 3)]);
    edges.push([2, Math.min(rooms.length - 1, 4)]);
  }

  const carveCorridor = (ax: number, ay: number, bx: number, by: number) => {
    let x = ax;
    let y = ay;
    const horizFirst = rng() < 0.5;

    const stampWide = (cx: number, cy: number) => {
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (tiles[(cy + oy) * width + (cx + ox)] === 0) {
            carveTile(cx + ox, cy + oy, 2);
          }
        }
      }
    };

    if (horizFirst) {
      while (x !== bx) {
        stampWide(x, y);
        x += x < bx ? 1 : -1;
      }
      while (y !== by) {
        stampWide(x, y);
        y += y < by ? 1 : -1;
      }
    } else {
      while (y !== by) {
        stampWide(x, y);
        y += y < by ? 1 : -1;
      }
      while (x !== bx) {
        stampWide(x, y);
        x += x < bx ? 1 : -1;
      }
    }
    stampWide(bx, by);
  };

  for (const [a, b] of edges) {
    carveCorridor(rooms[a].cx, rooms[a].cy, rooms[b].cx, rooms[b].cy);
  }

  const props: DungeonProp[] = [];
  let propId = 1;

  for (const r of rooms) {
    const centerPxX = (r.cx + 0.5) * tileSize;
    const centerPxY = (r.cy + 0.5) * tileSize;

    if (r.w >= 7 && r.h >= 7) {
      const corners = [
        [(r.x + 1.2) * tileSize, (r.y + 1.2) * tileSize],
        [(r.x + r.w - 1.2) * tileSize, (r.y + r.h - 1.2) * tileSize],
      ];
      for (const [bx, by] of corners) {
        props.push({
          id: `brazier_${propId++}`,
          kind: 'brazier',
          x: bx,
          y: by,
          radius: 14,
          interacted: false,
          broken: false,
        });
      }
    }

    if (r.type === 'treasure') {
      props.push({
        id: `chest_${propId++}`,
        kind: 'chest',
        x: centerPxX,
        y: centerPxY,
        radius: 18,
        interacted: false,
        broken: false,
      });
    } else if (r.type === 'shrine') {
      const variants: Array<'blood' | 'arcane' | 'sanctum'> = ['blood', 'arcane', 'sanctum'];
      props.push({
        id: `shrine_${propId++}`,
        kind: 'shrine',
        x: centerPxX,
        y: centerPxY,
        radius: 20,
        interacted: false,
        broken: false,
        shrineVariant: variants[(floorNumber + r.id) % variants.length],
      });
    } else if (r.type === 'combat') {
      const urnCount = 2 + Math.floor(rng() * 3);
      for (let i = 0; i < urnCount; i++) {
        const ux = (r.x + 1.5 + rng() * (r.w - 3)) * tileSize;
        const uy = (r.y + 1.5 + rng() * (r.h - 3)) * tileSize;
        props.push({
          id: `urn_${propId++}`,
          kind: 'urn',
          x: ux,
          y: uy,
          radius: 13,
          interacted: false,
          broken: false,
        });
      }

      if (rng() < 0.65) {
        props.push({
          id: `trap_${propId++}`,
          kind: 'trap',
          x: centerPxX + (rng() - 0.5) * tileSize * 2,
          y: centerPxY + (rng() - 0.5) * tileSize * 2,
          radius: 22,
          interacted: false,
          broken: false,
          trapTimer: rng() * 2.5,
          trapState: 'idle',
        });
      }
    }
  }

  const floorName =
    FLOOR_NAMES[(floorNumber - 1) % FLOOR_NAMES.length] +
    (floorNumber > FLOOR_NAMES.length ? ` · Profundidad ${floorNumber}` : '');

  return {
    floorNumber,
    name: floorName,
    width,
    height,
    tileSize,
    tiles,
    visibility,
    wallDecor,
    rooms,
    props,
    spawnX: (rooms[0].cx + 0.5) * tileSize,
    spawnY: (rooms[0].cy + 0.5) * tileSize,
    bossRoomId: bossIdx,
  };
}

export function isWalkableTile(floor: DungeonFloor, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= floor.width || ty >= floor.height) return false;
  return floor.tiles[ty * floor.width + tx] !== 0;
}

export function getRoomTypeLabel(type: RoomType): string {
  switch (type) {
    case 'start':
      return 'Entrada';
    case 'treasure':
      return 'Cámara de Tesoro';
    case 'shrine':
      return 'Altar Rúnico';
    case 'boss':
      return 'Santuario del Jefe';
    default:
      return 'Cripta';
  }
}
