import { create } from "zustand";
import { analyze, type Analysis } from "@/sim/analysis";
import { cpuCircuit } from "@/sim/cpu";
import { Simulator } from "@/sim/engine";
import { exampleById, EXAMPLES } from "@/sim/examples";
import { DEFAULT_PROGRAM, assemble } from "@/sim/isa";
import { createComponent, getDef } from "@/sim/library";
import { bitsToBin } from "@/sim/signal";
import { emptyCircuit, type Circuit, type CompInst, type ParamValue, type Wire } from "@/sim/types";

export type Workspace = "design" | "analysis" | "wave" | "debug" | "cpu";
export type SheetId = "design" | "cpu";

export interface Watch {
  key: string;
  label: string;
}

export interface Sample {
  t: number;
  vals: Record<string, string>;
}

export interface ProjectFile {
  format: "logicmatter.project";
  version: 1;
  name: string;
  sheet: SheetId;
  sheets: { design: Circuit; cpu: Circuit };
  program: string;
}

const STORAGE = "logicmatter.project.v1";
const HISTORY = "logicmatter.history.v1";

function bootSheets(): { design: Circuit; cpu: Circuit } {
  return {
    design: exampleById("full-adder")?.build() ?? emptyCircuit(),
    cpu: cpuCircuit(),
  };
}

function watchesFor(circuit: Circuit): Watch[] {
  const list: Watch[] = [];
  for (const c of circuit.components) {
    const def = getDef(c.type);
    if (c.type === "clock") list.push({ key: c.id + ":CLK", label: c.label });
    if (c.type === "led" || c.type === "probe") list.push({ key: c.id + ":A", label: c.label });
    if (c.type === "probe8") list.push({ key: c.id + ":A", label: c.label });
    if (c.type === "hex4" || c.type === "num8") list.push({ key: c.id + ":D", label: c.label });
    if (c.type === "seg7") list.push({ key: c.id + ":A", label: c.label + ".A" });
    if (def.category === "CPU" && (c.id === "acc" || c.id === "pc" || c.id === "out")) {
      const pin = c.id === "pc" ? "BOUT" : c.id === "out" ? "OUT" : "A";
      list.push({ key: c.id + ":" + pin, label: c.label });
    }
  }
  const seen = new Set<string>();
  return list.filter((w) => (seen.has(w.key) ? false : (seen.add(w.key), true)));
}

export interface Lab {
  name: string;
  sheet: SheetId;
  sheets: { design: Circuit; cpu: Circuit };
  sim: Simulator;
  rev: number;
  viewEpoch: number;
  selection: string[];
  wireSelection: string[];
  running: boolean;
  speed: number;
  workspace: Workspace;
  watches: Watch[];
  samples: Sample[];
  undo: string[];
  redo: string[];
  placeType: string | null;
  program: string;
  analysis: Analysis | null;
  focusId: string | null;
  showHelp: boolean;
  showInfoIssues: boolean;
  menu: null | "file" | "examples";
  message: string;
  circuit(): Circuit;
  bump(): void;
  recordSample(): void;
  pushUndo(): void;
  undoAction(): void;
  redoAction(): void;
  setWorkspace(w: Workspace): void;
  setSheet(id: SheetId): void;
  setRunning(v: boolean): void;
  toggleRun(): void;
  step(): void;
  resetSim(): void;
  setSpeed(n: number): void;
  selectComps(ids: string[], add?: boolean): void;
  selectWires(ids: string[]): void;
  clearSelection(): void;
  setPlace(type: string | null): void;
  placeAt(x: number, y: number): void;
  moveBy(ids: string[], dx: number, dy: number): void;
  deleteSelection(): void;
  rotateSelection(): void;
  flipSelection(): void;
  nudge(dx: number, dy: number): void;
  addWire(a: { c: string; p: string }, b: { c: string; p: string }): void;
  setLabel(id: string, label: string): void;
  setParam(id: string, key: string, value: ParamValue): void;
  toggleSwitch(id: string): void;
  setButton(id: string, down: boolean): void;
  copy(): void;
  paste(at?: { x: number; y: number }): void;
  duplicate(): void;
  loadExample(id: string): void;
  newProject(): void;
  saveLocal(versioned?: boolean): void;
  exportProject(): void;
  importProject(text: string): string | null;
  restoreHistory(index: number): void;
  history(): { name: string; at: number }[];
  watchPin(compId: string, pin: string): void;
  unwatch(key: string): void;
  clearSamples(): void;
  runAnalysis(): void;
  loadProgram(): string | null;
  setProgram(src: string): void;
  focus(id: string): void;
  setHelp(v: boolean): void;
  setMenu(m: Lab["menu"]): void;
  setShowInfo(v: boolean): void;
  setMessage(m: string): void;
  fitView(): void;
}

