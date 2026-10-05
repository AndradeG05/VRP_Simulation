"""Audita cobertura, capacidade e custos sem consultar o solver."""

from collections import Counter
from math import floor, hypot

from .schemas import RoutingInstance
from .coordinates import projected_coordinates
from .fleet import capacities


def validate_routes(
    instance: RoutingInstance,
    routes: list[list[int]],
    expected_cost: int | None = None,
    vehicles: list[int] | None = None,
) -> dict:
    if getattr(instance, "schema_version", None) == 3 and not instance.road_matrix:
        raise ValueError("A matriz viária é necessária para validar o custo das rotas.")
    clients = {c.id: c for c in instance.clients}
    vrp = getattr(instance, "vrp", None)
    road = getattr(instance, "road_matrix", None)
    points = None if road else projected_coordinates(instance)
    caps = capacities(instance)
    vehicles = list(range(1, len(routes) + 1)) if vehicles is None else vehicles
    counts = Counter(node for route in routes for node in route)
    errors = []
    if set(counts) != set(clients):
        errors.append("Cobertura inválida: clientes ausentes ou IDs desconhecidos.")
    if any(count != 1 for count in counts.values()):
        errors.append("Há clientes visitados mais de uma vez.")
    if len(routes) > instance.vehicles:
        errors.append("Número de rotas excede a frota disponível.")
    if (
        len(vehicles) != len(routes)
        or len(set(vehicles)) != len(vehicles)
        or any(v < 1 or v > instance.vehicles for v in vehicles)
    ):
        errors.append("Identidade de veículo inválida.")
        return {
            "feasible": False,
            "errors": errors,
            "cost_ticks": 0,
            "routes": [],
            "served": 0,
        }
    records = []
    total = 0
    for index, route in enumerate(routes):
        if not route or any(node not in clients for node in route):
            errors.append(f"Rota {index + 1} vazia ou com ID inválido.")
            continue
        load = sum(clients[node].demand for node in route)
        vehicle = vehicles[index]
        if load > caps[vehicle - 1]:
            errors.append(f"Rota {index + 1} excede a capacidade.")
        closed = [0, *route, 0]
        cost = sum(
            vrp.costs_ticks[a][b]
            if vrp
            else floor(road.distances_m[a][b] * 1000 + 0.5)
            if road
            else floor(
                hypot(points[a][0] - points[b][0], points[a][1] - points[b][1]) * 1000
                + 0.5
            )
            for a, b in zip(closed, closed[1:])
        )
        total += cost
        records.append(
            {"vehicle": vehicle, "visits": route, "load": load, "cost_ticks": cost}
        )
    if expected_cost is not None and total != expected_cost:
        errors.append(f"Custo divergente: recalculado={total}, solver={expected_cost}.")
    return {
        "feasible": not errors,
        "errors": errors,
        "cost_ticks": total,
        "routes": records,
        "served": len(set(counts) & set(clients)),
    }
