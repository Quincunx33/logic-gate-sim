/**
 * Event-driven four-state simulator.
 *
 * Nets are the connected components of pins (wires + internal bus shorts).
 * Combinational outputs settle on a work queue. Clocked parts sample a frozen
 * input snapshot on a 0→1 edge, then the network settles again. A combinational
 * cycle that does not reach a fixed point is reported as oscillation and the
 * unstable nets are forced to X — never a random 0/1.
 */
import { formulaError, getBehavior, getDef } from "./library.ts";
import { LOW, HIGH, X, Z, bitsEq, fill, fit, sigChar, type Bits, type Sig } from "./signal.ts";
import { pinKey, type Circuit, type CompInst, type CompState, type Endpoint, type ParamValue } from "./types.ts";

export interface Net {
  id: string;
  pins: Endpoint[];
  bits: Bits;
  width: number;
  conflict: boolean;
  /** No driver is forcing a level (every driver is Z, or there is no driver). */
  floating: boolean;
  unstable: boolean;
  history: { t: number; text: string }[];
}

export interface SimIssue {
  level: "error" | "warn" | "info";
  code: string;
  message: string;
  compId?: string;
  pin?: string;
  wireId?: string;
  netId?: string;
}

export interface SimEvent {
  t: number;
  msg: string;
}


export class Simulator {
  circuit: Circuit;
  time = 0;
  nets: Net[] = [];
  issues: SimIssue[] = [];
  events: SimEvent[] = [];
  oscillating = false;
  halted = false;

  private state = new Map<string, CompState>();
  private drivers = new Map<string, Bits>();
  private pinToNet = new Map<string, Net>();
  private compById = new Map<string, CompInst>();
  private badWires: { wireId: string; message: string }[] = [];
  private oscNoted = false;

  constructor(circuit: Circuit) {
    this.circuit = circuit;
    this.rebuild(true);
  }

  /** Replace the netlist. State is kept for components whose id and type survive. */
  sync(circuit: Circuit) {
    this.circuit = circuit;
    this.rebuild(false);
  }

  reset() {
    this.time = 0;
    this.oscillating = false;
    this.oscNoted = false;
    this.halted = false;
    for (const c of this.circuit.components) {
      this.state.set(c.id, getBehavior(c.type).init(c.params));
    }
    this.drivers.clear();
    for (const net of this.nets) {
      net.bits = fill(Z, net.width);
      net.conflict = false;
      net.floating = true;
      net.unstable = false;
      net.history = [];
    }
    this.note("Reset. Registers cleared, memory image restored, time set to 0.");
    this.settle();
  }

  setParam(id: string, key: string, value: ParamValue) {
    this.setParams([[id, key, value]]);
  }

  setParams(entries: [string, string, ParamValue][]) {
    for (const [id, key, value] of entries) {
      const c = this.compById.get(id);
      if (!c) continue;
      c.params = { ...c.params, [key]: value };
      if (key === "words" && Array.isArray(value)) {
        const st = this.state.get(id) ?? {};
        this.state.set(id, { ...st, mem: value.map((n) => (Number(n) || 0) & 255) });
      }
    }
    this.settle();
  }

  /** Advance every clock one tick and sample rising edges. */
  tick() {
    this.time++;
    const before = new Map<string, Sig>();
    for (const c of this.circuit.components) {
      const def = getDef(c.type);
      if (!def.clk) continue;
      before.set(c.id, this.levelOf(c.id, def.clk));
    }
    let autonomous = false;
    for (const c of this.circuit.components) {
      const beh = getBehavior(c.type);
      if (!beh.step) continue;
      this.state.set(c.id, beh.step(this.state.get(c.id) ?? {}, c.params));
      autonomous = true;
    }
    if (autonomous) this.settle();

    const rising: CompInst[] = [];
    for (const c of this.circuit.components) {
      const def = getDef(c.type);
      if (!def.clk) continue;
      const now = this.levelOf(c.id, def.clk);
      if (before.get(c.id) === LOW && now === HIGH) rising.push(c);
    }
    if (rising.length) {
      const snaps = new Map<string, Record<string, Bits>>();
      for (const c of rising) snaps.set(c.id, this.readInputs(c));
      for (const c of rising) {
        const beh = getBehavior(c.type);
        if (!beh.rise) continue;
        const next = beh.rise(snaps.get(c.id) ?? {}, this.state.get(c.id) ?? {}, c.params);
        this.state.set(c.id, next);
      }
      this.settle();
    }
    this.syncHalted();
  }

