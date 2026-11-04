import { useEffect, useRef } from "react";
import { badge, sigKind } from "@/lab/format";
import { aabb, bodySize, distToSeg, hitBody, isGateSymbol, pinWorld, routeWire } from "@/lab/geometry";
import { useLab } from "@/lab/store";
import { getDef, segmentMask } from "@/sim/library";
import { bitsToHex, bitsToNum, type Bits } from "@/sim/signal";
import type { CompInst } from "@/sim/types";

const KIND: Record<string, string> = {
  low: "#3b82f6",
  high: "#2fce7a",
  x: "#f59e0b",
  z: "#7d8b9c",
  err: "#f05252",
  bus: "#d7e0ea",
};

export function Schematic() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const cam = useRef({ x: 40, y: 30, z: 1 });
  const drawRef = useRef<() => void>(() => {});
  const rev = useLab((s) => s.rev);
  const viewEpoch = useLab((s) => s.viewEpoch);
  const placeType = useLab((s) => s.placeType);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const pointers = new Map<number, { x: number; y: number }>();
    let drag:
      | null
      | { kind: "move"; id: string; lastX: number; lastY: number; moved: boolean; undo: boolean }
      | { kind: "marquee"; x0: number; y0: number; x1: number; y1: number }
      | { kind: "pan"; lastX: number; lastY: number }
      | { kind: "wire"; c: string; p: string; x: number; y: number }
      | { kind: "button"; id: string } = null;
    let pinch: { dist: number; z: number } | null = null;
    let space = false;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.floor(r.width * dpr));
      canvas.height = Math.max(1, Math.floor(r.height * dpr));
      canvas.style.width = r.width + "px";
      canvas.style.height = r.height + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };

    const worldOf = (cx: number, cy: number) => {
      const r = canvas.getBoundingClientRect();
      return {
        x: (cx - r.left - cam.current.x) / cam.current.z,
        y: (cy - r.top - cam.current.y) / cam.current.z,
      };
    };

    const fit = () => {
      const comps = useLab.getState().circuit().components;
      const r = wrap.getBoundingClientRect();
      if (comps.length === 0 || r.width < 20) return;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const c of comps) {
        const b = aabb(c);
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.w);
        maxY = Math.max(maxY, b.y + b.h);
      }
      const pad = 64;
      const zw = (r.width - pad) / Math.max(40, maxX - minX);
      const zh = (r.height - pad) / Math.max(40, maxY - minY);
      const z = Math.max(0.35, Math.min(1.45, Math.min(zw, zh)));
      cam.current.z = z;
      cam.current.x = (r.width - (minX + maxX) * z) / 2;
      cam.current.y = (r.height - (minY + maxY) * z) / 2;
      draw();
    };

    const draw = () => {
      const r = wrap.getBoundingClientRect();
      const w = r.width;
      const h = r.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#0c1016";
      ctx.fillRect(0, 0, w, h);
      const { x: panX, y: panY, z } = cam.current;
      ctx.save();
      ctx.translate(panX, panY);
      ctx.scale(z, z);
      drawGrid(ctx, -panX / z, -panY / z, w / z, h / z);
      const state = useLab.getState();
      const circuit = state.circuit();
      const sim = state.sim;
      const animate = !reduce && state.running;

      for (const wire of circuit.wires) {
        const ca = circuit.components.find((c) => c.id === wire.a.c);
        const cb = circuit.components.find((c) => c.id === wire.b.c);
        if (!ca || !cb) continue;
        const pa = pinWorld(ca, wire.a.p);
        const pb = pinWorld(cb, wire.b.p);
        if (!pa || !pb) continue;
        const pts = routeWire(pa, pb);
        const net = sim.netOf(wire.a.c, wire.a.p);
        const bits = net?.bits ?? [];
        const kind = sigKind(bits, net?.conflict || net?.unstable);
        ctx.beginPath();
        ctx.moveTo(pts[0]!.x, pts[0]!.y);
        for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
        ctx.strokeStyle = KIND[kind] ?? KIND.z;
        ctx.lineWidth = (net && net.width > 1 ? 3.2 : 1.7) / Math.max(0.8, Math.min(z, 1.4));
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        if (animate && (kind === "high" || kind === "bus")) {
          ctx.setLineDash([7, 8]);
          ctx.lineDashOffset = -((performance.now() / 35) % 15);
        } else ctx.setLineDash([]);
        ctx.globalAlpha = state.wireSelection.includes(wire.id) ? 1 : 0.92;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        if (state.wireSelection.includes(wire.id) && net) {
          const mid = pts[Math.floor(pts.length / 2)]!;
          const label = bitsToHex(bits) ?? bits.map((b) => (b === 0 ? "0" : b === 1 ? "1" : b === 2 ? "X" : "Z")).reverse().join("");
          ctx.font = "11px 'JetBrains Mono', ui-monospace, monospace";
          ctx.fillStyle = "#0c1016";
          const tw = ctx.measureText(label).width + 8;
          ctx.fillRect(mid.x + 6, mid.y - 16, tw, 16);
          ctx.fillStyle = KIND[kind] ?? "#d7e0ea";
          ctx.fillText(label, mid.x + 10, mid.y - 4);
        }
      }

      const degree = new Map<string, number>();
      for (const wire of circuit.wires) {
        degree.set(wire.a.c + ":" + wire.a.p, (degree.get(wire.a.c + ":" + wire.a.p) ?? 0) + 1);
        degree.set(wire.b.c + ":" + wire.b.p, (degree.get(wire.b.c + ":" + wire.b.p) ?? 0) + 1);
      }
      for (const [key, n] of degree) {
        if (n < 2) continue;
        const [c, p] = key.split(":");
        const comp = circuit.components.find((x) => x.id === c);
        if (!comp || !p) continue;
        const pt = pinWorld(comp, p);
        if (!pt) continue;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = "#d7e0ea";
        ctx.fill();
      }

      for (const comp of circuit.components) drawComp(ctx, comp, state.selection.includes(comp.id), sim);

      const wiring = drag;
      if (wiring?.kind === "wire") {
        const comp = circuit.components.find((c) => c.id === wiring.c);
        const pt = comp ? pinWorld(comp, wiring.p) : null;
        if (pt) {
          ctx.beginPath();
          ctx.moveTo(pt.x, pt.y);
          ctx.lineTo(wiring.x, wiring.y);
          ctx.strokeStyle = "#3d9eff";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      if (drag?.kind === "marquee") {
        const x = Math.min(drag.x0, drag.x1);
        const y = Math.min(drag.y0, drag.y1);
        ctx.fillStyle = "rgba(61, 158, 255, 0.12)";
        ctx.strokeStyle = "#3d9eff";
        ctx.lineWidth = 1;
        ctx.fillRect(x, y, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
        ctx.strokeRect(x, y, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
      }
      ctx.restore();

      if (state.placeType) {
        ctx.fillStyle = "#8b9bb0";
        ctx.font = "12px Inter, system-ui, sans-serif";
        ctx.fillText("Click to place " + getDef(state.placeType).label + "   ·   Esc cancels", 12, h - 12);
      }
    };
    drawRef.current = draw;

    const hitPin = (wx: number, wy: number, isTouch = false) => {
      let best: { c: string; p: string; d: number } | null = null;
      // Generous threshold for touchscreens (mobile/tablet/TV touch)
      const threshold = (isTouch ? 22 : 12) / cam.current.z;
      for (const comp of useLab.getState().circuit().components) {
        for (const p of getDef(comp.type).pins) {
          const pt = pinWorld(comp, p.id);
          if (!pt) continue;
          const d = Math.hypot(pt.x - wx, pt.y - wy);
          if (d < threshold && (!best || d < best.d)) best = { c: comp.id, p: p.id, d };
        }
      }
      return best;
    };

    const hitWire = (wx: number, wy: number) => {
      const circuit = useLab.getState().circuit();
      let best: { id: string; d: number } | null = null;
      for (const wire of circuit.wires) {
        const ca = circuit.components.find((c) => c.id === wire.a.c);
        const cb = circuit.components.find((c) => c.id === wire.b.c);
        if (!ca || !cb) continue;
        const pa = pinWorld(ca, wire.a.p);
        const pb = pinWorld(cb, wire.b.p);
        if (!pa || !pb) continue;
        const pts = routeWire(pa, pb);
        for (let i = 0; i < pts.length - 1; i++) {
          const d = distToSeg(wx, wy, pts[i]!.x, pts[i]!.y, pts[i + 1]!.x, pts[i + 1]!.y);
          if (d < 7 / cam.current.z && (!best || d < best.d)) best = { id: wire.id, d };
        }
      }
      return best;
    };

    const onDown = (e: PointerEvent) => {
      if (e.button === 2) return;
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [p1, p2] = [...pointers.values()];
        pinch = { dist: Math.hypot(p1!.x - p2!.x, p1!.y - p2!.y), z: cam.current.z };
        drag = null;
        return;
      }
      const wpt = worldOf(e.clientX, e.clientY);
      const store = useLab.getState();
      if (e.button === 1 || space) {
        drag = { kind: "pan", lastX: e.clientX, lastY: e.clientY };
        return;
      }
      if (store.placeType) {
        store.placeAt(wpt.x, wpt.y);
        draw();
        return;
      }
      const isTouch = e.pointerType === "touch";
      const pin = hitPin(wpt.x, wpt.y, isTouch);
      if (pin && e.shiftKey === false) {
        drag = { kind: "wire", c: pin.c, p: pin.p, x: wpt.x, y: wpt.y };
        return;
      }
      const comps = [...store.circuit().components].reverse();
      const hit = comps.find((c) => hitBody(c, wpt.x, wpt.y));
      if (hit) {
        if (hit.type === "button") {
          store.setButton(hit.id, true);
          store.selectComps([hit.id]);
          drag = { kind: "button", id: hit.id };
          draw();
          return;
        }
        const ids = e.shiftKey ? [...new Set([...store.selection, hit.id])] : store.selection.includes(hit.id) ? store.selection : [hit.id];
        store.selectComps(ids);
        drag = { kind: "move", id: hit.id, lastX: wpt.x, lastY: wpt.y, moved: false, undo: false };
        return;
      }
      if (e.pointerType === "touch") {
        drag = { kind: "pan", lastX: e.clientX, lastY: e.clientY };
        return;
      }
      drag = { kind: "marquee", x0: wpt.x, y0: wpt.y, x1: wpt.x, y1: wpt.y };
    };

    const onMove = (e: PointerEvent) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size >= 2) {
        const [p1, p2] = [...pointers.values()];
        const dist = Math.hypot(p1!.x - p2!.x, p1!.y - p2!.y);
        const next = Math.max(0.3, Math.min(2.6, pinch.z * (dist / Math.max(8, pinch.dist))));
        const rect = canvas.getBoundingClientRect();
        const mx = (p1!.x + p2!.x) / 2 - rect.left;
        const my = (p1!.y + p2!.y) / 2 - rect.top;
        const wx = (mx - cam.current.x) / cam.current.z;
        const wy = (my - cam.current.y) / cam.current.z;
        cam.current.z = next;
        cam.current.x = mx - wx * next;
        cam.current.y = my - wy * next;
        draw();
        return;
      }
      const wpt = worldOf(e.clientX, e.clientY);
      if (!drag) return;
      if (drag.kind === "pan") {
        cam.current.x += e.clientX - drag.lastX;
        cam.current.y += e.clientY - drag.lastY;
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
        draw();
        return;
      }
      if (drag.kind === "wire") {
        drag.x = wpt.x;
        drag.y = wpt.y;
        draw();
        return;
      }
      if (drag.kind === "marquee") {
        drag.x1 = wpt.x;
        drag.y1 = wpt.y;
        draw();
        return;
      }
      if (drag.kind === "move") {
        const dx = wpt.x - drag.lastX;
        const dy = wpt.y - drag.lastY;
        if (!drag.moved && Math.hypot(dx, dy) < 3) return;
        if (!drag.undo) {
          useLab.getState().pushUndo();
          drag.undo = true;
        }
        drag.moved = true;
        const ids = useLab.getState().selection;
        useLab.getState().moveBy(ids.length ? ids : [drag.id], dx, dy);
        drag.lastX = wpt.x;
        drag.lastY = wpt.y;
        draw();
      }
    };

    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      const wpt = worldOf(e.clientX, e.clientY);
      const store = useLab.getState();
      if (drag?.kind === "button") store.setButton(drag.id, false);
      if (drag?.kind === "wire") {
        const pin = hitPin(wpt.x, wpt.y, e.pointerType === "touch");
        if (pin && !(pin.c === drag.c && pin.p === drag.p)) store.addWire({ c: drag.c, p: drag.p }, pin);
      }
      if (drag?.kind === "marquee") {
        const x = Math.min(drag.x0, drag.x1);
        const y = Math.min(drag.y0, drag.y1);
        const w = Math.abs(drag.x1 - drag.x0);
        const h = Math.abs(drag.y1 - drag.y0);
        if (w < 4 && h < 4) {
          const wire = hitWire(wpt.x, wpt.y);
          if (wire) store.selectWires([wire.id]);
          else store.clearSelection();
        } else {
          const ids = store
            .circuit()
            .components.filter((c) => {
              const b = aabb(c);
              return b.x < x + w && b.x + b.w > x && b.y < y + h && b.y + b.h > y;
            })
            .map((c) => c.id);
          store.selectComps(ids);
        }
      }
      const moving = drag;
      if (moving?.kind === "move" && !moving.moved) {
        const comp = store.circuit().components.find((c) => c.id === moving.id);
        if (comp?.type === "toggle") store.toggleSwitch(comp.id);
      }
      drag = null;
      draw();
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const wx = (mx - cam.current.x) / cam.current.z;
      const wy = (my - cam.current.y) / cam.current.z;
      const factor = e.deltaY < 0 ? 1.08 : 0.92;
      const next = Math.max(0.3, Math.min(2.6, cam.current.z * factor));
      cam.current.z = next;
      cam.current.x = mx - wx * next;
      cam.current.y = my - wy * next;
      draw();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") space = true;
      if (e.key === "Escape") {
        useLab.getState().setPlace(null);
        drag = null;
        draw();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") space = false;
    };

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    resize();
    fit();

    return () => {
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    const comps = useLab.getState().circuit().components;
    const wrap = wrapRef.current;
    if (!wrap || comps.length === 0) return;
    const r = wrap.getBoundingClientRect();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of comps) {
      const b = aabb(c);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }
    const focus = useLab.getState().focusId;
    if (focus) {
      const c = comps.find((x) => x.id === focus);
      if (c) {
        const b = aabb(c);
        cam.current.z = Math.max(cam.current.z, 1);
        cam.current.x = r.width / 2 - (b.x + b.w / 2) * cam.current.z;
        cam.current.y = r.height / 2 - (b.y + b.h / 2) * cam.current.z;
        drawRef.current();
        return;
      }
    }
    const pad = 72;
    const z = Math.max(0.35, Math.min(1.4, Math.min((r.width - pad) / Math.max(40, maxX - minX), (r.height - pad) / Math.max(40, maxY - minY))));
    cam.current.z = z;
    cam.current.x = (r.width - (minX + maxX) * z) / 2;
    cam.current.y = (r.height - (minY + maxY) * z) / 2;
    drawRef.current();
  }, [viewEpoch]);

  useEffect(() => {
    drawRef.current();
  }, [rev, placeType]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      if (useLab.getState().running) drawRef.current();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const zoomBy = (factor: number) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const mx = r.width / 2;
    const my = r.height / 2;
    const wx = (mx - cam.current.x) / cam.current.z;
    const wy = (my - cam.current.y) / cam.current.z;
    const next = Math.max(0.3, Math.min(2.6, cam.current.z * factor));
    cam.current.z = next;
    cam.current.x = mx - wx * next;
    cam.current.y = my - wy * next;
    drawRef.current();
  };

  return (
    <div ref={wrapRef} className={"lm-canvas" + (placeType ? " is-place" : "")} suppressHydrationWarning>
      <canvas ref={canvasRef} suppressHydrationWarning />
      <div className="lm-canvas-controls" aria-label="Canvas zoom and pan controls">
        <button
          type="button"
          className="lm-canvas-btn"
          title="Zoom in"
          aria-label="Zoom in"
          onClick={() => zoomBy(1.2)}
        >
          +
        </button>
        <button
          type="button"
          className="lm-canvas-btn"
          title="Zoom out"
          aria-label="Zoom out"
          onClick={() => zoomBy(0.83)}
        >
          −
        </button>
        <button
          type="button"
          className="lm-canvas-btn is-label"
          title="Fit schematic to screen"
          aria-label="Fit schematic to screen"
          onClick={() => useLab.getState().fitView()}
        >
          Fit
        </button>
      </div>
    </div>
  );
}

