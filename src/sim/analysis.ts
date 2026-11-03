/**
 * Topology-derived analysis. Truth tables are simulated, not looked up.
 * Boolean forms are read off the gate graph or off the simulated minterms.
 */
import { Simulator } from "./engine.ts";
import { getDef } from "./library.ts";
import { bitsToBin, bitsToHex, bitsToNum, sigChar, type Bits } from "./signal.ts";
import type { Circuit, CompInst } from "./types.ts";

export interface TruthColumn {
  id: string;
  label: string;
  kind: "in" | "out";
}

export interface TruthTable {
  inputs: TruthColumn[];
  outputs: TruthColumn[];
  rows: { in: string[]; out: string[] }[];
  sequential: boolean;
  note: string;
}

export interface FlowEdge {
  from: string;
  to: string;
}

export interface Analysis {
  truth: TruthTable | null;
  expressions: { output: string; structural: string | null; simplified: string | null }[];
  kmap: KMap | null;
  flow: FlowEdge[];
  cycles: string[];
  connections: { wire: string; a: string; b: string; value: string }[];
  explanation: string[];
}

const INPUT_TYPES = new Set(["toggle", "button"]);
const OUTPUT_TYPES = new Set(["led", "probe", "probe8", "seg7", "hex4", "num8"]);

function fresh(circuit: Circuit): Simulator {
  return new Simulator(structuredClone(circuit));
}

export function analyze(circuit: Circuit): Analysis {
  const sim = fresh(circuit);
  const sequential = circuit.components.some((c) => getDef(c.type).sequential);
  const truth = buildTruth(circuit, sequential);
  const expressions = truth
    ? truth.outputs.map((col, i) => {
        const minterms: number[] = [];
        truth.rows.forEach((row, r) => {
          if (row.out[i] === "1") minterms.push(r);
        });
        const names = truth.inputs.map((c) => c.label);
        const simplified =
          truth.inputs.length > 0 && truth.inputs.length <= 4 && singleBit(truth, i)
            ? quineMcCluskey(minterms, names)
            : null;
        return {
          output: col.label,
          structural: structuralExpr(circuit, col.id),
          simplified,
        };
      })
    : [];
  return {
    truth,
    expressions,
    kmap: truth && truth.inputs.length >= 2 && truth.inputs.length <= 4 ? buildKmap(truth) : null,
    flow: flowEdges(circuit),
    cycles: sim.combinationalCycles(),
    connections: connectionReport(sim),
    explanation: explainCircuit(circuit),
  };
}

function singleBit(table: TruthTable, outIndex: number): boolean {
  return table.rows.every((r) => r.out[outIndex] === "0" || r.out[outIndex] === "1");
}

function outputValue(sim: Simulator, comp: CompInst): string {
  if (comp.type === "seg7") {
    const bits = [sim.pinBits(comp.id, "A")[0], sim.pinBits(comp.id, "B")[0], sim.pinBits(comp.id, "C")[0], sim.pinBits(comp.id, "D")[0]];
    if (bits.some((b) => b !== 0 && b !== 1)) return "X";
    const n = (bits[0] ? 1 : 0) | (bits[1] ? 2 : 0) | (bits[2] ? 4 : 0) | (bits[3] ? 8 : 0);
    return n.toString(16).toUpperCase();
  }
  const pin = comp.type === "probe8" || comp.type === "hex4" || comp.type === "num8" ? (comp.type === "probe8" ? "A" : "D") : "A";
  const bits = sim.pinBits(comp.id, pin);
  if (comp.type === "probe" || comp.type === "led") return sigChar(bits[0] ?? 2);
  const hex = bitsToHex(bits);
  if (!hex) return bitsToBin(bits);
  if (comp.type === "num8") {
    const n = bitsToNum(bits);
    return n === null ? bitsToBin(bits) : String(n);
  }
  return hex;
}

