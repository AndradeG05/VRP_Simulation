import { vehicleCapacity, fleetCapacities } from "../types";
import { distance } from "../api";
import type { Run, Solution } from "../types";
import type { GeographicInstance } from "./model";

export default function ModelReport({
  instance,
  solution,
  label,
  run,
}: {
  instance: GeographicInstance;
  solution: Solution | null;
  label: string;
  run: Run<GeographicInstance> | null;
}) {
  const demand = instance.clients.reduce((total, c) => total + c.demand, 0);
  const caps = fleetCapacities(instance);
  const lowerBound = Math.ceil(demand / Math.max(...caps));
  const road = !!instance.road_matrix;
  const pending = instance.schema_version === 3 && !road;
  const config = run?.request.config;
  const result = run?.result;
  return (
    <details className="geo-model-report">
      <summary>Modelo CVRP e validação</summary>
      <p>
        Um depósito, entregas integrais e capacidade por veículo. Cada cliente
        deve aparecer exatamente uma vez. As rotas saem do depósito e retornam a
        ele.
      </p>
      <dl>
        <dt>Clientes</dt>
        <dd>{instance.clients.length}</dd>
        <dt>Frota disponível</dt>
        <dd>
          {instance.vehicles} veículos · capacidades {caps.join(", ")}
        </dd>
        <dt>Demanda total</dt>
        <dd>
          {demand} / {caps.reduce((a, b) => a + b, 0)} de capacidade agregada
        </dd>
        <dt>Mínimo pela demanda</dt>
        <dd>
          {lowerBound} veículos = teto({demand} / {Math.max(...caps)})
        </dd>
        <dt>Objetivo</dt>
        <dd>
          {road
            ? "Minimizar a soma dos custos da matriz viária; sentidos de viagem preservados."
            : pending
              ? "Aguardando matriz viária OSRM; nenhum custo calculado."
              : "Minimizar distância euclidiana em UTM; matriz simétrica."}{" "}
          Sem custo fixo por veículo.
        </dd>
        <dt>Arredondamento</dt>
        <dd>
          {road
            ? "Cada arco: floor(metros retornados pelo provedor × 1000 + 0,5) ticks."
            : pending
              ? "Metros por arco estarão disponíveis após a consulta."
              : "Cada arco: floor(1000 × distância em metros + 0,5)."}{" "}
          A soma em ticks é dividida por 1000.
        </dd>
      </dl>
      <p>
        O mínimo pela demanda é um limite inferior. A distribuição das entregas
        entre os veículos também precisa respeitar a capacidade de cada rota.
      </p>
      <p>
        {road
          ? "A auditoria soma as arestas da matriz recebida; arquivos importados não certificam a origem externa dos dados."
          : pending
            ? "A execução exige a matriz completa, sem distâncias substitutas."
            : "Este replay histórico usa custos euclidianos. Novas buscas exigem a matriz OSRM."}{" "}
        Janelas de tempo, trânsito, tempo de serviço e coletas não fazem parte
        deste modelo.
      </p>
      <h3>{label}</h3>
      {solution ? (
        <>
          <p className="geo-audit-status" role="status">
            {solution.feasible
              ? "Validação independente: solução viável."
              : "Validação independente: solução inválida."}
            {` Clientes atendidos: ${solution.served}/${instance.clients.length}. Veículos usados: ${solution.routes.length}/${instance.vehicles}.`}
          </p>
          <p>
            Custo recalculado: {solution.cost_ticks} ticks ={" "}
            {distance(solution.cost_ticks)} m.{" "}
            {solution.errors.length
              ? solution.errors.join(" ")
              : "Nenhum erro de cobertura, capacidade, frota ou custo registrado."}
          </p>
          <p>
            Ótimo global não comprovado. Gap indisponível: não há limite
            inferior de custo nem melhor valor conhecido registrado.
          </p>
          <div
            className="geo-route-table"
            tabIndex={0}
            role="region"
            aria-label="Rotas auditadas"
          >
            <table>
              <caption>Rotas auditadas · {label.toLowerCase()}</caption>
              <thead>
                <tr>
                  <th scope="col">Veículo</th>
                  <th scope="col">Sequência</th>
                  <th scope="col">Carga / capacidade</th>
                  <th scope="col">Custo otimizado (m)</th>
                </tr>
              </thead>
              <tbody>
                {solution.routes.map((route) => (
                  <tr key={route.vehicle}>
                    <th scope="row">V{route.vehicle}</th>
                    <td>{[0, ...route.visits, 0].join(" → ")}</td>
                    <td>
                      {route.load} / {vehicleCapacity(instance, route.vehicle)}
                    </td>
                    <td>{distance(route.cost_ticks)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p>
          Nenhuma solução validada disponível. Isso, por si só, não comprova
          inviabilidade.
        </p>
      )}
      {config && (
        <>
          <h3>Execução registrada</h3>
          <dl>
            <dt>Biblioteca</dt>
            <dd>{config.adapter === "pyvrp" ? "PyVRP" : "OR-Tools"}</dd>
            <dt>Seed da busca</dt>
            <dd>{config.seed ?? "Não exposta por este adaptador"}</dd>
            <dt>Limite solicitado</dt>
            <dd>
              {config.stop === "iterations"
                ? `${config.max_iterations} iterações`
                : `${config.time_limit} segundos`}
            </dd>
            <dt>Amostragem configurada</dt>
            <dd>
              {config.adapter === "pyvrp"
                ? `Intervalo mínimo de ${config.sample_every} iterações e 100 ms; inclui todas as melhorias`
                : "Callbacks de soluções com amostragem temporal"}
            </dd>
            {result && (
              <>
                <dt>Método</dt>
                <dd>{result.algorithm}</dd>
                <dt>Tempo da busca / total</dt>
                <dd>
                  {result.solver_runtime.toFixed(3)} s /{" "}
                  {result.wall_runtime.toFixed(3)} s
                </dd>
                <dt>Versões</dt>
                <dd>
                  {Object.entries(result.versions)
                    .map(([name, version]) => `${name} ${version}`)
                    .join(" · ")}
                </dd>
              </>
            )}
          </dl>
          <p>
            Os parâmetros pertencem à execução salva. O replay exportado inclui
            a instância, o plano inicial e os checkpoints para conferência.
            Limites por tempo podem produzir resultados diferentes entre
            execuções.
          </p>
        </>
      )}
    </details>
  );
}
