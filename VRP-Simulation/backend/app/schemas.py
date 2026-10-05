from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .limits import MAX_CLIENTS, MAX_NODES, MAX_VEHICLES


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Vehicle(StrictModel):
    id: int = Field(ge=1, le=MAX_VEHICLES)
    capacity: int = Field(ge=1, le=10000)


class FleetModel(StrictModel):
    fleet: list[Vehicle] | None = Field(default=None, min_length=1, max_length=MAX_VEHICLES)

    @model_validator(mode="after")
    def validate_fleet(self):
        if self.fleet is not None:
            if [v.id for v in self.fleet] != list(range(1, self.vehicles + 1)):
                raise ValueError(
                    "A frota deve conter um veículo para cada ID consecutivo, iniciando em 1."
                )
        return self


class RoadMatrix(StrictModel):
    provider: Literal["google_routes", "osrm"] = "google_routes"
    method: Literal["compute_routes", "route_matrix", "table"] | None = None
    endpoint: str | None = Field(default=None, max_length=500)
    travel_mode: Literal["DRIVING"] = "DRIVING"
    routing_preference: Literal["TRAFFIC_UNAWARE"] = "TRAFFIC_UNAWARE"
    fetched_at: str = Field(min_length=20, max_length=40)
    points: list[tuple[float, float]] = Field(min_length=3, max_length=MAX_NODES)
    distances_m: list[
        Annotated[list[
            Annotated[
                Annotated[int, Field(strict=True)]
                | Annotated[float, Field(strict=True)],
                Field(ge=0, le=40_000_000),
            ]
        ], Field(min_length=3, max_length=MAX_NODES)]
    ] = Field(min_length=3, max_length=MAX_NODES)

    @model_validator(mode="after")
    def square(self):
        n = len(self.points)
        if self.provider == "osrm" and self.method != "table":
            raise ValueError("A matriz OSRM deve usar o método Table.")
        if self.provider == "google_routes" and (
            self.method == "table"
            or any(type(v) is not int for row in self.distances_m for v in row)
        ):
            raise ValueError(
                "Matrizes Google históricas exigem metros inteiros e método Google."
            )
        if len(self.distances_m) != n or any(len(row) != n for row in self.distances_m):
            raise ValueError(
                "Matriz viária incompleta: todos os pares devem ser retornados pelo provedor."
            )
        if any(self.distances_m[i][i] != 0 for i in range(n)):
            raise ValueError("A diagonal da matriz deve ser zero.")
        return self


class Point(StrictModel):
    x: float = Field(ge=0, le=100)
    y: float = Field(ge=0, le=100)


class Client(Point):
    id: int = Field(ge=1, le=MAX_CLIENTS)
    demand: int = Field(ge=1, le=10000)


class VrpSource(StrictModel):
    filename: str = Field(min_length=1, max_length=255)
    edge_weight_type: Literal["EUC_2D", "CEIL_2D", "FLOOR_2D", "EXACT_2D", "EXPLICIT"]
    node_ids: list[int] = Field(min_length=3, max_length=MAX_NODES)
    coordinates: list[tuple[float, float]] | None = Field(default=None, min_length=3, max_length=MAX_NODES)
    display_points: list[tuple[float, float]] = Field(min_length=3, max_length=MAX_NODES)
    costs_ticks: list[Annotated[list[Annotated[int, Field(strict=True, ge=0, le=10**12)]], Field(min_length=3, max_length=MAX_NODES)]] = Field(min_length=3, max_length=MAX_NODES)


class VrpImportRequest(StrictModel):
    text: str = Field(min_length=1, max_length=25_000_000)
    filename: str = Field(min_length=1, max_length=255)
    vehicles: int | None = Field(default=None, ge=1, le=MAX_VEHICLES)


class Instance(FleetModel):
    vrp: VrpSource | None = None
    schema_version: Literal[1] = 1
    name: str = Field(default="Experimento", min_length=1, max_length=80)
    depot: Point = Field(default_factory=lambda: Point(x=50, y=50))
    clients: list[Client] = Field(min_length=2, max_length=MAX_CLIENTS)
    vehicles: int = Field(default=5, ge=1, le=MAX_VEHICLES)
    capacity: int = Field(default=60, ge=1, le=10000)
    generator_seed: int | None = Field(default=None, ge=0, le=2**32 - 1)
    distribution: Literal["uniform", "clustered", "ring", "custom"] = "custom"

    @model_validator(mode="after")
    def ordered_ids(self):
        if [c.id for c in self.clients] != list(range(1, len(self.clients) + 1)):
            raise ValueError("IDs devem ser consecutivos, ordenados e iniciar em 1.")
        if self.vrp is not None:
            source = self.vrp
            n = len(self.clients) + 1
            points = [(p.x, p.y) for p in [self.depot, *self.clients]]
            if source.display_points != points:
                raise ValueError("Coordenadas importadas são fixas para preservar a matriz VRP.")
            if len(source.node_ids) != n or len(set(source.node_ids)) != n or (source.coordinates is not None and len(source.coordinates) != n):
                raise ValueError("Nós da instância VRP inconsistentes.")
            if len(source.costs_ticks) != n or any(len(row) != n for row in source.costs_ticks) or any(source.costs_ticks[i][i] != 0 for i in range(n)):
                raise ValueError("Matriz VRP incompleta ou diagonal inválida.")
        return self


