import assert from 'node:assert/strict';
import test from 'node:test';
import { appendVisit, geometryKey, moveNode, removeClient, roadDraft, routeChunks } from '../src/geo/model.ts';

const draft = {
  schema_version: 3, depot: {lat: -23.55, lng: -46.65},
  clients: [{id:1, lat:-23.56, lng:-46.64, demand:2}, {id:2, lat:-23.57, lng:-46.63, demand:3}],
  vehicles:2, capacity:10, road_matrix: {provider:'osrm', points:[[-23.55,-46.65],[-23.56,-46.64],[-23.57,-46.63]],
    distances_m:[[0,11,12],[21,0,23],[31,32,0]]},
};

test('moving a map client or depot clears stale road costs without mutating the source', () => {
  const before = structuredClone(draft);
  for (const id of [0, 1]) {
    const edited = roadDraft(moveNode(draft, id, {lat:-23.58, lng:-46.62}));
    assert.equal(edited.road_matrix, null);
    assert.equal(edited.clients[0].demand, 2);
  }
  assert.deepEqual(draft, before);
});

test('deleting, adding or reordering map clients clears road costs', () => {
  const removed = roadDraft(removeClient(draft, 1));
  assert.equal(removed.road_matrix, null);
  assert.equal(removed.clients[0].id, 1);
  assert.equal(removed.clients[0].lat, -23.57);
  assert.equal(roadDraft({...draft, clients:[...draft.clients, {id:3, lat:-23.59, lng:-46.61, demand:1}]}).road_matrix, null);
  assert.equal(roadDraft({...draft, clients:[...draft.clients].reverse()}).road_matrix, null);
});

test('demand and fleet edits preserve road costs for the same ordered coordinates', () => {
  const edited = roadDraft({...draft, capacity:20, vehicles:3, clients:draft.clients.map(c=>({...c, demand:4}))});
  assert.deepEqual(edited.road_matrix.distances_m, [[0,11,12],[21,0,23],[31,32,0]]);
  assert.equal(roadDraft({...draft, road_matrix:{...draft.road_matrix, provider:'google_routes'}}).road_matrix, null);
});

test('manual map plans avoid duplicate visits and preserve other vehicle slots', () => {
  assert.deepEqual(appendVisit([[1],[]], 2, 1), [[1],[]]);
  assert.deepEqual(appendVisit([[1],[]], 2, 2), [[1],[2]]);
});

test('geometry chunks retain every segment and return to the depot', () => {
  const closed = [0, ...Array.from({length:201}, (_,i)=>i+1), 0];
  const chunks = routeChunks(closed);
  assert.deepEqual(chunks.map(c=>c.length), [100,100,5]);
  const arcs = chunks.flatMap(c=>c.slice(1).map((to,i)=>[c[i],to]));
  assert.deepEqual(arcs, closed.slice(1).map((to,i)=>[closed[i],to]));
  assert.equal(geometryKey('hash', [2,1]), 'hash:0,2,1,0');
  assert.notEqual(geometryKey('hash', [2,1]), geometryKey('hash', [1,2]));
});
