import type { RunEvent } from "./types";
// Ignora eventos de outra execução e sequências já recebidas.
export function mergeEvents(
  existing: RunEvent[],
  incoming: RunEvent[],
  runId: string,
): RunEvent[] {
  const ids = new Set(existing.map((e) => e.id));
  const sequences = new Set(
    existing.map((e) => e.sequence).filter((s) => s != null),
  );
  return [
    ...existing,
    ...incoming.filter((e) => {
      if (e.run_id && e.run_id !== runId) return false;
      if (ids.has(e.id) || (e.sequence != null && sequences.has(e.sequence)))
        return false;
      if (e.sequence != null) sequences.add(e.sequence);
      ids.add(e.id);
      return true;
    }),
  ].sort((a, b) => a.id - b.id);
}

// Detecta lacunas na sequência de eventos de cada página.
export function hasSequenceGap(events: RunEvent[]) {
  return events.some(
    (event, index) => event.sequence != null && event.sequence !== index + 1,
  );
}
