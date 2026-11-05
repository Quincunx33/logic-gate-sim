# LogicMatter

<p align="center">
  <img src="https://logic-gate-sim.pages.dev/og.jpg" alt="LogicMatter — Digital Logic Design & Simulation Studio" width="100%" />
</p>

<p align="center">
  <strong>A browser-based digital logic design studio — build circuits, simulate signals, inspect waveforms, and explore a working 8-bit CPU.</strong>
</p>

<p align="center">
  <a href="https://logic-gate-sim.pages.dev"><strong>Open LogicMatter →</strong></a>
  ·
  <a href="https://github.com/Quincunx33/logic-gate-sim"><strong>Source Code</strong></a>
</p>

---

## What is LogicMatter?

**LogicMatter** is an interactive digital logic laboratory that runs in your browser. It gives you a visual workspace for building circuits from logic gates and larger digital components, then lets you observe how signals move and how the circuit behaves over time.

Start with a simple AND gate, build a full adder, experiment with sequential circuits, or open the CPU workspace to assemble and run a small program on a simulated 8-bit computer.

No desktop electronics software is required. Open the app and start experimenting.

## Explore the studio

| Workspace | What you can do |
| --- | --- |
| **Design** | Place components, connect pins, edit circuits, and interact with switches and buttons. |
| **Analysis** | Generate truth tables, inspect logic expressions, view Karnaugh maps, and explore circuit connectivity. |
| **Waveforms** | Watch signal values change over simulation time. |
| **Debugger** | Inspect signal values, transitions, circuit issues, and simulation state. |
| **CPU** | Explore the CPU circuit, write assembly-like programs, and follow instruction execution. |

## Build digital circuits

Choose parts from the component library and place them on the schematic. Connect output pins to input pins to create a circuit.

### Component library

The library is organized into practical groups:

- **Logic gates:** AND, OR, NOT, NAND, NOR, XOR, XNOR, and buffer gates.
- **Inputs and outputs:** toggle switches, push buttons, clocks, LEDs, probes, and display components.
- **Combinational logic:** half adders, full adders, subtractors, multiplexers, demultiplexers, encoders, decoders, and comparators.
- **Sequential logic:** SR latches, D/JK/T flip-flops, registers, shift registers, and counters.
- **Memory:** RAM, ROM, and register-file components.
- **Advanced components:** tri-state buffers, buses, splitters, mergers, and an 8-bit ALU.
- **CPU building blocks:** registers, control logic, program counter, memory interfaces, and other datapath components.

Many components support configurable parameters and multi-bit pins. The simulator checks pin-width compatibility when you connect components.

## Simulate and inspect

Control the simulation directly from the toolbar:

- **Run / Pause** to start or stop continuous simulation.
- **Step** to advance one simulation tick at a time.
- **Reset** to return the circuit to its initial state.
- **Speed control** to adjust the simulation rate.

The simulator models digital signal states including 0, 1, unknown (X), and high-impedance (Z). It can also report conflicting drivers and detect combinational feedback loops that do not settle.

## Analyze your circuit

Switch to **Analysis** to examine the behavior of your design:

- Automatically generated truth tables from the circuit's actual topology.
- Structural Boolean expressions for supported gate networks.
- Simplified sum-of-products expressions for supported small Boolean functions.
- Karnaugh maps for circuits with two to four inputs.
- Signal-flow and connection reports.
- Combinational-cycle inspection.

Truth tables are produced by simulating input combinations rather than by relying on a manually entered answer. Sequential components are evaluated from their reset state; the analysis view explains this limitation.

## Explore waveforms and debugging

The **Waveforms** workspace records watched pin values as simulation time advances. Add pins to the watch list and observe how signals change.

The **Debugger** helps inspect component and wire state, signal transitions, conflicting connections, and simulation conditions. These tools are useful when a circuit behaves differently from what you expected.

## Experiment with the built-in examples

Open **Examples** in the app to load ready-made circuits, including:

| Example | Concept |
| --- | --- |
| Full adder | Sum and carry outputs |
| XOR from NAND | Building XOR using only NAND gates |
| 2:1 multiplexer | Selecting between two inputs |
| SR latch | Set/reset behavior and the invalid input case |
| D flip-flop | Capturing data on a rising clock edge |
| 4-bit counter | Clocked counting and hexadecimal output |
| Inverter loop | A combinational feedback loop |
| Fighting drivers | Conflicting signal sources |
| 8-bit CPU | A small programmable computer |

These examples are useful starting points: load one, change its inputs, inspect its outputs, and then modify the circuit.

