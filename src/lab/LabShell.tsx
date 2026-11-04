import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  Bug,
  Cpu,
  Download,
  FolderPlus,
  HelpCircle,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  Save,
  Search,
  SkipForward,
  Table2,
  Undo2,
  Upload,
} from "lucide-react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { AnalysisView } from "@/lab/AnalysisView";
import { fmtBits, sigKind } from "@/lab/format";
import { Schematic } from "@/lab/Schematic";
import { EXAMPLES, loadStoredProject, useLab, type Workspace } from "@/lab/store";
import { Waveform } from "@/lab/Waveform";
import { CTRL, ISA_SUMMARY, disasm, microcode } from "@/sim/isa";
import { getDef, library } from "@/sim/library";
import { bitsToNum, type Sig } from "@/sim/signal";
import type { CompInst } from "@/sim/types";

const WORKSPACES: { id: Workspace; label: string; icon: typeof Cpu }[] = [
  { id: "design", label: "Design", icon: Activity },
  { id: "analysis", label: "Analysis", icon: Table2 },
  { id: "wave", label: "Waveforms", icon: Activity },
  { id: "debug", label: "Debugger", icon: Bug },
  { id: "cpu", label: "CPU", icon: Cpu },
];

export function LabShell() {
  const workspace = useLab((s) => s.workspace);
  const sheet = useLab((s) => s.sheet);
  const narrow = useNarrow();
  const [libOpen, setLibOpen] = useState(false);
  const [inspOpen, setInspOpen] = useState(false);
  const ready = useRef(false);
  const rev = useLab((s) => s.rev);
  const running = useLab((s) => s.running);
  const name = useLab((s) => s.name);
  const program = useLab((s) => s.program);

  useEffect(() => {
    loadStoredProject();
    if (useLab.getState().samples.length === 0) useLab.getState().recordSample();
    ready.current = true;
  }, []);

  useEffect(() => {
    if (!running) return;
    let acc = 0;
    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      const s = useLab.getState();
      if (!s.running) return;
      const dt = Math.min(80, now - last);
      last = now;
      acc += dt;
      const interval = 1000 / Math.max(1, s.speed);
      let n = 0;
      while (acc >= interval && n < 6) {
        if (s.sim.halted || s.sim.oscillating) {
          setRunningStopped(s.sim.halted ? "CPU halted." : "Oscillation — simulation paused.");
          return;
        }
        s.sim.tick();
        s.recordSample();
        acc -= interval;
        n += 1;
      }
      if (n) s.bump();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  useEffect(() => {
    if (!ready.current || running) return;
    const id = window.setTimeout(() => useLab.getState().saveLocal(false), 900);
    return () => window.clearTimeout(id);
  }, [rev, running, name, program, sheet]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.key === "?" && !typing) {
        e.preventDefault();
        useLab.getState().setHelp(!useLab.getState().showHelp);
        return;
      }
      if (e.key === "Escape") {
        useLab.getState().setMenu(null);
        useLab.getState().setHelp(false);
        useLab.getState().setPlace(null);
      }
      if (typing) return;
      const s = useLab.getState();
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redoAction();
        else s.undoAction();
      } else if (meta && e.key.toLowerCase() === "y") {
        e.preventDefault();
        s.redoAction();
      } else if (meta && e.key.toLowerCase() === "s") {
        e.preventDefault();
        s.saveLocal(true);
      } else if (meta && e.key.toLowerCase() === "c") {
        s.copy();
      } else if (meta && e.key.toLowerCase() === "v") {
        s.paste();
      } else if (meta && e.key.toLowerCase() === "d") {
        e.preventDefault();
        s.duplicate();
      } else if (meta && e.key.toLowerCase() === "a") {
        e.preventDefault();
        s.selectComps(s.circuit().components.map((c) => c.id));
      } else if (e.key === "Delete" || e.key === "Backspace") {
        s.deleteSelection();
      } else if (e.key === "r" || e.key === "R") s.rotateSelection();
      else if (e.key === "m" || e.key === "M") s.flipSelection();
      else if (e.key === "ArrowLeft") s.nudge(-8, 0);
      else if (e.key === "ArrowRight") s.nudge(8, 0);
      else if (e.key === "ArrowUp") s.nudge(0, -8);
      else if (e.key === "ArrowDown") s.nudge(0, 8);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const center =
    workspace === "analysis" ? (
      <AnalysisView />
    ) : workspace === "wave" ? (
      <Waveform tall />
    ) : workspace === "debug" ? (
      <DebugList />
    ) : (
      <Schematic />
    );

  return (
    <div className="lm" suppressHydrationWarning>
      <TopBar
        narrow={narrow}
        libOpen={libOpen}
        inspOpen={inspOpen}
        onLib={() => {
          setLibOpen((v) => !v);
          setInspOpen(false);
        }}
        onInsp={() => {
          setInspOpen((v) => !v);
          setLibOpen(false);
        }}
      />
      {narrow ? (
        <div className="lm-narrow">
          <div className="lm-narrow-center">{center}</div>
          <div className="lm-bottom">
            <Bottom />
          </div>
          {(libOpen || inspOpen) && (
            <div
              className="lm-drawer-backdrop"
              aria-hidden="true"
              onClick={() => {
                setLibOpen(false);
                setInspOpen(false);
              }}
            />
          )}
          {libOpen && (
            <aside className="lm-drawer" aria-label="Component parts library">
              <div className="lm-drawer-header">
                <strong>Parts Library</strong>
                <button
                  type="button"
                  className="lm-drawer-close"
                  aria-label="Close parts library"
                  onClick={() => setLibOpen(false)}
                >
                  ✕
                </button>
              </div>
              <Library onPick={() => setLibOpen(false)} />
            </aside>
          )}
          {inspOpen && (
            <aside className="lm-drawer is-right" aria-label="Inspector panel">
              <div className="lm-drawer-header">
                <strong>Inspector</strong>
                <button
                  type="button"
                  className="lm-drawer-close"
                  aria-label="Close inspector"
                  onClick={() => setInspOpen(false)}
                >
                  ✕
                </button>
              </div>
              <SidePanel />
            </aside>
          )}
        </div>
      ) : (
        <Desktop workspaceCenter={center} />
      )}
      <Help />
    </div>
  );
}

function setRunningStopped(message: string) {
  useLab.setState({ running: false, message, rev: useLab.getState().rev + 1 });
}

function Desktop({ workspaceCenter }: { workspaceCenter: ReactNode }) {
  const libRef = usePanelRef();
  const sideRef = usePanelRef();
  return (
    <div className="lm-desktop">
      <Group id="lm-group-main" orientation="horizontal" className="lm-group" style={{ height: "100%", width: "100%" }}>
        <Panel id="lm-panel-lib" panelRef={libRef} defaultSize={18} minSize={15} collapsible collapsedSize={0}>
          <Library />
        </Panel>
        <Separator id="lm-sep-left" className="lm-sep" />
        <Panel id="lm-panel-center-group" minSize={30}>
          <Group id="lm-group-center" orientation="vertical" className="lm-group" style={{ height: "100%", width: "100%" }}>
            <Panel id="lm-panel-workspace" minSize={20}>{workspaceCenter}</Panel>
            <Separator id="lm-sep-bottom" className="lm-sep" />
            <Panel id="lm-panel-bottom" defaultSize={30} minSize={15} collapsible collapsedSize={5}>
              <Bottom />
            </Panel>
          </Group>
        </Panel>
        <Separator id="lm-sep-right" className="lm-sep" />
        <Panel id="lm-panel-side" panelRef={sideRef} defaultSize={24} minSize={15} collapsible collapsedSize={0}>
          <SidePanel />
        </Panel>
      </Group>
    </div>
  );
}

function TopBar({
  narrow,
  libOpen,
  inspOpen,
  onLib,
  onInsp,
}: {
  narrow: boolean;
  libOpen?: boolean;
  inspOpen?: boolean;
  onLib: () => void;
  onInsp: () => void;
}) {
  const name = useLab((s) => s.name);
  const running = useLab((s) => s.running);
  const speed = useLab((s) => s.speed);
  const workspace = useLab((s) => s.workspace);
  const sheet = useLab((s) => s.sheet);
  const menu = useLab((s) => s.menu);
  const rev = useLab((s) => s.rev);
  const message = useLab((s) => s.message);
  const fileRef = useRef<HTMLInputElement>(null);
  const sim = useLab.getState().sim;
  void rev;
  const errCount = sim.issues.filter((i) => i.level === "error").length;

  return (
    <header className="lm-top">
      <div className="lm-bar">
        <div className="lm-brand">
          <Logo />
          <div>
            <strong>LogicMatter</strong>
            <input
              className="lm-name"
              aria-label="Project name"
              value={name}
              onChange={(e) => useLab.setState({ name: e.target.value })}
            />
          </div>
        </div>
        <div className="lm-top-actions">
          {narrow && (
            <button
              type="button"
              className={"lm-btn" + (libOpen ? " is-on" : "")}
              onClick={onLib}
              aria-expanded={!!libOpen}
            >
              Parts
            </button>
          )}
          <button type="button" className="lm-btn" onClick={() => useLab.getState().setMenu(menu === "file" ? null : "file")}>
            File
          </button>
          <button type="button" className="lm-btn" onClick={() => useLab.getState().setMenu(menu === "examples" ? null : "examples")}>
            Examples
          </button>
          <span className="lm-div" />
          <button type="button" className="lm-icon" title="Undo" onClick={() => useLab.getState().undoAction()}>
            <Undo2 size={16} />
          </button>
          <button type="button" className="lm-icon" title="Redo" onClick={() => useLab.getState().redoAction()}>
            <Redo2 size={16} />
          </button>
          <span className="lm-div" />
          <button type="button" className={"lm-icon" + (running ? " is-on" : "")} title={running ? "Pause" : "Run"} onClick={() => useLab.getState().toggleRun()}>
            {running ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button type="button" className="lm-icon" title="Step one tick" onClick={() => useLab.getState().step()}>
            <SkipForward size={16} />
          </button>
          <button type="button" className="lm-icon" title="Reset simulation" onClick={() => useLab.getState().resetSim()}>
            <RotateCcw size={16} />
          </button>
          <label className="lm-speed">
            <span>{speed}/s</span>
            <input
              type="range"
              min={1}
              max={40}
              value={speed}
              onChange={(e) => useLab.getState().setSpeed(Number(e.target.value))}
            />
          </label>
        </div>
        <div className="lm-top-end">
          {narrow && (
            <button
              type="button"
              className={"lm-btn" + (inspOpen ? " is-on" : "")}
              onClick={onInsp}
              aria-expanded={!!inspOpen}
            >
              Inspect
            </button>
          )}
          <button type="button" className="lm-icon is-text" title="Fit schematic" onClick={() => useLab.getState().fitView()}>
            Fit
          </button>
          <button type="button" className="lm-icon" title="Shortcuts" onClick={() => useLab.getState().setHelp(true)}>
            <HelpCircle size={16} />
          </button>
          <span className={"lm-pill" + (errCount ? " is-err" : sim.halted ? " is-x" : sim.oscillating ? " is-err" : running ? " is-high" : "")}>
            t={sim.time}
            {running ? " RUN" : ""}
            {sim.halted ? " HALT" : ""}
            {sim.oscillating ? " OSC" : ""}
            {errCount ? ` ${errCount} err` : ""}
          </span>
        </div>
      </div>
      <div className="lm-bar lm-bar-tabs">
        <nav className="lm-workspaces">
          {WORKSPACES.map((w) => (
            <button key={w.id} type="button" className={workspace === w.id ? "is-on" : ""} onClick={() => useLab.getState().setWorkspace(w.id)}>
              {w.label}
            </button>
          ))}
          <span className="lm-div" />
          <button type="button" className={sheet === "design" ? "is-on" : ""} onClick={() => useLab.getState().setSheet("design")}>
            Design sheet
          </button>
          <button type="button" className={sheet === "cpu" ? "is-on" : ""} onClick={() => useLab.getState().setSheet("cpu")}>
            CPU sheet
          </button>
        </nav>
        <p className="lm-message">{message}</p>
      </div>
      {menu === "file" && (
        <div className="lm-menu">
          <button type="button" onClick={() => useLab.getState().newProject()}>
            <FolderPlus size={15} /> New project
          </button>
          <button type="button" onClick={() => useLab.getState().saveLocal(true)}>
            <Save size={15} /> Save version
          </button>
          <button type="button" onClick={() => useLab.getState().exportProject()}>
            <Download size={15} /> Export JSON
          </button>
          <button type="button" onClick={() => fileRef.current?.click()}>
            <Upload size={15} /> Import JSON
          </button>
          <HistoryList />
        </div>
      )}
      {menu === "examples" && (
        <div className="lm-menu">
          {EXAMPLES.map((ex) => (
            <button key={ex.id} type="button" onClick={() => useLab.getState().loadExample(ex.id)}>
              <span>{ex.name}</span>
              <small>{ex.blurb}</small>
            </button>
          ))}
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const err = useLab.getState().importProject(await file.text());
          if (err) useLab.getState().setMessage(err);
          e.target.value = "";
        }}
      />
    </header>
  );
}

function HistoryList() {
  const [items, setItems] = useState<{ at: number; name: string }[]>([]);

  useEffect(() => {
    setItems(useLab.getState().history());
  }, []);

  if (items.length === 0) return <p className="lm-menu-note">No saved versions yet.</p>;
  return (
    <div className="lm-history">
      {items.map((item, i) => (
        <button key={item.at} type="button" onClick={() => useLab.getState().restoreHistory(i)}>
          {item.name} · {new Date(item.at).toISOString().slice(0, 16).replace("T", " ")}
        </button>
      ))}
    </div>
  );
}

function Library({ onPick }: { onPick?: () => void }) {
  const [q, setQ] = useState("");
  const place = useLab((s) => s.placeType);
  const query = q.trim().toLowerCase();
  const parts = library().filter((d) => !query || (d.label + d.blurb + d.category).toLowerCase().includes(query));
  const cats = ["Gates", "Input / Output", "Combinational", "Sequential", "Memory", "Advanced", "CPU"] as const;
  return (
    <div className="lm-lib">
      <div className="lm-search">
        <Search size={14} />
        <input value={q} placeholder="Search parts" onChange={(e) => setQ(e.target.value)} aria-label="Search parts" />
      </div>
      <div className="lm-lib-scroll">
        {cats.map((cat) => {
          const items = parts.filter((d) => d.category === cat);
          if (items.length === 0) return null;
          return (
            <section key={cat}>
              <h2>{cat}</h2>
              {items.map((d) => (
                <button
                  key={d.type}
                  type="button"
                  className={"lm-part" + (place === d.type ? " is-on" : "")}
                  onClick={() => {
                    useLab.getState().setPlace(d.type);
                    onPick?.();
                  }}
                >
                  <span>{d.label}</span>
                  <small>{d.blurb}</small>
                </button>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function SidePanel() {
  const workspace = useLab((s) => s.workspace);
  const sheet = useLab((s) => s.sheet);
  if (workspace === "cpu" || sheet === "cpu") {
    return (
      <div className="lm-side">
        <CpuPanel />
        <Inspector />
      </div>
    );
  }
  return (
    <div className="lm-side">
      <Inspector />
    </div>
  );
}

function Inspector() {
  const rev = useLab((s) => s.rev);
  const selection = useLab((s) => s.selection);
  const wireSelection = useLab((s) => s.wireSelection);
  void rev;
  const circuit = useLab.getState().circuit();
  const sim = useLab.getState().sim;
  const wire = circuit.wires.find((w) => w.id === wireSelection[0]);
  const comps = circuit.components.filter((c) => selection.includes(c.id));

  if (wire) {
    const ca = circuit.components.find((c) => c.id === wire.a.c);
    const cb = circuit.components.find((c) => c.id === wire.b.c);
    const net = sim.netOf(wire.a.c, wire.a.p);
    const bits = net?.bits ?? [];
    return (
      <div className="lm-insp">
        <h2>Wire {wire.id}</h2>
        <p className={"lm-level is-" + sigKind(bits, net?.conflict || net?.unstable)}>{fmtBits(bits)}</p>
        <dl className="lm-kv">
          <dt>From</dt>
          <dd>
            {ca?.label ?? wire.a.c}.{wire.a.p}
          </dd>
          <dt>To</dt>
          <dd>
            {cb?.label ?? wire.b.c}.{wire.b.p}
          </dd>
          <dt>Pins on net</dt>
          <dd>{net ? net.pins.length : 0}</dd>
          <dt>Conflict</dt>
          <dd>{net?.conflict ? "Yes" : "No"}</dd>
        </dl>
        <h3>Transitions</h3>
        <ul className="lm-mini">
          {(net?.history ?? []).slice(-8).map((h, i) => (
            <li key={i}>
              t={h.t} {h.text}
            </li>
          ))}
          {(net?.history.length ?? 0) === 0 && <li>No changes recorded yet.</li>}
        </ul>
        <button type="button" className="lm-btn" onClick={() => useLab.getState().deleteSelection()}>
          Delete wire
        </button>
      </div>
    );
  }

  if (comps.length === 0) {
    return (
      <div className="lm-insp">
        <h2>Inspector</h2>
        <p>Select a part or a wire. Every pin value here comes from the simulator, not a decoration.</p>
        <dl className="lm-kv">
          <dt>Parts</dt>
          <dd>{circuit.components.length}</dd>
          <dt>Wires</dt>
          <dd>{circuit.wires.length}</dd>
          <dt>Nets</dt>
          <dd>{sim.nets.length}</dd>
        </dl>
        <p className="lm-doc">Low is blue, high is green, unknown is amber, high-Z is gray, a driver fight is red.</p>
      </div>
    );
  }

  if (comps.length > 1) {
    return (
      <div className="lm-insp">
        <h2>{comps.length} selected</h2>
        <div className="lm-row">
          <button type="button" className="lm-btn" onClick={() => useLab.getState().rotateSelection()}>
            Rotate
          </button>
          <button type="button" className="lm-btn" onClick={() => useLab.getState().flipSelection()}>
            Mirror
          </button>
          <button type="button" className="lm-btn" onClick={() => useLab.getState().duplicate()}>
            Duplicate
          </button>
          <button type="button" className="lm-btn" onClick={() => useLab.getState().deleteSelection()}>
            Delete
          </button>
        </div>
      </div>
    );
  }

  const comp = comps[0]!;
  const def = getDef(comp.type);
  return (
    <div className="lm-insp">
      <h2>{def.label}</h2>
      <label className="lm-field">
        Name
        <input value={comp.label} onChange={(e) => useLab.getState().setLabel(comp.id, e.target.value)} />
      </label>
      <p className="lm-doc">{def.doc}</p>
      <PartFields comp={comp} />
      <div className="lm-row">
        <button type="button" className="lm-btn" onClick={() => useLab.getState().rotateSelection()}>
          Rotate
        </button>
        <button type="button" className="lm-btn" onClick={() => useLab.getState().flipSelection()}>
          Mirror
        </button>
        <button type="button" className="lm-btn" onClick={() => useLab.getState().deleteSelection()}>
          Delete
        </button>
      </div>
      <table className="lm-pins">
        <thead>
          <tr>
            <th>Pin</th>
            <th>Value</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {def.pins.map((p) => {
            const bits = sim.pinBits(comp.id, p.id);
            const net = sim.netOf(comp.id, p.id);
            return (
              <tr key={p.id}>
                <td>
                  {p.name}
                  <small>
                    {p.dir} {p.width > 1 ? p.width + "b" : ""}
                  </small>
                </td>
                <td className={"is-" + sigKind(bits, net?.conflict)}>{fmtBits(bits)}</td>
                <td>
                  <button type="button" onClick={() => useLab.getState().watchPin(comp.id, p.id)}>
                    Watch
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PartFields({ comp }: { comp: CompInst }) {
  if (comp.type === "toggle") {
    return (
      <button type="button" className={"lm-btn is-primary" + (comp.params.on ? " is-on" : "")} onClick={() => useLab.getState().toggleSwitch(comp.id)}>
        {comp.params.on ? "Driving 1" : "Driving 0"}
      </button>
    );
  }
  if (comp.type === "button") {
    return <p className="lm-doc">Click the button body on the canvas and hold.</p>;
  }
  if (comp.type === "clock") {
    return (
      <label className="lm-field">
        Half-period (ticks)
        <input
          type="number"
          min={1}
          max={64}
          value={Number(comp.params.half) || 1}
          onChange={(e) => useLab.getState().setParam(comp.id, "half", Math.max(1, Number(e.target.value) || 1))}
        />
      </label>
    );
  }
  if (comp.type === "label") {
    return <BlurText id={comp.id} k="text" value={String(comp.params.text ?? "")} label="Text" />;
  }
  if (comp.type === "expr") {
    return <BlurText id={comp.id} k="formula" value={String(comp.params.formula ?? "")} label="Formula  a b c d,  & | ^ ~" />;
  }
  if (comp.type === "ram16" || comp.type === "rom16" || comp.type === "iram") {
    const words = Array.isArray(comp.params.words) ? (comp.params.words as number[]) : [];
    return (
      <div className="lm-mem">
        {Array.from({ length: 16 }, (_, i) => (
          <label key={i}>
            <span>{i.toString(16).toUpperCase()}</span>
            <input
              value={(words[i] ?? 0).toString(16).toUpperCase().padStart(2, "0")}
              onChange={(e) => {
                const next = words.slice(0, 16);
                while (next.length < 16) next.push(0);
                const n = Number.parseInt(e.target.value || "0", 16);
                next[i] = Number.isFinite(n) ? n & 255 : 0;
                useLab.getState().setParam(comp.id, "words", next);
              }}
            />
          </label>
        ))}
      </div>
    );
  }
  return null;
}

function BlurText({ id, k, value, label }: { id: string; k: string; value: string; label: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value, id]);
  return (
    <label className="lm-field">
      {label}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== value) useLab.getState().setParam(id, k, text);
        }}
      />
    </label>
  );
}

function CpuPanel() {
  const program = useLab((s) => s.program);
  const rev = useLab((s) => s.rev);
  const [err, setErr] = useState<string | null>(null);
  void rev;
  const sim = useLab.getState().sim;
  const onCpu = useLab.getState().sheet === "cpu" && useLab.getState().circuit().components.some((c) => c.id === "cu");
  const op = onCpu ? bitsToNum(sim.pinBits("ir", "OP")) : null;
  const t = onCpu ? (sim.stateOf("cu").t ?? 0) : 0;
  const z = (onCpu ? sim.pinBits("acc", "Z")[0] : 0) as Sig;
  const word = onCpu ? microcode(op, t, z) : null;
  const mem = onCpu ? (sim.stateOf("ram").mem ?? []) : [];
  const read = (id: string, pin: string) => (onCpu ? bitsToNum(sim.pinBits(id, pin)) : null);

  return (
    <div className="lm-cpu">
      <h2>CPU laboratory</h2>
      <p className="lm-doc">
        One shared bus, a 4-bit address, and six T-states. The control unit is the same microcode the simulator executes. Reset restores RAM from the loaded program.
      </p>
      <label className="lm-field">
        Program
        <textarea value={program} spellCheck={false} onChange={(e) => useLab.getState().setProgram(e.target.value)} />
      </label>
      <button
        type="button"
        className="lm-btn is-primary"
        onClick={() => {
          const problem = useLab.getState().loadProgram();
          setErr(problem);
        }}
      >
        Assemble and load
      </button>
      {err && <p className="lm-warn">{err}</p>}
      {word && (
        <div className="lm-micro">
          <h3>
            T{t} {op === null ? "OP X" : disasm(((op & 15) << 4) | (bitsToNum(sim.pinBits("ir", "BOUT")) ?? 0))}
          </h3>
          <p>{word.note}</p>
          <div className="lm-ctrls">
            {CTRL.map((name) => (
              <span key={name} className={word.signals[name] === 1 ? "is-high" : ""}>
                {name}
              </span>
            ))}
          </div>
        </div>
      )}
      {onCpu && (
        <dl className="lm-kv">
          <dt>PC</dt>
          <dd className="mono">{fmtReg(sim.stateOf("pc").q)}</dd>
          <dt>MAR</dt>
          <dd className="mono">{fmtReg(sim.stateOf("mar").q)}</dd>
          <dt>IR</dt>
          <dd className="mono">{fmtReg(sim.stateOf("ir").q)}</dd>
          <dt>ACC</dt>
          <dd className="mono">{fmtReg(sim.stateOf("acc").q)}</dd>
          <dt>B</dt>
          <dd className="mono">{fmtReg(sim.stateOf("breg").q)}</dd>
          <dt>OUT</dt>
          <dd className="mono">{read("out", "OUT") ?? "—"}</dd>
          <dt>Z</dt>
          <dd>{z === 1 ? "1" : z === 0 ? "0" : "X"}</dd>
        </dl>
      )}
      {onCpu && (
        <ol className="lm-mem-list">
          {mem.slice(0, 16).map((byte, i) => (
            <li key={i} className={i === (bitsToNum(sim.stateOf("pc").q ?? []) ?? -1) ? "is-on" : ""}>
              <span>{i.toString(16).toUpperCase()}</span>
              <span className="mono">{byte.toString(16).toUpperCase().padStart(2, "0")}</span>
              <span>{disasm(byte)}</span>
            </li>
          ))}
        </ol>
      )}
      <details>
        <summary>Instruction set</summary>
        <ul className="lm-isa">
          {ISA_SUMMARY.map((row) => (
            <li key={row.op}>
              <strong>{row.op}</strong> <span className="mono">{row.code}</span> {row.meaning}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function fmtReg(bits?: import("@/sim/signal").Bits): string {
  const n = bitsToNum(bits);
  if (n === null) return "X";
  return n.toString(16).toUpperCase().padStart(2, "0");
}

function Bottom() {
  const [tab, setTab] = useState<"wave" | "issues" | "console">("wave");
  const workspace = useLab((s) => s.workspace);
  return (
    <div className="lm-bottom-inner">
      <div className="lm-tabs">
        {workspace !== "wave" && (
          <button type="button" className={tab === "wave" ? "is-on" : ""} onClick={() => setTab("wave")}>
            Waveform
          </button>
        )}
        <button type="button" className={tab === "issues" ? "is-on" : ""} onClick={() => setTab("issues")}>
          Issues
        </button>
        <button type="button" className={tab === "console" ? "is-on" : ""} onClick={() => setTab("console")}>
          Console
        </button>
      </div>
      {tab === "wave" && workspace !== "wave" && <Waveform />}
      {tab === "issues" && <DebugList compact />}
      {(tab === "console" || (tab === "wave" && workspace === "wave")) && <Console />}
    </div>
  );
}

function DebugList({ compact = false }: { compact?: boolean }) {
  const rev = useLab((s) => s.rev);
  const showInfo = useLab((s) => s.showInfoIssues);
  void rev;
  const issues = useLab.getState().sim.issues.filter((i) => showInfo || i.level !== "info");
  return (
    <div className={"lm-debug" + (compact ? " is-compact" : "")}>
      <div className="lm-debug-head">
        <h2>Debugger</h2>
        <label>
          <input type="checkbox" checked={showInfo} onChange={(e) => useLab.getState().setShowInfo(e.target.checked)} />
          Show notes
        </label>
      </div>
      {issues.length === 0 ? (
        <p>No warnings. Unconnected inputs, driver fights, and combinational loops show up here.</p>
      ) : (
        <ul>
          {issues.map((issue, i) => (
            <li key={i} className={"is-" + issue.level}>
              <button
                type="button"
                onClick={() => {
                  if (issue.compId) useLab.getState().focus(issue.compId);
                }}
              >
                <strong>{issue.level}</strong>
                {issue.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Console() {
  const rev = useLab((s) => s.rev);
  void rev;
  const events = useLab.getState().sim.events;
  return (
    <ol className="lm-console">
      {events.length === 0 && <li>Simulation events appear here.</li>}
      {events.slice(-12).map((e, i) => (
        <li key={i}>
          <span>t={e.t}</span> {e.msg}
        </li>
      ))}
    </ol>
  );
}

function Help() {
  const open = useLab((s) => s.showHelp);
  if (!open) return null;
  return (
    <div className="lm-modal" onClick={() => useLab.getState().setHelp(false)}>
      <div className="lm-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>How to use the bench</h2>
        <ul>
          <li>Click a part, then click the canvas. Drag a pin to another pin to wire them. Widths must match.</li>
          <li>Click a switch to toggle it. The change settles immediately, even while paused.</li>
          <li>Run advances every clock. Step is one tick. Reset clears registers and reloads memory images.</li>
          <li>Watch a pin to plot it. Analysis enumerates switches and probes by simulating the real netlist.</li>
          <li>The CPU sheet is built from the same parts: bus, registers, ALU, RAM, and a microcoded control unit.</li>
        </ul>
        <h3>Shortcuts</h3>
        <p className="mono">Delete · R rotate · M mirror · arrows nudge · Ctrl+Z / Y · Ctrl+C / V / D · Ctrl+S version · ? help · Esc cancel · wheel zoom · drag empty to marquee · Space+drag pans</p>
        <button type="button" className="lm-btn is-primary" onClick={() => useLab.getState().setHelp(false)}>
          Close
        </button>
      </div>
    </div>
  );
}

function Logo() {
  return (
    <svg className="lm-logo" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="6" fill="#121820" stroke="#3d9eff" />
      <path d="M7 9h8c5 0 8 3 8 7s-3 7-8 7H7V9z" fill="none" stroke="#2fce7a" strokeWidth="1.6" />
      <circle cx="24" cy="16" r="2" fill="#3d9eff" />
    </svg>
  );
}

function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return narrow;
}
