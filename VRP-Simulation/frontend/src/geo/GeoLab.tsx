import FleetSettings from "./FleetSettings";
import "./geo.css";
import "./workbench.css";
import { vehicleCapacity, fleetCapacities } from "../types";
import { roadMatrixError, computeRoadMatrix } from "./roads";
import { roadDraft } from "./model";
import { assertInstanceSize, instanceSizeError, MAX_CLIENTS, MAX_VEHICLES } from "../limits";
import DistanceComparison from "./DistanceComparison";
import { RunCompletion, RunProgress, type PreparationPhase } from "./RunFeedback";
import { ResultsOverview, RunStages, SearchReplay, WorkspaceNavigation, type WorkspacePage } from "./Workbench";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../carbon/components";
import {
  MapPin,
  Plus,
  Undo2,
  Scan,
  Play,
  Pause,
  Square,
  SkipForward,
  Upload,
  Download,
  Route as RouteIcon,
  Trash2,
  LocateFixed,
  X,
  PanelLeft,
  Search,
  Maximize2,
  Minimize2,
  Star,
  Circle,
  ChevronRight,
} from "../carbon/icons";
import { api, distance, downloadJson, improvement } from "../api";
import { mergeEvents, hasSequenceGap } from "../events";
import { colours } from "../RouteMap";
import PlaybackPosition from "../PlaybackPosition";
import { useSimulation, type PreparedRoute } from "../simulation";
import { geographicMetric, prepareRoadRoute } from "./roadPlayback";
import type {
  Config,
  Preview,
  Run,
  RunEvent,
  Solution,
  History,
  Status,
} from "../types";
import OpenStreetMap, { type Focus, type MapCamera } from "./OpenStreetMap";
import PlaceSearch from "./PlaceSearch";
import VehicleProgress from "./VehicleProgress";
import ModelReport from "./ModelReport";
import { useRoadGeometry } from "./useRoadGeometry";
import {
  appendVisit,
  emptyDraft,
  geometryKey,
  isGeographic,
  moveNode,
  ready,
  removeClient,
  type GeoDraft,
  type GeographicInstance,
  type GeoPoint,
  type Projection,
  type Tool,
} from "./model";
type GeoPreview = Preview<GeographicInstance> & {
  projection: Projection | null;
};
type GeoRun = Run<GeographicInstance>;
const names: Record<Status, string> = {
  queued: "Preparando",
  running: "Otimizando",
  completed: "Concluído",
  cancelled: "Cancelado",
  no_solution: "Nenhuma solução encontrada",
  failed: "Falha",
  interrupted: "Interrompido",
};
const configuration: Config = {
  adapter: "ortools",
  seed: null,
  stop: "time",
  max_iterations: 5000,
  time_limit: 5,
  sample_every: 25,
};
const number = (n: number) =>
  n.toLocaleString("pt-BR", { maximumFractionDigits: 6 });