  stateOf(id: string): CompState {
    return this.state.get(id) ?? {};
  }

  pinBits(compId: string, pinId: string): Bits {
    const c = this.compById.get(compId);
    if (!c) return [X];
    const def = getDef(c.type);
    const pin = def.pins.find((p) => p.id === pinId);
    if (!pin) return [X];
    if (pin.dir === "out") return fit(this.drivers.get(pinKey(compId, pinId)), pin.width, Z);
    return this.readPin(c, pin.id);
  }

  netOf(compId: string, pinId: string): Net | undefined {
    return this.pinToNet.get(pinKey(compId, pinId));
  }

  inputsOf(compId: string): Record<string, Bits> {
    const c = this.compById.get(compId);
    if (!c) return {};
    return this.readInputs(c);
  }

  private rebuild(fresh: boolean) {
    this.compById = new Map(this.circuit.components.map((c) => [c.id, c]));
    if (fresh) this.state.clear();
    for (const c of this.circuit.components) {
      const prev = this.state.get(c.id);
      if (!prev || fresh) this.state.set(c.id, getBehavior(c.type).init(c.params));
    }
    for (const id of [...this.state.keys()]) {
      if (!this.compById.has(id)) this.state.delete(id);
    }
    this.drivers.clear();
    this.buildNets();
    this.settle();
  }

  private buildNets() {
    this.badWires = [];
    const parent = new Map<string, string>();
    const find = (k: string): string => {
      let c = k;
      while (parent.get(c) !== c) {
        parent.set(c, parent.get(parent.get(c)!)!);
        c = parent.get(c)!;
      }
      return c;
    };
    const union = (a: string, b: string) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    const ensure = (k: string) => {
      if (!parent.has(k)) parent.set(k, k);
    };

    for (const c of this.circuit.components) {
      const def = getDef(c.type);
      for (const p of def.pins) ensure(pinKey(c.id, p.id));
      for (const group of def.shorts ?? []) {
        if (group.length === 0) continue;
        const head = pinKey(c.id, group[0]!);
        ensure(head);
        for (const id of group) union(head, pinKey(c.id, id));
      }
    }

    for (const w of this.circuit.wires) {
      const ca = this.compById.get(w.a.c);
      const cb = this.compById.get(w.b.c);
      if (!ca || !cb) {
        this.badWires.push({ wireId: w.id, message: `Wire ${w.id} points at a missing component.` });
        continue;
      }
      const pa = getDef(ca.type).pins.find((p) => p.id === w.a.p);
      const pb = getDef(cb.type).pins.find((p) => p.id === w.b.p);
      if (!pa || !pb) {
        this.badWires.push({ wireId: w.id, message: `Wire ${w.id} uses a pin that does not exist.` });
        continue;
      }
      if (pa.width !== pb.width) {
        this.badWires.push({
          wireId: w.id,
          message: `${ca.label} ${pa.name} is ${pa.width} bit(s) but ${cb.label} ${pb.name} is ${pb.width}. The wire was not connected.`,
        });
        continue;
      }
      const ka = pinKey(w.a.c, w.a.p);
      const kb = pinKey(w.b.c, w.b.p);
      ensure(ka);
      ensure(kb);
      union(ka, kb);
    }

    const groups = new Map<string, Endpoint[]>();
    for (const k of parent.keys()) {
      const root = find(k);
      const [c, p] = k.split(":");
      const list = groups.get(root) ?? [];
      list.push({ c: c!, p: p! });
      groups.set(root, list);
    }

    this.nets = [];
    this.pinToNet.clear();
    for (const pins of groups.values()) {
      const sample = pins[0]!;
      const comp = this.compById.get(sample.c);
      const pdef = comp ? getDef(comp.type).pins.find((p) => p.id === sample.p) : undefined;
      const width = pdef?.width ?? 1;
      const id = pins
        .map((e) => pinKey(e.c, e.p))
        .sort()
        .join("|");
      const net: Net = {
        id,
        pins,
        bits: fill(Z, width),
        width,
        conflict: false,
        floating: true,
        unstable: false,
        history: [],
      };
      this.nets.push(net);
      for (const e of pins) this.pinToNet.set(pinKey(e.c, e.p), net);
    }
  }

