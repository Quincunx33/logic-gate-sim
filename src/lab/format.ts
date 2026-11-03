import { bitsToBin, bitsToHex, bitsToNum, type Bits } from "@/sim/signal";
import { disasm } from "@/sim/isa";
import type { CompInst, CompState } from "@/sim/types";

export function fmtBits(bits: Bits): string {
  if (bits.length === 1) return bits[0] === 0 ? "0" : bits[0] === 1 ? "1" : bits[0] === 2 ? "X" : "Z";
  const hex = bitsToHex(bits);
  const n = bitsToNum(bits);
  if (hex && n !== null) return `${bitsToBin(bits)}  ${hex}h  ${n}`;
  return bitsToBin(bits);
}

export function sigKind(bits: Bits, conflict = false): "err" | "z" | "x" | "bus" | "high" | "low" {
  if (conflict) return "err";
  if (bits.length === 0) return "x";
  if (bits.every((b) => b === 3)) return "z";
  if (bits.some((b) => b === 2)) return "x";
  if (bits.some((b) => b === 1) && bits.some((b) => b === 0)) return "bus";
  if (bits.some((b) => b === 1)) return "high";
  return "low";
}

export function badge(comp: CompInst, state: CompState): string | null {
  const n = state.q ? bitsToNum(state.q) : null;
  switch (comp.type) {
    case "pc":
      return n === null ? "PC ?" : "PC " + (n & 15).toString(16).toUpperCase();
    case "mar":
      return n === null ? "MAR ?" : "MAR " + (n & 15).toString(16).toUpperCase();
    case "acc":
      return n === null ? "A ?" : "A " + n.toString(16).toUpperCase().padStart(2, "0");
    case "breg":
      return n === null ? "B ?" : "B " + n.toString(16).toUpperCase().padStart(2, "0");
    case "outreg":
      return n === null ? "OUT ?" : "OUT " + String(n);
    case "ir":
      return n === null ? "IR ?" : disasm(n);
    case "cu":
      return state.halted ? "HALT" : "T" + (state.t ?? 0);
    case "clock":
      return state.level === 1 ? "HIGH" : "LOW";
    case "cnt4":
    case "cnt8":
    case "updown4":
    case "reg4":
    case "reg8":
    case "shift8":
      return n === null ? null : n.toString(16).toUpperCase().padStart(Math.ceil((state.q?.length ?? 4) / 4), "0");
    default:
      return null;
  }
}
