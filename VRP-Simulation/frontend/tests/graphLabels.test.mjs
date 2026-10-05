import assert from 'node:assert/strict';
import test from 'node:test';
import { positionGraphLabels } from '../src/graphLabels.ts';

test('numbers stay centred on their own nodes, including a dense cluster', () => {
  const points = Array.from({length: 30}, (_, index) => ({id:index + 1, x:120 + index % 6 * 14, y:100 + Math.floor(index / 6) * 16, width:16}));
  const before = JSON.stringify(points);
  const labels = positionGraphLabels(points, {x:0,y:0,k:1,left:42,right:560,top:30,bottom:340});
  assert.equal(labels.length, points.length);
  assert.deepEqual(labels.map(l=>l.id), points.map(p=>p.id));
  assert.equal(JSON.stringify(points), before);
  labels.forEach((label, index) => {
    assert.equal(label.x, points[index].x, `number ${label.id} moved away from its node`);
    assert.equal(label.y, points[index].y, `number ${label.id} moved away from its node`);
  });
});

test('zoom and pan move each number with its node and retain the marker size', () => {
  const points = [{id:99,x:44,y:32,width:22}, {id:1,x:558,y:338,width:10}];
  const bounds = {left:42,right:560,top:30,bottom:340};
  const initial = positionGraphLabels(points, {...bounds,x:0,y:0,k:1});
  const camera = {...bounds,x:-72,y:40,k:3.5};
  const zoomed = positionGraphLabels(points, camera);
  zoomed.forEach((label, index) => {
    assert.equal(label.x, camera.x + points[index].x * camera.k);
    assert.equal(label.y, camera.y + points[index].y * camera.k);
    assert.equal(label.radius, initial[index].radius);
    assert.ok(label.radius >= points[index].width / 2 + 3, 'number fits inside its node');
  });
});