function buildTruth(circuit: Circuit, sequential: boolean): TruthTable | null {
  const inputs = circuit.components.filter((c) => INPUT_TYPES.has(c.type));
  const outputs = circuit.components.filter((c) => OUTPUT_TYPES.has(c.type));
  if (outputs.length === 0) return null;
  if (inputs.length > 8) {
    return {
      inputs: inputs.map((c) => ({ id: c.id, label: c.label, kind: "in" })),
      outputs: outputs.map((c) => ({ id: c.id, label: c.label, kind: "out" })),
      rows: [],
      sequential,
      note: "Too many inputs to enumerate (more than 8). Add probes closer to the cone you care about, or remove extra switches.",
    };
  }
  const rows: TruthTable["rows"] = [];
  const total = 1 << inputs.length;
  for (let r = 0; r < total; r++) {
    const sim = fresh(circuit);
    const entries: [string, string, number | boolean][] = inputs.map((c, i) => {
      const bit = (r >> i) & 1;
      return [c.id, c.type === "button" ? "down" : "on", bit === 1];
    });
    if (entries.length) sim.setParams(entries as [string, string, import("./types.ts").ParamValue][]);
    const inn = inputs.map((_, i) => (((r >> i) & 1) === 1 ? "1" : "0"));
    const out = outputs.map((c) => outputValue(sim, c));
    rows.push({ in: inn, out });
  }
  let note = sequential
    ? "Sequential parts were left in their reset state and no clock edge was applied. This table is the combinational response, not a state diagram. Use the waveform studio for time."
    : "Every input combination was driven and the network was allowed to settle.";
  if (inputs.length === 0) note = "There are no switches. The single row is the settled output.";
  return {
    inputs: inputs.map((c) => ({ id: c.id, label: c.label, kind: "in" })),
    outputs: outputs.map((c) => ({ id: c.id, label: c.label, kind: "out" })),
    rows,
    sequential,
    note,
  };
}

function driverOf(circuit: Circuit, compId: string, pinId: string): { c: string; p: string } | null {
  const sim = fresh(circuit);
  const net = sim.netOf(compId, pinId);
  if (!net) return null;
  for (const ep of net.pins) {
    const comp = circuit.components.find((c) => c.id === ep.c);
    if (!comp) continue;
    const p = getDef(comp.type).pins.find((x) => x.id === ep.p);
    if (p?.dir === "out") return ep;
  }
  return null;
}

function structuralExpr(circuit: Circuit, outputId: string): string | null {
  const comp = circuit.components.find((c) => c.id === outputId);
  if (!comp) return null;
  const pin = comp.type === "probe8" || comp.type === "hex4" || comp.type === "num8" ? (comp.type === "probe8" ? "A" : "D") : comp.type === "seg7" ? "A" : "A";
  const seen = new Set<string>();
  const expr = exprFromInput(circuit, comp.id, pin, seen);
  return expr;
}

function exprFromInput(circuit: Circuit, compId: string, pinId: string, seen: Set<string>): string | null {
  const src = driverOf(circuit, compId, pinId);
  if (!src) return null;
  return exprFromOutput(circuit, src.c, seen);
}

function exprFromOutput(circuit: Circuit, compId: string, seen: Set<string>): string | null {
  if (seen.has(compId)) return null;
  const comp = circuit.components.find((c) => c.id === compId);
  if (!comp) return null;
  const next = new Set(seen);
  next.add(compId);
  const name = comp.label;
  if (comp.type === "toggle" || comp.type === "button") return name;
  if (comp.type === "vcc") return "1";
  if (comp.type === "gnd") return "0";
  const arg = (pin: string) => exprFromInput(circuit, comp.id, pin, next);
  const bin = (op: string, pins: string[]) => {
    const parts = pins.map(arg);
    if (parts.some((p) => !p)) return null;
    return "(" + parts.join(" " + op + " ") + ")";
  };
  switch (comp.type) {
    case "and2":
    case "and3":
      return bin("·", comp.type === "and2" ? ["A", "B"] : ["A", "B", "C"]);
    case "or2":
    case "or3":
      return bin("+", comp.type === "or2" ? ["A", "B"] : ["A", "B", "C"]);
    case "xor2":
      return bin("⊕", ["A", "B"]);
    case "xnor2": {
      const inner = bin("⊕", ["A", "B"]);
      return inner ? "¬" + inner : null;
    }
    case "nand2": {
      const inner = bin("·", ["A", "B"]);
      return inner ? "¬" + inner : null;
    }
    case "nor2": {
      const inner = bin("+", ["A", "B"]);
      return inner ? "¬" + inner : null;
    }
    case "not": {
      const a = arg("A");
      return a ? "¬" + a : null;
    }
    case "buf":
      return arg("A");
    case "hadd":
      return null;
    default:
      return null;
  }
  void name;
}

