/**
 * SAP-1 style instruction set executed by the control-unit component.
 * Opcode is the high nibble of an 8-bit word; the operand is the low nibble.
 * Memory is 16×8. Microcode is the single source of truth for the control unit.
 */
import { HIGH, LOW, X, type Sig } from "./signal.ts";

export const CTRL = [
  "CP",
  "EP",
  "LM",
  "CE",
  "LI",
  "EI",
  "LA",
  "EA",
  "LB",
  "SU",
  "EU",
  "LO",
  "LP",
  "WE",
  "HLT",
] as const;

export type CtrlName = (typeof CTRL)[number];

export const OP_NAMES = ["NOP", "LDA", "ADD", "SUB", "STA", "JMP", "JZ", "OUT", "HLT", "LDI"] as const;

export const ISA_SUMMARY: { op: string; code: string; meaning: string }[] = [
  { op: "NOP", code: "0x", meaning: "No operation. Fetch the next instruction." },
  { op: "LDA a", code: "1a", meaning: "Accumulator ← RAM[a]." },
  { op: "ADD a", code: "2a", meaning: "Accumulator ← Accumulator + RAM[a]." },
  { op: "SUB a", code: "3a", meaning: "Accumulator ← Accumulator − RAM[a] (8-bit wrap)." },
  { op: "STA a", code: "4a", meaning: "RAM[a] ← Accumulator." },
  { op: "JMP a", code: "5a", meaning: "Program counter ← a." },
  { op: "JZ a", code: "6a", meaning: "If the accumulator is zero, program counter ← a." },
  { op: "OUT", code: "7x", meaning: "Output register ← Accumulator." },
  { op: "HLT", code: "8x", meaning: "Stop the machine. The clock may still toggle, but state freezes." },
  { op: "LDI n", code: "9n", meaning: "Accumulator ← n (low nibble, zero-extended)." },
];

export interface MicroWord {
  signals: Record<CtrlName, Sig>;
  note: string;
}

function blank(): Record<CtrlName, Sig> {
  const s = {} as Record<CtrlName, Sig>;
  for (const n of CTRL) s[n] = LOW;
  return s;
}

function on(base: Record<CtrlName, Sig>, ...names: CtrlName[]) {
  for (const n of names) base[n] = HIGH;
}

/**
 * Control word for T-state `t` (0..5). Fetch (T0–T2) ignores the opcode.
 * `op === null` means the opcode bits are not a known 0/1 value.
 */
export function microcode(op: number | null, t: number, z: Sig): MicroWord {
  const signals = blank();
  let note = "Idle.";
  if (t === 0) {
    on(signals, "EP", "LM");
    note = "T0  MAR ← PC. The program counter drives the bus; the address register will capture it on this clock.";
  } else if (t === 1) {
    on(signals, "CP");
    note = "T1  PC ← PC + 1. Point at the next instruction while the current address is held in MAR.";
  } else if (t === 2) {
    on(signals, "CE", "LI");
    note = "T2  IR ← RAM[MAR]. Memory drives the bus; the instruction register captures the word.";
  } else if (op === null) {
    note = "T" + t + "  Opcode is X, so no data-path transfer is issued.";
  } else if (op === 0) {
    note = "NOP  No data-path transfer in T" + t + ".";
  } else if (op === 1) {
    if (t === 3) {
      on(signals, "EI", "LM");
      note = "LDA T3  MAR ← IR operand. The address field is placed on the bus.";
    } else if (t === 4) {
      on(signals, "CE", "LA");
      note = "LDA T4  ACC ← RAM[MAR].";
    } else note = "LDA T" + t + "  Idle.";
  } else if (op === 2) {
    if (t === 3) {
      on(signals, "EI", "LM");
      note = "ADD T3  MAR ← operand address.";
    } else if (t === 4) {
      on(signals, "CE", "LB");
      note = "ADD T4  B ← RAM[MAR].";
    } else if (t === 5) {
      on(signals, "EU", "LA");
      note = "ADD T5  ACC ← ALU (A + B). SU is low, so the ALU adds.";
    } else note = "ADD  Idle.";
  } else if (op === 3) {
    if (t === 3) {
      on(signals, "EI", "LM");
      note = "SUB T3  MAR ← operand address.";
    } else if (t === 4) {
      on(signals, "CE", "LB");
      note = "SUB T4  B ← RAM[MAR].";
    } else if (t === 5) {
      on(signals, "SU", "EU", "LA");
      note = "SUB T5  ACC ← ALU (A − B). SU is high, so the ALU subtracts.";
    } else note = "SUB  Idle.";
  } else if (op === 4) {
    if (t === 3) {
      on(signals, "EI", "LM");
      note = "STA T3  MAR ← operand address.";
    } else if (t === 4) {
      on(signals, "EA", "WE");
      note = "STA T4  RAM[MAR] ← ACC. The accumulator drives the bus and memory writes.";
    } else note = "STA  Idle.";
  } else if (op === 5) {
    if (t === 3) {
      on(signals, "EI", "LP");
      note = "JMP T3  PC ← IR operand.";
    } else note = "JMP  Idle.";
  } else if (op === 6) {
    if (t === 3 && z === HIGH) {
      on(signals, "EI", "LP");
      note = "JZ T3  Accumulator is zero, so PC ← operand.";
    } else if (t === 3 && z === LOW) {
      note = "JZ T3  Accumulator is not zero. The branch is not taken.";
    } else if (t === 3) {
      note = "JZ T3  Zero flag is " + (z === X ? "X" : "Z") + ". The branch is not taken.";
    } else note = "JZ  Idle.";
  } else if (op === 7) {
    if (t === 3) {
      on(signals, "EA", "LO");
      note = "OUT T3  OUT ← ACC.";
    } else note = "OUT  Idle.";
  } else if (op === 8) {
    if (t === 3) {
      on(signals, "HLT");
      note = "HLT T3  Halt. The control unit freezes on the next rising edge.";
    } else note = "HLT  Waiting.";
  } else if (op === 9) {
    if (t === 3) {
      on(signals, "EI", "LA");
      note = "LDI T3  ACC ← zero-extended immediate in the instruction.";
    } else note = "LDI  Idle.";
  } else {
    note = "Unused opcode " + op + " at T" + t + ". No transfer.";
  }
  return { signals, note };
}

