import { useEffect, useState } from "react";
import type { Client, Point } from "./types";
export default function PointEditor({
  point,
  disabled,
  onSave,
}: {
  point: Point | Client;
  disabled: boolean;
  onSave: (point: Point & { demand?: number }) => void;
}) {
  const [x, setX] = useState(point.x),
    [y, setY] = useState(point.y),
    [demand, setDemand] = useState("demand" in point ? point.demand : 1);
  useEffect(() => {
    setX(point.x);
    setY(point.y);
    if ("demand" in point) setDemand(point.demand);
  }, [point]);
  return (
    <fieldset disabled={disabled}>
      <label className="number-field">
        <span>Coordenada X</span>
        <input
          aria-label="Coordenada X"
          type="number"
          min={0}
          max={100}
          step=".1"
          value={x}
          onChange={(e) => setX(Number(e.target.value))}
        />
      </label>
      <label className="number-field">
        <span>Coordenada Y</span>
        <input
          aria-label="Coordenada Y"
          type="number"
          min={0}
          max={100}
          step=".1"
          value={y}
          onChange={(e) => setY(Number(e.target.value))}
        />
      </label>
      {"demand" in point && (
        <label className="number-field">
          <span>Demanda</span>
          <input
            aria-label="Demanda do cliente"
            type="number"
            min={1}
            max={10000}
            value={demand}
            onChange={(e) => setDemand(Number(e.target.value))}
          />
        </label>
      )}
      <button
        className="button"
        onClick={() =>
          onSave({ x, y, ...("demand" in point ? { demand } : {}) })
        }
      >
        Salvar ponto
      </button>
    </fieldset>
  );
}
