
import importlib.metadata
import platform
from dataclasses import asdict
from math import isfinite
from time import perf_counter
from typing import Callable

from pyvrp import Model, Route, Solution, SolveParams, solve
from pyvrp.IteratedLocalSearch import (
    IteratedLocalSearchCallbacks,
    IteratedLocalSearchParams,
)
from pyvrp.stop import MaxIterations, MaxRuntime
from pyvrp.PenaltyManager import PenaltyParams

from .identity import RouteIdentity
from .fleet import capacities
from .telemetry import Telemetry
from .instances import capacity_issues, distance_matrix, fingerprint
from .schemas import RoutingInstance, SolverConfig
from .coordinates import projected_coordinates, distance_metadata
from .validation import validate_routes


def finite_json(value):
    if isinstance(value, dict):
        return {key: finite_json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [finite_json(item) for item in value]
    if isinstance(value, float) and not isfinite(value):
        return None
    return value


def build_model(instance: RoutingInstance):
    model = Model()
    coordinates = (
        [(p.lng, p.lat) for p in [instance.depot, *instance.clients]]
        if getattr(instance, "road_matrix", None)
        else projected_coordinates(instance)
    )
    locations = [model.add_location(*coordinates[0])]
    model.add_depot(locations[0])
    for client in instance.clients:
        location = model.add_location(*coordinates[client.id])
        locations.append(location)
        model.add_client(location, delivery=client.demand)
    if instance.fleet:
        for capacity in capacities(instance):
            model.add_vehicle_type(num_available=1, capacity=capacity)
    else:
        model.add_vehicle_type(
            num_available=instance.vehicles, capacity=instance.capacity
        )
    matrix = distance_matrix(instance)
    for i, origin in enumerate(locations):
        for j, destination in enumerate(locations):
            model.add_edge(origin, destination, distance=int(matrix[i, j]))
    return model.data()


def extract_routes(solution: Solution) -> list[list[int]]:
    return [
        [activity.idx + 1 for activity in route if activity.is_client()]
        for route in solution.routes()
    ]


class Observer(IteratedLocalSearchCallbacks):
    def __init__(
        self,
        instance: RoutingInstance,
        config: SolverConfig,
        emit: Callable,
        initial=None,
    ):
        self.instance, self.config, self.emit = instance, config, emit
        self.iteration = 0
        self.started = perf_counter()
        self.best_cost = None
        self.checkpoints = 0
        self.last_sample = 0
        self.last_sample_time = 0.0
        self.latest = None
        self.last_snapshot_time = 0.0

    def snapshot(self, best, reason):
        if not best.is_feasible():
            return
        if reason != "observed":
            self.best_cost = int(best.distance())
        self.last_snapshot_time = perf_counter() - self.started
        self.checkpoints += 1
        self.emit(
            "checkpoint",
            {
                "iteration": self.iteration,
                "elapsed": perf_counter() - self.started,
                "reason": reason,
                "raw_routes": extract_routes(best),
                "raw_cost": int(best.distance()),
                "raw_vehicles": [r.vehicle_type() + 1 for r in best.routes()]
                if self.instance.fleet
                else None,
            },
        )

    def on_start(self, ils):
        self.started = perf_counter()
        self.snapshot(ils.initial_solution, "initial")

    def on_iteration(self, current, candidate, best, cost_evaluator):
        self.iteration += 1
        improved = best.is_feasible() and (
            self.best_cost is None or best.distance() < self.best_cost
        )
        if improved:
            self.snapshot(best, "improvement")
        elif perf_counter() - self.started - self.last_snapshot_time >= 0.5:
            self.snapshot(current, "observed")
        self.latest = {
            "iteration": self.iteration,
            "elapsed": perf_counter() - self.started,
            "best_cost_ticks": int(best.distance()) if best.is_feasible() else None,
            "current_cost_ticks": int(current.distance())
            if current.is_feasible()
            else None,
            "candidate_cost_ticks": int(candidate.distance())
            if candidate.is_feasible()
            else None,
            "current_feasible": current.is_feasible(),
            "candidate_feasible": candidate.is_feasible(),
            "current_penalised_cost": cost_evaluator.penalised_cost(current),
        }
        if (
            improved
            or self.iteration == 1
            or (
                self.iteration % self.config.sample_every == 0
                and self.latest["elapsed"] - self.last_sample_time >= 0.1
            )
        ):
            self.emit("sample", self.latest)
            self.last_sample = self.iteration
            self.last_sample_time = self.latest["elapsed"]

    def on_end(self, result):
        if self.latest and self.last_sample != self.iteration:
            self.emit("sample", self.latest)
        self.snapshot(result.best, "final")


def execute(
    instance: RoutingInstance,
    config: SolverConfig,
    emit: Callable,
    cancelled: Callable = lambda: False,
    initial=None,
) -> dict:
    issues = capacity_issues(instance)
    if issues:
        raise ValueError(" ".join(issues))
    wall_start = perf_counter()
    data = build_model(instance)
    baseline_snapshot = initial
    initial_routes = [r["visits"] for r in initial["routes"]] if initial else None
    initial = None
    if initial_routes is not None:
        initial = Solution(
            data,
            [
                Route(
                    data,
                    [client - 1 for client in record["visits"]],
                    record["vehicle"] - 1 if instance.fleet else 0,
                )
                for record in baseline_snapshot["routes"]
            ],
        )
    telemetry = Telemetry(
        instance,
        emit,
        identity=None if instance.fleet else RouteIdentity(baseline_snapshot),
    )

    def publish(kind, payload):
        telemetry.push(kind, payload, essential=payload.get("reason") == "final")

    observer = Observer(instance, config, publish, baseline_snapshot)
    criterion = (
        MaxIterations(config.max_iterations)
        if config.stop == "iterations"
        else MaxRuntime(config.time_limit)
    )
    safety = MaxRuntime(60)
    stop_reason = "limit"

    def stop(best_cost):
        nonlocal stop_reason
        if cancelled():
            stop_reason = "cancelled"
            return True
        if criterion(best_cost):
            stop_reason = config.stop
            return True
        if safety(best_cost):
            stop_reason = "safety_time_limit"
            return True
        return False

    result = solve(
        data,
        stop,
        seed=config.seed,
        collect_stats=config.stop == "iterations",
        display=False,
        initial_solution=initial,
        params=SolveParams(
            ils=IteratedLocalSearchParams(callbacks=observer),
            penalty=PenaltyParams(
                max_penalty=max(100_000.0, float(distance_matrix(instance).max()) * 2),
            ),
        ),
    )
    telemetry.close()
    solution = None
    if result.is_feasible():
        solution = validate_routes(
            instance,
            extract_routes(result.best),
            int(result.cost()),
            [r.vehicle_type() + 1 for r in result.best.routes()]
            if instance.fleet
            else None,
        )
        if not solution["feasible"]:
            raise RuntimeError(
                "O custo/viabilidade do solver diverge da validação independente."
            )
    if solution:
        solution = telemetry.final_solution or solution
    return finite_json(
        {
            "solution": solution,
            "iterations": result.num_iterations,
            "solver_runtime": result.runtime,
            "wall_runtime": perf_counter() - wall_start,
            "stop_reason": stop_reason,
            "checkpoints": telemetry.stored_snapshots,
            "coalesced_events": telemetry.dropped,
            "omitted_snapshots": max(
                0, result.num_iterations - telemetry.observed_snapshots
            ),
            "statistics": (
                [
                    {"iteration": i + 1, "runtime": runtime, **asdict(datum)}
                    for i, (datum, runtime) in enumerate(
                        zip(result.stats, result.stats.runtimes)
                    )
                ]
                if config.stop == "iterations"
                else telemetry.statistics
            ),
            "statistics_policy": "per_iteration"
            if config.stop == "iterations"
            else "sampled_callbacks_100ms_and_improvements",
            "proven_optimal": False,
            "instance_hash": fingerprint(instance),
            "versions": {
                name: importlib.metadata.version(name)
                for name in ("pyvrp", "numpy", "fastapi", "pydantic")
            },
            "python": platform.python_version(),
            "platform": platform.platform(),
            **distance_metadata(instance),
            "algorithm": "PyVRP iterated local search with late acceptance",
            "capabilities": {
                "iterations": True,
                "snapshots": True,
                "external_start": True,
                "cancel": True,
                "seed": True,
            },
            "identity_policy": "fixed vehicle type IDs"
            if instance.fleet
            else "greedy maximum client overlap; separate solver_route_index",
            "distance_scale": 1000,
        }
    )
