import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SyntheticLab from '../../src/App';
import GeoLab from '../../src/geo/GeoLab';
import ScenarioApp from '../../src/ScenarioApp';
import native2 from './fixtures/native2.json';
import native6 from './fixtures/native6.json';
import map2 from './fixtures/map2.json';

vi.mock('../../src/RouteMap', async () => {
  const { routeColors } = await import('../../src/carbon/palette');
  return { colours: routeColors, default: ({ instance, onClient }: any) => <div>
    {instance.clients.map((client: any) => <button key={client.id} onClick={() => onClient(client.id)}>Selecionar C{client.id} no plano</button>)}
  </div> };
});
vi.mock('../../src/Convergence', () => ({ default: () => null }));
vi.mock('../../src/geo/OpenStreetMap', () => ({ default: ({ editor, draft, onSelect, onPoint }: any) => <div>
  <button onClick={() => onPoint({ lat: -23.55, lng: -46.63 })}>Clique no mapa</button>
  {draft.clients.map((client: any) => <button key={client.id} onClick={() => onSelect(client.id)}>Selecionar C{client.id} no mapa</button>)}
  {editor}
</div> }));

const geo = {
  schema_version: 3, coordinate_system: 'geographic', name: 'Teste no mapa',
  depot: { lat: -23.55, lng: -46.63 },
  clients: [{ id: 1, lat: -23.56, lng: -46.64, demand: 2 }, { id: 2, lat: -23.57, lng: -46.65, demand: 3 }],
  vehicles: 3, capacity: 30, road_matrix: null,
};
const props = { onSynthetic: vi.fn(), onSyntheticFile: vi.fn(), onSyntheticRun: vi.fn(), onBusy: vi.fn() };
const syntheticProps = { onGeographicFile: vi.fn(), onGeographicRun: vi.fn(), onBusy: vi.fn() };
let requests: { path: string; body: any }[];
let apiResponse: (path: string, body: any) => { status?: number; data: any };
const previewGeo = (instance = geo) => ({
  instance, baseline: null, issues: [], hash: '1'.repeat(64), total_demand: 5,
  cost_ready: false, projection: null, feasibility_status: 'unknown',
});
const savedRun = (request: any = { instance: native2.instance, config: {
  adapter: 'ortools', seed: null, stop: 'time', max_iterations: 5000,
  time_limit: 0.5, sample_every: 25,
} }) => ({
  id: 'ui-run', status: 'completed', created: '2026-10-04T12:00:00Z', request,
  baseline: native2.baseline, error: null, cancel: 0,
  result: {
    solution: native2.baseline, iterations: null, solver_runtime: 0.5,
    wall_runtime: 0.6, stop_reason: 'time', checkpoints: 1,
    instance_hash: native2.hash, versions: { ortools: '9.15.6755' },
    proven_optimal: false, algorithm: 'Guided local search', distance_convention: 'euclidean',
  },
});
const finalEvent = {
  id: 1, run_id: 'ui-run', sequence: 1, instance_hash: native2.hash,
  schema_version: 1, kind: 'checkpoint', payload: {
    elapsed: 0.5, iteration: null, reason: 'final', solution: native2.baseline,
  },
};

beforeEach(() => {
  requests = [];
  apiResponse = (path, body) => {
    if (path === '/api/health') return { data: { status: 'ok', versions: { ortools: '9.15.6755', pyvrp: '0.14.0' } } };
    if (path === '/api/instances/generate') return { data: body.customers === 6 ? native6 : native2 };
    if (path === '/api/instances/preview') return { data: body.coordinate_system ? previewGeo(body) : { ...native2, instance: body } };
    throw new Error(`Resposta de teste não definida: ${path}`);
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ path: url, body });
    const result = apiResponse(url, body);
    return new Response(JSON.stringify(result.data), { status: result.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }));
});