/** Quine–McCluskey SOP. `names[i]` is the variable for bit i (LSB first). */
export function quineMcCluskey(minterms: number[], names: string[]): string {
  const n = names.length;
  if (n === 0) return minterms.length ? "1" : "0";
  const all = 1 << n;
  if (minterms.length === 0) return "0";
  if (minterms.length === all) return "1";
  type Term = { bits: number; mask: number; covered: number[] };
  let groups = new Map<number, Term[]>();
  const add = (map: Map<number, Term[]>, t: Term) => {
    const ones = popcount(t.bits);
    const list = map.get(ones) ?? [];
    list.push(t);
    map.set(ones, list);
  };
  for (const m of minterms) add(groups, { bits: m, mask: 0, covered: [m] });
  const primes: Term[] = [];
  for (;;) {
    const next = new Map<number, Term[]>();
    const used = new Set<Term>();
    const seen = new Set<string>();
    const levels = [...groups.keys()].sort((a, b) => a - b);
    for (const lv of levels) {
      for (const a of groups.get(lv) ?? []) {
        for (const b of groups.get(lv + 1) ?? []) {
          if (a.mask !== b.mask) continue;
          const diff = a.bits ^ b.bits;
          if (diff === 0 || (diff & (diff - 1)) !== 0) continue;
          if (diff & a.mask) continue;
          const merged: Term = { bits: a.bits & ~diff, mask: a.mask | diff, covered: [...a.covered, ...b.covered] };
          const key = merged.bits + ":" + merged.mask;
          if (!seen.has(key)) {
            seen.add(key);
            add(next, merged);
          }
          used.add(a);
          used.add(b);
        }
      }
    }
    for (const list of groups.values()) for (const t of list) if (!used.has(t)) primes.push(t);
    if (next.size === 0) break;
    groups = next;
  }
  const unique = new Map<string, Term>();
  for (const p of primes) unique.set(p.bits + ":" + p.mask, p);
  const primeList = [...unique.values()];
  const uncovered = new Set(minterms);
  const chosen: Term[] = [];
  while (uncovered.size) {
    let best: Term | null = null;
    let bestHit = 0;
    for (const p of primeList) {
      if (chosen.includes(p)) continue;
      const hit = p.covered.filter((m) => uncovered.has(m)).length;
      if (hit > bestHit) {
        bestHit = hit;
        best = p;
      }
    }
    if (!best || bestHit === 0) break;
    chosen.push(best);
    for (const m of best.covered) uncovered.delete(m);
  }
  const terms = chosen.map((t) => termToString(t, names));
  return terms.join(" + ") || "0";
}

function popcount(n: number): number {
  let c = 0;
  while (n) {
    c += n & 1;
    n >>>= 1;
  }
  return c;
}

function termToString(t: { bits: number; mask: number }, names: string[]): string {
  const parts: string[] = [];
  for (let i = 0; i < names.length; i++) {
    if ((t.mask >>> i) & 1) continue;
    const bit = (t.bits >>> i) & 1;
    parts.push(bit ? names[i]! : "¬" + names[i]!);
  }
  if (parts.length === 0) return "1";
  if (parts.length === 1) return parts[0]!;
  return parts.join("·");
}

export interface KMap {
  inputs: string[];
  output: string;
  rowLabels: string[];
  colLabels: string[];
  cells: string[][];
}

function buildKmap(table: TruthTable): KMap | null {
  const outIndex = table.outputs.findIndex((_, i) => singleBit(table, i));
  if (outIndex < 0) return null;
  const n = table.inputs.length;
  const names = table.inputs.map((c) => c.label);
  const valueAt = (mask: number) => table.rows[mask]?.out[outIndex] ?? "X";
  if (n === 2) {
    return {
      inputs: names,
      output: table.outputs[outIndex]!.label,
      rowLabels: ["0", "1"].map((b) => names[0] + "=" + b),
      colLabels: ["0", "1"].map((b) => names[1] + "=" + b),
      cells: [0, 1].map((a) => [0, 1].map((b) => valueAt(a | (b << 1)))),
    };
  }
  const gray2 = [0, 1, 3, 2];
  if (n === 3) {
    return {
      inputs: names,
      output: table.outputs[outIndex]!.label,
      rowLabels: ["0", "1"].map((b) => names[0] + "=" + b),
      colLabels: gray2.map((g) => names[2] + names[1] + "=" + ((g >> 1) & 1) + (g & 1)),
      cells: [0, 1].map((a) => gray2.map((g) => valueAt(a | (g << 1)))),
    };
  }
  const grayRow = [0, 1, 3, 2];
  return {
    inputs: names,
    output: table.outputs[outIndex]!.label,
    rowLabels: grayRow.map((g) => names[1] + names[0] + "=" + ((g >> 1) & 1) + (g & 1)),
    colLabels: gray2.map((g) => names[3] + names[2] + "=" + ((g >> 1) & 1) + (g & 1)),
    cells: grayRow.map((rg) => gray2.map((cg) => valueAt((rg & 1) | (((rg >> 1) & 1) << 1) | ((cg & 1) << 2) | (((cg >> 1) & 1) << 3)))),
  };
}

