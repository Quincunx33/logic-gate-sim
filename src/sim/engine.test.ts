import assert from "node:assert/strict";
import test from "node:test";
import { analyze, quineMcCluskey } from "./analysis.ts";
import { cpuCircuit } from "./cpu.ts";
import { Simulator } from "./engine.ts";
import { exampleById } from "./examples.ts";
import { assemble, disasm } from "./isa.ts";
import { createComponent, evalFormula, getBehavior } from "./library.ts";
import { HIGH, LOW, X, bitsToNum, fromNum } from "./signal.ts";
import type { Circuit, CompInst, Wire } from "./types.ts";

function make(
  parts: { type: string; id: string; params?: CompInst["params"] }[],
  links: [string, string, string, string][],
): Circuit {
  const components = parts.map((p, i) => {
    const c = createComponent(p.type, 0, i * 40, i + 1, p.id);
    if (p.params) c.params = { ...c.params, ...p.params };
    return c;
  });
  const wires: Wire[] = links.map(([c1, p1, c2, p2], i) => ({
    id: "W" + i,
    a: { c: c1, p: p1 },
    b: { c: c2, p: p2 },
  }));
  return { components, wires, seq: parts.length + 1 };
}

function level(sim: Simulator, id: string, pin: string): number {
  return sim.pinBits(id, pin)[0] ?? -1;
}

test("AND, OR, XOR, NOT including X", () => {
  const cases: [string, number, number, number][] = [
    ["and2", 0, 0, 0],
    ["and2", 0, 1, 0],
    ["and2", 1, 0, 0],
    ["and2", 1, 1, 1],
    ["or2", 0, 0, 0],
    ["or2", 0, 1, 1],
    ["or2", 1, 0, 1],
    ["or2", 1, 1, 1],
    ["xor2", 0, 0, 0],
    ["xor2", 0, 1, 1],
    ["xor2", 1, 0, 1],
    ["xor2", 1, 1, 0],
    ["nand2", 1, 1, 0],
    ["nand2", 0, 1, 1],
    ["nor2", 0, 0, 1],
    ["nor2", 1, 0, 0],
    ["xnor2", 1, 1, 1],
    ["xnor2", 1, 0, 0],
  ];
  for (const [type, a, b, y] of cases) {
    const sim = new Simulator(
      make(
        [
          { type: "toggle", id: "a", params: { on: a === 1 } },
          { type: "toggle", id: "b", params: { on: b === 1 } },
          { type, id: "g" },
        ],
        [
          ["a", "Y", "g", "A"],
          ["b", "Y", "g", "B"],
        ],
      ),
    );
    assert.equal(level(sim, "g", "Y"), y, `${type} ${a}${b}`);
  }
  const xand = new Simulator(
    make(
      [
        { type: "toggle", id: "a", params: { on: false } },
        { type: "and2", id: "g" },
      ],
      [["a", "Y", "g", "A"]],
    ),
  );
  assert.equal(level(xand, "g", "Y"), LOW, "AND 0 with floating input is 0");
  const xand1 = new Simulator(
    make(
      [
        { type: "toggle", id: "a", params: { on: true } },
        { type: "and2", id: "g" },
      ],
      [["a", "Y", "g", "A"]],
    ),
  );
  assert.equal(level(xand1, "g", "Y"), X, "AND 1 with floating input is X");
  const inv = new Simulator(
    make(
      [
        { type: "toggle", id: "a", params: { on: true } },
        { type: "not", id: "g" },
      ],
      [["a", "Y", "g", "A"]],
    ),
  );
  assert.equal(level(inv, "g", "Y"), LOW);
});

test("full adder matches the 8-row truth table", () => {
  const expect = [
    [0, 0, 0, 0, 0],
    [0, 0, 1, 1, 0],
    [0, 1, 0, 1, 0],
    [0, 1, 1, 0, 1],
    [1, 0, 0, 1, 0],
    [1, 0, 1, 0, 1],
    [1, 1, 0, 0, 1],
    [1, 1, 1, 1, 1],
  ];
  for (const [a, b, cin, sum, cout] of expect) {
    const sim = new Simulator(
      make(
        [
          { type: "toggle", id: "a", params: { on: !!a } },
          { type: "toggle", id: "b", params: { on: !!b } },
          { type: "toggle", id: "c", params: { on: !!cin } },
          { type: "fadd", id: "fa" },
        ],
        [
          ["a", "Y", "fa", "A"],
          ["b", "Y", "fa", "B"],
          ["c", "Y", "fa", "CIN"],
        ],
      ),
    );
    assert.equal(level(sim, "fa", "SUM"), sum, `sum ${a}${b}${cin}`);
    assert.equal(level(sim, "fa", "COUT"), cout, `cout ${a}${b}${cin}`);
  }
});

