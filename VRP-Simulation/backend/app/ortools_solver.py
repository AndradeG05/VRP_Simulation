
import importlib.metadata
import inspect
import platform
from time import perf_counter
from ortools.constraint_solver import pywrapcp, routing_enums_pb2

from .coordinates import distance_metadata
from .fleet import capacities
from .instances import capacity_issues, distance_matrix, fingerprint
from .validation import validate_routes

CAPABILITIES = {
    "ortools": {
        "iterations": False,
        "snapshots": True,
        "external_start": True,
        "cancel": True,
        "seed": False,
    },
    "pyvrp": {
        "iterations": True,
        "snapshots": True,
        "external_start": True,
        "cancel": True,
        "seed": True,
    },
}


def make_routing(instance, matrix=None):
    matrix = distance_matrix(instance) if matrix is None else matrix
    manager = pywrapcp.RoutingIndexManager(
        len(instance.clients) + 1, instance.vehicles, 0
    )
    routing = pywrapcp.RoutingModel(manager)
    transit = routing.RegisterTransitMatrix(matrix.tolist())
    routing.SetArcCostEvaluatorOfAllVehicles(transit)
    demands = [0] + [c.demand for c in instance.clients]
    demand = routing.RegisterUnaryTransitCallback(
        lambda idx: demands[manager.IndexToNode(idx)]
    )
    routing.AddDimensionWithVehicleCapacity(
        demand, 0, capacities(instance), True, "Capacity"
    )
    return manager, routing


def parameters(seconds, initial=False):
    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )
    params.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    )
    params.time_limit.FromMilliseconds(max(1, int(seconds * 1000)))
    if initial:
        params.solution_limit = 1
    params.log_search = False
    return params


def extract(manager, routing, value):
    routes, vehicles = [], []
    for vehicle in range(routing.vehicles()):
        index, visits = routing.Start(vehicle), []
        while not routing.IsEnd(index):
            node = manager.IndexToNode(index)
            if node:
                visits.append(node)
            index = value(routing.NextVar(index))
        if visits:
            routes.append(visits)
            vehicles.append(vehicle + 1)
    return routes, vehicles


def audit(instance, routes, cost, vehicles=None):
    result = validate_routes(instance, routes, cost, vehicles)
    if not result["feasible"]:
        raise ValueError("Snapshot inválido: " + "; ".join(result["errors"]))
    for record, vehicle in zip(result["routes"], vehicles or range(1, len(routes) + 1)):
        record["vehicle"] = vehicle
    return result


def initial_solution(instance, matrix=None):
    if capacity_issues(instance):
        return None
    manager, routing = make_routing(instance, matrix)
    assignment = routing.SolveWithParameters(parameters(1, initial=True))
    if assignment is None:
        return None
    routes, vehicles = extract(manager, routing, assignment.Value)
    result = audit(instance, routes, assignment.ObjectiveValue(), vehicles)
    result["origin"] = "OR-Tools PATH_CHEAPEST_ARC · primeira solução viável"
    return result


class CancelMonitor(pywrapcp.SearchMonitor):
    def __init__(self, solver, cancelled):
        super().__init__(solver)
        self.cancelled = cancelled
        self.stopped = False

    def BeginNextDecision(self, _decision_builder):
        if self.cancelled():
            self.stopped = True
            self.solver().FinishCurrentSearch()


