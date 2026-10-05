import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import { prepareRoadRoute } from "./roadPlayback";
import { colours } from "../RouteMap";
import { routeDifference } from "../differences";
import { preparedVehicleAt, type SimulationGeometry, type TravelClock } from "../simulation";
import type { Solution } from "../types";
import type { RoadGeometry } from "./roads";
import { geometryKey, type GeoDraft, type GeoPoint, type Tool } from "./model";

export interface MapCamera { center: GeoPoint; zoom: number }
export interface Focus { point: GeoPoint; serial: number; zoom?: number }
interface Props {
  draft: GeoDraft; tool: Tool; selected: number | null; vehicle: number | null;
  pending: GeoPoint | null; solution: Solution | null; manual: number[][] | null;
  locked: boolean; hash: string; roads: Map<string, RoadGeometry>; fit: number;
  focus: Focus | null; camera: MapCamera | null; onCamera: (v: MapCamera) => void;
  onPoint: (p: GeoPoint) => void; onSelect: (id: number) => void;
  onMove: (id: number, p: GeoPoint) => void; onVehicle: (id: number) => void;
  clock: TravelClock; metric: SimulationGeometry | undefined; label: string;
  editor?: ReactNode; editorPoint?: GeoPoint | null; onCloseEditor?: () => void;
  hiddenVehicles?: Set<number>; showDepot?: boolean; showClients?: boolean;
  comparison?: Solution | null;
}
const latLng = (p: GeoPoint): L.LatLngTuple => [p.lat, p.lng];
const defaultCenter = { lat: -23.5505, lng: -46.6333 };
export default function OpenStreetMap(props: Props) {
  const host = useRef<HTMLDivElement>(null), shell = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null), latest = useRef(props);
  latest.current = props;
  const [loaded, setLoaded] = useState(false), [dock, setDock] = useState(false);
  const [tileError, setTileError] = useState(false);
  const [short, setShort] = useState(false);
  const tileRef = useRef<L.TileLayer | null>(null), popup = useRef<L.Popup | null>(null);
  const [editorContainer] = useState(() => document.createElement("div"));
  useEffect(() => {
    if (!host.current || !shell.current) return;
    const p = latest.current;
    const map = L.map(host.current, {
      center: latLng(p.camera?.center ?? p.draft.depot ?? defaultCenter),
      zoom: p.camera?.zoom ?? 12, preferCanvas: true, doubleClickZoom: false, zoomControl: false,
      scrollWheelZoom: false,
    });
    L.control.zoom({
      position: "topright",
      zoomInTitle: "Aproximar mapa",
      zoomOutTitle: "Afastar mapa",
    }).addTo(map);
    L.control.scale({ position: "bottomleft", imperial: false }).addTo(map);
    mapRef.current = map;
    let lastModifierZoom = 0;
    const zoomWithModifier = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.deltaY) return;

      const now = performance.now();
      if (now - lastModifierZoom < 110) return;
      lastModifierZoom = now;

      const increment = event.deltaY < 0 ? 1 : -1;
      const targetZoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), map.getZoom() + increment));
      if (targetZoom !== map.getZoom())
        map.setZoomAround(map.mouseEventToLatLng(event), targetZoom, { animate: false });
    };
    const container = map.getContainer();
    container.addEventListener("wheel", zoomWithModifier, { passive: false });
    const defaultTileUrl = import.meta.env.DEV
      ? "/api/tiles/{z}/{x}/{y}.png"
      : "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
    const tiles = L.tileLayer(import.meta.env.VITE_OSM_TILE_URL || defaultTileUrl, {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      keepBuffer: 0, updateWhenIdle: true,
    }).addTo(map);
    tileRef.current = tiles;
    tiles.on("tileerror", () => setTileError(true));
    map.on("click", (event: L.LeafletMouseEvent) => {
      const target = event.originalEvent.target;
      if (target instanceof Element && target.closest(".geo-editor, .geo-docked-editor")) return;
      const current = latest.current;
      if (!current.locked && current.tool !== "manual-route")
        current.onPoint({ lat: event.latlng.lat, lng: event.latlng.lng });
    });
    map.on("moveend", () => {
      const center = map.getCenter();
      latest.current.onCamera({ center: { lat: center.lat, lng: center.lng }, zoom: map.getZoom() });
    });
    popup.current = L.popup({ closeButton: false, autoPan: true, maxWidth: 340, className: "geo-popup" }).setContent(editorContainer);
    L.DomEvent.disableClickPropagation(editorContainer);
    const observer = new ResizeObserver(([entry]) => {
      if (!entry.contentRect.width || !entry.contentRect.height) return;
      setDock(entry.contentRect.width < 540 || entry.contentRect.height < 480);
      setShort(entry.contentRect.height < 420);
      map.invalidateSize({ pan: false });
    });
    observer.observe(shell.current);
    setLoaded(true);
    return () => {
      observer.disconnect();
      container.removeEventListener("wheel", zoomWithModifier);
      map.remove(); mapRef.current = null; popup.current = null;
    };
  }, [editorContainer]);
  useEffect(() => {
    const map = mapRef.current, target = props.camera;
    if (!map || !target) return;
    const center = map.getCenter();
    if (Math.abs(center.lat - target.center.lat) + Math.abs(center.lng - target.center.lng) > 1e-7 || map.getZoom() !== target.zoom)
      map.setView(latLng(target.center), target.zoom, { animate: false });
  }, [props.camera, loaded]);
  useEffect(() => {
    const map = mapRef.current, target = props.focus;
    if (map && target) map.setView(latLng(target.point), target.zoom ?? map.getZoom(), { animate: false });
  }, [props.focus, loaded]);
  useEffect(() => {
    const map = mapRef.current, p = latest.current;
    if (!map) return;
    const points = [...(p.draft.depot ? [p.draft.depot] : []), ...p.draft.clients];
    const routes = p.manual ?? p.solution?.routes.map(r => r.visits) ?? [];
    for (const route of routes) points.push(...(p.roads.get(geometryKey(p.hash, route))?.paths.flat() ?? []));
    if (points.length) map.fitBounds(L.latLngBounds(points.map(latLng)), { padding: [60, 60], maxZoom: 15, animate: false });
  }, [props.fit, loaded]);
  useEffect(() => {
    const map = mapRef.current, box = popup.current;
    if (!map || !box) return;
    let focusFrame: number | undefined;
    if (props.editorPoint && props.editor && !tileError) {
      if (!dock) box.setLatLng(latLng(props.editorPoint)).openOn(map);
      else map.closePopup(box);
      focusFrame = window.requestAnimationFrame(() => {
        const editorRoot = dock || tileError
          ? shell.current?.querySelector<HTMLElement>(".geo-editor")
          : editorContainer;
        if (!editorRoot) return;
        const input = editorRoot.querySelector<HTMLInputElement>('input:not([disabled])');
        const primaryAction = editorRoot.querySelector<HTMLElement>('button.primary:not([disabled])');
        const fallback = editorRoot.querySelector<HTMLElement>(
          'button:not([disabled]), select:not([disabled]), [href]',
        );
        const focusTarget = input ?? primaryAction ?? fallback;
        focusTarget?.focus({ preventScroll: true });
        if (focusTarget instanceof HTMLInputElement) focusTarget.select();
      });
    } else map.closePopup(box);
    return () => {
      if (focusFrame !== undefined) window.cancelAnimationFrame(focusFrame);
    };
  }, [props.editorPoint, !!props.editor, dock, tileError, loaded, editorContainer]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const layer = L.layerGroup().addTo(map);
    map.getContainer().style.cursor = ["set-depot", "add-client"].includes(props.tool) ? "crosshair" : "";
    const association = new Map<number, { vehicle: number; order: number }>();
    const routes = props.manual ? props.manual.map((visits, i) => ({ vehicle: i + 1, visits })) : props.solution?.routes ?? [];
    for (const route of routes) {
      route.visits.forEach((id, i) => association.set(id, { vehicle: route.vehicle, order: i + 1 }));
      if (props.hiddenVehicles?.has(route.vehicle)) continue;
      const faded = !!props.vehicle && props.vehicle !== route.vehicle;
      for (const path of props.roads.get(geometryKey(props.hash, route.visits))?.paths ?? []) {
        L.polyline(path.map(latLng), { color: "#070b14", weight: props.vehicle === route.vehicle ? 10 : 7, opacity: faded ? .15 : .8, interactive: false }).addTo(layer);
        L.polyline(path.map(latLng), { color: colours[(route.vehicle - 1) % colours.length], weight: props.vehicle === route.vehicle ? 6 : 4, opacity: faded ? .25 : 1, bubblingMouseEvents: false })
          .on("click", () => latest.current.onVehicle(route.vehicle)).addTo(layer);
      }
    }
    if (props.comparison && props.solution) {
      const diff = routeDifference(props.comparison, props.solution);
      const draw = (solution: Solution, arcs: string[], color: string, removed: boolean) => {
        const changed = new Set(arcs);
        for (const route of solution.routes) {
          if (props.hiddenVehicles?.has(route.vehicle)) continue;
          const nodes = [0, ...route.visits, 0];
          const geometry = props.roads.get(geometryKey(props.hash, route.visits));
          geometry?.legs.forEach((leg, i) => {
            if (changed.has(`${nodes[i]}>${nodes[i + 1]}`))
              L.polyline(leg.path.map(latLng), { color, weight: removed ? 4 : 6, opacity: .95, dashArray: removed ? "7 5" : undefined, interactive: false }).addTo(layer);
          });
        }
      };
      draw(props.comparison, diff.removed, "#fb7b8d", true);
      draw(props.solution, diff.added, "#82f3b0", false);
    }
    const add = (point: GeoPoint, id: number | null) => {
      const assigned = id ? association.get(id) : undefined;
      if (assigned && props.hiddenVehicles?.has(assigned.vehicle)) return;
      const element = document.createElement("div");
      element.className = `geo-marker ${id === 0 ? "depot" : ""} ${id === null ? "provisional" : ""} ${props.selected === id ? "active" : ""}`;
      element.textContent = id === null ? "+" : id === 0 ? "D" : String(id);
      element.style.setProperty("--vehicle", assigned ? colours[(assigned.vehicle - 1) % colours.length] : "#52616c");
      const marker = L.marker(latLng(point), {
        icon: L.divIcon({ html: element, className: "geo-leaflet-marker", iconSize: id === 0 ? [29, 29] : [23, 23], iconAnchor: id === 0 ? [14, 14] : [11, 11] }),
        title: id === null ? "Cliente provisório" : id === 0 ? "Depósito compartilhado · nó 0" : `Cliente C${id}`,
        draggable: !props.locked && props.tool !== "manual-route" && id !== null,
        bubblingMouseEvents: false,
      }).addTo(layer);
      if (id !== null) {
        marker.on("click", () => latest.current.onSelect(id));
        marker.on("dragend", () => {
          const p = marker.getLatLng();
          if (!latest.current.locked) latest.current.onMove(id, { lat: p.lat, lng: p.lng });
        });
      }
    };
    if (props.draft.depot && props.showDepot !== false) add(props.draft.depot, 0);
    if (props.showClients !== false) props.draft.clients.forEach(p => add(p, p.id));
    if (props.pending) add(props.pending, null);
    return () => { map.removeLayer(layer); };
  }, [loaded, props.draft, props.tool, props.selected, props.vehicle, props.pending, props.solution, props.manual, props.locked, props.roads, props.hash, props.hiddenVehicles, props.showDepot, props.showClients, props.comparison]);
  useEffect(() => {
    const map = mapRef.current, p = props;
    if (!map || !loaded || !p.draft.depot) return;
    const layer = L.layerGroup().addTo(map);
    const vehicles = Array.from({ length: p.draft.vehicles }, (_, i) => {
      const route = p.solution?.routes.find(r => r.vehicle === i + 1);
      const content = document.createElement("div");
      content.className = "geo-vehicle"; content.textContent = `V${i + 1}`;
      content.style.background = colours[i % colours.length];
      content.style.setProperty("--vehicle", colours[i % colours.length]);
      content.hidden = !!p.hiddenVehicles?.has(i + 1);
      const marker = L.marker(latLng(p.draft.depot!), { icon: L.divIcon({ html: content, className: "geo-leaflet-vehicle", iconSize: [28, 20] }), interactive: false, zIndexOffset: 1000 }).addTo(layer);
      return { marker, content, vehicle: i + 1, prepared: route ? prepareRoadRoute(p.draft, route, p.roads.get(geometryKey(p.hash, route.visits))) : null };
    });
    const paint = () => {
      const t = p.clock.enabled ? p.clock.current : 0;
      for (const { marker, content, vehicle, prepared } of vehicles) {
        const state = prepared && p.metric ? preparedVehicleAt(p.metric, prepared, t) : null;
        const position = state && prepared?.segments.length
          ? state.done ? prepared.segments[prepared.segments.length - 1].b : state
          : { x: p.draft.depot!.lng, y: p.draft.depot!.lat };
        marker.setLatLng([position.y, position.x]);
        content.dataset.lat = String(position.y); content.dataset.lng = String(position.x); content.dataset.next = String(state?.next ?? 0);
        content.style.transform = !state || state.done || t === 0 ? `translate(${((vehicle - 1) % 5) * 29 - 55}px, ${-35 - Math.floor((vehicle - 1) / 5) * 20}px)` : "";
      }
    };
    paint(); p.clock.listeners.add(paint);
    return () => { p.clock.listeners.delete(paint); map.removeLayer(layer); };
  }, [loaded, props.draft, props.solution, props.clock, props.metric, props.roads, props.hash, props.hiddenVehicles]);
  return <div ref={shell} className={`geo-map-wrap ${short ? "short-map" : ""} ${props.editorPoint && (dock || tileError) ? "has-docked-editor" : ""}`} aria-label={props.label}>
    <div className="geo-map-viewport">
      <div className="geo-map" ref={host} data-testid="osm-map" aria-label={`${props.label}. Use Ctrl mais a roda do mouse para aproximar ou afastar.`} data-route-signature={JSON.stringify(props.manual ?? props.solution?.routes.map(r => [r.vehicle, ...r.visits]) ?? [])} />
      <div className="geo-map-zoom-hint" aria-hidden="true">Ctrl + roda: zoom</div>
      {tileError && <div className="geo-tile-error" role="alert">Algumas imagens do mapa não carregaram. <button onClick={() => { setTileError(false); tileRef.current?.redraw(); }}>Recarregar mapa</button></div>}
    </div>
    {(dock || tileError) && props.editorPoint ? <div className="geo-docked-editor">{props.editor}</div> : props.editor && createPortal(props.editor, editorContainer)}
  </div>;
}
