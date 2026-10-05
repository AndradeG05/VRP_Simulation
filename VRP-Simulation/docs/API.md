# API

Com o backend em execução, consulte os parâmetros e formatos em [localhost:8000/docs](http://127.0.0.1:8000/docs). O contrato completo está em [openapi.json](http://127.0.0.1:8000/openapi.json).

| Método e caminho | Uso |
|---|---|
| `GET /api/health` | Estado e versões dos solvers |
| `POST /api/instances/generate` | Gerar instância |
| `POST /api/instances/import-vrp` | Importar `.vrp` |
| `POST /api/instances/preview` | Validar instância e calcular baseline |
| `POST /api/plans/validate` | Validar rotas manuais |
| `POST /api/roads/matrix` | Consultar custos OSRM |
| `POST /api/roads/geometry` | Consultar trajetos |
| `GET /api/places?q=...` | Buscar lugares |
| `GET /api/tiles/{z}/{x}/{y}.png` | Obter imagem do mapa |
| `POST /api/runs` | Iniciar busca, com resposta `202` |
| `GET /api/runs` | Listar execuções |
| `GET /api/runs/{run_id}` | Consultar execução |
| `GET /api/runs/{run_id}/events?after=...` | Ler eventos pelo cursor |
| `POST /api/runs/{run_id}/cancel` | Solicitar cancelamento |
| `GET /api/runs/{run_id}/export?format=json` | Exportar JSON, CSV ou SOL |
| `POST /api/replays/validate` | Validar replay |

As instâncias aceitam de 2 a 999 clientes e de 1 a 100 veículos. A frota informa a quantidade disponível. No mapa, calcule a matriz OSRM antes de otimizar ou validar rotas.

Execute a API com um worker. São permitidas até duas buscas simultâneas. Em `/api/runs`, `instance` é obrigatório; `config` e `initial_routes` são opcionais.

Entradas inválidas retornam `422`; o limite de buscas retorna `429`; falhas dos serviços de mapa retornam `502`. A exportação de uma busca ativa retorna `409`.
