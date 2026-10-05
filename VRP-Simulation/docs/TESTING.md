# Testes

Instale as dependências pelo [README](../README.md). Na pasta que contém `backend` e `frontend`, abra um terminal separado e execute:

```powershell
$env:VRP_SIMULATION_DB = Join-Path $env:TEMP ("vrp-simulation-tests-" + [guid]::NewGuid().ToString() + ".sqlite3")
.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
npm.cmd test --prefix frontend
npm.cmd run build --prefix frontend
```

O backend testa importação VRP, soluções, replay e limites de entrada. O frontend testa funções dos grafos e fluxos da interface, com respostas HTTP e renderizadores simulados. A aparência no navegador precisa de revisão manual.

Para verificar o mapa com OSRM, execute `.venv\Scripts\python.exe backend/tests/run_live_map.py`. Esse comando exige internet e usa um banco temporário.

Os registros em `test-results/` ficam no computador e não entram no Git.
