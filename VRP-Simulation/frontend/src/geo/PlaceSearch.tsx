import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Search } from "../carbon/icons";
import { Button } from "../carbon/components";
import { api } from "../api";
import type { GeoPoint } from "./model";

export default function PlaceSearch({ onPlace, disabled }: { onPlace: (p: GeoPoint) => void; disabled: boolean }) {
  const id = useId();
  const resultsId = `${id}-results`;
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<GeoPoint[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { if (disabled) { request.current?.abort(); setBusy(false); } }, [disabled]);
  async function search(event: FormEvent) {
    event.preventDefault();
    if (disabled || query.trim().length < 3) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(""); setItems([]);
    try {
      const results = await api<GeoPoint[]>(`/places?q=${encodeURIComponent(query.trim())}`, undefined, controller.signal);
      if (!controller.signal.aborted) { setItems(results); if (!results.length) setError("Nenhum local encontrado. Ajuste a busca ou escolha no mapa."); }
    } catch (cause) { if (!controller.signal.aborted) setError((cause as Error).message); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <div className="geo-place-search">
    <form onSubmit={search}>
      <label htmlFor={id}>Buscar endereço ou lugar</label>
      <div className="geo-place-input">
        <input id={id} type="search" inputMode="search" enterKeyHint="search" value={query} disabled={disabled} maxLength={200} autoComplete="off" aria-controls={items.length ? resultsId : undefined} placeholder="Endereço, cidade ou lugar" onKeyDown={event => { if (event.key === "Escape" && items.length) { setItems([]); setError(""); } }} onChange={e => { request.current?.abort(); setBusy(false); setQuery(e.target.value); setItems([]); setError(""); }} />
        <Button type="submit" kind="secondary" disabled={disabled || busy || query.trim().length < 3} aria-label="Buscar local" icon={<Search size={16} />}>Buscar</Button>
      </div>
    </form>
    {busy && <p role="status">Buscando no OpenStreetMap…</p>}
    {error && <p role="alert">{error}</p>}
    {!!items.length && <><p className="wb-visually-hidden" role="status">{items.length} {items.length === 1 ? "local encontrado" : "locais encontrados"}. Use Tab para escolher um local.</p><ul id={resultsId} className="geo-place-results" aria-label="Locais encontrados">{items.map((point, index) => <li key={index}><button disabled={disabled} onClick={() => { onPlace(point); setItems([]); setQuery(point.address ?? query); }}>{point.address || `${point.lat}, ${point.lng}`}</button></li>)}</ul></>}
    <small>Busca: Photon · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a></small>
  </div>;
}
