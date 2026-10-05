# Importação VRP

No laboratório, use "Importar instância" para abrir um `.vrp` CVRP com um depósito.

`DIMENSION` conta clientes e depósito. Um arquivo `P-n60-k15`, com dimensão 60 e capacidade 80, carrega 59 clientes, um depósito e até 15 veículos de capacidade 80. A solução pode usar menos veículos.

A frota vem de `VEHICLES`, do número de veículos em `COMMENT` ou do sufixo `-kN` em `NAME` ou no nome do arquivo. Informe a quantidade manualmente quando ela estiver ausente. Declarações conflitantes são rejeitadas.

`DEPOT_SECTION` contém o ID do depósito e termina com `-1`. `EOF` encerra o arquivo. A demanda do depósito deve ser zero; as dos clientes devem ser positivas.

Tipos aceitos: `EUC_2D`, `CEIL_2D`, `FLOOR_2D`, `EXACT_2D` e `EXPLICIT`, com `FULL_MATRIX` ou `LOWER_ROW`.

A vista "Coordenadas" preserva a proporção dos eixos. "Distribuída" espaça os nós apenas na exibição. Clique em um nó para consultar seu ID e X/Y.

Após importar, você pode ajustar demandas e frota. As coordenadas e os nós ficam fixos para preservar a matriz de custos.
