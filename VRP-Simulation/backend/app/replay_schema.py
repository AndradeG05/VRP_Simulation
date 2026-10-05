from math import isfinite
from typing import Annotated, Literal

from pydantic import ConfigDict, Field, JsonValue, model_validator

from .limits import MAX_CLIENTS, MAX_EVENTS, MAX_VEHICLES
from .schemas import RunRequest, StrictModel


ReplayId = Annotated[str, Field(strict=True, min_length=1, max_length=200)]
InstanceHash = Annotated[str, Field(strict=True, pattern=r'^[a-f0-9]{64}$')]
Counter = Annotated[int, Field(strict=True, ge=0)]
Cost = Annotated[int, Field(strict=True, ge=0)]
MetadataText = Annotated[str, Field(strict=True, min_length=1, max_length=2000)]


class ReplayRoute(StrictModel):
    vehicle: int = Field(strict=True, ge=1, le=MAX_VEHICLES)
    visits: list[Annotated[int, Field(strict=True, ge=1, le=MAX_CLIENTS)]] = Field(min_length=1, max_length=MAX_CLIENTS)
    load: int = Field(strict=True, ge=1, le=10000)
    cost_ticks: Cost
    solver_route_index: Counter | None = None


class ReplaySolution(StrictModel):
    feasible: bool = Field(strict=True)
    errors: list[str] = Field(default_factory=list, max_length=100)
    cost_ticks: Cost
    routes: list[ReplayRoute] = Field(min_length=1, max_length=MAX_VEHICLES)
    served: int = Field(strict=True, ge=2, le=MAX_CLIENTS)
    origin: str | None = Field(default=None, max_length=500)


class EventMetadata(StrictModel):
    schema_version: Literal[1] | None = None
    run_id: ReplayId | None = None
    instance_hash: InstanceHash | None = None
    sequence: int | None = Field(default=None, strict=True, ge=1)


class EventPayload(EventMetadata):
    elapsed: float = Field(strict=True, ge=0)
    iteration: Counter | None = None
    observed: Counter | None = None


class CheckpointPayload(EventPayload):
    solution: ReplaySolution
    best_cost_ticks: Cost | None = None
    reason: Literal['initial', 'improvement', 'observed', 'final'] | None = None


class SamplePayload(EventPayload):
    best_cost_ticks: Cost | None = None
    current_cost_ticks: Cost | None = None
    candidate_cost_ticks: Cost | None = None
    current_feasible: bool | None = Field(default=None, strict=True)
    candidate_feasible: bool | None = Field(default=None, strict=True)
    current_penalised_cost: float | None = Field(default=None, strict=True, ge=0)


class CheckpointEvent(EventMetadata):
    id: int = Field(strict=True, ge=1)
    kind: Literal['checkpoint']
    payload: CheckpointPayload


class SampleEvent(EventMetadata):
    id: int = Field(strict=True, ge=1)
    kind: Literal['sample']
    payload: SamplePayload


class ReplayResult(StrictModel):
    model_config = ConfigDict(extra='allow', allow_inf_nan=False)
    __pydantic_extra__: dict[str, JsonValue] = Field(init=False)
    instance_hash: InstanceHash
    solution: ReplaySolution | None = None
    iterations: Counter | None
    solver_runtime: float = Field(strict=True, ge=0)
    wall_runtime: float = Field(strict=True, ge=0)
    stop_reason: MetadataText
    checkpoints: Counter
    versions: dict[MetadataText, MetadataText] = Field(min_length=1, max_length=30)
    proven_optimal: bool = Field(strict=True)
    algorithm: MetadataText
    distance_convention: MetadataText
    observed_solutions: Counter | None = None
    omitted_snapshots: Counter | None = None
    coalesced_events: Counter | None = None

    @model_validator(mode='after')
    def supported_certification(self):
        if self.proven_optimal:
            raise ValueError('Os adaptadores deste contrato não fornecem certificado de otimalidade.')
        return self


class ReplayRequest(StrictModel):
    schema_version: Literal[1]
    id: ReplayId
    status: Literal['completed', 'cancelled', 'no_solution', 'failed', 'interrupted']
    created: str = Field(min_length=1, max_length=64)
    request: RunRequest
    baseline: ReplaySolution | None = None
    result: ReplayResult | None = None
    error: str | None = None
    cancel: Literal[0, 1] = 0
    events: list[Annotated[CheckpointEvent | SampleEvent, Field(discriminator='kind')]] = Field(max_length=MAX_EVENTS)
    statistics: list[dict[str, JsonValue]] = Field(default_factory=list, max_length=100_000)

    @model_validator(mode='before')
    @classmethod
    def finite_values(cls, value):
        pending = [value]
        while pending:
            item = pending.pop()
            if isinstance(item, float) and not isfinite(item):
                raise ValueError('O replay contém um número não finito.')
            if isinstance(item, dict):
                pending.extend(item.values())
            elif isinstance(item, list):
                pending.extend(item)
        return value

    @model_validator(mode='after')
    def completed_solution(self):
        if self.status == 'completed' and (self.result is None or self.result.solution is None):
            raise ValueError('Uma execução concluída exige solução final.')
        if self.status == 'no_solution' and self.result is not None and self.result.solution is not None:
            raise ValueError('Uma execução sem solução não pode declarar solução final.')
        return self
