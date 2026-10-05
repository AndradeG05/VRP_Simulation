import { api } from "../api";
import type { GeoPoint, RoadMatrix } from "./model";

export interface RoadLeg { path: GeoPoint[]; distanceMetres: number }
export interface RoadGeometry { paths: GeoPoint[][]; legs: RoadLeg[]; distanceMetres: number; warnings: string[]; requests: number }
export const roadMatrixError = (error: unknown) => error instanceof Error ? error.message : String(error);

export async function computeRoadMatrix(points: GeoPoint[], signal?: AbortSignal): Promise<RoadMatrix> {
  const result = await api<{ matrix: RoadMatrix }>("/roads/matrix", { points: points.map(({lat,lng})=>({lat,lng})) }, signal);
  if (result.matrix.provider !== "osrm" || result.matrix.points.length !== points.length)
    throw new Error("A API não retornou a matriz OSRM esperada.");
  return result.matrix;
}

export async function computeRoadGeometry(closed: GeoPoint[], isCurrent: () => boolean): Promise<RoadGeometry> {
  if (!isCurrent()) throw new Error("O cenário mudou; consulta descartada.");
  const result = await api<RoadGeometry>("/roads/geometry", { points: closed.map(({lat,lng})=>({lat,lng})) });
  if (!isCurrent()) throw new Error("O cenário mudou; consulta descartada.");
  return result;
}
