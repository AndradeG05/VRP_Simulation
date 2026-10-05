import math
import re
from .schemas import Instance
from .limits import MAX_NODES, MAX_VEHICLES


def declared_fleet(headers: dict[str, str], filename: str) -> tuple[int | None, str | None]:
    sources = []
    if 'VEHICLES' in headers:
        sources.append(('VEHICLES', int(headers['VEHICLES'])))
    for match in re.finditer(r'\b(?:no\.?\s+of\s+trucks|number\s+of\s+(?:trucks|vehicles))\s*:\s*(\d+)\b', headers.get('COMMENT', ''), re.IGNORECASE):
        sources.append(('COMMENT', int(match.group(1))))
    name = re.sub(r'\.vrp$', '', headers.get('NAME', ''), flags=re.IGNORECASE)
    match = re.search(r'-k(\d+)$', name, re.IGNORECASE)
    if match:
        sources.append(('NAME', int(match.group(1))))
    if not sources:
        match = re.search(r'-k(\d+)\.vrp$', filename, re.IGNORECASE)
        if match:
            sources.append(('nome do arquivo', int(match.group(1))))
    if len({count for _, count in sources}) > 1:
        raise ValueError('Quantidades de veículos divergentes no arquivo: ' + ', '.join(f'{label}={count}' for label, count in sources) + '.')
    return (sources[0][1], sources[0][0]) if sources else (None, None)


