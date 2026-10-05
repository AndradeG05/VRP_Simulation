import { vehicleCapacity } from '../types';
import { MAX_VEHICLES } from '../limits';
import type { GeoDraft } from './model';

export default function FleetSettings({ draft, disabled, onChange, onError }: {
  draft: GeoDraft;
  disabled: boolean;
  onChange: (draft: GeoDraft) => void;
  onError: (message: string) => void;
}) {
  return <>
    <div className="geo-fields">
      <label>
        Veículos
        <input
          aria-label="Veículos no mapa"
          type="number"
          min={1}
          max={MAX_VEHICLES}
          value={draft.vehicles}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.valueAsNumber;
            if (Number.isSafeInteger(v) && v >= 1 && v <= MAX_VEHICLES)
              onChange({
                ...draft,
                vehicles: v,
                fleet: Array.from({ length: v }, (_, i) => ({
                  id: i + 1,
                  capacity: vehicleCapacity(draft, i + 1),
                })),
              });
            else onError(`A frota deve conter de 1 a ${MAX_VEHICLES} veículos.`);
          }}
        />
      </label>
      <label>
        Capacidade para aplicar
        <input
          aria-label="Capacidade no mapa"
          type="number"
          min={1}
          max={10000}
          value={draft.capacity}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.valueAsNumber;
            if (Number.isSafeInteger(v) && v >= 1 && v <= 10000)
              onChange({ ...draft, capacity: v });
          }}
        />
      </label>
    </div>
    <button
      className="geo-wide"
      disabled={disabled}
      onClick={() =>
        onChange({
          ...draft,
          fleet: Array.from({ length: draft.vehicles }, (_, i) => ({
            id: i + 1,
            capacity: draft.capacity,
          })),
        })
      }
    >
      Aplicar capacidade a todos
    </button>
    <div
      className="geo-fleet-inputs"
      aria-label="Capacidade individual da frota"
    >
      {Array.from({ length: draft.vehicles }, (_, i) => (
        <label key={i}>
          V{i + 1}
          <input
            aria-label={`Capacidade do veículo V${i + 1}`}
            type="number"
            min={1}
            max={10000}
            value={vehicleCapacity(draft, i + 1)}
            disabled={disabled}
            onChange={(e) => {
              const cap = e.target.valueAsNumber;
              if (Number.isInteger(cap) && cap >= 1 && cap <= 10000)
                onChange({
                  ...draft,
                  fleet: Array.from(
                    { length: draft.vehicles },
                    (_, j) => ({
                      id: j + 1,
                      capacity:
                        j === i
                          ? cap
                          : vehicleCapacity(draft, j + 1),
                    }),
                  ),
                });
            }}
          />
        </label>
      ))}
    </div>
  </>;
}