const colour = (id: number) => colours[(id - 1) % colours.length];
const configKey = (c: Config) => JSON.stringify([
  c.adapter, c.adapter === "pyvrp" ? c.seed : null, c.stop,
  c.stop === "iterations" ? c.max_iterations : c.time_limit,
]);
const configLabel = (c: Config) => `${c.adapter === "ortools" ? "OR-Tools" : "PyVRP"} · ${c.stop === "iterations" ? `${c.max_iterations} iterações` : `${c.time_limit} s`}${c.adapter === "pyvrp" ? ` · seed ${c.seed}` : ""}`;
interface Props {
  onSynthetic: () => void;
  incomingFile?: File;
  incomingRun?: string;
  onSyntheticFile: (file: File) => void;
  onSyntheticRun: (id: string) => void;
  onBusy: (busy: boolean) => void;
}
export default function GeoLab({
  onSynthetic,
  incomingFile,
  incomingRun,
  onSyntheticFile,
  onSyntheticRun,
  onBusy,
}: Props) {
  const [panel, setPanel] = useState<
    "deliveries" | "settings" | "routes" | "results"
  >("deliveries");
  const [panelOpen, setPanelOpen] = useState(true);
  const [workspacePage, setWorkspacePage] = useState<WorkspacePage>("instance");
  const [hiddenVehicles, setHiddenVehicles] = useState<Set<number>>(new Set());
  const [showDepot, setShowDepot] = useState(true), [showClients, setShowClients] = useState(true);
  const [showChanges, setShowChanges] = useState(false);
  const replayPanel = useRef<HTMLDetailsElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pendingDepot, setPendingDepot] = useState<GeoPoint | null>(null);
  const [depotEditing, setDepotEditing] = useState(true);
  const [expandedMap, setExpandedMap] = useState(false);
  const [draft, setDraft] = useState<GeoDraft>(emptyDraft),
    [undo, setUndo] = useState<GeoDraft[]>([]);
  const [tool, setTool] = useState<Tool>("navigate"),
    [selected, setSelected] = useState<number | null>(null);
  const [pending, setPending] = useState<GeoPoint | null>(null),
    [demand, setDemand] = useState<number | "">(1);
  const [preview, setPreview] = useState<GeoPreview | null>(null),
    [previewBusy, setPreviewBusy] = useState(false);
  const [preparationPhase, setPreparationPhase] = useState<PreparationPhase | null>(null);
  const initiatedRun = useRef<string | null>(null);
  const [completionMotion, setCompletionMotion] = useState<string | null>(null);
  const panelScroll = useRef<HTMLDivElement>(null);
  const compareButton = useRef<HTMLButtonElement>(null);
  const [run, setRun] = useState<GeoRun | null>(null),
    [events, setEvents] = useState<RunEvent[]>([]);
  const [config, setConfig] = useState(configuration),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [networkError, setNetworkError] = useState(""),
    [reconnect, setReconnect] = useState(0);
  const [imported, setImported] = useState(false),
    [replayFile, setReplayFile] = useState<unknown>(null);
  const [view, setView] = useState<
    "problem" | "baseline" | "optimized" | "compare"
  >("problem");
  const [follow, setFollow] = useState(true),
    [index, setIndex] = useState(0),
    [vehicle, setVehicle] = useState<number | null>(null);
  const [liveSearch, setLiveSearch] = useState(true);
  const [previousRun, setPreviousRun] = useState<GeoRun | null>(null);
  const [manual, setManual] = useState<number[][] | null>(null),
    [manualVehicle, setManualVehicle] = useState(1),
    [audit, setAudit] = useState<Solution | null>(null),
    [validating, setValidating] = useState(false);
  const [fit, setFit] = useState(0),
    [focus, setFocus] = useState<Focus | null>(null),
    [camera, setCamera] = useState<MapCamera | null>(null);
  const [search, setSearch] = useState(""),
    [history, setHistory] = useState<History[] | null>(null);
  const revision = useRef(0),
    skipPreview = useRef<GeoDraft | null>(null),
    fileInput = useRef<HTMLInputElement>(null);
  const active = !!run && ["queued", "running"].includes(run.status),
    locked = active || busy || validating;
  useEffect(() => {
    if (panelScroll.current) panelScroll.current.scrollTop = 0;
  }, [panel, run?.id]);
  useEffect(() => {
    setCompletionMotion(null);
    if (run?.status !== "completed" || initiatedRun.current !== run.id) return;
    initiatedRun.current = null;
    setCompletionMotion(run.id);
    const timer = window.setTimeout(() => setCompletionMotion(null), 500);
    return () => window.clearTimeout(timer);
  }, [run?.id, run?.status]);
  const capacities = fleetCapacities(draft);
  const capacityIssue = draft.clients.some(
    (c) => c.demand > Math.max(...capacities),
  )
    ? "Há cliente com demanda maior que a capacidade de todos os veículos."
    : draft.clients.reduce((sum, c) => sum + c.demand, 0) >
        capacities.reduce((a, b) => a + b, 0)
      ? "A demanda total excede a capacidade da frota."
      : "";
  const missingDeliveries = Math.max(0, 2 - draft.clients.length);
  const workflow = pendingDepot
    ? {
        title: "Confirme o depósito",
        detail: "Confira o local escolhido e confirme para começar a adicionar entregas.",
      }
    : pending
      ? {
          title: "Confirme a entrega",
          detail: "Informe a demanda desta parada para incluí-la no cenário.",
        }
      : !draft.depot
        ? {
            title: "Defina o depósito",
            detail: "Busque um endereço ou escolha o ponto de saída no mapa.",
          }
        : missingDeliveries
          ? {
              title: "Adicione as entregas",
              detail: `${draft.clients.length} ${draft.clients.length === 1 ? "entrega" : "entregas"} · faltam ${missingDeliveries} ${missingDeliveries === 1 ? "entrega" : "entregas"} para liberar a otimização.`,
            }
          : capacityIssue
            ? { title: "Ajuste a frota", detail: capacityIssue }
            : {
                title: "Cenário pronto",
                detail: `${draft.clients.length} entregas · ${draft.vehicles} ${draft.vehicles === 1 ? "veículo" : "veículos"} · você pode otimizar agora.`,
              };
  const mapInstruction = manual
    ? "Clique nos clientes na ordem de visita."
    : !draft.depot || tool === "set-depot"
      ? "Clique no mapa para posicionar o depósito."
      : missingDeliveries
        ? `Clique no mapa e informe a demanda. Faltam ${missingDeliveries} ${missingDeliveries === 1 ? "entrega" : "entregas"}.`
        : "Cenário pronto. Adicione outra entrega ou otimize as rotas.";
  const costLabel = draft.road_matrix
    ? draft.road_matrix.provider === "osrm" ? "distância viária · OSRM" : "distância histórica · Google"
    : draft.schema_version === 3
      ? "OSRM · aguardando cálculo"
      : "distância histórica · euclidiana";
  useEffect(() => {
    onBusy(active || busy);
  }, [active, busy, onBusy]);
  const checkpoints = useMemo(
    () => events.filter((e) => e.kind === "checkpoint").map((e) => e.payload),
    [events],
  );
  const samples = useMemo(
    () => events.filter((e) => e.kind === "sample").map((e) => e.payload),
    [events],
  );
  const bestIndex = checkpoints.reduce(
    (best, c, i) =>
      best < 0 || c.solution.cost_ticks <= checkpoints[best].solution.cost_ticks
        ? i
        : best,
    -1,
  );
  const followIndex = active && liveSearch ? checkpoints.length - 1 : bestIndex;
  const checkpoint = checkpoints[follow ? followIndex : index];
  const best =
    run?.result?.solution ?? checkpoints[bestIndex]?.solution ?? null;
  const baseline = preview?.baseline ?? null;
  const displayed =
    view === "problem"
      ? null
      : view === "baseline"
        ? baseline
        : follow
          ? (active && liveSearch ? checkpoint?.solution ?? best ?? baseline : best)
          : (checkpoint?.solution ?? best);
  const metric = useMemo(() => geographicMetric(draft), [draft]);
  const shownRoute = (displayed ?? baseline)?.routes.find(
    (r) => r.vehicle === vehicle,
  );
  const selectedPoint =
    selected === 0
      ? draft.depot
      : (draft.clients.find((c) => c.id === selected) ?? null);
  const assigned = new Map<number, number>();
  if (manual)
    manual.forEach((r, i) => r.forEach((id) => assigned.set(id, i + 1)));
  else
    (displayed?.routes ?? []).forEach((r) =>
      r.visits.forEach((id) => assigned.set(id, r.vehicle)),
    );
  const hash = preview?.hash ?? "";
  const visibleRoutes =
    manual ?? (displayed?.routes ?? []).map((r) => r.visits);
  const roadRoutes =
    view === "compare" || showChanges
      ? [...visibleRoutes, ...(baseline?.routes ?? []).map((r) => r.visits)]
      : visibleRoutes;
  const {
    roads,
    busy: roadBusy,
    error: roadError,
    retry: retryRoads,
    completed: roadFrame,
  } = useRoadGeometry(draft, hash, roadRoutes,
    { solution: displayed, checkpoint, runId: run?.id, view },
    `${run?.id ?? "preview"}/${view}/${checkpoint?.elapsed ?? "initial"}/${follow}/${liveSearch}`,
  );
  const currentRoadsReady = !!displayed && displayed.routes.every(r => !r.visits.length || roads.has(geometryKey(hash, r.visits)));
  const retainedFrame = roadFrame?.value.runId === run?.id && roadFrame?.value.view === view ? roadFrame.value : null;
  const mapSolution = currentRoadsReady ? displayed : retainedFrame?.solution ?? null;
  const mapCheckpoint = currentRoadsReady ? checkpoint : retainedFrame?.checkpoint;
  const mapWaiting = !!displayed && !currentRoadsReady;
  const latestSample = samples[samples.length - 1];
  const configChanged = !!run && configKey(config) !== configKey(run.request.config);
  const comparisonRoadMetres =
    displayed?.routes.length &&
    !manual &&
    displayed.routes.every((r) => roads.has(geometryKey(hash, r.visits)))
      ? displayed.routes.reduce(
          (sum, r) =>
            sum + roads.get(geometryKey(hash, r.visits))!.distanceMetres,
          0,
        )
      : null;
  const roadCount = new Set(
    roadRoutes.filter((r) => r.length).map((r) => geometryKey(hash, r)),
  ).size;
  const loadedRoadCount = new Set(
    roadRoutes
      .filter((r) => r.length && roads.has(geometryKey(hash, r)))
      .map((r) => geometryKey(hash, r)),
  ).size;
  const geometry = shownRoute
    ? roads.get(geometryKey(hash, shownRoute.visits))
    : null;
  const plans = useMemo(() => {
    const prepare = (solution: Solution | null) =>
      (solution?.routes ?? []).map((r) =>
        prepareRoadRoute(draft, r, roads.get(geometryKey(hash, r.visits))),
      );
    const routes = prepare(displayed),
      alternate = prepare(view === "compare" ? baseline : null);
    const ready = [...routes, ...alternate].every(Boolean) && routes.length > 0;
    return {
      ready,
      routes: ready ? (routes as PreparedRoute[]) : [],
      alternate: ready ? (alternate as PreparedRoute[]) : [],
    };
  }, [draft, displayed, baseline, view, roads, hash]);
  const roadsReady = plans.ready;
  const simulation = useSimulation(
    metric,
    displayed,
    view === "compare" ? baseline : null,
    plans,
  );
  function invalidate() {
    revision.current++;
    setRun(null);
    setPreviousRun(null);
    setEvents([]);
    setImported(false);
    setReplayFile(null);
    setManual(null);
    setAudit(null);
    setPreview(null);
    setView("problem");
    setVehicle(null);
    setFollow(true);
    setIndex(0);
    setNetworkError("");
    setShowChanges(false);
    setHiddenVehicles(new Set());
    simulation.stop();
    simulation.setEnabled(false);
  }
  function commit(next: GeoDraft, record = true) {
    if (locked) return;
    const sizeError = instanceSizeError(next);
    if (sizeError) { setError(sizeError); return; }
    if (record) setUndo((h) => [...h.slice(-19), draft]);
    invalidate();
    setDraft(roadDraft(next));
    setPending(null);
    setError("");
  }
  function switchTool(next: Tool) {
    if (next === "add-client" && draft.clients.length >= MAX_CLIENTS) {
      setError(`O cenário aceita no máximo ${MAX_CLIENTS} clientes.`);
      return;
    }
    if (next !== "navigate" && view === "compare") setView("problem");
    setPending(null);
    setTool(next);
    if (next !== "manual-route") {
      setManual(null);
      setAudit(null);
    }
  }
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPending(null);
        setPendingDepot(null);
        setSelected(null);
        setTool("navigate");
        setManual(null);
        setAudit(null);
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  useEffect(() => {
    if (skipPreview.current === draft) {
      skipPreview.current = null;
      setPreviewBusy(false);
      return;
    }
    if (!ready(draft) || (draft.schema_version === 3 && !draft.road_matrix)) {
      setPreviewBusy(false);
      return;
    }
    const controller = new AbortController();
    const at = revision.current;
    setPreviewBusy(true);
    const timer = setTimeout(() => {
      void api<GeoPreview>("/instances/preview", draft, controller.signal)
        .then((data) => {
          if (at === revision.current) {
            setPreview(data);
            setError("");
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted && at === revision.current)
            setError((e as Error).message);
        })
        .finally(() => {
          if (!controller.signal.aborted && at === revision.current)
            setPreviewBusy(false);
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [draft]);
  useEffect(() => {
    if (!run || imported) return;
    const id = run.id,
      at = revision.current,
      controller = new AbortController();
    let disposed = false,
      timer = 0,
      cursor = 0,
      failures = 0,
      retained: RunEvent[] = [];
    async function poll() {
      try {
        const current = await api<GeoRun>(
          `/runs/${id}`,
          undefined,
          controller.signal,
        );
        let more = true;
        while (more && !disposed) {
          const page = await api<{
            events: RunEvent[];
            cursor: number;
            has_more: boolean;
          }>(
            `/runs/${id}/events?after=${cursor}`,
            undefined,
            controller.signal,
          );
          retained = mergeEvents(retained, page.events, id);
          cursor = page.cursor;
          more = page.has_more;
          if (hasSequenceGap(retained))
            throw new Error(
              "Lacuna no histórico recebido. Reconecte para reler os eventos.",
            );
        }
        if (disposed || revision.current !== at) return;
        setEvents(retained);
        setRun(current);
        setNetworkError("");
        failures = 0;
        if (["queued", "running"].includes(current.status))
          timer = window.setTimeout(poll, 400);
      } catch (e) {
        if (disposed || controller.signal.aborted) return;
        setNetworkError(
          "Conexão com a execução interrompida: " + (e as Error).message,
        );
        if (++failures < 5) timer = window.setTimeout(poll, failures * 1000);
      }
    }
    void poll();
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [run?.id, imported, reconnect]);
  function pointPicked(point: GeoPoint) {
    if (locked) return;
    setSearchOpen(false);
    if (tool === "set-depot" || !draft.depot) {
      setPendingDepot(point);
      setPending(null);
      setSelected(null);
      setDepotEditing(true);
    } else if (!manual) {
      setSelected(null);
      setPending(point);
      setDemand(1);
    }
  }
  function selectNode(id: number) {
    setSearchOpen(false);
    if (!manual && window.matchMedia("(max-width: 900px)").matches)
      setPanelOpen(false);
    setSelected(id);
    setPending(null);
    setPendingDepot(null);
    if (manual) {
      if (id > 0 && !locked) {
        setManual(appendVisit(manual, manualVehicle, id));
        setAudit(null);
      }
    }
    if (id > 0) setDemand(draft.clients[id - 1].demand);
  }
  function locate(id: number) {
    setSearchOpen(false);
    if (!manual && window.matchMedia("(max-width: 900px)").matches)
      setPanelOpen(false);
    const point = id === 0 ? draft.depot : draft.clients[id - 1];
    if (point) {
      if (id > 0) setDemand(draft.clients[id - 1].demand);
      setSelected(id);
      setFocus({ point, serial: Date.now() });
    }
  }
  function deleteClient(id: number) {
    commit(removeClient(draft, id));
    setSelected(null);
  }
  function changeManual(next: number[][]) {
    setManual(next);
    setAudit(null);
  }
  async function validateManual() {
    if (!manual || !preview) return;
    const at = revision.current;
    setValidating(true);
    setError("");
    try {
      const result = await api<Solution>("/plans/validate", {
        instance: preview.instance,
        routes: manual,
      });
      if (at === revision.current) setAudit(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setValidating(false);
    }
  }
  function useManual() {
    if (!audit?.feasible || !preview) return;
    setPreview({ ...preview, baseline: audit });
    setManual(null);
    setTool("navigate");
    setView("baseline");
    setAudit(null);
  }
  function freeze() {
    if (follow) {
      setIndex(Math.max(0, followIndex));
      setFollow(false);
    }
  }
  function confirmDepot() {
    if (!pendingDepot) return;
    const point = pendingDepot;
    commit({ ...draft, depot: pendingDepot });
    setPendingDepot(null);
    setDepotEditing(false);
    setFocus({ point, zoom: 15, serial: Date.now() });
    setPanelOpen(false);
    setTool("add-client");
  }
  async function ensureRoadPreview() {
    if (!ready(draft))
      throw new Error("Defina o depósito e pelo menos duas entregas.");
    if (capacityIssue) throw new Error(capacityIssue);
    if (preview?.instance.road_matrix?.provider === "osrm") return preview;
    const at = revision.current;
    const instance: GeographicInstance = {
      ...roadDraft(draft),
      fleet:
        draft.fleet ??
        Array.from({ length: draft.vehicles }, (_, i) => ({
          id: i + 1,
          capacity: draft.capacity,
        })),
    };
    if (!instance.road_matrix) {
      setPreparationPhase("matrix");
      instance.road_matrix = await computeRoadMatrix([instance.depot, ...instance.clients]);
    }
    if (at !== revision.current) throw new Error("O cenário mudou. Calcule novamente.");
    setPreparationPhase("baseline");
    const data = await api<GeoPreview>("/instances/preview", instance);
    if (preview?.baseline?.origin === "manual") {
      const routes = Array.from(
        { length: instance.vehicles },
        (_, i) =>
          preview.baseline?.routes.find((r) => r.vehicle === i + 1)?.visits ??
          [],
      );
      const audited = await api<Solution>("/plans/validate", {
        instance,
        routes,
      });
      if (!audited.feasible) throw new Error(audited.errors.join(" "));
      data.baseline = audited;
    }
    if (at !== revision.current)
      throw new Error("O cenário mudou. Calcule novamente.");
    skipPreview.current = data.instance;
    setDraft(data.instance);
    setPreview(data);
    return data;
  }
  async function optimise() {
    if (!ready(draft) || locked) return;
    setTool("navigate");
    setPending(null);
    setSelected(null);
    setBusy(true);
    setError("");
    simulation.stop();
    simulation.setEnabled(false);
    try {
      const prepared = await ensureRoadPreview();
      if (prepared.issues.length) throw new Error(prepared.issues.join(" "));
      const initial = prepared.baseline;
      setPreparationPhase("start");
      const start = await api<GeoRun>("/runs", {
        instance: prepared.instance,
        config,
        initial_routes: initial
          ? Array.from(
              { length: draft.vehicles },
              (_, i) =>
                initial.routes.find((r) => r.vehicle === i + 1)?.visits ?? [],
            )
          : null,
        initial_origin: initial?.origin === "manual" ? "manual" : "library",
      });
      revision.current++;
      initiatedRun.current = start.id;
      setPreviousRun(run?.result && run.result.instance_hash === prepared.hash ? run : null);
      setRun(start);
      setEvents([]);
      setImported(false);
      setReplayFile(null);
      setUndo([]);
      setFollow(true);
      setView("optimized");
      setPanel("results");
      setPanelOpen(false);
      setWorkspacePage("optimization");
    } catch (e) {
      setError(roadMatrixError(e));
    } finally {
      setPreparationPhase(null);
      setBusy(false);
    }
  }
  async function adoptReplay(data: unknown) {
    const replay = await api<{
      preview: GeoPreview;
      run: GeoRun;
      events: RunEvent[];
    }>("/replays/validate", data);
    invalidate();
    skipPreview.current = replay.preview.instance;
    setDraft(replay.preview.instance);
    setDepotEditing(false);
    setPendingDepot(null);
    setPreview(replay.preview);
    setRun(replay.run);
    setEvents(replay.events);
    setConfig(replay.run.request.config);
    setImported(true);
    setReplayFile(data);
    setView("optimized");
    setPanel("results");
    setWorkspacePage("replay");
    setPanelOpen(false);
    setSelected(null);
    setPending(null);
    setFit((f) => f + 1);
    setUndo([]);
  }
  async function importFile(file: File | undefined) {
    if (!file || locked) return;
    setBusy(true);
    setError("");
    try {
      if (file.size > 25000000) throw new Error("Arquivo maior que 25 MB.");
      const data = JSON.parse(await file.text()),
        instance = data.request?.instance ?? data.instance ?? data;
      assertInstanceSize(instance);
      if (!isGeographic(instance)) {
        onSyntheticFile(file);
        return;
      }
      if (data.events && data.request) await adoptReplay(data);
      else {
        const p = await api<GeoPreview>(
          "/instances/preview",
          roadDraft(instance),
        );
        invalidate();
        skipPreview.current = p.instance;
        setDraft(p.instance);
        setDepotEditing(false);
        setPendingDepot(null);
        setPreview(p);
        setView(p.baseline ? "baseline" : "problem");
        setFit((f) => f + 1);
        setUndo([]);
      }
    } catch (e) {
      setError("Falha ao importar: " + (e as Error).message);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function restore(id: string) {
    setBusy(true);
    setError("");
    try {
      const saved = await api<GeoRun>("/runs/" + id);
      if (!isGeographic(saved.request.instance)) {
        onSyntheticRun(id);
        setHistory(null);
        return;
      }
      if (!["queued", "running"].includes(saved.status))
        await adoptReplay(await api(`/runs/${id}/export`));
      else {
        const p = await api<GeoPreview>(
          "/instances/preview",
          saved.request.instance,
        );
        invalidate();
        skipPreview.current = p.instance;
        setDraft(p.instance);
        setPreview({ ...p, baseline: saved.baseline });
        setRun(saved);
        setConfig(saved.request.config);
        setView("optimized");
        setFit((f) => f + 1);
      }
      setHistory(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const receivedFile = useRef<File | undefined>(undefined);
  const receivedRun = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (incomingFile && receivedFile.current !== incomingFile) {
      receivedFile.current = incomingFile;
      void importFile(incomingFile);
    }
  }, [incomingFile]);
  useEffect(() => {
    if (incomingRun && receivedRun.current !== incomingRun) {
      receivedRun.current = incomingRun;
      void restore(incomingRun);
    }
  }, [incomingRun]);
  const visibleClients = draft.clients.filter((c) =>
    `c${c.id} ${c.id} ${c.address ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const commonMap = {
    draft,
    selected,
    vehicle,
    hash,
    roads,
    fit,
    focus,
    camera,
    onCamera: setCamera,
    onPoint: pointPicked,
    onSelect: selectNode,
    onMove: (id: number, p: GeoPoint) => commit(moveNode(draft, id, p)),
    onVehicle: (id: number) => {
      setVehicle(id);
      setPanel("routes");
      setPanelOpen(true);
    },
    clock: simulation.clock,
    metric,
    hiddenVehicles,
    showDepot,
    showClients,
  };
  const budgetOptions = config.adapter === "pyvrp"
    ? [{ value: 500, label: "Rápida · 500 iterações" }, { value: 5000, label: "Padrão · 5.000 iterações" }, { value: 30000, label: "Ampliada · 30.000 iterações" }]
    : [{ value: 1, label: "Rápida · 1 s" }, { value: 5, label: "Padrão · 5 s" }, { value: 30, label: "Ampliada · 30 s" }];
  const activeBudget = config.adapter === "pyvrp" ? config.max_iterations : config.time_limit;
  const savedImprovement = improvement(baseline?.cost_ticks, best?.cost_ticks);
  const analysisMode = ["optimization", "compare", "replay"].includes(workspacePage);
  const panelTabs = ([
    ["deliveries", "Entregas"], ["settings", "Frota e ajustes"],
    ["routes", "Rotas"], ["results", "Detalhes"],
  ] as const).filter(([id]) => id !== "routes" && id !== "results" || id === panel || (id === "routes" ? ready(draft) : !!baseline || !!run));
  function navigateWorkspace(next: WorkspacePage) {
    setWorkspacePage(next);
    setPending(null);
    setSelected(null);
    setSearchOpen(false);
    if (next === "instance" || next === "settings") {
      setPanel(next === "instance" ? "deliveries" : "settings");
      setPanelOpen(true);
    } else {
      setPanelOpen(false);
      if (next === "compare" && baseline && best) { setFollow(true); setView("compare"); }
      if (next === "optimization" || next === "replay") setView(best ? "optimized" : baseline ? "baseline" : "problem");
    }
  }
  const pointEditor = (
    <>
      {pendingDepot && (
        <section
          className="geo-editor"
          aria-label="Confirmar depósito"
          aria-modal="false"
          role="dialog"
          onClick={event => event.stopPropagation()}
          onKeyDown={event => {
            if (event.key !== "Escape") return;
            setPendingDepot(null);
            setTool("navigate");
          }}
        >
          <h2>Depósito</h2>
          <button
            className="geo-editor-close"
            aria-label="Cancelar depósito"
            onClick={() => {
              setPendingDepot(null);
              setTool("navigate");
            }}
          >
            <X size={16} />
          </button>
          <p>
            {pendingDepot.address ||
              `${number(pendingDepot.lat)}, ${number(pendingDepot.lng)}`}
          </p>
          <button
            className="primary geo-wide"
            disabled={locked}
            onClick={event => { event.stopPropagation(); confirmDepot(); }}
          >
            Confirmar depósito
          </button>
        </section>
      )}
      {pending && (
        <section
          className="geo-editor"
          aria-label="Novo cliente"
          aria-modal="false"
          role="dialog"
          onClick={event => event.stopPropagation()}
          onKeyDown={event => {
            if (event.key !== "Escape") return;
            setPending(null);
            setSelected(null);
          }}
        >
          <h2>Nova entrega</h2>
          <button
            className="geo-editor-close"
            aria-label="Fechar edição"
            onClick={() => {
              setPending(null);
              setSelected(null);
            }}
          >
            <X size={16} />
          </button>
          <p>
            {number(pending.lat)}, {number(pending.lng)}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.clients.length < MAX_CLIENTS && typeof demand === "number" && demand >= 1 && demand <= 10000 && Number.isInteger(demand)) {
                const id = draft.clients.length + 1;
                commit({
                  ...draft,
                  clients: [...draft.clients, { ...pending, id, demand }],
                });
                setSelected(null);
              }
            }}
          >
            <label>
              Demanda
              <input
                autoFocus
                aria-label="Demanda do novo cliente"
                type="number"
                min={1}
                max={10000}
                required
                value={demand}
                onChange={(e) => setDemand(e.target.value === "" ? "" : e.target.valueAsNumber)}
              />
            </label>
            <button className="primary" type="submit" disabled={locked || draft.clients.length >= MAX_CLIENTS}>
              Adicionar cliente
            </button>
            <button type="button" onClick={() => setPending(null)}>
              Cancelar adição
            </button>
          </form>
        </section>
      )}
      {selectedPoint && !pending && !pendingDepot && (
        <section
          className="geo-editor"
          aria-label="Editar ponto"
          aria-modal="false"
          role="dialog"
          onKeyDown={event => {
            if (event.key === "Escape") setSelected(null);
          }}
        >
          <h2>{selected === 0 ? "Depósito · nó 0" : `Cliente C${selected}`}</h2>
          <button
            className="geo-editor-close"
            aria-label="Fechar edição"
            onClick={() => setSelected(null)}
          >
            <X size={16} />
          </button>
          {selectedPoint.address && <p>{selectedPoint.address}</p>}
          <details>
            <summary>Coordenadas</summary>
            <small>
              {number(selectedPoint.lat)}, {number(selectedPoint.lng)}
            </small>
          </details>
          {selected !== 0 && (
            <>
              <p>
                {assigned.has(selected!)
                  ? `Veículo V${assigned.get(selected!)}`
                  : "Sem rota atribuída"}
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (typeof demand !== "number" || !Number.isInteger(demand) || demand < 1 || demand > 10000) return;
                  commit({
                    ...draft,
                    clients: draft.clients.map((c) =>
                      c.id === selected ? { ...c, demand } : c,
                    ),
                  });
                }}
              >
                <label>
                  Demanda
                  <input
                    aria-label="Demanda do cliente selecionado"
                    type="number"
                    min={1}
                    max={10000}
                    required
                    disabled={locked || !!manual}
                    value={demand}
                    onChange={(e) => setDemand(e.target.value === "" ? "" : e.target.valueAsNumber)}
                  />
                </label>
                <button disabled={locked || !!manual} type="submit">
                  Salvar demanda
                </button>
              </form>
            </>
          )}
          <div className="geo-actions">
            {selected === 0 && (
              <button
                disabled={locked || !!manual}
                onClick={() => {
                  switchTool("set-depot");
                  setSelected(null);
                }}
              >
                Reposicionar depósito
              </button>
            )}
            {selected !== 0 && (
              <button
                disabled={locked || !!manual}
                onClick={() => deleteClient(selected!)}
              >
                Excluir cliente
              </button>
            )}
          </div>
          {manual && selected !== 0 && assigned.has(selected!) && (
            <button
              disabled={locked}
              onClick={() =>
                changeManual(
                  manual.map((r) => r.filter((id) => id !== selected)),
                )
              }
            >
              Remover do plano manual
            </button>
          )}
        </section>
      )}
    </>
  );
  return (
    <div
      className={`geo-lab workbench ${analysisMode ? "is-analysis" : "is-planning"} ${expandedMap ? "map-expanded" : ""}`}
      data-instance-hash={hash}
    >
      <WorkspaceNavigation page={workspacePage} onNavigate={navigateWorkspace} onSynthetic={onSynthetic} locked={locked}
        onHelp={() => { setPanel("results"); setPanelOpen(true); window.requestAnimationFrame(() => { const help = panelScroll.current?.querySelector<HTMLDetailsElement>(".geo-help"); if (help) { help.open = true; help.scrollIntoView({ block: "nearest" }); } }); }} />
      <header className="wb-header">
        <div className="wb-scenario"><div className="wb-scenario-title"><h1 title={draft.name}>{!draft.depot && draft.name === "Cenário no mapa" ? "Planeje a próxima rota." : draft.name}</h1></div><p id="scenario-workflow"><strong>{workflow.title}.</strong> {workflow.detail}</p></div>
        <div className="wb-header-controls">
          <details className="wb-solver-options"><summary>Configurar busca</summary><div>
          <label>Solver<select aria-label="Solver da otimização" value={config.adapter} disabled={locked || !!manual} onChange={e => setConfig({ ...config, adapter: e.target.value as Config["adapter"], seed: e.target.value === "pyvrp" ? 7 : null, stop: e.target.value === "pyvrp" ? "iterations" : "time" })}><option value="ortools">OR-Tools</option><option value="pyvrp">PyVRP</option></select></label>
          <label>Configuração<select aria-label="Orçamento da otimização" disabled={locked || !!manual} value={config.stop === (config.adapter === "pyvrp" ? "iterations" : "time") && budgetOptions.some(option => option.value === activeBudget) ? String(activeBudget) : "custom"} onChange={e => { if (e.target.value === "custom") navigateWorkspace("settings"); else if (config.adapter === "pyvrp") setConfig({ ...config, stop: "iterations", max_iterations: Number(e.target.value) }); else setConfig({ ...config, stop: "time", time_limit: Number(e.target.value) }); }}>
            {budgetOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            <option value="custom">Personalizada · ajustar…</option>
          </select></label>
          </div></details>
          <Button size="lg" kind={active ? "danger" : "primary"} className="wb-optimize" icon={active ? <Square /> : !draft.depot ? <MapPin /> : !ready(draft) ? <Plus /> : <Play />} aria-label={active ? "Cancelar otimização" : !draft.depot ? "Definir depósito" : !ready(draft) ? "Adicionar entregas" : "Otimizar cenário"} aria-describedby={!active ? "scenario-workflow" : undefined} aria-busy={busy || active} disabled={!active && (previewBusy || locked || !!manual || (ready(draft) && (!!preview?.issues.length || !!capacityIssue)))} title={capacityIssue || undefined} onClick={() => {
            if (active && run) { void api(`/runs/${run.id}/cancel`, {}).catch(e => setError(e.message)); return; }
            if (!draft.depot) {
              navigateWorkspace("instance"); setPanel("deliveries"); setPanelOpen(true);
              window.requestAnimationFrame(() => panelScroll.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus());
              return;
            }
            if (!ready(draft)) { switchTool("add-client"); setPanelOpen(false); return; }
            void optimise();
          }}>{active ? "Cancelar busca" : busy ? "Preparando…" : !draft.depot ? "Definir depósito" : !ready(draft) ? "Adicionar entregas" : "Otimizar rotas"}</Button>
        </div>
      </header>
      {(preparationPhase || active) && <RunStages phase={preparationPhase} draft={draft} baseline={baseline} run={run} loaded={loadedRoadCount} total={roadCount} roadBusy={roadBusy} networkError={!!networkError} />}
      {(error || networkError || (capacityIssue && !panelOpen)) && (
        <div className="geo-notices">
          {capacityIssue && !panelOpen && <div className="geo-alert" role="alert">{capacityIssue}<button onClick={() => navigateWorkspace("settings")}>Ajustar frota</button></div>}
          {error && (
            <div className="geo-alert" role="alert">
              {error}
              <button onClick={() => setError("")}>Fechar aviso</button>
            </div>
          )}
          {networkError && (
            <div className="geo-alert" role="alert">
              {networkError}
              <button
                onClick={() => {
                  setEvents([]);
                  setReconnect((v) => v + 1);
                }}
              >
                Reconectar à execução
              </button>
            </div>
          )}
        </div>
      )}
      <main id="route-workspace" tabIndex={-1} className={`geo-workspace ${panelOpen ? "" : "panel-collapsed"}`}>
        <aside
          className="geo-controls"
          aria-label="Painel do cenário"
          hidden={!panelOpen}
        >
          <div className="geo-panel-heading">
            <h2>Planejar cenário</h2>
            <button
              aria-label="Recolher painel"
              onClick={() => setPanelOpen(false)}
            >
              <span>Ver mapa</span>
              <ChevronRight size={17} />
            </button>
          </div>
          <div
            className="geo-panel-tabs"
            hidden={!draft.depot && panel === "deliveries"}
            role="tablist"
            aria-label="Painéis do cenário"
          >
            {panelTabs.map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={panel === id}
                tabIndex={panel === id ? 0 : -1}
                onKeyDown={(event) => {
                  const ids = panelTabs.map(([tab]) => tab);
                  const at = ids.indexOf(id);
                  const next =
                    event.key === "ArrowRight"
                      ? (at + 1) % ids.length
                      : event.key === "ArrowLeft"
                        ? (at + ids.length - 1) % ids.length
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? ids.length - 1
                            : null;
                  if (next !== null) {
                    event.preventDefault();
                    setPanel(ids[next]);
                    document.getElementById(`geo-tab-${ids[next]}`)?.focus();
                  }
                }}
                aria-controls={`geo-panel-${id}`}
                id={`geo-tab-${id}`}
                onClick={() => setPanel(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="geo-panel-scroll" ref={panelScroll}>
            <div
              role="tabpanel"
              aria-labelledby="geo-tab-deliveries"
              id="geo-panel-deliveries"
              hidden={panel !== "deliveries"}
            >
              <section className="geo-delivery-start">
                <div className="rs-section-heading"><span className="rs-section-icon"><MapPin size={24} /></span><div><h2>Depósito de partida</h2><p>{draft.depot ? "O início e o fim das suas rotas." : "Escolha de onde saem as entregas."}</p></div></div>
                {draft.depot && !depotEditing ? (
                  <>
                    <button
                      className="geo-depot-row"
                      onClick={() => {
                        selectNode(0);
                        locate(0);
                      }}
                    >
                      <MapPin size={16} />
                      <span>
                        {draft.depot.address || "Depósito definido no mapa"}
                      </span>
                    </button>
                    <button
                      className="geo-wide"
                      disabled={locked}
                      onClick={() => setDepotEditing(true)}
                    >
                      Alterar depósito
                    </button>
                  </>
                ) : (
                  <>
                    <PlaceSearch
                      disabled={locked}
                      onPlace={(point) => {
                        setPendingDepot(point);
                        setFocus({ point, zoom: 15, serial: Date.now() });
                        setPanelOpen(false);
                        setTool("set-depot");
                      }}
                    />
                    <button
                      className="geo-wide"
                      disabled={locked}
                      onClick={() => {
                        switchTool("set-depot");
                        setPanelOpen(false);
                      }}
                    >
                      Definir no mapa
                    </button>
                    {draft.depot && (
                      <button
                        className="geo-wide"
                        onClick={() => {
                          setDepotEditing(false);
                          setPendingDepot(null);
                        }}
                      >
                        Cancelar alteração
                      </button>
                    )}
                  </>
                )}
                <div className="geo-delivery-count">
                  <b>{draft.clients.length}</b>
                  <span>
                    entregas · demanda{" "}
                    {draft.clients.reduce((n, c) => n + c.demand, 0)}
                  </span>
                </div>
              </section>
              {draft.depot && <section>
                <h2>
                  Entregas <span>{draft.clients.length}</span>
                </h2>
                <button className="geo-wide wb-add-delivery" disabled={!draft.depot || locked || !!manual} onClick={() => { switchTool("add-client"); setPanelOpen(false); }}>Adicionar entrega no mapa <Plus size={16} /></button>
                {draft.clients.length > 0 && <input
                  aria-label="Buscar cliente"
                  placeholder="Buscar ID ou endereço"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />}
                <div className="geo-client-list">
                  {visibleClients.map((c) => (
                    <div
                      className={`geo-client-row ${selected === c.id ? "selected" : ""}`}
                      key={c.id}
                      style={{
                        borderLeftColor: assigned.has(c.id)
                          ? colour(assigned.get(c.id)!)
                          : "var(--line)",
                      }}
                    >
                      <button
                        className="geo-client-name"
                        onClick={() => {
                          selectNode(c.id);
                          locate(c.id);
                        }}
                      >
                        <strong>C{c.id}</strong>
                        <small>{c.address || "Ponto no mapa"}</small>
                      </button>
                      <span title="Demanda">{c.demand}</span>
                      <small>
                        {assigned.has(c.id)
                          ? `V${assigned.get(c.id)}`
                          : "livre"}
                      </small>
                      <button
                        aria-label={`Localizar C${c.id}`}
                        title="Localizar"
                        onClick={() => locate(c.id)}
                      >
                        <LocateFixed size={14} />
                      </button>
                      <button
                        aria-label={`Excluir C${c.id}`}
                        title="Excluir"
                        disabled={locked || !!manual}
                        onClick={() => deleteClient(c.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>}
              {draft.depot && <section className="wb-fleet-summary"><button className="geo-wide" onClick={() => setPanel("settings")}>{draft.vehicles} veículos · ajustar frota <ChevronRight size={16} /></button></section>}
              <section className="wb-import-shortcut"><button className="geo-wide" disabled={locked} onClick={() => fileInput.current?.click()}><Upload size={16} />Importar cenário</button><p className="geo-note">Continue um cenário ou uma execução salva.</p></section>
            </div>
            <div
              role="tabpanel"
              aria-labelledby="geo-tab-settings"
              id="geo-panel-settings"
              hidden={panel !== "settings"}
            >
              <section>
                <h2>Cenário e frota</h2>
                <label>
                  Nome
                  <input
                    value={draft.name}
                    maxLength={80}
                    disabled={locked}
                    onChange={(e) =>
                      commit({
                        ...draft,
                        name: e.target.value || "Cenário no mapa",
                      })
                    }
                  />
                </label>
                <FleetSettings draft={draft} disabled={locked || !!manual} onChange={commit} onError={setError} />
                <p className="geo-note">
                  Capacidade total:{" "}
                  {fleetCapacities(draft).reduce((a, b) => a + b, 0)} · mesma
                  unidade das demandas.
                </p>
                <div className="geo-actions">
                  <button
                    disabled={locked}
                    onClick={() => fileInput.current?.click()}
                  >
                    <Upload size={14} /> Importar
                  </button>
                  <button
                    disabled={!ready(draft) || locked}
                    onClick={() =>
                      downloadJson("vrp-simulation-geografico.json", draft)
                    }
                  >
                    <Download size={14} /> Cenário
                  </button>
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".json"
                  hidden
                  onChange={(e) => void importFile(e.target.files?.[0])}
                />
              </section>

              <section>
                <h2>Solver</h2>
                <fieldset disabled={locked || !!manual}>
                  <label>
                    Biblioteca
                    <select
                      aria-label="Biblioteca no mapa"
                      value={config.adapter}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          adapter: e.target.value as Config["adapter"],
                          seed: e.target.value === "pyvrp" ? 7 : null,
                          stop:
                            e.target.value === "pyvrp" ? "iterations" : "time",
                        })
                      }
                    >
                      <option value="ortools">OR-Tools</option>
                      <option value="pyvrp">PyVRP</option>
                    </select>
                  </label>
                  {config.adapter === "pyvrp" && (
                    <>
                      <label>
                        Critério de parada
                        <select
                          value={config.stop}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              stop: e.target.value as Config["stop"],
                            })
                          }
                        >
                          <option value="iterations">Iterações</option>
                          <option value="time">Tempo</option>
                        </select>
                      </label>
                      <label>
                        Máx. iterações
                        <input
                          type="number"
                          min={1}
                          max={100000}
                          disabled={config.stop !== "iterations"}
                          value={config.max_iterations}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              max_iterations: e.target.valueAsNumber,
                            })
                          }
                        />
                      </label>
                      <label>
                        Seed
                        <input
                          type="number"
                          min={0}
                          value={config.seed ?? 7}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              seed: e.target.valueAsNumber,
                            })
                          }
                        />
                      </label>
                    </>
                  )}
                  <label>
                    Tempo limite (s)
                    <input
                      aria-label="Tempo no mapa"
                      type="number"
                      min={0.1}
                      max={60}
                      disabled={config.stop !== "time"}
                      step={0.1}
                      value={config.time_limit}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          time_limit: e.target.valueAsNumber,
                        })
                      }
                    />
                  </label>
                </fieldset>
                <p className="geo-note">Parada por {config.stop === "iterations" ? "iterações; o campo de tempo fica inativo. O limite de segurança da execução é 60 s." : "tempo; o campo de iterações fica inativo."}</p>
                {configChanged && <p role="status" data-testid="pending-config">Parâmetros alterados. Clique em Otimizar cenário para executar com {configLabel(config)}. O resultado exibido pertence à execução anterior.</p>}
              </section>

              <section>
                {" "}
                <button
                  className="geo-wide"
                  disabled={locked}
                  onClick={() =>
                    void api<History[]>("/runs")
                      .then(setHistory)
                      .catch((e) => setError(e.message))
                  }
                >
                  Histórico de execuções
                </button>
                {history && (
                  <div className="geo-history">
                    <button onClick={() => setHistory(null)}>
                      Fechar histórico
                    </button>
                    {history.map((h) => (
                      <button
                        disabled={locked}
                        key={h.id}
                        onClick={() => void restore(h.id)}
                      >
                        {h.name} · {names[h.status]}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </div>
            <div
              role="tabpanel"
              aria-labelledby="geo-tab-routes"
              id="geo-panel-routes"
              hidden={panel !== "routes"}
            >
              <section>
                {ready(draft) && !draft.road_matrix && <button className="geo-wide" disabled={locked || !!capacityIssue || previewBusy} onClick={async () => {
                  setBusy(true); setError("");
                  try { await ensureRoadPreview(); setView("baseline"); }
                  catch (cause) { setError(roadMatrixError(cause)); }
                  finally { setPreparationPhase(null); setBusy(false); }
                }}>Carregar distâncias para o plano manual</button>}
                <button
                  className="geo-manual-trigger"
                  disabled={!preview || locked}
                  aria-pressed={!!manual}
                  onClick={() => {
                    if (manual) {
                      setManual(null);
                      setAudit(null);
                      setTool("navigate");
                      return;
                    }
                    setPanel("routes");
                    setPending(null);
                    setPanelOpen(true);
                    setSelected(null);
                    revision.current++;
                    setRun(null);
                    setEvents([]);
                    setManual(Array.from({ length: draft.vehicles }, () => []));
                    setManualVehicle(1);
                    setAudit(null);
                    setTool("manual-route");
                    setView("baseline");
                    simulation.stop();
                  }}
                >
                  <RouteIcon size={15} />
                  {manual ? "Fechar plano manual" : "Plano manual"}
                </button>
              </section>
              {manual && (
                <section className="geo-manual">
                  <h2>Monte a sequência de cada veículo</h2>
                  <fieldset disabled={locked}>
                    <div className="geo-actions">
                      <label>
                        Veículo do plano
                        <select
                          aria-label="Veículo do plano"
                          value={manualVehicle}
                          onChange={(e) => {
                            setManualVehicle(+e.target.value);
                            setVehicle(+e.target.value);
                          }}
                        >
                          {manual.map((_, i) => (
                            <option key={i} value={i + 1}>
                              V{i + 1}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        disabled={!baseline}
                        onClick={() =>
                          changeManual(
                            Array.from(
                              { length: draft.vehicles },
                              (_, i) =>
                                baseline?.routes.find(
                                  (r) => r.vehicle === i + 1,
                                )?.visits ?? [],
                            ),
                          )
                        }
                      >
                        Copiar baseline
                      </button>
                    </div>
                    <p>
                      {draft.clients.length - new Set(manual.flat()).size}{" "}
                      clientes sem atribuição · carga V{manualVehicle}:{" "}
                      {manual[manualVehicle - 1].reduce(
                        (sum, id) => sum + draft.clients[id - 1].demand,
                        0,
                      )}{" "}
                      / {vehicleCapacity(draft, manualVehicle)}
                    </p>
                    <ol>
                      {manual[manualVehicle - 1].map((id, i, route) => (
                        <li key={id}>
                          <span>
                            C{id} · demanda {draft.clients[id - 1].demand}
                          </span>
                          <button
                            aria-label={`Subir C${id}`}
                            disabled={!i}
                            onClick={() => {
                              const next = [...route];
                              [next[i - 1], next[i]] = [next[i], next[i - 1]];
                              changeManual(
                                manual.map((r, v) =>
                                  v === manualVehicle - 1 ? next : r,
                                ),
                              );
                            }}
                          >
                            ↑
                          </button>
                          <button
                            aria-label={`Descer C${id}`}
                            disabled={i === route.length - 1}
                            onClick={() => {
                              const next = [...route];
                              [next[i + 1], next[i]] = [next[i], next[i + 1]];
                              changeManual(
                                manual.map((r, v) =>
                                  v === manualVehicle - 1 ? next : r,
                                ),
                              );
                            }}
                          >
                            ↓
                          </button>
                          <button
                            aria-label={`Remover C${id} da rota`}
                            onClick={() =>
                              changeManual(
                                manual.map((r) => r.filter((n) => n !== id)),
                              )
                            }
                          >
                            Remover
                          </button>
                        </li>
                      ))}
                    </ol>
                    <div className="geo-unassigned">
                      {draft.clients
                        .filter((c) => !assigned.has(c.id))
                        .map((c) => (
                          <button
                            key={c.id}
                            onClick={() =>
                              changeManual(
                                appendVisit(manual, manualVehicle, c.id),
                              )
                            }
                          >
                            + C{c.id}
                          </button>
                        ))}
                    </div>
                    <button onClick={() => void validateManual()}>
                      Validar plano
                    </button>
                    <button
                      className="primary"
                      disabled={!audit?.feasible}
                      onClick={useManual}
                    >
                      Usar como baseline
                    </button>
                  </fieldset>
                  {validating && <p role="status">Validando plano…</p>}
                  {audit && (
                    <p role={audit.feasible ? "status" : "alert"}>
                      {audit.feasible
                        ? `Plano viável · ${distance(audit.cost_ticks)} m`
                        : audit.errors.join(" ")}
                    </p>
                  )}
                </section>
              )}

              {!manual && (
                <>
                  {" "}
                  <section>
                    <h2>Frota · depósito 0</h2>
                    <p className="geo-note">
                      Selecione um veículo para destacar a rota.
                    </p>
                    {Array.from({ length: draft.vehicles }, (_, i) => {
                      const r = (displayed ?? baseline)?.routes.find(
                        (r) => r.vehicle === i + 1,
                      );
                      return (
                        <button
                          className="geo-fleet-row"
                          aria-pressed={vehicle === i + 1}
                          key={i}
                          onClick={() =>
                            setVehicle(vehicle === i + 1 ? null : i + 1)
                          }
                        >
                          <i style={{ background: colour(i + 1) }} />
                          <strong>V{i + 1}</strong>
                          <span>
                            {r
                              ? `${r.visits.length} clientes · ${r.load}/${vehicleCapacity(draft, r.vehicle)}`
                              : "No depósito"}
                          </span>
                        </button>
                      );
                    })}
                  </section>
                  {shownRoute && (
                    <section className="geo-route-detail">
                      <h2>Veículo V{shownRoute.vehicle}</h2>
                      <p>
                        {[0, ...shownRoute.visits, 0]
                          .map((id) => (id === 0 ? "Depósito" : `C${id}`))
                          .join(" → ")}
                      </p>
                      <dl>
                        <dt>Carga</dt>
                        <dd>
                          {shownRoute.load} /{" "}
                          {vehicleCapacity(draft, shownRoute.vehicle)}
                        </dd>
                        <dt>Custo: {costLabel}</dt>
                        <dd>{distance(shownRoute.cost_ticks)} m</dd>
                      </dl>
                      {metric && geometry && (
                        <VehicleProgress
                          metric={metric}
                          route={shownRoute}
                          clock={simulation.clock}
                          enabled={simulation.enabled}
                          draft={draft}
                          road={geometry}
                        />
                      )}
                      <p>
                        {geometry
                          ? "Traçado viário exibido automaticamente"
                          : roadBusy
                            ? "Consultando ruas no OSRM…"
                            : "O traçado pelas ruas é carregado ao exibir a rota no mapa."}
                      </p>
                      {geometry && (
                        <p>
                          Traçado OSRM: {number(geometry.distanceMetres)} m.
                          {draft.road_matrix
                            ? ` Diferença para a matriz usada no custo: ${number(geometry.distanceMetres - shownRoute.cost_ticks / 1000)} m. A matriz e o traçado são consultas separadas.`
                            : " Este replay histórico usa custos euclidianos. Novas buscas usam a matriz OSRM."}
                        </p>
                      )}
                      {geometry && !draft.road_matrix && (
                        <DistanceComparison
                          costTicks={shownRoute.cost_ticks}
                          roadMetres={geometry.distanceMetres}
                        />
                      )}
                      {geometry?.warnings.map((w) => (
                        <small key={w}>{w}</small>
                      ))}
                    </section>
                  )}
                </>
              )}
            </div>
            <div
              role="tabpanel"
              aria-labelledby="geo-tab-results"
              id="geo-panel-results"
              hidden={panel !== "results"}
              className="geo-results"
            >
              {run?.status === "completed" && run.result?.solution?.feasible && !busy && !manual && (
                <RunCompletion
                  key={run.id}
                  solution={run.result.solution}
                  baseline={run.baseline}
                  imported={imported}
                  animate={!imported && completionMotion === run.id}
                  onCompare={() => {
                    simulation.stop();
                    setFollow(true);
                    setView("compare");
                    setPending(null);
                    setPendingDepot(null);
                    setSelected(null);
                    setSearchOpen(false);
                    setTool("navigate");
                    if (window.matchMedia("(max-width: 900px)").matches) {
                      setPanelOpen(false);
                      window.requestAnimationFrame(() => compareButton.current?.focus());
                    }
                  }}
                />
              )}
              <section className="geo-metrics">
                <div>
                  <small>
                    Baseline
                    {baseline?.origin === "manual"
                      ? " manual"
                      : " da biblioteca"}
                  </small>
                  <strong>
                    {distance(baseline?.cost_ticks)} <em>m</em>
                  </strong>
                </div>
                <div>
                  <small>Melhor solução observada</small>
                  <strong>
                    {distance(best?.cost_ticks)} <em>m</em>
                  </strong>
                </div>
                <div>
                  <small>Redução de custo</small>
                  <strong>
                    {savedImprovement == null
                      ? "—"
                      : savedImprovement.toFixed(2) + "%"}
                  </strong>
                </div>
                <div>
                  <small>Execução</small>
                  <strong>{run ? names[run.status] : "Não iniciada"}</strong>
                </div>
              </section>
              {!draft.road_matrix &&
                displayed &&
                comparisonRoadMetres != null && (
                  <section aria-label="Conferência nas ruas da solução exibida">
                    <h2>Conferência nas ruas · solução exibida</h2>
                    <DistanceComparison
                      costTicks={displayed.cost_ticks}
                      roadMetres={comparisonRoadMetres}
                    />
                  </section>
                )}
              {run?.error && <p role="alert">{run.error}</p>}
              {run && <p className="geo-note" data-testid="run-config">Execução {run.id.slice(0, 8)} · {configLabel(run.request.config)}</p>}
              {run?.result && previousRun?.result && <p className="geo-note" data-testid="run-comparison">
                Anterior: {configLabel(previousRun.request.config)} · {distance(previousRun.result.solution?.cost_ticks)} m.
                {run.result.solution?.cost_ticks === previousRun.result.solution?.cost_ticks ? " A nova execução terminou com o mesmo custo viário. Parâmetros diferentes não garantem outro resultado." : ` Atual: ${distance(run.result.solution?.cost_ticks)} m.`}
              </p>}
              {preview && (
                <ModelReport
                  instance={preview.instance}
                  solution={
                    manual ? audit : view === "problem" ? baseline : displayed
                  }
                  label={
                    manual
                      ? "Plano manual"
                      : view === "optimized" || view === "compare"
                        ? "Checkpoint exibido"
                        : "Baseline"
                  }
                  run={run}
                />
              )}
              {run?.result && (
                <p className="geo-note">
                  {run.result.iterations != null
                    ? `${run.result.iterations} iterações`
                    : `${run.result.observed_solutions ?? 0} soluções observadas`}{" "}
                  · solver {run.result.solver_runtime.toFixed(3)} s · parada:{" "}
                  {run.result.stop_reason}
                </p>
              )}

              {!!checkpoints.length && (
                <section className="geo-checkpoints">
                  <label>
                    <input
                      type="checkbox"
                      checked={follow}
                      onChange={(e) => {
                        setFollow(e.target.checked);
                        setIndex(Math.max(0, followIndex));
                      }}
                    />
                    Acompanhar execução
                  </label>
                  <label>
                    Visualização durante a busca
                    <select aria-label="Visualização da busca" value={liveSearch ? "current" : "best"} onChange={e => { setLiveSearch(e.target.value === "current"); setFollow(true); }}>
                      <option value="current">Estados da busca ao vivo</option>
                      <option value="best">Melhor solução encontrada</option>
                    </select>
                  </label>
                  <input
                    aria-label="Checkpoint no mapa"
                    type="range"
                    min={0}
                    max={checkpoints.length - 1}
                    value={follow ? Math.max(0, followIndex) : index}
                    onChange={(e) => {
                      setFollow(false);
                      setIndex(+e.target.value);
                    }}
                  />
                  <small>
                    {checkpoint?.reason} · {checkpoint?.elapsed.toFixed(3)} s de
                    busca
                  </small>
                </section>
              )}

              <details className="geo-help">
                <summary>Distâncias e reprodução</summary>
                <p>
                  {draft.road_matrix
                    ? "O solver minimiza a soma das distâncias da matriz direcionada retornada pelo OSRM, em metros. O perfil automóvel escolhe os trajetos mais rápidos; a otimização usa a distância desses trajetos. A mesma matriz calcula baseline e resultado."
                    : draft.schema_version === 3
                      ? "A matriz viária do OSRM ainda não foi calculada. O cenário não tem custos disponíveis."
                      : "Este replay histórico usa custos euclidianos em UTM. Uma nova busca exige a matriz OSRM. O traçado atual é uma consulta separada e não altera os custos do arquivo."}
                </p>
                <a
                  href="https://project-osrm.org/docs/v5.24.0/api/#table-service"
                  target="_blank"
                  rel="noreferrer"
                >
                  Documentação OSRM
                </a>
                <p>
                  A reprodução acompanha os caminhos de cada trecho retornado
                  pelo OSRM, com distância em metros do provedor. A velocidade
                  visual de 8 m/s é constante e ilustrativa; não é uma previsão
                  de chegada. A distância total por rota pode diferir da soma
                  dos trechos por arredondamento do OSRM.
                </p>
                {preview?.projection && (
                  <small>
                    {preview.projection.name} · {preview.projection.target_crs}{" "}
                    · hash {hash.slice(0, 12)}
                  </small>
                )}
              </details>

              {run && !active && (
                <div className="geo-actions">
                  <button
                    onClick={() =>
                      imported
                        ? downloadJson(
                            "vrp-simulation-replay-geografico.json",
                            replayFile,
                          )
                        : void api(`/runs/${run.id}/export`)
                            .then((data) =>
                              downloadJson(`vrp-simulation-${run.id}.json`, data),
                            )
                            .catch((e) => setError(e.message))
                    }
                  >
                    <Download size={14} />
                    Exportar replay
                  </button>
                  {!imported && (
                    <>
                      <a
                        href={`/api/runs/${run.id}/export?format=csv`}
                        download
                      >
                        Estatísticas CSV
                      </a>
                      <a
                        href={`/api/runs/${run.id}/export?format=sol`}
                        download
                      >
                        Rotas .sol
                      </a>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="geo-run-actions">
            {" "}
            {capacityIssue && (
              <p className="geo-alert" role="alert">
                {capacityIssue}
              </p>
            )}
            {(preparationPhase || (active && !networkError && run.request.instance.road_matrix)) && (
              <RunProgress phase={preparationPhase ?? (run?.status === "queued" ? "queued" : "running")} />
            )}
            {previewBusy && !preparationPhase && (
              <p role="status">Validando cenário e construindo baseline…</p>
            )}
            {preview?.issues.map((issue) => (
              <p className="geo-alert" role="alert" key={issue}>
                {issue}
              </p>
            ))}
              {draft.depot && !ready(draft) && (
              <p className="geo-note">
                Inclua pelo menos duas entregas para otimizar.
              </p>
            )}

          </div>
        </aside>
        <section
          className={`geo-stage ${!manual && view !== "compare" && (pendingDepot || pending || selectedPoint) ? "editing-point" : ""}`}
          aria-label="Área do mapa"
        >
          <div className="geo-mapbar">
            <button
              className="geo-panel-toggle"
              aria-label={
                panelOpen
                  ? "Recolher painel do cenário"
                  : "Abrir painel do cenário"
              }
              aria-expanded={panelOpen}
              onClick={() => setPanelOpen((v) => !v)}
            >
              <PanelLeft size={18} />
            </button>
            {(baseline || best) && <div
              className="geo-view-tabs"
              role="group"
              aria-label="Visualização das rotas"
            >
              <button
                aria-pressed={view === "baseline" || view === "optimized"}
                onClick={() => setView(best ? "optimized" : "baseline")}
              >
                Solução atual
              </button>
              {best?.feasible && baseline?.feasible && <button
                ref={compareButton}
                aria-pressed={view === "compare"}
                onClick={() => {
                  freeze();
                  setView("compare");
                }}
              >
                Comparar rotas
              </button>}
            </div>}

            <div
              className="geo-toolbar"
              role="toolbar"
              aria-label="Ferramentas do mapa"
            >
              <button
                hidden={panelOpen && panel === "deliveries"}
                aria-label="Pesquisar endereço"
                title="Pesquisar endereço"
                aria-expanded={searchOpen}
                onClick={() => {
                  setSearchOpen((value) => !value);
                  setPending(null);
                  setSelected(null);
                }}
              >
                <Search size={17} />
                <span className="geo-search-label">
                  Pesquisar endereço ou lugar
                </span>
              </button>
              <button
                className="geo-create-point"
                hidden={panelOpen && panel === "deliveries"}
                disabled={locked || !!manual}
                aria-label={
                  draft.depot ? "Adicionar cliente" : "Definir depósito"
                }
                title={draft.depot ? "Adicionar cliente" : "Definir depósito"}
                aria-pressed={tool === "add-client" || tool === "set-depot"}
                onClick={() => {
                  switchTool(draft.depot ? "add-client" : "set-depot");
                  setSelected(null);
                }}
              >
                <Plus size={17} />
                <span>
                  {draft.depot ? "Adicionar cliente" : "Definir depósito"}
                </span>
              </button>
              <button
                hidden={!undo.length}
                aria-label="Desfazer última ação"
                title="Desfazer última ação"
                disabled={locked || !undo.length}
                onClick={() => {
                  const previous = undo[undo.length - 1];
                  setUndo((h) => h.slice(0, -1));
                  commit(previous, false);
                  setSelected(null);
                }}
              >
                <Undo2 size={17} />
              </button>
              <button
                aria-label="Ajustar visualização"
                title="Ajustar visualização"
                onClick={() => setFit((v) => v + 1)}
              >
                <Scan size={17} />
              </button>
              <button
                aria-label={expandedMap ? "Reduzir mapa" : "Ampliar mapa"}
                title={expandedMap ? "Reduzir mapa" : "Ampliar mapa"}
                aria-pressed={expandedMap}
                onClick={() => setExpandedMap((value) => !value)}
              >
                {expandedMap ? (
                  <Minimize2 size={17} />
                ) : (
                  <Maximize2 size={17} />
                )}
              </button>
            </div>
          </div>
          <div className="geo-map-search" hidden={!searchOpen}>
            <PlaceSearch
              disabled={locked || !!manual}
              onPlace={(point) => {
                setFocus({ point, zoom: draft.depot ? undefined : 15, serial: Date.now() });
                setSearchOpen(false);
                pointPicked(point);
              }}
            />
          </div>
          {(!draft.depot ||
            tool === "set-depot" ||
            tool === "add-client" ||
            !!manual) && (
            <div className="geo-map-hint" role="status" key={`${tool}-${draft.clients.length}-${workflow.title}`}>
              {mapInstruction}
              <button
                hidden={!draft.depot && tool === "navigate"}
                aria-label="Encerrar adição"
                onClick={() => {
                  setTool("navigate");
                  setPending(null);
                }}
              >
                <X size={14} />
              </button>
            </div>
          )}
          <div className="geo-map-area">
            {draft.depot && !pending && !pendingDepot && !selectedPoint && (
              <details className="wb-map-legend">
                <summary>Camadas do mapa</summary>
                <label><input type="checkbox" checked={showDepot} onChange={e => setShowDepot(e.target.checked)} /><Star size={13} />Depósito</label>
                <label><input type="checkbox" checked={showClients} onChange={e => setShowClients(e.target.checked)} /><Circle size={12} />Clientes</label>
                {(displayed ?? baseline)?.routes.map(route => <label key={route.vehicle}><input type="checkbox" checked={!hiddenVehicles.has(route.vehicle)} onChange={e => setHiddenVehicles(previous => { const next = new Set(previous); if (e.target.checked) next.delete(route.vehicle); else next.add(route.vehicle); return next; })} /><i style={{ background: colour(route.vehicle) }} />Rota {route.vehicle}<span>({route.visits.length})</span></label>)}
              </details>
            )}
            <div
              className={`geo-map-grid ${view === "compare" ? "comparing" : ""}`}
            >
              {view === "compare" && (
                <div>
                  <div className="geo-map-caption">
                    Baseline · {costLabel} {distance(baseline?.cost_ticks)} m
                  </div>
                  <OpenStreetMap
                    {...commonMap}
                    solution={baseline}
                    tool="navigate"
                    pending={null}
                    manual={null}
                    locked
                    label="Mapa da baseline"
                  />
                </div>
              )}
              <div>
                {(view === "compare" || active || mapWaiting) && (
                  <div className="geo-map-caption" data-testid="live-map-state">
                    {mapSolution ? `Mapa: ${distance(mapSolution.cost_ticks)} m${mapCheckpoint ? ` · estado aos ${mapCheckpoint.elapsed.toFixed(2)} s` : " · plano inicial"}` : "Carregando rotas pelas ruas…"}
                    {mapWaiting && mapSolution && " · atualizando o traçado"}
                  </div>
                )}
                <OpenStreetMap
                  {...commonMap}
                  solution={manual ? displayed : mapSolution}
                  comparison={showChanges ? baseline : null}
                  tool={tool}
                  pending={pendingDepot ?? pending}
                  manual={manual}
                  locked={locked || view === "compare"}
                  label="Mapa do cenário geográfico"
                  editorPoint={
                    !manual && view !== "compare"
                      ? (pendingDepot ?? pending ?? selectedPoint)
                      : null
                  }
                  editor={!manual && view !== "compare" ? pointEditor : null}
                  onCloseEditor={() => {
                    setPending(null);
                    setPendingDepot(null);
                    setSelected(null);
                  }}
                />
              </div>
            </div>
          </div>
          <div className="geo-map-status">
            {active && <span role="status" data-testid="live-search-status">
              {latestSample ? `Busca: ${latestSample.elapsed.toFixed(2)} s · ${latestSample.iteration != null ? `${latestSample.iteration} iterações` : `${latestSample.observed ?? 0} soluções observadas`} · melhor ${distance(latestSample.best_cost_ticks)} m` : "Aguardando o primeiro estado do solver…"}
            </span>}
            {roadCount > 0 && (
              <span role="status" data-testid="road-status">
                {roadBusy
                  ? "Consultando ruas no OSRM…"
                  : "Traçado pelas ruas"}
                {` · ${loadedRoadCount}/${roadCount} sequências carregadas`}
              </span>
            )}
            <button
              hidden={!draft.road_matrix}
              onClick={() => {
                setPanel("results");
                setPanelOpen(true);
              }}
            >
              Custo: {costLabel} <span aria-hidden="true">↗</span>
            </button>
          </div>
          {roadError && (
            <div className="geo-road-error" role="alert">
              <p>
                Não foi possível carregar todas as rotas pelas ruas. {roadError}
              </p>
              <button onClick={retryRoads} disabled={roadBusy}>
                Tentar traçado novamente
              </button>
            </div>
          )}
        </section>
        {analysisMode && !panelOpen && <ResultsOverview baseline={baseline} best={best} run={run} samples={samples} checkpoints={checkpoints}
          onDetails={() => { setPanel("results"); setPanelOpen(true); }}
          onPrepare={() => {
            navigateWorkspace("instance");
          }} />}
      </main>
      {analysisMode && checkpoints.length > 0 && <details className="wb-replay-host" ref={replayPanel}>
        <summary>Explorar estados da busca <span>{checkpoints.length} registros</span></summary>
        <SearchReplay checkpoints={checkpoints} index={follow ? Math.max(0, followIndex) : index}
          onSeek={(next) => { setFollow(false); setIndex(next); setView("optimized"); simulation.stop(); }}
          active={active} solution={displayed} baseline={baseline} draft={draft} selectedVehicle={vehicle}
          onVehicle={setVehicle} showChanges={showChanges} onChanges={setShowChanges}>
          {displayed && !manual && (
            <section className="geo-playback">
              <div className="geo-actions">
                <button
                  aria-label="Reproduzir rotas"
                  onClick={() => {
                    freeze();
                    simulation.play();
                  }}
                  disabled={simulation.playing || !roadsReady}
                >
                  <Play size={14} />
                  <span>Reproduzir rotas</span>
                </button>
                <button
                  aria-label="Pausar"
                  onClick={simulation.pause}
                  disabled={!simulation.playing}
                >
                  <Pause size={14} />
                  <span>Pausar</span>
                </button>
                <button
                  onClick={simulation.stop}
                  disabled={!roadsReady}
                  aria-label="Reiniciar reprodução"
                >
                  <Square size={14} />
                  <span>Reiniciar</span>
                </button>
                <button
                  aria-label="Próxima parada"
                  disabled={!roadsReady}
                  onClick={() => {
                    freeze();
                    simulation.next();
                  }}
                >
                  <SkipForward size={14} />
                  <span>Próxima parada</span>
                </button>
                <label>
                  Velocidade
                  <select
                    value={simulation.speed}
                    onChange={(e) => simulation.setSpeed(+e.target.value)}
                  >
                    {[1, 4, 16, 64].map((s) => (
                      <option key={s} value={s}>
                        {s}×
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <PlaybackPosition
                clock={simulation.clock}
                maximum={simulation.maximum}
                pause={simulation.pause}
                seek={simulation.seek}
              />
              <span className="geo-playback-label">
                {roadsReady
                  ? "Reprodução ilustrativa · ruas OSRM · 8 m/s × velocidade"
                  : "Aguardando os trechos do OSRM"}
              </span>
            </section>
          )}
        </SearchReplay>
      </details>}
    </div>
  );
}
