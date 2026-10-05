import type { Solution } from "./types";
export function routeDifference(
  previous: Solution | null,
  current: Solution | null,
) {
  const arcs = (s: Solution | null) =>
    new Set(
      s?.routes.flatMap((r) =>
        [0, ...r.visits].map((id, i) => id + ">" + [...r.visits, 0][i]),
      ) ?? [],
    );
  const before = arcs(previous),
    after = arcs(current);
  const assignment = new Map(
    previous?.routes.flatMap((r) =>
      r.visits.map((id) => [id, r.vehicle] as const),
    ) ?? [],
  );
  return {
    added: [...after].filter((a) => !before.has(a)),
    removed: [...before].filter((a) => !after.has(a)),
    transferred:
      current?.routes.flatMap((r) =>
        r.visits.filter(
          (id) => assignment.has(id) && assignment.get(id) !== r.vehicle,
        ),
      ) ?? [],
    delta:
      previous && current ? current.cost_ticks - previous.cost_ticks : null,
  };
}
