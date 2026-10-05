import type { Instance } from './types';

export const graphNodeId = (instance: Instance, id: number) =>
  instance.vrp?.node_ids[id] ?? id;

export function graphCoordinates(instance: Instance, id: number): [number, number] | null {
  if (instance.vrp) return instance.vrp.coordinates?.[id] ?? null;
  const point = id === 0 ? instance.depot : instance.clients.find(client => client.id === id);
  return point ? [point.x, point.y] : null;
}

const niceStep = (minimum: number) => {
  const magnitude = 10 ** Math.floor(Math.log10(minimum));
  return [1, 2, 5, 10].find(n => n * magnitude >= minimum)! * magnitude;
};
export const formatCoordinate = (value: number) =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6 }).format(value);

// Os eixos usam a mesma escala para preservar a geometria original.
export function createGraphPlane(instance: Instance, width: number, height: number) {
  const original = instance.vrp?.coordinates;
  const coordinateMode = original ? 'original' : instance.vrp ? 'illustrative' : 'native';
  const lowX = original ? Math.min(...original.map(p => p[0])) : 0;
  const lowY = original ? Math.min(...original.map(p => p[1])) : 0;
  const highX = original ? Math.max(...original.map(p => p[0])) : 100;
  const highY = original ? Math.max(...original.map(p => p[1])) : 100;
  const span = Math.max(highX - lowX, highY - lowY) || 1;
  const sourceX = (n: number) => original ? lowX + (n - 5) * span / 90 : n;
  const sourceY = (n: number) => original ? lowY + (n - 5) * span / 90 : n;
  const bounds = { left: width < 400 ? 42 : 54, right: Math.max(width - 24, 43), top: 30, bottom: Math.max(height - 62, 31) };
  const plotWidth = bounds.right - bounds.left, plotHeight = bounds.bottom - bounds.top;
  const unit = Math.min(plotWidth / (highX - lowX + span * .16), plotHeight / (highY - lowY + span * .16));
  const midX = (highX + lowX) / 2, midY = (highY + lowY) / 2;
  const centreX = (bounds.left + bounds.right) / 2, centreY = (bounds.top + bounds.bottom) / 2;
  const pixelX = (value: number) => centreX + (value - midX) * unit;
  const pixelY = (value: number) => centreY - (value - midY) * unit;
  const xDomain = [midX - plotWidth / unit / 2, midX + plotWidth / unit / 2];
  const yDomain = [midY - plotHeight / unit / 2, midY + plotHeight / unit / 2];
  const major = niceStep(64 / unit), minor = major / 4;
  const ticks = (domain: number[], project: (value: number) => number) => {
    const result = [];
    for (let i = Math.ceil(domain[0] / minor); i <= Math.floor(domain[1] / minor); i++) {
      const value = Number((i * minor).toPrecision(12));
      result.push({ value, pixel: project(value), major: i % 4 === 0 });
    }
    return result;
  };
  return {
    bounds, coordinateMode, xTicks: ticks(xDomain, pixelX), yTicks: ticks(yDomain, pixelY),
    x: (n: number) => pixelX(sourceX(n)), y: (n: number) => pixelY(sourceY(n)),
    invertX: (pixel: number) => {
      const value = midX + (pixel - centreX) / unit;
      return original ? 5 + (value - lowX) * 90 / span : value;
    },
    invertY: (pixel: number) => {
      const value = midY - (pixel - centreY) / unit;
      return original ? 5 + (value - lowY) * 90 / span : value;
    },
  };
}
