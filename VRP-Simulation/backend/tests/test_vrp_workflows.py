import copy
import hashlib
import json
import math
import os
from pathlib import Path
import re
import tempfile
import time
import unittest

from fastapi.testclient import TestClient

from backend.app.instances import capacity_issues, distance_matrix, fingerprint, generate
from backend.app.main import create_app
from backend.app.ortools_solver import execute_ortools, initial_solution
from backend.app.schemas import GenerateRequest, Instance, SolverConfig
from backend.app.solver import execute
from backend.app.validation import validate_routes
from backend.app.vrp_import import parse_vrp
from test_vrp_import import FIXTURE

FIXTURES = Path(__file__).parent / 'fixtures' / 'vrp'
REAL_FILES = sorted(path for path in FIXTURES.glob('*.vrp') if path.stem != 'explicit-lower-row')


def raw_headers(text):
    headers = {}
    for line in text.splitlines():
        if line.strip().endswith('_SECTION'):
            break
        key, separator, value = line.partition(':')
        if separator:
            headers[key.strip()] = value.strip()
    return headers


def integer_euclidean_cost(a, b):
    """Verifica o arredondamento TSPLIB com aritmética inteira."""
    dx, dy = int(a[0]) - int(b[0]), int(a[1]) - int(b[1])
    squared = dx * dx + dy * dy
    root = math.isqrt(squared)
    return (root + int(4 * squared >= (2 * root + 1) ** 2)) * 1000


class RealFileTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.instances = {}
        cls.baselines = {}
        for path in REAL_FILES:
            instance = parse_vrp(path.read_text(encoding='utf-8'), path.name)
            cls.instances[path.stem] = instance
            cls.baselines[path.stem] = initial_solution(instance)

    def test_fixture_checksums(self):
        sources = json.loads((FIXTURES / 'sources.json').read_text(encoding='utf-8'))
        for source in sources:
            with self.subTest(file=source['file']):
                self.assertEqual(hashlib.sha256((FIXTURES / source['file']).read_bytes()).hexdigest(), source['sha256'])

    def test_json_roundtrip_all_real_files(self):
        for name, instance in self.instances.items():
            with self.subTest(file=name):
                restored = Instance.model_validate_json(instance.model_dump_json())
                self.assertEqual(fingerprint(restored), fingerprint(instance))
                self.assertEqual(distance_matrix(restored).tolist(), distance_matrix(instance).tolist())


def metadata_test(path):
    def test(self):
        headers = raw_headers(path.read_text(encoding='utf-8'))
        instance = self.instances[path.stem]
        self.assertEqual(len(instance.clients) + 1, int(headers['DIMENSION']))
        self.assertEqual(instance.capacity, int(headers['CAPACITY']))
        self.assertEqual(instance.vehicles, int(re.search(r'-k(\d+)$', headers['NAME'])[1]))
        self.assertEqual(len(instance.vrp.node_ids), int(headers['DIMENSION']))
        self.assertEqual(self.baselines[path.stem]['served'], len(instance.clients))
    return test


def matrix_test(path):
    def test(self):
        instance = self.instances[path.stem]
        matrix, points = distance_matrix(instance), instance.vrp.coordinates
        for i, a in enumerate(points):
            for j, b in enumerate(points):
                self.assertEqual(int(matrix[i, j]), integer_euclidean_cost(a, b), (path.name, i, j))
    return test


def solver_test(path, adapter):
    def test(self):
        instance = self.instances[path.stem]
        runner = execute_ortools if adapter == 'ortools' else execute
        events = []
        result = runner(instance, SolverConfig(adapter=adapter, stop='time', time_limit=.15), lambda kind, payload: events.append((kind, payload)), initial=self.baselines[path.stem])
        solution = result['solution']
        self.assertIsNotNone(solution)
        self.assertTrue(solution['feasible'])
        self.assertEqual(solution['served'], len(instance.clients))
        self.assertLessEqual(len(solution['routes']), instance.vehicles)
        total = 0
        for route in solution['routes']:
            self.assertLessEqual(route['load'], instance.capacity)
            nodes = [0, *route['visits'], 0]
            total += sum(integer_euclidean_cost(instance.vrp.coordinates[a], instance.vrp.coordinates[b]) for a, b in zip(nodes, nodes[1:]))
        self.assertEqual(solution['cost_ticks'], total)
        self.assertFalse(result['proven_optimal'])
        self.assertEqual(result['instance_hash'], fingerprint(instance))
        self.assertTrue(any(kind == 'checkpoint' for kind, _ in events))
    return test