test('laboratório gera clientes com os parâmetros escolhidos', async () => {
  const user = userEvent.setup();
  render(<SyntheticLab {...syntheticProps} />);
  await screen.findByText('Cenário pronto.', { exact: false });
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Clientes' }), { target: { value: '6' } });
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Veículos disponíveis' }), { target: { value: '2' } });
  await user.click(screen.getByRole('button', { name: 'Gerar instância' }));
  await waitFor(() => expect(requests.findLast(r => r.path.endsWith('/generate'))?.body).toMatchObject({ customers: 6, vehicles: 2 }));
  expect(await screen.findByText(/^6 clientes\b/)).toBeTruthy();
});

test('laboratório bloqueia geração acima dos limites e mantém o cenário', async () => {
  const user = userEvent.setup();
  render(<SyntheticLab {...syntheticProps} />);
  await screen.findByText('Cenário pronto.', { exact: false });
  const before = requests.length;
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Clientes' }), { target: { value: '1000' } });
  await user.click(screen.getByRole('button', { name: 'Gerar instância' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringMatching(/999/));
  expect(requests.length).toBe(before);
  expect(screen.getByText(/^2 clientes\b/)).toBeTruthy();
});

test('mapa bloqueia frota acima do limite antes de criar capacidades', async () => {
  const user = userEvent.setup();
  render(<GeoLab {...props} />);
  await user.click(screen.getByRole('button', { name: 'Configurações e histórico' }));
  const input = screen.getByRole('spinbutton', { name: 'Veículos no mapa' });
  fireEvent.change(input, { target: { value: '101' } });
  expect(input).toHaveProperty('value', '3');
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringMatching(/100/));
  expect(screen.queryByRole('spinbutton', { name: 'Capacidade do veículo V4' })).toBeNull();
  fireEvent.change(input, { target: { value: '4' } });
  expect(screen.getByRole('spinbutton', { name: 'Capacidade do veículo V4' })).toBeTruthy();
});

test('mapa recusa arquivo com excesso de clientes sem consultar a API', async () => {
  const file = new File([JSON.stringify({ ...geo, clients: Array.from({ length: 1000 }, (_, i) => ({ ...geo.clients[0], id: i + 1 })) })], 'excesso.json', { type: 'application/json' });
  render(<GeoLab {...props} incomingFile={file} />);
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringMatching(/999/));
  expect(requests.some(r => r.path === '/api/instances/preview')).toBe(false);
});

test('replay rejeitado exibe erro e preserva a instância do laboratório', async () => {
  const user = userEvent.setup();
  const normal = apiResponse;
  apiResponse = (path, body) => path === '/api/replays/validate'
    ? { status: 422, data: { detail: 'Replay inválido: checkpoint sem solução.' } }
    : normal(path, body);
  const { container } = render(<SyntheticLab {...syntheticProps} />);
  await screen.findByText('Cenário pronto.', { exact: false });
  const file = new File([JSON.stringify({ schema_version: 1, request: { instance: native2.instance }, events: [{ id: 1, kind: 'checkpoint', payload: { elapsed: 0, solution: null } }] })], 'replay.json', { type: 'application/json' });
  await user.upload(container.querySelector('input[type="file"]')!, file);
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringMatching(/checkpoint sem solução/));
  expect(screen.getByText(/^2 clientes\b/)).toBeTruthy();
});

