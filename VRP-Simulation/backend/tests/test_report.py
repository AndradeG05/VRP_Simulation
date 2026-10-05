import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import write_report


class ReportEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.output = self.root / 'test-results'
        self.output.mkdir()
        (self.root / 'docs').mkdir()
        self.save('backend.json', {'tested_at': '2026-01-02T03:04:05Z', 'tests': 1, 'failures': 0, 'errors': 0, 'skipped': 0, 'versions': {'ortools': 'test', 'pyvrp': 'test'}, 'scenarios': []})
        self.save('live-map.json', {'tested_at': '2026-01-01T03:04:05Z', 'cases': [], 'errors': []})
        (self.output / 'frontend.txt').write_text('tests 1\nfail 0\n', encoding='utf-8')
        (self.output / 'build.txt').write_text('built in 1ms', encoding='utf-8')

    def tearDown(self):
        self.temp.cleanup()

    def save(self, name, data):
        (self.output / name).write_text(json.dumps(data), encoding='utf-8')

    def report(self):
        with patch.object(write_report, '__file__', str(self.root / 'backend/tests/write_report.py')):
            write_report.main()
        content = (self.output / 'report.md').read_text(encoding='utf-8')
        return content.split('## Interface')[1].split('## Executar novamente')[0]

    def test_report_stays_local_without_overwriting_public_documentation(self):
        documentation = self.root / 'docs/TESTING.md'
        original = '# Testes\n\nInstrucoes de execucao.\n'
        documentation.write_text(original, encoding='utf-8')
        with patch.object(write_report, '__file__', str(self.root / 'backend/tests/write_report.py')):
            write_report.main()
        self.assertEqual(documentation.read_text(encoding='utf-8'), original)
        report = (self.output / 'report.md').read_text(encoding='utf-8')
        self.assertIn('[backend.txt](backend.txt)', report)
        self.assertNotIn('../test-results/', report)

    def test_missing_ui_evidence_does_not_claim_a_successful_flow(self):
        section = self.report()
        self.assertNotIn('P-n60-k15', section)
        self.assertNotIn('O teste no navegador confirmou', section)
        self.assertNotIn('download.json', section)
        self.assertIn('Sem registro', section)

    def test_manual_checks_are_read_from_their_artifact(self):
        self.save('ui.json', {'tested_at': '2026-01-02T01:02:03Z', 'checks': [{'scenario': 'mapa', 'check': 'Importação do arquivo controlado', 'result': 'Erro 422 observado'}]})
        section = self.report()
        self.assertIn('2026-01-02T01:02:03Z', section)
        self.assertIn('Importação do arquivo controlado', section)
        self.assertIn('Erro 422 observado', section)
        self.assertNotIn('P-n60-k15', section)

    def test_failed_download_is_not_reported_as_preserved(self):
        self.save('download.json', {'name': 'Falha de teste', 'customers': 2, 'vehicles': 1, 'capacity': 10, 'matrix_preserved': False, 'hash': '0' * 64})
        section = self.report()
        self.assertIn('Falha de teste', section)
        self.assertIn('não', section)
        self.assertNotIn('hash e matriz de custos preservados', section)

    def test_automated_ui_results_include_failures(self):
        self.save('ui-automated.json', {'numPassedTests': 1, 'numFailedTests': 1, 'startTime': 1767315845000,
                                      'testResults': [{'assertionResults': [{'title': 'Fluxo completo', 'status': 'passed'}, {'title': 'Rejeição de replay', 'status': 'failed'}]}]})
        section = self.report()
        self.assertIn('1 passou', section)
        self.assertIn('1 falhou', section)
        self.assertIn('Rejeição de replay', section)
        self.assertIn('failed', section)


if __name__ == '__main__':
    unittest.main()
