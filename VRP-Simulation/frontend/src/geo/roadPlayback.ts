import type { PreparedRoute, SimulationGeometry } from "../simulation";
import type { Route } from "../types";
import type { RoadGeometry } from "./roads";
import type { GeoDraft, GeoPoint } from "./model";

const radians = (n: number) => (n * Math.PI) / 180;
function arc(a: GeoPoint, b: GeoPoint) {
  const h =
    Math.sin(radians(b.lat - a.lat) / 2) ** 2 +
    Math.cos(radians(a.lat)) *
      Math.cos(radians(b.lat)) *
      Math.sin(radians(b.lng - a.lng) / 2) ** 2;
  return 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
export function pathInterpolator(path: GeoPoint[]) {
  if (!path.length) throw new Error("Trecho viário sem coordenadas.");
  const cumulative = [0];
  for (let i = 1; i < path.length; i++)
    cumulative.push(cumulative[i - 1] + arc(path[i - 1], path[i]));
  const total = cumulative[cumulative.length - 1];
  return (fraction: number) => {
    const t = Math.max(0, Math.min(1, fraction)) * total;
    let low = 1,
      high = cumulative.length - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (cumulative[middle] <= t) low = middle + 1;
      else high = middle;
    }
    if (!total || fraction >= 1 || path.length === 1) {
      const last = path[path.length - 1];
      return { x: last.lng, y: last.lat };
    }
    const a = path[low - 1],
      b = path[low];
    const length = cumulative[low] - cumulative[low - 1];
    const f = length ? (t - cumulative[low - 1]) / length : 1;
    const delta = ((b.lng - a.lng + 540) % 360) - 180;
    return {
      x: ((a.lng + delta * f + 540) % 360) - 180,
      y: a.lat + (b.lat - a.lat) * f,
    };
  };
}
export function geographicMetric(
  draft: GeoDraft,
): SimulationGeometry | undefined {
  if (!draft.depot) return undefined;
  return {
    depot: { x: draft.depot.lng, y: draft.depot.lat },
    clients: draft.clients.map((c) => ({ ...c, x: c.lng, y: c.lat })),
    capacity: draft.capacity,
    fleet: draft.fleet,
  };
}
export function prepareRoadRoute(
  draft: GeoDraft,
  route: Route,
  road?: RoadGeometry,
): PreparedRoute | undefined {
  if (!draft.depot) return undefined;
  if (!route.visits.length) return { route, total: 0, segments: [] };
  if (!road || road.legs.length !== route.visits.length + 1) return undefined;
  const ids = [0, ...route.visits, 0];
  let total = 0,
    delivered = 0;
  const segments = road.legs.map((leg, index) => {
    const positionAt = pathInterpolator(leg.path);
    const start = total,
      load = route.load - delivered,
      next = ids[index + 1];
    const length = Math.floor(leg.distanceMetres * 1000 + 0.5);
    total += length;
    if (next) delivered += draft.clients[next - 1].demand;
    return {
      from: ids[index],
      next,
      a: positionAt(0),
      b: positionAt(1),
      length,
      start,
      end: total,
      load,
      index,
      positionAt,
    };
  });
  return { route, segments, total };
}