  private settle() {
    this.oscillating = false;
    // Resolve nets from whatever outputs exist. Missing outputs are treated as 0
    // so a gate wired in a loop is forced to toggle instead of sitting at X.
    for (const net of this.nets) {
      const resolved = this.resolve(net);
      net.bits = resolved.bits;
      net.conflict = resolved.conflict;
      net.floating = resolved.floating;
    }
    const queue: string[] = [];
    const queued = new Set<string>();
    const enqueue = (id: string) => {
      if (!queued.has(id)) {
        queued.add(id);
        queue.push(id);
      }
    };
    for (const c of this.circuit.components) enqueue(c.id);

    const changes = new Map<string, number>();
    const limit = Math.max(48, this.circuit.components.length * 10);
    let steps = 0;

    while (queue.length) {
      if (steps++ > limit) {
        this.oscillating = true;
        break;
      }
      const id = queue.shift()!;
      queued.delete(id);
      const comp = this.compById.get(id);
      if (!comp) continue;
      const def = getDef(comp.type);
      const beh = getBehavior(comp.type);
      const inputs = this.readInputs(comp);
      const prev = this.state.get(id) ?? {};
      const result = beh.outputs(inputs, prev, comp.params);
      if (result.state) this.state.set(id, result.state);
      for (const pin of def.pins) {
        if (pin.dir !== "out") continue;
        const nv = fit(result.out[pin.id], pin.width, Z);
        const key = pinKey(id, pin.id);
        const old = this.drivers.get(key);
        if (old && bitsEq(old, nv)) continue;
        this.drivers.set(key, nv.slice());
        const net = this.pinToNet.get(key);
        if (!net) continue;
        const resolved = this.resolve(net);
        if (bitsEq(net.bits, resolved.bits) && net.conflict === resolved.conflict && net.floating === resolved.floating) {
          continue;
        }
        this.remember(net);
        net.bits = resolved.bits;
        net.conflict = resolved.conflict;
        net.floating = resolved.floating;
        net.unstable = false;
        const n = (changes.get(net.id) ?? 0) + 1;
        changes.set(net.id, n);
        if (n > Math.max(12, this.circuit.components.length + 4)) this.oscillating = true;
        for (const ep of net.pins) enqueue(ep.c);
      }
      if (this.oscillating) break;
    }

    if (this.oscillating) {
      for (const net of this.nets) {
        if ((changes.get(net.id) ?? 0) > 4) {
          net.bits = fill(X, net.width);
          net.unstable = true;
          net.conflict = false;
          net.floating = false;
        }
      }
      if (!this.oscNoted) {
        this.note("Oscillation: a combinational loop did not settle. Unstable nets are X.");
        this.oscNoted = true;
      }
    } else {
      this.oscNoted = false;
    }
    this.syncHalted();
    this.rebuildIssues();
  }

  private resolve(net: Net): { bits: Bits; conflict: boolean; floating: boolean } {
    const drivers: Bits[] = [];
    for (const ep of net.pins) {
      const comp = this.compById.get(ep.c);
      if (!comp) continue;
      const p = getDef(comp.type).pins.find((x) => x.id === ep.p);
      if (!p || p.dir !== "out") continue;
      const stored = this.drivers.get(pinKey(ep.c, ep.p));
      // Unevaluated outputs start at 0 so an inverter loop actually toggles.
      // Tri-state parts replace that with Z on their first evaluation.
      drivers.push(fit(stored ?? fill(LOW, net.width), net.width, LOW));
    }
    const bits = fill(Z, net.width);
    let conflict = false;
    let anyDrive = false;
    for (let b = 0; b < net.width; b++) {
      let v: Sig = Z;
      let driven = false;
      let bad = false;
      for (const d of drivers) {
        const s = d[b] ?? Z;
        if (s === Z) continue;
        anyDrive = true;
        if (!driven) {
          v = s;
          driven = true;
        } else if (s !== v) bad = true;
      }
      if (bad) {
        bits[b] = X;
        conflict = true;
      } else bits[b] = v;
    }
    return { bits, conflict, floating: !anyDrive };
  }

