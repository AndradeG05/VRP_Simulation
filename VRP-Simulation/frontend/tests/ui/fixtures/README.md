# Dados dos testes React

`native2.json` e `native6.json` são previews obtidos pela API local em `/api/instances/generate`. Contêm dois e seis clientes, respectivamente, frota de dois veículos, capacidade 60, seed 7 e distribuição uniforme. As demandas, coordenadas, baseline e hash estão nos arquivos.

`map2.json` foi produzido por `/api/instances/preview` com dois clientes, três veículos e capacidade 30. A matriz de três pontos é controlada pelo teste: `[[0,100,200],[110,0,150],[220,170,0]]`, em metros. Nenhuma consulta geográfica externa foi usada para esse arquivo.

Os testes usam esses dados para conferir requisições e estados dos componentes. Respostas de busca e geometria são controladas. Esses resultados não medem o desempenho dos solvers ou a qualidade dos trajetos reais.
