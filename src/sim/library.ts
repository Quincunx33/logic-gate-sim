/**
 * Component catalog and evaluation behaviors.
 * Behaviors are pure: same inputs, state, and parameters always produce the same outputs.
 */
import { CTRL, microcode } from "./isa.ts";
import {
  HIGH,
  LOW,
  X,
  Z,
  addBits,
  and,
  bit,
  bitsToNum,
  capture,
  fill,
  fit,
  fold,
  fromNum,
  invertBits,
  not,
  or,
  xor,
  zeroFlag,
  zeros,
  type Bits,
  type Sig,
} from "./signal.ts";
import type { CombInputs, CompDef, CompInst, CompState, Params, PinDef, Side, SymbolKind } from "./types.ts";

export interface InMap {
  [pin: string]: Bits;
}

export interface EvalOut {
  out: Record<string, Bits>;
  state?: CompState;
}

export interface Behavior {
  init(params: Params): CompState;
  outputs(inp: InMap, state: CompState, params: Params): EvalOut;
  rise?(inp: InMap, state: CompState, params: Params): CompState;
  step?(state: CompState, params: Params): CompState;
}

const IN = "in" as const;
const OUT = "out" as const;

function pin(
  id: string,
  name: string,
  dir: "in" | "out",
  side: Side,
  width = 1,
  float?: Sig,
): PinDef {
  return { id, name, dir, width, side, float };
}

function gatePins(inputs: string[]): PinDef[] {
  return [
    ...inputs.map((id) => pin(id, id, IN, "left")),
    pin("Y", "Y", OUT, "right"),
  ];
}

interface DefInit {
  type: string;
  label: string;
  category: CompDef["category"];
  blurb: string;
  doc: string;
  pins: PinDef[];
  shorts?: string[][];
  sequential?: boolean;
  comb?: CombInputs;
  clk?: string;
  symbol: SymbolKind;
  minW?: number;
  minH?: number;
  defaultParams?: Params;
}

function define(d: DefInit): CompDef {
  return {
    type: d.type,
    label: d.label,
    category: d.category,
    blurb: d.blurb,
    doc: d.doc,
    pins: d.pins,
    shorts: d.shorts,
    sequential: d.sequential ?? false,
    comb: d.comb ?? "all",
    clk: d.clk,
    symbol: d.symbol,
    minW: d.minW,
    minH: d.minH,
    defaultParams: d.defaultParams ?? {},
  };
}

const noState: Behavior = {
  init: () => ({}),
  outputs: () => ({ out: {} }),
};

function logicGate(kind: "and" | "or" | "xor" | "nand" | "nor" | "xnor" | "not" | "buf"): Behavior {
  return {
    init: () => ({}),
    outputs(inp) {
      const values = Object.entries(inp)
        .filter(([k]) => k !== "Y")
        .map(([, v]) => bit(v));
      let y: Sig = X;
      if (kind === "not") y = not(values[0] ?? X);
      else if (kind === "buf") y = values[0] === Z || values[0] === undefined ? X : values[0];
      else if (kind === "and" || kind === "nand") {
        y = fold(values, and, HIGH);
        if (kind === "nand") y = not(y);
      } else if (kind === "or" || kind === "nor") {
        y = fold(values, or, LOW);
        if (kind === "nor") y = not(y);
      } else {
        y = fold(values, xor, LOW);
        if (kind === "xnor") y = not(y);
      }
      return { out: { Y: [y] } };
    },
  };
}

function fullAdd(a: Sig, b: Sig, cin: Sig): { sum: Sig; cout: Sig } {
  const axb = xor(a, b);
  return { sum: xor(axb, cin), cout: or(and(a, b), and(cin, axb)) };
}

function mux1(sel: Sig, d0: Sig, d1: Sig): Sig {
  const a = d0 === Z ? X : d0;
  const b = d1 === Z ? X : d1;
  if (sel === LOW) return a;
  if (sel === HIGH) return b;
  if (a === b) return a;
  return X;
}

const behaviors: Record<string, Behavior> = {};

function regBehavior(width: number, alwaysLoad = false): Behavior {
  return {
    init: () => ({ q: zeros(width) }),
    outputs(inp, st) {
      let q = fit(st.q, width, LOW);
      if (bit(inp.CLR) === HIGH) q = zeros(width);
      return { out: { Q: q }, state: { ...st, q } };
    },
    rise(inp, st) {
      if (bit(inp.CLR) === HIGH) return { ...st, q: zeros(width) };
      const en = alwaysLoad ? HIGH : bit(inp.EN);
      if (en === HIGH) return { ...st, q: capture(inp.D, width) };
      if (en === X) return { ...st, q: fill(X, width) };
      return { ...st, q: fit(st.q, width, LOW) };
    },
  };
}

behaviors.and2 = logicGate("and");
behaviors.and3 = logicGate("and");
behaviors.or2 = logicGate("or");
behaviors.or3 = logicGate("or");
behaviors.not = logicGate("not");
behaviors.nand2 = logicGate("nand");
behaviors.nor2 = logicGate("nor");
behaviors.xor2 = logicGate("xor");
behaviors.xnor2 = logicGate("xnor");
behaviors.buf = logicGate("buf");

behaviors.toggle = {
  init: () => ({}),
  outputs(_i, _s, params) {
    return { out: { Y: [params.on ? HIGH : LOW] } };
  },
};
behaviors.button = {
  init: () => ({}),
  outputs(_i, _s, params) {
    return { out: { Y: [params.down ? HIGH : LOW] } };
  },
};
behaviors.vcc = {
  init: () => ({}),
  outputs: () => ({ out: { Y: [HIGH] } }),
};
behaviors.gnd = {
  init: () => ({}),
  outputs: () => ({ out: { Y: [LOW] } }),
};
behaviors.clock = {
  init: () => ({ phase: 0, level: LOW }),
  step(st, params) {
    const half = Math.max(1, Math.floor(Number(params.half) || 1));
    let phase = (st.phase ?? 0) + 1;
    let level: Sig = st.level === HIGH ? HIGH : LOW;
    if (phase >= half) {
      phase = 0;
      level = level === HIGH ? LOW : HIGH;
    }
    return { ...st, phase, level };
  },
  outputs(_i, st) {
    return { out: { CLK: [st.level === HIGH ? HIGH : LOW] } };
  },
};
behaviors.led = noState;
behaviors.probe = noState;
behaviors.probe8 = noState;
behaviors.seg7 = noState;
behaviors.hex4 = noState;
behaviors.num8 = noState;
behaviors.label = noState;