def reference_solution_test(path):
    def test(self):
        lines = path.with_suffix('.sol').read_text(encoding='utf-8').splitlines()
        routes = [[int(node) for node in line.split(':')[1].split()] for line in lines if line.startswith('Route')]
        claimed = int(next(line.split()[1] for line in lines if line.startswith('Cost'))) * 1000
        audited = validate_routes(self.instances[path.stem], routes, claimed)
        self.assertTrue(audited['feasible'], audited['errors'])
        self.assertEqual(audited['cost_ticks'], claimed)
    return test


for path in REAL_FILES:
    suffix = path.stem.replace('-', '_')
    setattr(RealFileTests, f'test_metadata_{suffix}', metadata_test(path))
    setattr(RealFileTests, f'test_matrix_{suffix}', matrix_test(path))
    for adapter in ('ortools', 'pyvrp'):
        setattr(RealFileTests, f'test_{adapter}_{suffix}', solver_test(path, adapter))
    if path.with_suffix('.sol').exists():
        setattr(RealFileTests, f'test_reference_solution_{suffix}', reference_solution_test(path))


class FormatAndAuditTests(unittest.TestCase):
    def test_duplicate_numeric_header_rejected(self):
        source = FIXTURE.replace('CAPACITY: 10','CAPACITY: 10\nCAPACITY: 80')
        with self.assertRaisesRegex(ValueError, 'duplicado'):
            parse_vrp(source,'example.vrp',2)

    def test_declared_fleet_respects_import_limit(self):
        source = FIXTURE.replace('CAPACITY: 10','CAPACITY: 10\nVEHICLES: 10001')
        with self.assertRaisesRegex(ValueError, 'veículos'):
            parse_vrp(source,'example.vrp')

    def test_explicit_costs_are_not_silently_ignored(self):
        source = FIXTURE.replace('NODE_COORD_SECTION','EDGE_WEIGHT_SECTION\n0 5 5\n5 0 5\n5 5 0\nNODE_COORD_SECTION')
        with self.assertRaisesRegex(ValueError, 'EXPLICIT'):
            parse_vrp(source,'example.vrp',2)

    def test_lower_row_and_depot_remapping(self):
        instance = parse_vrp((FIXTURES / 'explicit-lower-row.vrp').read_text(encoding='utf-8'), 'explicit-lower-row.vrp', 1)
        self.assertEqual(instance.vrp.node_ids, [2, 1, 3, 4])
        self.assertEqual(distance_matrix(instance).tolist(), [[0,2000,3000,13000],[2000,0,7000,11000],[3000,7000,0,5000],[13000,11000,5000,0]])
        self.assertTrue(validate_routes(instance, [[1, 2, 3]], 27000)['feasible'])

    def test_supported_rounding_conventions(self):
        for kind, expected in [('EUC_2D',1000),('CEIL_2D',2000),('FLOOR_2D',1000),('EXACT_2D',1414)]:
            with self.subTest(type=kind):
                instance = parse_vrp(FIXTURE.replace('EUC_2D', kind), 'example.vrp', 2)
                self.assertEqual(distance_matrix(instance)[0,1], expected)

    def test_bom_crlf_and_header_whitespace(self):
        source = '\ufeff' + FIXTURE.replace('CAPACITY: 10', 'CAPACITY : 80').replace('\n', '\r\n')
        self.assertEqual(parse_vrp(source, 'example.vrp', 2).capacity, 80)

    def test_filename_fleet_fallback(self):
        self.assertEqual(parse_vrp(FIXTURE, 'custom-n3-k2.vrp').vehicles, 2)

    def test_renamed_file_does_not_override_content(self):
        instance = parse_vrp((FIXTURES/'P-n60-k15.vrp').read_text(encoding='utf-8'), 'P-n60-k1.vrp')
        self.assertEqual(instance.vehicles, 15)

    def test_capacity_violations_are_reported(self):
        for source in (FIXTURE.replace('CAPACITY: 10','CAPACITY: 2'), FIXTURE.replace('CAPACITY: 10','CAPACITY: 3')):
            instance = parse_vrp(source, 'example.vrp', 1)
            self.assertTrue(capacity_issues(instance))
            self.assertIsNone(initial_solution(instance))

    def test_invalid_routes_are_rejected(self):
        instance = parse_vrp(FIXTURE, 'example.vrp', 2)
        for routes, vehicles, expected_cost in [([[1]],None,None),([[1,1,2]],None,None),([[1,3]],None,None),([[1],[2]],[1,1],None),([[1,2]],[3],None),([[1,2]],None,1)]:
            with self.subTest(routes=routes, vehicles=vehicles):
                self.assertFalse(validate_routes(instance,routes,expected_cost,vehicles)['feasible'])

    def test_invalid_files_fail_explicitly(self):
        cases = {
            'missing_capacity': FIXTURE.replace('CAPACITY: 10\n',''),
            'wrong_type': FIXTURE.replace('TYPE: CVRP','TYPE: TSP'),
            'large_dimension': FIXTURE.replace('DIMENSION: 3','DIMENSION: 1001'),
            'missing_node': FIXTURE.replace('3 104 100\n',''),
            'duplicate_node': FIXTURE.replace('3 104 100','2 104 100'),
            'duplicate_demand': FIXTURE.replace('3 3','2 3'),
            'nonfinite': FIXTURE.replace('3 104 100','3 inf 100'),
            'negative_demand': FIXTURE.replace('3 3','3 -1'),
            'zero_client_demand': FIXTURE.replace('3 3','3 0'),
            'extra_constraint': FIXTURE.replace('CAPACITY: 10','CAPACITY: 10\nDISTANCE: 200'),
            'unsupported_cost': FIXTURE.replace('EUC_2D','GEO'),
        }
        for name, source in cases.items():
            with self.subTest(case=name), self.assertRaises(ValueError):
                parse_vrp(source, 'example.vrp', 2)

    def test_matrix_editing_and_client_deletion_rejected(self):
        instance = parse_vrp((FIXTURES/'P-n60-k15.vrp').read_text(encoding='utf-8'), 'P-n60-k15.vrp')
        for mutation in ('position','delete','diagonal','shape'):
            data = instance.model_dump()
            if mutation == 'position': data['depot']['x'] += 1
            elif mutation == 'delete': data['clients'].pop()
            elif mutation == 'diagonal': data['vrp']['costs_ticks'][0][0] = 1
            else: data['vrp']['costs_ticks'][0].pop()
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                Instance.model_validate(data)

    def test_native_fingerprint_compatibility(self):
        native = generate(GenerateRequest(customers=3,vehicles=2,capacity=50))
        legacy = native.model_dump(exclude={'name','generator_seed','distribution','schema_version','vrp','fleet'})
        expected = hashlib.sha256(json.dumps(legacy,sort_keys=True).encode()).hexdigest()
        self.assertEqual(fingerprint(native), expected)


class ApiWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.client = TestClient(create_app(str(Path(cls.temp.name)/'test.db')))
        cls.client.__enter__()
        cls.source = (FIXTURES/'P-n60-k15.vrp').read_text(encoding='utf-8')
        response = cls.client.post('/api/instances/import-vrp',json={'text':cls.source,'filename':'P-n60-k15.vrp'})
        if response.status_code != 200: raise AssertionError(response.text)
        cls.imported = response.json()

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None,None,None)
        cls.temp.cleanup()

    def test_real_import_metadata(self):
        instance = self.imported['instance']
        self.assertEqual((len(instance['clients']),instance['vehicles'],instance['capacity']), (59,15,80))
        self.assertTrue(self.imported['baseline']['feasible'])

    def test_conflicting_manual_fleet(self):
        response = self.client.post('/api/instances/import-vrp',json={'text':self.source,'filename':'P-n60-k15.vrp','vehicles':5})
        self.assertEqual(response.status_code,422)

    def test_import_stops_at_eof(self):
        response = self.client.post('/api/instances/import-vrp',json={'text':self.source + 'TIME_WINDOW_SECTION\n1 0 20\n','filename':'P-n60-k15.vrp'})
        self.assertEqual(response.status_code,200,response.text)
        instance = response.json()['instance']
        self.assertEqual(instance['vrp']['node_ids'][0],1)
        self.assertEqual(instance['vrp']['coordinates'][0],[40,40])
        self.assertEqual((len(instance['clients']) + 1,instance['vehicles'],instance['capacity']),(60,15,80))

    def test_invalid_depot_terminators_return_422(self):
        for ending in ('1\nEOF', '1\n-1\n-1\nEOF', '-1\n1\nEOF'):
            with self.subTest(ending=ending):
                source = FIXTURE.replace('1\n-1\nEOF', ending)
                response = self.client.post('/api/instances/import-vrp',json={'text':source,'filename':'example.vrp','vehicles':2})
                self.assertEqual(response.status_code,422,response.text)
                self.assertIn('DEPOT_SECTION',response.json()['detail'])

    def test_malformed_headers_and_cost_sections_return_422(self):
        cases = [
            FIXTURE.replace('CAPACITY: 10','CAPACITY: 10\nCAPACITY: 80'),
            FIXTURE.replace('CAPACITY: 10','CAPACITY: 10\nVEHICLES: 10001'),
            FIXTURE.replace('NODE_COORD_SECTION','EDGE_WEIGHT_SECTION\n0 5 5\n5 0 5\n5 5 0\nNODE_COORD_SECTION'),
        ]
        for source in cases:
            with self.subTest(source=source[:100]):
                response = self.client.post('/api/instances/import-vrp',json={'text':source,'filename':'example.vrp','vehicles':None if 'VEHICLES: 10001' in source else 2})
                self.assertEqual(response.status_code,422,response.text)

    def test_missing_fleet_and_manual_fallback(self):
        payload = {'text':FIXTURE,'filename':'example.vrp'}
        self.assertEqual(self.client.post('/api/instances/import-vrp',json=payload).status_code,422)
        payload['vehicles'] = 2
        self.assertEqual(self.client.post('/api/instances/import-vrp',json=payload).status_code,200)

    def test_json_preview_preserves_import(self):
        response = self.client.post('/api/instances/preview',json=self.imported['instance'])
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['hash'],self.imported['hash'])
        self.assertEqual(response.json()['instance']['vrp'],self.imported['instance']['vrp'])

    def test_infeasible_import_cannot_start_search(self):
        response = self.client.post('/api/instances/import-vrp',json={'text':FIXTURE.replace('CAPACITY: 10','CAPACITY: 2'),'filename':'example.vrp','vehicles':1})
        self.assertEqual(response.status_code,200)
        preview = response.json()
        self.assertEqual(preview['feasibility_status'],'proven_infeasible')
        self.assertEqual(self.client.post('/api/runs',json={'instance':preview['instance']}).status_code,422)

    def test_coordinate_mutation_rejected(self):
        data = copy.deepcopy(self.imported['instance'])
        data['depot']['x'] += 1
        self.assertEqual(self.client.post('/api/instances/preview',json=data).status_code,422)

    def test_both_solver_jobs_export_and_replay(self):
        for adapter in ('ortools','pyvrp'):
            with self.subTest(adapter=adapter):
                response = self.client.post('/api/runs',json={'instance':self.imported['instance'],'config':{'adapter':adapter,'stop':'time','time_limit':.15}})
                self.assertEqual(response.status_code,202,response.text)
                run_id = response.json()['id']
                deadline = time.monotonic()+20
                while True:
                    run = self.client.get('/api/runs/'+run_id).json()
                    if run['status'] not in ('queued','running'): break
                    self.assertLess(time.monotonic(),deadline,'Solver job timed out')
                    time.sleep(.025)
                self.assertEqual(run['status'],'completed',run.get('error'))
                self.assertEqual(run['result']['solution']['served'],59)
                response = self.client.get(f'/api/runs/{run_id}/export')
                self.assertEqual(response.status_code,200)
                payload = response.json()
                artifact_dir = os.environ.get('VRP_SIMULATION_TEST_ARTIFACT_DIR')
                if artifact_dir:
                    output = Path(artifact_dir)
                    output.mkdir(parents=True, exist_ok=True)
                    (output / f'vrp-{adapter}-replay.json').write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
                replay = self.client.post('/api/replays/validate',json=payload)
                self.assertEqual(replay.status_code,200,replay.text)
                self.assertEqual(replay.json()['preview']['hash'],self.imported['hash'])
                self.assertEqual(replay.json()['preview']['instance']['capacity'],80)
                self.assertTrue(payload['events'])
                payload['result']['solution']['cost_ticks'] += 1
                self.assertEqual(self.client.post('/api/replays/validate',json=payload).status_code,422)


if __name__ == '__main__':
    unittest.main()
