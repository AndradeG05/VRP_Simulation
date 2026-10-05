import json
from pathlib import Path
import re

from report_interface import interface_section


def main():
    root = Path(__file__).resolve().parents[2]
    output = root/'test-results'
    backend = json.loads((output/'backend.json').read_text(encoding='utf-8'))
    live = json.loads((output/'live-map.json').read_text(encoding='utf-8'))
    frontend = (output/'frontend.txt').read_text(encoding='utf-8-sig')
    frontend_tests = int(re.search(r'tests (\d+)', frontend)[1])
    frontend_failures = int(re.search(r'fail (\d+)', frontend)[1])
    build = (output/'build.txt').read_text(encoding='utf-8-sig')
    lines = [
        '# Testes', '',
        f"Registro do backend: `{backend['tested_at']}`. Consultas OSRM: `{live['tested_at']}`. Os resultados abaixo correspondem a essas execuções; novos testes podem produzir custos diferentes.", '',
        f"Fingerprint dos arquivos de código na execução do backend: `{backend.get('source_revision', 'não registrado')}`. O cálculo SHA-256 usa os caminhos relativos e bytes de `backend/app/*.py` e de `frontend/src` com extensões `.ts`, `.tsx` e `.css`; o procedimento está em [artifacts.py](../backend/tests/artifacts.py).", '',
        '| Verificação | Resultado | Registro |', '|---|---|---|',
        f"| Backend | {backend['tests']} testes, {backend['failures']} falhas, {backend['errors']} erros, {backend['skipped']} ignorados | [backend.txt](../test-results/backend.txt), [backend.json](../test-results/backend.json) |",
        f'| Frontend, funções | {frontend_tests} testes, {frontend_failures} falhas | [frontend.txt](../test-results/frontend.txt) |',
        f"| Build | {'Concluído' if 'built in' in build else 'Confira o log'} | [build.txt](../test-results/build.txt) |",
        f"| OSRM real | {sum(len(c['runs']) for c in live['cases'])} buscas; {len(live['errors'])} erros | [live-map.json](../test-results/live-map.json) |", '',
        f"Versões dos solvers: OR-Tools `{backend['versions']['ortools']}` e PyVRP `{backend['versions']['pyvrp']}`.", '',
        '## Laboratório', '',
        'Os arquivos de referência são A-n32-k5, B-n31-k5, E-n22-k4, E-n51-k5, P-n19-k2 e P-n60-k15. Cada arquivo é importado e executado nos dois solvers. Os testes conferem metadados, hashes dos arquivos, arredondamento dos custos e cobertura dos clientes. As soluções `.sol` disponíveis também são auditadas.', '',
        'As instâncias geradas abaixo usam três configurações: OR-Tools com 0,2 s; PyVRP com 0,2 s e seed 0; PyVRP com 40 iterações e seed 99. A amostragem é 10 nos testes por tempo e 25 nos testes por iterações.', '',
        '| Distribuição | Clientes | Veículos | Capacidades | Seed da instância | Demanda máxima |', '|---|---|---|---|---|---|',
    ]
    for record in backend['scenarios']:
        if record['scenario'] == 'laboratorio' and record['config']['adapter'] == 'ortools':
            source = record['input']
            capacities = str(record['capacities'][0]) if len(set(record['capacities'])) == 1 else ', '.join(map(str, record['capacities']))
            lines.append(f"| {source['distribution']} | {record['customers']} | {record['vehicles']} | {capacities} | {source['seed']} | {source['max_demand']} |")
    lines += [
        '', '## Mapa', '',
        'Os testes com respostas controladas cobrem matrizes direcionadas com 2, 8 e 15 clientes, incluindo capacidades individuais. Verificam montagem em blocos, cache, ordem dos pontos, precisão decimal, geometria dividida em consultas e respostas incompletas ou inválidas. Também cobrem a rejeição de uma matriz pertencente a outras coordenadas, edição de demanda, planos manuais e limites de parâmetros.', '',
        'As consultas reais usam coordenadas do exemplo local de São Paulo. Os subconjuntos e a demanda total estão registrados em `live-map.json`; as demandas individuais estão nos replays referenciados por `replay_file`. São demandas de teste, sem identificação de clientes reais. Cada cenário foi executado com OR-Tools por 0,4 s, PyVRP por 0,4 s com seed 0 e PyVRP por 80 iterações com seed 99. Os replays exportados foram reimportados e auditados.', '',
        '| Clientes | Frota | Capacidade | Solver | Parada | Custo em km | Veículos usados |', '|---|---|---|---|---|---|---|',
    ]
    for case in live['cases']:
        for run in case['runs']:
            config = run['config']
            stop = f"{config['time_limit']} s" if config['stop'] == 'time' else f"{config['max_iterations']} iterações"
            lines.append(f"| {case['customers']} | {case['vehicles']} | {case['capacity']} | {config['adapter']} | {stop} | {run['cost_ticks']/1_000_000:.4f} | {run['used_vehicles']} |")
    lines += [
        '', 'O custo em km é `cost_ticks / 1000000`. Para cada rota, a verificação percorre a sequência com retorno ao depósito, soma os arcos da matriz, recalcula a carga e confere o veículo. A geometria da solução PyVRP por iterações foi consultada em cada cenário, incluindo todos os trechos e o retorno. Custos da geometria e da matriz são registrados separadamente.', '',
    ]
    lines += interface_section(output)
    lines += [
        '## Executar novamente', '', 'Na pasta que contém `backend` e `frontend`:', '', '```powershell',
        '.venv\\Scripts\\python.exe backend/tests/run_checks.py',
        'npm.cmd test --prefix frontend', 'npm.cmd run build --prefix frontend',
        '.venv\\Scripts\\python.exe backend/tests/run_live_map.py',
        '.venv\\Scripts\\python.exe backend/tests/write_report.py', '```', '',
        '`run_checks.py` grava o relatório do backend. `run_live_map.py` exige acesso à internet e grava matrizes, soluções e replays em `test-results`. Os testes de frontend podem ser executados sem serviços externos.', '',
        '## Limites da verificação', '',
        'Os resultados verificam as instâncias e parâmetros registrados. Não comprovam ótimo global, capacidade ilimitada de processamento ou disponibilidade futura dos serviços externos. A geometria é consultada separadamente da matriz e pode ter custo diferente.', '',
        'Os avisos do backend estão registrados em backend.txt e backend.json. O build concluiu com aviso de bundles maiores que 500 kB. A instalação em uma máquina limpa e a execução com Docker não foram testadas neste registro.', '',
    ]
    content = '\n'.join(lines).replace('../test-results/', '')
    (output/'report.md').write_text(content, encoding='utf-8')


if __name__ == '__main__':
    main()