def execute_ortools(
    instance, config, emit, cancelled=lambda: False, initial=None, instrument=True
):
    from .telemetry import Telemetry

    issues = capacity_issues(instance)
    if issues:
        raise ValueError(" ".join(issues))
    started = perf_counter()
    matrix = distance_matrix(instance)
    manager, routing = make_routing(instance, matrix)
    params = parameters(config.time_limit)
    baseline = initial
    assignment = None
    if baseline:
        audit(
            instance,
            [r["visits"] for r in baseline["routes"]],
            baseline["cost_ticks"],
            [r["vehicle"] for r in baseline["routes"]],
        )
        packed = [[] for _ in range(instance.vehicles)]
        for route in baseline["routes"]:
            packed[route["vehicle"] - 1] = route["visits"]
        routing.CloseModelWithParameters(params)
        assignment = routing.ReadAssignmentFromRoutes(packed, True)
        if assignment is None:
            raise ValueError("OR-Tools rejeitou a conversão do plano inicial validado.")
    observed = 0
    best_cost = baseline["cost_ticks"] if baseline else None
    first_solution_time = None
    last_sample = last_snapshot = -1.0
    monitor = CancelMonitor(routing.solver(), cancelled)
    routing.AddSearchMonitor(monitor)
    telemetry = Telemetry(instance, emit)
    search_start = perf_counter()
    if baseline and instrument:
        telemetry.push(
            "checkpoint",
            {
                "iteration": None,
                "observed": 0,
                "elapsed": 0.0,
                "reason": "initial",
                "solution": baseline,
            },
        )

    def callback():
        nonlocal observed, best_cost, last_sample, last_snapshot, first_solution_time
        observed += 1
        now = perf_counter() - search_start
        if first_solution_time is None:
            first_solution_time = now
        cost = routing.CostVar().Value()
        improved = best_cost is None or cost < best_cost
        if improved:
            best_cost = cost
        if not instrument:
            return
        if improved or now - last_snapshot >= 0.5:
            routes, vehicles = extract(manager, routing, lambda var: var.Value())
            telemetry.push(
                "checkpoint",
                {
                    "iteration": None,
                    "observed": observed,
                    "elapsed": now,
                    "reason": "improvement" if improved else "observed",
                    "raw_routes": routes,
                    "raw_vehicles": vehicles,
                    "raw_cost": cost,
                    "best_cost_ticks": best_cost,
                },
            )
            last_snapshot = now
        if improved or now - last_sample >= 0.1:
            telemetry.push(
                "sample",
                {
                    "iteration": None,
                    "observed": observed,
                    "elapsed": now,
                    "best_cost_ticks": best_cost,
                    "current_cost_ticks": cost,
                    "candidate_cost_ticks": None,
                    "current_feasible": True,
                    "candidate_feasible": True,
                    "current_penalised_cost": None,
                },
            )
            last_sample = now

    routing.AddAtSolutionCallback(callback)
    result = (
        routing.SolveFromAssignmentWithParameters(assignment, params)
        if assignment
        else routing.SolveWithParameters(params)
    )
    runtime = perf_counter() - search_start
    solution = None
    if result:
        routes, vehicles = extract(manager, routing, result.Value)
        solution = audit(instance, routes, result.ObjectiveValue(), vehicles)
    if solution and instrument:
        telemetry.push(
            "checkpoint",
            {
                "iteration": None,
                "observed": observed,
                "elapsed": runtime,
                "reason": "final",
                "solution": solution,
            },
            essential=True,
        )
        telemetry.push(
            "sample",
            {
                "iteration": None,
                "observed": observed,
                "elapsed": runtime,
                "best_cost_ticks": solution["cost_ticks"],
                "current_cost_ticks": solution["cost_ticks"],
                "candidate_cost_ticks": None,
                "current_feasible": True,
                "candidate_feasible": True,
                "current_penalised_cost": None,
            },
            essential=True,
        )
    telemetry.close()
    return {
        "solution": solution,
        "iterations": None,
        "observed_solutions": observed,
        "solver_runtime": runtime,
        "wall_runtime": perf_counter() - started,
        "stop_reason": "cancelled" if monitor.stopped else "time_or_search_end",
        "checkpoints": telemetry.stored_snapshots,
        "omitted_snapshots": max(0, observed - telemetry.observed_snapshots),
        "coalesced_events": telemetry.dropped,
        "statistics": telemetry.statistics,
        "time_to_first_solution": first_solution_time,
        "instance_hash": fingerprint(instance),
        "proven_optimal": False,
        "solver_status": routing.status(),
        "capabilities": CAPABILITIES["ortools"],
        "versions": {
            n: importlib.metadata.version(n)
            for n in ("ortools", "numpy", "fastapi", "pydantic")
        },
        "python": platform.python_version(),
        "platform": platform.platform(),
        **distance_metadata(instance),
        "distance_scale": 1000,
        "algorithm": "OR-Tools PATH_CHEAPEST_ARC + GUIDED_LOCAL_SEARCH",
        "api_signatures": {
            name: str(inspect.signature(getattr(pywrapcp.RoutingModel, name)))
            for name in (
                "AddAtSolutionCallback",
                "ReadAssignmentFromRoutes",
                "SolveFromAssignmentWithParameters",
            )
        },
    }
