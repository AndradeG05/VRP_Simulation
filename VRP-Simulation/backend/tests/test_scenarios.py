import copy
from decimal import Decimal, ROUND_HALF_UP
import json
import math
from pathlib import Path
import tempfile
import time
import unittest

import httpx
from fastapi.testclient import TestClient

from backend.app.instances import fingerprint, generate
from backend.app.main import create_app
from backend.app.ortools_solver import execute_ortools, initial_solution
from backend.app.roads import RoadError, RoadService
from backend.app.schemas import GenerateRequest, GeographicInstance, GeoPoint, SolverConfig
from backend.app.solver import execute

CHECKS = []
CONFIGS = [
    dict(adapter="ortools", stop="time", time_limit=.2, sample_every=10),
    dict(adapter="pyvrp", stop="time", time_limit=.2, seed=0, sample_every=10),
    dict(adapter="pyvrp", stop="iterations", max_iterations=40, seed=99, sample_every=25),
]
LAB_CASES = [
    dict(customers=2, vehicles=3, capacity=10, seed=0, distribution="uniform", max_demand=4),
    dict(customers=20, vehicles=3, capacity=40, seed=9, distribution="uniform", max_demand=4),
    dict(customers=40, vehicles=5, capacity=60, seed=42, distribution="clustered", max_demand=9),
    dict(customers=80, vehicles=10, capacity=80, seed=2**32-1, distribution="ring", max_demand=9),
    dict(customers=8, vehicles=3, capacity=30, seed=7, distribution="clustered", max_demand=5),
    dict(customers=60, vehicles=6, capacity=60, seed=123, distribution="ring", max_demand=4),
]


def directed_metres(a, b):
    return 0 if a == b else 1 + 17*a + 5*b + 3*abs(a-b) + .125


def map_instance(customers=8, heterogeneous=False):
    points = [dict(lat=round(-23.55 + i*.001, 7), lng=round(-46.65 + i*.0012, 7)) for i in range(customers+1)]
    data = dict(schema_version=3, name=f"Matriz controlada {customers}", depot=points[0],
                clients=[dict(**point, id=i, demand=2) for i, point in enumerate(points[1:], 1)],
                vehicles=4, capacity=20)
    data["road_matrix"] = dict(provider="osrm", method="table", endpoint="https://osrm.test",
                               fetched_at="2026-10-04T00:00:00+00:00",
                               points=[[p["lat"], p["lng"]] for p in points],
                               distances_m=[[directed_metres(a, b) for b in range(customers+1)] for a in range(customers+1)])
    if heterogeneous:
        data["fleet"] = [dict(id=i+1, capacity=cap) for i, cap in enumerate([2, 4, 8, 20])]
    return GeographicInstance.model_validate(data)


def audit(test, instance, solution):
    test.assertIsNotNone(solution)
    test.assertTrue(solution["feasible"])
    visits = [node for route in solution["routes"] for node in route["visits"]]
    test.assertEqual(sorted(visits), list(range(1, len(instance.clients)+1)))
    test.assertEqual(solution["served"], len(instance.clients))
    vehicle_ids = [r["vehicle"] for r in solution["routes"]]
    test.assertEqual(len(set(vehicle_ids)), len(vehicle_ids))
    test.assertLessEqual(len(vehicle_ids), instance.vehicles)
    total = 0
    for route in solution["routes"]:
        vehicle = route["vehicle"]
        test.assertIn(vehicle, range(1, instance.vehicles+1))
        capacity = instance.fleet[vehicle-1].capacity if instance.fleet else instance.capacity
        load = sum(instance.clients[node-1].demand for node in route["visits"])
        test.assertEqual(route["load"], load)
        test.assertLessEqual(load, capacity)
        closed = [0, *route["visits"], 0]
        cost = 0
        for a, b in zip(closed, closed[1:]):
            if getattr(instance, "road_matrix", None):
                cost += int((Decimal(str(instance.road_matrix.distances_m[a][b]))*1000).quantize(Decimal(1), rounding=ROUND_HALF_UP))
            elif getattr(instance, "vrp", None):
                cost += instance.vrp.costs_ticks[a][b]
            else:
                points = [instance.depot, *instance.clients]
                length = math.dist((points[a].x, points[a].y), (points[b].x, points[b].y))
                cost += int(Decimal(str(length*1000)).quantize(Decimal(1), rounding=ROUND_HALF_UP))
        test.assertEqual(route["cost_ticks"], cost)
        total += cost
    test.assertEqual(solution["cost_ticks"], total)