function flowEdges(circuit: Circuit): FlowEdge[] {
  const sim = fresh(circuit);
  const edges: FlowEdge[] = [];
  const seen = new Set<string>();
  for (const net of sim.nets) {
    const drivers = net.pins.filter((ep) => {
      const c = circuit.components.find((x) => x.id === ep.c);
      return c && getDef(c.type).pins.find((p) => p.id === ep.p)?.dir === "out";
    });
    const readers = net.pins.filter((ep) => {
      const c = circuit.components.find((x) => x.id === ep.c);
      return c && getDef(c.type).pins.find((p) => p.id === ep.p)?.dir === "in";
    });
    for (const d of drivers) {
      for (const r of readers) {
        if (d.c === r.c) continue;
        const a = circuit.components.find((c) => c.id === d.c)?.label ?? d.c;
        const b = circuit.components.find((c) => c.id === r.c)?.label ?? r.c;
        const key = a + "→" + b;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ from: a, to: b });
      }
    }
  }
  return edges;
}

function connectionReport(sim: Simulator): { wire: string; a: string; b: string; value: string }[] {
  return sim.circuit.wires.map((w) => {
    const ca = sim.circuit.components.find((c) => c.id === w.a.c);
    const cb = sim.circuit.components.find((c) => c.id === w.b.c);
    const pa = ca ? getDef(ca.type).pins.find((p) => p.id === w.a.p) : undefined;
    const pb = cb ? getDef(cb.type).pins.find((p) => p.id === w.b.p) : undefined;
    const net = sim.netOf(w.a.c, w.a.p);
    const value = net ? (net.conflict ? "CONFLICT " : "") + bitsToBin(net.bits) : "—";
    return {
      wire: w.id,
      a: `${ca?.label ?? w.a.c}.${pa?.name ?? w.a.p}`,
      b: `${cb?.label ?? w.b.c}.${pb?.name ?? w.b.p}`,
      value,
    };
  });
}

function fmt(bits: Bits | undefined): string {
  if (!bits || bits.length === 0) return "X";
  if (bits.length === 1) return sigChar(bits[0]!);
  const n = bitsToNum(bits);
  return n === null ? bitsToBin(bits) : `${bitsToBin(bits)} (${n})`;
}

export function explainCircuit(circuit: Circuit): string[] {
  const sim = fresh(circuit);
  const lines: string[] = [];
  const outputs = circuit.components.filter((c) => OUTPUT_TYPES.has(c.type));
  if (outputs.length === 0) {
    lines.push("Place a probe or an LED on a signal to get an explanation of that output.");
  }
  for (const out of outputs) {
    const pin = out.type === "hex4" || out.type === "num8" ? "D" : out.type === "probe8" ? "A" : out.type === "seg7" ? "A" : "A";
    const src = driverOf(circuit, out.id, pin);
    lines.push(`Output “${out.label}” currently reads ${outputValue(sim, out)}.`);
    if (!src) {
      lines.push(`Nothing drives ${out.label}. The input is floating, so the reading is unknown rather than a guessed 0.`);
      continue;
    }
    const driver = circuit.components.find((c) => c.id === src.c)!;
    lines.push(...explainComp(circuit, sim, driver, 0));
  }
  if (lines.length === 0) lines.push("The sheet has no components yet.");
  return lines;
}

