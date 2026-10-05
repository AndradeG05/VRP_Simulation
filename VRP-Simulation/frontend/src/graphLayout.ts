import { forceCollide, forceManyBody, forceSimulation, forceX, forceY, randomLcg } from 'd3';
import type { Instance } from './types';

export type GraphView = 'distributed' | 'coordinates';
export interface LayoutPoint { id: number; x: number; y: number }

// A distribuição visual preserva as coordenadas e os custos da instância.
export function createDistributedLayout(instance: Instance, width: number, height: number) {
  const bounds = {left:28,right:Math.max(48,width-42),top:32,bottom:Math.max(52,height-54)};
  const source = [instance.depot,...instance.clients];
  const minX=Math.min(...source.map(p=>p.x)), maxX=Math.max(...source.map(p=>p.x));
  const minY=Math.min(...source.map(p=>p.y)), maxY=Math.max(...source.map(p=>p.y));
  const spacing = Math.min(width<420?26:40, Math.sqrt((bounds.right-bounds.left)*(bounds.bottom-bounds.top)/source.length)*.8);
  const inset=spacing;
  const nodes=source.map((p,id)=>{
    const targetX=bounds.left+inset+(maxX===minX ? .5 : (p.x-minX)/(maxX-minX))*(bounds.right-bounds.left-inset*2);
    const targetY=bounds.bottom-inset-(maxY===minY ? .5 : (p.y-minY)/(maxY-minY))*(bounds.bottom-bounds.top-inset*2);
    return {id,x:targetX,y:targetY,targetX,targetY,vx:0,vy:0,fx:id===0?targetX:undefined,fy:id===0?targetY:undefined};
  });
  const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
  const confine=()=>nodes.forEach(n=>{
    n.x=clamp(n.x,bounds.left,bounds.right); n.y=clamp(n.y,bounds.top,bounds.bottom);
    if((n.x===bounds.left&&n.vx<0)||(n.x===bounds.right&&n.vx>0)) n.vx=0;
    if((n.y===bounds.top&&n.vy<0)||(n.y===bounds.bottom&&n.vy>0)) n.vy=0;
  });
  const simulation=forceSimulation(nodes).stop().randomSource(randomLcg(.43))
    .force('x',forceX<typeof nodes[number]>(n=>n.targetX).strength(.025))
    .force('y',forceY<typeof nodes[number]>(n=>n.targetY).strength(.025))
    .force('charge',forceManyBody().strength(width<420?-18:-48).distanceMax(140))
    .force('collision',forceCollide<typeof nodes[number]>(n=>spacing/2+(n.id===0?6:0)).iterations(3))
    .force('bounds',confine).velocityDecay(.5);
  for(let i=0;i<220;i++) { simulation.tick(); confine(); }
  return {points:nodes.map(({id,x,y})=>({id,x,y})),bounds,spacing};
}

export function distributedVehiclePosition(points: LayoutPoint[], from: number, next: number, fraction: number) {
  const a=points[from], b=points[next], t=Math.max(0,Math.min(1,fraction));
  return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
}
