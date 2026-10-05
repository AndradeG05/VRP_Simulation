import { ArrowRight, Check, Route } from "../carbon/icons";
import { distance } from "../api";
import type { Solution } from "../types";

export type PreparationPhase = "matrix" | "baseline" | "start";
type Phase = PreparationPhase | "queued" | "running";

const phaseLabels: Record<Phase, string> = {
  matrix: "Consultando distâncias pelas ruas no OSRM…",
  baseline: "Validando cenário e construindo baseline…",
  start: "Enviando cenário para otimização…",
  queued: "Cenário na fila para otimização…",
  running: "Buscando sequências de entrega…",
};

export function RunProgress({ phase }: { phase: Phase }) {
  const current = phase === "matrix" ? 0 : phase === "baseline" ? 1 : 2;
  return (
    <div className="geo-run-progress">
      <ol aria-hidden="true">
        {["Ruas", "Baseline", "Busca"].map((label, index) => (
          <li
            key={label}
            className={index < current ? "done" : index === current ? "current" : ""}
          >
            <span>{index < current && <Check size={10} strokeWidth={3} />}</span>
            {label}
          </li>
        ))}
      </ol>
      <p role="status">{phaseLabels[phase]}</p>
    </div>
  );
}

export function RunCompletion({
  solution,
  baseline,
  imported,
  animate,
  onCompare,
}: {
  solution: Solution;
  baseline: Solution | null;
  imported: boolean;
  animate: boolean;
  onCompare: () => void;
}) {
  const comparable = baseline?.feasible && Number.isFinite(baseline.cost_ticks);
  const saved = comparable ? baseline.cost_ticks - solution.cost_ticks : null;
  const improved = saved != null && saved > 0;
  return (
    <div
      className={`geo-run-completion ${improved ? "improved" : ""} ${animate ? "just-completed" : ""}`}
    >
      <div className="geo-completion-heading">
        <Route size={20} aria-hidden="true" />
        <h2>{imported ? "Resultado do replay" : improved ? "Rotas refinadas" : "Busca concluída"}</h2>
        <svg className="geo-completion-check" width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="9" stroke="currentColor" strokeWidth="1.5" />
          <path d="m6.5 11 3 3 6-6" pathLength="1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <p role="status">
        {improved
          ? <>Redução de <strong>{distance(saved)} m</strong> no custo otimizado.</>
          : comparable
            ? "Nenhuma redução encontrada neste orçamento de busca."
            : "Solução viável disponível para explorar no mapa."}
      </p>
      <small>Não há prova de ótimo nesta execução.</small>
      {comparable && (
        <button className="geo-completion-compare" onClick={onCompare}>
          Comparar as rotas <ArrowRight size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
