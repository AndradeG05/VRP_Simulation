import type { Config, Instance, Run } from '../types'
import type { RunRecord, SolverResult, VrpInstance } from './types'

export function euclideanCosts(points: VrpInstance['points']) {
  return points.map(a => points.map(b => Math.floor(Math.hypot(a.x - b.x, a.y - b.y) * 1000 + 0.5) / 1000))
}

export function toRequest(input: VrpInstance): { instance: Instance; config: Config } {
  const depot = input.points.find(p => p.kind === 'depot')!
  const customers = input.points.filter(p => p.kind === 'customer')
  const params = input.solverParameters ?? {}
  return {
    instance: {
      schema_version: 1, name: input.name, depot: { x: depot.x, y: depot.y },
      clients: customers.map((p, i) => ({ id: i + 1, x: p.x, y: p.y, demand: p.demand })),
      vehicles: input.vehicles.length, capacity: input.vehicles[0].capacity,
      fleet: input.vehicles.map((v, i) => ({ id: i + 1, capacity: v.capacity })),
      generator_seed: null, distribution: 'custom',
    },
    config: {
      adapter: params.usePyvrp ? 'pyvrp' : 'ortools',
      seed: params.usePyvrp ? Number(params.seed ?? 7) : null,
      stop: params.usePyvrp && params.iterationStop ? 'iterations' : 'time',
      max_iterations: Number(params.max_iterations ?? 5000),
      time_limit: input.timeLimitSeconds, sample_every: Number(params.sample_every ?? 25),
    },
  }
}

export function fromInstance(input: Instance, config: Config): VrpInstance {
  const points: VrpInstance['points'] = [
    { id: 'D0', label: 'Depósito', kind: 'depot', ...input.depot, demand: 0, serviceMinutes: 0 },
    ...input.clients.map(p => ({ id: `C${String(p.id).padStart(2, '0')}`, label: `Cliente ${p.id}`, kind: 'customer' as const, x: p.x, y: p.y, demand: p.demand, serviceMinutes: 0 })),
  ]
  return { schemaVersion: '1.0', name: input.name, description: 'Instância do backend VRP Simulation.', points,
    vehicles: Array.from({ length: input.vehicles }, (_, i) => ({ id: `V${String(i + 1).padStart(2, '0')}`, label: `Veículo ${i + 1}`, capacity: input.fleet?.[i]?.capacity ?? input.capacity })),
    directedCosts: euclideanCosts(points), timeLimitSeconds: config.time_limit, initialUpperBound: null,
    solverParameters: { usePyvrp: config.adapter === 'pyvrp', seed: config.seed ?? 7, iterationStop: config.stop === 'iterations', max_iterations: config.max_iterations, sample_every: config.sample_every },
  }
}

export function toRecord(run: Run, display?: VrpInstance): RunRecord {
  const input = display ?? fromInstance(run.request.instance, run.request.config)
  const customers = input.points.filter(p => p.kind === 'customer')
  const depot = input.points.find(p => p.kind === 'depot')!
  const native = run.result
  const solution = native?.solution
  const result: SolverResult | null = native ? {
    schemaVersion: '1.0', runId: run.id, instance: input,
    outcome: solution?.feasible ? 'feasible_unproven' : 'no_solution_unproven',
    exactSearch: false, terminationReason: native.stop_reason, officialStatus: run.status,
    hasSolution: Boolean(solution?.feasible), objective: solution?.feasible ? solution.cost_ticks / 1000 : null,
    upperBound: solution?.feasible ? solution.cost_ticks / 1000 : null, lowerBound: null, gapPercent: null,
    routes: solution?.feasible ? solution.routes.map((r, i) => {
      const vehicle = input.vehicles[r.vehicle - 1]
      const customerIds = r.visits.filter(id => id !== 0).map(id => customers[id - 1].id)
      return { id: `route-${r.vehicle}`, vehicleId: vehicle.id, vehicleLabel: vehicle.label,
        pointIds: [depot.id, ...customerIds, depot.id], customerIds, load: r.load, cost: r.cost_ticks / 1000, pathId: i + 1 }
    }) : [],
    statistics: { branchAndBoundNodes: null, solverTimeSeconds: native.solver_runtime, rootDualBound: null },
    versions: native.versions, model: { instance: run.request.instance, config: run.request.config, algorithm: native.algorithm, distanceConvention: native.distance_convention, iterations: native.iterations },
  } : null
  const status: RunRecord['status'] = run.status === 'running' ? 'solving' : run.status === 'no_solution' ? 'no_solution' : ['failed', 'interrupted'].includes(run.status) ? 'solver_error' : run.status as RunRecord['status']
  return { id: run.id, status, instanceName: run.request.instance.name, instanceHash: native?.instance_hash ?? JSON.stringify(run.request.instance), createdAt: run.created, startedAt: null, finishedAt: null, outcome: result?.outcome ?? null, result, message: run.error }
}
