import type { RoadGeometry } from "./roads";

export interface RoadFrame<T> { key: string; routes: number[][]; value: T }
export interface RoadState<T> {
  roads: Map<string, RoadGeometry>;
  completed: RoadFrame<T> | null;
  busy: boolean;
  error: unknown;
}

export class RoadGeometryQueue<T> {
  private cache = new Map<string, RoadGeometry>();
  private wanted: RoadFrame<T> | null = null;
  private completed: RoadFrame<T> | null = null;
  private running = false;
  private disposed = false;

  constructor(
    private key: (visits: number[]) => string,
    private load: (visits: number[]) => Promise<RoadGeometry>,
    private publish: (state: RoadState<T>) => void,
  ) {}

  update(frame: RoadFrame<T>) {
    this.wanted = frame;
    if (!this.running) void this.drain();
  }

  dispose() { this.disposed = true; }

  private report(busy: boolean, error: unknown = null) {
    if (!this.disposed) this.publish({ roads: new Map(this.cache), completed: this.completed, busy, error });
  }

  private async drain() {
    this.running = true;
    this.report(true);
    try {
      while (!this.disposed && this.wanted) {
        const frame = this.wanted;
        for (const route of frame.routes) {
          if (!route.length) continue;
          const key = this.key(route);
          if (!this.cache.has(key)) {
            const geometry = await this.load(route);
            if (this.disposed) return;
            this.cache.set(key, geometry);
            this.report(true);
          }
        }
        this.completed = frame;
        const protectedKeys = new Set([...frame.routes, ...(this.wanted?.routes ?? [])].map(this.key));
        for (const key of this.cache.keys()) {
          if (this.cache.size <= 256) break;
          if (!protectedKeys.has(key)) this.cache.delete(key);
        }
        this.report(this.wanted !== frame);
        if (this.wanted === frame) break;
      }
    } catch (error) {
      this.report(false, error);
    } finally {
      this.running = false;
    }
  }
}
