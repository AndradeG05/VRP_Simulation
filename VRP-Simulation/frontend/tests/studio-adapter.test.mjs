import test from 'node:test'
import assert from 'node:assert/strict'
import { toRequest, toRecord, euclideanCosts } from '../src/compatibility/backend-adapter.ts'
const input = {
 schemaVersion:'1.0', name:'Adapter test', description:'',
 points:[{id:'delivery-B',label:'B',kind:'customer',x:6,y:8,demand:2,serviceMinutes:0},{id:'hub',label:'Hub',kind:'depot',x:0,y:0,demand:0,serviceMinutes:0},{id:'delivery-A',label:'A',kind:'customer',x:3,y:4,demand:1,serviceMinutes:0}],
 vehicles:[{id:'truck',label:'Truck',capacity:5}],timeLimitSeconds:1,initialUpperBound:null,directedCosts:[],solverParameters:{usePyvrp:true,seed:42,iterationStop:true,max_iterations:50,sample_every:10}
}
test('backend contract preserves coordinates, fleet and solver controls with arbitrary display IDs',()=>{
 const request=toRequest(input)
 assert.deepEqual(request.instance.depot,{x:0,y:0})
 assert.deepEqual(request.instance.clients.map(p=>[p.id,p.x,p.y,p.demand]),[[1,6,8,2],[2,3,4,1]])
 assert.equal(request.config.adapter,'pyvrp');assert.equal(request.config.seed,42);assert.equal(request.config.stop,'iterations')
 assert.equal(request.config.max_iterations,50);assert.deepEqual(request.instance.fleet,[{id:1,capacity:5}])
})
test('result uses native cost ticks, display identifiers and no fabricated proof or timestamps',()=>{
 const request=toRequest(input)
 const record=toRecord({id:'run',status:'completed',created:'2026-10-02T12:00:00Z',request,baseline:null,error:null,cancel:0,result:{solution:{feasible:true,cost_ticks:20000,routes:[{vehicle:1,visits:[2,1],load:3,cost_ticks:20000}]},solver_runtime:1,stop_reason:'time_limit',instance_hash:'hash',versions:{ortools:'reported'},algorithm:'reported',distance_convention:'reported',iterations:null}},input)
 assert.equal(record.result.objective,20)
 assert.deepEqual(record.result.routes[0].pointIds,['hub','delivery-A','delivery-B','hub'])
 assert.equal(record.result.routes[0].vehicleId,'truck')
 assert.equal(record.result.lowerBound,null);assert.equal(record.result.gapPercent,null);assert.equal(record.startedAt,null)
 assert.equal(record.result.outcome,'feasible_unproven')
})
test('displayed costs use the backend Euclidean rounding convention',()=>{
 assert.deepEqual(euclideanCosts(input.points),[[0,10,5],[10,0,5],[5,5,0]])
})
