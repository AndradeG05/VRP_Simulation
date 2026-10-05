import { vehicleCapacity } from "./types";
import { graphNodeId } from "./graphPlane";
import { useEffect, useRef, useState } from "react";
import { Metric, NumberField } from "./LaboratoryControls";
import { Button } from "./carbon/components";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  Box,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Download,
  FlaskConical,
  History as HistoryIcon,
  Layers,
  Maximize2,
  Minimize2,
  MousePointer2,
  Pause,
  Play,
  RotateCcw,
  Route as RouteIcon,
  Settings2,
  Shuffle,
  Square,
  Trash2,
  Truck,
  Upload,
  X,
} from "./carbon/icons";
import { api, downloadJson, improvement, integer, distance } from "./api";
import { isGeographic } from "./geo/model";
import { assertInstanceSize, MAX_CLIENTS, MAX_VEHICLES } from "./limits";
import PointEditor from "./PointEditor";
import Dialog from "./Dialog";
import ManualPlan from "./ManualPlan";
import { routeDifference } from "./differences";
import { mergeEvents, hasSequenceGap } from "./events";
import RouteMap, { colours } from "./RouteMap";
import type { GraphView } from "./graphLayout";
import Convergence from "./Convergence";
import { useSimulation } from "./simulation";
import FleetPanel from "./FleetPanel";
import PlaybackPosition from "./PlaybackPosition";
import type {
  Checkpoint,
  Config,
  Generator,
  History,
  Instance,
  Preview,
  Run,
  RunEvent,
  Sample,
  Solution,
  Status,
} from "./types";

const defaults: Generator = {
  customers: 40,
  vehicles: 5,
  capacity: 60,
  seed: 42,
  distribution: "clustered",
  max_demand: 9,
};
const solverDefaults: Config = {
  adapter: "ortools",
  seed: 7,
  stop: "iterations",
  max_iterations: 5000,
  time_limit: 5,
  sample_every: 25,
};
const statusNames: Record<Status, string> = {
  queued: "Preparando",
  running: "Otimizando",
  completed: "Concluído",
  cancelled: "Cancelado",
  no_solution: "Nenhuma solução viável encontrada",
  failed: "Falha na execução",
  interrupted: "Interrompido",
};
const running = (run: Run | null) =>
  !!run && ["queued", "running"].includes(run.status);
const badge = (id: number) => colours[(id - 1) % colours.length];
const formatTime = (v: number) => v.toFixed(2) + " s";
const nodeName = (id: number) =>
  id === 0 ? "Depósito" : "C" + id.toString().padStart(2, "0");