behaviors.hadd = {
  init: () => ({}),
  outputs(inp) {
    const a = bit(inp.A);
    const b = bit(inp.B);
    return { out: { SUM: [xor(a, b)], COUT: [and(a, b)] } };
  },
};
behaviors.fadd = {
  init: () => ({}),
  outputs(inp) {
    const r = fullAdd(bit(inp.A), bit(inp.B), bit(inp.CIN));
    return { out: { SUM: [r.sum], COUT: [r.cout] } };
  },
};
behaviors.hsub = {
  init: () => ({}),
  outputs(inp) {
    const a = bit(inp.A);
    const b = bit(inp.B);
    return { out: { DIFF: [xor(a, b)], BOUT: [and(not(a), b)] } };
  },
};
behaviors.fsub = {
  init: () => ({}),
  outputs(inp) {
    const a = bit(inp.A);
    const b = bit(inp.B);
    const bin = bit(inp.BIN);
    const axb = xor(a, b);
    const diff = xor(axb, bin);
    const bout = or(and(not(a), b), and(not(axb), bin));
    return { out: { DIFF: [diff], BOUT: [bout] } };
  },
};
behaviors.mux2 = {
  init: () => ({}),
  outputs(inp) {
    return { out: { Y: [mux1(bit(inp.S), bit(inp.D0), bit(inp.D1))] } };
  },
};
behaviors.mux4 = {
  init: () => ({}),
  outputs(inp) {
    const s1 = bit(inp.S1);
    const s0 = bit(inp.S0);
    const d = [bit(inp.D0), bit(inp.D1), bit(inp.D2), bit(inp.D3)];
    if (s1 !== LOW && s1 !== HIGH) {
      const known = d.filter((x) => x === LOW || x === HIGH);
      const same = known.length === 4 && known.every((x) => x === known[0]);
      return { out: { Y: [same ? known[0]! : X] } };
    }
    if (s0 !== LOW && s0 !== HIGH) {
      const i0 = s1 === HIGH ? 2 : 0;
      return { out: { Y: [mux1(s0, d[i0]!, d[i0 + 1]!)] } };
    }
    const idx = (s1 === HIGH ? 2 : 0) + (s0 === HIGH ? 1 : 0);
    return { out: { Y: [d[idx] === Z ? X : d[idx]!] } };
  },
};
behaviors.dmux4 = {
  init: () => ({}),
  outputs(inp) {
    const s1 = bit(inp.S1);
    const s0 = bit(inp.S0);
    const d = bit(inp.D);
    const y: Sig[] = [LOW, LOW, LOW, LOW];
    if ((s1 !== LOW && s1 !== HIGH) || (s0 !== LOW && s0 !== HIGH) || (d !== LOW && d !== HIGH)) {
      return { out: { Y0: [X], Y1: [X], Y2: [X], Y3: [X] } };
    }
    const idx = (s1 === HIGH ? 2 : 0) + (s0 === HIGH ? 1 : 0);
    y[idx] = d;
    return { out: { Y0: [y[0]!], Y1: [y[1]!], Y2: [y[2]!], Y3: [y[3]!] } };
  },
};
behaviors.dec2 = {
  init: () => ({}),
  outputs(inp) {
    const a = bit(inp.A);
    const b = bit(inp.B);
    if ((a !== LOW && a !== HIGH) || (b !== LOW && b !== HIGH)) {
      return { out: { Y0: [X], Y1: [X], Y2: [X], Y3: [X] } };
    }
    const idx = (b === HIGH ? 2 : 0) + (a === HIGH ? 1 : 0);
    const y = [0, 1, 2, 3].map((i) => (i === idx ? HIGH : LOW));
    return { out: { Y0: [y[0]!], Y1: [y[1]!], Y2: [y[2]!], Y3: [y[3]!] } };
  },
};
behaviors.enc4 = {
  init: () => ({}),
  outputs(inp) {
    const ins = [bit(inp.I0), bit(inp.I1), bit(inp.I2), bit(inp.I3)];
    if (ins.some((s) => s !== LOW && s !== HIGH)) return { out: { Y0: [X], Y1: [X], V: [X] } };
    const highs = ins.map((s, i) => (s === HIGH ? i : -1)).filter((i) => i >= 0);
    if (highs.length === 0) return { out: { Y0: [LOW], Y1: [LOW], V: [LOW] } };
    if (highs.length !== 1) return { out: { Y0: [X], Y1: [X], V: [X] } };
    const n = highs[0]!;
    return { out: { Y0: [n & 1 ? HIGH : LOW], Y1: [n & 2 ? HIGH : LOW], V: [HIGH] } };
  },
};
behaviors.pri4 = {
  init: () => ({}),
  outputs(inp) {
    const ins = [bit(inp.I0), bit(inp.I1), bit(inp.I2), bit(inp.I3)];
    for (let i = 3; i >= 0; i--) {
      if (ins[i] === HIGH) {
        return { out: { Y0: [i & 1 ? HIGH : LOW], Y1: [i & 2 ? HIGH : LOW], V: [HIGH] } };
      }
      if (ins[i] !== LOW) return { out: { Y0: [X], Y1: [X], V: [X] } };
    }
    return { out: { Y0: [LOW], Y1: [LOW], V: [LOW] } };
  },
};
behaviors.cmp1 = {
  init: () => ({}),
  outputs(inp) {
    const a = bit(inp.A);
    const b = bit(inp.B);
    return {
      out: {
        GT: [and(a, not(b))],
        EQ: [not(xor(a, b))],
        LT: [and(not(a), b)],
      },
    };
  },
};
behaviors.cmp4 = {
  init: () => ({}),
  outputs(inp) {
    const a = bitsToNum(fit(inp.A, 4, X));
    const b = bitsToNum(fit(inp.B, 4, X));
    if (a === null || b === null) return { out: { GT: [X], EQ: [X], LT: [X] } };
    return {
      out: {
        GT: [a > b ? HIGH : LOW],
        EQ: [a === b ? HIGH : LOW],
        LT: [a < b ? HIGH : LOW],
      },
    };
  },
};

behaviors.srlatch = {
  init: () => ({ q: [LOW], invalid: false }),
  outputs(inp, st) {
    const s = bit(inp.S);
    const r = bit(inp.R);
    let q: Sig = bit(st.q);
    let invalid = false;
    let qn: Sig = not(q);
    if (s === HIGH && r === HIGH) {
      q = LOW;
      qn = LOW;
      invalid = true;
    } else if (s === HIGH && r === LOW) {
      q = HIGH;
      qn = LOW;
    } else if (s === LOW && r === HIGH) {
      q = LOW;
      qn = HIGH;
    } else if (s === LOW && r === LOW) {
      qn = not(q);
    } else {
      q = X;
      qn = X;
    }
    return { out: { Q: [q], QN: [qn] }, state: { ...st, q: [q === X ? X : q], invalid } };
  },
};

function dffBehavior(): Behavior {
  return {
    init: () => ({ q: [LOW] }),
    outputs(inp, st) {
      let q = fit(st.q, 1, LOW);
      if (bit(inp.CLR) === HIGH) q = [LOW];
      return { out: { Q: q, QN: invertBits(q) }, state: { ...st, q } };
    },
    rise(inp, st) {
      if (bit(inp.CLR) === HIGH) return { ...st, q: [LOW] };
      return { ...st, q: capture(inp.D, 1) };
    },
  };
}
behaviors.dff = dffBehavior();

behaviors.jkff = {
  init: () => ({ q: [LOW] }),
  outputs(inp, st) {
    let q = fit(st.q, 1, LOW);
    if (bit(inp.CLR) === HIGH) q = [LOW];
    return { out: { Q: q, QN: invertBits(q) }, state: { ...st, q } };
  },
  rise(inp, st) {
    if (bit(inp.CLR) === HIGH) return { ...st, q: [LOW] };
    const j = bit(inp.J);
    const k = bit(inp.K);
    let q = bit(st.q);
    if (j === LOW && k === LOW) {
      /* hold */
    } else if (j === HIGH && k === LOW) q = HIGH;
    else if (j === LOW && k === HIGH) q = LOW;
    else if (j === HIGH && k === HIGH) q = q === HIGH ? LOW : q === LOW ? HIGH : X;
    else q = X;
    return { ...st, q: [q] };
  },
};

behaviors.tff = {
  init: () => ({ q: [LOW] }),
  outputs(inp, st) {
    let q = fit(st.q, 1, LOW);
    if (bit(inp.CLR) === HIGH) q = [LOW];
    return { out: { Q: q, QN: invertBits(q) }, state: { ...st, q } };
  },
  rise(inp, st) {
    if (bit(inp.CLR) === HIGH) return { ...st, q: [LOW] };
    const t = bit(inp.T);
    let q = bit(st.q);
    if (t === HIGH) q = q === HIGH ? LOW : q === LOW ? HIGH : X;
    else if (t !== LOW) q = X;
    return { ...st, q: [q] };
  },
};

behaviors.reg4 = regBehavior(4);
behaviors.reg8 = regBehavior(8);

behaviors.shift8 = {
  init: () => ({ q: zeros(8) }),
  outputs(_i, st) {
    return { out: { Q: fit(st.q, 8, LOW) } };
  },
  rise(inp, st) {
    const en = bit(inp.EN);
    if (en === LOW) return { ...st, q: fit(st.q, 8, LOW) };
    if (en !== HIGH) return { ...st, q: fill(X, 8) };
    const q = fit(st.q, 8, LOW);
    for (let i = 7; i > 0; i--) q[i] = q[i - 1]!;
    q[0] = bit(inp.SIN) === Z ? X : bit(inp.SIN);
    return { ...st, q };
  },
};

function counterBehavior(width: number, updown: boolean): Behavior {
  return {
    init: () => ({ q: zeros(width) }),
    outputs(inp, st) {
      let q = fit(st.q, width, LOW);
      if (bit(inp.CLR) === HIGH) q = zeros(width);
      return { out: { Q: q }, state: { ...st, q } };
    },
    rise(inp, st) {
      if (bit(inp.CLR) === HIGH) return { ...st, q: zeros(width) };
      const en = bit(inp.EN);
      if (en === LOW) return { ...st, q: fit(st.q, width, LOW) };
      if (en !== HIGH) return { ...st, q: fill(X, width) };
      const cur = bitsToNum(fit(st.q, width, LOW)) ?? 0;
      let dir = 1;
      if (updown) {
        const up = bit(inp.UP);
        if (up === X || up === Z) return { ...st, q: fill(X, width) };
        dir = up === HIGH ? 1 : -1;
      }
      const mask = (1 << width) - 1;
      const next = (cur + dir) & mask;
      return { ...st, q: fromNum(next, width) };
    },
  };
}
behaviors.cnt4 = counterBehavior(4, false);
behaviors.cnt8 = counterBehavior(8, false);
behaviors.updown4 = counterBehavior(4, true);