  private remember(net: Net) {
    const text = net.bits.map(sigChar).reverse().join("");
    const last = net.history[net.history.length - 1];
    if (last && last.text === text && last.t === this.time) return;
    net.history.push({ t: this.time, text });
    if (net.history.length > 24) net.history.shift();
  }

  private readInputs(comp: CompInst): Record<string, Bits> {
    const out: Record<string, Bits> = {};
    for (const p of getDef(comp.type).pins) {
      if (p.dir !== "in") continue;
      out[p.id] = this.readPin(comp, p.id);
    }
    return out;
  }

  private readPin(comp: CompInst, pinId: string): Bits {
    const p = getDef(comp.type).pins.find((x) => x.id === pinId)!;
    const net = this.pinToNet.get(pinKey(comp.id, pinId));
    if (!net) return fill(p.float ?? X, p.width);
    return net.bits.map((s) => (s === Z ? (p.float ?? X) : s));
  }

  private levelOf(compId: string, pinId: string): Sig {
    const c = this.compById.get(compId);
    if (!c) return X;
    return this.readPin(c, pinId)[0] ?? X;
  }

  private syncHalted() {
    let halted = false;
    for (const c of this.circuit.components) {
      if (this.state.get(c.id)?.halted) halted = true;
    }
    if (halted && !this.halted) this.note("Control unit halted.");
    this.halted = halted;
  }

  private note(msg: string) {
    this.events.push({ t: this.time, msg });
    if (this.events.length > 200) this.events.shift();
  }

  private rebuildIssues() {
    const issues: SimIssue[] = [];
    for (const b of this.badWires) {
      issues.push({ level: "error", code: "width", message: b.message, wireId: b.wireId });
    }
    if (this.oscillating) {
      issues.push({
        level: "error",
        code: "oscillation",
        message: "The combinational network did not reach a stable value. See the red-orange nets forced to X. A NOT gate wired to itself does this; a flip-flop does not, because its output only changes on a clock edge.",
      });
    }
    const cycles = this.combinationalCycles();
    if (cycles.length && !this.oscillating) {
      issues.push({
        level: "warn",
        code: "feedback",
        message:
          "Combinational feedback: " +
          cycles.slice(0, 4).join("; ") +
          ". If the values settled, this may be a latch built from gates. If it chatters, break the loop with a clocked flip-flop.",
      });
    } else if (cycles.length && this.oscillating) {
      issues.push({
        level: "error",
        code: "loop",
        message: "Combinational loop: " + cycles.slice(0, 4).join("; ") + ".",
      });
    }
    for (const net of this.nets) {
      if (net.conflict) {
        const who = this.driverNames(net).join(", ");
        issues.push({
          level: "error",
          code: "conflict",
          netId: net.id,
          message: `Conflicting drivers on one net (${who || "unknown"}). Two strong outputs disagree, so the net is X.`,
        });
      }
    }
    for (const c of this.circuit.components) {
      const def = getDef(c.type);
      if (c.type === "srlatch" && this.state.get(c.id)?.invalid) {
        issues.push({
          level: "warn",
          code: "sr-invalid",
          compId: c.id,
          message: `${c.label}: S and R are both 1. A NOR latch drives Q and QN to 0 in this illegal state.`,
        });
      }
      if (c.type === "expr") {
        const err = formulaError(String(c.params.formula ?? ""));
        if (err) issues.push({ level: "error", code: "formula", compId: c.id, message: `${c.label}: ${err}` });
      }
      for (const p of def.pins) {
        if (p.dir !== "in") continue;
        if (p.float !== undefined && p.float !== X) continue;
        const net = this.pinToNet.get(pinKey(c.id, p.id));
        const external = net?.pins.some((ep) => ep.c !== c.id) ?? false;
        if (!external) {
          issues.push({
            level: "warn",
            code: "floating",
            compId: c.id,
            pin: p.id,
            message: `${c.label} input ${p.name} is not connected. It is read as X.`,
          });
        }
      }
    }
    const reportedZ = new Set<string>();
    for (const net of this.nets) {
      if (!net.floating || net.pins.length < 2) continue;
      if (reportedZ.has(net.id)) continue;
      const outs = net.pins.filter((ep) => {
        const comp = this.compById.get(ep.c);
        if (!comp) return false;
        return getDef(comp.type).pins.find((p) => p.id === ep.p)?.dir === "out";
      });
      if (outs.length === 0) continue;
      reportedZ.add(net.id);
      const names = [...new Set(net.pins.map((ep) => this.compById.get(ep.c)?.label ?? ep.c))].slice(0, 4);
      issues.push({
        level: "info",
        code: "hiz",
        netId: net.id,
        message: `Net between ${names.join(", ")} is high-Z. No driver is enabled.`,
      });
    }
    // Unreachable outputs: an output pin with no wire, skipping pure indicators' lack of outputs.
    for (const c of this.circuit.components) {
      const def = getDef(c.type);
      if (def.symbol === "label" || def.category === "Input / Output" && def.pins.every((p) => p.dir === "in")) continue;
      for (const p of def.pins) {
        if (p.dir !== "out") continue;
        const net = this.pinToNet.get(pinKey(c.id, p.id));
        const readers = (net?.pins ?? []).filter((ep) => {
          if (ep.c === c.id && ep.p === p.id) return false;
          const other = this.compById.get(ep.c);
          if (!other) return false;
          const pd = getDef(other.type).pins.find((x) => x.id === ep.p);
          return pd?.dir === "in";
        });
        if (readers.length === 0 && def.pins.some((x) => x.dir === "in" || def.category !== "Input / Output")) {
          if (def.category === "Input / Output") continue;
          issues.push({
            level: "info",
            code: "unread",
            compId: c.id,
            pin: p.id,
            message: `${c.label} output ${p.name} does not reach another component.`,
          });
        }
      }
    }
    this.issues = dedupe(issues);
  }