test("half adder, mux, decoder, priority encoder, comparator", () => {
  const hadd = new Simulator(
    make(
      [
        { type: "vcc", id: "a" },
        { type: "vcc", id: "b" },
        { type: "hadd", id: "h" },
      ],
      [
        ["a", "Y", "h", "A"],
        ["b", "Y", "h", "B"],
      ],
    ),
  );
  assert.equal(level(hadd, "h", "SUM"), LOW);
  assert.equal(level(hadd, "h", "COUT"), HIGH);

  const mux = new Simulator(
    make(
      [
        { type: "toggle", id: "s", params: { on: true } },
        { type: "gnd", id: "d0" },
        { type: "vcc", id: "d1" },
        { type: "mux2", id: "m" },
      ],
      [
        ["s", "Y", "m", "S"],
        ["d0", "Y", "m", "D0"],
        ["d1", "Y", "m", "D1"],
      ],
    ),
  );
  assert.equal(level(mux, "m", "Y"), HIGH);

  const dec = new Simulator(
    make(
      [
        { type: "vcc", id: "a" },
        { type: "gnd", id: "b" },
        { type: "dec2", id: "d" },
      ],
      [
        ["a", "Y", "d", "A"],
        ["b", "Y", "d", "B"],
      ],
    ),
  );
  assert.equal(level(dec, "d", "Y1"), HIGH);
  assert.equal(level(dec, "d", "Y0"), LOW);

  const pri = new Simulator(
    make(
      [
        { type: "vcc", id: "i0" },
        { type: "gnd", id: "i1" },
        { type: "vcc", id: "i2" },
        { type: "gnd", id: "i3" },
        { type: "pri4", id: "p" },
      ],
      [
        ["i0", "Y", "p", "I0"],
        ["i1", "Y", "p", "I1"],
        ["i2", "Y", "p", "I2"],
        ["i3", "Y", "p", "I3"],
      ],
    ),
  );
  assert.equal(level(pri, "p", "Y1"), HIGH);
  assert.equal(level(pri, "p", "Y0"), LOW);
  assert.equal(level(pri, "p", "V"), HIGH);

  const cmp = new Simulator(
    make(
      [
        { type: "vcc", id: "a" },
        { type: "gnd", id: "b" },
        { type: "cmp1", id: "c" },
      ],
      [
        ["a", "Y", "c", "A"],
        ["b", "Y", "c", "B"],
      ],
    ),
  );
  assert.equal(level(cmp, "c", "GT"), HIGH);
  assert.equal(level(cmp, "c", "EQ"), LOW);
});

test("D flip-flop samples only on the rising edge", () => {
  const sim = new Simulator(
    make(
      [
        { type: "toggle", id: "d", params: { on: true } },
        { type: "clock", id: "clk", params: { half: 1 } },
        { type: "dff", id: "ff" },
      ],
      [
        ["d", "Y", "ff", "D"],
        ["clk", "CLK", "ff", "CLK"],
      ],
    ),
  );
  assert.equal(level(sim, "ff", "Q"), LOW, "Q holds 0 before any edge");
  sim.tick();
  assert.equal(level(sim, "clk", "CLK"), HIGH);
  assert.equal(level(sim, "ff", "Q"), HIGH, "rising edge captures D=1");
  sim.setParam("d", "on", false);
  assert.equal(level(sim, "ff", "Q"), HIGH, "D falling while clock is high does not change Q");
  sim.tick();
  assert.equal(level(sim, "clk", "CLK"), LOW);
  assert.equal(level(sim, "ff", "Q"), HIGH, "falling edge holds");
  sim.tick();
  assert.equal(level(sim, "ff", "Q"), LOW, "next rising edge captures D=0");
});