function explainComp(circuit: Circuit, sim: Simulator, comp: CompInst, depth: number): string[] {
  if (depth > 6) return ["…the cone continues beyond this depth."];
  const ins = sim.inputsOf(comp.id);
  const pad = "";
  const lines: string[] = [];
  const live = (pin: string) => fmt(ins[pin]);
  if (comp.type === "fadd") {
    lines.push(
      `${comp.label} is a full adder. SUM = A ⊕ B ⊕ CIN and COUT = (A · B) + (CIN · (A ⊕ B)).`,
    );
    lines.push(`Right now A=${live("A")}, B=${live("B")}, CIN=${live("CIN")}.`);
    lines.push(`The XOR of A and B differs when exactly one of them is 1. Folding CIN into that XOR produces SUM = ${fmt(sim.pinBits(comp.id, "SUM"))}.`);
    lines.push(`Carry is 1 when at least two of A, B, and CIN are 1. COUT = ${fmt(sim.pinBits(comp.id, "COUT"))}.`);
    return lines;
  }
  if (comp.type === "hadd") {
    lines.push(`${comp.label} is a half adder: SUM = A ⊕ B = ${fmt(sim.pinBits(comp.id, "SUM"))}, COUT = A · B = ${fmt(sim.pinBits(comp.id, "COUT"))}. Inputs A=${live("A")}, B=${live("B")}.`);
    return lines;
  }
  if (comp.type === "mux2") {
    lines.push(`${comp.label} is a 2:1 mux. Select S=${live("S")} chooses ${live("S") === "1" ? "D1" : live("S") === "0" ? "D0" : "neither reliably"}. D0=${live("D0")}, D1=${live("D1")}, Y=${fmt(sim.pinBits(comp.id, "Y"))}.`);
    return lines;
  }
  if (comp.type === "dff") {
    lines.push(`${comp.label} is a rising-edge D flip-flop. Q is ${fmt(sim.pinBits(comp.id, "Q"))}. D is ${live("D")} and only replaces Q on the next 0→1 clock. CLR=${live("CLR")}.`);
    return lines;
  }
  if (comp.type === "alu8" || comp.type === "alusap") {
    lines.push(`${comp.label} reads A=${live("A")} and B=${live("B")}. Its output is computed from those operands by the operation documented on the part — not from a hidden shortcut.`);
    return lines;
  }
  const gate = gateBlurb(comp.type, live);
  if (gate) {
    lines.push(`${pad}${comp.label}: ${gate} Output is ${fmt(sim.pinBits(comp.id, "Y"))}.`);
    for (const p of getDef(comp.type).pins) {
      if (p.dir !== "in") continue;
      const src = driverOf(circuit, comp.id, p.id);
      if (!src) continue;
      const d = circuit.components.find((c) => c.id === src.c);
      if (!d || d.type === "toggle" || d.type === "button" || d.type === "vcc" || d.type === "gnd") {
        if (d) lines.push(`${d.label} drives ${p.name} with ${live(p.id)}.`);
        continue;
      }
      lines.push(...explainComp(circuit, sim, d, depth + 1).map((l) => l));
    }
    return lines;
  }
  lines.push(`${comp.label} (${getDef(comp.type).label}) output is ${fmt(sim.pinBits(comp.id, getDef(comp.type).pins.find((p) => p.dir === "out")?.id ?? "Y"))}. ${getDef(comp.type).blurb}.`);
  return lines;
}

function gateBlurb(type: string, live: (pin: string) => string): string | null {
  switch (type) {
    case "and2":
      return `AND of A=${live("A")} and B=${live("B")}. The output is 0 if either input is 0.`;
    case "and3":
      return `AND of A=${live("A")}, B=${live("B")}, C=${live("C")}.`;
    case "or2":
      return `OR of A=${live("A")} and B=${live("B")}. The output is 1 if either input is 1.`;
    case "or3":
      return `OR of A=${live("A")}, B=${live("B")}, C=${live("C")}.`;
    case "xor2":
      return `XOR of A=${live("A")} and B=${live("B")}. The output is 1 only when they differ.`;
    case "xnor2":
      return `XNOR of A=${live("A")} and B=${live("B")}. The output is 1 when they match.`;
    case "nand2":
      return `NAND of A=${live("A")} and B=${live("B")}, which is the NOT of their AND.`;
    case "nor2":
      return `NOR of A=${live("A")} and B=${live("B")}, which is the NOT of their OR.`;
    case "not":
      return `NOT of A=${live("A")}.`;
    case "buf":
      return `Buffer of A=${live("A")}.`;
    default:
      return null;
  }
}

void bitsToHex;
