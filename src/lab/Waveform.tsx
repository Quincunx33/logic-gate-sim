import { useEffect, useRef, useState } from "react";
import { useLab } from "@/lab/store";

const COLORS = ["#3d9eff", "#2fce7a", "#f59e0b", "#d7e0ea", "#7eb6ff", "#f05252"];

export function Waveform({ tall = false }: { tall?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const watches = useLab((s) => s.watches);
  const rev = useLab((s) => s.rev);
  const [cursor, setCursor] = useState<number | null>(null);
  const [span, setSpan] = useState(160);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const draw = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.floor(r.width * dpr));
      canvas.height = Math.max(1, Math.floor(r.height * dpr));
      canvas.style.width = r.width + "px";
      canvas.style.height = r.height + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = r.width;
      const h = r.height;
      ctx.fillStyle = "#10161e";
      ctx.fillRect(0, 0, w, h);
      const samples = useLab.getState().samples;
      const list = useLab.getState().watches;
      if (list.length === 0) {
        ctx.fillStyle = "#8b9bb0";
        ctx.font = "13px Inter, system-ui, sans-serif";
        ctx.fillText("Select a pin in the inspector and choose Watch to plot it here.", 16, 28);
        return;
      }
      const labelW = 112;
      const rowH = Math.max(28, Math.min(48, (h - 22) / list.length));
      const view = samples.slice(-span);
      ctx.font = "11px 'JetBrains Mono', ui-monospace, monospace";
      list.forEach((watch, i) => {
        const y = 8 + i * rowH;
        ctx.fillStyle = i % 2 ? "rgba(255,255,255,0.02)" : "transparent";
        ctx.fillRect(0, y, w, rowH);
        ctx.fillStyle = "#8b9bb0";
        ctx.textAlign = "left";
        ctx.fillText(watch.label.slice(0, 14), 8, y + rowH / 2 + 4);
        const color = COLORS[i % COLORS.length]!;
        const plotX = (index: number) => labelW + ((w - labelW - 12) * index) / Math.max(1, view.length - 1);
        ctx.beginPath();
        let started = false;
        view.forEach((sample, si) => {
          const text = sample.vals[watch.key] ?? "";
          const high = text.includes("1");
          const unknown = text.includes("X");
          const z = text.length > 0 && !text.includes("0") && !text.includes("1") && text.includes("Z");
          const level = unknown || z ? 0.5 : high ? 0 : 1;
          const py = y + 6 + level * (rowH - 14);
          const px = plotX(si);
          if (!started) {
            ctx.moveTo(px, py);
            started = true;
          } else ctx.lineTo(px, py);
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      });
      if (cursor !== null && view.length) {
        const i = Math.max(0, Math.min(view.length - 1, cursor));
        const x = 112 + ((w - 124) * i) / Math.max(1, view.length - 1);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.strokeStyle = "rgba(215,224,234,0.45)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.fillStyle = "#8b9bb0";
      ctx.font = "11px 'JetBrains Mono', ui-monospace, monospace";
      ctx.textAlign = "right";
      const last = view[view.length - 1];
      ctx.fillText(last ? "t=" + last.t : "t=0", w - 8, h - 6);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    let raf = 0;
    const loop = () => {
      if (useLab.getState().running) draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [watches, rev, cursor, span, tall]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const samples = useLab.getState().samples.slice(-span);
    const labelW = 112;
    const t = (x - labelW) / Math.max(1, rect.width - labelW - 12);
    setCursor(Math.round(t * Math.max(0, samples.length - 1)));
  };

  const sample = (() => {
    const samples = useLab.getState().samples.slice(-span);
    if (cursor === null || samples.length === 0) return samples[samples.length - 1];
    return samples[Math.max(0, Math.min(samples.length - 1, cursor))];
  })();

  return (
    <div className={"lm-wave" + (tall ? " is-tall" : "")}>
      <div className="lm-wave-bar">
        <span>Waveform</span>
        <label>
          Span
          <input type="range" min={32} max={720} value={span} onChange={(e) => setSpan(Number(e.target.value))} />
        </label>
        <button type="button" onClick={() => useLab.getState().clearSamples()}>
          Clear
        </button>
        <button type="button" onClick={() => exportCsv()}>
          Export CSV
        </button>
      </div>
      <div ref={wrapRef} className="lm-wave-canvas">
        <canvas ref={canvasRef} onClick={onClick} />
      </div>
      {sample && (
        <div className="lm-wave-readout">
          <span>t={sample.t}</span>
          {watches.map((w) => (
            <span key={w.key}>
              {w.label} {sample.vals[w.key] ?? "—"}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function exportCsv() {
  const { samples, watches } = useLab.getState();
  const header = ["t", ...watches.map((w) => w.label)].join(",");
  const lines = samples.map((s) => [s.t, ...watches.map((w) => s.vals[w.key] ?? "")].join(","));
  const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "logicmatter-waveform.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}
