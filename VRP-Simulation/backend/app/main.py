import csv
import importlib.metadata
import io
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response

from .ortools_solver import initial_solution, CAPABILITIES
from .instances import capacity_issues, fingerprint, generate
from .jobs import Jobs
from .schemas import (
    GenerateRequest,
    VrpImportRequest,
    RoutingInstance,
    RunRequest,
    PlanRequest,
    RoadPointsRequest,
    RoadMatrixRequest,
)
from .replay_schema import ReplayRequest
from .roads import RoadError, RoadService
from .storage import Store
from .coordinates import geographic_metadata
from .validation import validate_routes
from .replay import validate_replay


def create_app(db_path: str | None = None):
    store = Store(
        db_path
        or os.environ.get(
            "VRP_SIMULATION_DB",
            str(Path(__file__).resolve().parents[2] / "data" / "routescope.db"),
        )
    )
    jobs = Jobs(store)
    roads = RoadService()

    @asynccontextmanager
    async def lifespan(app):
        store.initialise()
        store.recover()
        yield
        jobs.shutdown()
        roads.close()

    app = FastAPI(title="VRP Simulation", version="1.0.0", lifespan=lifespan)
    app.state.roads = roads

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, exc):
        errors = [{key: error[key] for key in ("type", "loc", "msg")} for error in exc.errors()]
        return JSONResponse(status_code=422, content={"detail": errors})

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    @app.middleware("http")
    async def body_limit(request: Request, call_next):
        if request.method == "POST":
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > (
                    25_000_000
                    if request.url.path
                    in (
                        "/api/replays/validate",
                        "/api/instances/preview",
                        "/api/instances/import-vrp",
                        "/api/plans/validate",
                        "/api/runs",
                    )
                    else 256_000
                ):
                    return Response("Request body too large", status_code=413)
            request._body = bytes(body)
        return await call_next(request)

    def get_run(run_id):
        with jobs.lock:
            jobs.reap()
        run = store.get(run_id)
        if not run:
            raise HTTPException(404, "Execução não encontrada.")
        return run

    def preview(instance):
        cost_ready = (
            getattr(instance, "schema_version", None) != 3
            or instance.road_matrix is not None
        )
        initial = initial_solution(instance) if cost_ready else None
        return {
            "instance": instance.model_dump(),
            "cost_ready": cost_ready,
            **geographic_metadata(instance),
            "hash": fingerprint(instance),
            "baseline": initial,
            "issues": capacity_issues(instance),
            "feasibility_status": "proven_infeasible"
            if capacity_issues(instance)
            else "feasible"
            if initial
            else "unknown",
            "total_demand": sum(c.demand for c in instance.clients),
        }

    @app.get("/api/health")
    def health():
        return {
            "status": "ok",
            "solver": "OR-Tools + PyVRP",
            "versions": {
                n: importlib.metadata.version(n) for n in ("ortools", "pyvrp")
            },
            "capabilities": CAPABILITIES,
        }

    @app.post("/api/instances/generate")
    def generate_instance(request: GenerateRequest):
        return preview(generate(request))

    @app.post("/api/roads/matrix")
    def road_matrix(request: RoadMatrixRequest):
        if len(request.points) < 3:
            raise HTTPException(422, "Defina um depósito e pelo menos duas entregas.")
        try:
            return roads.matrix(request.points)
        except RoadError as exc:
            raise HTTPException(502, str(exc)) from exc

    @app.post("/api/roads/geometry")
    def road_geometry(request: RoadPointsRequest):
        try:
            return roads.geometry(request.points)
        except RoadError as exc:
            raise HTTPException(502, str(exc)) from exc

    @app.get("/api/places")
    def places(q: str = Query(min_length=3, max_length=200)):
        try:
            return roads.places(q)
        except RoadError as exc:
            raise HTTPException(502, str(exc)) from exc

    @app.get("/api/tiles/{z}/{x}/{y}.png")
    def road_tile(z: int, x: int, y: int, request: Request):
        try:
            content, headers = roads.tile(z, x, y, request.headers.get("referer"))
        except RoadError as exc:
            raise HTTPException(502, str(exc)) from exc
        return Response(content, media_type="image/png", headers=headers)

    @app.post("/api/instances/import-vrp")
    def import_vrp(request: VrpImportRequest):
        from .vrp_import import parse_vrp
        try:
            return preview(parse_vrp(request.text, request.filename, request.vehicles))
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    @app.post("/api/instances/preview")
    def preview_instance(instance: RoutingInstance):
        return preview(instance)

    @app.post("/api/replays/validate")
    def replay(payload: ReplayRequest):
        try:
            return validate_replay(payload)
        except (ValueError, KeyError, TypeError) as exc:
            raise HTTPException(422, f"Replay inválido: {exc}") from exc

    @app.post("/api/plans/validate")
    def validate_plan(request: PlanRequest):
        if (
            getattr(request.instance, "schema_version", None) == 3
            and not request.instance.road_matrix
        ):
            raise HTTPException(
                422, "Calcule a matriz viária antes de validar o plano."
            )
        result = validate_routes(
            request.instance,
            [r for r in request.routes if r],
            vehicles=[i + 1 for i, r in enumerate(request.routes) if r],
        )
        if len(request.routes) > request.instance.vehicles:
            result["errors"].append("Índice de veículo excede a frota.")
            result["feasible"] = False
        for record, idx in zip(
            result["routes"], [i + 1 for i, r in enumerate(request.routes) if r]
        ):
            record["vehicle"] = idx
        result["origin"] = "manual"
        return result

    @app.post("/api/runs", status_code=202)
    def start_run(request: RunRequest):
        if (
            getattr(request.instance, "schema_version", None) == 3
            and not request.instance.road_matrix
        ):
            raise HTTPException(422, "Calcule a matriz viária antes de otimizar.")
        if getattr(request.instance, "coordinate_system", None) == "geographic" and (
            not request.instance.road_matrix
            or request.instance.road_matrix.provider != "osrm"
        ):
            raise HTTPException(
                422,
                "Novas buscas no mapa exigem custos OSRM. Consulte a matriz viária.",
            )
        issues = capacity_issues(request.instance)
        if issues:
            raise HTTPException(422, " ".join(issues))
        try:
            run_id = jobs.submit(request)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(429, str(exc)) from exc
        return store.get(run_id)

    @app.get("/api/runs")
    def history():
        with jobs.lock:
            jobs.reap()
        return store.history()

    @app.get("/api/runs/{run_id}")
    def read_run(run_id: str):
        return get_run(run_id)

    @app.get("/api/runs/{run_id}/events")
    def events(run_id: str, after: int = Query(default=0, ge=0)):
        run = get_run(run_id)
        events = store.events(run_id, after)
        return {
            "events": events,
            "cursor": events[-1]["id"] if events else after,
            "has_more": len(events) == 1000,
            "status": run["status"],
        }

    @app.post("/api/runs/{run_id}/cancel", status_code=202)
    def cancel(run_id: str):
        run = get_run(run_id)
        if run["status"] in ("queued", "running"):
            with jobs.lock:
                jobs.cancel(run_id)
        return {
            "id": run_id,
            "cancel_requested": run["status"] in ("queued", "running"),
        }

    @app.get("/api/runs/{run_id}/export")
    def export(run_id: str, format: Literal["json", "csv", "sol"] = "json"):
        run = get_run(run_id)
        if run["status"] in ("queued", "running"):
            raise HTTPException(
                409,
                "Aguarde a conclusão ou cancele para exportar uma execução consistente.",
            )
        if format == "json":
            payload = {
                "schema_version": 1,
                **run,
                "events": store.events(run_id, limit=1000000),
                "statistics": store.statistics(run_id),
            }
            content, media = (
                json.dumps(payload, ensure_ascii=False, allow_nan=False),
                "application/json",
            )
        elif format == "csv":
            stats = store.statistics(run_id)
            stream = io.StringIO(newline="")
            if stats:
                writer = csv.DictWriter(stream, fieldnames=list(stats[0]))
                writer.writeheader()
                writer.writerows(stats)
            content, media = stream.getvalue(), "text/csv"
        else:
            solution = (run["result"] or {}).get("solution")
            if not solution:
                raise HTTPException(409, "Não há solução viável nesta execução.")
            content = "\n".join(
                f"Route #{r['vehicle']}: " + " ".join(map(str, r["visits"]))
                for r in solution["routes"]
            )
            content += f"\nCost {solution['cost_ticks']}\n"
            media = "text/plain"
        return Response(
            content,
            media_type=media,
            headers={
                "Content-Disposition": f'attachment; filename="vrp-simulation-{run_id}.{format}"'
            },
        )

    return app


app = create_app()

