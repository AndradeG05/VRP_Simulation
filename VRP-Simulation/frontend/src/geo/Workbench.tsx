import { useEffect, useRef, useState, type ReactNode } from "react";
import { Header } from "../carbon/components";
import { ArrowUpRight, Check, CircleHelp, ClipboardList, FlaskConical, ChartNoAxesCombined, Pause, Play, Route, Settings2, SkipBack } from "../carbon/icons";
import { improvement } from "../api";
import { colours } from "../RouteMap";
import { routeDifference } from "../differences";
import { vehicleCapacity, type Checkpoint, type Run, type Sample, type Solution } from "../types";
import type { GeoDraft, GeographicInstance } from "./model";
import type { PreparationPhase } from "./RunFeedback";

export const kilometres = (ticks: number | null | undefined) => ticks == null ? "—" : (ticks / 1_000_000).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const decimal = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
export type WorkspacePage = "instance" | "optimization" | "compare" | "replay" | "settings";

export function WorkspaceNavigation({ page, onNavigate, onSynthetic, onHelp, locked }: {
  page: WorkspacePage; onNavigate: (page: WorkspacePage) => void;
  onSynthetic: () => void; onHelp: () => void; locked: boolean;
}) {
  const navigation = [
    ["instance", ClipboardList, "Planejamento"],
    ["replay", ChartNoAxesCombined, "Análise"],
  ] as const;
  return <Header className="wb-navigation" aria-label="Navegação principal">
    <a className="rs-skip-link" href="#route-workspace">Ir para o espaço de trabalho</a>
    <div className="wb-brand">
      <Route size={26} strokeWidth={2} /><strong>VRP Simulation</strong>
    </div>
    <nav aria-label="Espaço de trabalho">
      {navigation.map(([id, Icon, title]) => {
        const selected = id === "instance" ? page === "instance" || page === "settings" : ["optimization", "compare", "replay"].includes(page);
        return <button key={id} aria-current={selected ? "page" : undefined} onClick={() => onNavigate(id)}>
          <Icon size={18} /><span>{title}</span>
        </button>;
      })}
      <button disabled={locked} onClick={onSynthetic}><FlaskConical size={18} /><span>Laboratório</span></button>
    </nav>
    <div className="wb-navigation-bottom">
      <details className="wb-tools"><summary aria-label="Ferramentas"><Settings2 size={18} /><span>Ferramentas</span></summary><div>
        <button aria-label="Configurações e histórico" onClick={() => onNavigate("settings")}><Settings2 size={18} /><span>Configurações e histórico</span></button>
      </div></details>
      <button aria-label="Ajuda" title="Ajuda" onClick={onHelp}><CircleHelp size={19} /><span>Ajuda</span></button>
    </div>
  </Header>;
}

export function RunStages({ phase, draft, baseline, run, loaded, total, roadBusy, networkError }: {
  phase: PreparationPhase | null; draft: GeoDraft; baseline: Solution | null;
  run: Run<GeographicInstance> | null; loaded: number; total: number; roadBusy: boolean; networkError: boolean;
}) {
  const active = !!run && ["queued", "running"].includes(run.status);
  const completed = run?.status === "completed";
  const steps = [
    { title: "Distâncias viárias", detail: draft.road_matrix ? `${draft.clients.length + 1} × ${draft.clients.length + 1} pontos · ${draft.road_matrix.provider === "osrm" ? "OSRM" : "histórico Google"}` : "Aguardando cálculo", done: !!draft.road_matrix, current: phase === "matrix" },
    { title: "Primeira rota", detail: baseline ? baseline.feasible ? "Baseline viável disponível" : "Confira a capacidade da frota" : "Construção da baseline", done: !!baseline?.feasible, current: phase === "baseline" },
    { title: "Melhorando a solução", detail: networkError ? "Conexão interrompida" : active ? run.status === "queued" ? "Aguardando o solver" : "Busca em andamento" : completed ? "Busca concluída" : run ? ({ failed: "Falha na execução", cancelled: "Busca cancelada", no_solution: "Sem solução encontrada", interrupted: "Busca interrompida" } as Record<string, string>)[run.status] : "Aguardando otimização", done: completed, current: !networkError && (active || phase === "start") },
    { title: "Traçado no mapa", detail: total ? `${loaded}/${total} sequências carregadas` : "Preparação da visualização", done: !active && total > 0 && loaded === total, current: !active && roadBusy },
  ];
  return <section className="wb-stages" aria-label="Etapas da otimização">
    <ol>{steps.map((step, i) => <li key={step.title} className={step.done ? "complete" : step.current ? "current" : ""} aria-current={step.current ? "step" : undefined}>
      <span className="wb-step-symbol">{step.done ? <Check size={17} strokeWidth={2.5} /> : i + 1}</span>
      <div><span className="wb-step-track" /><strong>{step.title}</strong><small>{step.detail}</small></div>
    </li>)}</ol>
    <p><span className={`wb-state-dot ${active ? "active" : ""}`} />{active ? "Acompanhe as soluções observadas enquanto o solver explora as sequências de entrega." : completed ? "Resultado disponível. Compare as rotas ou explore os estados registrados da busca." : "Defina o depósito e as entregas, configure a frota e inicie a otimização."}</p>
  </section>;
}