class GeoPoint(StrictModel):
    lat: float = Field(ge=-80, le=84)
    lng: float = Field(ge=-180, le=180)
    address: str | None = Field(default=None, max_length=500)


class GeoClient(GeoPoint):
    id: int = Field(ge=1, le=MAX_CLIENTS)
    demand: int = Field(ge=1, le=10000)


class GeographicInstance(FleetModel):
    schema_version: Literal[2, 3] = 2
    road_matrix: RoadMatrix | None = None
    coordinate_system: Literal["geographic"] = "geographic"
    name: str = Field(default="Cenário no mapa", min_length=1, max_length=80)
    depot: GeoPoint
    clients: list[GeoClient] = Field(min_length=2, max_length=MAX_CLIENTS)
    vehicles: int = Field(default=5, ge=1, le=MAX_VEHICLES)
    capacity: int = Field(default=60, ge=1, le=10000)

    @model_validator(mode="after")
    def geography(self):
        from .coordinates import projected_coordinates

        if [c.id for c in self.clients] != list(range(1, len(self.clients) + 1)):
            raise ValueError("IDs devem ser consecutivos, ordenados e iniciar em 1.")
        if self.road_matrix is not None:
            if self.schema_version != 3:
                raise ValueError("Matriz viária exige o contrato geográfico v3.")
            points = [(p.lat, p.lng) for p in [self.depot, *self.clients]]
            if self.road_matrix.points != points:
                raise ValueError(
                    "Matriz viária pertence a outras coordenadas ou ordem de clientes."
                )
        elif self.schema_version == 2:
            projected_coordinates(self)
        return self


RoutingInstance = Instance | GeographicInstance


class RoadPointsRequest(StrictModel):
    points: list[GeoPoint] = Field(min_length=2, max_length=MAX_NODES + 1)


class RoadMatrixRequest(RoadPointsRequest):
    points: list[GeoPoint] = Field(min_length=3, max_length=MAX_NODES)


class GenerateRequest(StrictModel):
    customers: int = Field(default=40, ge=2, le=MAX_CLIENTS)
    vehicles: int = Field(default=5, ge=1, le=MAX_VEHICLES)
    capacity: int = Field(default=60, ge=1, le=10000)
    seed: int = Field(default=42, ge=0, le=2**32 - 1)
    distribution: Literal["uniform", "clustered", "ring"] = "clustered"
    max_demand: int = Field(default=9, ge=1, le=100)


class SolverConfig(StrictModel):
    adapter: Literal["ortools", "pyvrp"] = "ortools"
    seed: int | None = Field(default=None, ge=0, le=2**32 - 1)
    stop: Literal["iterations", "time"] = "iterations"
    max_iterations: int = Field(default=5000, ge=1, le=100000)
    time_limit: float = Field(default=5, ge=0.1, le=60)
    sample_every: int = Field(default=25, ge=10, le=1000)

    @model_validator(mode="after")
    def capabilities(self):
        if self.adapter == "ortools":
            self.seed = None
            self.stop = "time"
        elif self.seed is None:
            self.seed = 7
        return self


class RunRequest(StrictModel):
    instance: RoutingInstance
    config: SolverConfig = Field(default_factory=SolverConfig)
    initial_routes: list[Annotated[list[Annotated[int, Field(strict=True, ge=1, le=MAX_CLIENTS)]], Field(max_length=MAX_CLIENTS)]] | None = Field(default=None, max_length=MAX_VEHICLES)
    initial_origin: Literal["manual", "library"] = "library"


class PlanRequest(StrictModel):
    instance: RoutingInstance
    routes: list[Annotated[list[Annotated[int, Field(strict=True, ge=1, le=MAX_CLIENTS)]], Field(max_length=MAX_CLIENTS)]] = Field(max_length=MAX_VEHICLES)
