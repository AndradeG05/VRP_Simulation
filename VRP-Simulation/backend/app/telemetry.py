"""Retira auditoria e persistência do callback de busca por meio de uma fila."""

from queue import Queue, Full
from threading import Thread


class Telemetry:
    def __init__(self, instance, emit, capacity=512, identity=None):
        self.instance, self.emit = instance, emit
        self.queue = Queue(capacity)
        self.dropped = 0
        self.stored_snapshots = self.observed_snapshots = 0
        self.statistics = []
        self.error = None
        self.identity = identity
        self.final_solution = None
        self.thread = Thread(target=self.consume, daemon=True)
        self.thread.start()

    def push(self, kind, payload, essential=False):
        if essential:
            self.queue.put((kind, payload))
            return
        try:
            self.queue.put_nowait((kind, payload))
        except Full:
            self.dropped += 1

    def consume(self):
        from .ortools_solver import audit

        while True:
            item = self.queue.get()
            if item is None:
                self.queue.task_done()
                return
            kind, payload = item
            try:
                if kind == "checkpoint":
                    if "raw_routes" in payload:
                        payload["solution"] = audit(
                            self.instance,
                            payload.pop("raw_routes"),
                            payload.pop("raw_cost"),
                            payload.pop("raw_vehicles", None),
                        )
                    if self.identity:
                        payload["solution"]["routes"] = self.identity.assign(
                            payload["solution"]["routes"]
                        )
                    if payload["reason"] == "final":
                        self.final_solution = payload["solution"]
                    self.stored_snapshots += 1
                    if payload["reason"] not in ("initial", "final"):
                        self.observed_snapshots += 1
                else:
                    self.statistics.append(dict(payload))
                self.emit(kind, payload)
            except Exception as exc:
                self.error = exc
            finally:
                self.queue.task_done()

    def close(self):
        self.queue.put(None)
        self.thread.join()
        if self.error:
            raise self.error
