import assert from 'node:assert/strict';
import test from 'node:test';
import { createDistributedLayout, distributedVehiclePosition } from '../src/graphLayout.ts';

const instance = {
  name:'layout test', depot:{x:50,y:50},
  clients:Array.from({length:40},(_,i)=>({id:i+1,x:50+i%4*.2,y:50+Math.floor(i/4)*.2,demand:1})),
  vehicles:5,capacity:80,generator_seed:42,distribution:'clustered',
  vrp:{node_ids:Array.from({length:41},(_,i)=>100+i),coordinates:Array.from({length:41},(_,i)=>[i-20,2*i]),costs_ticks:Array.from({length:41},(_,i)=>Array.from({length:41},(_,j)=>i===j?0:1000))},
};

for(const [width,height] of [[880,620],[304,370]]) {
  test(`distributed nodes fit and separate a dense cluster at ${width}x${height}`,()=>{
    const before=JSON.stringify(instance);
    const layout=createDistributedLayout(instance,width,height);
    assert.equal(layout.points.length,41);
    assert.deepEqual(layout.points.map(p=>p.id),Array.from({length:41},(_,i)=>i));
    for(const point of layout.points) {
      assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.y));
      assert.ok(point.x>=layout.bounds.left&&point.x<=layout.bounds.right);
      assert.ok(point.y>=layout.bounds.top&&point.y<=layout.bounds.bottom);
      for(const other of layout.points) if(other.id!==point.id)
        assert.ok(Math.hypot(point.x-other.x,point.y-other.y)>=layout.spacing*.85,`nodes ${point.id}/${other.id} collide`);
    }
    assert.equal(JSON.stringify(instance),before,'display layout changes no source data');
    assert.deepEqual(createDistributedLayout(instance,width,height),layout,'comparison uses a deterministic layout');
  });
}

test('playback follows the displayed segment while retaining the original cost fraction',()=>{
  const points=[{id:0,x:100,y:100},{id:1,x:300,y:200}];
  assert.deepEqual(distributedVehiclePosition(points,0,1,.25),{x:150,y:125});
  assert.deepEqual(distributedVehiclePosition(points,1,0,1),{x:100,y:100});
});

test('coincident source coordinates remain intact while the display separates clients',()=>{
  const coincident={...instance,clients:instance.clients.map(p=>({...p,x:50,y:50}))};
  const before=JSON.stringify(coincident);
  const layout=createDistributedLayout(coincident,284,370);
  for(const a of layout.points) for(const b of layout.points) if(a.id!==b.id)
    assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>=layout.spacing*.85,`coincident nodes ${a.id}/${b.id} collide`);
  assert.equal(JSON.stringify(coincident),before);
});
