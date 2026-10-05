import copy
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.app.schemas import GeographicInstance
from test_scenarios import audit


def main():
    root = Path(__file__).resolve().parents[2]
    output = root/'test-results'
    output.mkdir(exist_ok=True)
    fixture = 'backend/tests/fixtures/geographic/synthetic-grid.json'
    example = json.loads((root/fixture).read_text(encoding='utf-8'))
    report = dict(tested_at=datetime.now(timezone.utc).isoformat(), coordinates_source=fixture,
                  cases=[], errors=[])
    checks = unittest.TestCase()
    with tempfile.TemporaryDirectory() as temporary:
        with TestClient(create_app(str(Path(temporary)/'live.db'))) as client:
            for size, vehicles, capacity in ((8, 3, 15), (24, 4, 40), (41, 4, 15)):
                record = dict(customers=size, vehicles=vehicles, capacity=capacity, runs=[])
                report['cases'].append(record)
                try:
                    source_ids = [i*len(example['clients'])//size for i in range(size)]
                    data = dict(schema_version=3, coordinate_system='geographic', name=f'São Paulo teste {size}',
                                depot=copy.deepcopy(example['depot']), vehicles=vehicles, capacity=capacity,
                                clients=[dict(**{k:v for k,v in example['clients'][idx].items() if k not in ('id', 'demand')},
                                              id=i+1, demand=(i%5+1 if size == 24 else 1)) for i, idx in enumerate(source_ids)])
                    points = [data['depot'], *data['clients']]
                    response = client.post('/api/roads/matrix', json=dict(points=[dict(lat=p['lat'], lng=p['lng']) for p in points]))
                    checks.assertEqual(response.status_code, 200, response.text)
                    data['road_matrix'] = response.json()['matrix']
                    record.update(source_client_ids=[idx+1 for idx in source_ids], matrix_requests=response.json()['requests'],
                                  provider=data['road_matrix']['provider'], endpoint=data['road_matrix']['endpoint'],
                                  fetched_at=data['road_matrix']['fetched_at'], total_demand=sum(p['demand'] for p in data['clients']))
                    instance = GeographicInstance.model_validate(data)
                    preview = client.post('/api/instances/preview', json=data)
                    checks.assertEqual(preview.status_code, 200, preview.text)
                    audit(checks, instance, preview.json()['baseline'])
                    for config in (dict(adapter='ortools', stop='time', time_limit=.4, sample_every=10),
                                   dict(adapter='pyvrp', stop='time', time_limit=.4, seed=0, sample_every=10),
                                   dict(adapter='pyvrp', stop='iterations', max_iterations=80, seed=99, sample_every=25)):
                        response = client.post('/api/runs', json=dict(instance=data, config=config))
                        checks.assertEqual(response.status_code, 202, response.text)
                        run_id = response.json()['id']
                        deadline = time.monotonic()+40
                        while True:
                            run = client.get('/api/runs/'+run_id).json()
                            if run['status'] not in ('queued', 'running'):
                                break
                            checks.assertLess(time.monotonic(), deadline)
                            time.sleep(.05)
                        checks.assertEqual(run['status'], 'completed', run.get('error'))
                        solution = run['result']['solution']
                        audit(checks, instance, solution)
                        checks.assertFalse(run['result']['proven_optimal'])
                        replay = client.get(f'/api/runs/{run_id}/export').json()
                        response = client.post('/api/replays/validate', json=replay)
                        checks.assertEqual(response.status_code, 200, response.text)
                        replay_file = f"live-map-{size}-{config['adapter']}-{config['stop']}.json"
                        (output/replay_file).write_text(json.dumps(replay, ensure_ascii=False), encoding='utf-8')
                        record['runs'].append(dict(config=run['request']['config'], status=run['status'],
                                                   baseline_ticks=run['baseline']['cost_ticks'], cost_ticks=solution['cost_ticks'],
                                                   used_vehicles=len(solution['routes']), replay_file=replay_file,
                                                   coverage=True, capacity=True, cost_audited=True, replay_valid=True))
                        print(f"{size} clientes {config['adapter']} {config['stop']}: {solution['cost_ticks']} ticks", flush=True)
                    solution = replay['result']['solution']
                    geometries = []
                    for route in solution['routes']:
                        closed = [0, *route['visits'], 0]
                        response = client.post('/api/roads/geometry', json=dict(points=[dict(lat=points[i]['lat'], lng=points[i]['lng']) for i in closed]))
                        checks.assertEqual(response.status_code, 200, response.text)
                        geometry = response.json()
                        checks.assertEqual(len(geometry['legs']), len(closed)-1)
                        checks.assertTrue(all(len(p) >= 2 for p in geometry['paths']))
                        checks.assertAlmostEqual(sum(leg['distanceMetres'] for leg in geometry['legs']), geometry['distanceMetres'])
                        geometries.append(dict(vehicle=route['vehicle'], legs=len(geometry['legs']), matrix_ticks=route['cost_ticks'],
                                               geometry_metres=geometry['distanceMetres'], requests=geometry['requests']))
                    record['geometries'] = geometries
                    print(f"{size} clientes: matriz, soluções, replay e {len(geometries)} geometrias verificados", flush=True)
                except Exception as error:
                    record['error'] = str(error)
                    report['errors'].append(dict(customers=size, detail=str(error)))
                    print(f"Falha com {size} clientes: {error}", flush=True)
    report['passed'] = not report['errors']
    (output/'live-map.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    return int(not report['passed'])


if __name__ == '__main__':
    raise SystemExit(main())