test('navegação abre o laboratório ativo e retorna ao mapa', async () => {
  const user = userEvent.setup();
  render(<ScenarioApp />);
  await user.click(screen.getByRole('button', { name: 'Laboratório', exact: true }));
  expect(await screen.findByRole('heading', { name: 'Cenário sintético' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Cenário no mapa', exact: true }));
  expect(screen.getByRole('button', { name: 'Laboratório', exact: true })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Cenário sintético' })).toBeNull();
});

test('laboratório envia parâmetros de busca e apresenta o resultado recebido', async () => {
  const user = userEvent.setup();
  const normal = apiResponse;
  let run = savedRun();
  apiResponse = (path, body) => {
    if (path === '/api/runs' && body) {
      run = savedRun(body);
      return { data: { ...run, status: 'queued', result: null } };
    }
    if (path === '/api/runs/ui-run/events?after=0') return { data: { events: [finalEvent], cursor: 1, has_more: false, status: 'completed' } };
    if (path === '/api/runs/ui-run') return { data: run };
    return normal(path, body);
  };
  render(<SyntheticLab {...syntheticProps} />);
  await screen.findByText('Cenário pronto.', { exact: false });
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Tempo limite (s)' }), { target: { value: '0.5' } });
  await user.click(screen.getByRole('button', { name: 'Otimizar rotas' }));
  expect(await screen.findByText('Solução disponível.', { exact: false })).toBeTruthy();
  expect(requests.find(r => r.path === '/api/runs' && r.body)?.body.config).toMatchObject({ adapter: 'ortools', stop: 'time', time_limit: 0.5 });
  expect(requests.some(r => r.path.includes('/events?after=0'))).toBe(true);
});

test('importação de replay validado carrega solução e parâmetros sem iniciar busca', async () => {
  const user = userEvent.setup();
  const normal = apiResponse;
  const run = savedRun();
  apiResponse = (path, body) => path === '/api/replays/validate'
    ? { data: { run, events: [finalEvent], preview: native2 } } : normal(path, body);
  const { container } = render(<SyntheticLab {...syntheticProps} />);
  await screen.findByText('Cenário pronto.', { exact: false });
  const replay = { schema_version: 1, ...run, events: [finalEvent], statistics: [] };
  await user.upload(container.querySelector('input[type="file"]')!, new File([JSON.stringify(replay)], 'replay.json', { type: 'application/json' }));
  expect(await screen.findByText('Solução disponível.', { exact: false })).toBeTruthy();
  expect(screen.getByRole('spinbutton', { name: 'Tempo limite (s)' })).toHaveProperty('value', '0.5');
  expect(requests.find(r => r.path === '/api/replays/validate')?.body.events[0].payload.solution).toEqual(native2.baseline);
  expect(requests.some(r => r.path === '/api/runs')).toBe(false);
});

test('histórico restaura instância e acompanha os eventos da execução salva', async () => {
  const user = userEvent.setup();
  const normal = apiResponse;
  const run = savedRun();
  apiResponse = (path, body) => {
    if (path === '/api/runs') return { data: [{ id: run.id, status: run.status, created: run.created, name: 'Execução salva', result: run.result }] };
    if (path === '/api/runs/ui-run') return { data: run };
    if (path === '/api/runs/ui-run/events?after=0') return { data: { events: [finalEvent], cursor: 1, has_more: false, status: 'completed' } };
    return normal(path, body);
  };
  render(<SyntheticLab {...syntheticProps} />);
  await screen.findByText('Cenário pronto.', { exact: false });
  await user.click(screen.getByRole('button', { name: 'Histórico', exact: true }));
  const dialog = await screen.findByRole('dialog', { name: 'Histórico de experimentos' });
  await user.click(within(dialog).getByRole('button', { name: /Execução salva/ }));
  expect(await screen.findByText('Solução disponível.', { exact: false })).toBeTruthy();
  expect(screen.queryByRole('dialog', { name: 'Histórico de experimentos' })).toBeNull();
  expect(screen.getByRole('spinbutton', { name: 'Tempo limite (s)' })).toHaveProperty('value', '0.5');
  await waitFor(() => expect(requests.some(r => r.path.includes('/events?after=0'))).toBe(true));
});

test('mapa edita a demanda de cliente importado e bloqueia valor vazio', async () => {
  const user = userEvent.setup();
  const instance = { ...geo, road_matrix: {
    provider: 'osrm', method: 'table', travel_mode: 'DRIVING', routing_preference: 'TRAFFIC_UNAWARE',
    fetched_at: '2026-10-04T12:00:00Z', points: [geo.depot, ...geo.clients].map(p => [p.lat, p.lng]),
    distances_m: [[0, 100, 200], [110, 0, 150], [220, 170, 0]],
  } };
  render(<GeoLab {...props} incomingFile={new File([JSON.stringify(instance)], 'mapa.json', { type: 'application/json' })} />);
  await user.click(await screen.findByRole('button', { name: 'Selecionar C1 no mapa' }));
  const input = screen.getByRole('spinbutton', { name: 'Demanda do cliente selecionado' });
  expect(input).toHaveProperty('value', '2');
  fireEvent.change(input, { target: { value: '' } });
  const before = requests.length;
  await user.click(screen.getByRole('button', { name: 'Salvar demanda' }));
  expect(input.checkValidity()).toBe(false);
  expect(requests.length).toBe(before);
  fireEvent.change(input, { target: { value: '4' } });
  await user.click(screen.getByRole('button', { name: 'Salvar demanda' }));
  await waitFor(() => expect(requests.findLast(r => r.path === '/api/instances/preview')?.body.clients[0].demand).toBe(4));
  expect(requests.findLast(r => r.path === '/api/instances/preview')?.body.road_matrix).toEqual(instance.road_matrix);
  expect(screen.getByRole('spinbutton', { name: 'Demanda do cliente selecionado' })).toHaveProperty('value', '4');
});

test.each(['ortools', 'pyvrp'])('mapa otimiza com %s usando a matriz e o orçamento selecionados', async adapter => {
  const user = userEvent.setup();
  const normal = apiResponse;
  let run = { ...savedRun(), id: 'ui-map', baseline: map2.baseline, result: {
    ...savedRun().result, solution: map2.baseline, instance_hash: map2.hash,
  } };
  apiResponse = (path, body) => {
    if (path === '/api/instances/preview') return { data: map2 };
    if (path === '/api/runs' && body) {
      run = { ...run, request: body };
      return { data: { ...run, status: 'queued', result: null } };
    }
    if (path === '/api/runs/ui-map/events?after=0') return { data: {
      events: [{ ...finalEvent, run_id: 'ui-map', instance_hash: map2.hash,
        payload: { ...finalEvent.payload, solution: map2.baseline } }],
      cursor: 1, has_more: false, status: 'completed',
    } };
    if (path === '/api/runs/ui-map') return { data: run };
    if (path === '/api/roads/geometry') {
      const nodes = [map2.instance.depot, ...map2.instance.clients];
      const legs = body.points.slice(1).map((to: any, i: number) => {
        const from = body.points[i];
        const index = (point: any) => nodes.findIndex(node => node.lat === point.lat && node.lng === point.lng);
        return { path: [from, to], distanceMetres: map2.instance.road_matrix.distances_m[index(from)][index(to)] };
      });
      return { data: { legs, paths: legs.map((leg: any) => leg.path), distanceMetres: legs.reduce((sum: number, leg: any) => sum + leg.distanceMetres, 0), warnings: [], requests: 1 } };
    }
    return normal(path, body);
  };
  render(<GeoLab {...props} incomingFile={new File([JSON.stringify(map2.instance)], 'mapa.json', { type: 'application/json' })} />);
  await screen.findByRole('button', { name: 'Selecionar C1 no mapa' });
  await user.click(screen.getByRole('button', { name: 'Configurações e histórico' }));
  await user.selectOptions(screen.getByRole('combobox', { name: 'Biblioteca no mapa' }), adapter);
  if (adapter === 'pyvrp') fireEvent.change(screen.getByRole('spinbutton', { name: 'Máx. iterações' }), { target: { value: '80' } });
  else fireEvent.change(screen.getByRole('spinbutton', { name: 'Tempo no mapa' }), { target: { value: '0.4' } });
  await user.click(screen.getByRole('button', { name: 'Otimizar cenário' }));
  expect((await screen.findAllByText('Concluído', { exact: true })).length).toBeGreaterThan(0);
  const request = requests.find(r => r.path === '/api/runs' && r.body)!.body;
  expect(request.instance.road_matrix).toEqual(map2.instance.road_matrix);
  expect(request.instance).toMatchObject({ vehicles: 3, capacity: 30, clients: map2.instance.clients });
  expect(request.config).toMatchObject(adapter === 'pyvrp'
    ? { adapter, stop: 'iterations', max_iterations: 80 }
    : { adapter, stop: 'time', time_limit: 0.4 });
  expect(requests.some(r => r.path === '/api/runs/ui-map/events?after=0')).toBe(true);
});
