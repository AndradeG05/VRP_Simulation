# Grade geográfica sintética

`synthetic-grid.json` contém um depósito e 42 clientes dispostos em uma grade de sete colunas por seis linhas, com passo de 0,002 grau. As coordenadas são valores sintéticos definidos para o teste; não identificam clientes ou entregas reais.

O arquivo contém apenas a instância de entrada, sem matriz consultada, solução, eventos, estatísticas ou identificação de execução. `backend/tests/run_live_map.py` usa subconjuntos dessa grade para consultar o serviço OSRM. A matriz e as respostas das consultas são gravadas somente na pasta local `test-results/`.