def scenario_test(kind, case, config):
    def test(self):
        if kind == "laboratorio":
            instance = generate(GenerateRequest(**case))
            if case["customers"] == 8:
                data = instance.model_dump()
                data["fleet"] = [dict(id=1, capacity=5), dict(id=2, capacity=10), dict(id=3, capacity=30)]
                instance = type(instance).model_validate(data)
            source = case
        else:
            instance = map_instance(case, heterogeneous=case == 15)
            source = {"matrix_source": "resposta controlada", "customers": case}
        before = instance.model_dump_json()
        baseline = initial_solution(instance)
        audit(self, instance, baseline)
        runner = execute_ortools if config["adapter"] == "ortools" else execute
        controls = SolverConfig(**config)
        result = runner(instance, controls, lambda *_: None, initial=baseline)
        audit(self, instance, result["solution"])
        self.assertEqual(instance.model_dump_json(), before)
        self.assertEqual(result["instance_hash"], fingerprint(instance))
        self.assertFalse(result["proven_optimal"])
        self.assertLessEqual(result["solution"]["cost_ticks"], baseline["cost_ticks"])
        CHECKS.append(dict(scenario=kind, input=source, config=controls.model_dump(),
                           customers=len(instance.clients), vehicles=instance.vehicles,
                           capacities=[v.capacity for v in instance.fleet] if instance.fleet else [instance.capacity]*instance.vehicles,
                           total_demand=sum(c.demand for c in instance.clients),
                           baseline_ticks=baseline["cost_ticks"], cost_ticks=result["solution"]["cost_ticks"],
                           used_vehicles=len(result["solution"]["routes"]), instance_hash=fingerprint(instance),
                           feasible=True, coverage=True, cost_audited=True))
    return test


class ScenarioTests(unittest.TestCase):
    pass


for index, case in enumerate(LAB_CASES):
    for cfg_index, config in enumerate(CONFIGS):
        setattr(ScenarioTests, f"test_lab_{index}_{cfg_index}_{config['adapter']}", scenario_test("laboratorio", case, config))
for customers in (2, 8, 15):
    for cfg_index, config in enumerate(CONFIGS):
        setattr(ScenarioTests, f"test_map_{customers}_{cfg_index}_{config['adapter']}", scenario_test("mapa", customers, config))


def table_transport(points, calls):
    indexes = {(round(p.lng, 7), round(p.lat, 7)): i for i, p in enumerate(points)}

    def handler(request):
        calls.append(str(request.url))
        locations = [indexes[tuple(map(float, pair.split(',')))] for pair in request.url.path.rsplit('/', 1)[1].split(';')]
        sources = [locations[int(i)] for i in request.url.params['sources'].split(';')]
        destinations = [locations[int(i)] for i in request.url.params['destinations'].split(';')]
        return httpx.Response(200, json={"code": "Ok", "distances": [[directed_metres(a, b) for b in destinations] for a in sources]})
    return httpx.MockTransport(handler)


class RoadServiceTests(unittest.TestCase):
    def test_block_matrix_preserves_order_direction_and_cache(self):
        instance = map_instance(8)
        points = [instance.depot, *instance.clients]
        calls = []
        service = RoadService(httpx.Client(transport=table_transport(points, calls)), interval=0, table_size=4)
        self.addCleanup(service.close)
        result = service.matrix(points)
        self.assertEqual(result["matrix"]["distances_m"], instance.road_matrix.distances_m)
        self.assertEqual(result["requests"], 25)
        self.assertNotEqual(result["matrix"]["distances_m"][1][2], result["matrix"]["distances_m"][2][1])
        result["matrix"]["distances_m"][1][2] = 9999
        cached = service.matrix(points)
        self.assertEqual(cached["matrix"]["distances_m"][1][2], 31.125)
        self.assertEqual(len(calls), 25)

    def test_provider_failures_do_not_create_distances(self):
        points = [GeoPoint(lat=0, lng=i*.001) for i in range(3)]
        cases = [
            (503, {"code": "NoRoute"}),
            (200, {"code": "NoRoute"}),
            (200, {"code": "Ok", "distances": [[0, 1], [1, 0]]}),
            (200, {"code": "Ok", "distances": [[0, None, 2], [1, 0, 2], [1, 2, 0]]}),
            (200, {"code": "Ok", "distances": [[0, -1, 2], [1, 0, 2], [1, 2, 0]]}),
            (200, {"code": "Ok", "distances": [[1, 1, 2], [1, 0, 2], [1, 2, 0]]}),
        ]
        for status, payload in cases:
            with self.subTest(status=status, payload=payload):
                service = RoadService(httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(status, json=payload))), interval=0)
                try:
                    with self.assertRaises(RoadError):
                        service.matrix(points)
                    self.assertFalse(service.cache)
                finally:
                    service.close()

    def test_route_geometry_chunks_and_preserves_all_legs(self):
        points = [GeoPoint(lat=0, lng=i*.001) for i in range(102)]
        calls = []

        def handler(request):
            calls.append(str(request.url))
            coords = [list(map(float, pair.split(','))) for pair in request.url.path.rsplit('/', 1)[1].split(';')]
            legs = [dict(distance=100.25, steps=[dict(geometry=dict(coordinates=[a, a, b]))]) for a, b in zip(coords, coords[1:])]
            return httpx.Response(200, json=dict(code="Ok", routes=[dict(legs=legs)]))

        service = RoadService(httpx.Client(transport=httpx.MockTransport(handler)), interval=0)
        self.addCleanup(service.close)
        result = service.geometry(points)
        self.assertEqual(result["requests"], 2)
        self.assertEqual(len(result["legs"]), 101)
        self.assertEqual(result["distanceMetres"], 10125.25)
        self.assertEqual(result["paths"][0], [dict(lat=0., lng=0.), dict(lat=0., lng=.001)])
        self.assertEqual(result["paths"][-1][-1], dict(lat=0., lng=.101))

    def test_missing_geometry_is_rejected(self):
        service = RoadService(httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=dict(code="Ok", routes=[dict(legs=[dict(distance=10, steps=[])])])))), interval=0)
        self.addCleanup(service.close)
        with self.assertRaises(RoadError):
            service.geometry([GeoPoint(lat=0, lng=0), GeoPoint(lat=0, lng=.001)])


class MapApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        app = create_app(str(Path(cls.temp.name)/"tests.db"))
        instance = map_instance(8)
        cls.data = instance.model_dump(mode="json")
        cls.points = [instance.depot, *instance.clients]
        app.state.roads.client.close()
        app.state.roads.client = httpx.Client(transport=table_transport(cls.points, []))
        app.state.roads.interval = 0
        cls.client = TestClient(app)
        cls.client.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)
        cls.temp.cleanup()

    def test_matrix_preview_jobs_export_replay_both_solvers(self):
        response = self.client.post('/api/roads/matrix', json=dict(points=[dict(lat=p.lat, lng=p.lng) for p in self.points]))
        self.assertEqual(response.status_code, 200, response.text)
        data = copy.deepcopy(self.data)
        data['road_matrix'] = response.json()['matrix']
        preview = self.client.post('/api/instances/preview', json=data)
        self.assertEqual(preview.status_code, 200, preview.text)
        self.assertTrue(preview.json()['baseline']['feasible'])
        for adapter in ('ortools', 'pyvrp'):
            with self.subTest(adapter=adapter):
                response = self.client.post('/api/runs', json=dict(instance=data, config=dict(adapter=adapter, stop='time', time_limit=.2)))
                self.assertEqual(response.status_code, 202, response.text)
                run_id = response.json()['id']
                deadline = time.monotonic()+30
                while True:
                    run = self.client.get('/api/runs/'+run_id).json()
                    if run['status'] not in ('queued', 'running'):
                        break
                    self.assertLess(time.monotonic(), deadline)
                    time.sleep(.025)
                self.assertEqual(run['status'], 'completed', run.get('error'))
                audit(self, GeographicInstance.model_validate(data), run['result']['solution'])
                exported = self.client.get(f'/api/runs/{run_id}/export').json()
                replay = self.client.post('/api/replays/validate', json=exported)
                self.assertEqual(replay.status_code, 200, replay.text)
                self.assertEqual(replay.json()['preview']['hash'], preview.json()['hash'])
                self.assertTrue(exported['events'])
                exported['result']['solution']['cost_ticks'] += 1
                self.assertEqual(self.client.post('/api/replays/validate', json=exported).status_code, 422)

    def test_missing_matrix_blocks_search_and_manual_plan(self):
        data = copy.deepcopy(self.data)
        data['road_matrix'] = None
        preview = self.client.post('/api/instances/preview', json=data)
        self.assertEqual(preview.status_code, 200)
        self.assertFalse(preview.json()['cost_ready'])
        self.assertIsNone(preview.json()['baseline'])
        self.assertEqual(self.client.post('/api/runs', json=dict(instance=data)).status_code, 422)
        self.assertEqual(self.client.post('/api/plans/validate', json=dict(instance=data, routes=[[1,2,3,4,5,6,7,8]])).status_code, 422)

    def test_coordinate_edit_invalidates_matrix_but_demand_edit_keeps_costs(self):
        data = copy.deepcopy(self.data)
        data['clients'][0]['lng'] += .01
        self.assertEqual(self.client.post('/api/instances/preview', json=data).status_code, 422)
        data = copy.deepcopy(self.data)
        data['clients'][0]['demand'] = 3
        response = self.client.post('/api/instances/preview', json=data)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['instance']['road_matrix'], self.data['road_matrix'])

    def test_capacity_and_solver_limits_block_invalid_search(self):
        data = copy.deepcopy(self.data)
        data.update(vehicles=1, capacity=1)
        self.assertEqual(self.client.post('/api/runs', json=dict(instance=data)).status_code, 422)
        for config in (dict(time_limit=.01), dict(max_iterations=0), dict(seed=-1), dict(sample_every=1)):
            with self.subTest(config=config):
                self.assertEqual(self.client.post('/api/runs', json=dict(instance=self.data, config=config)).status_code, 422)

    def test_manual_plan_retains_vehicle_slots_and_rejects_duplicate_clients(self):
        response = self.client.post('/api/plans/validate', json=dict(instance=self.data, routes=[[], [1,2,3,4,5,6,7,8]]))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()['feasible'])
        self.assertEqual(response.json()['routes'][0]['vehicle'], 2)
        response = self.client.post('/api/plans/validate', json=dict(instance=self.data, routes=[[1,1,2,3,4,5,6,7,8]]))
        self.assertFalse(response.json()['feasible'])
