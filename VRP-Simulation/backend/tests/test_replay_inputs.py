import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app.instances import fingerprint
from backend.app.main import create_app
from backend.app.schemas import GenerateRequest, GeographicInstance, Instance, RoadMatrixRequest, RoadPointsRequest, RunRequest
from backend.app.storage import Store
from backend.app.validation import validate_routes


class ReplayInputTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.db = str(Path(cls.temp.name) / 'test.db')
        cls.client = TestClient(create_app(cls.db), raise_server_exceptions=False)
        cls.client.__enter__()
        instance = Instance(depot={'x': 0, 'y': 0}, clients=[
            {'id': 1, 'x': 1, 'y': 0, 'demand': 2},
            {'id': 2, 'x': 2, 'y': 0, 'demand': 3},
        ], vehicles=1, capacity=10)
        cls.solution = validate_routes(instance, [[1, 2]])
        store = Store(cls.db)
        store.create('replay-test', RunRequest(instance=instance).model_dump(), cls.solution)
        store.status('replay-test', 'completed', dict(
            solution=cls.solution, instance_hash=fingerprint(instance), iterations=None,
            solver_runtime=0.1, wall_runtime=0.2, stop_reason='time', checkpoints=0,
            versions={'ortools': 'test'}, proven_optimal=False,
            algorithm='Resultado controlado para teste de replay', distance_convention='euclidean',
        ))
        cls.payload = cls.client.get('/api/runs/replay-test/export').json()

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)
        cls.temp.cleanup()

    def validate(self, payload):
        return self.client.post('/api/replays/validate', content=json.dumps(payload), headers={'Content-Type': 'application/json'})

    def test_canonical_export_still_validates(self):
        response = self.validate(self.payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['run']['result']['solution'], self.solution)

    def test_event_payload_must_be_an_object(self):
        for invalid in ([], None, 'payload', 1, True):
            with self.subTest(payload=invalid):
                payload = copy.deepcopy(self.payload)
                payload['events'] = [{'id': 1, 'kind': 'sample', 'payload': invalid}]
                response = self.validate(payload)
                self.assertEqual(response.status_code, 422, response.text)
                self.assertIn('detail', response.json())

    def test_checkpoint_requires_a_complete_audited_solution(self):
        for invalid in ({}, None, [], {'routes': []}, {'feasible': True, 'routes': []}):
            with self.subTest(solution=invalid):
                payload = copy.deepcopy(self.payload)
                payload['events'] = [{'id': 1, 'kind': 'checkpoint', 'payload': {'elapsed': 0, 'solution': invalid}}]
                response = self.validate(payload)
                self.assertEqual(response.status_code, 422, response.text)

    def test_negative_or_nonfinite_elapsed_is_rejected(self):
        for invalid in (-.5, float('inf'), float('-inf'), float('nan'), True, '0'):
            with self.subTest(elapsed=invalid):
                payload = copy.deepcopy(self.payload)
                payload['events'] = [{'id': 1, 'kind': 'sample', 'payload': {'elapsed': invalid, 'best_cost_ticks': 4000}}]
                response = self.validate(payload)
                self.assertEqual(response.status_code, 422, response.text)

    def test_all_nonfinite_replay_values_return_422(self):
        for section in ('sample', 'statistics', 'result', 'config'):
            for invalid in (float('inf'), float('-inf'), float('nan')):
                with self.subTest(section=section, value=invalid):
                    payload = copy.deepcopy(self.payload)
                    if section == 'sample':
                        payload['events'] = [{'id': 1, 'kind': 'sample', 'payload': {'elapsed': 0, 'best_cost_ticks': invalid}}]
                    elif section == 'statistics':
                        payload['statistics'] = [{'runtime': invalid}]
                    elif section == 'result':
                        payload['result']['solver_runtime'] = invalid
                    else:
                        payload['request']['config']['time_limit'] = invalid
                    response = self.validate(payload)
                    self.assertEqual(response.status_code, 422, response.text)

    def test_malformed_solution_types_return_422(self):
        for invalid in ([], 'solution', {'feasible': True, 'cost_ticks': 4000, 'routes': [None], 'served': 2}):
            with self.subTest(solution=invalid):
                payload = copy.deepcopy(self.payload)
                payload['baseline'] = invalid
                response = self.validate(payload)
                self.assertEqual(response.status_code, 422, response.text)

    def test_checkpoint_cost_is_audited(self):
        payload = copy.deepcopy(self.payload)
        solution = copy.deepcopy(self.solution)
        solution['routes'][0]['load'] += 1
        payload['events'] = [{'id': 1, 'kind': 'checkpoint', 'payload': {'elapsed': 0, 'reason': 'initial', 'solution': solution}}]
        self.assertEqual(self.validate(payload).status_code, 422)

    def test_wrapper_metadata_must_match_payload_and_run(self):
        for field, value in (('instance_hash', '0' * 64), ('sequence', 9), ('schema_version', 2)):
            with self.subTest(field=field):
                payload = copy.deepcopy(self.payload)
                payload['events'] = [{'id': 1, 'kind': 'checkpoint', field: value, 'payload': {
                    'elapsed': 0, 'reason': 'initial', 'sequence': 1, 'solution': self.solution,
                }}]
                self.assertEqual(self.validate(payload).status_code, 422)

    def test_completed_run_requires_a_final_solution(self):
        payload = copy.deepcopy(self.payload)
        payload['result']['solution'] = None
        self.assertEqual(self.validate(payload).status_code, 422)

    def test_terminal_run_without_solution_is_allowed(self):
        for status in ('failed', 'interrupted', 'no_solution', 'cancelled'):
            with self.subTest(status=status):
                payload = copy.deepcopy(self.payload)
                payload['status'] = status
                payload['result'] = None
                response = self.validate(payload)
                self.assertEqual(response.status_code, 200, response.text)

    def test_event_duplicates_are_deduplicated_only_when_identical(self):
        payload = copy.deepcopy(self.payload)
        event = {'id': 1, 'kind': 'checkpoint', 'payload': {'elapsed': 0, 'solution': self.solution}}
        payload['events'] = [event, copy.deepcopy(event)]
        response = self.validate(payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()['events']), 1)
        payload['events'][1]['payload']['elapsed'] = 1
        self.assertEqual(self.validate(payload).status_code, 422)

    def test_event_order_and_identity_are_checked(self):
        for changes in ({'elapsed': 0}, {'sequence': 3}, {'run_id': 'other'}, {'instance_hash': '0' * 64}):
            with self.subTest(changes=changes):
                payload = copy.deepcopy(self.payload)
                payload['events'] = [
                    {'id': 1, 'kind': 'sample', 'payload': {'elapsed': 1}},
                    {'id': 2, 'kind': 'sample', 'payload': {'elapsed': 2, **changes}},
                ]
                self.assertEqual(self.validate(payload).status_code, 422)

    def test_result_metadata_used_by_the_interface_is_typed(self):
        for field, invalid in (
            ('solver_runtime', 'text'), ('solver_runtime', None), ('solver_runtime', -1),
            ('wall_runtime', {}), ('versions', None), ('versions', {'ortools': []}),
            ('iterations', True), ('checkpoints', -1), ('algorithm', []),
            ('distance_convention', {}), ('proven_optimal', 'false'),
        ):
            with self.subTest(field=field, value=invalid):
                payload = copy.deepcopy(self.payload)
                payload['result'][field] = invalid
                self.assertEqual(self.validate(payload).status_code, 422)
        for field in ('solver_runtime', 'wall_runtime', 'versions'):
            with self.subTest(missing=field):
                payload = copy.deepcopy(self.payload)
                del payload['result'][field]
                self.assertEqual(self.validate(payload).status_code, 422)

    def test_replay_cannot_claim_unverified_optimality(self):
        payload = copy.deepcopy(self.payload)
        payload['result']['proven_optimal'] = True
        self.assertEqual(self.validate(payload).status_code, 422)

    def test_geographic_replay_rejects_invalid_display_metadata(self):
        points = [{'lat': -23.55, 'lng': -46.63}, {'lat': -23.56, 'lng': -46.64}, {'lat': -23.57, 'lng': -46.65}]
        instance = GeographicInstance(schema_version=3, depot=points[0], vehicles=1, capacity=10,
            clients=[dict(points[1], id=1, demand=2), dict(points[2], id=2, demand=3)],
            road_matrix={'provider': 'osrm', 'method': 'table', 'fetched_at': '2026-10-04T12:00:00Z',
                         'points': [(p['lat'], p['lng']) for p in points],
                         'distances_m': [[0, 100, 200], [110, 0, 150], [220, 170, 0]]})
        payload = copy.deepcopy(self.payload)
        payload['request']['instance'] = instance.model_dump()
        payload['baseline'] = payload['result']['solution'] = validate_routes(instance, [[1, 2]])
        payload['result']['instance_hash'] = fingerprint(instance)
        response = self.validate(payload)
        self.assertEqual(response.status_code, 200, response.text)
        for field, invalid in (('solver_runtime', 'text'), ('wall_runtime', None), ('versions', None)):
            with self.subTest(field=field):
                malformed = copy.deepcopy(payload)
                malformed['result'][field] = invalid
                self.assertEqual(self.validate(malformed).status_code, 422)


class InputLimitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.app = create_app(str(Path(cls.temp.name) / 'test.db'))
        cls.client = TestClient(cls.app, raise_server_exceptions=False)
        cls.client.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)
        cls.temp.cleanup()

    def test_generator_rejects_limits_before_allocating(self):
        for payload in ({'customers': 1000}, {'vehicles': 101}, {'customers': 1000000, 'vehicles': 100000}):
            with self.subTest(payload=payload), patch('backend.app.main.generate') as generate:
                response = self.client.post('/api/instances/generate', json=payload)
                self.assertEqual(response.status_code, 422, response.text[:200])
                generate.assert_not_called()

    def test_client_and_vehicle_limits_apply_to_both_instance_types(self):
        for geographic in (False, True):
            client = {'id': 1, 'lat': -23.5, 'lng': -46.6, 'demand': 1} if geographic else {'id': 1, 'x': 1, 'y': 1, 'demand': 1}
            base = {'clients': [dict(client, id=i + 1) for i in range(2)], 'vehicles': 1, 'capacity': 10}
            if geographic:
                base.update(schema_version=3, coordinate_system='geographic', depot={'lat': -23.5, 'lng': -46.6})
            else:
                base.update(depot={'x': 0, 'y': 0})
            for field in ('clients', 'vehicles'):
                with self.subTest(geographic=geographic, field=field):
                    payload = copy.deepcopy(base)
                    payload[field] = [dict(client, id=i + 1) for i in range(1000)] if field == 'clients' else 101
                    for endpoint, body in (('/api/instances/preview', payload), ('/api/runs', {'instance': payload}), ('/api/plans/validate', {'instance': payload, 'routes': []})):
                        with self.subTest(endpoint=endpoint), patch('backend.app.main.initial_solution', return_value=None), patch('backend.app.main.Jobs.submit', return_value='not-started'):
                            response = self.client.post(endpoint, json=body)
                            self.assertEqual(response.status_code, 422, response.text[:200])

    def test_vrp_declared_and_manual_fleet_are_bounded(self):
        source = (Path(__file__).parent / 'fixtures/vrp/explicit-lower-row.vrp').read_text(encoding='utf-8')
        for payload in ({'text': source, 'filename': 'example.vrp', 'vehicles': 101},
                        {'text': source.replace('CAPACITY', 'VEHICLES: 101\nCAPACITY', 1), 'filename': 'example.vrp'}):
            with self.subTest(payload=payload):
                response = self.client.post('/api/instances/import-vrp', json=payload)
                self.assertEqual(response.status_code, 422, response.text[:200])

    def test_road_point_limit_rejects_before_provider_calls(self):
        for endpoint, count in (('/api/roads/matrix', 1001), ('/api/roads/geometry', 1002)):
            points = [{'lat': -23.5, 'lng': -46.6}] * count
            with self.subTest(endpoint=endpoint), patch.object(self.app.state.roads, 'matrix') as matrix, patch.object(self.app.state.roads, 'geometry') as geometry:
                response = self.client.post(endpoint, json={'points': points})
                self.assertEqual(response.status_code, 422, response.text[:200])
                matrix.assert_not_called()
                geometry.assert_not_called()

    def test_upper_bounds_are_accepted_by_both_instance_contracts(self):
        generated = GenerateRequest(customers=999, vehicles=100)
        self.assertEqual((generated.customers, generated.vehicles), (999, 100))
        native = Instance(clients=[{'id': i + 1, 'x': 1, 'y': 1, 'demand': 1} for i in range(999)], vehicles=100)
        geographic = GeographicInstance(schema_version=3, depot={'lat': -23.5, 'lng': -46.6},
            clients=[{'id': i + 1, 'lat': -23.5, 'lng': -46.6, 'demand': 1} for i in range(999)], vehicles=100)
        for instance in (native, geographic):
            self.assertEqual(len(instance.clients), 999)
            self.assertEqual(instance.vehicles, 100)

    def test_geometry_allows_return_to_depot_at_maximum_clients(self):
        points = [{'lat': -23.5, 'lng': -46.6}] * 1000
        matrix = RoadMatrixRequest(points=points)
        geometry = RoadPointsRequest(points=[*points, points[0]])
        self.assertEqual(len(matrix.points), 1000)
        self.assertEqual(len(geometry.points), 1001)


if __name__ == '__main__':
    unittest.main()