export function disasm(word: number): string {
  const op = (word >>> 4) & 0xf;
  const a = word & 0xf;
  const name = OP_NAMES[op] ?? "???";
  const needs = (op >= 1 && op <= 6) || op === 9;
  return needs ? `${name} ${a}` : name;
}

export interface ListingLine {
  line: number;
  addr: number | null;
  word: number | null;
  text: string;
}

export interface AssembleResult {
  words: number[];
  errors: string[];
  listing: ListingLine[];
}

function parseNum(s: string | undefined): number | null {
  if (!s) return null;
  const t = s.trim();
  if (/^0x[0-9a-f]+$/i.test(t)) return Number.parseInt(t.slice(2), 16);
  if (/^%[01]+$/.test(t)) return Number.parseInt(t.slice(1), 2);
  if (/^[0-9]+$/.test(t)) return Number.parseInt(t, 10);
  return null;
}

const NEEDS_OPERAND = new Set(["LDA", "ADD", "SUB", "STA", "JMP", "JZ", "LDI"]);

/** Assemble a tiny listing into a 16-byte image. Unknown mnemonics are errors, never guesses. */
export function assemble(src: string): AssembleResult {
  const words = new Array<number>(16).fill(0);
  const errors: string[] = [];
  const listing: ListingLine[] = [];
  let addr = 0;
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const text = raw.replace(/;.*$/, "").trim();
    if (!text) continue;
    const parts = text.split(/[\s,]+/).filter(Boolean);
    const op = (parts[0] ?? "").toUpperCase();
    const lineNo = i + 1;
    if (op === "ORG" || op === ".ORG") {
      const n = parseNum(parts[1]);
      if (n === null || n < 0 || n > 15) errors.push(`Line ${lineNo}: ORG needs an address 0–15.`);
      else addr = n;
      listing.push({ line: lineNo, addr: null, word: null, text: raw.trim() });
      continue;
    }
    if (op === "DB" || op === ".DB" || op === "DATA") {
      const n = parseNum(parts[1]);
      if (n === null || n < 0 || n > 255) errors.push(`Line ${lineNo}: DB needs a byte 0–255.`);
      else if (addr > 15) errors.push(`Line ${lineNo}: address ${addr} is outside 0–15.`);
      else {
        words[addr] = n & 255;
        listing.push({ line: lineNo, addr, word: n & 255, text: raw.trim() });
        addr++;
      }
      continue;
    }
    const code = OP_NAMES.indexOf(op as (typeof OP_NAMES)[number]);
    if (code < 0) {
      errors.push(`Line ${lineNo}: unknown mnemonic “${parts[0]}”.`);
      continue;
    }
    let operand = 0;
    if (NEEDS_OPERAND.has(op)) {
      const n = parseNum(parts[1]);
      if (n === null) {
        errors.push(`Line ${lineNo}: ${op} needs an operand.`);
        continue;
      }
      if (n < 0 || n > 15) errors.push(`Line ${lineNo}: operand ${n} does not fit in 4 bits. Low nibble will be used.`);
      operand = n & 0xf;
    }
    if (addr > 15) {
      errors.push(`Line ${lineNo}: address ${addr} is outside 0–15.`);
      continue;
    }
    const word = ((code & 0xf) << 4) | (operand & 0xf);
    words[addr] = word;
    listing.push({ line: lineNo, addr, word, text: raw.trim() });
    addr++;
  }
  return { words, errors, listing };
}

export const DEFAULT_PROGRAM = `; Add two bytes and show the sum
LDA 14
ADD 15
OUT
HLT
ORG 14
DB 6
DB 7
`;

/** Fetch always runs. Documented for the microcode viewer. */
export const FETCH_NOTES = [
  "T0 EP LM — MAR ← PC",
  "T1 CP — PC ← PC+1",
  "T2 CE LI — IR ← RAM[MAR]",
];

void X;
