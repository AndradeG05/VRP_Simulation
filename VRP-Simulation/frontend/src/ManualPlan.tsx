import { vehicleCapacity } from "./types";
import { useEffect, useRef, useState } from "react";
import { Check, Plus, Trash2, X } from "./carbon/icons";
import { api, distance } from "./api";
import type { Instance, Solution } from "./types";
export default function ManualPlan({
  instance,
  baseline,
  onUse,
  onClose,
  locked,
}: {
  locked: boolean;
  instance: Instance;
  baseline: Solution | null;
  onUse: (solution: Solution) => void;
  onClose: () => void;
}) {
  const [routes, setRoutes] = useState<number[][]>(() =>
    Array.from(
      { length: instance.vehicles },
      (_, i) => baseline?.routes.find((r) => r.vehicle === i + 1)?.visits ?? [],
    ),
  );
  const [vehicle, setVehicle] = useState(0),
    [audit, setAudit] = useState<Solution | null>(null),
    [error, setError] = useState("");
  const [validating, setValidating] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const assigned = new Set(routes.flat()),
    unassigned = instance.clients.filter((c) => !assigned.has(c.id));
  const change = (next: number[][]) => {
    setRoutes(next);
    setAudit(null);
    setError("");
  };
  async function validate() {
    if (locked || validating) return;
    const controller = new AbortController();
    request.current = controller;
    setValidating(true);
    setAudit(null);
    setError("");
    try {
      const result = await api<Solution>(
        "/plans/validate",
        { instance, routes },
        controller.signal,
      );
      if (!controller.signal.aborted) setAudit(result);
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setValidating(false);
    }
  }
  return (
    <section className="manual-panel">
      <div className="section-title">
        <span>Minha rota versus busca</span>
        <button aria-label="Fechar plano manual" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <p role="status" className="field-hint">
        {validating ? "Validando cobertura, capacidade e custo do plano…" : ""}
      </p>
      <fieldset disabled={locked || validating}>
        <p>
          Escolha um veículo e clique nos clientes para definir a ordem. O plano
          só vira baseline após validar cobertura, capacidade e frota.
        </p>
        <div className="manual-tools">
          <select
            aria-label="Veículo do plano manual"
            value={vehicle}
            onChange={(e) => setVehicle(Number(e.target.value))}
          >
            {routes.map((_, i) => (
              <option value={i} key={i}>
                Veículo {i + 1}
              </option>
            ))}
          </select>
          <button
            className="button"
            onClick={() =>
              change(Array.from({ length: instance.vehicles }, () => []))
            }
          >
            <Trash2 size={12} />
            Limpar plano
          </button>
          <button className="button" onClick={() => void validate()}>
            <Check size={13} />
            {validating ? "Validando plano…" : "Validar plano"}
          </button>
        </div>
        <div className="manual-route">
          <b>Depósito</b>
          {routes[vehicle].map((id, index) => (
            <span key={id}>
              <button
                aria-label={"Mover C" + id + " antes"}
                disabled={!index}
                onClick={() => {
                  const next = routes.map((r) => [...r]);
                  [next[vehicle][index - 1], next[vehicle][index]] = [
                    next[vehicle][index],
                    next[vehicle][index - 1],
                  ];
                  change(next);
                }}
              >
                ←
              </button>
              <button
                title="Remover da rota"
                onClick={() =>
                  change(
                    routes.map((r, i) =>
                      i === vehicle ? r.filter((n) => n !== id) : r,
                    ),
                  )
                }
              >
                C{id} ×
              </button>
            </span>
          ))}
          <b>Depósito</b>
        </div>
        <div className="execution-stats">
          <span>
            Carga planejada
            <b>
              {routes[vehicle].reduce(
                (s, id) => s + instance.clients[id - 1].demand,
                0,
              )}{" "}
              / {vehicleCapacity(instance, vehicle + 1)}
            </b>
          </span>
        </div>
        <p>Clientes sem rota: {unassigned.length}</p>
        <div className="manual-clients">
          {unassigned.map((c) => (
            <button
              key={c.id}
              onClick={() =>
                change(routes.map((r, i) => (i === vehicle ? [...r, c.id] : r)))
              }
            >
              <Plus size={10} /> C{c.id} <small>{c.demand} un.</small>
            </button>
          ))}
        </div>
        {audit && (
          <div
            role={audit.feasible ? "status" : "alert"}
            className={audit.feasible ? "plan-valid" : "capacity-warning"}
          >
            {audit.feasible ? (
              <>
                <span>
                  Plano viável · {distance(audit.cost_ticks)} unidades de
                  distância.
                </span>
                <button
                  className="button"
                  onClick={() => onUse({ ...audit, origin: "manual" })}
                >
                  Usar meu plano como baseline
                </button>
              </>
            ) : (
              audit.errors.join(" ")
            )}
          </div>
        )}
        {error && <p role="alert">{error}</p>}
      </fieldset>
    </section>
  );
}
