import React, { useEffect, useRef, useState } from "react";
import {
  Map as GoogleMapView,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import {
  BedDouble,
  Car,
  ExternalLink,
  Fuel,
  Loader2,
  MapPin,
  Plus,
  Route,
  Train,
  Trash2,
} from "lucide-react";
import type { GeoLocation, RoutesSubMode, StaySearchPrefill } from "../types";

interface RoutesAndTravelPlannerProps {
  location: GeoLocation | null;
  mapsApiKey: string;
  onBookStay?: (prefill: StaySearchPrefill) => void;
  initialMode?: { mode: RoutesSubMode; nonce: number } | null;
}

const PolylineOverlay: React.FC<{ encodedPolyline: string }> = ({
  encodedPolyline,
}) => {
  const map = useMap();
  const geometryLib = useMapsLibrary("geometry");
  const mapsLib = useMapsLibrary("maps");
  const coreLib = useMapsLibrary("core");
  const polyRef = useRef<{ setMap: (m: unknown) => void } | null>(null);

  useEffect(() => {
    if (!map || !geometryLib || !mapsLib || !coreLib || !encodedPolyline) return;

    if (polyRef.current) {
      polyRef.current.setMap(null);
      polyRef.current = null;
    }

    const path = geometryLib.encoding.decodePath(encodedPolyline);
    const poly = new mapsLib.Polyline({
      path,
      strokeColor: "#22C55E",
      strokeWeight: 5,
      strokeOpacity: 0.9,
      map,
    });
    polyRef.current = poly;

    const bounds = new coreLib.LatLngBounds();
    path.forEach((pt: unknown) =>
      bounds.extend(pt as Parameters<typeof bounds.extend>[0])
    );
    map.fitBounds(bounds);

    return () => {
      poly.setMap(null);
    };
  }, [map, geometryLib, mapsLib, coreLib, encodedPolyline]);

  return null;
};

export const RoutesAndTravelPlanner: React.FC<RoutesAndTravelPlannerProps> = ({
  location,
  mapsApiKey,
  onBookStay,
  initialMode,
}) => {
  const [mode, setMode] = useState<"multistop" | "city_travel">(
    initialMode?.mode ?? "multistop"
  );

  useEffect(() => {
    if (initialMode?.mode) {
      setMode(initialMode.mode);
    }
  }, [initialMode]);

  // Multi-stop up to 20 addresses
  const [origin, setOrigin] = useState("Warszawa Centralna");
  const [stops, setStops] = useState<string[]>([
    "Pałac Kultury i Nauki, Warszawa",
    "Łazienki Królewskie, Warszawa",
    "Zamek Królewski, Warszawa",
  ]);
  const [travelMode, setTravelMode] = useState<
    "DRIVE" | "BICYCLE" | "WALK" | "TRANSIT"
  >("DRIVE");
  const [optimizeOrder, setOptimizeOrder] = useState(true);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeResult, setRouteResult] = useState<{
    origin: string;
    orderedStops: string[];
    distanceMeters: number;
    durationSeconds: number;
    encodedPolyline: string;
    googleMapsUrl: string;
  } | null>(null);

  // City-to-City Transit vs Eco Car + Fuel Prices
  const [fromCity, setFromCity] = useState("Warszawa");
  const [toCity, setToCity] = useState("Kraków");
  const [transportPreference, setTransportPreference] = useState<
    "both" | "car" | "transit"
  >("both");
  const [emissionType, setEmissionType] = useState<
    "GASOLINE" | "DIESEL" | "HYBRID" | "ELECTRIC"
  >("GASOLINE");
  const [fuelConsumption, setFuelConsumption] = useState(6.5);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareResult, setCompareResult] = useState<{
    ecoRoute: {
      distanceMeters: number;
      durationSeconds: number;
      fuelConsumptionLiters: number | null;
      encodedPolyline: string;
      isFuelEfficient: boolean;
    } | null;
    fuelStations: Array<{
      name: string;
      address: string;
      rating: number;
      googleMapsUri: string;
    }>;
    analysisText: string;
    webSources: Array<{ title: string; uri: string }>;
    googleMapsEcoUrl: string;
  } | null>(null);

  const addStop = () => {
    if (stops.length >= 20) return;
    setStops((prev) => [...prev, ""]);
  };

  const updateStop = (index: number, value: string) => {
    setStops((prev) => prev.map((s, i) => (i === index ? value : s)));
  };

  const removeStop = (index: number) => {
    if (stops.length <= 1) return;
    setStops((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePlanMultiStop = async (e: React.FormEvent) => {
    e.preventDefault();
    setRouteLoading(true);
    setRouteError(null);
    try {
      const res = await fetch("/api/routes/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin,
          stops,
          travelMode,
          optimizeOrder,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Błąd wyznaczania trasy.");
      }
      setRouteResult(data);
    } catch (err) {
      setRouteError(err instanceof Error ? err.message : "Błąd trasy.");
    } finally {
      setRouteLoading(false);
    }
  };

  const handleCompareTravel = async (e: React.FormEvent) => {
    e.preventDefault();
    setCompareLoading(true);
    setCompareError(null);
    try {
      const res = await fetch("/api/travel/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromCity,
          toCity,
          transportPreference,
          emissionType,
          fuelConsumptionPer100Km: fuelConsumption,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Błąd porównywania połączeń.");
      }
      setCompareResult(data);
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : "Błąd połączeń.");
    } finally {
      setCompareLoading(false);
    }
  };

  const activePolyline =
    mode === "multistop"
      ? routeResult?.encodedPolyline || ""
      : compareResult?.ecoRoute?.encodedPolyline || "";

  return (
    <div className="space-y-6">
      {/* Sub-mode Segmented Switch */}
      <div className="inline-flex flex-wrap gap-1.5 rounded-xl border border-[#1E2420] bg-[#0D0F0E] p-1.5">
        <button
          type="button"
          onClick={() => setMode("multistop")}
          className={`inline-flex min-h-[40px] items-center gap-2 rounded-lg px-4 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            mode === "multistop"
              ? "bg-emerald-500 text-black"
              : "text-neutral-300 hover:text-white"
          }`}
        >
          <Route className="h-4 w-4" />
          Trasa Google Maps (do 20 adresów)
        </button>
        <button
          type="button"
          onClick={() => setMode("city_travel")}
          className={`inline-flex min-h-[40px] items-center gap-2 rounded-lg px-4 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            mode === "city_travel"
              ? "bg-emerald-500 text-black"
              : "text-neutral-300 hover:text-white"
          }`}
        >
          <Train className="h-4 w-4" />
          Pociąg / Tramwaj vs Auto + Ceny paliw
        </button>
      </div>

      {mode === "multistop" ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <form
            onSubmit={handlePlanMultiStop}
            className="rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-6 space-y-4 lg:col-span-5"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-white">
                Planowanie trasy (max 20 adresów)
              </h2>
              <span className="font-mono text-xs tabular-nums text-emerald-400">
                {stops.length}/20
              </span>
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-300">
                Punkt startowy (A)
              </label>
              <input
                type="text"
                required
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                placeholder="Adres startowy"
                className="mt-1.5 min-h-[44px] w-full rounded-xl border border-[#222824] bg-[#050506] px-3.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
              <label className="block text-xs font-medium text-neutral-300">
                Adresy docelowe
              </label>
              {stops.map((stop, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="w-6 text-center font-mono text-xs tabular-nums text-neutral-500">
                    {idx + 1}.
                  </span>
                  <input
                    type="text"
                    value={stop}
                    onChange={(e) => updateStop(idx, e.target.value)}
                    placeholder={`Przystanek ${idx + 1}`}
                    className="min-h-[40px] flex-1 rounded-xl border border-[#222824] bg-[#050506] px-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                  {stops.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeStop(idx)}
                      className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-neutral-400 hover:bg-red-500/15 hover:text-red-300 cursor-pointer"
                      aria-label="Usuń przystanek"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {stops.length < 20 && (
              <button
                type="button"
                onClick={addStop}
                className="inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#2B352F] text-xs font-medium text-emerald-400 hover:border-emerald-500/50 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                Dodaj kolejny adres ({stops.length}/20)
              </button>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-neutral-300">
                  Środek transportu
                </label>
                <select
                  value={travelMode}
                  onChange={(e) =>
                    setTravelMode(e.target.value as typeof travelMode)
                  }
                  className="mt-1.5 min-h-[42px] w-full rounded-xl border border-[#222824] bg-[#050506] px-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
                >
                  <option value="DRIVE">Samochód</option>
                  <option value="BICYCLE">Rower</option>
                  <option value="WALK">Pieszo</option>
                  <option value="TRANSIT">Komunikacja miejska</option>
                </select>
              </div>
              <label className="flex items-end pb-2.5 gap-2 text-xs text-neutral-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={optimizeOrder}
                  onChange={(e) => setOptimizeOrder(e.target.checked)}
                  className="h-4 w-4 accent-emerald-500"
                />
                Optymalizuj kolejność przystanków
              </label>
            </div>

            {routeError && (
              <p className="text-xs text-red-300">{routeError}</p>
            )}

            <button
              type="submit"
              disabled={routeLoading}
              className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-60 cursor-pointer"
            >
              {routeLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Route className="h-4 w-4" />
              )}
              Wyznacz i optymalizuj trasę
            </button>
          </form>

          <div className="space-y-4 lg:col-span-7">
            {mapsApiKey && (
              <div className="h-[340px] overflow-hidden rounded-2xl border border-[#1E2420] bg-[#0D0F0E]">
                <GoogleMapView
                  defaultCenter={location || { lat: 52.2297, lng: 21.0122 }}
                  defaultZoom={11}
                  gestureHandling="greedy"
                  internalUsageAttributionIds={[
                    "gmp_mcp_codeassist_v1_aistudio",
                  ]}
                  style={{ width: "100%", height: "100%" }}
                >
                  {activePolyline && (
                    <PolylineOverlay encodedPolyline={activePolyline} />
                  )}
                </GoogleMapView>
              </div>
            )}

            {routeResult && (
              <div className="rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-xs text-neutral-400">
                      Zoptymalizowana trasa wielopunktowa
                    </p>
                    <p className="mt-1 font-mono text-lg font-bold tabular-nums text-white">
                      {routeResult.distanceMeters
                        ? `${(routeResult.distanceMeters / 1000).toFixed(1)} km · ${Math.round(
                            routeResult.durationSeconds / 60
                          )} min`
                        : "Gotowy link do nawigacji Google Maps"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {onBookStay && (
                      <button
                        type="button"
                        onClick={() => {
                          const dest =
                            routeResult.orderedStops[
                              routeResult.orderedStops.length - 1
                            ] || origin;
                          onBookStay({ city: dest, autoTrigger: true });
                        }}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 cursor-pointer"
                      >
                        <BedDouble className="h-4 w-4" />
                        Zarezerwuj nocleg u celu
                      </button>
                    )}
                    <a
                      href={routeResult.googleMapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-emerald-500 px-4 text-xs font-semibold text-black hover:bg-emerald-400"
                    >
                      Otwórz w Google Maps
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                </div>

                <ol className="space-y-1.5 border-t border-[#1E2420] pt-3 text-xs text-neutral-300">
                  <li>
                    <strong className="text-emerald-400">Start:</strong>{" "}
                    {routeResult.origin}
                  </li>
                  {routeResult.orderedStops.map((st, idx) => (
                    <li key={idx}>
                      <span className="font-mono text-neutral-500">
                        {idx + 1}.
                      </span>{" "}
                      {st}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <form
            onSubmit={handleCompareTravel}
            className="rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-6 space-y-4 lg:col-span-5"
          >
            <h2 className="font-display text-lg font-semibold text-white">
              Podróż: Pociąg / Tramwaj vs Eco Auto + Ceny paliw
            </h2>
            <p className="text-xs text-neutral-400">
              Sprawdź aktualne połączenia PKP/tramwajowe lub wyznacz najkrótszą trasę samochodową o najmniejszym spalaniu wraz ze stacjami i rynkowymi cenami paliw.
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-neutral-300">
                  Z miasta / adresu
                </label>
                <input
                  type="text"
                  required
                  value={fromCity}
                  onChange={(e) => setFromCity(e.target.value)}
                  className="mt-1.5 min-h-[44px] w-full rounded-xl border border-[#222824] bg-[#050506] px-3.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-300">
                  Do miasta / adresu
                </label>
                <input
                  type="text"
                  required
                  value={toCity}
                  onChange={(e) => setToCity(e.target.value)}
                  className="mt-1.5 min-h-[44px] w-full rounded-xl border border-[#222824] bg-[#050506] px-3.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-300">
                Co mam sprawdzić?
              </label>
              <select
                value={transportPreference}
                onChange={(e) =>
                  setTransportPreference(
                    e.target.value as typeof transportPreference
                  )
                }
                className="mt-1.5 min-h-[44px] w-full rounded-xl border border-[#222824] bg-[#050506] px-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
              >
                <option value="both">
                  Porównaj: Pociąg/Tramwaj + Eco Auto i paliwo
                </option>
                <option value="transit">
                  Tylko pociąg, tramwaj i autobus (rozkłady)
                </option>
                <option value="car">
                  Tylko najoszczędniejsza trasa autem + stacje paliw
                </option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-neutral-300">
                  Rodzaj napędu
                </label>
                <select
                  value={emissionType}
                  onChange={(e) =>
                    setEmissionType(e.target.value as typeof emissionType)
                  }
                  className="mt-1.5 min-h-[44px] w-full rounded-xl border border-[#222824] bg-[#050506] px-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
                >
                  <option value="GASOLINE">Benzyna (PB95/98)</option>
                  <option value="DIESEL">Diesel (ON)</option>
                  <option value="HYBRID">Hybryda</option>
                  <option value="ELECTRIC">Elektryczny (EV)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-300">
                  Spalanie (l/100km)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="1"
                  max="30"
                  value={fuelConsumption}
                  onChange={(e) => setFuelConsumption(Number(e.target.value))}
                  className="mt-1.5 min-h-[44px] w-full rounded-xl border border-[#222824] bg-[#050506] px-3 font-mono text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            {compareError && (
              <p className="text-xs text-red-300">{compareError}</p>
            )}

            <button
              type="submit"
              disabled={compareLoading}
              className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-60 cursor-pointer"
            >
              {compareLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Car className="h-4 w-4" />
              )}
              Sprawdź przejazdy, trasę i ceny paliw
            </button>
          </form>

          <div className="space-y-4 lg:col-span-7">
            {mapsApiKey && compareResult?.ecoRoute?.encodedPolyline && (
              <div className="h-[280px] overflow-hidden rounded-2xl border border-[#1E2420] bg-[#0D0F0E]">
                <GoogleMapView
                  defaultCenter={location || { lat: 52.2297, lng: 21.0122 }}
                  defaultZoom={7}
                  gestureHandling="greedy"
                  internalUsageAttributionIds={[
                    "gmp_mcp_codeassist_v1_aistudio",
                  ]}
                  style={{ width: "100%", height: "100%" }}
                >
                  <PolylineOverlay
                    encodedPolyline={compareResult.ecoRoute.encodedPolyline}
                  />
                </GoogleMapView>
              </div>
            )}

            {compareResult ? (
              <div className="space-y-4">
                {compareResult.ecoRoute && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-[#1E2420] bg-[#0D0F0E] p-4">
                      <p className="text-xs text-neutral-400">Dystans eco</p>
                      <p className="mt-1 font-mono text-lg font-bold tabular-nums text-white">
                        {(compareResult.ecoRoute.distanceMeters / 1000).toFixed(
                          1
                        )}{" "}
                        km
                      </p>
                    </div>
                    <div className="rounded-xl border border-[#1E2420] bg-[#0D0F0E] p-4">
                      <p className="text-xs text-neutral-400">Szacowany czas</p>
                      <p className="mt-1 font-mono text-lg font-bold tabular-nums text-white">
                        {Math.floor(
                          compareResult.ecoRoute.durationSeconds / 3600
                        )}
                        h{" "}
                        {Math.round(
                          (compareResult.ecoRoute.durationSeconds % 3600) / 60
                        )}
                        m
                      </p>
                    </div>
                    <div className="rounded-xl border border-[#1E2420] bg-[#0D0F0E] p-4">
                      <p className="text-xs text-neutral-400">
                        Szacowane zużycie
                      </p>
                      <p className="mt-1 font-mono text-lg font-bold tabular-nums text-emerald-400">
                        {compareResult.ecoRoute.fuelConsumptionLiters ?? "—"} l
                      </p>
                    </div>
                  </div>
                )}

                <div className="rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-display text-base font-semibold text-white">
                      Analiza połączeń i aktualnych cen paliw
                    </h3>
                    <div className="flex flex-wrap items-center gap-3">
                      {onBookStay && (
                        <button
                          type="button"
                          onClick={() =>
                            onBookStay({ city: toCity, autoTrigger: true })
                          }
                          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 cursor-pointer"
                        >
                          <BedDouble className="h-3.5 w-3.5" />
                          Zarezerwuj nocleg w: {toCity}
                        </button>
                      )}
                      <a
                        href={compareResult.googleMapsEcoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400 hover:underline"
                      >
                        Otwórz w Google Maps
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </div>
                  <div className="text-sm leading-relaxed text-neutral-200 whitespace-pre-wrap">
                    {compareResult.analysisText}
                  </div>
                  {compareResult.webSources.length > 0 && (
                    <div className="border-t border-[#1E2420] pt-3 flex flex-wrap gap-3">
                      {compareResult.webSources.slice(0, 5).map((s, idx) => (
                        <a
                          key={idx}
                          href={s.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-emerald-400 underline"
                        >
                          {s.title}
                        </a>
                      ))}
                    </div>
                  )}
                </div>

                {compareResult.fuelStations.length > 0 && (
                  <div className="rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-5">
                    <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-white">
                      <Fuel className="h-4 w-4 text-emerald-400" />
                      Stacje paliw na trasie
                    </h3>
                    <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      {compareResult.fuelStations.map((st, idx) => (
                        <a
                          key={idx}
                          href={st.googleMapsUri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-xl border border-[#1E2420] bg-[#090B0A] p-3 hover:border-emerald-500/40"
                        >
                          <p className="text-xs font-semibold text-white">
                            {st.name}
                          </p>
                          <p className="mt-0.5 text-[11px] text-neutral-400">
                            {st.address}
                          </p>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-8 text-center">
                <MapPin className="mx-auto h-8 w-8 text-neutral-500" />
                <p className="mt-3 text-sm font-medium text-white">
                  Gotowy na sprawdzenie trasy i przejazdów
                </p>
                <p className="mt-1 text-xs text-neutral-400">
                  Wpisz miasta po lewej, aby porównać pociągi, tramwaje i najoszczędniejszą trasę autem z cenami paliw.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
