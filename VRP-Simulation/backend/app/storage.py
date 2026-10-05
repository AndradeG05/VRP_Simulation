import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


class Store:
    def __init__(self, path: str):
        self.path = path

    @contextmanager
    def connection(self):
        con = sqlite3.connect(self.path, timeout=15)
        con.row_factory = sqlite3.Row
        try:
            yield con
            con.commit()
        finally:
            con.close()

    def initialise(self):
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as con:
            con.execute("PRAGMA journal_mode=WAL")
            con.executescript("""
                CREATE TABLE IF NOT EXISTS runs (
                    id TEXT PRIMARY KEY, status TEXT NOT NULL, created TEXT NOT NULL,
                    request TEXT NOT NULL, baseline TEXT, result TEXT, error TEXT,
                    cancel INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL,
                    kind TEXT NOT NULL, payload TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS events_run ON events(run_id, id);
                CREATE TABLE IF NOT EXISTS statistics (run_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
            """)

    def create(self, run_id, request, baseline):
        with self.connection() as con:
            con.execute(
                "INSERT INTO runs(id,status,created,request,baseline) VALUES (?,?,?,?,?)",
                (
                    run_id,
                    "queued",
                    datetime.now(timezone.utc).isoformat(),
                    json.dumps(request),
                    json.dumps(baseline),
                ),
            )

    def get(self, run_id):
        with self.connection() as con:
            row = con.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
        if row is None:
            return None
        result = {"schema_version": 1, **dict(row)}
        for field in ("request", "baseline", "result"):
            result[field] = json.loads(result[field]) if result[field] else None
        return result

    def history(self):
        with self.connection() as con:
            rows = con.execute(
                "SELECT id,status,created,request,result FROM runs ORDER BY created DESC LIMIT 50"
            ).fetchall()
        return [
            {
                "id": r["id"],
                "status": r["status"],
                "created": r["created"],
                "name": json.loads(r["request"])["instance"]["name"],
                "result": json.loads(r["result"]) if r["result"] else None,
            }
            for r in rows
        ]

    def status(self, run_id, status, result=None, error=None):
        with self.connection() as con:
            con.execute(
                "UPDATE runs SET status=?,result=?,error=? WHERE id=?",
                (
                    status,
                    json.dumps(result) if result is not None else None,
                    error,
                    run_id,
                ),
            )

    def append(self, run_id, kind, payload):
        with self.connection() as con:
            con.execute(
                "INSERT INTO events(run_id,kind,payload) VALUES (?,?,?)",
                (run_id, kind, json.dumps(payload, allow_nan=False)),
            )

    def events(self, run_id, after=0, limit=1000):
        with self.connection() as con:
            rows = con.execute(
                "SELECT id,kind,payload FROM events WHERE run_id=? AND id>? ORDER BY id LIMIT ?",
                (run_id, after, limit),
            ).fetchall()
        events = []
        for row in rows:
            payload = json.loads(row["payload"])
            events.append(
                {
                    "id": row["id"],
                    "kind": row["kind"],
                    "payload": payload,
                    "schema_version": 1,
                    "run_id": run_id,
                    "instance_hash": payload.get("instance_hash"),
                    "sequence": payload.get("sequence"),
                }
            )
        return events

    def cancel(self, run_id):
        with self.connection() as con:
            con.execute("UPDATE runs SET cancel=1 WHERE id=?", (run_id,))

    def is_cancelled(self, run_id):
        with self.connection() as con:
            return bool(
                con.execute("SELECT cancel FROM runs WHERE id=?", (run_id,)).fetchone()[
                    0
                ]
            )

    def save_statistics(self, run_id, stats):
        with self.connection() as con:
            con.execute(
                "INSERT OR REPLACE INTO statistics VALUES (?,?)",
                (run_id, json.dumps(stats, allow_nan=False)),
            )

    def statistics(self, run_id):
        with self.connection() as con:
            row = con.execute(
                "SELECT payload FROM statistics WHERE run_id=?", (run_id,)
            ).fetchone()
        return json.loads(row[0]) if row else []

    def recover(self):
        with self.connection() as con:
            con.execute(
                "UPDATE runs SET status='interrupted',error='Execução interrompida pelo encerramento do servidor.' WHERE status IN ('queued','running')"
            )
