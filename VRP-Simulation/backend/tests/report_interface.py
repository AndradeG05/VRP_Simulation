from datetime import datetime, timezone
import json


def optional_record(output, name):
    path = output / name
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else None


def cell(value):
    return str(value).replace('|', '\\|').replace('\n', ' ')


def interface_section(output):
    lines = ['## Interface', '']
    automated = optional_record(output, 'ui-automated.json')
    if automated is not None:
        date = datetime.fromtimestamp(automated['startTime'] / 1000, tz=timezone.utc).isoformat()
        lines += [f"Fluxos React em DOM simulado: {automated['numPassedTests']} passou, {automated['numFailedTests']} falhou. Início: `{date}`. [Registro automatizado](../test-results/ui-automated.json).", '',
                  f"Fingerprint do código: `{automated.get('source_revision', 'não registrado')}`.", '',
                  '| Fluxo | Estado |', '|---|---|']
        for suite in automated['testResults']:
            for check in suite['assertionResults']:
                lines.append(f"| {cell(check['title'])} | {cell(check['status'])} |")
        lines += ['', 'Esses testes usam respostas HTTP controladas e substituem os renderizadores de mapa e canvas. Não verificam tiles, layout visual ou serviços externos.', '']
    else:
        lines += ['Sem registro automatizado dos fluxos React.', '']
    manual = optional_record(output, 'ui.json')
    if manual is not None:
        lines += [f"Registro manual: `{manual.get('tested_at', 'data não registrada')}`. Revisão do código: `{manual.get('source_revision', 'não registrada')}`. [ui.json](../test-results/ui.json).", '',
                  'As observações abaixo pertencem à data do arquivo; gerar este relatório não repete a navegação.', '',
                  '| Cenário | Verificação | Observação registrada |', '|---|---|---|']
        for check in manual.get('checks', []):
            lines.append(f"| {cell(check['scenario'])} | {cell(check['check'])} | {cell(check['result'])} |")
        lines.append('')
        if (output / 'screenshots').is_dir():
            lines += ['[Capturas armazenadas](../test-results/screenshots).', '']
    else:
        lines += ['Sem registro manual da interface.', '']
    download = optional_record(output, 'download.json')
    if download is not None:
        preserved = 'sim' if download.get('matrix_preserved') is True else 'não'
        lines += [f"Download registrado: `{cell(download['name'])}`; {download['customers']} clientes, {download['vehicles']} veículos, capacidade {download['capacity']}. Matriz preservada no registro: **{preserved}**. Data: `{download.get('tested_at', 'não registrada')}`. [download.json](../test-results/download.json).", '',
                  f"Hash registrado: `{download['hash']}`.", '']
    compatibility = optional_record(output, 'replay-compatibility.json')
    if compatibility is not None:
        lines += [f"Revalidação local dos replays armazenados: `{compatibility['tested_at']}`. [Registro de compatibilidade](../test-results/replay-compatibility.json). A consulta percorreu os arquivos registrados, sem chamadas aos serviços geográficos.", '',
                  '| Replay | HTTP | Hash preservado | Solução preservada |', '|---|---|---|---|']
        for check in compatibility['replays']:
            lines.append(f"| {cell(check['file'])} | {check['status_code']} | {check['hash_preserved']} | {check['solution_preserved']} |")
        lines.append('')
    return lines