function wordsOf(params: Params, n: number): number[] {
  const src = Array.isArray(params.words) ? (params.words as number[]) : [];
  const mem = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) mem[i] = (src[i] ?? 0) & 255;
  return mem;
}

behaviors.ram16 = {
  init: (params) => ({ mem: wordsOf(params, 16) }),
  outputs(inp, st) {
    const ce = bit(inp.CE);
    if (ce !== HIGH) return { out: { DOUT: fill(ce === LOW ? Z : X, 8) } };
    const a = bitsToNum(fit(inp.ADDR, 4, X));
    if (a === null) return { out: { DOUT: fill(X, 8) } };
    const mem = st.mem ?? wordsOf({}, 16);
    return { out: { DOUT: fromNum(mem[a & 15] ?? 0, 8) } };
  },
  rise(inp, st, params) {
    const mem = (st.mem ?? wordsOf(params, 16)).slice();
    if (bit(inp.WE) === HIGH) {
      const a = bitsToNum(fit(inp.ADDR, 4, X));
      const d = bitsToNum(fit(inp.DIN, 8, X));
      if (a !== null && d !== null) mem[a & 15] = d & 255;
    }
    return { ...st, mem };
  },
};

behaviors.rom16 = {
  init: (params) => ({ mem: wordsOf(params, 16) }),
  outputs(inp, st, params) {
    const oe = bit(inp.OE);
    if (oe !== HIGH) return { out: { DOUT: fill(oe === LOW ? Z : X, 8) } };
    const a = bitsToNum(fit(inp.ADDR, 4, X));
    const mem = st.mem ?? wordsOf(params, 16);
    if (a === null) return { out: { DOUT: fill(X, 8) } };
    return { out: { DOUT: fromNum(mem[a & 15] ?? 0, 8) } };
  },
};

behaviors.regfile = {
  init: () => ({ mem: [0, 0, 0, 0] }),
  outputs(inp, st) {
    const a = bitsToNum(fit(inp.ADDR, 2, X));
    const mem = st.mem ?? [0, 0, 0, 0];
    if (a === null) return { out: { DOUT: fill(X, 8) } };
    return { out: { DOUT: fromNum(mem[a & 3] ?? 0, 8) } };
  },
  rise(inp, st) {
    const mem = (st.mem ?? [0, 0, 0, 0]).slice();
    if (bit(inp.WE) === HIGH) {
      const a = bitsToNum(fit(inp.ADDR, 2, X));
      const d = bitsToNum(fit(inp.DIN, 8, X));
      if (a !== null && d !== null) mem[a & 3] = d & 255;
    }
    return { ...st, mem };
  },
};

function aluCompute(a: Bits, b: Bits, op: number): { y: Bits; cout: Sig } {
  if (op === 0) return addBits(a, b, LOW);
  if (op === 1) return addBits(a, invertBits(b), HIGH);
  if (op === 2) return { y: a.map((bitA, i) => and(bitA, b[i] ?? LOW)), cout: LOW };
  if (op === 3) return { y: a.map((bitA, i) => or(bitA, b[i] ?? LOW)), cout: LOW };
  if (op === 4) return { y: a.map((bitA, i) => xor(bitA, b[i] ?? LOW)), cout: LOW };
  if (op === 5) return { y: invertBits(a), cout: LOW };
  if (op === 6) return addBits(a, zeros(a.length), HIGH);
  return { y: fit(b, a.length, LOW), cout: LOW };
}

behaviors.alu8 = {
  init: () => ({}),
  outputs(inp) {
    const a = fit(inp.A, 8, X);
    const b = fit(inp.B, 8, X);
    const op = bitsToNum(fit(inp.OP, 3, X));
    if (op === null || a.some((s) => s === X || s === Z) || (op !== 5 && op !== 6 && b.some((s) => s === X || s === Z))) {
      return { out: { Y: fill(X, 8), C: [X], Z: [X] } };
    }
    const r = aluCompute(a, b, op);
    return { out: { Y: r.y, C: [r.cout], Z: [zeroFlag(r.y)] } };
  },
};

function tristate(width: number): Behavior {
  return {
    init: () => ({}),
    outputs(inp) {
      const en = bit(inp.EN);
      if (en === HIGH) return { out: { Y: fit(inp.D, width, X).map((s) => (s === Z ? X : s)) } };
      if (en === LOW) return { out: { Y: fill(Z, width) } };
      return { out: { Y: fill(X, width) } };
    },
  };
}
behaviors.tri1 = tristate(1);
behaviors.tri8 = tristate(8);

behaviors.split8 = {
  init: () => ({}),
  outputs(inp) {
    const d = fit(inp.D, 8, X);
    const out: Record<string, Bits> = {};
    for (let i = 0; i < 8; i++) out["B" + i] = [d[i]!];
    return { out };
  },
};
behaviors.merge8 = {
  init: () => ({}),
  outputs(inp) {
    const y: Bits = [];
    for (let i = 0; i < 8; i++) y.push(bit(inp["B" + i]));
    return { out: { Y: y } };
  },
};

behaviors.bus = noState;

behaviors.idec = {
  init: () => ({}),
  outputs(inp) {
    const n = bitsToNum(fit(inp.OP, 4, X));
    const out: Record<string, Bits> = {};
    for (let i = 0; i < 16; i++) out["Y" + i] = [n === null ? X : n === i ? HIGH : LOW];
    return { out };
  },
};

behaviors.expr = {
  init: () => ({}),
  outputs(inp, _s, params) {
    const env: Record<string, Sig> = {
      a: bit(inp.A),
      b: bit(inp.B),
      c: bit(inp.C),
      d: bit(inp.D),
    };
    const formula = String(params.formula ?? "a & b");
    const ev = evalFormula(formula, env);
    return { out: { Y: [ev.value] } };
  },
};

behaviors.pc = {
  init: () => ({ q: zeros(8) }),
  outputs(inp, st) {
    const q = fit(st.q, 8, LOW);
    const ep = bit(inp.EP);
    const bout = ep === HIGH ? q : ep === LOW ? fill(Z, 8) : fill(X, 8);
    return { out: { BOUT: bout } };
  },
  rise(inp, st) {
    if (bit(inp.LP) === HIGH) {
      const b = bitsToNum(fit(inp.BIN, 8, X));
      if (b === null) return { ...st, q: fill(X, 8) };
      return { ...st, q: fromNum(b & 0xf, 8) };
    }
    if (bit(inp.CP) === HIGH) {
      const cur = (bitsToNum(fit(st.q, 8, LOW)) ?? 0) & 0xf;
      return { ...st, q: fromNum((cur + 1) & 0xf, 8) };
    }
    return { ...st, q: fit(st.q, 8, LOW) };
  },
};

behaviors.mar = {
  init: () => ({ q: zeros(4) }),
  outputs(_i, st) {
    return { out: { ADDR: fit(st.q, 4, LOW) } };
  },
  rise(inp, st) {
    if (bit(inp.LM) !== HIGH) return { ...st, q: fit(st.q, 4, LOW) };
    const b = bitsToNum(fit(inp.BIN, 8, X));
    if (b === null) return { ...st, q: fill(X, 4) };
    return { ...st, q: fromNum(b & 0xf, 4) };
  },
};

behaviors.iram = {
  init: (params) => ({ mem: wordsOf(params, 16) }),
  outputs(inp, st, params) {
    const ce = bit(inp.CE);
    if (ce !== HIGH) return { out: { BOUT: fill(ce === LOW ? Z : X, 8) } };
    const a = bitsToNum(fit(inp.ADDR, 4, X));
    const mem = st.mem ?? wordsOf(params, 16);
    if (a === null) return { out: { BOUT: fill(X, 8) } };
    return { out: { BOUT: fromNum(mem[a & 15] ?? 0, 8) } };
  },
  rise(inp, st, params) {
    const mem = (st.mem ?? wordsOf(params, 16)).slice();
    if (bit(inp.WE) === HIGH) {
      const a = bitsToNum(fit(inp.ADDR, 4, X));
      const d = bitsToNum(fit(inp.BIN, 8, X));
      if (a !== null && d !== null) mem[a & 15] = d & 255;
    }
    return { ...st, mem };
  },
};

