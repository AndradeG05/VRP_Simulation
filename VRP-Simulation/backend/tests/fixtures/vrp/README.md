# Instâncias de teste

A-n32-k5, B-n31-k5, E-n22-k4, E-n51-k5, P-n19-k2 e P-n60-k15 têm referências públicas no [CVRPLIB](https://galgos.inf.puc-rio.br/cvrplib/index.php/en/instances). Os arquivos `.sol` são as soluções de referência disponíveis para os cinco primeiros casos.

O [manifesto](sources.json) registra o endereço público de cada arquivo, a data da consulta, os hashes SHA-256 local e público e o método de comparação. Os arquivos locais foram mantidos. Em P-n60-k15, o `COMMENT` local omite `Optimal value: 968` e o fechamento do parêntese. O parser produz o mesmo fingerprint para as duas versões; coordenadas, demandas, frota e custos importados correspondem.

As [condições do CVRPLIB](https://galgos.inf.puc-rio.br/cvrplib/index.php/en/register/terms), seção 6, disponibilizam os dados para pesquisa e informam que a redistribuição pode depender de condições adicionais da documentação do conjunto. Essas fixtures não recebem automaticamente a licença do código da aplicação. Consulte essas condições antes de redistribuir os dados.

`explicit-lower-row.vrp` é uma fixture local, conforme seu `COMMENT`. Verifica uma matriz `EXPLICIT LOWER_ROW`, demandas e depósito com ID 2. Não há benchmark público declarado para esse arquivo.
