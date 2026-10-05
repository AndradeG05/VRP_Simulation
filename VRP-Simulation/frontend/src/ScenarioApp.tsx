import { lazy, Suspense, useState } from "react";
import { Route } from "./carbon/icons";
import { Header } from "./carbon/components";
import GeoLab from "./geo/GeoLab";

const SyntheticLab = lazy(() => import("./App"));
export default function ScenarioApp() {
  const [mode, setMode] = useState<"synthetic" | "geographic">("geographic"),
    [syntheticOpened, setSyntheticOpened] = useState(false);
  const [syntheticFile, setSyntheticFile] = useState<File>(),
    [geoFile, setGeoFile] = useState<File>();
  const [syntheticRun, setSyntheticRun] = useState<string>(),
    [geoRun, setGeoRun] = useState<string>();
  const [syntheticBusy, setSyntheticBusy] = useState(false),
    [geoBusy, setGeoBusy] = useState(false);
  function geographic() {
    setMode("geographic");
  }
  function synthetic() {
    setSyntheticOpened(true);
    setMode("synthetic");
  }
  return (
    <>
      <Header className="scenario-switch" hidden={mode === "geographic"}>
        <a className="scope-brand" href="/" aria-label="VRP Simulation início">
          <Route size={22} />
          <strong>VRP Simulation</strong>
          <span>Laboratório de rotas</span>
        </a>
        <nav aria-label="Tipo de cenário">
          <button
            aria-pressed={mode === "geographic"}
            disabled={syntheticBusy}
            onClick={geographic}
          >
            Cenário no mapa
          </button>
          <button
            aria-pressed={mode === "synthetic"}
            disabled={geoBusy}
            onClick={synthetic}
          >
            Cenário sintético
          </button>
        </nav>
        <span className="scope-model">CVRP · depósito único</span>
      </Header>
      {syntheticOpened && (
        <div data-scenario="synthetic" hidden={mode !== "synthetic"}>
          <Suspense fallback={<div className="scenario-loading" role="status">Abrindo laboratório sintético…</div>}>
            <SyntheticLab
              incomingFile={syntheticFile}
              incomingRun={syntheticRun}
              onBusy={setSyntheticBusy}
              onGeographicFile={(file) => {
                setGeoFile(file);
                geographic();
              }}
              onGeographicRun={(id) => {
                setGeoRun(id);
                geographic();
              }}
            />
          </Suspense>
        </div>
      )}
      <div data-scenario="geographic" hidden={mode !== "geographic"}>
        <GeoLab
          onSynthetic={synthetic}
          incomingFile={geoFile}
          incomingRun={geoRun}
          onBusy={setGeoBusy}
          onSyntheticFile={(file) => {
            setSyntheticFile(file);
            synthetic();
          }}
          onSyntheticRun={(id) => {
            setSyntheticRun(id);
            synthetic();
          }}
        />
      </div>
    </>
  );
}