def parse_vrp(text: str, filename: str, vehicles: int | None = None) -> Instance:
    headers, sections = {}, {}
    section = None
    for raw in text.lstrip('\ufeff').splitlines():
        line = raw.strip()
        if line == 'EOF':
            break
        if not line:
            continue
        if line.endswith('_SECTION'):
            if line not in {'NODE_COORD_SECTION', 'DEMAND_SECTION', 'DEPOT_SECTION', 'EDGE_WEIGHT_SECTION', 'DISPLAY_DATA_SECTION'}:
                raise ValueError(f'Seção não suportada: {line}.')
            if line in sections:
                raise ValueError(f'Seção duplicada: {line}.')
            section = line
            sections[section] = []
        elif section:
            sections[section].append(line)
        else:
            key, _, value = line.partition(':')
            if not value:
                fields = line.split(maxsplit=1)
                if len(fields) != 2:
                    raise ValueError(f'Cabeçalho inválido: {line}.')
                key, value = fields
            key = key.strip().upper()
            if key in headers:
                if key != 'COMMENT':
                    raise ValueError(f'Cabeçalho duplicado: {key}.')
                headers[key] += ' ' + value.strip()
            else:
                headers[key] = value.strip()
    try:
        unsupported = set(headers) - {'NAME', 'TYPE', 'COMMENT', 'DIMENSION', 'CAPACITY', 'VEHICLES', 'EDGE_WEIGHT_TYPE', 'EDGE_WEIGHT_FORMAT', 'DISPLAY_DATA_TYPE', 'NODE_COORD_TYPE', 'BEST_KNOWN'}
        if unsupported:
            raise ValueError(f'Cabeçalhos não suportados: {sorted(unsupported)}.')
        if headers.get('TYPE') != 'CVRP':
            raise ValueError('O arquivo deve declarar TYPE: CVRP.')
        n, capacity = int(headers['DIMENSION']), int(headers['CAPACITY'])
        if not 3 <= n <= MAX_NODES:
            raise ValueError(f'Importação aceita de 3 a {MAX_NODES} nós, incluindo o depósito.')
        declared_vehicles, fleet_source = declared_fleet(headers, filename)
        if declared_vehicles is not None and vehicles is not None and vehicles != declared_vehicles:
            raise ValueError(f'O arquivo declara {fleet_source}: {declared_vehicles} veículos. A importação deve respeitar essa quantidade.')
        count = declared_vehicles if declared_vehicles is not None else vehicles
        if count is None:
            raise ValueError('Informe a quantidade de veículos; ela não foi encontrada em VEHICLES, COMMENT ou no sufixo -k do nome.')
        if not 1 <= count <= MAX_VEHICLES:
            raise ValueError(f'A quantidade de veículos deve estar entre 1 e {MAX_VEHICLES}.')
        demands = {}
        for line in sections.get('DEMAND_SECTION', []):
            node, demand = map(int, line.split())
            if node in demands:
                raise ValueError('Demanda duplicada.')
            demands[node] = demand
        if set(demands) != set(range(1, n + 1)):
            raise ValueError('DEMAND_SECTION deve conter todos os IDs de 1 a DIMENSION.')
        depot_tokens = [token for line in sections.get('DEPOT_SECTION', []) for token in line.split()]
        if '-1' not in depot_tokens:
            raise ValueError('DEPOT_SECTION deve terminar com -1.')
        end = depot_tokens.index('-1')
        if end != len(depot_tokens) - 1:
            raise ValueError('DEPOT_SECTION contém dados após o marcador -1.')
        depots = [int(token) for token in depot_tokens[:end]]
        if len(depots) != 1 or depots[0] not in demands or demands[depots[0]] != 0:
            raise ValueError('É necessário um único depósito com demanda zero.')
        order = [depots[0], *[i for i in range(1, n + 1) if i != depots[0]]]
        coords = {}
        for line in sections.get('NODE_COORD_SECTION', sections.get('DISPLAY_DATA_SECTION', [])):
            tokens = line.split()
            if len(tokens) != 3:
                raise ValueError('Coordenada inválida.')
            node = int(tokens[0])
            point = tuple(map(float, tokens[1:]))
            if node in coords or not all(math.isfinite(v) for v in point):
                raise ValueError('Coordenadas duplicadas ou não finitas.')
            coords[node] = point
        if coords and set(coords) != set(demands):
            raise ValueError('Coordenadas devem conter todos os nós.')
        kind = headers.get('EDGE_WEIGHT_TYPE')
        if 'EDGE_WEIGHT_SECTION' in sections and kind != 'EXPLICIT':
            raise ValueError('EDGE_WEIGHT_SECTION exige EDGE_WEIGHT_TYPE: EXPLICIT; os custos fornecidos não podem ser ignorados.')
        if kind == 'EXPLICIT':
            fmt = headers.get('EDGE_WEIGHT_FORMAT')
            values = [float(v) for line in sections.get('EDGE_WEIGHT_SECTION', []) for v in line.split()]
            matrix = [[0.0] * n for _ in range(n)]
            if fmt == 'FULL_MATRIX' and len(values) == n * n:
                matrix = [values[i*n:(i+1)*n] for i in range(n)]
            elif fmt == 'LOWER_ROW' and len(values) == n*(n-1)//2:
                k = 0
                for i in range(n):
                    for j in range(i):
                        matrix[i][j] = matrix[j][i] = values[k]
                        k += 1
            else:
                raise ValueError('Matriz EXPLICIT exige FULL_MATRIX ou LOWER_ROW completa.')
            if any(not math.isfinite(v) or v < 0 or v > 1e9 for row in matrix for v in row):
                raise ValueError('Custos explícitos inválidos.')
            if any(matrix[i][i] != 0 for i in range(n)):
                raise ValueError('A diagonal da matriz deve ser zero.')
            costs = [[math.floor(matrix[i-1][j-1]*1000 + .5) for j in order] for i in order]
        elif kind in {'EUC_2D', 'CEIL_2D', 'FLOOR_2D', 'EXACT_2D'}:
            if set(coords) != set(demands) or 'NODE_COORD_SECTION' not in sections:
                raise ValueError('Este tipo de custo exige NODE_COORD_SECTION completa.')
            def ticks(i, j):
                d = math.dist(coords[i], coords[j])
                if kind == 'EXACT_2D':
                    return math.floor(d*1000 + .5)
                return (math.ceil(d) if kind == 'CEIL_2D' else math.floor(d) if kind == 'FLOOR_2D' else math.floor(d+.5))*1000
            costs = [[ticks(i, j) for j in order] for i in order]
        else:
            raise ValueError(f'EDGE_WEIGHT_TYPE não suportado: {kind}.')
        original = [coords[i] for i in order] if coords else None
        if original:
            low = [min(p[k] for p in original) for k in (0, 1)]
            span = max(max(p[k] for p in original)-low[k] for k in (0, 1)) or 1
            display = [(5+(p[0]-low[0])*90/span, 5+(p[1]-low[1])*90/span) for p in original]
        else:
            display = [(50+40*math.cos(2*math.pi*i/n), 50+40*math.sin(2*math.pi*i/n)) for i in range(n)]
        return Instance(name=headers.get('NAME', filename)[:80], depot=dict(zip(('x', 'y'), display[0])), clients=[dict(id=i, x=display[i][0], y=display[i][1], demand=demands[node]) for i, node in enumerate(order[1:], 1)], vehicles=count, capacity=capacity, vrp={'filename': filename, 'edge_weight_type': kind, 'node_ids': order, 'coordinates': original, 'display_points': display, 'costs_ticks': costs})
    except (KeyError, TypeError, OverflowError) as exc:
        raise ValueError('Arquivo VRP incompleto ou inválido.') from exc
