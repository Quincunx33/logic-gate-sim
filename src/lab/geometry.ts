import { getDef } from "@/sim/library";
import type { CompInst, PinDef } from "@/sim/types";

const PITCH = 18;

export interface Pt {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

export function isGateSymbol(symbol: string): boolean {
  return ["and", "or", "xor", "not", "nand", "nor", "xnor", "buf"].includes(symbol);
}

export function bodySize(comp: CompInst): { w: number; h: number } {
  const def = getDef(comp.type);
  const count = { left: 0, right: 0, top: 0, bottom: 0 };
  for (const p of def.pins) count[p.side]++;
  if (isGateSymbol(def.symbol)) {
    return { w: 72, h: Math.max(56, Math.max(count.left, count.right) * PITCH + 24) };
  }
  const h = Math.max(def.minH ?? 0, 40, Math.max(count.left, count.right) * PITCH + 26);
  const w = Math.max(def.minW ?? 0, 88, Math.max(count.top, count.bottom) * PITCH + 32);
  return { w, h };
}

function locals(comp: CompInst): { pin: PinDef; x: number; y: number; nx: number; ny: number }[] {
  const { w, h } = bodySize(comp);
  const def = getDef(comp.type);
  const groups: Record<PinDef["side"], PinDef[]> = { left: [], right: [], top: [], bottom: [] };
  for (const p of def.pins) groups[p.side].push(p);
  const out: { pin: PinDef; x: number; y: number; nx: number; ny: number }[] = [];
  (Object.keys(groups) as PinDef["side"][]).forEach((side) => {
    const arr = groups[side];
    arr.forEach((p, i) => {
      const t = (i + 1) / (arr.length + 1);
      if (side === "left") out.push({ pin: p, x: 0, y: t * h, nx: -1, ny: 0 });
      if (side === "right") out.push({ pin: p, x: w, y: t * h, nx: 1, ny: 0 });
      if (side === "top") out.push({ pin: p, x: t * w, y: 0, nx: 0, ny: -1 });
      if (side === "bottom") out.push({ pin: p, x: t * w, y: h, nx: 0, ny: 1 });
    });
  });
  return out;
}

function spin(x: number, y: number, rot: number): { x: number; y: number } {
  if (rot === 90) return { x: -y, y: x };
  if (rot === 180) return { x: -x, y: -y };
  if (rot === 270) return { x: y, y: -x };
  return { x, y };
}

export function pinWorld(comp: CompInst, pinId: string): Pt | null {
  const loc = locals(comp).find((p) => p.pin.id === pinId);
  if (!loc) return null;
  const { w, h } = bodySize(comp);
  let x = loc.x - w / 2;
  const y = loc.y - h / 2;
  let nx = loc.nx;
  const ny = loc.ny;
  if (comp.flip) {
    x = -x;
    nx = -nx;
  }
  const p = spin(x, y, comp.rot);
  const n = spin(nx, ny, comp.rot);
  return { x: comp.x + w / 2 + p.x, y: comp.y + h / 2 + p.y, nx: n.x, ny: n.y };
}

export function worldToLocal(comp: CompInst, wx: number, wy: number): { x: number; y: number } {
  const { w, h } = bodySize(comp);
  let x = wx - (comp.x + w / 2);
  let y = wy - (comp.y + h / 2);
  if (comp.rot === 90) {
    const nx = y;
    const ny = -x;
    x = nx;
    y = ny;
  } else if (comp.rot === 180) {
    x = -x;
    y = -y;
  } else if (comp.rot === 270) {
    const nx = -y;
    const ny = x;
    x = nx;
    y = ny;
  }
  if (comp.flip) x = -x;
  return { x: x + w / 2, y: y + h / 2 };
}

export function hitBody(comp: CompInst, wx: number, wy: number): boolean {
  const { w, h } = bodySize(comp);
  const p = worldToLocal(comp, wx, wy);
  return p.x >= -2 && p.y >= -2 && p.x <= w + 2 && p.y <= h + 2;
}

export function aabb(comp: CompInst): { x: number; y: number; w: number; h: number } {
  const { w, h } = bodySize(comp);
  const corners = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ].map(([px, py]) => {
    let x = px! - w / 2;
    const y = py! - h / 2;
    if (comp.flip) x = -x;
    const s = spin(x, y, comp.rot);
    return { x: comp.x + w / 2 + s.x, y: comp.y + h / 2 + s.y };
  });
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

export function routeWire(a: Pt, b: Pt): { x: number; y: number }[] {
  const stub = 18;
  const a2 = { x: a.x + a.nx * stub, y: a.y + a.ny * stub };
  const b2 = { x: b.x + b.nx * stub, y: b.y + b.ny * stub };
  const horiz = Math.abs(a.nx) >= Math.abs(a.ny);
  const bHoriz = Math.abs(b.nx) >= Math.abs(b.ny);
  if (horiz && bHoriz) {
    const mid = (a2.x + b2.x) / 2;
    return [a, a2, { x: mid, y: a2.y }, { x: mid, y: b2.y }, b2, b];
  }
  if (!horiz && !bHoriz) {
    const mid = (a2.y + b2.y) / 2;
    return [a, a2, { x: a2.x, y: mid }, { x: b2.x, y: mid }, b2, b];
  }
  return [a, a2, { x: horiz ? b2.x : a2.x, y: horiz ? a2.y : b2.y }, b2, b];
}

export function distToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  if (len === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