behaviors.ir = {
  init: () => ({ q: zeros(8) }),
  outputs(inp, st) {
    const q = fit(st.q, 8, LOW);
    const op = [q[4] ?? LOW, q[5] ?? LOW, q[6] ?? LOW, q[7] ?? LOW];
    const ei = bit(inp.EI);
    const low: Bits = [q[0] ?? LOW, q[1] ?? LOW, q[2] ?? LOW, q[3] ?? LOW, LOW, LOW, LOW, LOW];
    const bout: Bits = ei === HIGH ? low : ei === LOW ? fill(Z, 8) : fill(X, 8);
    return { out: { OP: op, BOUT: bout } };
  },
  rise(inp, st) {
    if (bit(inp.LI) !== HIGH) return { ...st, q: fit(st.q, 8, LOW) };
    return { ...st, q: capture(inp.BIN, 8) };
  },
};

behaviors.acc = {
  init: () => ({ q: zeros(8) }),
  outputs(inp, st) {
    const q = fit(st.q, 8, LOW);
    const ea = bit(inp.EA);
    const bout = ea === HIGH ? q : ea === LOW ? fill(Z, 8) : fill(X, 8);
    return { out: { A: q, Z: [zeroFlag(q)], BOUT: bout } };
  },
  rise(inp, st) {
    if (bit(inp.LA) !== HIGH) return { ...st, q: fit(st.q, 8, LOW) };
    return { ...st, q: capture(inp.BIN, 8) };
  },
};

behaviors.breg = {
  init: () => ({ q: zeros(8) }),
  outputs(_i, st) {
    return { out: { B: fit(st.q, 8, LOW) } };
  },
  rise(inp, st) {
    if (bit(inp.LB) !== HIGH) return { ...st, q: fit(st.q, 8, LOW) };
    return { ...st, q: capture(inp.BIN, 8) };
  },
};

behaviors.alusap = {
  init: () => ({}),
  outputs(inp) {
    const a = fit(inp.A, 8, X);
    const b = fit(inp.B, 8, X);
    const su = bit(inp.SU);
    const eu = bit(inp.EU);
    let y = fill(X, 8);
    if ((su === LOW || su === HIGH) && a.every((s) => s === LOW || s === HIGH) && b.every((s) => s === LOW || s === HIGH)) {
      y = su === HIGH ? addBits(a, invertBits(b), HIGH).y : addBits(a, b, LOW).y;
    }
    const bout = eu === HIGH ? y : eu === LOW ? fill(Z, 8) : fill(X, 8);
    return { out: { BOUT: bout } };
  },
};

behaviors.outreg = {
  init: () => ({ q: zeros(8) }),
  outputs(_i, st) {
    return { out: { OUT: fit(st.q, 8, LOW) } };
  },
  rise(inp, st) {
    if (bit(inp.LO) !== HIGH) return { ...st, q: fit(st.q, 8, LOW) };
    return { ...st, q: capture(inp.BIN, 8) };
  },
};

behaviors.cu = {
  init: () => ({ t: 0, halted: false }),
  outputs(inp, st) {
    const op = bitsToNum(fit(inp.OP, 4, X));
    const z = bit(inp.Z);
    const t = st.t ?? 0;
    const word = st.halted ? { signals: haltWord(), note: "Halted." } : microcode(op, t, z);
    const out: Record<string, Bits> = {};
    for (const name of CTRL) out[name] = [word.signals[name]];
    out.T = fromNum(t & 7, 3);
    return { out };
  },
  rise(inp, st) {
    if (st.halted) return st;
    const op = bitsToNum(fit(inp.OP, 4, X));
    const z = bit(inp.Z);
    const t = st.t ?? 0;
    const word = microcode(op, t, z);
    if (word.signals.HLT === HIGH) return { ...st, halted: true, t };
    return { ...st, t: (t + 1) % 6 };
  },
};

function haltWord(): Record<(typeof CTRL)[number], Sig> {
  const s = {} as Record<(typeof CTRL)[number], Sig>;
  for (const n of CTRL) s[n] = n === "HLT" ? HIGH : LOW;
  return s;
}

