import { useEffect, useRef, useState } from "react";
import { computeRoadGeometry, roadMatrixError, type RoadGeometry } from "./roads";
import { geometryKey, type GeoDraft } from "./model";
import { RoadGeometryQueue, type RoadState } from "./roadGeometryQueue";

export function useRoadGeometry<T>(draft: GeoDraft, hash: string, visits: number[][], frame: T, frameKey: string) {
  const [state, setState] = useState<RoadState<T> & { hash: string }>({
    hash: "", roads: new Map(), completed: null, busy: false, error: null,
  });
  const [attempt, setAttempt] = useState(0);
  const queue = useRef<RoadGeometryQueue<T> | null>(null);
  const latest = useRef({ draft, visits, frame, frameKey });
  latest.current = { draft, visits, frame, frameKey };
  const sequences = JSON.stringify(visits);

  useEffect(() => {
    const { draft } = latest.current;
    let alive = true;
    setState({ hash, roads: new Map(), completed: null, busy: false, error: null });
    if (!hash || !draft.depot) return;
    const points = [draft.depot, ...draft.clients];
    const worker = new RoadGeometryQueue<T>(
      route => geometryKey(hash, route),
      route => computeRoadGeometry([0, ...route, 0].map(id => points[id]), () => alive),
      next => { if (alive) setState({ ...next, hash }); },
    );
    queue.current = worker;
    return () => { alive = false; worker.dispose(); queue.current = null; };
  }, [hash]);

  useEffect(() => {
    const target = latest.current;
    queue.current?.update({ key: target.frameKey, routes: target.visits, value: target.frame });
  }, [hash, sequences, frameKey, attempt]);

  const current = state.hash === hash;
  return {
    roads: current ? state.roads : new Map<string, RoadGeometry>(),
    completed: current ? state.completed : null,
    busy: current && state.busy,
    error: current && state.error ? roadMatrixError(state.error) : "",
    retry: () => setAttempt(n => n + 1),
  };
}
