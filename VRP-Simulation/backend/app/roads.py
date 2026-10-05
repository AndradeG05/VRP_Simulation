"""Consulta custos e geometrias OSRM com cache e limite de requisições."""

from collections import OrderedDict
from concurrent.futures import Future
from datetime import datetime, timezone
import json
from math import isfinite
import os
from threading import BoundedSemaphore, Lock
from time import monotonic, sleep

import httpx

from .schemas import GeoPoint, RoadMatrix


class RoadError(ValueError):
    pass


class RoadService:
    def __init__(self, client=None, base_url=None, interval=None, table_size=100):
        self.base_url = (
            base_url
            or os.environ.get("OSRM_BASE_URL", "https://router.project-osrm.org")
        ).rstrip("/")
        self.photon_url = os.environ.get(
            "PHOTON_BASE_URL", "https://photon.komoot.io"
        ).rstrip("/")
        self.tile_url = os.environ.get(
            "OSM_TILE_BASE_URL", "https://tile.openstreetmap.org"
        ).rstrip("/")
        contact = os.environ.get("VRP_SIMULATION_CONTACT_URL")
        user_agent = "VRP Simulation/1.0"
        if contact:
            user_agent += f" (+{contact})"
        else:
            user_agent += " (OSM route laboratory)"
        self.client = client or httpx.Client(
            timeout=30, headers={"User-Agent": user_agent}
        )
        self.interval = (
            max(1.0, float(os.environ.get("OSRM_REQUEST_INTERVAL", "1")))
            if interval is None
            else interval
        )
        self.table_size = table_size
        self.lock, self.network_lock = Lock(), Lock()
        self.tile_lock = BoundedSemaphore(4)
        self.next_request = 0.0
        self.cache = OrderedDict()
        self.pending = {}
        self.cache_bytes = 0
        self.ttl = 900
        self.max_cache_bytes = 32 * 1024 * 1024
        self.tile_cache = OrderedDict()
        self.tile_pending = {}
        self.tile_cache_bytes = 0
        self.max_tile_cache_bytes = 32 * 1024 * 1024

    def close(self):
        self.client.close()

    def cached(self, key, produce):
        with self.lock:
            cached = self.cache.get(key)
            if cached and monotonic() - cached[0] < self.ttl:
                self.cache.move_to_end(key)
                return json.loads(cached[1])
            if cached:
                self.cache_bytes -= len(self.cache.pop(key)[1])
            future = self.pending.get(key)
            owner = future is None
            if owner:
                future = self.pending[key] = Future()
        if not owner:
            return future.result()
        try:
            result = produce()
            encoded = json.dumps(result, allow_nan=False).encode()
            with self.lock:
                if len(encoded) <= self.max_cache_bytes:
                    self.cache[key] = (monotonic(), encoded)
                    self.cache_bytes += len(encoded)
                    while self.cache_bytes > self.max_cache_bytes:
                        self.cache_bytes -= len(self.cache.popitem(last=False)[1][1])
            future.set_result(result)
            return result
        except Exception as exc:
            future.set_exception(exc)
            raise
        finally:
            with self.lock:
                self.pending.pop(key, None)

    def get(self, url, params):
        with self.network_lock:
            sleep(max(0, self.next_request - monotonic()))
            self.next_request = monotonic() + self.interval
            try:
                response = self.client.get(url, params=params)
                response.raise_for_status()
                data = response.json()
            except (httpx.HTTPError, ValueError) as exc:
                raise RoadError(
                    "O serviço de mapas não respondeu com dados válidos. Tente novamente; o cenário foi preservado."
                ) from exc
        if not isinstance(data, dict):
            raise RoadError("Resposta inválida do serviço de mapas.")
        return data

    @staticmethod
    def tile_ttl(cache_control):
        for directive in cache_control.split(","):
            name, separator, value = directive.strip().partition("=")
            if name.lower() == "max-age" and separator:
                try:
                    return max(0, int(value))
                except ValueError:
                    break
        return 604800

    def tile(self, z, x, y, referer=None):
        if not 0 <= z <= 19:
            raise RoadError("Nível de zoom inválido para o mapa.")
        edge = 1 << z
        if not 0 <= x < edge or not 0 <= y < edge:
            raise RoadError("Coordenada de imagem inválida para o mapa.")
        key = ("tile", self.tile_url, z, x, y)
        with self.lock:
            cached = self.tile_cache.get(key)
            if cached and monotonic() < cached[0]:
                self.tile_cache.move_to_end(key)
                return cached[1], dict(cached[2])
            if cached:
                self.tile_cache_bytes -= len(self.tile_cache.pop(key)[1])
            future = self.tile_pending.get(key)
            owner = future is None
            if owner:
                future = self.tile_pending[key] = Future()
        if not owner:
            return future.result()
        try:
            headers = {"Referer": referer} if referer else None
            response = None
            with self.tile_lock:
                for attempt in range(2):
                    try:
                        response = self.client.get(
                            f"{self.tile_url}/{z}/{x}/{y}.png", headers=headers
                        )
                        response.raise_for_status()
                        break
                    except httpx.HTTPError as exc:
                        if attempt:
                            raise RoadError(
                                "As imagens do mapa não responderam. Tente recarregar o mapa."
                            ) from exc
                        sleep(0.2)
            if response is None:
                raise RoadError("As imagens do mapa não responderam.")
            content_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
            if content_type != "image/png" or not response.content:
                raise RoadError("O provedor retornou uma imagem de mapa inválida.")
            cache_control = response.headers.get(
                "cache-control", "public, max-age=604800"
            )
            result = response.content, {"Cache-Control": cache_control}
            with self.lock:
                if len(response.content) <= self.max_tile_cache_bytes:
                    self.tile_cache[key] = (
                        monotonic() + self.tile_ttl(cache_control),
                        *result,
                    )
                    self.tile_cache_bytes += len(response.content)
                    while self.tile_cache_bytes > self.max_tile_cache_bytes:
                        self.tile_cache_bytes -= len(
                            self.tile_cache.popitem(last=False)[1][1]
                        )
            future.set_result(result)
            return result
        except Exception as exc:
            future.set_exception(exc)
            raise
        finally:
            with self.lock:
                self.tile_pending.pop(key, None)

    @staticmethod
    def coords(points):
        return ";".join(f"{p.lng},{p.lat}" for p in points)

    def osrm(self, service, points, params):
        data = self.get(
            f"{self.base_url}/{service}/v1/driving/{self.coords(points)}", params
        )
        if data.get("code") != "Ok" or data.get("fallback_speed_cells"):
            raise RoadError(
                f"OSRM não forneceu rotas utilizáveis ({data.get('code', 'resposta incompleta')}). Nenhum custo foi estimado."
            )
        return data

    @staticmethod
    def metres(value):
        if (
            type(value) not in (int, float)
            or not isfinite(value)
            or not 0 <= value <= 40_000_000
        ):
            raise RoadError(
                "OSRM retornou um trecho sem distância viária válida. Nenhum custo foi estimado."
            )
        return value

    def matrix(self, points):
        key = ("matrix", self.base_url, self.coords(points), self.table_size)

        def produce():
            n = len(points)
            distances = [[None] * n for _ in points]
            size = n if n <= self.table_size else self.table_size // 2
            requests = 0
            for i in range(0, n, size):
                for j in range(0, n, size):
                    sources, destinations = points[i : i + size], points[j : j + size]
                    same = i == j
                    locations = sources if same else sources + destinations
                    data = self.osrm(
                        "table",
                        locations,
                        {
                            "annotations": "distance",
                            "sources": ";".join(map(str, range(len(sources)))),
                            "destinations": ";".join(
                                map(
                                    str,
                                    range(0 if same else len(sources), len(locations)),
                                )
                            ),
                        },
                    )
                    rows = data.get("distances")
                    if not isinstance(rows, list) or len(rows) != len(sources):
                        raise RoadError("OSRM retornou uma matriz incompleta.")
                    for a, row in enumerate(rows):
                        if not isinstance(row, list) or len(row) != len(destinations):
                            raise RoadError("OSRM retornou uma matriz incompleta.")
                        for b, value in enumerate(row):
                            distances[i + a][j + b] = self.metres(value)
                    requests += 1
            if any(distances[i][i] != 0 for i in range(n)):
                raise RoadError("OSRM retornou custos não nulos na diagonal da matriz.")
            result = RoadMatrix(
                provider="osrm",
                method="table",
                endpoint=self.base_url,
                fetched_at=datetime.now(timezone.utc).isoformat(),
                points=[(p.lat, p.lng) for p in points],
                distances_m=distances,
            ).model_dump(mode="json")
            return {"matrix": result, "requests": requests}

        return self.cached(key, produce)

    def geometry(self, points):
        key = ("route", self.base_url, self.coords(points))

        def produce():
            legs, requests = [], 0
            for i in range(0, len(points) - 1, 99):
                chunk = points[i : i + 100]
                data = self.osrm(
                    "route",
                    chunk,
                    {
                        "steps": "true",
                        "geometries": "geojson",
                        "overview": "false",
                        "alternatives": "false",
                        "continue_straight": "false",
                    },
                )
                routes = data.get("routes")
                raw = (
                    routes[0].get("legs")
                    if isinstance(routes, list) and routes
                    else None
                )
                if not isinstance(raw, list) or len(raw) != len(chunk) - 1:
                    raise RoadError("OSRM não retornou todos os trechos da sequência.")
                for leg in raw:
                    metres = self.metres(leg.get("distance"))
                    path = []
                    for step in leg.get("steps", []):
                        for coord in step.get("geometry", {}).get("coordinates", []):
                            if not isinstance(coord, list) or len(coord) != 2:
                                raise RoadError("OSRM retornou uma geometria inválida.")
                            try:
                                point = GeoPoint(lat=coord[1], lng=coord[0]).model_dump(
                                    exclude_none=True
                                )
                            except ValueError as exc:
                                raise RoadError(
                                    "OSRM retornou coordenadas inválidas."
                                ) from exc
                            if not path or point != path[-1]:
                                path.append(point)
                    if not path or (metres > 0 and len(path) < 2):
                        raise RoadError(
                            "OSRM retornou um trecho sem geometria utilizável."
                        )
                    legs.append({"path": path, "distanceMetres": metres})
                requests += 1
            return {
                "legs": legs,
                "paths": [leg["path"] for leg in legs],
                "distanceMetres": sum(leg["distanceMetres"] for leg in legs),
                "warnings": [],
                "requests": requests,
            }

        return self.cached(key, produce)

    def places(self, query):
        query = " ".join(query.split())

        def produce():
            data = self.get(f"{self.photon_url}/api/", {"q": query, "limit": 5})
            features = data.get("features")
            if not isinstance(features, list):
                raise RoadError("Photon retornou uma busca inválida.")
            result = []
            for feature in features:
                coords = feature.get("geometry", {}).get("coordinates", [])
                props = feature.get("properties", {})
                if len(coords) != 2:
                    continue
                address = ", ".join(
                    dict.fromkeys(
                        str(props[k])
                        for k in (
                            "name",
                            "street",
                            "housenumber",
                            "district",
                            "city",
                            "state",
                            "country",
                        )
                        if props.get(k)
                    )
                )
                try:
                    result.append(
                        GeoPoint(
                            lat=coords[1], lng=coords[0], address=address[:500]
                        ).model_dump()
                    )
                except ValueError:
                    continue
            return result

        return self.cached(("places", self.photon_url, query), produce)
