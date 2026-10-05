import { vehicleCapacity } from "./types";
import { useMemo } from "react";
import { ArrowRight, Crosshair, Truck, X } from "./carbon/icons";
import { graphNodeId } from "./graphPlane";
import { distance } from "./api";
import { colours } from "./RouteMap";
import {
  prepareRoute,
  preparedVehicleAt,
  useTravelTime,
  type TravelClock,
} from "./simulation";
import type { Instance, Solution } from "./types";
const badge = (id: number) => colours[(id - 1) % colours.length];
export default function FleetPanel({
  instance,
  displayed,
  selectedRoute,
  setSelectedRoute,
  setSelectedClient,
  clock,
  enabled,
}: {
  instance: Instance | undefined;
  displayed: Solution | null;
  selectedRoute: number | null;
  setSelectedRoute: (id: number | null) => void;
  setSelectedClient: (id: number) => void;
  clock: TravelClock;
  enabled: boolean;
}) {
  const travelled = useTravelTime(clock);
  const prepared = useMemo(
    () =>
      instance && displayed
        ? displayed.routes.map((r) => prepareRoute(instance, r))
        : [],
    [instance, displayed],
  );
  const states =
    enabled && instance
      ? prepared.map((p) => preparedVehicleAt(instance, p, travelled))
      : [];
  const simulation = { enabled, states };
  const route = displayed?.routes.find((r) => r.vehicle === selectedRoute);
  const vehicle = states.find((v) => v.vehicle === selectedRoute);
  const nodeName = (id: number) => id === 0 ? "Depósito" : "C" + (instance ? graphNodeId(instance, id) : id).toString().padStart(2, "0");
  return (
    <section className="fleet-section">
      <div className="section-title">
        <span>
          <Truck size={15} /> Frota & rotas
        </span>
        {selectedRoute && (
          <button
            aria-label="Limpar seleção de rota"
            onClick={() => setSelectedRoute(null)}
          >
            <X size={14} />
          </button>
        )}
      </div>
      {!displayed && (
        <p className="empty-fleet">
          As rotas aparecem aqui quando uma solução viável está disponível.
        </p>
      )}
      <div className="fleet-routes" aria-label="Rotas por veículo">
      {displayed?.routes.map((r) => (
        <button
          key={r.vehicle}
          className={
            "route-card " + (selectedRoute === r.vehicle ? "selected" : "")
          }
          onClick={() =>
            setSelectedRoute(selectedRoute === r.vehicle ? null : r.vehicle)
          }
        >
          <div className="route-card-heading">
            <span>
              <i style={{ background: badge(r.vehicle) }} />
              Veículo {r.vehicle.toString().padStart(2, "0")}
            </span>
            <b>
              {distance(r.cost_ticks)} <small>u.d.</small>
            </b>
          </div>
          <div className="route-load">
            <span>{r.visits.length} paradas</span>
            <span>
              {simulation.enabled
                ? (simulation.states.find((v) => v.vehicle === r.vehicle)
                    ?.remainingLoad ?? r.load)
                : r.load}{" "}
              / {instance ? vehicleCapacity(instance, r.vehicle) : "—"} un.
            </span>
          </div>
          <div className="capacity-track">
            <div
              style={{
                width:
                  ((simulation.enabled
                    ? (simulation.states.find((v) => v.vehicle === r.vehicle)
                        ?.remainingLoad ?? r.load)
                    : r.load) /
                    (instance ? vehicleCapacity(instance, r.vehicle) : 1)) *
                    100 +
                  "%",
                background: badge(r.vehicle),
              }}
            />
          </div>
        </button>
      ))}
      </div>
      {route && (
        <div className="route-detail">
          <h3>Sequência de visitas</h3>
          <p>
            <Crosshair size={13} aria-label="Depósito" />
            {route.visits.map((id) => (
              <span key={id}>
                <ArrowRight size={11} />
                <button onClick={() => setSelectedClient(id)}>
                  {nodeName(id)}
                </button>
              </span>
            ))}
            <ArrowRight size={11} />
            <Crosshair size={13} aria-label="Depósito" />
          </p>
          <div className="execution-stats">
            <span>
              Ocupação inicial
              <b>
                {(
                  (route.load / vehicleCapacity(instance!, route.vehicle)) *
                  100
                ).toFixed(1)}
                %
              </b>
            </span>
            {vehicle && (
              <>
                <span>
                  Trecho
                  <b>
                    {vehicle.done
                      ? "Concluído"
                      : nodeName(vehicle.from) + " → " + nodeName(vehicle.next)}
                  </b>
                </span>
                <span>
                  Carga restante<b>{vehicle.remainingLoad} un.</b>
                </span>
                <span>
                  Capacidade livre<b>{vehicle.freeCapacity} un.</b>
                </span>
                <span>
                  Distância percorrida
                  <b>{distance(vehicle.travelled)} u.d.</b>
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