## A small 8-bit CPU inside the lab

LogicMatter includes a separate CPU sheet with a SAP-1-style 8-bit datapath and a small instruction set.

You can edit the program, assemble it into memory, load it into the CPU, and step through execution using the simulator.

### Supported instructions

| Instruction | Operation |
| --- | --- |
| **NOP** | No operation |
| **LDA a** | Load the value at memory address a into the accumulator |
| **ADD a** | Add the value at address a to the accumulator |
| **SUB a** | Subtract the value at address a from the accumulator |
| **STA a** | Store the accumulator at address a |
| **JMP a** | Jump to address a |
| **JZ a** | Jump if the accumulator is zero |
| **OUT** | Copy the accumulator to the output register |
| **HLT** | Halt the CPU |
| **LDI n** | Load an immediate value into the accumulator |

The assembler also supports **ORG** to set a memory address and **DB / DATA** to place a byte in memory. Numeric values can be written in decimal, hexadecimal (0x), or binary (%).

A sample program is included in the CPU workspace.

## Editing your project

LogicMatter includes practical editing and project-management tools:

- Place, move, rotate, flip, duplicate, and delete components.
- Select multiple components and work with connected parts.
- Undo and redo circuit edits.
- Copy and paste components.
- Rename projects and edit component parameters.
- Save the current project automatically in the browser.
- Save named versions in browser storage.
- Export a project as a JSON file and import it later.

**Note:** Browser-based saves and version history are stored locally in that browser. Export your project JSON if you want a portable backup.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl / ⌘ + Z | Undo |
| Ctrl / ⌘ + Shift + Z or Ctrl / ⌘ + Y | Redo |
| Ctrl / ⌘ + S | Save a version |
| Ctrl / ⌘ + C | Copy selection |
| Ctrl / ⌘ + V | Paste |
| Ctrl / ⌘ + D | Duplicate selection |
| Ctrl / ⌘ + A | Select all components |
| Delete / Backspace | Delete selection |
| R | Rotate selection |
| M | Flip selection |
| Arrow keys | Nudge selection |
| ? | Open keyboard help |
| Esc | Close menus / cancel placement |

On macOS, use **⌘ Command** where the table shows **Ctrl**.

## Getting started

### Use the live app

The quickest way to try LogicMatter is to open:

**https://logic-gate-sim.pages.dev**

Choose an example from the **Examples** menu, or select a part from the library and start building your own circuit.

### Run locally

**Requirements**

- Node.js 22 or newer
- npm

**1. Clone the repository**

~~~bash
git clone https://github.com/Quincunx33/logic-gate-sim.git
cd logic-gate-sim
~~~

**2. Install dependencies**

~~~bash
npm install
~~~

**3. Start the development server**

~~~bash
npm run dev
~~~

Open the local address printed by Vite in your terminal.

### Useful commands

| Command | Description |
| --- | --- |
| npm run dev | Start the development server |
| npm run build | Create a production build |
| npm run preview | Preview the production build |
| npm test | Run the automated test suite |
| npm run typecheck | Run TypeScript checks |
| npm run lint | Run ESLint |

## Built with

- **React 19** — component-based user interface
- **TypeScript** — application and simulator logic
- **Vite** — development and build tooling
- **TanStack Start / TanStack Router** — application routing and server integration
- **Nitro** — deployment runtime
- **Tailwind CSS 4** — styling foundation
- **Zustand** — application state management
- **React Resizable Panels** — adjustable studio layout
- **Lucide** — interface icons

The circuit simulation engine and component behaviors are implemented in the project itself.

## Project structure

~~~text
src/
├── lab/          # Studio UI, schematic, analysis, waveforms, and state
├── sim/          # Circuit engine, signals, components, CPU, and assembler
├── lib/          # Application utilities, authentication, and data services
├── routes/       # Application routes
└── components/   # Shared UI components

public/           # Static assets and app icons
scripts/          # Build, environment, migration, and verification scripts
server/           # Server middleware
migrations/       # Database migrations
~~~

## Contributing

Bug reports, thoughtful suggestions, and code contributions are welcome.

1. Check the existing code and project behavior before making a change.
2. Keep simulator behavior deterministic and covered by tests where practical.
3. Avoid documenting features as complete unless they are implemented and verified.
4. Run the relevant checks before submitting a pull request.

## License

No license file was present in the repository when this README was written. Until a license is added, the project should not be assumed to grant permission for redistribution or reuse.

---

<p align="center">
  <strong>LogicMatter</strong><br />
  Design it. Simulate it. Understand it.
</p>
