import { useMemo } from "react";
import { distance } from "../api";
import {
  preparedVehicleAt,
  useTravelTime,
  type SimulationGeometry,
  type TravelClock,
} from "../simulation";
import { prepareRoadRoute } from "./roadPlayback";
import type { GeoDraft } from "./model";
import type { RoadGeometry } from "./roads";
import type { Route } from "../types";
export default function VehicleProgress({
  metric,
  route,
  clock,
  enabled,
  draft,
  road,
}: {
  metric: SimulationGeometry;
  route: Route;
  clock: TravelClock;
  enabled: boolean;
  draft: GeoDraft;
  road: RoadGeometry;
}) {
  const time = useTravelTime(clock);
  const prepared = useMemo(
    () => prepareRoadRoute(draft, route, road),
    [draft, route, road],
  );
  if (!prepared) return null;
  const state = preparedVehicleAt(metric, prepared, enabled ? time : 0);
  return (
    <dl className="geo-vehicle-progress">
      <dt>Percorrido nas ruas</dt>
      <dd>{distance(state.travelled)} m</dd>
      <dt>Carga restante</dt>
      <dd>{state.remainingLoad}</dd>
      <dt>Próxima parada</dt>
      <dd>{state.next ? `C${state.next}` : "Depósito"}</dd>
      <dt>Atendidos</dt>
      <dd>
        {state.visited.length} / {route.visits.length}
      </dd>
    </dl>
  );
}

