import type { Vehicle } from "../types";
export interface RoadMatrix {
  provider: "google_routes" | "osrm";
  endpoint?: string | null;
  method?: "compute_routes" | "route_matrix" | "table" | null;
  travel_mode: "DRIVING";
  routing_preference: "TRAFFIC_UNAWARE";
  fetched_at: string;
  points: [number, number][];
  distances_m: number[][];
}
export const coordinateKey = (draft: GeoDraft) =>
  JSON.stringify(
    [draft.depot, ...draft.clients].map((p) => (p ? [p.lat, p.lng] : null)),
  );
export interface GeoPoint {
  lat: number;
  lng: number;
  address?: string | null;
}
export interface GeoClient extends GeoPoint {
  id: number;
  demand: number;
}
export interface GeographicInstance {
  schema_version: 2 | 3;
  road_matrix?: RoadMatrix | null;
  fleet?: Vehicle[] | null;
  coordinate_system: "geographic";
  name: string;
  depot: GeoPoint;
  clients: GeoClient[];
  vehicles: number;
  capacity: number;
}
export type GeoDraft = Omit<GeographicInstance, "depot"> & {
  depot: GeoPoint | null;
};
export type Tool = "navigate" | "set-depot" | "add-client" | "manual-route";
export interface Projection {
  source_crs: "EPSG:4326";
  target_crs: string;
  name: string;
  unit: "m";
  points: { id: number; easting: number; northing: number }[];
}
export const emptyDraft = (): GeoDraft => ({
  schema_version: 3,
  road_matrix: null,
  fleet: [
    { id: 1, capacity: 30 },
    { id: 2, capacity: 30 },
    { id: 3, capacity: 30 },
  ],
  coordinate_system: "geographic",
  name: "Cenário no mapa",
  depot: null,
  clients: [],
  vehicles: 3,
  capacity: 30,
});
export const isGeographic = (value: unknown): value is GeographicInstance =>
  !!value &&
  typeof value === "object" &&
  "coordinate_system" in value &&
  value.coordinate_system === "geographic";
export const ready = (draft: GeoDraft): draft is GeographicInstance =>
  !!draft.depot && draft.clients.length >= 2;
export function removeClient(draft: GeoDraft, id: number): GeoDraft {
  return {
    ...draft,
    clients: draft.clients
      .filter((c) => c.id !== id)
      .map((c, i) => ({ ...c, id: i + 1 })),
  };
}
export function moveNode(
  draft: GeoDraft,
  id: number,
  point: GeoPoint,
): GeoDraft {
  return id === 0
    ? { ...draft, depot: point }
    : {
        ...draft,
        clients: draft.clients.map((c) =>
          c.id === id ? { ...c, ...point, address: point.address ?? null } : c,
        ),
      };
}
export function appendVisit(routes: number[][], vehicle: number, id: number) {
  if (routes.some((r) => r.includes(id))) return routes;
  return routes.map((r, i) => (i === vehicle - 1 ? [...r, id] : r));
}
export const colourIndex = (vehicle: number, count: number) =>
  (vehicle - 1) % count;
export function routeChunks<T>(closed: T[]): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < closed.length - 1; i += 99)
    chunks.push(closed.slice(i, i + 100));
  return chunks;
}
export const geometryKey = (hash: string, visits: number[]) =>
  `${hash}:${[0, ...visits, 0].join(",")}`;

export function roadDraft<T extends GeoDraft>(draft: T): T {
  const matrix = draft.road_matrix;
  const keep = matrix?.provider === "osrm" && JSON.stringify(matrix.points) === coordinateKey(draft);
  return { ...draft, schema_version: 3, road_matrix: keep ? matrix : null };
}
export function roadDeviation(costTicks: number, roadMetres: number) {
  const estimate = costTicks / 1000;
  return {
    differenceMetres: roadMetres - estimate,
    absolutePercent:
      roadMetres > 0
        ? (Math.abs(roadMetres - estimate) / roadMetres) * 100
        : null,
  };
}