test("JK, T, counter, shift, and SR latch", () => {
  const jk = new Simulator(
    make(
      [
        { type: "vcc", id: "j" },
        { type: "vcc", id: "k" },
        { type: "clock", id: "clk", params: { half: 1 } },
        { type: "jkff", id: "ff" },
      ],
      [
        ["j", "Y", "ff", "J"],
        ["k", "Y", "ff", "K"],
        ["clk", "CLK", "ff", "CLK"],
      ],
    ),
  );
  jk.tick();
  assert.equal(level(jk, "ff", "Q"), HIGH);
  jk.tick();
  jk.tick();
  assert.equal(level(jk, "ff", "Q"), LOW, "JK 11 toggles");

  const tff = new Simulator(
    make(
      [
        { type: "vcc", id: "t" },
        { type: "clock", id: "clk", params: { half: 1 } },
        { type: "tff", id: "ff" },
      ],
      [
        ["t", "Y", "ff", "T"],
        ["clk", "CLK", "ff", "CLK"],
      ],
    ),
  );
  tff.tick();
  assert.equal(level(tff, "ff", "Q"), HIGH);

  const cnt = new Simulator(
    make(
      [
        { type: "clock", id: "clk", params: { half: 1 } },
        { type: "cnt4", id: "c" },
      ],
      [["clk", "CLK", "c", "CLK"]],
    ),
  );
  cnt.tick();
  cnt.tick();
  cnt.tick();
  assert.equal(bitsToNum(cnt.pinBits("c", "Q")), 2);

  const sh = new Simulator(
    make(
      [
        { type: "vcc", id: "sin" },
        { type: "clock", id: "clk", params: { half: 1 } },
        { type: "shift8", id: "s" },
      ],
      [
        ["sin", "Y", "s", "SIN"],
        ["clk", "CLK", "s", "CLK"],
      ],
    ),
  );
  sh.tick();
  assert.equal(sh.pinBits("s", "Q")[0], HIGH);

  const sr = new Simulator(
    make(
      [
        { type: "button", id: "s", params: { down: true } },
        { type: "button", id: "r", params: { down: false } },
        { type: "srlatch", id: "sr" },
      ],
      [
        ["s", "Y", "sr", "S"],
        ["r", "Y", "sr", "R"],
      ],
    ),
  );
  assert.equal(level(sr, "sr", "Q"), HIGH);
  sr.setParam("s", "down", false);
  assert.equal(level(sr, "sr", "Q"), HIGH, "holds after set released");
  sr.setParams([
    ["s", "down", true],
    ["r", "down", true],
  ]);
  assert.equal(level(sr, "sr", "Q"), LOW);
  assert.equal(level(sr, "sr", "QN"), LOW);
  assert.ok(sr.issues.some((i) => i.code === "sr-invalid"));
});

test("tri-state bus, conflict, and inverter loop", () => {
  const bus = new Simulator(
    make(
      [
        { type: "vcc", id: "d" },
        { type: "toggle", id: "en", params: { on: false } },
        { type: "tri1", id: "t" },
        { type: "probe", id: "p" },
      ],
      [
        ["d", "Y", "t", "D"],
        ["en", "Y", "t", "EN"],
        ["t", "Y", "p", "A"],
      ],
    ),
  );
  assert.equal(level(bus, "t", "Y"), 3, "disabled tri-state is Z");
  bus.setParam("en", "on", true);
  assert.equal(level(bus, "p", "A"), HIGH);

  const fight = new Simulator(exampleById("conflict")!.build());
  assert.ok(fight.issues.some((i) => i.code === "conflict"));
  assert.equal(level(fight, "p", "A"), X);

  const loop = new Simulator(exampleById("oscillator")!.build());
  assert.equal(loop.oscillating, true);
  assert.ok(loop.issues.some((i) => i.code === "oscillation" || i.code === "loop"));
});

test("addressed ROM reads the stored byte", () => {
  const sim = new Simulator(
    make(
      [
        { type: "cnt4", id: "a" },
        { type: "rom16", id: "rom", params: { words: [7, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16] } },
      ],
      [["a", "Q", "rom", "ADDR"]],
    ),
  );
  assert.equal(bitsToNum(sim.pinBits("rom", "DOUT")), 7);
});

