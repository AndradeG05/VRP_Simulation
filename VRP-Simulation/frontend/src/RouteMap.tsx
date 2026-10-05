import { useEffect, useId, useMemo, useRef, useState } from "react";
import { select, zoom, zoomIdentity, type ZoomBehavior } from "d3";
import { createGraphPlane, formatCoordinate, graphCoordinates, graphNodeId } from "./graphPlane";
import { Crosshair, Minus, Plus, X } from "./carbon/icons";
import { routeColors } from "./carbon/palette";
import { vehicleCapacity, type Instance, type Solution } from "./types";
import { positionGraphLabels } from "./graphLabels";
import { createDistributedLayout, distributedVehiclePosition, type GraphView, type LayoutPoint } from "./graphLayout";
import { distance } from "./api";
import {
  prepareRoute,
  preparedVehicleAt,
  type TravelClock,
} from "./simulation";
import { routeDifference } from "./differences";
export const colours = routeColors;
export interface Camera {
  x: number;
  y: number;
  k: number;
}
interface Props {
  instance: Instance;
  solution: Solution | null;
  selectedRoute: number | null;
  selectedClient: number | null;
  onRoute: (id: number | null) => void;
  onClient: (id: number | null) => void;
  showLabels: boolean;
  graphView?: GraphView;
  editing: boolean;
  onAdd: (x: number, y: number) => void;
  onMove: (id: number, x: number, y: number) => void;
  compact?: boolean;
  clock?: TravelClock;
  camera?: Camera;
  onCamera?: (camera: Camera) => void;
  previous?: Solution | null;
  overlay?: Solution | null;
}
const identity = { x: 0, y: 0, k: 1 };
export default function RouteMap(props: Props) {
  const {
    instance,
    solution,
    selectedRoute,
    selectedClient,
    onRoute,
    onClient,
    showLabels,
    graphView = 'distributed',
    editing,
    onAdd,
    onMove,
    compact,
    clock,
    camera = identity,
    onCamera,
    previous = null,
    overlay = null,
  } = props;
  const canvas = useRef<HTMLCanvasElement>(null),
    staticLayer = useRef<HTMLCanvasElement | null>(null),
    zoomer = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const transform = useRef(camera),
    propsRef = useRef(props),
    drawRef = useRef<() => void>(() => {}),
    dragged = useRef<{
      id: number;
      startX: number;
      startY: number;
      moved: boolean;
    } | null>(null),
    suppressClick = useRef(false);
  const [tooltip, setTooltip] = useState<number | null>(null);
  const descriptionId = useId();
  const nodeRadii = useRef(new Map<number, number>());
  const labelRects = useRef(new Map<number, {left:number;right:number;top:number;bottom:number}>());
  const positions = useRef<LayoutPoint[]>([]);
  const layoutCache = useRef<{instance:Instance;width:number;height:number;points:LayoutPoint[]} | null>(null);
  const distributed = graphView === 'distributed' && !editing;
  const plane = useRef(createGraphPlane(instance, 640, 560));
  const sx = (value: number) => plane.current.x(value);
  const sy = (value: number) => plane.current.y(value);
  const position = (id:number) => positions.current[id] ?? {x:sx(points[id].x),y:sy(points[id].y)};
  const points = useMemo(
    () => [instance.depot, ...instance.clients],
    [instance],
  );
  const prepared = useMemo(
    () => solution?.routes.map((r) => prepareRoute(instance, r)) ?? [],
    [instance, solution],
  );
  const difference = useMemo(
    () => routeDifference(previous, solution),
    [previous, solution],
  );
  const hovered = tooltip === null ? null : points[tooltip];
  const hoveredCoordinates = tooltip === null ? null : graphCoordinates(instance, tooltip);
  const focusedRoute = solution?.routes.find(route => route.vehicle === selectedRoute);
  propsRef.current = props;
  const colour = (id: number) => colours[(id - 1) % colours.length];
  const world = (clientX: number, clientY: number) => {
    const rect = canvas.current!.getBoundingClientRect(),
      t = transform.current;
    return {
      x: (clientX - rect.left - t.x) / t.k,
      y: (clientY - rect.top - t.y) / t.k,
    };
  };
  const hit = (clientX: number, clientY: number) => {
    const p = world(clientX, clientY);
    let nearest = -1, distance = Infinity;
    points.forEach((n, id) => {
      const point = position(id);
      const d = Math.hypot(point.x - p.x, point.y - p.y);
      if (d < (nodeRadii.current.get(id) ?? 10) / transform.current.k && d < distance) {
        nearest = id;
        distance = d;
      }
    });
    if(nearest<0) {
      const screenX=p.x*transform.current.k+transform.current.x, screenY=p.y*transform.current.k+transform.current.y;
      for(const [id,box] of labelRects.current) if(screenX>=box.left&&screenX<=box.right&&screenY>=box.top&&screenY<=box.bottom) return id;
    }
    return nearest;
  };
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const behaviour = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([1, 4])
      .clickDistance(4)
      .filter(
        (event) =>
          (!event.ctrlKey || event.type === "wheel") &&
          !event.button &&
          !(propsRef.current.editing && hit(event.clientX, event.clientY) >= 0),
      )
      .on("zoom", (event) => {
        transform.current = {
          x: event.transform.x,
          y: event.transform.y,
          k: event.transform.k,
        };
        propsRef.current.onCamera?.(transform.current);
        setTooltip(null);
        drawRef.current();
      });
    zoomer.current = behaviour;
    select(node).call(behaviour).on("dblclick.zoom", null);
    return () => {
      select(node).on(".zoom", null);
    };
  }, [instance]);
  useEffect(() => {
    if (!canvas.current || !zoomer.current) return;
    if (
      Math.abs(camera.x - transform.current.x) +
        Math.abs(camera.y - transform.current.y) +
        Math.abs(camera.k - transform.current.k) <
      0.001
    )
      return;
    transform.current = camera;
    select(canvas.current).property(
      "__zoom",
      zoomIdentity
        .translate(camera.x, camera.y)
        .scale(camera.k),
    );
    drawRef.current();
  }, [camera]);
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const cached = document.createElement("canvas");
    staticLayer.current = cached;
    const ctx = node.getContext("2d")!,
      base = cached.getContext("2d")!;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const css = getComputedStyle(document.documentElement);
    const theme = (name: string) => css.getPropertyValue(`--${name}`).trim();
    const membership = new Map(
      solution?.routes.flatMap(r => r.visits.map(id => [id, r.vehicle] as const)) ?? [],
    );
    const routePath = (context: CanvasRenderingContext2D, visits: number[]) => {
      context.beginPath();
      [0, ...visits, 0].forEach((id, i) => {
        const p = position(id);
        i ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y);
      });
    };
    function paintStatic() {
      cached.width = node!.clientWidth * ratio;
      cached.height = node!.clientHeight * ratio;
      base.setTransform(ratio, 0, 0, ratio, 0, 0);
      base.clearRect(0, 0, node!.clientWidth, node!.clientHeight);
      const { bounds, xTicks, yTicks } = plane.current;
      base.lineWidth = 1;
      if (distributed) {
        for (const step of [32, 128]) {
          base.strokeStyle = theme(step === 128 ? "graph-grid-major" : "graph-grid-minor");
          base.beginPath();
          for (let x = 0; x < node!.clientWidth; x += step) {
            base.moveTo(x, 0); base.lineTo(x, node!.clientHeight);
          }
          for (let y = 0; y < node!.clientHeight; y += step) {
            base.moveTo(0, y); base.lineTo(node!.clientWidth, y);
          }
          base.stroke();
        }
      } else {
      for (const major of [false, true]) {
        base.strokeStyle = theme(major ? "graph-grid-major" : "graph-grid-minor");
        base.beginPath();
        for (const tick of xTicks.filter(t => t.major === major)) {
          base.moveTo(tick.pixel, bounds.top);
          base.lineTo(tick.pixel, bounds.bottom);
        }
        for (const tick of yTicks.filter(t => t.major === major)) {
          base.moveTo(bounds.left, tick.pixel);
          base.lineTo(bounds.right, tick.pixel);
        }
        base.stroke();
      }
      base.fillStyle = theme("muted");
      base.font = "10px Montserrat, sans-serif";
      base.textAlign = "center";
      for (const tick of xTicks.filter(t => t.major)) {
        base.fillText(formatCoordinate(tick.value), tick.pixel, bounds.bottom + 20);
      }
      base.textAlign = "right";
      for (const tick of yTicks.filter(t => t.major)) {
        base.fillText(formatCoordinate(tick.value), bounds.left - 10, tick.pixel + 3);
      }
      base.textAlign = "left";
      base.font = "600 11px Montserrat, sans-serif";
      base.fillText("Y", bounds.left - 10, 17);
      base.fillText("X", bounds.right + 8, bounds.bottom + 20);
      }
      if (overlay) {
        base.strokeStyle = theme("warning");
        base.globalAlpha = 0.35;
        base.setLineDash([5, 5]);
        for (const r of overlay.routes) {
          routePath(base, r.visits);
          base.stroke();
        }
        base.setLineDash([]);
        base.globalAlpha = 1;
      }
      for (const route of solution?.routes ?? []) {
        base.globalAlpha =
          selectedRoute != null && selectedRoute !== route.vehicle
            ? 0.16
            : 0.9;
        base.strokeStyle = colour(route.vehicle);
        base.lineWidth = selectedRoute === route.vehicle ? 2.4 : distributed ? 1.25 : 1.8;
        base.lineJoin = "round";
        base.setLineDash(route.vehicle > colours.length ? [5, 3] : []);
        routePath(base, route.visits);
        base.stroke();
        base.setLineDash([]);
        const seq = [0, ...route.visits, 0];
        if (distributed && selectedRoute !== route.vehicle) continue;
        seq.slice(1).forEach((id, i) => {
          const a = position(seq[i]),
            b = position(id),
            ax = a.x,
            ay = a.y,
            bx = b.x,
            by = b.y,
            angle = Math.atan2(by - ay, bx - ax),
            mx = (ax + bx) / 2,
            my = (ay + by) / 2;
          if (Math.hypot(bx - ax, by - ay) < 28) return;
          base.save();
          base.translate(mx, my);
          base.rotate(angle);
          base.beginPath();
          base.moveTo(-3.5, -3);
          base.lineTo(3.5, 0);
          base.lineTo(-3.5, 3);
          base.closePath();
          base.fillStyle = colour(route.vehicle);
          base.fill();
          base.restore();
        });
      }
      base.globalAlpha = 1;
      if (previous) {
        for (const [arcs, c, dash] of [
          [difference.removed, theme("danger"), [4, 5]],
          [difference.added, theme("success"), []],
        ] as [string[], string, number[]][]) {
          base.strokeStyle = c;
          base.lineWidth = 2;
          base.setLineDash(dash);
          for (const arc of arcs) {
            const [a, b] = arc.split(">").map(Number);
            base.beginPath();
            base.moveTo(position(a).x, position(a).y);
            base.lineTo(position(b).x, position(b).y);
            base.stroke();
          }
        }
        base.setLineDash([]);
      }
      base.globalAlpha = 1;
    }
    function paintNodes() {
      const t = transform.current;
      const small = node!.clientWidth < 400;
      ctx.save();
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.font = `${distributed ? 500 : 600} ${small ? 10 : 11}px Montserrat, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const labels = positionGraphLabels(instance.clients.map(client => ({
        id: client.id, x: position(client.id).x, y: position(client.id).y,
        width: ctx.measureText(String(graphNodeId(instance, client.id))).width,
      })), t);
      nodeRadii.current.clear();
      labelRects.current.clear();
      for (const label of labels) {
        const vehicle = membership.get(label.id);
        const radius = distributed ? small ? 4 : 4.5 : showLabels ? label.radius : small ? 4.5 : 5.5;
        nodeRadii.current.set(label.id, Math.max(radius, 10));
        ctx.globalAlpha = selectedRoute !== null && selectedRoute !== vehicle ? .25 : 1;
        ctx.beginPath();
        ctx.arc(label.x, label.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = showLabels && !distributed ? theme("panel") : vehicle ? colour(vehicle) : theme("graph-node");
        ctx.fill();
        ctx.strokeStyle = theme("panel");
        ctx.lineWidth = 4;
        ctx.stroke();
        if (showLabels) {
          if (distributed) {
            const text = String(graphNodeId(instance, label.id));
            const width = ctx.measureText(text).width;
            const x = label.x + 8, y = label.y - 9;
            ctx.textAlign = "left";
            ctx.lineWidth = 3.5;
            ctx.strokeStyle = theme("page");
            ctx.strokeText(text, x, y);
            ctx.fillStyle = theme("ink");
            ctx.fillText(text, x, y);
            labelRects.current.set(label.id, {left:x-2,right:x+width+2,top:y-7,bottom:y+7});
            ctx.textAlign = "center";
          } else {
          ctx.strokeStyle = vehicle ? colour(vehicle) : theme("graph-node");
          ctx.lineWidth = 1.8;
          ctx.stroke();
          ctx.fillStyle = theme("ink");
          ctx.fillText(String(graphNodeId(instance, label.id)), label.x, label.y);
          }
        }
        if (selectedClient === label.id || (previous && difference.transferred.includes(label.id))) {
          ctx.beginPath();
          ctx.arc(label.x, label.y, radius + 4, 0, Math.PI * 2);
          ctx.strokeStyle = selectedClient === label.id ? theme("ink") : theme("accent");
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      const dx = t.x + position(0).x * t.k;
      const dy = t.y + position(0).y * t.k;
      const depotText = instance.vrp ? `D${graphNodeId(instance, 0)}` : "D";
      const radius = Math.max(12, ctx.measureText(depotText).width / 2 + 5);
      nodeRadii.current.set(0, radius);
      ctx.beginPath();
      ctx.moveTo(dx, dy - radius);
      ctx.lineTo(dx + radius, dy);
      ctx.lineTo(dx, dy + radius);
      ctx.lineTo(dx - radius, dy);
      ctx.closePath();
      ctx.fillStyle = theme("ink");
      ctx.fill();
      ctx.strokeStyle = theme("panel");
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = theme("panel");
      ctx.fillText(depotText, dx, dy);
      if (selectedClient === 0) {
        ctx.strokeStyle = theme("ink");
        ctx.lineWidth = 1.5;
        ctx.strokeRect(dx - radius - 3, dy - radius - 3, (radius + 3) * 2, (radius + 3) * 2);
      }
      ctx.restore();
    }
    function draw() {
      const t = transform.current;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, node!.clientWidth, node!.clientHeight);
      ctx.translate(t.x, t.y);
      ctx.scale(t.k, t.k);
      ctx.drawImage(cached, 0, 0, node!.clientWidth, node!.clientHeight);
      paintNodes();
      if (clock?.enabled)
        for (const p of prepared) {
          const state = preparedVehicleAt(instance, p, clock.current),
            c = colour(state.vehicle);
          for (const id of state.visited) {
            const point = position(id);
            ctx.fillStyle = theme("panel");
            ctx.strokeStyle = c;
            ctx.lineWidth = showLabels ? 1.5 / t.k : 1.5;
            ctx.beginPath();
            ctx.arc(point.x, point.y, showLabels ? ((nodeRadii.current.get(id) ?? 9) + 3) / t.k : 4, 0, Math.PI * 2);
            if (!showLabels) ctx.fill();
            ctx.stroke();
          }
          const segment = p.segments.find(s => state.travelled < s.end);
          const fraction = segment?.length ? (state.travelled - segment.start) / segment.length : 1;
          const vehiclePoint = distributed
            ? distributedVehiclePosition(positions.current, state.from, state.next, fraction)
            : {x:sx(state.x),y:sy(state.y)};
          const vx = vehiclePoint.x, vy = vehiclePoint.y;
          ctx.fillStyle = theme("panel");
          ctx.strokeStyle = c;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.roundRect(vx - 10, vy - 8, 20, 16, 4);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = c;
          ctx.font = "600 9px Montserrat, sans-serif";
          ctx.fillText(
            String(state.vehicle),
            vx - (state.vehicle > 9 ? 5.5 : 2.7),
            vy + 3,
          );
        }
    }
    const resize = () => {
      if (!node.clientWidth || !node.clientHeight) return;
      node.width = node.clientWidth * ratio;
      node.height = node.clientHeight * ratio;
      plane.current = createGraphPlane(instance, node.clientWidth, node.clientHeight);
      if(distributed) {
        const cachedLayout=layoutCache.current;
        if(!cachedLayout||cachedLayout.instance!==instance||cachedLayout.width!==node.clientWidth||cachedLayout.height!==node.clientHeight) {
          layoutCache.current={instance,width:node.clientWidth,height:node.clientHeight,points:createDistributedLayout(instance,node.clientWidth,node.clientHeight).points};
        }
        positions.current=layoutCache.current!.points;
      } else positions.current=points.map((point,id)=>({id,x:sx(point.x),y:sy(point.y)}));
      paintStatic();
      draw();
    };
    drawRef.current = draw;
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(node);
    // Recalcula os rótulos após o carregamento da fonte.
    let mounted = true;
    void document.fonts.ready.then(() => { if (mounted) resize(); });
    clock?.listeners.add(draw);
    resize();
    return () => {
      mounted = false;
      resizeObserver.disconnect();
      clock?.listeners.delete(draw);
    };
  }, [
    instance,
    solution,
    selectedRoute,
    selectedClient,
    showLabels,
    prepared,
    clock,
    previous,
    overlay,
    difference,
    points,
    distributed,
  ]);
  function zoomBy(amount: number) {
    if (canvas.current && zoomer.current)
      select(canvas.current).call(zoomer.current.scaleBy, amount);
  }
  function clearSelection() {
    onRoute(null);
    onClient(null);
    setTooltip(null);
    if (canvas.current && zoomer.current)
      select(canvas.current).call(zoomer.current.transform, zoomIdentity);
  }
  return (
    <div
      className={
        "map-wrap " + (compact ? "compact" : "") + (editing ? " editing" : "")
      }
    >
      <canvas
        ref={canvas}
        role="img"
        aria-label="Plano de rotas em Canvas"
        aria-describedby={descriptionId}
        tabIndex={0}
        onPointerDown={(e) => {
          if (!editing) return;
          const id = hit(e.clientX, e.clientY);
          if (id >= 0) {
            dragged.current = {
              id,
              startX: e.clientX,
              startY: e.clientY,
              moved: false,
            };
            e.currentTarget.setPointerCapture(e.pointerId);
          }
        }}
        onPointerMove={(e) => {
          const d = dragged.current;
          if (d) {
            d.moved ||=
              Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 4;
            return;
          }
          const id = hit(e.clientX, e.clientY);
          setTooltip(id >= 0 ? id : null);
        }}
        onPointerUp={(e) => {
          const d = dragged.current;
          if (!d) return;
          dragged.current = null;
          if (d.moved) {
            suppressClick.current = true;
            const p = world(e.clientX, e.clientY);
            onMove(
              d.id,
              Math.max(0, Math.min(100, plane.current.invertX(p.x))),
              Math.max(0, Math.min(100, plane.current.invertY(p.y))),
            );
          }
        }}
        onPointerLeave={() => setTooltip(null)}
        onClick={(e) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          const id = hit(e.clientX, e.clientY),
            p = world(e.clientX, e.clientY);
          if (id >= 0) {
            onClient(id);
            return;
          }
          const x = plane.current.invertX(p.x), y = plane.current.invertY(p.y);
          if (editing && x >= 0 && x <= 100 && y >= 0 && y <= 100) {
            onAdd(x, y);
            return;
          }
          let nearest: number | null = null,
            minimum = 7 / transform.current.k;
          for (const r of solution?.routes ?? []) {
            const ids = [0, ...r.visits, 0];
            for (let i = 1; i < ids.length; i++) {
              const a = position(ids[i - 1]),
                b = position(ids[i]),
                ax = a.x,
                ay = a.y,
                dx = b.x - ax,
                dy = b.y - ay,
                den = dx * dx + dy * dy,
                t = den
                  ? Math.max(
                      0,
                      Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / den),
                    )
                  : 0,
                d = Math.hypot(p.x - ax - t * dx, p.y - ay - t * dy);
              if (d < minimum) {
                minimum = d;
                nearest = r.vehicle;
              }
            }
          }
          if (nearest) onRoute(selectedRoute === nearest ? null : nearest);
          else clearSelection();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); clearSelection(); }
          if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomBy(1.35); }
          if (e.key === "-") { e.preventDefault(); zoomBy(.75); }
          if (e.key === "Home" && canvas.current && zoomer.current) {
            e.preventDefault();
            select(canvas.current).call(zoomer.current.transform, zoomIdentity);
          }
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            const direction = e.key === "ArrowRight" ? 1 : -1;
            onClient(((selectedClient ?? (direction === 1 ? -1 : 0)) + direction + points.length) % points.length);
          }
        }}
      />
      {focusedRoute && <div className="graph-route-focus" style={{borderColor:colour(focusedRoute.vehicle)}}>
        <span><i style={{background:colour(focusedRoute.vehicle)}} />Veículo {focusedRoute.vehicle.toString().padStart(2,"0")}</span>
        <strong>{distance(focusedRoute.cost_ticks)} <small>u.d.</small></strong>
        <span>{focusedRoute.visits.length} paradas · carga {focusedRoute.load}/{vehicleCapacity(instance,focusedRoute.vehicle)}</span>
        <button aria-label="Mostrar grafo completo" onClick={clearSelection}><X size={14} /></button>
      </div>}
      {hovered && (
        <div className="map-tooltip">
          <b>{tooltip === 0 ? "Depósito" : "Cliente"} {graphNodeId(instance, tooltip!)}</b>
          <span>
            {tooltip !== 0 && `Demanda: ${instance.clients[tooltip! - 1].demand} · `}
            {hoveredCoordinates ? `X ${formatCoordinate(hoveredCoordinates[0])} · Y ${formatCoordinate(hoveredCoordinates[1])}` : "Posição ilustrativa; arquivo sem coordenadas"}
          </span>
        </div>
      )}
      <div className="graph-map-footer">
      <div className="map-tools">
        <button aria-label="Ampliar mapa" onClick={() => zoomBy(1.35)}>
          <Plus size={15} />
        </button>
        <button aria-label="Reduzir mapa" onClick={() => zoomBy(0.75)}>
          <Minus size={15} />
        </button>
        <button
          aria-label="Centralizar mapa"
          onClick={() => {
            if (canvas.current && zoomer.current)
              select(canvas.current).call(
                zoomer.current.transform,
                zoomIdentity,
              );
          }}
        >
          <Crosshair size={15} />
        </button>
      </div>
      <div className="map-note">
        <span className="depot-key" /> Depósito <span className="client-key" />{" "}
        Cliente{" "}
        <span className="ml-3">
          {editing
            ? "Clique para adicionar · arraste para editar"
            : "Arraste para mover · scroll para zoom"}
        </span>
      </div>
      </div>
      <p className="visually-hidden" id={descriptionId}>
        {points.length} pontos, incluindo o depósito.
        {distributed ? " Vista distribuída: posições ajustadas para leitura; X/Y da instância disponíveis na inspeção." : " Vista Coordenadas: eixos X e Y com a mesma escala."}
        {instance.vrp?.coordinates ? " IDs e coordenadas da instância preservados." : instance.vrp ? " Posições ilustrativas; custos definidos pela matriz do arquivo." : " Coordenadas do plano sintético preservadas."}
        Zoom {Math.round(camera.k * 100)}%.
        Use as setas esquerda e direita para selecionar pontos, mais e menos para zoom e Home para centralizar.
      </p>
    </div>
  );
}
