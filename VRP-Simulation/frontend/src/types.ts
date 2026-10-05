export interface Vehicle {
  id: number;
  capacity: number;
}
export const vehicleCapacity = (
  instance: { fleet?: Vehicle[] | null; capacity: number },
  id: number,
) => instance.fleet?.find((v) => v.id === id)?.capacity ?? instance.capacity;
export const fleetCapacities = (instance: {
  fleet?: Vehicle[] | null;
  capacity: number;
  vehicles: number;
}) =>
  instance.fleet?.map((v) => v.capacity) ??
  (Array(instance.vehicles).fill(instance.capacity) as number[]);
export interface Point {
  x: number;
  y: number;
}
export interface Client extends Point {
  id: number;
  demand: number;
}
export interface Instance {
  vrp?: { filename: string; edge_weight_type: string; node_ids: number[]; coordinates: [number, number][] | null; display_points: [number, number][]; costs_ticks: number[][] } | null;
  schema_version?: 1;
  name: string;
  depot: Point;
  clients: Client[];
  vehicles: number;
  capacity: number;
  fleet?: Vehicle[] | null;
  generator_seed: number | null;
  distribution: "uniform" | "clustered" | "ring" | "custom";
}
export interface Route {
  vehicle: number;
  visits: number[];
  load: number;
  cost_ticks: number;
}
export interface Solution {
  feasible: boolean;
  errors: string[];
  cost_ticks: number;
  routes: Route[];
  served: number;
  origin?: string;
}
export interface Preview<T = Instance> {
  instance: T;
  baseline: Solution | null;
  issues: string[];
  hash: string;
  total_demand: number;
}
export interface Generator {
  customers: number;
  vehicles: number;
  capacity: number;
  seed: number;
  distribution: "uniform" | "clustered" | "ring";
  max_demand: number;
}
export interface Config {
  adapter: "ortools" | "pyvrp";
  seed: number | null;
  stop: "iterations" | "time";
  max_iterations: number;
  time_limit: number;
  sample_every: number;
}
export interface Sample {
  iteration: number | null;
  observed?: number;
  elapsed: number;
  best_cost_ticks: number | null;
  current_cost_ticks: number | null;
  candidate_cost_ticks: number | null;
  current_feasible: boolean;
  candidate_feasible: boolean;
  current_penalised_cost: number | null;
}
export interface Checkpoint {
  iteration: number | null;
  observed?: number;
  elapsed: number;
  reason: "initial" | "improvement" | "final" | "observed";
  solution: Solution;
}
export type RunEvent =
  | {
      id: number;
      run_id?: string;
      sequence?: number;
      instance_hash?: string;
      schema_version?: number;
      kind: "sample";
      payload: Sample;
    }
  | {
      id: number;
      run_id?: string;
      sequence?: number;
      instance_hash?: string;
      schema_version?: number;
      kind: "checkpoint";
      payload: Checkpoint;
    };
export type Status =
  | "queued"
  | "running"
  | "completed"
  | "cancelled"
  | "no_solution"
  | "failed"
  | "interrupted";
export interface Result {
  solution: Solution | null;
  iterations: number | null;
  observed_solutions?: number;
  omitted_snapshots?: number;
  coalesced_events?: number;
  solver_runtime: number;
  wall_runtime: number;
  stop_reason: string;
  checkpoints: number;
  instance_hash: string;
  versions: Record<string, string>;
  proven_optimal: boolean;
  algorithm: string;
  distance_convention: string;
}
export interface Run<T = Instance> {
  id: string;
  status: Status;
  created: string;
  request: {
    instance: T;
    config: Config;
    initial_routes?: number[][] | null;
  };
  baseline: Solution | null;
  result: Result | null;
  error: string | null;
  cancel: number;
}
export interface History {
  id: string;
  status: Status;
  created: string;
  name: string;
  result: Result | null;
}