function drawGrid(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const step = 16;
  const x0 = Math.floor(x / step) * step;
  const y0 = Math.floor(y / step) * step;
  ctx.beginPath();
  for (let gx = x0; gx < x + w; gx += step) {
    ctx.moveTo(gx, y);
    ctx.lineTo(gx, y + h);
  }
  for (let gy = y0; gy < y + h; gy += step) {
    ctx.moveTo(x, gy);
    ctx.lineTo(x + w, gy);
  }
  ctx.strokeStyle = "rgba(148, 176, 204, 0.08)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawComp(ctx: CanvasRenderingContext2D, comp: CompInst, selected: boolean, sim: ReturnType<typeof useLab.getState>["sim"]) {
  const def = getDef(comp.type);
  const { w, h } = bodySize(comp);
  ctx.save();
  ctx.translate(comp.x + w / 2, comp.y + h / 2);
  ctx.rotate((comp.rot * Math.PI) / 180);
  if (comp.flip) ctx.scale(-1, 1);
  ctx.translate(-w / 2, -h / 2);

  if (def.symbol === "label") {
    ctx.font = "13px Inter, system-ui, sans-serif";
    ctx.fillStyle = "#8b9bb0";
    ctx.fillText(String(comp.params.text ?? comp.label), 0, 16);
    ctx.restore();
    if (selected) {
      ctx.save();
      ctx.strokeStyle = "#3d9eff";
      ctx.strokeRect(comp.x - 2, comp.y - 2, w + 4, 22);
      ctx.restore();
    }
    return;
  }

  ctx.fillStyle = "#161d27";
  ctx.strokeStyle = selected ? "#3d9eff" : "#2c3a4b";
  ctx.lineWidth = selected ? 2 : 1.25;

  if (isGateSymbol(def.symbol)) drawGate(ctx, def.symbol, w, h);
  else if (def.symbol === "bus") {
    ctx.fillStyle = "#121820";
    roundRect(ctx, 0, 6, w, h - 12, 6);
    ctx.fill();
    ctx.stroke();
  } else if (def.symbol === "led") {
    roundRect(ctx, 0, 4, w - 18, h - 8, 8);
    ctx.fill();
    ctx.stroke();
    const bits = sim.pinBits(comp.id, "A");
    const kind = sigKind(bits);
    ctx.beginPath();
    ctx.arc(w - 16, h / 2, 9, 0, Math.PI * 2);
    ctx.fillStyle = kind === "high" ? "#2fce7a" : kind === "low" ? "#1d4e89" : kind === "x" ? "#f59e0b" : "#3a4452";
    ctx.fill();
    if (kind === "high") {
      ctx.shadowColor = "#2fce7a";
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  } else if (def.symbol === "switch" || def.symbol === "btn") {
    roundRect(ctx, 0, 4, w, h - 8, 8);
    ctx.fill();
    ctx.stroke();
    const on = comp.type === "button" ? !!comp.params.down : !!comp.params.on;
    ctx.beginPath();
    ctx.moveTo(16, h / 2);
    ctx.lineTo(on ? 40 : 28, on ? h / 2 - 12 : h / 2 - 4);
    ctx.strokeStyle = on ? "#2fce7a" : "#8b9bb0";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(16, h / 2, 3, 0, Math.PI * 2);
    ctx.fillStyle = on ? "#2fce7a" : "#8b9bb0";
    ctx.fill();
  } else if (def.symbol === "clock") {
    roundRect(ctx, 0, 4, w, h - 8, 8);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.strokeStyle = sim.stateOf(comp.id).level === 1 ? "#2fce7a" : "#3b82f6";
    ctx.lineWidth = 1.6;
    ctx.moveTo(12, h / 2 + 6);
    ctx.lineTo(22, h / 2 + 6);
    ctx.lineTo(22, h / 2 - 8);
    ctx.lineTo(36, h / 2 - 8);
    ctx.lineTo(36, h / 2 + 6);
    ctx.lineTo(48, h / 2 + 6);
    ctx.stroke();
  } else if (def.symbol === "const") {
    roundRect(ctx, 0, 6, w - 8, h - 12, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = comp.type === "vcc" ? "#2fce7a" : "#3b82f6";
    ctx.font = "600 12px 'JetBrains Mono', ui-monospace, monospace";
    ctx.fillText(comp.type === "vcc" ? "1" : "0", 14, h / 2 + 4);
  } else if (def.symbol === "seg") {
    roundRect(ctx, 0, 0, w, h, 8);
    ctx.fill();
    ctx.stroke();
    const nib = [sim.pinBits(comp.id, "A")[0], sim.pinBits(comp.id, "B")[0], sim.pinBits(comp.id, "C")[0], sim.pinBits(comp.id, "D")[0]];
    const known = nib.every((b) => b === 0 || b === 1);
    const n = known ? (nib[0] ? 1 : 0) | (nib[1] ? 2 : 0) | (nib[2] ? 4 : 0) | (nib[3] ? 8 : 0) : null;
    drawSegments(ctx, 28, 10, 22, 64, segmentMask(n));
  } else if (def.symbol === "hex" || def.symbol === "num" || def.symbol === "probe") {
    roundRect(ctx, 0, 4, w, h - 8, 8);
    ctx.fill();
    ctx.stroke();
  } else {
    roundRect(ctx, 0, 0, w, h, 8);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();

  // Upright label and badge
  ctx.save();
  ctx.font = "600 11px Inter, system-ui, sans-serif";
  ctx.fillStyle = "#d7e0ea";
  ctx.textAlign = "center";
  const box = aabb(comp);
  if (def.symbol !== "const" && def.symbol !== "switch" && def.symbol !== "btn" && def.symbol !== "led") {
    ctx.fillText(comp.label, box.x + box.w / 2, box.y + 16);
  } else if (def.symbol === "led" || def.symbol === "switch" || def.symbol === "btn") {
    ctx.fillText(comp.label, box.x + box.w / 2, box.y + box.h + 14);
  }
  const b = badge(comp, sim.stateOf(comp.id));
  if (b) {
    ctx.font = "11px 'JetBrains Mono', ui-monospace, monospace";
    ctx.fillStyle = "#3d9eff";
    ctx.fillText(b, box.x + box.w / 2, box.y + (def.symbol === "box" ? 32 : box.h / 2 + 4));
  }
  if (def.symbol === "hex" || def.symbol === "num" || def.symbol === "probe") {
    const pin = def.symbol === "probe" ? "A" : "D";
    const bits = sim.pinBits(comp.id, pin);
    const text = bits.length > 1 ? (bitsToHex(bits) ?? "X") : bits[0] === 0 ? "0" : bits[0] === 1 ? "1" : bits[0] === 2 ? "X" : "Z";
    ctx.font = "600 16px 'JetBrains Mono', ui-monospace, monospace";
    ctx.fillStyle = KIND[sigKind(bits, sim.netOf(comp.id, pin)?.conflict)];
    ctx.fillText(text, box.x + box.w / 2, box.y + box.h / 2 + 6);
    if (def.symbol === "num") {
      const n = bitsToNum(bits);
      ctx.font = "11px 'JetBrains Mono', ui-monospace, monospace";
      ctx.fillStyle = "#8b9bb0";
      ctx.fillText(n === null ? "" : String(n), box.x + box.w / 2, box.y + box.h / 2 + 20);
    }
  }
  ctx.restore();

  for (const p of def.pins) {
    const pt = pinWorld(comp, p.id);
    if (!pt) continue;
    const bits: Bits = sim.pinBits(comp.id, p.id);
    const net = sim.netOf(comp.id, p.id);
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, p.width > 1 ? 4.2 : 3.3, 0, Math.PI * 2);
    ctx.fillStyle = KIND[sigKind(bits, net?.conflict)];
    ctx.fill();
    ctx.strokeStyle = "#0c1016";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawGate(ctx: CanvasRenderingContext2D, symbol: string, w: number, h: number) {
  const bubble = symbol === "nand" || symbol === "nor" || symbol === "xnor" || symbol === "not";
  const shape = symbol === "nand" ? "and" : symbol === "nor" ? "or" : symbol === "xnor" ? "xor" : symbol;
  ctx.beginPath();
  if (shape === "and") {
    ctx.moveTo(10, 10);
    ctx.lineTo(w * 0.42, 10);
    ctx.bezierCurveTo(w - 8, 10, w - 8, h - 10, w * 0.42, h - 10);
    ctx.lineTo(10, h - 10);
    ctx.closePath();
  } else if (shape === "or" || shape === "xor") {
    ctx.moveTo(12, 10);
    ctx.quadraticCurveTo(w * 0.55, 10, w - 14, h / 2);
    ctx.quadraticCurveTo(w * 0.55, h - 10, 12, h - 10);
    ctx.quadraticCurveTo(28, h / 2, 12, 10);
  } else if (shape === "not" || shape === "buf") {
    ctx.moveTo(12, 10);
    ctx.lineTo(12, h - 10);
    ctx.lineTo(w - 18, h / 2);
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();
  if (shape === "xor") {
    ctx.beginPath();
    ctx.moveTo(8, 10);
    ctx.quadraticCurveTo(22, h / 2, 8, h - 10);
    ctx.stroke();
  }
  if (bubble) {
    ctx.beginPath();
    ctx.arc(w - 10, h / 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function drawSegments(ctx: CanvasRenderingContext2D, x: number, y: number, sw: number, sh: number, mask: number | null) {
  const on = (bit: number) => mask !== null && (mask & bit) !== 0;
  const color = (bit: number) => (on(bit) ? "#2fce7a" : "#243041");
  const t = 4;
  const seg = (bit: number, px: number, py: number, pw: number, ph: number) => {
    ctx.fillStyle = color(bit);
    ctx.fillRect(x + px, y + py, pw, ph);
  };
  seg(1, t, 0, sw, t);
  seg(2, sw + t, t, t, sh / 2 - t);
  seg(4, sw + t, sh / 2, t, sh / 2 - t);
  seg(8, t, sh - t, sw, t);
  seg(16, 0, sh / 2, t, sh / 2 - t);
  seg(32, 0, t, t, sh / 2 - t);
  seg(64, t, sh / 2 - t / 2, sw, t);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
