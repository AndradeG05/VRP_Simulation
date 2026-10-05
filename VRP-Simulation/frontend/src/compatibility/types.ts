export type PointKind = 'depot' | 'customer'

export interface VrpPoint {
  id: string
  label: string
  kind: PointKind
  x: number
  y: number
  demand: number
  serviceMinutes: number
}

export interface Vehicle {
  id: string
  label: string
  capacity: number
}

export interface VrpInstance {
  schemaVersion: '1.0'
  name: string
  description: string
  points: VrpPoint[]
  vehicles: Vehicle[]
  directedCosts: number[][]
  timeLimitSeconds: number
  initialUpperBound: number | null
  solverParameters?: Record<string, number | boolean>
  modelOptions?: ModelOptions
}

export interface ModelOptions {
  minRoutes?: number
  maxRoutes?: number | null
  capacityCuts?: boolean
  rank1Cuts?: boolean
  branchingPriority?: number
}

export type WorkspaceView = 'instance' | 'model' | 'runs' | 'results' | 'setup' | 'maps' | 'laboratory'

export interface ValidationMessage {
  level: 'error' | 'warning' | 'ok'
  text: string
}

export interface DependencyStatus {
  id: string
  label: string
  required: boolean
  detected: boolean
  version: string | null
  detail: string
  sourceUrl: string | null
}

export interface EnvironmentStatus {
  checkedAt: string
  orchestratorConnected: boolean
  solverReady: boolean
  dependencies: DependencyStatus[]
}

export interface SolverRoute {
  id: string
  vehicleId: string
  vehicleLabel: string
  pointIds: string[]
  customerIds: string[]
  load: number
  cost: number
  pathId: number
}

export interface SolverResult {
  schemaVersion: '1.0'
  runId: string
  outcome: 'optimal_proven' | 'feasible_unproven' | 'infeasible_proven' | 'no_solution_user_limit' | 'no_solution_unproven'
  instance?: VrpInstance
  parameters?: { configText: string; configSha256: string; requested: Record<string, number | boolean>; modelOptions: ModelOptions; initialCutoff: number | null }
  exactSearch?: boolean
  terminationReason?: string
  officialStatus: string
  hasSolution: boolean
  objective: number | null
  upperBound: number | null
  lowerBound: number | null
  gapPercent: number | null
  routes: SolverRoute[]
  statistics: {
    branchAndBoundNodes: number | null
    solverTimeSeconds: number | null
    rootDualBound: number | null
    columnGenerationIterations?: number | null
    generatedColumns?: number | null
    cutsInMaster?: number | null
  }
  versions: Record<string, string>
  model: Record<string, unknown>
}

export interface RunRecord {
  id: string
  status: 'queued' | 'validating' | 'building_model' | 'solving' | 'validating_result' | 'completed' | 'cancelled' | 'time_limit' | 'infeasible' | 'configuration_error' | 'solver_error' | 'no_solution'
  instanceName: string
  instanceHash: string
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  outcome: string | null
  result: SolverResult | null
  message: string | null
}

export interface RunLogs {
  stdout: string
  stderr: string
}

export interface HealthResponse {
  service: 'vrp-simulation'
  version: string | null
  status: 'ready' | 'degraded'
  environment: EnvironmentStatus
}
