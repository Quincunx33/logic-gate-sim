import { useLab } from "@/lab/store";

export function AnalysisView() {
  const analysis = useLab((s) => s.analysis);
  const rev = useLab((s) => s.rev);
  void rev;
  if (!analysis) {
    return (
      <div className="lm-analysis">
        <p>Analysis reads the schematic you have now and simulates every input combination.</p>
        <button type="button" className="lm-btn is-primary" onClick={() => useLab.getState().runAnalysis()}>
          Analyze circuit
        </button>
      </div>
    );
  }
  const truth = analysis.truth;
  return (
    <div className="lm-analysis">
      <div className="lm-analysis-head">
        <div>
          <h2>Circuit analysis</h2>
          <p>{truth?.note ?? "Add a probe or LED if you want a truth table."}</p>
        </div>
        <button type="button" className="lm-btn" onClick={() => useLab.getState().runAnalysis()}>
          Recompute
        </button>
      </div>
      <section>
        <h3>How this circuit produces its outputs</h3>
        <ol className="lm-explain">
          {analysis.explanation.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
      </section>
      {truth && truth.rows.length > 0 && (
        <section>
          <h3>Truth table</h3>
          <div className="lm-table-wrap">
            <table className="lm-table">
              <thead>
                <tr>
                  {truth.inputs.map((c) => (
                    <th key={c.id}>{c.label}</th>
                  ))}
                  {truth.outputs.map((c) => (
                    <th key={c.id}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {truth.rows.map((row, i) => (
                  <tr key={i}>
                    {row.in.map((v, j) => (
                      <td key={"i" + j} className={v === "1" ? "is-high" : "is-low"}>
                        {v}
                      </td>
                    ))}
                    {row.out.map((v, j) => (
                      <td key={"o" + j} className={v === "1" ? "is-high" : v === "0" ? "is-low" : "is-x"}>
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {analysis.expressions.length > 0 && (
        <section>
          <h3>Boolean expressions</h3>
          <ul className="lm-expr">
            {analysis.expressions.map((e) => (
              <li key={e.output}>
                <strong>{e.output}</strong>
                <span>From gates: {e.structural ?? "not a pure gate cone"}</span>
                <span>Sum of products: {e.simplified ?? "—"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {analysis.kmap && (
        <section>
          <h3>Karnaugh map — {analysis.kmap.output}</h3>
          <div className="lm-kmap">
            <table>
              <thead>
                <tr>
                  <th />
                  {analysis.kmap.colLabels.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {analysis.kmap.cells.map((row, i) => (
                  <tr key={analysis.kmap!.rowLabels[i]}>
                    <th>{analysis.kmap!.rowLabels[i]}</th>
                    {row.map((cell, j) => (
                      <td key={j} className={cell === "1" ? "is-high" : cell === "0" ? "is-low" : "is-x"}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section>
        <h3>Signal flow</h3>
        {analysis.cycles.length > 0 && (
          <p className="lm-warn">Feedback: {analysis.cycles.join(" · ")}</p>
        )}
        {analysis.flow.length === 0 ? (
          <p>No connections yet.</p>
        ) : (
          <ul className="lm-flow">
            {analysis.flow.map((e) => (
              <li key={e.from + e.to}>
                {e.from} <span>→</span> {e.to}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3>Connections</h3>
        <div className="lm-table-wrap">
          <table className="lm-table">
            <thead>
              <tr>
                <th>Wire</th>
                <th>From</th>
                <th>To</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {analysis.connections.map((c) => (
                <tr key={c.wire}>
                  <td>{c.wire}</td>
                  <td>{c.a}</td>
                  <td>{c.b}</td>
                  <td className="mono">{c.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
