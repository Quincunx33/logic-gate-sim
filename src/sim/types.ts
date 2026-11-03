import type { Bits, Sig } from "./signal.ts";

export type Side = "left" | "right" | "top" | "bottom";
export type PinDir = "in" | "out";
export type ParamValue = number | string | boolean | number[];
export type Params = Record<string, ParamValue>;

export interface PinDef {
  id: string;
  name: string;
  dir: PinDir;
  width: number;
  side: Side;
  /** Value read when the net is undriven. Omitted means X (floating). */
  float?: Sig;
}

export type SymbolKind =
  | "and"
  | "or"
  | "xor"
  | "not"
  | "nand"
  | "nor"
  | "xnor"
  | "buf"
  | "box"
  | "led"
  | "switch"
  | "btn"
  | "clock"
  | "const"
  | "seg"
  | "hex"
  | "num"
  | "probe"
  | "label"
  | "bus";

export type Category =
  | "Gates"
  | "Input / Output"
  | "Combinational"
  | "Sequential"
  | "Memory"
  | "Advanced"
  | "CPU";

/** Which inputs affect outputs in the same settle (combinational propagation). */
export type CombInputs = "all" | "none" | string[];

export interface CompDef {
  type: string;
  label: string;
  category: Category;
  blurb: string;
  doc: string;
  pins: PinDef[];
  /** Pin ids shorted into a single electrical net (bus taps). */
  shorts?: string[][];
  sequential: boolean;
  comb: CombInputs;
  /** Clock pin that samples `rise` on a 0→1 transition. */
  clk?: string;
  symbol: SymbolKind;
  minW?: number;
  minH?: number;
  defaultParams: Params;
}

export interface CompInst {
  id: string;
  type: string;
  x: number;
  y: number;
  rot: 0 | 90 | 180 | 270;
  flip: boolean;
  label: string;
  params: Params;
}

export interface Wire {
  id: string;
  a: { c: string; p: string };
  b: { c: string; p: string };
}

export interface Circuit {
  components: CompInst[];
  wires: Wire[];
  seq: number;
}

export interface CompState {
  q?: Bits;
  phase?: number;
  level?: Sig;
  t?: number;
  halted?: boolean;
  mem?: number[];
  invalid?: boolean;
}

export function emptyCircuit(): Circuit {
  return { components: [], wires: [], seq: 1 };
}

export interface Endpoint {
  c: string;
  p: string;
}

export function pinKey(c: string, p: string): string {
  return c + ":" + p;
}