const DEFS: CompDef[] = [
  define({
    type: "and2",
    label: "AND",
    category: "Gates",
    symbol: "and",
    blurb: "Y = A · B",
    doc: "Two-input AND. Output is 0 if either input is 0. Output is X if no input is 0 and any input is X or Z.",
    pins: gatePins(["A", "B"]),
  }),
  define({
    type: "and3",
    label: "AND3",
    category: "Gates",
    symbol: "and",
    blurb: "Y = A · B · C",
    doc: "Three-input AND. A single 0 forces the output to 0.",
    pins: gatePins(["A", "B", "C"]),
  }),
  define({
    type: "or2",
    label: "OR",
    category: "Gates",
    symbol: "or",
    blurb: "Y = A + B",
    doc: "Two-input OR. Output is 1 if either input is 1. Output is X if no input is 1 and any input is X or Z.",
    pins: gatePins(["A", "B"]),
  }),
  define({
    type: "or3",
    label: "OR3",
    category: "Gates",
    symbol: "or",
    blurb: "Y = A + B + C",
    doc: "Three-input OR. A single 1 forces the output to 1.",
    pins: gatePins(["A", "B", "C"]),
  }),
  define({
    type: "not",
    label: "NOT",
    category: "Gates",
    symbol: "not",
    blurb: "Y = ¬A",
    doc: "Inverter. 0→1, 1→0. X or Z in produces X.",
    pins: gatePins(["A"]),
  }),
  define({
    type: "nand2",
    label: "NAND",
    category: "Gates",
    symbol: "nand",
    blurb: "Y = ¬(A · B)",
    doc: "Two-input NAND. Universal gate: any Boolean function can be built from NAND alone.",
    pins: gatePins(["A", "B"]),
  }),
  define({
    type: "nor2",
    label: "NOR",
    category: "Gates",
    symbol: "nor",
    blurb: "Y = ¬(A + B)",
    doc: "Two-input NOR. Universal gate. Cross-coupled NORs form an SR latch.",
    pins: gatePins(["A", "B"]),
  }),
  define({
    type: "xor2",
    label: "XOR",
    category: "Gates",
    symbol: "xor",
    blurb: "Y = A ⊕ B",
    doc: "Exclusive OR. Output is 1 when the inputs differ. Any X or Z produces X.",
    pins: gatePins(["A", "B"]),
  }),
  define({
    type: "xnor2",
    label: "XNOR",
    category: "Gates",
    symbol: "xnor",
    blurb: "Y = ¬(A ⊕ B)",
    doc: "Exclusive NOR. Output is 1 when the inputs match.",
    pins: gatePins(["A", "B"]),
  }),
  define({
    type: "buf",
    label: "BUF",
    category: "Gates",
    symbol: "buf",
    blurb: "Y = A",
    doc: "Buffer. Restores a logic level. A floating (Z) input becomes X, not Z.",
    pins: gatePins(["A"]),
  }),
  define({
    type: "toggle",
    label: "Switch",
    category: "Input / Output",
    symbol: "switch",
    blurb: "Latched 0 or 1",
    doc: "Toggle switch. Click it on the canvas to flip the driven level. The level is saved with the project.",
    pins: [pin("Y", "Y", OUT, "right")],
    comb: "none",
    defaultParams: { on: false },
    minW: 72,
    minH: 44,
  }),
  define({
    type: "button",
    label: "Button",
    category: "Input / Output",
    symbol: "btn",
    blurb: "Momentary 1",
    doc: "Push button. Output is 1 only while it is held down.",
    pins: [pin("Y", "Y", OUT, "right")],
    comb: "none",
    defaultParams: { down: false },
    minW: 72,
    minH: 44,
  }),
  define({
    type: "vcc",
    label: "HIGH",
    category: "Input / Output",
    symbol: "const",
    blurb: "Constant 1",
    doc: "Tied high. Always drives a strong 1.",
    pins: [pin("Y", "Y", OUT, "right")],
    comb: "none",
    minW: 56,
    minH: 36,
  }),
  define({
    type: "gnd",
    label: "LOW",
    category: "Input / Output",
    symbol: "const",
    blurb: "Constant 0",
    doc: "Tied low. Always drives a strong 0.",
    pins: [pin("Y", "Y", OUT, "right")],
    comb: "none",
    minW: 56,
    minH: 36,
  }),
  define({
    type: "clock",
    label: "Clock",
    category: "Input / Output",
    symbol: "clock",
    blurb: "Square wave",
    doc: "Clock generator. Toggles every `half` simulator ticks while the simulation is running or you step. A rising edge is the 0→1 transition.",
    pins: [pin("CLK", "CLK", OUT, "right")],
    sequential: true,
    comb: "none",
    defaultParams: { half: 2 },
    minW: 72,
    minH: 44,
  }),
  define({
    type: "led",
    label: "LED",
    category: "Input / Output",
    symbol: "led",
    blurb: "Lights on 1",
    doc: "Indicator. Green when the input is 1, blue when 0, amber when X, dim when Z.",
    pins: [pin("A", "A", IN, "left")],
    comb: "none",
    minW: 64,
    minH: 40,
  }),
  define({
    type: "probe",
    label: "Probe",
    category: "Input / Output",
    symbol: "probe",
    blurb: "1-bit tap",
    doc: "Digital probe. Does not drive the net. Truth tables treat each probe as an output column.",
    pins: [pin("A", "A", IN, "left")],
    comb: "none",
    minW: 64,
    minH: 36,
  }),
  define({
    type: "probe8",
    label: "Probe 8",
    category: "Input / Output",
    symbol: "probe",
    blurb: "8-bit tap",
    doc: "Bus probe. Shows the hex value of an 8-bit net without loading it.",
    pins: [pin("A", "D", IN, "left", 8)],
    comb: "none",
    minW: 84,
    minH: 40,
  }),
  define({
    type: "seg7",
    label: "7-segment",
    category: "Input / Output",
    symbol: "seg",
    blurb: "Hex digit",
    doc: "Seven-segment decoder display. A is the least significant input bit. Digits 0–F use the standard segment map. Any X or Z blanks the digit.",
    pins: [pin("A", "A", IN, "left"), pin("B", "B", IN, "left"), pin("C", "C", IN, "left"), pin("D", "D", IN, "left")],
    comb: "none",
    minW: 78,
    minH: 96,
  }),
  define({
    type: "hex4",
    label: "Hex",
    category: "Input / Output",
    symbol: "hex",
    blurb: "4-bit numeric",
    doc: "Four-bit numeric display. D[0] is the LSB. Shows hexadecimal 0–F.",
    pins: [pin("D", "D", IN, "left", 4)],
    comb: "none",
    minW: 72,
    minH: 48,
  }),
  define({
    type: "num8",
    label: "Numeric",
    category: "Input / Output",
    symbol: "num",
    blurb: "8-bit numeric",
    doc: "Eight-bit numeric display. Shows unsigned decimal and hex. D[0] is the LSB.",
    pins: [pin("D", "D", IN, "left", 8)],
    comb: "none",
    minW: 96,
    minH: 52,
  }),
  define({
    type: "label",
    label: "Note",
    category: "Input / Output",
    symbol: "label",
    blurb: "Annotation",
    doc: "Text annotation. It is not part of the circuit and is ignored by the simulator.",
    pins: [],
    comb: "none",
    defaultParams: { text: "Note" },
    minW: 120,
    minH: 32,
  }),
  define({
    type: "hadd",
    label: "Half adder",
    category: "Combinational",
    symbol: "box",
    blurb: "Sum, carry",
    doc: "Half adder. SUM = A ⊕ B. COUT = A · B. There is no carry-in.",
    pins: [pin("A", "A", IN, "left"), pin("B", "B", IN, "left"), pin("SUM", "SUM", OUT, "right"), pin("COUT", "COUT", OUT, "right")],
    minW: 120,
  }),
  define({
    type: "fadd",
    label: "Full adder",
    category: "Combinational",
    symbol: "box",
    blurb: "Sum, carry in/out",
    doc: "Full adder. SUM = A ⊕ B ⊕ CIN. COUT = (A · B) + (CIN · (A ⊕ B)). The carry chain is evaluated bit by bit, so an X input only forces X where it can actually change the result (a 0 AND X is still 0).",
    pins: [
      pin("A", "A", IN, "left"),
      pin("B", "B", IN, "left"),
      pin("CIN", "CIN", IN, "left"),
      pin("SUM", "SUM", OUT, "right"),
      pin("COUT", "COUT", OUT, "right"),
    ],
    minW: 128,
  }),
  define({
    type: "hsub",
    label: "Half subtractor",
    category: "Combinational",
    symbol: "box",
    blurb: "Diff, borrow",
    doc: "Half subtractor. DIFF = A ⊕ B. BOUT = ¬A · B.",
    pins: [pin("A", "A", IN, "left"), pin("B", "B", IN, "left"), pin("DIFF", "D", OUT, "right"), pin("BOUT", "BOUT", OUT, "right")],
    minW: 128,
  }),
  define({
    type: "fsub",
    label: "Full subtractor",
    category: "Combinational",
    symbol: "box",
    blurb: "Diff, borrow in/out",
    doc: "Full subtractor. DIFF = A ⊕ B ⊕ BIN. BOUT = (¬A · B) + (¬(A ⊕ B) · BIN).",
    pins: [
      pin("A", "A", IN, "left"),
      pin("B", "B", IN, "left"),
      pin("BIN", "BIN", IN, "left"),
      pin("DIFF", "D", OUT, "right"),
      pin("BOUT", "BOUT", OUT, "right"),
    ],
    minW: 136,
  }),
  define({
    type: "mux2",
    label: "MUX 2:1",
    category: "Combinational",
    symbol: "box",
    blurb: "Selects D0 or D1",
    doc: "2-to-1 multiplexer. S = 0 selects D0, S = 1 selects D1. If S is X and both data inputs match, that value is passed; otherwise Y is X.",
    pins: [pin("S", "S", IN, "left"), pin("D0", "D0", IN, "left"), pin("D1", "D1", IN, "left"), pin("Y", "Y", OUT, "right")],
    minW: 112,
  }),
  define({
    type: "mux4",
    label: "MUX 4:1",
    category: "Combinational",
    symbol: "box",
    blurb: "S1 S0 select",
    doc: "4-to-1 multiplexer. {S1,S0} selects D0..D3. S0 is the low select bit.",
    pins: [
      pin("S1", "S1", IN, "left"),
      pin("S0", "S0", IN, "left"),
      pin("D0", "D0", IN, "left"),
      pin("D1", "D1", IN, "left"),
      pin("D2", "D2", IN, "left"),
      pin("D3", "D3", IN, "left"),
      pin("Y", "Y", OUT, "right"),
    ],
    minW: 112,
  }),
  define({
    type: "dmux4",
    label: "DEMUX 1:4",
    category: "Combinational",
    symbol: "box",
    blurb: "Routes D to one Y",
    doc: "1-to-4 demultiplexer. The selected output follows D. The other outputs are 0. An unknown select makes every output X.",
    pins: [
      pin("S1", "S1", IN, "left"),
      pin("S0", "S0", IN, "left"),
      pin("D", "D", IN, "left"),
      pin("Y0", "Y0", OUT, "right"),
      pin("Y1", "Y1", OUT, "right"),
      pin("Y2", "Y2", OUT, "right"),
      pin("Y3", "Y3", OUT, "right"),
    ],
    minW: 120,
  }),
  define({
    type: "dec2",
    label: "Decoder 2:4",
    category: "Combinational",
    symbol: "box",
    blurb: "One-hot outputs",
    doc: "2-to-4 decoder, active high. A is the low address bit, B is the high bit. Y0 is selected by 00.",
    pins: [
      pin("A", "A", IN, "left"),
      pin("B", "B", IN, "left"),
      pin("Y0", "Y0", OUT, "right"),
      pin("Y1", "Y1", OUT, "right"),
      pin("Y2", "Y2", OUT, "right"),
      pin("Y3", "Y3", OUT, "right"),
    ],
    minW: 124,
  }),
  define({
    type: "enc4",
    label: "Encoder 4:2",
    category: "Combinational",
    symbol: "box",
    blurb: "One-hot to binary",
    doc: "4-to-2 encoder. Exactly one of I0–I3 must be high. I0 is the lowest input. V is 1 when the input is a legal one-hot code. Multiple highs produce X.",
    pins: [
      pin("I0", "I0", IN, "left"),
      pin("I1", "I1", IN, "left"),
      pin("I2", "I2", IN, "left"),
      pin("I3", "I3", IN, "left"),
      pin("Y0", "Y0", OUT, "right"),
      pin("Y1", "Y1", OUT, "right"),
      pin("V", "V", OUT, "right"),
    ],
    minW: 124,
  }),
  define({
    type: "pri4",
    label: "Priority enc.",
    category: "Combinational",
    symbol: "box",
    blurb: "I3 has priority",
    doc: "4-input priority encoder. I3 has the highest priority, then I2, I1, I0. V is 0 when every input is 0. Y is the binary index of the winning input.",
    pins: [
      pin("I0", "I0", IN, "left"),
      pin("I1", "I1", IN, "left"),
      pin("I2", "I2", IN, "left"),
      pin("I3", "I3", IN, "left"),
      pin("Y0", "Y0", OUT, "right"),
      pin("Y1", "Y1", OUT, "right"),
      pin("V", "V", OUT, "right"),
    ],
    minW: 130,
  }),
  define({
    type: "cmp1",
    label: "Compare 1",
    category: "Combinational",
    symbol: "box",
    blurb: "A ? B",
    doc: "1-bit magnitude comparator. GT = A · ¬B, EQ = ¬(A ⊕ B), LT = ¬A · B.",
    pins: [
      pin("A", "A", IN, "left"),
      pin("B", "B", IN, "left"),
      pin("GT", "GT", OUT, "right"),
      pin("EQ", "EQ", OUT, "right"),
      pin("LT", "LT", OUT, "right"),
    ],
    minW: 112,
  }),
  define({
    type: "cmp4",
    label: "Compare 4",
    category: "Combinational",
    symbol: "box",
    blurb: "Unsigned 4-bit",
    doc: "Unsigned 4-bit magnitude comparator. Any X or Z on a data bus makes GT, EQ, and LT all X.",
    pins: [pin("A", "A", IN, "left", 4), pin("B", "B", IN, "left", 4), pin("GT", "GT", OUT, "right"), pin("EQ", "EQ", OUT, "right"), pin("LT", "LT", OUT, "right")],
    minW: 124,
  }),
  define({
    type: "srlatch",
    label: "SR latch",
    category: "Sequential",
    symbol: "box",
    blurb: "Level NOR latch",
    doc: "Level-sensitive NOR SR latch. S = 1 sets Q, R = 1 resets Q, S = R = 0 holds. S = R = 1 is invalid: both Q and QN are driven 0, matching a real cross-coupled NOR pair, and the debugger flags it. This is one component so the feedback is stable instead of a zero-delay gate race. You can also build the race yourself with two NOR gates.",
    pins: [pin("S", "S", IN, "left"), pin("R", "R", IN, "left"), pin("Q", "Q", OUT, "right"), pin("QN", "QN", OUT, "right")],
    sequential: true,
    comb: "all",
    minW: 112,
  }),
  define({
    type: "dff",
    label: "D flip-flop",
    category: "Sequential",
    symbol: "box",
    blurb: "Rising-edge D",
    doc: "Rising-edge D flip-flop. Q captures D on CLK 0→1. CLR is asynchronous and active high; while CLR is 1, Q is held at 0. Q does not follow D between edges.",
    pins: [pin("D", "D", IN, "left"), pin("CLK", "CLK", IN, "left", 1, X), pin("CLR", "CLR", IN, "left", 1, LOW), pin("Q", "Q", OUT, "right"), pin("QN", "QN", OUT, "right")],
    sequential: true,
    comb: ["CLR"],
    clk: "CLK",
    minW: 120,
  }),
  define({
    type: "jkff",
    label: "JK flip-flop",
    category: "Sequential",
    symbol: "box",
    blurb: "Rising-edge JK",
    doc: "Rising-edge JK flip-flop. J=1 K=0 sets, J=0 K=1 resets, J=K=1 toggles, J=K=0 holds. CLR is asynchronous active high.",
    pins: [
      pin("J", "J", IN, "left"),
      pin("K", "K", IN, "left"),
      pin("CLK", "CLK", IN, "left", 1, X),
      pin("CLR", "CLR", IN, "left", 1, LOW),
      pin("Q", "Q", OUT, "right"),
      pin("QN", "QN", OUT, "right"),
    ],
    sequential: true,
    comb: ["CLR"],
    clk: "CLK",
    minW: 120,
  }),
  define({
    type: "tff",
    label: "T flip-flop",
    category: "Sequential",
    symbol: "box",
    blurb: "Toggles when T=1",
    doc: "Rising-edge T flip-flop. On each rising clock, Q toggles if T is 1 and holds if T is 0. CLR is asynchronous active high.",
    pins: [pin("T", "T", IN, "left"), pin("CLK", "CLK", IN, "left", 1, X), pin("CLR", "CLR", IN, "left", 1, LOW), pin("Q", "Q", OUT, "right"), pin("QN", "QN", OUT, "right")],
    sequential: true,
    comb: ["CLR"],
    clk: "CLK",
    minW: 120,
  }),
  define({
    type: "reg4",
    label: "Register 4",
    category: "Sequential",
    symbol: "box",
    blurb: "4-bit, load enable",
    doc: "4-bit parallel register. On a rising clock, if EN is 1, Q captures D. An unwired EN defaults to 1. CLR is asynchronous active high. D[0] is the LSB.",
    pins: [
      pin("D", "D", IN, "left", 4),
      pin("CLK", "CLK", IN, "left", 1, X),
      pin("EN", "EN", IN, "left", 1, HIGH),
      pin("CLR", "CLR", IN, "left", 1, LOW),
      pin("Q", "Q", OUT, "right", 4),
    ],
    sequential: true,
    comb: ["CLR"],
    clk: "CLK",
    minW: 130,
  }),
  define({
    type: "reg8",
    label: "Register 8",
    category: "Sequential",
    symbol: "box",
    blurb: "8-bit, load enable",
    doc: "8-bit parallel register. Same rules as the 4-bit register. D[0] is the LSB.",
    pins: [
      pin("D", "D", IN, "left", 8),
      pin("CLK", "CLK", IN, "left", 1, X),
      pin("EN", "EN", IN, "left", 1, HIGH),
      pin("CLR", "CLR", IN, "left", 1, LOW),
      pin("Q", "Q", OUT, "right", 8),
    ],
    sequential: true,
    comb: ["CLR"],
    clk: "CLK",
    minW: 130,
  }),
  define({
    type: "shift8",
    label: "Shift reg 8",
    category: "Sequential",
    symbol: "box",
    blurb: "SIN enters bit 0",
    doc: "8-bit shift register. On a rising clock with EN = 1, bits move toward the MSB and SIN is written into bit 0. An unwired EN defaults to 1.",
    pins: [pin("SIN", "SIN", IN, "left"), pin("CLK", "CLK", IN, "left", 1, X), pin("EN", "EN", IN, "left", 1, HIGH), pin("Q", "Q", OUT, "right", 8)],
    sequential: true,
    comb: "none",
    clk: "CLK",
    minW: 136,
  }),
  define({
    type: "cnt4",
    label: "Counter 4",
    category: "Sequential",
    symbol: "box",
    blurb: "Binary up",
    doc: "4-bit binary up counter. Increments on each rising clock while EN = 1. CLR is asynchronous active high. Wraps from F to 0.",
    pins: [pin("CLK", "CLK", IN, "left", 1, X), pin("EN", "EN", IN, "left", 1, HIGH), pin("CLR", "CLR", IN, "left", 1, LOW), pin("Q", "Q", OUT, "right", 4)],
    sequential: true,
    comb: ["CLR"],
    clk: "CLK",
    minW: 124,
  }),
  define({
    type: "cnt8",
    label: "Counter 8",
    category: "Sequential",
    symbol: "box",
    blurb: "Binary up",
    doc: "8-bit binary up counter. Same control rules as the 4-bit counter. Wraps from FF to 00.",
    pins: [pin("CLK", "CLK", IN, "left", 1, X), pin("EN", "EN", IN, "left", 1, HIGH), pin("CLR", "CLR", IN, "left", 1, LOW), pin("Q", "Q", OUT, "right", 8)],
    sequential: true,
    comb: ["CLR"],
    clk: "CLK",
    minW: 124,
  }),
  define({
    type: "updown4",
    label: "Up/down 4",
    category: "Sequential",
    symbol: "box",
    blurb: "UP selects direction",
    doc: "4-bit up/down counter. UP = 1 counts up, UP = 0 counts down, on the rising clock while EN = 1. CLR is asynchronous active high.",
    pins: [
      pin("CLK", "CLK", IN, "left", 1, X),
      pin("EN", "EN", IN, "left", 1, HIGH),
      pin("UP", "UP", IN, "left", 1, HIGH),
      pin("CLR", "CLR", IN, "left", 1, LOW),
      pin("Q", "Q", OUT, "right", 4),
    ],
    sequential: true,
    comb: ["CLR"],
    clk: "CLK",
    minW: 128,
  }),
  define({
    type: "ram16",
    label: "RAM 16×8",
    category: "Memory",
    symbol: "box",
    blurb: "Async read, sync write",
    doc: "16×8 RAM. DOUT is the byte at ADDR while CE = 1, otherwise high-Z. A rising clock with WE = 1 writes DIN into that address. CE defaults low so an unwired chip does not fight a bus. Edit the image in the properties panel; Reset restores it.",
    pins: [
      pin("ADDR", "ADDR", IN, "left", 4),
      pin("DIN", "DIN", IN, "left", 8),
      pin("CLK", "CLK", IN, "left", 1, X),
      pin("CE", "CE", IN, "left", 1, LOW),
      pin("WE", "WE", IN, "left", 1, LOW),
      pin("DOUT", "DOUT", OUT, "right", 8),
    ],
    sequential: true,
    comb: ["CE", "ADDR"],
    clk: "CLK",
    defaultParams: { words: new Array(16).fill(0) },
    minW: 140,
    minH: 148,
  }),
  define({
    type: "rom16",
    label: "ROM 16×8",
    category: "Memory",
    symbol: "box",
    blurb: "Combinational read",
    doc: "16×8 ROM. DOUT follows ADDR while OE = 1. There is no write port. OE defaults high. The image is a project parameter.",
    pins: [pin("ADDR", "ADDR", IN, "left", 4), pin("OE", "OE", IN, "left", 1, HIGH), pin("DOUT", "DOUT", OUT, "right", 8)],
    comb: ["OE", "ADDR"],
    defaultParams: { words: new Array(16).fill(0) },
    minW: 130,
    minH: 96,
  }),
  define({
    type: "regfile",
    label: "Register file",
    category: "Memory",
    symbol: "box",
    blurb: "4 × 8-bit",
    doc: "4-deep 8-bit register file. DOUT is the selected register (asynchronous read). A rising clock with WE = 1 writes DIN into ADDR. ADDR is 2 bits.",
    pins: [
      pin("ADDR", "ADDR", IN, "left", 2),
      pin("DIN", "DIN", IN, "left", 8),
      pin("CLK", "CLK", IN, "left", 1, X),
      pin("WE", "WE", IN, "left", 1, LOW),
      pin("DOUT", "DOUT", OUT, "right", 8),
    ],
    sequential: true,
    comb: ["ADDR"],
    clk: "CLK",
    minW: 140,
    minH: 120,
  }),
  define({
    type: "alu8",
    label: "ALU 8",
    category: "Advanced",
    symbol: "box",
    blurb: "Arithmetic and logic",
    doc: "8-bit ALU. OP: 000 ADD, 001 SUB, 010 AND, 011 OR, 100 XOR, 101 NOT A, 110 INC A, 111 PASS B. C is the carry/borrow out of add, sub, and inc. Z is 1 when Y is zero. An X on an operand that the operation actually uses makes Y, C, and Z all X.",
    pins: [
      pin("A", "A", IN, "left", 8),
      pin("B", "B", IN, "left", 8),
      pin("OP", "OP", IN, "left", 3),
      pin("Y", "Y", OUT, "right", 8),
      pin("C", "C", OUT, "right"),
      pin("Z", "Z", OUT, "right"),
    ],
    minW: 120,
    minH: 150,
  }),
  define({
    type: "tri1",
    label: "Tri-state",
    category: "Advanced",
    symbol: "buf",
    blurb: "EN releases the wire",
    doc: "1-bit tri-state buffer. EN = 1 drives D onto Y. EN = 0 drives Z so another driver may own the net. EN = X drives X.",
    pins: [pin("D", "D", IN, "left"), pin("EN", "EN", IN, "left", 1, LOW), pin("Y", "Y", OUT, "right")],
    minW: 96,
  }),
  define({
    type: "tri8",
    label: "Tri-state 8",
    category: "Advanced",
    symbol: "box",
    blurb: "8-bit bus driver",
    doc: "8-bit tri-state buffer. EN = 0 releases the bus (Z). Use it between an always-driven ALU output and a shared bus.",
    pins: [pin("D", "D", IN, "left", 8), pin("EN", "EN", IN, "left", 1, LOW), pin("Y", "Y", OUT, "right", 8)],
    minW: 124,
  }),
  define({
    type: "split8",
    label: "Split 8",
    category: "Advanced",
    symbol: "box",
    blurb: "Bus to bits",
    doc: "Splits an 8-bit bus into bit pins B0 (LSB) through B7.",
    pins: [
      pin("D", "D", IN, "left", 8),
      ...Array.from({ length: 8 }, (_, i) => pin("B" + i, "B" + i, OUT, "right")),
    ],
    minW: 110,
    minH: 180,
  }),
  define({
    type: "merge8",
    label: "Merge 8",
    category: "Advanced",
    symbol: "box",
    blurb: "Bits to bus",
    doc: "Merges bit pins B0 (LSB) through B7 into one 8-bit bus.",
    pins: [
      ...Array.from({ length: 8 }, (_, i) => pin("B" + i, "B" + i, IN, "left")),
      pin("Y", "Y", OUT, "right", 8),
    ],
    minW: 110,
    minH: 180,
  }),
  define({
    type: "bus",
    label: "Bus",
    category: "Advanced",
    symbol: "bus",
    blurb: "12 shorted taps",
    doc: "Passive 8-bit bus. All twelve taps are the same electrical net. Connect device bus pins to any taps. The bar does not drive; tri-state outputs on the net decide the value. More than one non-Z driver is a conflict.",
    pins: Array.from({ length: 12 }, (_, i) => pin("T" + i, "T" + i, IN, "top", 8)),
    shorts: [Array.from({ length: 12 }, (_, i) => "T" + i)],
    comb: "none",
    minW: 640,
    minH: 28,
  }),
  define({
    type: "idec",
    label: "Instr. decoder",
    category: "Advanced",
    symbol: "box",
    blurb: "4-bit to one-hot",
    doc: "4-to-16 instruction decoder. Exactly one of Y0–Y15 is high for a known opcode. This is a pure decoder, not the CPU control unit — it does not generate timed control signals.",
    pins: [pin("OP", "OP", IN, "left", 4), ...Array.from({ length: 16 }, (_, i) => pin("Y" + i, "Y" + i, OUT, "right"))],
    minW: 140,
    minH: 320,
  }),
  define({
    type: "expr",
    label: "Expression",
    category: "Advanced",
    symbol: "box",
    blurb: "Formula on A–D",
    doc: "Custom combinational block. The formula may use a, b, c, d, parentheses, constants 0 and 1, and the operators & (AND), | (OR), ^ (XOR), ~ (NOT). Four-state rules match the built-in gates. This is a sandboxed formula, not a general scripting language.",
    pins: [pin("A", "A", IN, "left"), pin("B", "B", IN, "left"), pin("C", "C", IN, "left"), pin("D", "D", IN, "left"), pin("Y", "Y", OUT, "right")],
    defaultParams: { formula: "(a & b) | ~c" },
    minW: 140,
  }),
  define({
    type: "pc",
    label: "PC",
    category: "CPU",
    symbol: "box",
    blurb: "4-bit program counter",
    doc: "Program counter for the CPU lab. Stored value is 4 bits, zero-extended onto the 8-bit bus. On a rising clock, LP loads the low nibble of BIN (load wins over count). Otherwise CP increments it. EP drives BOUT; when EP is 0 the pin is high-Z.",
    pins: [
      pin("CLK", "CLK", IN, "left", 1, X),
      pin("CP", "CP", IN, "left", 1, LOW),
      pin("EP", "EP", IN, "left", 1, LOW),
      pin("LP", "LP", IN, "left", 1, LOW),
      pin("BIN", "BIN", IN, "bottom", 8),
      pin("BOUT", "BOUT", OUT, "bottom", 8),
    ],
    sequential: true,
    comb: ["EP"],
    clk: "CLK",
    minW: 120,
    minH: 120,
  }),
  define({
    type: "mar",
    label: "MAR",
    category: "CPU",
    symbol: "box",
    blurb: "Memory address",
    doc: "4-bit memory address register. On a rising clock with LM = 1, ADDR captures the low nibble of the bus.",
    pins: [pin("CLK", "CLK", IN, "left", 1, X), pin("LM", "LM", IN, "left", 1, LOW), pin("BIN", "BIN", IN, "bottom", 8), pin("ADDR", "ADDR", OUT, "right", 4)],
    sequential: true,
    comb: "none",
    clk: "CLK",
    minW: 112,
    minH: 100,
  }),
  define({
    type: "iram",
    label: "CPU RAM",
    category: "CPU",
    symbol: "box",
    blurb: "16×8 program memory",
    doc: "CPU memory. CE places mem[ADDR] on BOUT; otherwise BOUT is Z. WE writes the bus on the rising clock. The program image lives in the component parameters and is restored by Reset.",
    pins: [
      pin("CLK", "CLK", IN, "left", 1, X),
      pin("CE", "CE", IN, "left", 1, LOW),
      pin("WE", "WE", IN, "left", 1, LOW),
      pin("ADDR", "ADDR", IN, "left", 4),
      pin("BIN", "BIN", IN, "bottom", 8),
      pin("BOUT", "BOUT", OUT, "bottom", 8),
    ],
    sequential: true,
    comb: ["CE", "ADDR"],
    clk: "CLK",
    defaultParams: { words: new Array(16).fill(0) },
    minW: 130,
    minH: 140,
  }),
  define({
    type: "ir",
    label: "IR",
    category: "CPU",
    symbol: "box",
    blurb: "Instruction register",
    doc: "Instruction register. LI loads the bus on the rising clock. OP is the high nibble (opcode), always driven from the stored word. EI places the low nibble, zero-extended, on BOUT.",
    pins: [
      pin("CLK", "CLK", IN, "left", 1, X),
      pin("LI", "LI", IN, "left", 1, LOW),
      pin("EI", "EI", IN, "left", 1, LOW),
      pin("BIN", "BIN", IN, "bottom", 8),
      pin("OP", "OP", OUT, "right", 4),
      pin("BOUT", "BOUT", OUT, "bottom", 8),
    ],
    sequential: true,
    comb: "none",
    clk: "CLK",
    minW: 112,
    minH: 140,
  }),
  define({
    type: "acc",
    label: "ACC",
    category: "CPU",
    symbol: "box",
    blurb: "Accumulator",
    doc: "8-bit accumulator. LA loads the bus on the rising clock. A is always driven for the ALU. Z is 1 when every bit is 0. EA drives the stored value onto BOUT.",
    pins: [
      pin("CLK", "CLK", IN, "left", 1, X),
      pin("LA", "LA", IN, "left", 1, LOW),
      pin("EA", "EA", IN, "left", 1, LOW),
      pin("BIN", "BIN", IN, "bottom", 8),
      pin("A", "A", OUT, "right", 8),
      pin("Z", "Z", OUT, "top"),
      pin("BOUT", "BOUT", OUT, "bottom", 8),
    ],
    sequential: true,
    comb: "none",
    clk: "CLK",
    minW: 112,
    minH: 160,
  }),
  define({
    type: "breg",
    label: "B",
    category: "CPU",
    symbol: "box",
    blurb: "ALU operand",
    doc: "B register. LB loads the bus on the rising clock. B is a dedicated output to the ALU and does not drive the system bus.",
    pins: [pin("CLK", "CLK", IN, "left", 1, X), pin("LB", "LB", IN, "left", 1, LOW), pin("BIN", "BIN", IN, "bottom", 8), pin("B", "B", OUT, "right", 8)],
    sequential: true,
    comb: "none",
    clk: "CLK",
    minW: 100,
    minH: 110,
  }),
  define({
    type: "alusap",
    label: "ALU",
    category: "CPU",
    symbol: "box",
    blurb: "Add or subtract",
    doc: "CPU ALU. Combinational: SU = 0 adds A+B, SU = 1 computes A−B as A + ¬B + 1, 8-bit wrap. EU drives the result onto BOUT; otherwise BOUT is Z. A and B come from the accumulator and B register, not from the bus, so the addend is stable while the result is written back.",
    pins: [
      pin("A", "A", IN, "left", 8),
      pin("B", "B", IN, "left", 8),
      pin("SU", "SU", IN, "left", 1, LOW),
      pin("EU", "EU", IN, "left", 1, LOW),
      pin("BOUT", "BOUT", OUT, "bottom", 8),
    ],
    minW: 112,
    minH: 130,
  }),
  define({
    type: "outreg",
    label: "OUT",
    category: "CPU",
    symbol: "box",
    blurb: "Output register",
    doc: "Output register. LO loads the bus on the rising clock. OUT is always driven so a display can watch it without joining the system bus.",
    pins: [pin("CLK", "CLK", IN, "left", 1, X), pin("LO", "LO", IN, "left", 1, LOW), pin("BIN", "BIN", IN, "bottom", 8), pin("OUT", "OUT", OUT, "right", 8)],
    sequential: true,
    comb: "none",
    clk: "CLK",
    minW: 110,
    minH: 110,
  }),
  define({
    type: "cu",
    label: "Control",
    category: "CPU",
    symbol: "box",
    blurb: "6-state microcode",
    doc: "Microcoded control unit for the 8-bit teaching CPU. T advances on each rising clock, after the transfers for the current T-state have been sampled by the other registers. T0–T2 are the fetch. T3–T5 depend on the opcode and, for JZ, the accumulator zero flag. HLT freezes T and forces every other control line low. Open the CPU lab to see the active microinstruction next to the real pin values.",
    pins: [
      pin("CLK", "CLK", IN, "left", 1, X),
      pin("Z", "Z", IN, "left", 1, LOW),
      pin("OP", "OP", IN, "bottom", 4),
      ...CTRL.map((name) => pin(name, name, OUT, "right")),
      pin("T", "T", OUT, "top", 3),
    ],
    sequential: true,
    comb: ["OP", "Z"],
    clk: "CLK",
    minW: 150,
    minH: 360,
  }),
];

