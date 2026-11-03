/** Four-state logic used everywhere in the simulator. Index 0 of a bus is the LSB. */

export const LOW = 0;
export const HIGH = 1;
export const X = 2;
export const Z = 3;

export type Sig = typeof LOW | typeof HIGH | typeof X | typeof Z;
export type Bits = Sig[];

export function sigChar(s: Sig): "0" | "1" | "X" | "Z" {
  return s === LOW ? "0" : s === HIGH ? "1" : s === X ? "X" : "Z";
}

export function not(s: Sig): Sig {
  if (s === LOW) return HIGH;
  if (s === HIGH) return LOW;
  return X;
}

/** AND: a 0 forces 0 even if the other input is X or Z. */
export function and(a: Sig, b: Sig): Sig {
  if (a === LOW || b === LOW) return LOW;
  if (a === HIGH && b === HIGH) return HIGH;
  return X;
}

/** OR: a 1 forces 1 even if the other input is X or Z. */
export function or(a: Sig, b: Sig): Sig {
  if (a === HIGH || b === HIGH) return HIGH;
  if (a === LOW && b === LOW) return LOW;
  return X;
}

export function xor(a: Sig, b: Sig): Sig {
  if (a !== LOW && a !== HIGH) return X;
  if (b !== LOW && b !== HIGH) return X;
  return a === b ? LOW : HIGH;
}

export function fill(s: Sig, w: number): Bits {
  const o: Bits = new Array(w);
  for (let i = 0; i < w; i++) o[i] = s;
  return o;
}

export function zeros(w: number): Bits {
  return fill(LOW, w);
}

export function ones(w: number): Bits {
  return fill(HIGH, w);
}

export function fit(bits: Bits | undefined, w: number, pad: Sig): Bits {
  const o = fill(pad, w);
  if (!bits) return o;
  for (let i = 0; i < w && i < bits.length; i++) o[i] = bits[i];
  return o;
}

export function bitsEq(a?: Bits, b?: Bits): boolean {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function bitsToNum(bits: Bits | undefined): number | null {
  if (!bits || bits.length === 0) return null;
  let n = 0;
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] !== LOW && bits[i] !== HIGH) return null;
    if (bits[i] === HIGH) n |= 1 << i;
  }
  return n;
}

export function fromNum(n: number, w: number): Bits {
  const o: Bits = new Array(w);
  for (let i = 0; i < w; i++) o[i] = (n >>> i) & 1 ? HIGH : LOW;
  return o;
}

export function bitsToBin(bits: Bits): string {
  let s = "";
  for (let i = bits.length - 1; i >= 0; i--) s += sigChar(bits[i]);
  return s;
}

export function bitsToHex(bits: Bits): string | null {
  const n = bitsToNum(bits);
  if (n === null) return null;
  const digits = Math.ceil(bits.length / 4) || 1;
  return n.toString(16).toUpperCase().padStart(digits, "0");
}

export function invertBits(bits: Bits): Bits {
  return bits.map(not);
}

export function bit(bits: Bits | undefined, i = 0): Sig {
  if (!bits || i >= bits.length || i < 0) return X;
  return bits[i];
}

export function capture(bits: Bits | undefined, w: number): Bits {
  return fit(bits, w, X).map((s) => (s === Z ? X : s));
}

export function zeroFlag(bits: Bits): Sig {
  if (bits.some((s) => s === X || s === Z)) return X;
  return bits.every((s) => s === LOW) ? HIGH : LOW;
}

export function addBits(a: Bits, b: Bits, cin: Sig): { y: Bits; cout: Sig } {
  const w = Math.max(a.length, b.length);
  const aa = fit(a, w, LOW);
  const bb = fit(b, w, LOW);
  let c = cin;
  const y: Bits = new Array(w);
  for (let i = 0; i < w; i++) {
    const axb = xor(aa[i], bb[i]);
    y[i] = xor(axb, c);
    c = or(and(aa[i], bb[i]), and(c, axb));
  }
  return { y, cout: c };
}

export function fold(bits: Sig[], op: (a: Sig, b: Sig) => Sig, empty: Sig): Sig {
  if (bits.length === 0) return empty;
  return bits.reduce(op);
}
