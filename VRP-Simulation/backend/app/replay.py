from .replay_schema import ReplayRequest
from .coordinates import geographic_metadata
from .instances import fingerprint, capacity_issues
from .validation import validate_routes


def validate_replay(payload):
    """Recalcula as métricas do replay sem executar uma nova busca."""
    replay = payload if isinstance(payload, ReplayRequest) else ReplayRequest.model_validate(payload)
    payload = replay.model_dump(exclude_unset=True)
    request = replay.request
    instance = request.instance
    hash_value = fingerprint(instance)
    run_id = payload["id"]

    def check(solution):
        routes = solution["routes"]
        audit = validate_routes(
            instance,
            [r["visits"] for r in routes],
            solution["cost_ticks"],
            [r["vehicle"] for r in routes],
        )
        if not audit["feasible"] or solution.get("feasible") is not True or solution.get("errors", []):
            raise ValueError("Snapshot com custo ou viabilidade inválidos.")
        ids = [r["vehicle"] for r in routes]
        if len(ids) != len(set(ids)) or any(
            i < 1 or i > instance.vehicles for i in ids
        ):
            raise ValueError("Identidade de veículo inválida.")
        for claimed, actual in zip(routes, audit["routes"]):
            if any(claimed[k] != actual[k] for k in ("load", "cost_ticks")):
                raise ValueError("Métrica de rota divergente.")
        if solution.get("served") != audit["served"]:
            raise ValueError("Contagem de clientes divergente.")

    if replay.baseline is not None:
        check(payload["baseline"])
    result = payload.get("result")
    if result:
        if result["instance_hash"] != hash_value:
            raise ValueError("Hash do cenário divergente.")
        if replay.result.solution is not None:
            check(result["solution"])
    events, seen, last_elapsed, last_sequence = [], {}, 0, 0
    best_cost = None
    for event in payload["events"]:
        if event["id"] in seen:
            if event != seen[event["id"]]:
                raise ValueError("Eventos diferentes compartilham o mesmo ID.")
            continue
        seen[event["id"]] = event
        p = event["payload"]
        for metadata in (event, p):
            if metadata.get("run_id", run_id) != run_id:
                raise ValueError("Evento pertence a outra execução.")
            if metadata.get("instance_hash", hash_value) != hash_value:
                raise ValueError("Evento pertence a outro cenário.")
            if metadata.get("sequence", last_sequence + 1) != last_sequence + 1:
                raise ValueError("Lacuna de sequência no histórico.")
        last_sequence += 1
        elapsed = p["elapsed"]
        if elapsed < last_elapsed:
            raise ValueError("Relógio de busca inválido.")
        last_elapsed = elapsed
        if event["kind"] == "checkpoint":
            check(p["solution"])
        elif event["kind"] == "sample":
            cost = p.get("best_cost_ticks")
            if cost is not None:
                if cost < 0 or (best_cost is not None and cost > best_cost):
                    raise ValueError("Série de melhor custo inconsistente.")
                best_cost = cost
        else:
            raise ValueError("Tipo de evento desconhecido.")
        events.append(event)
    status = payload["status"]
    if status not in ("completed", "cancelled", "no_solution", "failed", "interrupted"):
        raise ValueError("Replay exige execução encerrada.")
    run = {
        k: payload.get(k)
        for k in ("id", "status", "created", "baseline", "result", "error", "cancel")
    }
    run["request"] = request.model_dump()
    return {
        "run": run,
        "events": events,
        "preview": {
            "instance": instance.model_dump(),
            **geographic_metadata(instance),
            "baseline": payload.get("baseline"),
            "hash": hash_value,
            "issues": capacity_issues(instance),
            "total_demand": sum(c.demand for c in instance.clients),
        },
    }