interface AppProps {
  incomingFile?: File;
  incomingRun?: string;
  onGeographicFile: (file: File) => void;
  onGeographicRun: (id: string) => void;
  onBusy: (busy: boolean) => void;
}
export default function App({
  incomingFile,
  incomingRun,
  onGeographicFile,
  onGeographicRun,
  onBusy,
}: AppProps) {
  const [generator, setGenerator] = useState<Generator>(defaults);
  const [config, setConfig] = useState<Config>(solverDefaults);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [mode, setMode] = useState<
    "problem" | "baseline" | "optimized" | "compare"
  >("baseline");
  const [controlsOpen, setControlsOpen] = useState(true);
  const [manual, setManual] = useState(false);
  const [experience, setExperience] = useState<"lab" | "manual" | "capacity">(
    "lab",
  );
  const [reference, setReference] = useState<{
    instance: Instance;
    solution: Solution;
    hash: string;
  } | null>(null);
  const [camera, setCamera] = useState({ x: 0, y: 0, k: 1 });
  const [showDiff, setShowDiff] = useState(false);
  const [overlay, setOverlay] = useState(false);
  const [imported, setImported] = useState(false);
  const [capacityDraft, setCapacityDraft] = useState(60);
  const [fleetDraft, setFleetDraft] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<
    "online" | "offline" | "loading"
  >("loading");
  const [selectedRoute, setSelectedRoute] = useState<number | null>(null);
  const [selectedClient, setSelectedClient] = useState<number | null>(null);
  const [labels, setLabels] = useState(true);
  const [graphView, setGraphView] = useState<GraphView>("distributed");
  const [editing, setEditing] = useState(false);
  const [follow, setFollow] = useState(true);
  const [comparisonSnapshot, setComparisonSnapshot] = useState<Solution | null>(
    null,
  );
  const [checkpointIndex, setCheckpointIndex] = useState(0);
  const [replay, setReplay] = useState(false);
  const [presentation, setPresentation] = useState(false);
  const [modal, setModal] = useState<"help" | "history" | null>(null);
  const [history, setHistory] = useState<History[]>([]);
  const [cancelPending, setCancelPending] = useState(false);
  const [pollRetry, setPollRetry] = useState(0);
  const [vrpImport, setVrpImport] = useState<{text: string; filename: string; preview?: Preview} | null>(null);
  const [vrpVehicles, setVrpVehicles] = useState("");
  const [vrpError, setVrpError] = useState("");
  const declaredVrpVehicles = vrpImport?.preview?.instance.vehicles.toString();
  const fileInput = useRef<HTMLInputElement>(null);
  const active = running(run),
    locked = active || busy;
  useEffect(() => {
    onBusy(locked);
  }, [locked, onBusy]);
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
  const instance = preview?.instance,
    baseline = preview?.baseline ?? null;
  const index = follow
    ? Math.max(0, checkpoints.length - 1)
    : Math.min(checkpointIndex, Math.max(0, checkpoints.length - 1));
  const checkpoint = checkpoints[index];
  const best =
    run?.result?.solution ??
    checkpoints.reduce<Solution | null>(
      (b, c) => (!b || c.solution.cost_ticks < b.cost_ticks ? c.solution : b),
      null,
    );
  const selectedSolution = checkpoint?.solution ?? best;
  const displayed =
    mode === "problem"
      ? null
      : mode === "baseline"
        ? baseline
        : mode === "compare"
          ? (comparisonSnapshot ?? best)
          : selectedSolution;
  const simulation = useSimulation(
    instance,
    displayed,
    mode === "compare" ? baseline : null,
  );
  const previousSolution = index > 0 ? checkpoints[index - 1].solution : null;
  const diff = routeDifference(previousSolution, selectedSolution);
  const percent = improvement(
    baseline?.feasible ? baseline.cost_ticks : null,
    best?.cost_ticks,
  );
  const latest = samples[samples.length - 1];
  const isOrtools =
    (run?.request.config.adapter ?? config.adapter) === "ortools";
  const iterations = isOrtools
    ? (run?.result?.observed_solutions ?? latest?.observed ?? 0)
    : (run?.result?.iterations ?? latest?.iteration ?? 0);
  const runtime = run?.result?.solver_runtime ?? latest?.elapsed ?? 0;
  const client = instance?.clients.find((c) => c.id === selectedClient);
  const selectedPoint = selectedClient === 0 ? instance?.depot : client;
  const originalCoordinates = selectedClient === null
    ? undefined
    : instance?.vrp?.coordinates?.[selectedClient];
  const selectedCoordinates = originalCoordinates ?? (
    selectedPoint ? [selectedPoint.x, selectedPoint.y] : null
  );
  const coordinateText = (value: number) => instance?.vrp && !originalCoordinates
    ? Number(value.toFixed(3))
    : value;
  const clientRoute = displayed?.routes.find((r) =>
    r.visits.includes(selectedClient ?? -1),
  );
  const capacityUse =
    instance && displayed?.routes.length
      ? (displayed.routes.reduce((s, r) => s + r.load, 0) /
          displayed.routes.reduce(
            (total, r) => total + vehicleCapacity(instance, r.vehicle),
            0,
          )) *
        100
      : null;
  const hasExecution = !!run || samples.length > 0 || checkpoints.length > 0;
  const workflow =
    connection === "offline"
      ? {
          title: "Conecte o solver",
          detail: "A API local não respondeu. Verifique se ela está em execução e tente novamente.",
        }
      : connection === "loading" && !instance
        ? {
            title: "Conectando o solver",
            detail: "Preparando a instância inicial.",
          }
        : !instance
          ? {
              title: "Gere uma instância",
              detail: "Defina os parâmetros essenciais e crie o cenário para começar.",
            }
          : preview?.issues.length
            ? {
                title: "Ajuste a capacidade",
                detail: "Corrija as restrições indicadas antes de iniciar a busca.",
              }
            : active
              ? {
                  title: "Busca em andamento",
                  detail: "As melhorias aparecem à medida que o solver registra soluções.",
                }
              : run?.status === "completed"
                ? {
                    title: "Solução disponível",
                    detail: "Compare a solução com o ponto de partida ou explore as rotas.",
                  }
                : run
                  ? {
                      title: statusNames[run.status],
                      detail: "Ajuste o cenário ou execute uma nova busca quando estiver pronto.",
                    }
                  : {
                      title: "Cenário pronto",
                      detail: "Escolha o orçamento da busca e otimize as rotas.",
                    };
  function freezePlayback() {
    setFollow(false);
    setCheckpointIndex(index);
    setReplay(false);
    if (mode === "compare") setComparisonSnapshot(displayed);
  }
  function clearExperiment() {
    setComparisonSnapshot(null);
    setImported(false);
    setRun(null);
    setSamples([]);
    setCheckpoints([]);
    setSelectedRoute(null);
    setSelectedClient(null);
    setFollow(true);
    setCheckpointIndex(0);
    setReplay(false);
    simulation.stop();
    setCancelPending(false);
  }
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      api("/health", undefined, controller.signal),
      incomingFile || incomingRun
        ? Promise.resolve(null)
        : api<Preview>("/instances/generate", defaults, controller.signal),
    ])
      .then(([, result]) => {
        if (result) setPreview(result);
        setConnection("online");
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(
            "Não foi possível conectar ao solver local. Verifique se a API está em execução e tente novamente.",
          );
          setConnection("offline");
        }
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!run || imported) return;
    const id = run.id,
      controller = new AbortController();
    let retained: RunEvent[] = [];
    let recovered = false;
    let cursor = 0,
      timer: ReturnType<typeof setTimeout>,
      retries = 0;
    setSamples([]);
    setCheckpoints([]);
    const poll = async () => {
      try {
        let page: {
          events: RunEvent[];
          cursor: number;
          has_more: boolean;
          status: Status;
        };
        do {
          page = await api(
            "/runs/" + id + "/events?after=" + cursor,
            undefined,
            controller.signal,
          );
          if (controller.signal.aborted) return;
          const merged = mergeEvents(retained, page.events, id);
          if (hasSequenceGap(merged)) {
            if (recovered)
              throw new Error(
                "Lacuna persistente no histórico; recarregue a execução.",
              );
            recovered = true;
            cursor = 0;
            retained = [];
            setSamples([]);
            setCheckpoints([]);
            timer = setTimeout(poll, 0);
            return;
          }
          const fresh = merged.filter(
            (e) => !retained.some((old) => old.id === e.id),
          );
          retained = merged;
          cursor = page.cursor;
          const metrics = fresh
            .filter(
              (e): e is Extract<RunEvent, { kind: "sample" }> =>
                e.kind === "sample",
            )
            .map((e) => e.payload);
          const snapshots = fresh
            .filter(
              (e): e is Extract<RunEvent, { kind: "checkpoint" }> =>
                e.kind === "checkpoint",
            )
            .map((e) => e.payload);
          if (metrics.length) setSamples((prev) => [...prev, ...metrics]);
          if (snapshots.length)
            setCheckpoints((prev) => [...prev, ...snapshots]);
        } while (page.has_more);
        const current = await api<Run>(
          "/runs/" + id,
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setRun(current);
        setConnection("online");
        retries = 0;
        if (current.error) setError(current.error);
        if (running(current) || ["queued", "running"].includes(page.status))
          timer = setTimeout(poll, 400);
      } catch (e) {
        if (controller.signal.aborted) return;
        setConnection("offline");
        retries++;
        if (retries <= 5)
          timer = setTimeout(poll, Math.min(1000 * retries, 5000));
        else
          setError(
            "Conexão interrompida. Use Reconectar para recuperar os eventos persistidos. " +
              (e as Error).message,
          );
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [run?.id, pollRetry, imported]);
  useEffect(() => {
    if (!replay || !checkpoints.length) return;
    const timer = setInterval(
      () =>
        setCheckpointIndex((i) => {
          if (i >= checkpoints.length - 1) {
            setReplay(false);
            return i;
          }
          return i + 1;
        }),
      850,
    );
    return () => clearInterval(timer);
  }, [replay, checkpoints.length]);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (
        e.key === "Delete" &&
        editing &&
        selectedClient &&
        !locked &&
        !(e.target instanceof HTMLInputElement)
      )
        removeClient();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  });
  async function generate() {
    setBusy(true);
    setError("");
    try {
      if (!Number.isSafeInteger(generator.customers) || generator.customers < 2 || generator.customers > MAX_CLIENTS)
        throw new Error(`Informe de 2 a ${MAX_CLIENTS} clientes.`);
      assertInstanceSize({ clients: [], vehicles: generator.vehicles });
      const result = await api<Preview>("/instances/generate", generator);
      clearExperiment();
      setReference(null);
      setPreview(result);
      setMode("baseline");
      setConnection("online");
    } catch (e) {
      setError(
        "Não foi possível gerar a instância. Confira os parâmetros e tente novamente. " +
          (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  async function reconnect() {
    setBusy(true);
    setError("");
    try {
      await api("/health");
      setConnection("online");
      if (run) {
        setPollRetry((n) => n + 1);
      } else if (!preview) {
        const result = await api<Preview>("/instances/generate", generator);
        clearExperiment();
        setReference(null);
        setPreview(result);
        setMode("baseline");
      }
    } catch {
      setConnection("offline");
      setError(
        "Não foi possível conectar ao solver local. Verifique se a API está em execução e tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function edit(next: Instance) {
    if (locked) return;
    setBusy(true);
    setError("");
    try {
      assertInstanceSize(next);
      const result = await api<Preview>("/instances/preview", {
        ...next,
        generator_seed: null,
        distribution: "custom",
      });
      clearExperiment();
      setPreview(result);
      setMode("baseline");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function removeClient() {
    if (instance?.vrp) return;
    if (!instance || !selectedClient || instance.clients.length <= 2) return;
    void edit({
      ...instance,
      clients: instance.clients
        .filter((c) => c.id !== selectedClient)
        .map((c, i) => ({ ...c, id: i + 1 })),
    });
  }
  async function optimize() {
    if (!instance) return;
    setBusy(true);
    setError("");
    simulation.stop();
    setEditing(false);
    try {
      const result = await api<Run>("/runs", {
        instance,
        config: {
          ...config,
          stop: config.adapter === "ortools" ? "time" : config.stop,
        },
        initial_origin: baseline?.origin === "manual" ? "manual" : "library",
        initial_routes:
          baseline?.routes.reduce<number[][]>(
            (all, r) => {
              all[r.vehicle - 1] = r.visits;
              return all;
            },
            Array.from({ length: instance.vehicles }, () => []),
          ) ?? null,
      });
      clearExperiment();
      setRun(result);
      setPreview((p) => (p ? { ...p, baseline: result.baseline } : p));
      setMode("optimized");
      setConnection("online");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!run) return;
    setCancelPending(true);
    try {
      await api("/runs/" + run.id + "/cancel", {});
    } catch (e) {
      setCancelPending(false);
      setError((e as Error).message);
    }
  }
  function loadPreview(result: Preview) {
    setPreview(result);
    setGenerator((g) => ({
      ...g,
      customers: result.instance.clients.length,
      vehicles: result.instance.vehicles,
      capacity: result.instance.capacity,
    }));
    setCapacityDraft(result.instance.capacity);
    setFleetDraft(result.instance.vehicles);
  }
  async function importFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      if (file.size > 25000000) throw new Error("Arquivo maior que 25 MB.");
      const text = await file.text();
      if (/\.vrp$/i.test(file.name)) {
        const source = { text, filename: file.name };
        setVrpImport(source);
        setVrpVehicles("");
        setVrpError("");
        try {
          const importedPreview = await api<Preview>("/instances/import-vrp", source);
          setVrpImport({ ...source, preview: importedPreview });
        } catch (e) {
          setVrpError((e as Error).message);
        }
        return;
      }
      const data = JSON.parse(text);
      assertInstanceSize(data.request?.instance ?? data.instance ?? data);
      if (isGeographic(data.request?.instance ?? data.instance ?? data)) {
        onGeographicFile(file);
        return;
      }
      if (
        data.schema_version === 1 &&
        Array.isArray(data.events) &&
        data.request
      ) {
        const replay = await api<{
          run: Run;
          events: RunEvent[];
          preview: Preview;
        }>("/replays/validate", data);
        clearExperiment();
        loadPreview(replay.preview);
        setRun(replay.run);
        setConfig(replay.run.request.config);
        setImported(true);
        setSamples(
          replay.events
            .filter(
              (e): e is Extract<RunEvent, { kind: "sample" }> =>
                e.kind === "sample",
            )
            .map((e) => e.payload),
        );
        setCheckpoints(
          replay.events
            .filter(
              (e): e is Extract<RunEvent, { kind: "checkpoint" }> =>
                e.kind === "checkpoint",
            )
            .map((e) => e.payload),
        );
        setMode("optimized");
        return;
      }
      const result = await api<Preview>(
        "/instances/preview",
        data.request?.instance ?? data.instance ?? data,
      );
      clearExperiment();
      loadPreview(result);
      setMode("baseline");
    } catch (e) {
      setError("Falha ao importar: " + (e as Error).message);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function openHistory() {
    try {
      setHistory(await api<History[]>("/runs"));
      setModal("history");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function restore(id: string) {
    setBusy(true);
    setError("");
    try {
      const saved = await api<Run>("/runs/" + id);
      if (isGeographic(saved.request.instance)) {
        onGeographicRun(id);
        setModal(null);
        return;
      }
      const restored = await api<Preview>(
        "/instances/preview",
        saved.request.instance,
      );
      clearExperiment();
      loadPreview(restored);
      setConfig(saved.request.config);
      setRun(saved);
      setMode("optimized");
      setModal(null);
      setPreview((p) => (p ? { ...p, baseline: saved.baseline } : p));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function preset(name: "fast" | "balanced" | "deep") {
    setConfig((c) => ({
      ...c,
      stop: "iterations",
      max_iterations:
        name === "fast" ? 500 : name === "balanced" ? 5000 : 30000,
      time_limit: name === "fast" ? 1 : name === "balanced" ? 5 : 30,
    }));
  }
  const mapProps = instance
    ? {
        instance,
        selectedRoute,
        selectedClient,
        onRoute: setSelectedRoute,
        onClient: setSelectedClient,
        showLabels: labels,
        graphView,
        camera,
        onCamera: setCamera,
        editing: editing && !locked,
        onAdd: (x: number, y: number) => {
          if (instance.clients.length >= MAX_CLIENTS) {
            setError(`O cenário aceita no máximo ${MAX_CLIENTS} clientes.`);
            return;
          }
          void edit({
            ...instance,
            clients: [
              ...instance.clients,
              {
                id: instance.clients.length + 1,
                x: Number(x.toFixed(3)),
                y: Number(y.toFixed(3)),
                demand: 1,
              },
            ],
          });
        },
        onMove: (id: number, x: number, y: number) => {
          const p = { x: Number(x.toFixed(3)), y: Number(y.toFixed(3)) };
          void edit(
            id === 0
              ? { ...instance, depot: p }
              : {
                  ...instance,
                  clients: instance.clients.map((c) =>
                    c.id === id ? { ...c, ...p } : c,
                  ),
                },
          );
        },
      }
    : null;
  return (
    <div className={"app-shell " + (presentation ? "presentation" : "")}
      onClick={e => {
        const target = e.target as Element;
        if (target.closest("button, a, input, select, textarea, label, summary, canvas, .client-inspector, .route-detail, table")) return;
        setSelectedRoute(null);
        setSelectedClient(null);
        setCamera({x:0,y:0,k:1});
      }}>
      <header className="app-header">
        <div className="app-title">
          <h1>Cenário sintético</h1>
          <p id="synthetic-workflow" aria-live="polite">
            <strong>{workflow.title}.</strong> {workflow.detail}
          </p>
        </div>
        <nav>
          <span className={"connection " + connection} title={connection === "online" ? "Solver conectado" : connection === "loading" ? "Conectando ao solver" : "Sem conexão com o solver"}>
            <i />
            {connection === "online"
              ? "Solver conectado"
              : connection === "loading"
                ? "Conectando"
                : "Sem conexão"}
          </span>
          <button
            className="icon-button secondary-control"
            onClick={() => void openHistory()}
            title="Histórico"
            aria-label="Histórico"
          >
            <HistoryIcon size={18} />
          </button>
          <button
            className="icon-button"
            onClick={() => setPresentation((p) => !p)}
            title="Modo apresentação"
            aria-label="Modo apresentação"
          >
            {presentation ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <button
            className="icon-button secondary-control"
            onClick={() => setModal("help")}
            title="Sobre o laboratório"
            aria-label="Sobre o laboratório"
          >
            <CircleHelp size={18} />
          </button>
        </nav>
      </header>
      {error && !(connection === "offline" && !instance) && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          {connection === "offline" && (
            <button
              onClick={() => {
                void reconnect();
              }}
            >
              Reconectar
            </button>
          )}
          <button aria-label="Fechar aviso" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      <div className="experience-tabs">
        {(["lab", "manual", "capacity"] as const).map((e, i) => (
          <button
            disabled={locked}
            key={e}
            aria-pressed={experience === e}
            className={experience === e ? "selected" : ""}
            onClick={() => {
              setExperience(e);
              setManual(e === "manual");
            }}
          >
            {
              [
                "Laboratório de rotas",
                "Minha rota versus busca",
                "Experimento de capacidade",
              ][i]
            }
          </button>
        ))}
      </div>
      {experience === "capacity" && instance && (
        <section className="capacity-experiment">
          <h3>Experimento de capacidade</h3>
          <p>
            Guarde o resultado atual, duplique os clientes e altere a frota ou
            capacidade. Custos de problemas distintos são comparados sem
            percentual de melhoria.
          </p>
          <div className="manual-tools">
            <button
              className="button"
              disabled={!best || locked}
              onClick={() => {
                if (best) {
                  setReference({
                    instance,
                    solution: best,
                    hash: preview!.hash,
                  });
                  setCapacityDraft(instance.capacity);
                  setFleetDraft(instance.vehicles);
                }
              }}
            >
              Guardar como cenário A
            </button>
            <NumberField
              label="Capacidade B"
              value={capacityDraft}
              min={1}
              max={10000}
              onChange={setCapacityDraft}
            />
            <NumberField
              label="Frota B"
              value={fleetDraft}
              min={1}
              max={MAX_VEHICLES}
              onChange={setFleetDraft}
            />
            <button
              className="button"
              disabled={!reference || locked}
              onClick={() => {
                if (reference)
                  void edit({
                    ...reference.instance,
                    name: "Cenário B · capacidade",
                    capacity: capacityDraft,
                    fleet: null,
                    vehicles: fleetDraft,
                  });
              }}
            >
              Criar cenário B
            </button>
          </div>
          {reference && (
            <div className="capacity-results">
              <span>
                A · capacidade {reference.instance.capacity} · frota{" "}
                {reference.instance.vehicles} ·{" "}
                {distance(reference.solution.cost_ticks)} u.d.
              </span>
              <span>
                B · capacidade {instance.capacity} · frota {instance.vehicles} ·{" "}
                {reference.hash !== preview?.hash
                  ? distance(best?.cost_ticks)
                  : "aguardando outro problema"}{" "}
                u.d.
              </span>
            </div>
          )}
        </section>
      )}
      {manual && instance && (
        <ManualPlan
          locked={locked}
          key={preview?.hash}
          instance={instance}
          baseline={baseline}
          onClose={() => setManual(false)}
          onUse={(solution) => {
            clearExperiment();
            setPreview((p) => (p ? { ...p, baseline: solution } : p));
            setMode("baseline");
            setManual(false);
          }}
        />
      )}
      <button
        className="controls-toggle button"
        aria-controls="synthetic-controls"
        aria-expanded={controlsOpen}
        onClick={() => setControlsOpen((v) => !v)}
      >
        {controlsOpen ? "Recolher parâmetros" : "Exibir parâmetros"}
      </button>
      <main
        className={"lab-layout " + (!controlsOpen ? "controls-collapsed" : "") + (!instance ? " awaiting-instance" : "")}
      >
        <aside className="control-panel" id="synthetic-controls">
          <section>
            <div className="section-title">
              <span>
                <Settings2 size={15} /> Instância
              </span>
            </div>
            {instance?.vrp && (
              <p className="field-hint" role="status">
                {instance.name} · {instance.clients.length + 1} pontos ({instance.clients.length} clientes + 1 depósito)
              </p>
            )}
            <fieldset disabled={locked}>
              <label className="full-field">
                Distribuição
                <select
                  aria-label="Distribuição"
                  value={generator.distribution}
                  onChange={(e) =>
                    setGenerator((g) => ({
                      ...g,
                      distribution: e.target.value as Generator["distribution"],
                    }))
                  }
                >
                  <option value="clustered">Agrupamentos</option>
                  <option value="uniform">Uniforme</option>
                  <option value="ring">Anel</option>
                </select>
              </label>
              <NumberField
                label="Clientes"
                value={generator.customers}
                min={2}
                max={MAX_CLIENTS}
                onChange={(customers) =>
                  setGenerator((g) => ({ ...g, customers }))
                }
              />
              <NumberField
                label="Veículos disponíveis"
                value={generator.vehicles}
                min={1}
                max={MAX_VEHICLES}
                onChange={(vehicles) =>
                  setGenerator((g) => ({ ...g, vehicles }))
                }
              />
              <NumberField
                label="Capacidade / veículo"
                value={generator.capacity}
                min={1}
                max={10000}
                onChange={(capacity) =>
                  setGenerator((g) => ({ ...g, capacity }))
                }
              />
              <NumberField
                label="Demanda máx. (mín. 1)"
                value={generator.max_demand}
                min={1}
                max={100}
                onChange={(max_demand) =>
                  setGenerator((g) => ({ ...g, max_demand }))
                }
              />
              <NumberField
                label="Seed da instância"
                value={generator.seed}
                max={4294967295}
                onChange={(seed) => setGenerator((g) => ({ ...g, seed }))}
              />
              <Button icon={<Shuffle size={16} />}
                className="button generate-button"
                aria-describedby="synthetic-workflow"
                disabled={locked || connection !== "online"}
                onClick={() => void generate()}
              >
                Gerar instância
              </Button>
            </fieldset>
            <button
              className={"button edit-button " + (editing ? "selected" : "")}
              disabled={locked || !instance || !!instance.vrp}
              onClick={() => {
                setGraphView("coordinates");
                setCamera({ x: 0, y: 0, k: 1 });
                setEditing((e) => !e);
                simulation.stop();
                setMode("problem");
              }}
            >
              <MousePointer2 size={14} />
              {editing ? "Finalizar edição" : "Editar no plano"}
            </button>
            {editing && instance && (
              <>
                <label className="full-field">
                  Cliente para editar
                  <select
                    aria-label="Cliente para editar"
                    value={selectedClient ?? ""}
                    onChange={(e) => setSelectedClient(Number(e.target.value))}
                  >
                    <option value="">Selecionar cliente</option>
                    {instance.clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        C{c.id} · demanda {c.demand}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button"
                  disabled={locked || instance.clients.length >= MAX_CLIENTS}
                  onClick={() =>
                    void edit({
                      ...instance,
                      clients: [
                        ...instance.clients,
                        {
                          id: instance.clients.length + 1,
                          x: 50,
                          y: 50,
                          demand: 1,
                        },
                      ],
                    })
                  }
                >
                  Adicionar cliente no centro
                </button>
                <details>
                  <summary>Editar depósito por coordenadas</summary>
                  <PointEditor
                    point={instance.depot}
                    disabled={locked}
                    onSave={(p) =>
                      void edit({ ...instance, depot: { x: p.x, y: p.y } })
                    }
                  />
                </details>
              </>
            )}
            <div className="file-actions">
              <button
                disabled={locked}
                onClick={() => fileInput.current?.click()}
              >
                <Upload size={13} />
                Importar instância
              </button>
              <button
                disabled={!instance}
                onClick={() => downloadJson("instance.json", instance)}
              >
                <Download size={13} />
                Baixar instância
              </button>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept=".json,.vrp,application/json,text/plain"
              hidden
              onChange={(e) => void importFile(e.target.files?.[0])}
            />
          </section>
          <section>
            <div className="section-title">
              <span>
                <FlaskConical size={15} /> Solver
              </span>
            </div>
            <fieldset disabled={locked}>
              <label className="full-field">
                Biblioteca
                <select
                  aria-label="Biblioteca"
                  value={config.adapter}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      adapter: e.target.value as Config["adapter"],
                      seed: e.target.value === "pyvrp" ? 7 : null,
                    }))
                  }
                >
                  <option value="ortools">
                    OR-Tools · soluções observadas
                  </option>
                  <option value="pyvrp">PyVRP · iterações observáveis</option>
                </select>
              </label>
              <div className="presets">
                {(["fast", "balanced", "deep"] as const).map((p, i) => (
                  <button
                    key={p}
                    className={
                      config.max_iterations === [500, 5000, 30000][i]
                        ? "selected"
                        : ""
                    }
                    onClick={() => preset(p)}
                  >
                    {["Rápido", "Equilibrado", "Profundo"][i]}
                  </button>
                ))}
              </div>
              {config.adapter === "pyvrp" && (
                <label className="full-field">
                  Critério de parada
                  <select
                    aria-label="Critério de parada"
                    value={config.stop}
                    onChange={(e) =>
                      setConfig((c) => ({
                        ...c,
                        stop: e.target.value as Config["stop"],
                      }))
                    }
                  >
                    <option value="iterations">Número de iterações</option>
                    <option value="time">Tempo de execução</option>
                  </select>
                </label>
              )}
              {config.adapter === "pyvrp" && (
                <NumberField
                  label="Máx. iterações"
                  value={config.max_iterations}
                  min={1}
                  onChange={(max_iterations) =>
                    setConfig((c) => ({ ...c, max_iterations }))
                  }
                />
              )}
              <NumberField
                label="Tempo limite (s)"
                value={config.time_limit}
                min={0.1}
                max={60}
                step={0.1}
                onChange={(time_limit) =>
                  setConfig((c) => ({ ...c, time_limit }))
                }
              />
              {config.adapter === "pyvrp" && (
                <NumberField
                  label="Seed do solver"
                  value={config.seed ?? 7}
                  max={4294967295}
                  onChange={(seed) => setConfig((c) => ({ ...c, seed }))}
                />
              )}
            </fieldset>
            <details className="solver-note">
              <summary>Algoritmo e versão</summary>
              <span className="mini-dot" />
              <div>
                <b>
                  {config.adapter === "ortools"
                    ? "OR-Tools 9.15.6755"
                    : "PyVRP 0.14.0"}
                </b>
                <span>
                  {config.adapter === "ortools"
                    ? "Guided local search · limite de tempo"
                    : "Iterated local search · late acceptance"}
                </span>
              </div>
            </details>
            {active ? (
              <Button kind="danger" icon={<Square size={16} />}
                className="button stop-button"
                disabled={cancelPending}
                onClick={() => void cancel()}
              >
                {cancelPending ? "Cancelando…" : "Cancelar busca"}
              </Button>
            ) : (
              <Button icon={<Play size={16} />}
                aria-label="Otimizar rotas"
                aria-describedby="synthetic-workflow"
                className="button optimize-button"
                disabled={busy || !instance || !!preview?.issues.length || connection !== "online"}
                onClick={() => void optimize()}
              >
                {busy ? "Processando…" : "Otimizar rotas"}
              </Button>
            )}
          </section>
        </aside>
        <div className="workspace">
          <section className="canvas-panel">
            <div className="canvas-toolbar">
              <div
                className="mode-tabs"
                role="tablist"
                aria-label="Visualização"
              >
                {(["problem", "baseline", "optimized", "compare"] as const).map(
                  (m, i) => (
                    <button
                      role="tab"
                      aria-selected={mode === m}
                      aria-describedby={
                        (m === "optimized" || m === "compare") && !best
                          ? "synthetic-workflow"
                          : undefined
                      }
                      className={mode === m ? "active" : ""}
                      key={m}
                      disabled={(m === "optimized" || m === "compare") && !best}
                      onClick={() => {
                        setComparisonSnapshot(null);
                        setMode(m);
                        setSelectedRoute(null);
                        simulation.stop();
                      }}
                    >
                      {["Problema", "Baseline", "Solução", "Comparar"][i]}
                    </button>
                  ),
                )}
              </div>
              <label className="label-toggle">
                <input
                  type="checkbox"
                  checked={labels}
                  onChange={(e) => setLabels(e.target.checked)}
                />
                IDs
              </label>
            </div>
            <div className="graph-view-toolbar" role="group" aria-label="Disposição do grafo">
              {(["distributed", "coordinates"] as const).map(view => (
                <button
                  key={view}
                  aria-pressed={graphView === view}
                  className={graphView === view ? "selected" : ""}
                  onClick={() => {
                    setGraphView(view);
                    setEditing(false);
                    setSelectedClient(null);
                    setSelectedRoute(null);
                    setCamera({ x: 0, y: 0, k: 1 });
                    simulation.stop();
                  }}
                >{view === "distributed" ? "Distribuída" : "Coordenadas"}</button>
              ))}
            </div>
            <div className="canvas-heading">
              <div>
                <h2>
                  {mode === "baseline"
                    ? "Ponto de partida"
                    : mode === "problem"
                      ? "Clientes e demandas"
                      : mode === "compare"
                        ? "Comparação de rotas"
                        : "Rotas da solução"}
                </h2>
                {instance && <p className="graph-context">
                  <strong>{instance.name}</strong>
                  <span>{graphView === "distributed" ? instance.vrp && !instance.vrp.coordinates ? "Posições distribuídas · custos da matriz" : "Posições distribuídas para leitura · X/Y na inspeção" : instance.vrp?.coordinates ? "Coordenadas do arquivo · escala proporcional" : instance.vrp ? "Posições ilustrativas · custos da matriz" : "Coordenadas do plano · escala proporcional"}</span>
                </p>}
              </div>
              <span
                role="status"
                className={"state-chip " + (active ? "is-running" : "")}
              >
                {active ? (
                  <Activity size={12} />
                ) : (
                  <span className="mini-dot" />
                )}
                {active
                  ? "Busca em andamento"
                  : run
                    ? statusNames[run.status]
                    : "Pronto para explorar"}
              </span>
            </div>
            {preview?.issues.map((issue) => (
              <div className="capacity-warning" key={issue}>
                {issue}
              </div>
            ))}
            {mapProps ? (
              mode === "compare" ? (
                <div className="compare-maps">
                  <div>
                    <div className="compare-label">
                      Baseline <b>{distance(baseline?.cost_ticks)} u.d.</b>
                    </div>
                    <RouteMap
                      {...mapProps}
                      editing={false}
                      solution={baseline}
                      clock={simulation.clock}
                      compact
                    />
                  </div>
                  <div>
                    <div className="compare-label">
                      {comparisonSnapshot
                        ? "PLANO FIXADO PARA REPRODUÇÃO"
                        : "Melhor encontrada"}{" "}
                      <b>{distance(displayed?.cost_ticks)} u.d.</b>
                    </div>
                    <RouteMap
                      {...mapProps}
                      editing={false}
                      solution={displayed}
                      clock={simulation.clock}
                      compact
                    />
                    {!best && (
                      <p className="empty-note">
                        Execute a otimização para comparar.
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <RouteMap
                  {...mapProps}
                  solution={displayed}
                  clock={simulation.clock}
                  previous={showDiff ? previousSolution : null}
                  overlay={overlay ? baseline : null}
                />
              )
            ) : (
              <div className="loading-map" role="status">
                <RouteIcon size={35} />
                <span>
                  {connection === "offline"
                    ? "Não foi possível conectar ao solver local."
                    : "Construindo o espaço de busca…"}
                </span>
                {connection === "offline" && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => void reconnect()}
                  >
                    Tentar novamente
                  </button>
                )}
              </div>
            )}
            {mode === "baseline" && !baseline && instance && (
              <p className="empty-note">
                {preview?.issues.length
                  ? "Inviabilidade comprovada pelas restrições de capacidade."
                  : "A construção inicial não encontrou baseline viável no orçamento. Isso não comprova inviabilidade. O solver pode continuar a busca."}
              </p>
            )}
            {mode === "optimized" && !best && (
              <p className="empty-note">
                {active
                  ? "Aguardando o primeiro checkpoint viável."
                  : "Execute a otimização para visualizar uma solução."}
              </p>
            )}
            <div className="canvas-footer">
              <span>
                <span className="mini-dot" />
                {instance?.clients.length ?? "—"} clientes{" "}
                <span className="divider-dot">·</span> 1 depósito{" "}
                <span className="divider-dot">·</span>{" "}
                {instance?.vehicles ?? "—"} veículos disponíveis
              </span>
              <span>{instance?.vrp ? `Custos VRP · ${instance.vrp.edge_weight_type} · u.d.` : "Distância euclidiana · u.d."}</span>
            </div>
          </section>
          {hasExecution && <>
          <section className="timeline-panel">
            <div className="timeline-title">
              <span>
                <Layers size={14} /> Soluções registradas
              </span>
              <small>
                {checkpoints.length
                  ? integer(index + 1) + " / " + integer(checkpoints.length)
                  : "Aguardando execução"}
              </small>
              <button
                disabled={!checkpoints.length}
                className={follow ? "follow active" : "follow"}
                onClick={() => {
                  simulation.stop();
                  setComparisonSnapshot(null);
                  setFollow(true);
                  setReplay(false);
                }}
              >
                Seguir busca
              </button>
            </div>
            <div className="timeline-controls">
              <button
                className="timeline-play"
                disabled={checkpoints.length < 2 || active}
                aria-label={replay ? "Pausar replay" : "Reproduzir checkpoints"}
                onClick={() => {
                  simulation.stop();
                  setFollow(false);
                  if (index >= checkpoints.length - 1) setCheckpointIndex(0);
                  else setCheckpointIndex(index);
                  setReplay(!replay);
                }}
              >
                {replay ? <Pause size={15} /> : <Play size={15} />}
              </button>
              <button
                className="icon-button"
                disabled={!checkpoints.length || index === 0}
                aria-label="Checkpoint anterior"
                onClick={() => {
                  setFollow(false);
                  setReplay(false);
                  setCheckpointIndex(index - 1);
                }}
              >
                <ChevronLeft size={16} />
              </button>
              <input
                aria-label="Checkpoint"
                type="range"
                min={0}
                max={Math.max(1, checkpoints.length - 1)}
                value={index}
                disabled={!checkpoints.length}
                onChange={(e) => {
                  setFollow(false);
                  setReplay(false);
                  setCheckpointIndex(Number(e.target.value));
                }}
              />
              <button
                className="icon-button"
                disabled={
                  !checkpoints.length || index >= checkpoints.length - 1
                }
                aria-label="Próximo checkpoint"
                onClick={() => {
                  setFollow(false);
                  setReplay(false);
                  setCheckpointIndex(index + 1);
                }}
              >
                <ChevronRight size={16} />
              </button>
              <span className="timeline-iteration">
                {isOrtools ? "OBS." : "ITER."}{" "}
                <b>
                  {checkpoint
                    ? integer(checkpoint.iteration ?? checkpoint.observed ?? 0)
                    : "—"}
                </b>
              </span>
            </div>
            <div className="diff-options">
              <label>
                <input
                  type="checkbox"
                  checked={showDiff}
                  onChange={(e) => setShowDiff(e.target.checked)}
                />{" "}
                Diferenças entre estados
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={overlay}
                  onChange={(e) => setOverlay(e.target.checked)}
                />{" "}
                Sobrepor baseline
              </label>
            </div>
            {showDiff && previousSolution && (
              <p className="diff-summary">
                +{diff.added.length} arcos · −{diff.removed.length} arcos ·{" "}
                {diff.transferred.length} clientes transferidos · Δ{" "}
                {distance(diff.delta)} u.d. A diferença não identifica
                operadores internos.
              </p>
            )}
            <div className="timeline-caption">
              <span>
                {checkpoint
                  ? {
                      initial: "Inicial",
                      improvement: "Melhoria encontrada",
                      final: "Melhor solução final",
                      observed: "Solução observada",
                    }[checkpoint.reason] +
                    " · " +
                    formatTime(checkpoint.elapsed)
                  : "Rotas completas registradas em melhorias da busca."}
              </span>
              <span>Replay por checkpoint · sem interpolação de rotas</span>
            </div>
          </section>
          <section className="chart-panel">
            <div className="chart-heading">
              <div>
                <Activity size={15} />
                <h3>Evolução do custo</h3>
                <span>Custo total</span>
              </div>
              <div className="chart-legend">
                <span>
                  <i className="best-line" />
                  Melhor viável
                </span>
                <span>
                  <i className="current-line" />
                  Atual viável
                </span>
                <span>
                  <i className="baseline-line" />
                  Baseline
                </span>
              </div>
            </div>
            <Convergence
              samples={samples}
              checkpoints={checkpoints}
              baseline={baseline?.cost_ticks ?? null}
              selected={checkpoint}
            />
            <div className="chart-footnote">
              {isOrtools
                ? "Callbacks de soluções; métricas até 10 Hz e melhorias."
                : "Métricas por iteração; gráfico amostrado."}{" "}
              {run?.result && (
                <>
                  Observados: {iterations} · snapshots: {run.result.checkpoints}{" "}
                  · omitidos: {run.result.omitted_snapshots ?? "—"} ·
                  coalescidos: {run.result.coalesced_events ?? 0}.
                </>
              )}
            </div>
          </section>
          </>}
          {hasExecution && displayed && (
            <section className="simulation-panel">
              <div className="section-title">
                <span>
                  <Truck size={16} /> Simular rotas
                </span>
                <label className="label-toggle">
                  <input
                    type="checkbox"
                    checked={simulation.enabled}
                    onChange={(e) => {
                      simulation.stop();
                      simulation.setEnabled(e.target.checked);
                      setReplay(false);
                    }}
                  />
                  Exibir veículos
                </label>
              </div>
              <div className="simulation-controls">
                <button
                  className="button"
                  onClick={() => {
                    freezePlayback();
                    simulation.playing ? simulation.pause() : simulation.play();
                  }}
                >
                  {simulation.playing ? (
                    <Pause size={14} />
                  ) : (
                    <Play size={14} />
                  )}{" "}
                  {simulation.playing ? "Pausar" : "Reproduzir"}
                </button>
                <button
                  className="icon-button"
                  aria-label="Parar simulação"
                  onClick={simulation.stop}
                >
                  <Square size={15} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Reiniciar simulação"
                  onClick={() => {
                    freezePlayback();
                    simulation.restart();
                  }}
                >
                  <RotateCcw size={15} />
                </button>
                <select
                  aria-label="Velocidade da simulação"
                  value={simulation.speed}
                  onChange={(e) => simulation.setSpeed(Number(e.target.value))}
                >
                  {[0.5, 1, 2, 4].map((s) => (
                    <option key={s} value={s}>
                      {s}×
                    </option>
                  ))}
                </select>
                <button
                  className="icon-button"
                  aria-label="Próxima parada"
                  onClick={() => {
                    freezePlayback();
                    simulation.next();
                  }}
                >
                  <ChevronRight size={16} />
                </button>
                <PlaybackPosition
                  clock={simulation.clock}
                  maximum={simulation.maximum}
                  pause={simulation.pause}
                  seek={simulation.seek}
                />
                <span>
                  Sequência real · velocidade visual de 8 u.d./s a 1× · sem
                  tempo de viagem
                </span>
              </div>
            </section>
          )}
        </div>
        {instance && (
        <aside className="solution-panel">
          <section>
            <div className="section-title">
              <span>
                <RouteIcon size={15} />{" "}
                {mode === "baseline" ? "Baseline" : "Solução"}
              </span>
            </div>
            <Metric
              label="Distância / custo"
              value={distance(displayed?.cost_ticks)}
              unit="u.d."
            >
              <span className="metric-context">
                {mode === "baseline"
                  ? "Construção OR-Tools / plano validado"
                  : mode === "problem"
                    ? "Selecione uma visualização"
                    : "Plano selecionado no histórico"}
              </span>
            </Metric>
            <div className="small-metrics">
              <Metric
                label="Veículos"
                value={displayed?.routes.length ?? "—"}
                unit={"/ " + (instance?.vehicles ?? "—")}
              />
              <Metric
                label="Atendidos"
                value={displayed?.served ?? "—"}
                unit={"/ " + (instance?.clients.length ?? "—")}
              />
            </div>
            <div className="utilization">
              <span>Ocupação média na saída</span>
              <b>{capacityUse == null ? "—" : capacityUse.toFixed(1) + "%"}</b>
            </div>
            <div className="improvement-card">
              <div>
                <ArrowDownRight size={19} />
                <span>Melhoria da melhor encontrada</span>
              </div>
              <strong>
                {percent == null ? "—" : percent.toFixed(1) + "%"}
                <small>
                  {percent == null
                    ? "Execute para comparar"
                    : distance(
                        (baseline?.cost_ticks ?? 0) - (best?.cost_ticks ?? 0),
                      ) + " u.d. de redução"}
                </small>
              </strong>
            </div>
            <div className="execution-stats">
              <span>
                Maior rota
                <b>
                  {distance(
                    displayed
                      ? Math.max(
                          ...displayed.routes.map((r) => r.cost_ticks),
                          0,
                        )
                      : null,
                  )}{" "}
                  u.d.
                </b>
              </span>
              <span>
                Duração ilustrativa (1×)
                <b>
                  {displayed
                    ? (
                        Math.max(
                          ...displayed.routes.map((r) => r.cost_ticks),
                          0,
                        ) / 8000
                      ).toFixed(2)
                    : "—"}{" "}
                  s
                </b>
              </span>
              <span>
                {isOrtools ? "Soluções observadas" : "Iterações"}{" "}
                <b>{integer(iterations)}</b>
              </span>
              <span>
                Tempo do solver <b>{formatTime(runtime)}</b>
              </span>
            </div>
            {run?.result && (
              <p className="field-hint">
                Parada:{" "}
                {(
                  {
                    iterations: "limite de iterações",
                    time: "limite de tempo",
                    time_or_search_end: "tempo / fim da busca",
                    cancelled: "cancelamento",
                    safety_time_limit: "proteção de tempo",
                    safety_iteration_limit: "proteção de iterações",
                  } as Record<string, string>
                )[run.result.stop_reason] ?? run.result.stop_reason}
                . Solução heurística; ótimo não certificado.
              </p>
            )}
          </section>
          {selectedPoint && selectedCoordinates && (
            <section className="client-inspector" aria-label={client ? "Detalhes do cliente" : "Detalhes do depósito"}>
              <div className="section-title">
                <span>{client ? `Cliente ${graphNodeId(instance!, client.id).toString().padStart(2, "0")}` : instance?.vrp ? `Depósito ${graphNodeId(instance, 0)}` : "Depósito"}</span>
                <button
                  aria-label={client ? "Fechar cliente" : "Fechar depósito"}
                  onClick={() => setSelectedClient(null)}
                >
                  <X size={14} />
                </button>
              </div>
              <div className="execution-stats">
                <span>
                  Coordenada X <b title={String(selectedCoordinates[0])}>{coordinateText(selectedCoordinates[0])}</b>
                </span>
                <span>
                  Coordenada Y <b title={String(selectedCoordinates[1])}>{coordinateText(selectedCoordinates[1])}</b>
                </span>
                {client && (
                  <>
                    <span>Demanda <b>{client.demand} un.</b></span>
                    <span>Veículo <b>{clientRoute ? "V" + clientRoute.vehicle : "—"}</b></span>
                    <span>
                      Ordem da visita <b>{clientRoute ? clientRoute.visits.indexOf(client.id) + 1 : "—"}</b>
                    </span>
                  </>
                )}
              </div>
              {instance?.vrp && (
                <p className="field-hint">
                  {originalCoordinates
                    ? `Coordenadas originais do arquivo · nó ${instance.vrp.node_ids[selectedClient!]}`
                    : "Posição ilustrativa no plano; arquivo sem coordenadas."}
                </p>
              )}
              {editing && client && (
                <>
                  <PointEditor
                    point={client}
                    disabled={locked}
                    onSave={(p) =>
                      void edit({
                        ...instance!,
                        clients: instance!.clients.map((c) =>
                          c.id === client.id
                            ? {
                                ...c,
                                x: p.x,
                                y: p.y,
                                demand: p.demand ?? c.demand,
                              }
                            : c,
                        ),
                      })
                    }
                  />
                  <button
                    className="button remove-button"
                    disabled={locked || !!instance!.vrp || instance!.clients.length <= 2}
                    onClick={removeClient}
                  >
                    <Trash2 size={13} />
                    Remover cliente
                  </button>
                </>
              )}
            </section>
          )}
          <FleetPanel
            instance={instance}
            displayed={displayed}
            selectedRoute={selectedRoute}
            setSelectedRoute={setSelectedRoute}
            setSelectedClient={setSelectedClient}
            clock={simulation.clock}
            enabled={simulation.enabled}
          />
          {run && !active && !imported && (
            <section className="exports">
              <div className="section-title">
                <span>
                  <Download size={14} /> Exportar execução
                </span>
              </div>
              <div className="export-links">
                {["json", "csv", "sol"].map((format) => (
                  <a
                    key={format}
                    href={"/api/runs/" + run.id + "/export?format=" + format}
                    download
                  >
                    {format.toUpperCase()}
                    <ArrowRight size={12} />
                  </a>
                ))}
              </div>
              <p className="field-hint">
                JSON: instância + execução. CSV: estatísticas brutas. SOL: rotas
                e custo em ticks (escala 1000).
              </p>
            </section>
          )}
        </aside>
        )}
      </main>
      {hasExecution && displayed && (
        <section className="route-table-panel">
          <div className="section-title">
            <span>Registro de rotas</span>
            <small>Selecione uma rota</small>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Veículo</th>
                  <th>Sequência · depósito = {instance ? graphNodeId(instance, 0) : 0}</th>
                  <th>Paradas</th>
                  <th>Carga / capacidade</th>
                  <th>Distância</th>
                </tr>
              </thead>
              <tbody>
                {displayed.routes.map((r) => (
                  <tr
                    key={r.vehicle}
                    onClick={() => setSelectedRoute(r.vehicle)}
                    className={selectedRoute === r.vehicle ? "selected" : ""}
                  >
                    <td>
                      <button onClick={() => setSelectedRoute(r.vehicle)}>
                        <i style={{ background: badge(r.vehicle) }} />V
                        {r.vehicle.toString().padStart(2, "0")}
                      </button>
                    </td>
                    <td>{[0, ...r.visits, 0].map(id => instance ? graphNodeId(instance, id) : id).join(" → ")}</td>
                    <td>{r.visits.length}</td>
                    <td>
                      {r.load} /{" "}
                      {instance ? vehicleCapacity(instance, r.vehicle) : "—"}
                    </td>
                    <td>{distance(r.cost_ticks)} u.d.</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <footer className="page-footer">
        <span>
          <FlaskConical size={13} /> VRP Simulation
        </span>
        <span>
          {instance?.vrp ? `CVRP importado · ${instance.vrp.edge_weight_type} · custos do arquivo · escala 1000` : "CVRP · custo = distância · arestas arredondadas para ticks (escala 1000)"}
        </span>
        <button onClick={() => setModal("help")}>
          Modelo e fontes <ArrowRight size={12} />
        </button>
      </footer>
      {vrpImport && (
        <Dialog name="Importar instância VRP" onClose={() => { if (!busy) setVrpImport(null); }}>
          <h2>Importar instância VRP</h2>
          <p>{vrpImport.filename}</p>
          {vrpImport.preview && (
            <p role="status">
              {vrpImport.preview.instance.clients.length + 1} pontos ({vrpImport.preview.instance.clients.length} clientes + 1 depósito) · {vrpImport.preview.instance.vehicles} veículos disponíveis · capacidade {vrpImport.preview.instance.capacity} por veículo
            </p>
          )}
          <details className="import-convention"><summary>Formato e distâncias</summary>
            <p>EUC_2D arredonda as distâncias ao inteiro mais próximo. EXPLICIT preserva a matriz com precisão de 0,001 unidade. DIMENSION inclui o depósito.</p>
          </details>
          <label>Quantidade de veículos
            <input type="number" min="1" max={MAX_VEHICLES} value={declaredVrpVehicles ?? vrpVehicles} placeholder="Informe quando ausente no arquivo" disabled={busy || !!declaredVrpVehicles} onChange={e => setVrpVehicles(e.target.value)} />
          </label>
          <p>{declaredVrpVehicles ? "Frota identificada no arquivo." : "Informe a frota disponível; ela não consta no arquivo."}</p>
          {vrpError && <p role="alert">{vrpError}</p>}
          <button disabled={busy} onClick={() => setVrpImport(null)}>Cancelar</button>
          <button className="button" disabled={busy} onClick={async () => {
            setBusy(true); setVrpError("");
            try {
              const result = vrpImport.preview ?? await api<Preview>("/instances/import-vrp", { text: vrpImport.text, filename: vrpImport.filename, vehicles: vrpVehicles ? Number(vrpVehicles) : null });
              clearExperiment(); setEditing(false); loadPreview(result); setMode("baseline");
              setVrpImport(null);
            } catch (e) { setVrpError((e as Error).message); }
            finally { setBusy(false); }
          }}>{busy ? "Importando…" : "Carregar instância"}</button>
        </Dialog>
      )}
      {modal && (
        <Dialog
          name={
            modal === "help" ? "Método e fontes" : "Histórico de experimentos"
          }
          onClose={() => setModal(null)}
        >
          <button
            className="modal-close icon-button"
            aria-label="Fechar janela"
            onClick={() => setModal(null)}
          >
            <X size={20} />
          </button>
          {modal === "help" ? (
            <>
              <h2>Modelo e registros</h2>
              <p>
                {instance?.vrp ? "Esta instância usa a matriz de custos VRP importada. EUC_2D arredonda ao inteiro mais próximo; CEIL_2D arredonda para cima; FLOOR_2D para baixo; EXACT_2D e EXPLICIT usam precisão de 0,001 unidade. As posições do plano servem à visualização. Baseline, solver e auditoria consultam os custos importados." : "O plano representa coordenadas em unidades de distância, entre 0 e 100. Cada aresta custa floor(1000 × distância euclidiana + 0,5) ticks (escala 1000). Baseline, solver e auditoria usam essa mesma convenção."}
              </p>
              <h3>Baseline</h3>
              <p>
                A primeira solução da estratégia PATH_CHEAPEST_ARC do OR-Tools
                ou um plano manual validado serve de baseline. A construção é
                heurística. Se ela falhar, o cenário permanece disponível e a
                ausência de baseline é indicada.
              </p>
              <h3>Solvers</h3>
              <p>
                OR-Tools 9.15.6755 usa GUIDED_LOCAL_SEARCH. Seus callbacks
                registram soluções observadas; nenhum contador interno de
                iterações é inferido. O adaptador opcional PyVRP 0.14.0 oferece
                callbacks públicos por iteração. Ambos fornecem snapshots
                completos com validação independente.
              </p>
              <h3>Tempo de busca e reprodução</h3>
              <p>
                O gráfico usa o tempo computacional medido. O relógio de viagem
                é ilustrativo: distância de cada trecho dividida por 8 unidades
                por segundo a 1×. O veículo descarrega na chegada, inclusive em
                trechos de distância zero. A comparação usa o mesmo relógio e
                câmera. Pausar a reprodução não pausa a busca.
              </p>
              <h3>Retenção e identidade</h3>
              <p>
                OR-Tools retém melhorias e amostra outros planos a cada 0,5 s. A
                fila limitada pode compactar eventos sob pressão; contadores
                informam omissões. Baseline e melhor final são preservados. IDs
                OR-Tools identificam veículos; no PyVRP, rotas anônimas recebem
                associação visual por sobreposição de clientes, sem rastrear
                veículos físicos.
              </p>
              <h3>Reprodutibilidade</h3>
              <p>
                O JSON exportado contém instância, parâmetros, versões e
                histórico retido, e pode ser importado sem executar o solver.
                Seeds são configuráveis no gerador e no PyVRP. OR-Tools não
                expõe seed neste adaptador. Orçamentos de tempo dependem do
                ambiente. Nenhum resultado é declarado ótimo sem certificado.
              </p>
              <div className="source-links">
                <a
                  href="https://developers.google.com/optimization/routing/routing_tasks"
                  target="_blank"
                  rel="noreferrer"
                >
                  OR-Tools Routing ↗
                </a>
                <a
                  href="https://github.com/PyVRP/PyVRP/tree/v0.14.0"
                  target="_blank"
                  rel="noreferrer"
                >
                  PyVRP 0.14.0 ↗
                </a>
                <a
                  href="https://github.com/PyVRP/PyVRP/blob/v0.14.0/pyvrp/IteratedLocalSearch.py"
                  target="_blank"
                  rel="noreferrer"
                >
                  Callbacks e algoritmo ↗
                </a>
                <a
                  href="http://127.0.0.1:8000/docs"
                  target="_blank"
                  rel="noreferrer"
                >
                  API local ↗
                </a>
              </div>
            </>
          ) : (
            <>
              <h2>Execuções salvas</h2>
              <p>
                Carregue a instância, os parâmetros e os checkpoints de uma
                execução.
              </p>
              {history.length ? (
                history.map((h) => (
                  <button
                    disabled={locked}
                    key={h.id}
                    className="history-row"
                    onClick={() => void restore(h.id)}
                  >
                    <div>
                      <b>{h.name}</b>
                      <span>
                        {new Date(h.created).toLocaleString("pt-BR")} ·{" "}
                        {statusNames[h.status]}
                      </span>
                    </div>
                    <strong>
                      {distance(h.result?.solution?.cost_ticks)} u.d.
                      <ChevronRight size={16} />
                    </strong>
                  </button>
                ))
              ) : (
                <p>Nenhuma execução registrada.</p>
              )}
            </>
          )}
        </Dialog>
      )}
    </div>
  );
}
