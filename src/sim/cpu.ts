/** A visible SAP-1 style machine. Every block is an ordinary simulated component. */
import { createComponent } from "./library.ts";
import { DEFAULT_PROGRAM, assemble } from "./isa.ts";
import type { Circuit, CompInst, Wire } from "./types.ts";

export function cpuCircuit(): Circuit {
  const components: CompInst[] = [];
  const wires: Wire[] = [];
  let seq = 1;
  let wi = 1;
  const add = (type: string, x: number, y: number, id: string, label: string) => {
    const c = createComponent(type, x, y, seq++, id);
    c.label = label;
    components.push(c);
    return c;
  };
  const w = (c1: string, p1: string, c2: string, p2: string) => {
    wires.push({ id: "W" + wi++, a: { c: c1, p: p1 }, b: { c: c2, p: p2 } });
  };

  add("clock", 48, 64, "clk", "CLK");
  add("cu", 48, 180, "cu", "Control");
  add("pc", 420, 48, "pc", "PC");
  add("ir", 420, 240, "ir", "IR");
  add("acc", 700, 48, "acc", "ACC");
  add("breg", 700, 280, "breg", "B");
  add("alusap", 980, 48, "alu", "ALU");
  add("outreg", 980, 280, "out", "OUT");
  add("num8", 1220, 300, "disp", "Display");
  add("mar", 420, 500, "mar", "MAR");
  add("iram", 700, 480, "ram", "RAM");
  add("bus", 420, 760, "bus", "BUS");
  add("probe8", 1100, 700, "busprobe", "Bus");
  add("label", 48, 16, "title", "Note");

  const title = components.find((c) => c.id === "title");
  if (title) title.params = { text: "8-bit CPU  ·  one bus, six T-states" };

  const image = assemble(DEFAULT_PROGRAM);
  const ram = components.find((c) => c.id === "ram");
  if (ram) ram.params = { words: image.words };

  for (const id of ["pc", "mar", "ram", "ir", "acc", "breg", "out", "cu"]) w("clk", "CLK", id, "CLK");

  w("cu", "CP", "pc", "CP");
  w("cu", "EP", "pc", "EP");
  w("cu", "LP", "pc", "LP");
  w("cu", "LM", "mar", "LM");
  w("cu", "CE", "ram", "CE");
  w("cu", "WE", "ram", "WE");
  w("cu", "LI", "ir", "LI");
  w("cu", "EI", "ir", "EI");
  w("cu", "LA", "acc", "LA");
  w("cu", "EA", "acc", "EA");
  w("cu", "LB", "breg", "LB");
  w("cu", "SU", "alu", "SU");
  w("cu", "EU", "alu", "EU");
  w("cu", "LO", "out", "LO");
  w("acc", "Z", "cu", "Z");
  w("ir", "OP", "cu", "OP");
  w("mar", "ADDR", "ram", "ADDR");
  w("acc", "A", "alu", "A");
  w("breg", "B", "alu", "B");
  w("out", "OUT", "disp", "D");

  const taps: [string, string, string][] = [
    ["pc", "BIN", "T0"],
    ["pc", "BOUT", "T1"],
    ["mar", "BIN", "T2"],
    ["ram", "BIN", "T3"],
    ["ram", "BOUT", "T4"],
    ["ir", "BIN", "T5"],
    ["ir", "BOUT", "T6"],
    ["acc", "BIN", "T7"],
    ["acc", "BOUT", "T8"],
    ["breg", "BIN", "T9"],
    ["alu", "BOUT", "T10"],
    ["out", "BIN", "T11"],
  ];
  for (const [c, p, t] of taps) w(c, p, "bus", t);
  w("busprobe", "A", "pc", "BOUT");

  return { components, wires, seq };
}

export { DEFAULT_PROGRAM };
