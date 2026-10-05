interface Anchor { id: number; x: number; y: number; width: number }
interface Camera { x: number; y: number; k: number }

// O zoom mantém o tamanho dos nós e alinha seus rótulos.
export function positionGraphLabels(points: Anchor[], camera: Camera) {
  return points.map(point => ({
    id: point.id,
    x: camera.x + point.x * camera.k,
    y: camera.y + point.y * camera.k,
    radius: Math.max(9, point.width / 2 + 4),
  }));
}