let clipboard: { comps: CompInst[]; wires: Wire[] } | null = null;

function snapshot(c: Circuit): string {
  return JSON.stringify(c);
}

export const useLab = create<Lab>((set, get) => {
  const sheets = bootSheets();
  const sim = new Simulator(sheets.design);
  return {
    name: "Full adder",
    sheet: "design",
    sheets,
    sim,
    rev: 0,
    viewEpoch: 1,
    selection: [],
    wireSelection: [],
    running: false,
    speed: 8,
    workspace: "design",
    watches: watchesFor(sheets.design),
    samples: [],
    undo: [],
    redo: [],
    placeType: null,
    program: DEFAULT_PROGRAM,
    analysis: null,
    focusId: null,
    showHelp: false,
    showInfoIssues: false,
    menu: null,
    message: "Full adder is live. Click a switch, or press Run.",
    circuit() {
      return get().sheets[get().sheet];
    },
    bump() {
      set({ rev: get().rev + 1 });
    },
    recordSample() {
      const s = get();
      if (s.watches.length === 0) return;
      const vals: Record<string, string> = {};
      for (const w of s.watches) {
        const [c, p] = w.key.split(":");
        vals[w.key] = bitsToBin(s.sim.pinBits(c!, p!));
      }
      const last = s.samples[s.samples.length - 1];
      if (last && last.t === s.sim.time && JSON.stringify(last.vals) === JSON.stringify(vals)) return;
      s.samples.push({ t: s.sim.time, vals });
      if (s.samples.length > 720) s.samples.splice(0, s.samples.length - 720);
    },
    pushUndo() {
      const c = snapshot(get().circuit());
      const undo = [...get().undo, c].slice(-80);
      set({ undo, redo: [] });
    },
    undoAction() {
      const undo = [...get().undo];
      const prev = undo.pop();
      if (!prev) return;
      const redo = [...get().redo, snapshot(get().circuit())];
      const circuit = JSON.parse(prev) as Circuit;
      const sheet = get().sheet;
      const sheets = { ...get().sheets, [sheet]: circuit };
      const sim = new Simulator(circuit);
      set({ undo, redo, sheets, sim, rev: get().rev + 1, running: false });
      get().recordSample();
    },
    redoAction() {
      const redo = [...get().redo];
      const next = redo.pop();
      if (!next) return;
      const undo = [...get().undo, snapshot(get().circuit())];
      const circuit = JSON.parse(next) as Circuit;
      const sheet = get().sheet;
      const sheets = { ...get().sheets, [sheet]: circuit };
      const sim = new Simulator(circuit);
      set({ undo, redo, sheets, sim, rev: get().rev + 1, running: false });
    },
    setWorkspace(w) {
      const patch: Partial<Lab> = { workspace: w, menu: null };
      if (w === "cpu" && get().sheet !== "cpu") {
        const sheets = get().sheets;
        const sim = new Simulator(sheets.cpu);
        Object.assign(patch, {
          sheet: "cpu" as const,
          sim,
          selection: [],
          wireSelection: [],
          watches: watchesFor(sheets.cpu),
          samples: [],
          running: false,
          viewEpoch: get().viewEpoch + 1,
          undo: [],
          redo: [],
        });
      }
      if (w === "analysis") {
        set(patch);
        get().runAnalysis();
        return;
      }
      set(patch);
    },
    setSheet(id) {
      if (id === get().sheet) return;
      const circuit = get().sheets[id];
      const sim = new Simulator(circuit);
      set({
        sheet: id,
        sim,
        selection: [],
        wireSelection: [],
        watches: watchesFor(circuit),
        samples: [],
        running: false,
        undo: [],
        redo: [],
        viewEpoch: get().viewEpoch + 1,
        rev: get().rev + 1,
        analysis: null,
        workspace: id === "cpu" ? "cpu" : get().workspace === "cpu" ? "design" : get().workspace,
      });
      get().recordSample();
    },
    setRunning(v) {
      if (v && (get().sim.halted || get().sim.oscillating)) get().resetSim();
      set({ running: v });
    },
    toggleRun() {
      const s = get();
      if (!s.running && (s.sim.halted || s.sim.oscillating)) s.resetSim();
      set({ running: !get().running });
    },
    step() {
      const s = get();
      set({ running: false });
      s.sim.tick();
      s.recordSample();
      s.bump();
    },
    resetSim() {
      get().sim.reset();
      set({ samples: [], running: false, rev: get().rev + 1 });
      get().recordSample();
    },
    setSpeed(n) {
      set({ speed: n });
    },
    selectComps(ids, add) {
      const selection = add ? [...new Set([...get().selection, ...ids])] : ids;
      set({ selection, wireSelection: [], rev: get().rev + 1 });
    },
    selectWires(ids) {
      set({ wireSelection: ids, selection: [], rev: get().rev + 1 });
    },
    clearSelection() {
      set({ selection: [], wireSelection: [] });
    },
    setPlace(type) {
      set({ placeType: type, message: type ? `Click the canvas to place ${getDef(type).label}. Esc cancels.` : get().message });
    },
    placeAt(x, y) {
      const type = get().placeType;
      if (!type) return;
      get().pushUndo();
      const ckt = get().circuit();
      const comp = createComponent(type, snap(x), snap(y), ckt.seq);
      ckt.seq += 1;
      ckt.components.push(comp);
      get().sim.sync(ckt);
      set({ selection: [comp.id], placeType: null, rev: get().rev + 1, message: `${comp.label} placed.` });
    },
    moveBy(ids, dx, dy) {
      const setIds = new Set(ids);
      for (const c of get().circuit().components) {
        if (!setIds.has(c.id)) continue;
        c.x = snap(c.x + dx);
        c.y = snap(c.y + dy);
      }
      set({ rev: get().rev + 1 });
    },
    deleteSelection() {
      const sel = new Set(get().selection);
      const wires = new Set(get().wireSelection);
      if (sel.size === 0 && wires.size === 0) return;
      get().pushUndo();
      const ckt = get().circuit();
      ckt.components = ckt.components.filter((c) => !sel.has(c.id));
      ckt.wires = ckt.wires.filter((w) => !wires.has(w.id) && !sel.has(w.a.c) && !sel.has(w.b.c));
      get().sim.sync(ckt);
      set({ selection: [], wireSelection: [], rev: get().rev + 1 });
    },
    rotateSelection() {
      if (get().selection.length === 0) return;
      get().pushUndo();
      const sel = new Set(get().selection);
      for (const c of get().circuit().components) {
        if (!sel.has(c.id)) continue;
        c.rot = ((c.rot + 90) % 360) as CompInst["rot"];
      }
      set({ rev: get().rev + 1 });
    },
    flipSelection() {
      if (get().selection.length === 0) return;
      get().pushUndo();
      const sel = new Set(get().selection);
      for (const c of get().circuit().components) if (sel.has(c.id)) c.flip = !c.flip;
      set({ rev: get().rev + 1 });
    },
    nudge(dx, dy) {
      if (get().selection.length === 0) return;
      get().pushUndo();
      get().moveBy(get().selection, dx, dy);
    },
    addWire(a, b) {
      if (a.c === b.c && a.p === b.p) return;
      const ckt = get().circuit();
      const ca = ckt.components.find((c) => c.id === a.c);
      const cb = ckt.components.find((c) => c.id === b.c);
      if (!ca || !cb) return;
      const pa = getDef(ca.type).pins.find((p) => p.id === a.p);
      const pb = getDef(cb.type).pins.find((p) => p.id === b.p);
      if (!pa || !pb) return;
      if (pa.width !== pb.width) {
        set({ message: `Cannot connect ${pa.width}-bit ${pa.name} to ${pb.width}-bit ${pb.name}.` });
        return;
      }
      const dup = ckt.wires.some(
        (w) =>
          (w.a.c === a.c && w.a.p === a.p && w.b.c === b.c && w.b.p === b.p) ||
          (w.a.c === b.c && w.a.p === b.p && w.b.c === a.c && w.b.p === a.p),
      );
      if (dup) return;
      get().pushUndo();
      ckt.wires.push({ id: "W" + ckt.seq++, a, b });
      get().sim.sync(ckt);
      set({ rev: get().rev + 1, message: "Wire connected." });
      get().recordSample();
    },
    setLabel(id, label) {
      const c = get().circuit().components.find((x) => x.id === id);
      if (!c) return;
      c.label = label;
      set({ rev: get().rev + 1 });
    },
    setParam(id, key, value) {
      const c = get().circuit().components.find((x) => x.id === id);
      if (!c) return;
      get().pushUndo();
      get().sim.setParam(id, key, value);
      set({ rev: get().rev + 1 });
      get().recordSample();
    },
    toggleSwitch(id) {
      const c = get().circuit().components.find((x) => x.id === id);
      if (!c || c.type !== "toggle") return;
      get().pushUndo();
      get().sim.setParam(id, "on", !c.params.on);
      set({ rev: get().rev + 1, selection: [id] });
      get().recordSample();
    },
    setButton(id, down) {
      const c = get().circuit().components.find((x) => x.id === id);
      if (!c || c.type !== "button") return;
      get().sim.setParam(id, "down", down);
      set({ rev: get().rev + 1 });
      get().recordSample();
    },
    copy() {
      const sel = new Set(get().selection);
      if (sel.size === 0) return;
      const comps = get().circuit().components.filter((c) => sel.has(c.id)).map((c) => structuredClone(c));
      const wires = get().circuit().wires.filter((w) => sel.has(w.a.c) && sel.has(w.b.c)).map((w) => structuredClone(w));
      clipboard = { comps, wires };
      set({ message: `Copied ${comps.length} component${comps.length === 1 ? "" : "s"}.` });
    },
    paste(at) {
      if (!clipboard || clipboard.comps.length === 0) return;
      get().pushUndo();
      const ckt = get().circuit();
      const minX = Math.min(...clipboard.comps.map((c) => c.x));
      const minY = Math.min(...clipboard.comps.map((c) => c.y));
      const dx = at ? snap(at.x) - minX : 24;
      const dy = at ? snap(at.y) - minY : 24;
      const map = new Map<string, string>();
      const ids: string[] = [];
      for (const src of clipboard.comps) {
        const id = "U" + ckt.seq++;
        map.set(src.id, id);
        const clone = structuredClone(src);
        clone.id = id;
        clone.x = snap(src.x + dx);
        clone.y = snap(src.y + dy);
        ckt.components.push(clone);
        ids.push(id);
      }
      for (const w of clipboard.wires) {
        const a = map.get(w.a.c);
        const b = map.get(w.b.c);
        if (!a || !b) continue;
        ckt.wires.push({ id: "W" + ckt.seq++, a: { c: a, p: w.a.p }, b: { c: b, p: w.b.p } });
      }
      get().sim.sync(ckt);
      set({ selection: ids, rev: get().rev + 1, message: "Pasted." });
    },
    duplicate() {
      get().copy();
      get().paste();
    },
    loadExample(id) {
      const ex = EXAMPLES.find((e) => e.id === id);
      if (!ex) return;
      const circuit = ex.build();
      const sheet = ex.sheet;
      const sheets = { ...get().sheets, [sheet]: circuit };
      const sim = new Simulator(circuit);
      set({
        sheets,
        sheet,
        sim,
        selection: [],
        wireSelection: [],
        watches: watchesFor(circuit),
        samples: [],
        running: false,
        undo: [],
        redo: [],
        viewEpoch: get().viewEpoch + 1,
        rev: get().rev + 1,
        menu: null,
        workspace: sheet === "cpu" ? "cpu" : "design",
        message: ex.name + " loaded.",
        analysis: null,
      });
      if (sheet === "cpu") set({ program: DEFAULT_PROGRAM });
      get().recordSample();
    },
    newProject() {
      const sheets = { design: emptyCircuit(), cpu: cpuCircuit() };
      const note = createComponent("label", 80, 64, 1, "note");
      note.params = { text: "Pick a part from the library, then click the canvas." };
      note.label = "Note";
      sheets.design.components.push(note);
      sheets.design.seq = 2;
      const sim = new Simulator(sheets.design);
      set({
        name: "Untitled",
        sheets,
        sheet: "design",
        sim,
        selection: [],
        wireSelection: [],
        watches: [],
        samples: [],
        undo: [],
        redo: [],
        running: false,
        workspace: "design",
        viewEpoch: get().viewEpoch + 1,
        rev: get().rev + 1,
        program: DEFAULT_PROGRAM,
        analysis: null,
        message: "New project.",
        menu: null,
      });
    },
    saveLocal(versioned) {
      const file = projectOf(get());
      try {
        localStorage.setItem(STORAGE, JSON.stringify(file));
        if (versioned) {
          const prev = JSON.parse(localStorage.getItem(HISTORY) || "[]") as { at: number; name: string; file: ProjectFile }[];
          prev.push({ at: Date.now(), name: file.name, file });
          localStorage.setItem(HISTORY, JSON.stringify(prev.slice(-8)));
        }
        set({ message: versioned ? "Version saved in this browser." : get().message });
      } catch {
        set({ message: "Could not save in this browser." });
      }
    },
    exportProject() {
      const file = projectOf(get());
      const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (file.name || "logicmatter").replace(/\s+/g, "-").toLowerCase() + ".logicmatter.json";
      a.click();
      URL.revokeObjectURL(a.href);
      set({ message: "Project file downloaded.", menu: null });
    },
    importProject(text) {
      try {
        const file = JSON.parse(text) as ProjectFile;
        if (file.format !== "logicmatter.project" || !file.sheets?.design || !file.sheets?.cpu) {
          return "This file is not a LogicMatter project.";
        }
        const sim = new Simulator(file.sheets[file.sheet] ?? file.sheets.design);
        set({
          name: file.name || "Imported",
          sheet: file.sheet === "cpu" ? "cpu" : "design",
          sheets: { design: file.sheets.design, cpu: file.sheets.cpu },
          program: file.program || DEFAULT_PROGRAM,
          sim,
          selection: [],
          wireSelection: [],
          watches: watchesFor(file.sheets[file.sheet] ?? file.sheets.design),
          samples: [],
          undo: [],
          redo: [],
          running: false,
          viewEpoch: get().viewEpoch + 1,
          rev: get().rev + 1,
          analysis: null,
          message: "Project imported.",
          menu: null,
        });
        get().recordSample();
        return null;
      } catch {
        return "Could not read that file.";
      }
    },
    restoreHistory(index) {
      try {
        const prev = JSON.parse(localStorage.getItem(HISTORY) || "[]") as { file: ProjectFile }[];
        const item = prev[index];
        if (!item) return;
        const err = get().importProject(JSON.stringify(item.file));
        if (!err) set({ message: "Restored a saved version." });
      } catch {
        set({ message: "Could not restore that version." });
      }
    },
    history() {
      try {
        const prev = JSON.parse(localStorage.getItem(HISTORY) || "[]") as { at: number; name: string }[];
        return prev;
      } catch {
        return [];
      }
    },
    watchPin(compId, pin) {
      const c = get().circuit().components.find((x) => x.id === compId);
      if (!c) return;
      const key = compId + ":" + pin;
      if (get().watches.some((w) => w.key === key)) return;
      const p = getDef(c.type).pins.find((x) => x.id === pin);
      set({ watches: [...get().watches, { key, label: c.label + "." + (p?.name ?? pin) }] });
      get().recordSample();
      get().bump();
    },
    unwatch(key) {
      set({ watches: get().watches.filter((w) => w.key !== key) });
    },
    clearSamples() {
      set({ samples: [] });
      get().recordSample();
      get().bump();
    },
    runAnalysis() {
      const analysis = analyze(get().circuit());
      set({ analysis, rev: get().rev + 1 });
    },
    loadProgram() {
      const result = assemble(get().program);
      if (result.errors.length) return result.errors[0] ?? "Assemble failed.";
      const ckt = get().sheets.cpu;
      const ram = ckt.components.find((c) => c.id === "ram");
      if (!ram) return "This CPU sheet has no RAM part.";
      if (get().sheet !== "cpu") get().setSheet("cpu");
      get().sim.setParam("ram", "words", result.words);
      get().sim.reset();
      set({ samples: [], running: false, rev: get().rev + 1, message: "Program loaded and CPU reset." });
      get().recordSample();
      return null;
    },
    setProgram(src) {
      set({ program: src });
    },
    focus(id) {
      const sheet = get().sheet;
      set({
        focusId: id,
        selection: [id],
        wireSelection: [],
        workspace: sheet === "cpu" ? "cpu" : "design",
        viewEpoch: get().viewEpoch + 1,
        rev: get().rev + 1,
      });
    },
    setHelp(v) {
      set({ showHelp: v });
    },
    setMenu(m) {
      set({ menu: m });
    },
    setShowInfo(v) {
      set({ showInfoIssues: v });
    },
    setMessage(m) {
      set({ message: m });
    },
    fitView() {
      set({ focusId: null, viewEpoch: get().viewEpoch + 1 });
    },
  };
});

function snap(n: number): number {
  return Math.round(n / 8) * 8;
}

function projectOf(s: Lab): ProjectFile {
  return {
    format: "logicmatter.project",
    version: 1,
    name: s.name,
    sheet: s.sheet,
    sheets: s.sheets,
    program: s.program,
  };
}

export function loadStoredProject() {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (!raw) return;
    useLab.getState().importProject(raw);
    useLab.getState().setMessage("Restored your last project.");
  } catch {
    /* keep the default sheet */
  }
}

export { EXAMPLES };