  private driverNames(net: Net): string[] {
    const names: string[] = [];
    for (const ep of net.pins) {
      const comp = this.compById.get(ep.c);
      if (!comp) continue;
      const p = getDef(comp.type).pins.find((x) => x.id === ep.p);
      if (!p || p.dir !== "out") continue;
      const bits = this.drivers.get(pinKey(ep.c, ep.p));
      if (!bits || bits.every((s) => s === Z)) continue;
      names.push(`${comp.label}.${p.name}`);
    }
    return names;
  }

  /** Cycles in the combinational dependency graph, as human-readable strings. */
  combinationalCycles(): string[] {
    const nodes = this.circuit.components.map((c) => c.id);
    const label = new Map(this.circuit.components.map((c) => [c.id, c.label]));
    const edges = new Map<string, Set<string>>();
    for (const id of nodes) edges.set(id, new Set());
    const self = new Set<string>();
    for (const net of this.nets) {
      const drivers: string[] = [];
      const readers: string[] = [];
      for (const ep of net.pins) {
        const comp = this.compById.get(ep.c);
        if (!comp) continue;
        const def = getDef(comp.type);
        const p = def.pins.find((x) => x.id === ep.p);
        if (!p) continue;
        if (p.dir === "out") drivers.push(comp.id);
        else if (propagates(def.comb, p.id)) readers.push(comp.id);
      }
      for (const d of drivers) {
        for (const r of readers) {
          if (d === r) self.add(d);
          else edges.get(d)!.add(r);
        }
      }
    }
    const color = new Map<string, 0 | 1 | 2>();
    const stack: string[] = [];
    const found: string[] = [];
    for (const id of self) found.push(`${label.get(id) ?? id} → ${label.get(id) ?? id}`);
    const visit = (id: string) => {
      color.set(id, 1);
      stack.push(id);
      for (const n of edges.get(id) ?? []) {
        const col = color.get(n) ?? 0;
        if (col === 0) visit(n);
        else if (col === 1) {
          const i = stack.indexOf(n);
          const cyc = stack.slice(i).map((x) => label.get(x) ?? x);
          cyc.push(label.get(n) ?? n);
          found.push(cyc.join(" → "));
        }
      }
      stack.pop();
      color.set(id, 2);
    };
    for (const id of nodes) if ((color.get(id) ?? 0) === 0) visit(id);
    return [...new Set(found)].slice(0, 8);
  }
}

function propagates(comb: "all" | "none" | string[], pin: string): boolean {
  if (comb === "all") return true;
  if (comb === "none") return false;
  return comb.includes(pin);
}

function dedupe(issues: SimIssue[]): SimIssue[] {
  const seen = new Set<string>();
  const out: SimIssue[] = [];
  for (const i of issues) {
    const k = i.level + i.code + i.message;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(i);
  }
  return out;
}
