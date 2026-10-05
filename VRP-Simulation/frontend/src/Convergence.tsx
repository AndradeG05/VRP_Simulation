import { useEffect, useRef, useState } from "react";
import type { Checkpoint, Sample } from "./types";
import type * as PlotlyType from "plotly.js";

let plotly: Promise<typeof PlotlyType> | undefined;
const loadPlotly = () =>
  (plotly ??= import("plotly.js-basic-dist-min").then((m) => m.default));

export default function Convergence({
  samples,
  checkpoints,
  baseline,
  selected,
  unit = "u.d.",
}: {
  unit?: string;
  samples: Sample[];
  checkpoints: Checkpoint[];
  baseline: number | null;
  selected: Checkpoint | undefined;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    let disposed = false;
    let observer: ResizeObserver | undefined;
    void loadPlotly()
      .then((Plotly) => {
        if (disposed) return;
        const css = getComputedStyle(document.documentElement);
        const theme = (name: string) =>
          css.getPropertyValue(`--${name}`).trim();
        const x = samples.map((s) => s.elapsed);
        const initial = checkpoints.find((c) => c.reason === "initial");
        const initialCost = initial?.solution.cost_ticks ?? null;
        const end = Math.max(...x, 1);
        const traces: PlotlyType.Data[] = [
          {
            x: baseline == null ? [] : [0, end],
            y: baseline == null ? [] : [baseline / 1000, baseline / 1000],
            name: "Baseline",
            mode: "lines",
            line: { color: theme("warning"), dash: "dash", width: 1.3 },
            hovertemplate: `%{y:.2f} ${unit}<extra>Baseline</extra>`,
          },
          {
            x,
            y: samples.map((s) =>
              s.current_cost_ticks == null ? null : s.current_cost_ticks / 1000,
            ),
            name: "Atual viável",
            mode: "lines",
            line: { color: theme("muted"), width: 1 },
            connectgaps: false,
            hovertemplate: `Tempo %{x:.3f} s<br>%{y:.2f} ${unit}<extra>Atual viável</extra>`,
          },
          {
            x: initial ? [0, ...x] : x,
            y: [
              ...(initial ? [initialCost! / 1000] : []),
              ...samples.map((s) =>
                s.best_cost_ticks == null ? null : s.best_cost_ticks / 1000,
              ),
            ],
            name: "Melhor viável",
            mode: "lines",
            line: { color: theme("accent"), width: 2.2, shape: "hv" },
            connectgaps: false,
            hovertemplate: `Tempo %{x:.3f} s<br>%{y:.2f} ${unit}<extra>Melhor viável</extra>`,
          },
        ];
        const layout: Partial<PlotlyType.Layout> = {
          autosize: true,
          height: 200,
          margin: { l: 48, r: 16, t: 12, b: 36 },
          paper_bgcolor: "transparent",
          plot_bgcolor: "transparent",
          showlegend: false,
          font: {
            family: "Montserrat, Arial, sans-serif",
            size: 10,
            color: theme("muted"),
          },
          xaxis: {
            title: { text: "Tempo de busca (s)", font: { size: 9 } },
            gridcolor: theme("line"),
            zeroline: false,
            range: [0, end],
          },
          yaxis: {
            ticksuffix: " " + unit,
            gridcolor: theme("line"),
            zeroline: false,
          },
          hovermode: "x unified",
          hoverlabel: { bgcolor: theme("panel"), bordercolor: theme("line") },
          shapes: selected
            ? [
                {
                  type: "line",
                  x0: selected.elapsed,
                  x1: selected.elapsed,
                  yref: "paper",
                  y0: 0,
                  y1: 1,
                  line: { color: theme("ink"), width: 1, dash: "dot" },
                },
              ]
            : [],
        };
        void Plotly.react(node, traces, layout, {
          responsive: false,
          displayModeBar: false,
          locale: "pt-BR",
        }).catch(() => setError(true));
        observer = new ResizeObserver(() => {
          if (
            disposed ||
            !node.isConnected ||
            !node.clientWidth ||
            !node.clientHeight
          )
            return;
          void Promise.resolve(Plotly.Plots.resize(node)).catch(() => {
            if (
              !disposed &&
              node.isConnected &&
              node.clientWidth &&
              node.clientHeight
            )
              setError(true);
          });
        });
        observer.observe(node);
      })
      .catch(() => setError(true));
    return () => {
      disposed = true;
      observer?.disconnect();
    };
  }, [samples, checkpoints, baseline, selected, unit]);
  useEffect(() => {
    const node = container.current;
    return () => {
      if (node && plotly) void plotly.then((p) => p.purge(node));
    };
  }, []);
  return (
    <div className="chart-body">
      <div ref={container} className="plotly-chart" />
      {!samples.length && (
        <div className="chart-empty">
          Execute o solver para observar a convergência.
        </div>
      )}
      {error && (
        <div className="chart-empty">
          Não foi possível carregar o gráfico. Os dados estão disponíveis na
          exportação.
        </div>
      )}
    </div>
  );
}
