import unittest
from backend.app.vrp_import import parse_vrp
from backend.app.instances import distance_matrix
from backend.app.schemas import Instance

FIXTURE = """NAME: example
TYPE: CVRP
DIMENSION: 3
CAPACITY: 10
EDGE_WEIGHT_TYPE: EUC_2D
NODE_COORD_SECTION
1 100 100
2 101 101
3 104 100
DEMAND_SECTION
1 0
2 2
3 3
DEPOT_SECTION
1
-1
EOF
"""

class ImportTests(unittest.TestCase):
    def test_augerat_comment_name_dimension_and_capacity(self):
        # Coordenadas geradas para testar o parser do cabeçalho.
        source = '\n'.join([
            'NAME : P-n60-k15',
            'COMMENT : (Augerat et al, No of trucks: 15',
            'TYPE : CVRP',
            'DIMENSION : 60',
            'EDGE_WEIGHT_TYPE : EUC_2D',
            'CAPACITY : 80',
            'NODE_COORD_SECTION',
            *[f'{i} {i * 2} {i % 7}' for i in range(1, 61)],
            'DEMAND_SECTION',
            '1 0',
            *[f'{i} 1' for i in range(2, 61)],
            'DEPOT_SECTION', '1', '-1', 'EOF',
        ])
        instance = parse_vrp(source, 'P-n60-k15.vrp')
        self.assertEqual(instance.vehicles, 15)
        self.assertEqual(instance.capacity, 80)
        self.assertEqual(len(instance.clients), 59)
        self.assertEqual(len(instance.vrp.node_ids), 60)
        self.assertEqual(len(instance.vrp.costs_ticks), 60)

    def test_name_fleet_fallback(self):
        source = FIXTURE.replace('NAME: example', 'NAME: P-n3-k2')
        self.assertEqual(parse_vrp(source, 'example.vrp').vehicles, 2)

    def test_comment_fleet_without_name_suffix(self):
        source = FIXTURE.replace('TYPE: CVRP', 'COMMENT : (Augerat et al, No of trucks: 2)\nTYPE: CVRP')
        self.assertEqual(parse_vrp(source, 'example.vrp').vehicles, 2)
        with self.assertRaisesRegex(ValueError, 'quantidade'):
            parse_vrp(source, 'example.vrp', 5)

    def test_conflicting_declared_fleet_rejected(self):
        source = FIXTURE.replace('NAME: example', 'NAME: P-n3-k2').replace('TYPE: CVRP', 'COMMENT : No of trucks: 3\nTYPE: CVRP')
        with self.assertRaisesRegex(ValueError, 'divergentes'):
            parse_vrp(source, 'example.vrp')

    def test_declared_fleet_cannot_be_overridden(self):
        source = FIXTURE.replace('CAPACITY: 10', 'CAPACITY: 10\nVEHICLES: 2')
        self.assertEqual(parse_vrp(source, 'example.vrp').vehicles, 2)
        self.assertEqual(parse_vrp(source, 'example.vrp', 2).vehicles, 2)
        with self.assertRaisesRegex(ValueError, 'VEHICLES'):
            parse_vrp(source, 'example.vrp', 5)

    def test_dimension_is_depot_plus_all_clients(self):
        instance = parse_vrp(FIXTURE, 'example.vrp', 2)
        self.assertEqual(len(instance.clients) + 1, 3)
        self.assertEqual([client.demand for client in instance.clients], [2, 3])
        incomplete = FIXTURE.replace('3 3\n', '')
        with self.assertRaisesRegex(ValueError, 'DIMENSION'):
            parse_vrp(incomplete, 'example.vrp', 2)

    def test_solver_and_independent_audit_agree(self):
        from backend.app.ortools_solver import initial_solution
        from backend.app.validation import validate_routes
        instance = parse_vrp(FIXTURE, 'example.vrp', 2)
        result = initial_solution(instance)
        self.assertTrue(result['feasible'])
        self.assertEqual(result['cost_ticks'], 8000)
        self.assertTrue(validate_routes(instance, [[1, 2]], 8000)['feasible'])

    def test_search_preserves_imported_costs(self):
        from backend.app.ortools_solver import execute_ortools
        from backend.app.schemas import SolverConfig
        instance = parse_vrp(FIXTURE, 'example.vrp', 2)
        result = execute_ortools(instance, SolverConfig(stop='time', time_limit=.1), lambda *args: None)
        self.assertTrue(result['solution']['feasible'])
        self.assertEqual(result['solution']['cost_ticks'], 8000)

    def test_depot_remapping(self):
        source = FIXTURE.replace('1 0\n2 2\n3 3', '1 2\n2 0\n3 3').replace('DEPOT_SECTION\n1', 'DEPOT_SECTION\n2')
        instance = parse_vrp(source, 'example.vrp', 2)
        self.assertEqual(instance.vrp.node_ids, [2, 1, 3])
        self.assertEqual(distance_matrix(instance)[0, 2], 3000)

    def test_eof_stops_reading_trailing_sections(self):
        source = FIXTURE + 'TIME_WINDOW_SECTION\n1 0 20\n'
        instance = parse_vrp(source, 'example.vrp', 2)
        self.assertEqual(instance.vrp.node_ids, [1, 2, 3])
        self.assertEqual([client.demand for client in instance.clients], [2, 3])

    def test_premature_eof_cannot_complete_missing_data(self):
        source = FIXTURE.replace('DEMAND_SECTION', 'EOF\nDEMAND_SECTION')
        with self.assertRaises(ValueError):
            parse_vrp(source, 'example.vrp', 2)

    def test_depot_section_requires_terminator(self):
        source = FIXTURE.replace('1\n-1\nEOF', '1\nEOF')
        with self.assertRaisesRegex(ValueError, 'DEPOT_SECTION'):
            parse_vrp(source, 'example.vrp', 2)

    def test_data_after_depot_terminator_is_rejected(self):
        for ending in ('1\n-1\n-1', '-1\n1', '1 -1 2'):
            with self.subTest(ending=ending):
                source = FIXTURE.replace('1\n-1\nEOF', ending + '\nEOF')
                with self.assertRaisesRegex(ValueError, 'DEPOT_SECTION'):
                    parse_vrp(source, 'example.vrp', 2)

    def test_inline_depot_terminator_is_supported(self):
        source = FIXTURE.replace('1\n-1\nEOF', '1 -1\nEOF')
        self.assertEqual(parse_vrp(source, 'example.vrp', 2).vrp.node_ids, [1, 2, 3])

    def test_eof_marker_is_optional(self):
        self.assertEqual(parse_vrp(FIXTURE.replace('EOF\n', ''), 'example.vrp', 2).vrp.node_ids, [1, 2, 3])

    def test_last_node_can_be_the_depot(self):
        source = FIXTURE.replace('1 0\n2 2\n3 3', '1 2\n2 3\n3 0').replace('DEPOT_SECTION\n1', 'DEPOT_SECTION\n3')
        instance = parse_vrp(source, 'example.vrp', 2)
        self.assertEqual(instance.vrp.node_ids, [3, 1, 2])
        self.assertEqual(instance.vrp.coordinates, [(104, 100), (100, 100), (101, 101)])
        self.assertEqual([client.demand for client in instance.clients], [2, 3])

    def test_missing_fleet_is_explicit(self):
        with self.assertRaisesRegex(ValueError, 'veículos'):
            parse_vrp(FIXTURE, 'example.vrp')

    def test_costs_do_not_use_display_coordinates(self):
        instance = parse_vrp(FIXTURE, 'example.vrp', 2)
        self.assertEqual(distance_matrix(instance)[0, 1], 1000)
        self.assertEqual(distance_matrix(instance)[0, 2], 4000)
        self.assertEqual(instance.capacity, 10)
        self.assertEqual(Instance.model_validate(instance.model_dump()), instance)
        data = instance.model_dump()
        data['clients'][0]['x'] += 1
        with self.assertRaises(ValueError):
            Instance.model_validate(data)

    def test_multiple_depots_and_restrictions_rejected(self):
        for source in (FIXTURE.replace('1\n-1', '1\n2\n-1'), FIXTURE.replace('EOF', 'TIME_WINDOW_SECTION\n1 0 20\nEOF')):
            with self.assertRaises(ValueError):
                parse_vrp(source, 'example.vrp', 2)

    def test_explicit_directed_costs(self):
        source = FIXTURE.replace('EUC_2D', 'EXPLICIT\nEDGE_WEIGHT_FORMAT: FULL_MATRIX').replace('NODE_COORD_SECTION', 'EDGE_WEIGHT_SECTION\n0 7 8\n9 0 2\n3 4 0\nNODE_COORD_SECTION')
        matrix = distance_matrix(parse_vrp(source, 'example.vrp', 2))
        self.assertEqual(matrix[0, 1], 7000)
        self.assertEqual(matrix[1, 0], 9000)

if __name__ == '__main__':
    unittest.main()
