import { cpuCircuit } from "./cpu.ts";
import { createComponent } from "./library.ts";
import type { Circuit, CompInst, ParamValue, Wire } from "./types.ts";

export interface Example {
  id: string;
  name: string;
  blurb: string;
  sheet: "design" | "cpu";
  build: () => Circuit;
}

function sheet(
  parts: { type: string; x: number; y: number; id: string; label: string; params?: Record<string, ParamValue> }[],
  links: [string, string, string, string][],
): Circuit {
  const components: CompInst[] = [];
  let seq = 1;
  for (const p of parts) {
    const c = createComponent(p.type, p.x, p.y, seq++, p.id);
    c.label = p.label;
    if (p.params) c.params = { ...c.params, ...p.params };
    components.push(c);
  }
  const wires: Wire[] = links.map(([c1, p1, c2, p2], i) => ({
    id: "W" + (i + 1),
    a: { c: c1, p: p1 },
    b: { c: c2, p: p2 },
  }));
  return { components, wires, seq };
}

export const EXAMPLES: Example[] = [
  {
    id: "full-adder",
    name: "Full adder",
    blurb: "Sum and carry from A, B, and Cin",
    sheet: "design",
    build: () =>
      sheet(
        [
          { type: "toggle", x: 64, y: 72, id: "a", label: "A" },
          { type: "toggle", x: 64, y: 168, id: "b", label: "B" },
          { type: "toggle", x: 64, y: 264, id: "cin", label: "Cin" },
          { type: "fadd", x: 280, y: 120, id: "fa", label: "FA" },
          { type: "led", x: 520, y: 112, id: "sum", label: "Sum" },
          { type: "led", x: 520, y: 200, id: "cout", label: "Cout" },
          { type: "probe", x: 520, y: 280, id: "psum", label: "Sum probe" },
          { type: "probe", x: 520, y: 352, id: "pcout", label: "Cout probe" },
          { type: "label", x: 64, y: 8, id: "note", label: "Note", params: { text: "Click A, B, or Cin. Watch Sum and Cout." } },
        ],
        [
          ["a", "Y", "fa", "A"],
          ["b", "Y", "fa", "B"],
          ["cin", "Y", "fa", "CIN"],
          ["fa", "SUM", "sum", "A"],
          ["fa", "COUT", "cout", "A"],
          ["fa", "SUM", "psum", "A"],
          ["fa", "COUT", "pcout", "A"],
        ],
      ),
  },
  {
    id: "nand-xor",
    name: "XOR from NAND",
    blurb: "Four NAND gates, no XOR primitive",
    sheet: "design",
    build: () =>
      sheet(
        [
          { type: "toggle", x: 40, y: 80, id: "a", label: "A" },
          { type: "toggle", x: 40, y: 220, id: "b", label: "B" },
          { type: "nand2", x: 220, y: 40, id: "n1", label: "N1" },
          { type: "nand2", x: 220, y: 150, id: "n2", label: "N2" },
          { type: "nand2", x: 220, y: 270, id: "n3", label: "N3" },
          { type: "nand2", x: 420, y: 150, id: "n4", label: "N4" },
          { type: "led", x: 620, y: 160, id: "y", label: "Y" },
          { type: "probe", x: 620, y: 250, id: "py", label: "Y probe" },
        ],
        [
          ["a", "Y", "n1", "A"],
          ["b", "Y", "n1", "B"],
          ["a", "Y", "n2", "A"],
          ["n1", "Y", "n2", "B"],
          ["n1", "Y", "n3", "A"],
          ["b", "Y", "n3", "B"],
          ["n2", "Y", "n4", "A"],
          ["n3", "Y", "n4", "B"],
          ["n4", "Y", "y", "A"],
          ["n4", "Y", "py", "A"],
        ],
      ),
  },
  {
    id: "mux",
    name: "2:1 multiplexer",
    blurb: "S chooses D0 or D1",
    sheet: "design",
    build: () =>
      sheet(
        [
          { type: "toggle", x: 48, y: 48, id: "s", label: "S" },
          { type: "toggle", x: 48, y: 140, id: "d0", label: "D0" },
          { type: "toggle", x: 48, y: 230, id: "d1", label: "D1" },
          { type: "mux2", x: 260, y: 100, id: "mx", label: "MUX" },
          { type: "led", x: 500, y: 140, id: "y", label: "Y" },
          { type: "probe", x: 500, y: 230, id: "py", label: "Y probe" },
        ],
        [
          ["s", "Y", "mx", "S"],
          ["d0", "Y", "mx", "D0"],
          ["d1", "Y", "mx", "D1"],
          ["mx", "Y", "y", "A"],
          ["mx", "Y", "py", "A"],
        ],
      ),
  },
  {
    id: "sr",
    name: "SR latch",
    blurb: "Set, reset, and the illegal 11",
    sheet: "design",
    build: () =>
      sheet(
        [
          { type: "button", x: 48, y: 80, id: "s", label: "Set" },
          { type: "button", x: 48, y: 190, id: "r", label: "Reset" },
          { type: "srlatch", x: 260, y: 100, id: "sr", label: "SR" },
          { type: "led", x: 500, y: 90, id: "q", label: "Q" },
          { type: "led", x: 500, y: 180, id: "qn", label: "Qn" },
        ],
        [
          ["s", "Y", "sr", "S"],
          ["r", "Y", "sr", "R"],
          ["sr", "Q", "q", "A"],
          ["sr", "QN", "qn", "A"],
        ],
      ),
  },
  {
    id: "dff",
    name: "D flip-flop",
    blurb: "Q changes only on the rising clock",
    sheet: "design",
    build: () =>
      sheet(
        [
          { type: "toggle", x: 48, y: 60, id: "d", label: "D" },
          { type: "clock", x: 48, y: 170, id: "clk", label: "CLK", params: { half: 2 } },
          { type: "button", x: 48, y: 280, id: "clr", label: "CLR" },
          { type: "dff", x: 280, y: 120, id: "ff", label: "DFF" },
          { type: "led", x: 540, y: 110, id: "q", label: "Q" },
          { type: "led", x: 540, y: 200, id: "qn", label: "Qn" },
        ],
        [
          ["d", "Y", "ff", "D"],
          ["clk", "CLK", "ff", "CLK"],
          ["clr", "Y", "ff", "CLR"],
          ["ff", "Q", "q", "A"],
          ["ff", "QN", "qn", "A"],
        ],
      ),
  },
  {
    id: "counter",
    name: "4-bit counter",
    blurb: "Clock it and read the hex digit",
    sheet: "design",
    build: () =>
      sheet(
        [
          { type: "clock", x: 48, y: 80, id: "clk", label: "CLK", params: { half: 2 } },
          { type: "button", x: 48, y: 200, id: "clr", label: "CLR" },
          { type: "cnt4", x: 260, y: 90, id: "cnt", label: "CNT" },
          { type: "hex4", x: 520, y: 110, id: "hex", label: "Hex" },
        ],
        [
          ["clk", "CLK", "cnt", "CLK"],
          ["clr", "Y", "cnt", "CLR"],
          ["cnt", "Q", "hex", "D"],
        ],
      ),
  },
  {
    id: "oscillator",
    name: "Inverter loop",
    blurb: "A combinational loop the debugger should catch",
    sheet: "design",
    build: () =>
      sheet(
        [
          { type: "not", x: 180, y: 120, id: "n", label: "INV" },
          { type: "probe", x: 400, y: 130, id: "p", label: "Probe" },
          { type: "label", x: 40, y: 24, id: "note", label: "Note", params: { text: "Output tied to input. This cannot settle." } },
        ],
        [
          ["n", "Y", "n", "A"],
          ["n", "Y", "p", "A"],
        ],
      ),
  },
  {
    id: "conflict",
    name: "Fighting drivers",
    blurb: "Two switches on one wire",
    sheet: "design",
    build: () =>
      sheet(
        [
          { type: "toggle", x: 48, y: 80, id: "a", label: "A", params: { on: true } },
          { type: "toggle", x: 48, y: 200, id: "b", label: "B", params: { on: false } },
          { type: "probe", x: 320, y: 140, id: "p", label: "Probe" },
        ],
        [
          ["a", "Y", "p", "A"],
          ["b", "Y", "p", "A"],
        ],
      ),
  },
  {
    id: "cpu",
    name: "8-bit CPU",
    blurb: "LDA, ADD, OUT — 6 + 7",
    sheet: "cpu",
    build: () => cpuCircuit(),
  },
];

export function exampleById(id: string): Example | undefined {
  return EXAMPLES.find((e) => e.id === id);
}
