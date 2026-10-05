import hashlib
from functools import lru_cache
import json

import numpy as np

from .schemas import Client, GenerateRequest, Instance, RoutingInstance
from .coordinates import projected_coordinates
from .fleet import capacities


def generate(req: GenerateRequest) -> Instance:
    rng = np.random.default_rng(req.seed)
    n = req.customers
    if req.distribution == "clustered":
        centres = np.array([[23, 24], [76, 25], [27, 75], [76, 76]])
        points = centres[rng.integers(0, 4, n)] + rng.normal(0, 9, (n, 2))
    elif req.distribution == "ring":
        angles = rng.uniform(0, 2 * np.pi, n)
        radii = rng.uniform(25, 43, n)
        points = 50 + np.column_stack([np.cos(angles), np.sin(angles)]) * radii[:, None]
    else:
        points = rng.uniform(5, 95, (n, 2))
    points = np.round(np.clip(points, 3, 97), 3)
    demands = rng.integers(1, req.max_demand + 1, n)
    return Instance(
        name=f"CVRP · {n} clientes · seed {req.seed}",
        clients=[
            Client(id=i + 1, x=p[0], y=p[1], demand=int(demands[i]))
            for i, p in enumerate(points)
        ],
        vehicles=req.vehicles,
        capacity=req.capacity,
        generator_seed=req.seed,
        distribution=req.distribution,
    )


def fingerprint(instance: RoutingInstance) -> str:
    data = instance.model_dump(
        exclude={"name", "generator_seed", "distribution", "schema_version"}
    )
    if data.get("vrp") is None:
        data.pop("vrp", None)
    if data.get("fleet") is None:
        data.pop("fleet", None)
    if data.get("road_matrix") is None:
        data.pop("road_matrix", None)
    else:
        data["road_matrix"].pop("fetched_at", None)
        if data["road_matrix"].get("method") is None:
            data["road_matrix"].pop("method", None)
        if data["road_matrix"].get("endpoint") is None:
            data["road_matrix"].pop("endpoint", None)
    if data.get("coordinate_system") == "geographic":
        data["depot"].pop("address", None)
        for client in data["clients"]:
            client.pop("address", None)
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


@lru_cache(maxsize=12)
def _matrix(coordinates: tuple[tuple[float, float], ...]) -> np.ndarray:
    points = np.array(coordinates)
    delta = points[:, None] - points[None, :]
    matrix = np.floor(np.sqrt(np.sum(delta * delta, axis=2)) * 1000 + 0.5).astype(
        np.int64
    )
    matrix.setflags(write=False)
    return matrix


def distance_matrix(instance: RoutingInstance) -> np.ndarray:
    """Matriz imutável em ticks, obtida da fonte de custos da instância."""
    if getattr(instance, "schema_version", None) == 3 and not instance.road_matrix:
        raise ValueError(
            "Consulte as distâncias viárias antes de otimizar este cenário."
        )
    if getattr(instance, "road_matrix", None):
        matrix = np.floor(
            np.asarray(instance.road_matrix.distances_m, dtype=np.float64) * 1000 + 0.5
        ).astype(np.int64)
        matrix.setflags(write=False)
        return matrix
    if getattr(instance, "vrp", None):
        matrix = np.asarray(instance.vrp.costs_ticks, dtype=np.int64)
        matrix.setflags(write=False)
        return matrix
    return _matrix(projected_coordinates(instance))


def capacity_issues(instance: RoutingInstance) -> list[str]:
    issues = []
    caps = capacities(instance)
    if any(c.demand > max(caps) for c in instance.clients):
        issues.append("Há cliente com demanda maior que a capacidade de um veículo.")
    if sum(c.demand for c in instance.clients) > sum(caps):
        issues.append("A demanda total excede a capacidade total da frota.")
    return issues


def baseline(instance: RoutingInstance) -> list[list[int]] | None:
    """Distribui demandas em ordem decrescente e visita o vizinho mais próximo.

    A ausência de plano não comprova inviabilidade do problema.
    """
    bins: list[list[int]] = [[] for _ in range(instance.vehicles)]
    loads = [0] * instance.vehicles
    caps = capacities(instance)
    for client in sorted(instance.clients, key=lambda c: (-c.demand, c.id)):
        target = next(
            (i for i, load in enumerate(loads) if load + client.demand <= caps[i]),
            None,
        )
        if target is None:
            return None
        bins[target].append(client.id)
        loads[target] += client.demand
    matrix = distance_matrix(instance)
    routes = []
    for group in bins:
        remaining = set(group)
        route = []
        last = 0
        while remaining:
            last = min(remaining, key=lambda node: (matrix[last, node], node))
            route.append(last)
            remaining.remove(last)
        if route:
            routes.append(route)
    return routes
