import logging
import multiprocessing
import threading
from time import perf_counter
from uuid import uuid4

from .ortools_solver import execute_ortools, initial_solution
from .instances import fingerprint
from .schemas import RunRequest
from .solver import execute
from .storage import Store
from .validation import validate_routes


def worker(path: str, run_id: str, payload: dict):
    store = Store(path)
    request = RunRequest.model_validate(payload)
    store.status(run_id, "running")
    last_check = 0.0
    stopped = False

    def cancelled():
        nonlocal last_check, stopped
        now = perf_counter()
        if now - last_check >= 0.1:
            stopped = store.is_cancelled(run_id)
            last_check = now
        return stopped

    sequence = 0
    problem_hash = fingerprint(request.instance)

    def publish(kind, value):
        nonlocal sequence
        sequence += 1
        store.append(
            run_id,
            kind,
            {
                **value,
                "schema_version": 1,
                "run_id": run_id,
                "instance_hash": problem_hash,
                "sequence": sequence,
            },
        )

    try:
        runner = execute_ortools if request.config.adapter == "ortools" else execute
        result = runner(
            request.instance,
            request.config,
            publish,
            cancelled,
            initial=store.get(run_id)["baseline"],
        )
        store.save_statistics(run_id, result.pop("statistics"))
        status = (
            "cancelled"
            if result["stop_reason"] == "cancelled"
            else "completed"
            if result["solution"]
            else "no_solution"
        )
        store.status(run_id, status, result)
    except Exception:
        logging.exception("Solver failed for run %s", run_id)
        store.status(
            run_id,
            "failed",
            error="Falha na execução do solver. Consulte o log do backend.",
        )


class Jobs:
    """Gerencia até duas buscas em processos separados por instância da API."""

    def __init__(self, store: Store):
        self.store = store
        self.processes = {}
        self.lock = threading.Lock()
        self.cancel_times = {}

    def reap(self):
        for run_id, process in list(self.processes.items()):
            if (
                process.is_alive()
                and run_id in self.cancel_times
                and perf_counter() - self.cancel_times[run_id] > 5
            ):
                process.terminate()
                process.join(timeout=2)
                self.store.status(
                    run_id,
                    "interrupted",
                    error="Recuperação por encerramento do processo; snapshots já persistidos foram preservados.",
                )
            if not process.is_alive():
                process.join()
                row = self.store.get(run_id)
                if row and row["status"] in ("queued", "running"):
                    self.store.status(
                        run_id,
                        "failed",
                        error="O processo do solver encerrou inesperadamente.",
                    )
                process.close()
                del self.processes[run_id]
                self.cancel_times.pop(run_id, None)

    def submit(self, request: RunRequest):
        with self.lock:
            self.reap()
            if len(self.processes) >= 2:
                raise RuntimeError(
                    "Há duas execuções em andamento. Aguarde ou cancele uma delas."
                )
            run_id = uuid4().hex
            initial = (
                None
                if request.initial_routes is not None
                else initial_solution(request.instance)
            )
            if request.initial_routes is not None:
                if len(request.initial_routes) > request.instance.vehicles:
                    raise ValueError("Índice de veículo excede a frota.")
                routes = [r for r in request.initial_routes if r]
                initial = validate_routes(
                    request.instance,
                    routes,
                    vehicles=[i + 1 for i, r in enumerate(request.initial_routes) if r],
                )
                if not initial["feasible"]:
                    raise ValueError("; ".join(initial["errors"]))
                for record, idx in zip(
                    initial["routes"],
                    [i + 1 for i, r in enumerate(request.initial_routes) if r],
                ):
                    record["vehicle"] = idx
                initial["origin"] = (
                    "manual"
                    if request.initial_origin == "manual"
                    else "OR-Tools PATH_CHEAPEST_ARC · primeira solução viável"
                )
            payload = request.model_dump()
            self.store.create(run_id, payload, initial)
            process = multiprocessing.get_context("spawn").Process(
                target=worker, args=(self.store.path, run_id, payload)
            )
            try:
                process.start()
            except Exception:
                self.store.status(
                    run_id,
                    "failed",
                    error="Não foi possível iniciar o processo do solver.",
                )
                raise
            self.processes[run_id] = process
            return run_id

    def cancel(self, run_id):
        self.store.cancel(run_id)
        self.cancel_times.setdefault(run_id, perf_counter())

    def shutdown(self):
        for run_id in self.processes:
            self.store.cancel(run_id)
        for run_id, process in self.processes.items():
            process.join(timeout=3)
            if process.is_alive():
                process.terminate()
                process.join(timeout=3)
                self.store.status(
                    run_id,
                    "interrupted",
                    error="Servidor encerrado durante a execução.",
                )
            process.close()
        self.processes.clear()