const byType = new Map<string, CompDef>(DEFS.map((d) => [d.type, d]));

export function library(): CompDef[] {
  return DEFS;
}

export function getDef(type: string): CompDef {
  const d = byType.get(type);
  if (!d) throw new Error("Unknown component type: " + type);
  return d;
}

export function getBehavior(type: string): Behavior {
  const b = behaviors[type];
  if (!b) throw new Error("No behavior for: " + type);
  return b;
}

export function createComponent(type: string, x: number, y: number, seq: number, id?: string): CompInst {
  const def = getDef(type);
  return {
    id: id ?? "U" + seq,
    type,
    x,
    y,
    rot: 0,
    flip: false,
    label: def.label,
    params: structuredClone(def.defaultParams),
  };
}

export interface FormulaResult {
  value: Sig;
  error?: string;
}

/** Recursive-descent evaluator for the expression component. */
export function evalFormula(formula: string, env: Record<string, Sig>): FormulaResult {
  const src = formula.trim();
  if (!src) return { value: X, error: "Empty formula." };
  let i = 0;
  const skip = () => {
    while (src[i] === " " || src[i] === "\t") i++;
  };
  const parseOr = (): Sig => {
    let v = parseXor();
    skip();
    while (src[i] === "|") {
      i++;
      v = or(v, parseXor());
      skip();
    }
    return v;
  };
  const parseXor = (): Sig => {
    let v = parseAnd();
    skip();
    while (src[i] === "^") {
      i++;
      v = xor(v, parseAnd());
      skip();
    }
    return v;
  };
  const parseAnd = (): Sig => {
    let v = parseUnary();
    skip();
    while (src[i] === "&") {
      i++;
      v = and(v, parseUnary());
      skip();
    }
    return v;
  };
  const parseUnary = (): Sig => {
    skip();
    if (src[i] === "~" || src[i] === "!") {
      i++;
      return not(parseUnary());
    }
    return parsePrimary();
  };
  const parsePrimary = (): Sig => {
    skip();
    if (src[i] === "(") {
      i++;
      const v = parseOr();
      skip();
      if (src[i] !== ")") throw new Error("Missing ).");
      i++;
      return v;
    }
    if (src[i] === "0") {
      i++;
      return LOW;
    }
    if (src[i] === "1") {
      i++;
      return HIGH;
    }
    const m = /^[A-Za-z]+/.exec(src.slice(i));
    if (!m) throw new Error("Unexpected “" + (src[i] ?? "end") + "”.");
    const name = m[0].toLowerCase();
    i += m[0].length;
    if (!(name in env)) throw new Error("Unknown name “" + name + "”.");
    return env[name] ?? X;
  };
  try {
    const value = parseOr();
    skip();
    if (i !== src.length) return { value: X, error: "Trailing “" + src.slice(i) + "”." };
    return { value };
  } catch (err) {
    return { value: X, error: err instanceof Error ? err.message : "Bad formula." };
  }
}

export function formulaError(formula: string): string | undefined {
  return evalFormula(formula, { a: LOW, b: LOW, c: LOW, d: LOW }).error;
}

const SEG_MAP = [
  0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c, 0x39, 0x5e, 0x79, 0x71,
];

/** Bit mask ABCDEFG (bit0 = A) for a nibble, or null if unknown. */
export function segmentMask(nibble: number | null): number | null {
  if (nibble === null || nibble < 0 || nibble > 15) return null;
  return SEG_MAP[nibble] ?? null;
}

export function aluOpName(op: number): string {
  return ["ADD", "SUB", "AND", "OR", "XOR", "NOT A", "INC A", "PASS B"][op] ?? "OP";
}
