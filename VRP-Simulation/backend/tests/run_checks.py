import importlib.metadata
import json
from pathlib import Path
import sys
import time
import unittest
import warnings

from artifacts import source_revision


def main():
    root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root))
    output = root/'test-results'
    output.mkdir(exist_ok=True)
    started = time.time()
    with warnings.catch_warnings(record=True) as captured:
        warnings.simplefilter('default')
        suite = unittest.defaultTestLoader.discover(str(root/'backend/tests'))
        with (output/'backend.txt').open('w', encoding='utf-8') as log:
            result = unittest.TextTestRunner(stream=log, verbosity=2).run(suite)
            for warning in captured:
                detail = warnings.formatwarning(warning.message, warning.category, warning.filename, warning.lineno)
                log.write(detail)
                sys.stderr.write(detail)
    import test_scenarios
    report = dict(tested_at=time.strftime('%Y-%m-%dT%H:%M:%S%z'), elapsed_seconds=round(time.time()-started, 3),
                  source_revision=source_revision(root),
                  tests=result.testsRun, failures=len(result.failures), errors=len(result.errors), skipped=len(result.skipped),
                  versions={name: importlib.metadata.version(name) for name in ('ortools', 'pyvrp', 'fastapi')},
                  warnings=[dict(category=warning.category.__name__, message=str(warning.message),
                                 filename=warning.filename, line=warning.lineno) for warning in captured],
                  scenarios=test_scenarios.CHECKS)
    (output/'backend.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({key: value for key, value in report.items() if key != 'scenarios'}, ensure_ascii=False))
    for test, detail in result.failures+result.errors:
        print(test.id(), detail)
    return int(not result.wasSuccessful())


if __name__ == '__main__':
    raise SystemExit(main())