test("RAM writes on the rising edge and reads back", () => {
  const sim = new Simulator(
    make(
      [
        { type: "clock", id: "clk", params: { half: 1 } },
        { type: "cnt4", id: "addr" },
        { type: "vcc", id: "we" },
        { type: "vcc", id: "ce" },
        { type: "vcc", id: "one" },
        { type: "merge8", id: "m" },
        { type: "ram16", id: "ram" },
      ],
      [
        ["clk", "CLK", "ram", "CLK"],
        ["addr", "Q", "ram", "ADDR"],
        ["we", "Y", "ram", "WE"],
        ["ce", "Y", "ram", "CE"],
        ["one", "Y", "m", "B0"],
        ["one", "Y", "m", "B1"],
        ["one", "Y", "m", "B2"],
        ["one", "Y", "m", "B3"],
        ["one", "Y", "m", "B4"],
        ["one", "Y", "m", "B5"],
        ["one", "Y", "m", "B6"],
        ["one", "Y", "m", "B7"],
        ["m", "Y", "ram", "DIN"],
      ],
    ),
  );
  sim.tick();
  assert.equal(bitsToNum(sim.pinBits("ram", "DOUT")), 255);
});

test("ALU add and subtract", () => {
  const alu = getBehavior("alu8");
  const add = alu.outputs(
    { A: fromNum(6, 8), B: fromNum(7, 8), OP: fromNum(0, 3) },
    {},
    {},
  );
  assert.equal(bitsToNum(add.out.Y), 13);
  assert.equal(add.out.Z?.[0], LOW);
  const sub = alu.outputs(
    { A: fromNum(6, 8), B: fromNum(7, 8), OP: fromNum(1, 3) },
    {},
    {},
  );
  assert.equal(bitsToNum(sub.out.Y), (6 - 7) & 255);
  const and = alu.outputs(
    { A: fromNum(0b1100, 8), B: fromNum(0b1010, 8), OP: fromNum(2, 3) },
    {},
    {},
  );
  assert.equal(bitsToNum(and.out.Y), 0b1000);
});

test("expression component and Quine-McCluskey", () => {
  assert.equal(evalFormula("(a & b) | ~c", { a: HIGH, b: LOW, c: HIGH, d: LOW }).value, LOW);
  assert.equal(evalFormula("~(a & 0)", { a: HIGH, b: LOW, c: LOW, d: LOW }).value, HIGH);
  assert.equal(quineMcCluskey([3], ["A", "B"]), "A·B");
  assert.equal(quineMcCluskey([0, 1, 2, 3], ["A", "B"]), "1");
  assert.equal(quineMcCluskey([], ["A", "B"]), "0");
});

test("truth table of the full-adder example", () => {
  const circuit = exampleById("full-adder")!.build();
  const report = analyze(circuit);
  assert.ok(report.truth);
  assert.equal(report.truth!.rows.length, 8);
  const sumCol = report.truth!.outputs.findIndex((o) => o.label === "Sum");
  const coutCol = report.truth!.outputs.findIndex((o) => o.label === "Cout");
  const row = (a: number, b: number, c: number) => report.truth!.rows[a | (b << 1) | (c << 2)]!;
  assert.equal(row(1, 1, 1).out[sumCol], "1");
  assert.equal(row(1, 1, 1).out[coutCol], "1");
  assert.equal(row(1, 0, 0).out[sumCol], "1");
  assert.equal(row(1, 0, 0).out[coutCol], "0");
  assert.ok(report.explanation.some((l) => l.includes("full adder")));
});

test("assembler and CPU executes 6 + 7 = 13", () => {
  const src = "LDA 14\nADD 15\nOUT\nHLT\nORG 14\nDB 6\nDB 7\n";
  const asm = assemble(src);
  assert.equal(asm.errors.length, 0);
  assert.equal(disasm(asm.words[0]!), "LDA 14");
  assert.equal(asm.words[14], 6);
  assert.equal(asm.words[15], 7);

  const circuit = cpuCircuit();
  const ram = circuit.components.find((c) => c.id === "ram")!;
  ram.params = { words: asm.words };
  const sim = new Simulator(circuit);
  assert.equal(sim.oscillating, false, "CPU netlist should settle");
  const serious = sim.issues.filter((i) => i.level === "error");
  assert.deepEqual(
    serious.map((i) => i.message),
    [],
  );

  let guard = 0;
  while (!sim.halted && guard++ < 160) sim.tick();
  assert.equal(sim.halted, true, "CPU should halt");
  assert.equal(bitsToNum(sim.pinBits("out", "OUT")), 13);
  assert.equal(bitsToNum(sim.pinBits("acc", "A")), 13);
});
