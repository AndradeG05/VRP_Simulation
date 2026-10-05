import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraphPlane, graphNodeId, graphCoordinates } from '../src/graphPlane.ts';

const native = { depot: {x: 50, y: 50}, clients: [{id: 1, x: 0, y: 0, demand: 1}, {id: 2, x: 100, y: 100, demand: 1}] };
const imported = {...native, depot: {x: 95, y: 5}, clients: [{id: 1, x: 5, y: 5, demand: 1}, {id: 2, x: 95, y: 72.5, demand: 1}], vrp: {node_ids: [2, 1, 3], coordinates: [[300, 200], [-100, 200], [300, 500]]}};
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

for (const [width, height] of [[980, 580], [304, 390], [460, 520]]) {
  test(`equal coordinate units and reversible editing at ${width}×${height}`, () => {
    const p = createGraphPlane(native, width, height);
    near(p.x(75) - p.x(25), p.y(25) - p.y(75));
    for (const value of [0, 23.7, 50, 100]) {
      near(p.invertX(p.x(value)), value);
      near(p.invertY(p.y(value)), value);
      assert.ok(p.x(value) >= p.bounds.left && p.x(value) <= p.bounds.right);
      assert.ok(p.y(value) >= p.bounds.top && p.y(value) <= p.bounds.bottom);
    }
  });
}

test('VRP geometry uses original coordinates with equal scale and the original node IDs', () => {
  const p = createGraphPlane(imported, 850, 620);
  near((p.x(95) - p.x(5)) / 400, (p.y(5) - p.y(72.5)) / 300);
  assert.equal(graphNodeId(imported, 0), 2);
  assert.equal(graphNodeId(imported, 1), 1);
  assert.deepEqual(graphCoordinates(imported, 1), [-100, 200]);
  assert.ok(p.xTicks.some(t => t.value === 0));
  for (const tick of p.xTicks) near(tick.pixel, p.x(5 + (tick.value + 100) * 90 / 400));
});

test('constant coordinates produce finite axes without moving coincident nodes apart', () => {
  const p = createGraphPlane({...native, vrp: {coordinates: [[7, -3], [7, -3], [7, -3]]}}, 390, 420);
  assert.ok(Number.isFinite(p.x(5)) && Number.isFinite(p.y(5)));
  assert.ok(p.xTicks.length > 0 && p.yTicks.length > 0);
});

test('matrix-only layout is explicitly illustrative and keeps native IDs', () => {
  const i = {...native, vrp: {node_ids: [3, 1, 2], coordinates: null}};
  const p = createGraphPlane(i, 650, 480);
  assert.equal(p.coordinateMode, 'illustrative');
  assert.equal(graphCoordinates(i, 1), null);
  assert.equal(graphNodeId(i, 1), 1);
  assert.equal(graphNodeId(native, 1), 1);
  assert.deepEqual(graphCoordinates(native, 1), [0, 0]);
});

test('rendering cannot mutate coordinates, IDs, demands or matrix costs', () => {
  const i = {...imported, vrp: {...imported.vrp, costs_ticks: [[0, 400000, 300000], [400000, 0, 500000], [300000, 500000, 0]]}};
  const before = JSON.stringify(i);
  createGraphPlane(i, 1440, 700);
  graphCoordinates(i, 2);
  graphNodeId(i, 2);
  assert.equal(JSON.stringify(i), before);
});