function SearchChart({ samples, baseline, checkpoints }: { samples: Sample[]; baseline: Solution | null; checkpoints: Checkpoint[] }) {
  const values = samples.filter(s => s.best_cost_ticks != null).map(s => ({ x: s.elapsed, y: s.best_cost_ticks! / 1_000_000 }));
  if (!values.length) return <div className="wb-chart-empty"><Route size={24} /><p>A evolução da distância aparece aqui durante a busca.</p></div>;
  const initial = checkpoints.find(c => c.reason === "initial");
  if (initial) values.unshift({ x: 0, y: initial.solution.cost_ticks / 1_000_000 });
  const base = baseline?.feasible ? baseline.cost_ticks / 1_000_000 : null;
  const costs = values.map(v => v.y);
  if (base != null) costs.push(base);
  const low = Math.min(...costs), high = Math.max(...costs), padding = Math.max((high - low) * .25, high * .035, .01);
  const min = Math.max(0, low - padding), max = high + padding;
  const end = Math.max(values[values.length - 1].x, .001);
  const x = (value: number) => 45 + value / end * 300;
  const y = (value: number) => 154 - (value - min) / (max - min) * 126;
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(v.x).toFixed(2)},${y(v.y).toFixed(2)}`).join(" ");
  const last = values[values.length - 1];
  return <svg className="wb-search-chart" viewBox="0 0 365 191" role="img" aria-label={`Convergência da distância. Último melhor custo: ${decimal(last.y)} quilômetros, aos ${decimal(last.x)} segundos.`}>
    {[0, 1, 2, 3].map(i => { const value = min + (max - min) * i / 3; return <g key={i}><line x1="45" x2="345" y1={y(value)} y2={y(value)} className="wb-chart-grid" /><text x="37" y={y(value) + 3} textAnchor="end">{decimal(value)}</text></g>; })}
    {[0, 1, 2, 3, 4].map(i => <text key={i} x={x(end * i / 4)} y="172" textAnchor="middle">{decimal(end * i / 4)}</text>)}
    <text x="45" y="13">km</text><text x="345" y="188" textAnchor="end">Tempo de busca (s)</text>
    {base != null && <line x1="45" x2="345" y1={y(base)} y2={y(base)} className="wb-chart-baseline" />}
    <path d={`${line} L${x(last.x)},154 L45,154 Z`} className="wb-chart-fill" />
    <path d={line} className="wb-chart-best" /><circle cx={x(last.x)} cy={y(last.y)} r="4" className="wb-chart-end" />
  </svg>;
}

export function ResultsOverview({ baseline, best, run, samples, checkpoints, onDetails, onPrepare }: {
  baseline: Solution | null; best: Solution | null; run: Run<GeographicInstance> | null;
  samples: Sample[]; checkpoints: Checkpoint[]; onDetails: () => void; onPrepare: () => void;
}) {
  const isFirstRun = !run && !baseline && !best;
  if (isFirstRun) return <aside className="wb-results wb-results-empty" aria-label="Análise do cenário">
    <div className="wb-setup-intro">
      <ChartNoAxesCombined size={28} />
      <h2>Entenda cada solução</h2>
      <p>Depois de otimizar, compare a distância das rotas e acompanhe os estados registrados pelo algoritmo.</p>
    </div>
    <button className="wb-setup-action" onClick={onPrepare}>Abrir planejamento<ArrowUpRight size={15} /></button>
  </aside>;
  const percent = improvement(baseline?.feasible ? baseline.cost_ticks : null, best?.feasible ? best.cost_ticks : null);
  const sample = samples[samples.length - 1];
  const count = run?.result?.iterations ?? run?.result?.observed_solutions ?? sample?.iteration ?? sample?.observed;
  const elapsed = run?.result?.solver_runtime ?? sample?.elapsed;
  const lastImprovement = checkpoints.filter(c => c.reason === "improvement").at(-1);
  return <aside className="wb-results" aria-label="Resumo da otimização">
    <div className="wb-results-heading"><h2>Resultados da otimização</h2>{percent != null && <div className={`wb-reduction ${percent > 0 ? "positive" : ""}`}><strong>{percent > 0 ? "−" : percent < 0 ? "+" : ""}{decimal(Math.abs(percent))}%</strong><small>{percent < 0 ? "de aumento" : "de redução"}</small></div>}</div>
    <div className="wb-comparison">
      {([{ name: "Rota inicial", solution: baseline }, { name: "Melhor solução", solution: best }] as const).map(({ name, solution }, i) => <section key={name} className={i ? "wb-best" : ""}>
        <h3>{name}</h3><dl>
          <dt>Distância total</dt><dd className="wb-distance">{kilometres(solution?.cost_ticks)} <small>km</small></dd>
        </dl>
      </section>)}
    </div>
    <details className="wb-analysis-details"><summary>Desempenho do algoritmo</summary>
    <div className="wb-run-stats">
      <div><small>Veículos utilizados</small><strong>{best ? best.routes.filter(r => r.visits.length).length : "—"}</strong></div>
      <div><small>Entregas atendidas</small><strong>{best?.served ?? "—"}</strong></div>
      <div><small>{run?.request.config.adapter === "pyvrp" ? "Iterações" : "Soluções observadas"}</small><strong>{count?.toLocaleString("pt-BR") ?? "—"}</strong></div>
      <div><small>Tempo de busca</small><strong>{elapsed == null ? "—" : `${decimal(elapsed)} s`}</strong></div>
      <div><small>Última melhora</small><strong>{lastImprovement ? `${decimal(lastImprovement.elapsed)} s` : "—"}</strong></div>
    </div>
    <section className="wb-convergence"><h3>Convergência da solução</h3><div className="wb-chart-legend"><span><i />Melhor custo (km)</span><span><i />Baseline (km)</span></div><SearchChart samples={samples} baseline={baseline} checkpoints={checkpoints} /></section>
    </details>
    <div className="wb-results-foot">
      {run ? <><span className={`wb-state-dot ${run.status === "completed" ? "active" : ""}`} /><span>{run.status === "completed" ? "Busca concluída" : run.status === "running" ? "Busca em andamento" : run.status === "queued" ? "Na fila de execução" : "Execução encerrada"}</span><button onClick={onDetails}>Ver detalhes <ArrowUpRight size={14} /></button></> : <span>Defina o depósito e as entregas no mapa para começar.</span>}
    </div>
  </aside>;
}

export function SearchReplay({ checkpoints, index, onSeek, active, solution, baseline, draft, selectedVehicle, onVehicle, showChanges, onChanges, children }: {
  checkpoints: Checkpoint[]; index: number; onSeek: (index: number) => void; active: boolean;
  solution: Solution | null; baseline: Solution | null; draft: GeoDraft; selectedVehicle: number | null;
  onVehicle: (vehicle: number | null) => void; showChanges: boolean; onChanges: (value: boolean) => void; children: ReactNode;
}) {
  const [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1);
  const latest = useRef({ index, onSeek });
  latest.current = { index, onSeek };
  useEffect(() => {
    if (!playing || active) return;
    const timer = window.setInterval(() => {
      if (latest.current.index >= checkpoints.length - 1) setPlaying(false);
      else latest.current.onSeek(latest.current.index + 1);
    }, 900 / speed);
    return () => window.clearInterval(timer);
  }, [playing, active, checkpoints.length, speed]);
  useEffect(() => { setPlaying(false); }, [active, draft]);
  const selected = checkpoints[index];
  const diff = routeDifference(baseline, solution);
  return <section className="wb-replay" aria-label="Reprodução da busca">
    <div className="wb-replay-heading"><h2>Reprodução da busca</h2><span>{selected ? `Estado ${index + 1} de ${checkpoints.length} · ${decimal(selected.elapsed)} s de busca` : "Os estados serão registrados durante a otimização"}</span></div>
    <div className="wb-timeline">
      <button className="wb-play" aria-label={playing ? "Pausar estados da busca" : "Reproduzir estados da busca"} disabled={active || checkpoints.length < 2} onClick={() => { if (index >= checkpoints.length - 1) onSeek(0); setPlaying(!playing); }}>{playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button>
      <button aria-label="Primeiro estado da busca" disabled={!checkpoints.length} onClick={() => { setPlaying(false); onSeek(0); }}><SkipBack size={16} /></button>
      <select aria-label="Velocidade dos estados da busca" value={speed} onChange={e => setSpeed(+e.target.value)}>{[1, 2, 4].map(v => <option key={v} value={v}>{v}×</option>)}</select>
      <input aria-label="Estado da busca" type="range" min={0} max={Math.max(0, checkpoints.length - 1)} value={Math.max(0, index)} disabled={!checkpoints.length} onChange={e => { setPlaying(false); onSeek(+e.target.value); }} />
    </div>
    <div className="wb-replay-data">
      <section className="wb-route-list"><h3>Rotas <span>· solução exibida</span></h3><div className="wb-table-scroll"><table><thead><tr><th>Rota</th><th>Clientes</th><th>Distância</th><th>Carga / cap.</th></tr></thead><tbody>{solution?.routes.map(r => <tr key={r.vehicle} aria-selected={selectedVehicle === r.vehicle}><td><button onClick={() => onVehicle(selectedVehicle === r.vehicle ? null : r.vehicle)} aria-label={`Selecionar rota ${r.vehicle}`}><i style={{ background: colours[(r.vehicle - 1) % colours.length] }} />{r.vehicle}</button></td><td>{r.visits.length}</td><td>{kilometres(r.cost_ticks)} km</td><td>{r.load} / {vehicleCapacity(draft, r.vehicle)}</td></tr>)}</tbody></table>{!solution && <p className="wb-empty-copy">As rotas aparecem após o cálculo da baseline.</p>}</div></section>
      <section className="wb-snapshot"><h3>Resumo do estado {selected ? index + 1 : ""}</h3><dl><dt>Distância exibida</dt><dd>{kilometres(solution?.cost_ticks)} km</dd><dt>Diferença vs baseline</dt><dd className={diff.delta != null && diff.delta < 0 ? "wb-positive" : ""}>{diff.delta == null ? "—" : `${diff.delta > 0 ? "+" : ""}${kilometres(diff.delta)} km`}</dd><dt>Clientes realocados</dt><dd>{baseline && solution ? diff.transferred.length : "—"}</dd><dt>Registro</dt><dd>{selected ? ({ initial: "Solução inicial", improvement: "Melhoria encontrada", observed: "Solução observada", final: "Estado final" })[selected.reason] : "Aguardando busca"}</dd></dl></section>
      <section className="wb-differences"><h3>Alterações em relação à baseline</h3><p><i className="added" />Trechos adicionados <b>{baseline && solution ? diff.added.length : "—"}</b></p><p><i className="removed" />Trechos removidos <b>{baseline && solution ? diff.removed.length : "—"}</b></p><label><input type="checkbox" checked={showChanges} disabled={!baseline || !solution} onChange={e => onChanges(e.target.checked)} />Destacar alterações no mapa</label></section>
    </div>
    {children && <details className="wb-simulation"><summary>Simular os veículos no mapa</summary>{children}</details>}
  </section>;
}
