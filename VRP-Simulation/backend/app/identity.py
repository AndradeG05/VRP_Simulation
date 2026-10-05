"""Mantém a identidade visual dos veículos entre soluções PyVRP."""


class RouteIdentity:
    def __init__(self, initial=None):
        self.previous = {
            r["vehicle"]: set(r["visits"]) for r in (initial or {}).get("routes", [])
        }

    def assign(self, records):
        pairs = sorted(
            (
                (-len(set(route["visits"]) & clients), vehicle, i)
                for i, route in enumerate(records)
                for vehicle, clients in self.previous.items()
            ),
        )
        assigned, used = {}, set()
        for negative_overlap, vehicle, i in pairs:
            if negative_overlap < 0 and i not in assigned and vehicle not in used:
                assigned[i] = vehicle
                used.add(vehicle)
        for i in range(len(records)):
            if i not in assigned:
                vehicle = next(
                    v
                    for v in range(
                        1,
                        max([len(records), *self.previous.keys()], default=len(records))
                        + 2,
                    )
                    if v not in used
                )
                assigned[i] = vehicle
                used.add(vehicle)
        for i, record in enumerate(records):
            record["solver_route_index"] = i
            record["vehicle"] = assigned[i]
        self.previous = {r["vehicle"]: set(r["visits"]) for r in records}
        return records
