import { distance } from "../api";
import { roadDeviation } from "./model";

export default function DistanceComparison({
  costTicks,
  roadMetres,
}: {
  costTicks: number;
  roadMetres: number;
}) {
  const deviation = roadDeviation(costTicks, roadMetres);
  return (
    <>
      <dl>
        <dt>Custo histórico euclidiano</dt>
        <dd>{distance(costTicks)} m</dd>
        <dt>Distância nas ruas · OSRM</dt>
        <dd>{distance(roadMetres * 1000)} m</dd>
        <dt>Diferença (OSRM − estimativa)</dt>
        <dd>{distance(deviation.differenceMetres * 1000)} m</dd>
        <dt>Desvio absoluto relativo ao OSRM</dt>
        <dd>
          {deviation.absolutePercent == null
            ? "Indefinido: distância OSRM zero"
            : deviation.absolutePercent.toLocaleString("pt-BR", {
                maximumFractionDigits: 2,
              }) + "%"}
        </dd>
      </dl>
      <small>
        Desvio = |OSRM − euclidiana| ÷ OSRM × 100. Mesma sequência de
        paradas, incluindo retorno ao depósito.
      </small>
    </>
  );
}
