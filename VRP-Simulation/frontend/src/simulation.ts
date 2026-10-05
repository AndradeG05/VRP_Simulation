import { vehicleCapacity } from "./types";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Instance, Route, Solution } from "./types";

export type SimulationGeometry = Pick<
  Instance,
  "depot" | "clients" | "capacity" | "fleet" | "vrp"
>;

export interface VehicleState {
  vehicle: number;
  x: number;
  y: number;
  travelled: number;
  remainingLoad: number;
  freeCapacity: number;
  from: number;
  next: number;
  visited: number[];
  done: boolean;
}
export const edgeCost = (
  a: { x: number; y: number },
  b: { x: number; y: number },
) => Math.floor(Math.hypot(a.x - b.x, a.y - b.y) * 1000 + 0.5);
export interface PreparedRoute {
  route: Route;
  total: number;
  segments: {
    from: number;
    next: number;
    a: { x: number; y: number };
    b: { x: number; y: number };
    length: number;
    start: number;
    end: number;
    load: number;
    index: number;
    positionAt?: (fraction: number) => { x: number; y: number };
  }[];
}
export function prepareRoute(
  instance: SimulationGeometry,
  route: Route,
): PreparedRoute {
  const points = [instance.depot, ...instance.clients],
    ids = [0, ...route.visits, 0];
  let total = 0,
    delivered = 0;
  const segments = ids.slice(1).map((next, i) => {
    const from = ids[i],
      length = instance.vrp?.costs_ticks[from][next] ?? edgeCost(points[from], points[next]),
      start = total;
    const load = route.load - delivered;
    total += length;
    if (next) delivered += instance.clients[next - 1].demand;
    return {
      from,
      next,
      a: points[from],
      b: points[next],
      length,
      start,
      end: total,
      load,
      index: i,
    };
  });
  return { route, segments, total };
}
export function preparedVehicleAt(
  instance: SimulationGeometry,
  prepared: PreparedRoute,
  travelled: number,
): VehicleState {
  const { route, segments, total } = prepared;
  const t = Math.min(Math.max(0, travelled), total);
  const segment = segments.find((s) => t < s.end);
  if (!segment)
    return {
      vehicle: route.vehicle,
      ...(segments.length ? segments[segments.length - 1].b : instance.depot),
      travelled: total,
      remainingLoad: 0,
      freeCapacity: vehicleCapacity(instance, route.vehicle),
      from: 0,
      next: 0,
      visited: [...route.visits],
      done: true,
    };
  const fraction = segment.length ? (t - segment.start) / segment.length : 1;
  const position = segment.positionAt?.(fraction) ?? {
    x: segment.a.x + (segment.b.x - segment.a.x) * fraction,
    y: segment.a.y + (segment.b.y - segment.a.y) * fraction,
  };
  return {
    vehicle: route.vehicle,
    ...position,
    travelled: t,
    remainingLoad: segment.load,
    freeCapacity: vehicleCapacity(instance, route.vehicle) - segment.load,
    from: segment.from,
    next: segment.next,
    visited: route.visits.slice(0, segment.index),
    done: false,
  };
}
export function vehicleAt(
  instance: SimulationGeometry,
  route: Route,
  travelled: number,
) {
  return preparedVehicleAt(instance, prepareRoute(instance, route), travelled);
}
export interface TravelClock {
  current: number;
  enabled: boolean;
  listeners: Set<() => void>;
  uiListeners: Set<() => void>;
  uiTime: number;
  frameDurations: number[];
  frameIntervals: number[];
}
export function useSimulation(
  instance: SimulationGeometry | undefined,
  solution: Solution | null,
  other: Solution | null = null,
  plans?: { routes: PreparedRoute[]; alternate: PreparedRoute[] },
) {
  const clock = useRef<TravelClock>({
    current: 0,
    enabled: false,
    listeners: new Set(),
    uiListeners: new Set(),
    uiTime: 0,
    frameDurations: [],
    frameIntervals: [],
  });
  const [enabled, setEnabled] = useState(false),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1);
  const prepared = useMemo(
    () =>
      plans
        ? plans.routes
        : instance && solution
          ? solution.routes.map((r) => prepareRoute(instance, r))
          : [],
    [instance, solution, plans],
  );
  const alternate = useMemo(
    () =>
      plans
        ? plans.alternate
        : instance && other
          ? other.routes.map((r) => prepareRoute(instance, r))
          : [],
    [instance, other, plans],
  );
  const maximum = Math.max(
    ...prepared.map((r) => r.total),
    ...alternate.map((r) => r.total),
    0,
  );
  function publishTime() {
    clock.current.uiTime = clock.current.current;
    clock.current.uiListeners.forEach((fn) => fn());
  }
  function seek(t: number) {
    clock.current.current = Math.max(0, Math.min(maximum, t));
    publishTime();
    clock.current.listeners.forEach((fn) => fn());
  }
  useEffect(() => {
    clock.current.enabled = enabled;
    clock.current.listeners.forEach((fn) => fn());
  }, [enabled]);
  useEffect(() => {
    seek(0);
    setPlaying(false);
  }, [instance, solution, other, plans]);
  useEffect(() => {
    if (!playing || !enabled) return;
    let frame = 0,
      last = 0,
      lastUI = 0;
    const update = (now: number) => {
      const start = performance.now();
      if (last && clock.current.frameIntervals.length < 10000)
        clock.current.frameIntervals.push(now - last);
      if (last)
        clock.current.current = Math.min(
          maximum,
          clock.current.current + (now - last) * 8 * speed,
        );
      last = now;
      clock.current.listeners.forEach((fn) => fn());
      if (now - lastUI >= 100) {
        publishTime();
        lastUI = now;
      }
      if (clock.current.frameDurations.length < 10000)
        clock.current.frameDurations.push(performance.now() - start);
      if (clock.current.current >= maximum) {
        publishTime();
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [playing, enabled, speed, maximum]);
  useEffect(() => {
    if (new URLSearchParams(location.search).has("profile")) {
      (
        window as unknown as { vrpSimulationProfile: TravelClock }
      ).vrpSimulationProfile = clock.current;
    }
  }, []);
  return {
    clock: clock.current,
    enabled,
    setEnabled,
    playing,
    speed,
    setSpeed,
    maximum,
    seek,
    play: () => {
      if (clock.current.current >= maximum) seek(0);
      setEnabled(true);
      setPlaying(true);
    },
    pause: () => setPlaying(false),
    stop: () => {
      setPlaying(false);
      seek(0);
    },
    restart: () => {
      seek(0);
      setEnabled(true);
      setPlaying(true);
    },
    next: () => {
      setPlaying(false);
      const stops = [...prepared, ...alternate]
        .flatMap((r) => r.segments.map((s) => s.end))
        .filter((t) => t > clock.current.current + 0.001);
      setEnabled(true);
      seek(Math.min(...stops, maximum));
    },
  };
}

export function useTravelTime(clock: TravelClock) {
  return useSyncExternalStore(
    (listener) => {
      clock.uiListeners.add(listener);
      return () => {
        clock.uiListeners.delete(listener);
      };
    },
    () => clock.uiTime,
  );
}
