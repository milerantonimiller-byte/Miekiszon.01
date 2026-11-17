import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMapView,
  Pin,
} from "@vis.gl/react-google-maps";
import {
  BedDouble,
  ExternalLink,
  Loader2,
  MapPin,
  Navigation,
  PhoneCall,
  Radio,
  Search,
  Star,
  X,
} from "lucide-react";
import type {
  FoodPlace,
  GeoLocation,
  LiveCallBarState,
  LiveFoodUpdate,
  StaySearchPrefill,
} from "../types";
import type { ExternalLiveCommand } from "./ChatVoiceStudio";

function formatTelHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

interface FoodPlacesFinderProps {
  location: GeoLocation | null;
  mapsApiKey: string;
  onRequestLocation: () => void;
  onBookStay?: (prefill: StaySearchPrefill) => void;
  liveFoodUpdate?: LiveFoodUpdate | null;
  liveCallState?: LiveCallBarState;
  onStartLiveCall?: () => void;
  onFoodContextNote?: (
    note: string,
    triggerReply?: boolean,
    syncPlaces?: ExternalLiveCommand["syncPlaces"]
  ) => void;
}

export const FoodPlacesFinder: React.FC<FoodPlacesFinderProps> = ({
  location,
  mapsApiKey,
  onRequestLocation,
  onBookStay,
  liveFoodUpdate,
  liveCallState,
  onStartLiveCall,
  onFoodContextNote,
}) => {
  const [places, setPlaces] = useState<FoodPlace[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<FoodPlace | null>(null);
  const [query, setQuery] = useState("");
  const [locationMode, setLocationMode] = useState<"gps" | "city" | "postal">(
    "gps"
  );
  const [city, setCity] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [radius, setRadius] = useState(2500);
  const [openNow, setOpenNow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchCenter, setSearchCenter] = useState<GeoLocation | null>(null);
  const [resolvedAreaLabel, setResolvedAreaLabel] = useState<string>("");
  const [groundingSummary, setGroundingSummary] = useState("");
  const [groundingLinks, setGroundingLinks] = useState<
    Array<{ title: string; uri: string }>
  >([]);
  const [liveCallCard, setLiveCallCard] = useState<{
    placeName: string;
    phone: string;
    dialHref: string;
    address?: string;
  } | null>(null);
  const lastLiveUpdateNonceRef = useRef<number | null>(null);
  const syncedLiveSessionRef = useRef(false);

  useEffect(() => {
    if (!liveCallState?.active) {
      syncedLiveSessionRef.current = false;
      return;
    }
    if (
      liveCallState.phase !== "connecting" &&
      places.length > 0 &&
      !syncedLiveSessionRef.current &&
      onFoodContextNote
    ) {
      syncedLiveSessionRef.current = true;
      const top3 = places
        .slice(0, 3)
        .map(
          (p, idx) =>
            `${idx + 1}. ${p.name} (${p.rating.toFixed(1)}★, ${p.address}${
              p.phone ? `, tel: ${p.phone}` : ""
            })`
        )
        .join("; ");
      onFoodContextNote(
        `Na ekranie użytkownika są już widoczne wyniki restauracji (${
          resolvedAreaLabel || "GPS"
        }). Top 3: ${top3}. Możesz do nich zadzwonić przez callPlacePhone, jeśli użytkownik poprosi.`,
        false,
        places
      );
    }
  }, [liveCallState?.active, liveCallState?.phase, places, resolvedAreaLabel, onFoodContextNote]);

  // Sync voice-initiated searches, restaurant selections, and phone calls from Live API tools
  useEffect(() => {
    if (
      !liveFoodUpdate ||
      liveFoodUpdate.nonce === lastLiveUpdateNonceRef.current
    ) {
      return;
    }
    lastLiveUpdateNonceRef.current = liveFoodUpdate.nonce;

    if (liveFoodUpdate.callPhone && liveFoodUpdate.callDialHref) {
      setLiveCallCard({
        placeName:
          liveFoodUpdate.callPlaceName ||
          liveFoodUpdate.selectedName ||
          "Wybrany lokal",
        phone: liveFoodUpdate.callPhone,
        dialHref: liveFoodUpdate.callDialHref,
        address: liveFoodUpdate.callAddress,
      });
    }

    if (liveFoodUpdate.places !== undefined) {
      if (liveFoodUpdate.locationMode) setLocationMode(liveFoodUpdate.locationMode);
      if (liveFoodUpdate.city !== undefined) setCity(liveFoodUpdate.city);
      if (liveFoodUpdate.postalCode !== undefined) {
        setPostalCode(liveFoodUpdate.postalCode);
      }
      if (liveFoodUpdate.query !== undefined) setQuery(liveFoodUpdate.query);
      if (liveFoodUpdate.radius !== undefined) setRadius(liveFoodUpdate.radius);
      if (liveFoodUpdate.openNow !== undefined) setOpenNow(liveFoodUpdate.openNow);

      setPlaces(liveFoodUpdate.places);
      setSearchCenter(liveFoodUpdate.center ?? location ?? null);
      setResolvedAreaLabel(liveFoodUpdate.resolvedAreaLabel ?? "");
      setGroundingSummary(liveFoodUpdate.groundingSummary ?? "");
      setGroundingLinks(liveFoodUpdate.groundingLinks ?? []);
      setSelectedPlace(liveFoodUpdate.places[0] ?? null);
      setError(null);
      return;
    }

    if (liveFoodUpdate.selectedIndex || liveFoodUpdate.selectedName) {
      const idx = liveFoodUpdate.selectedIndex
        ? liveFoodUpdate.selectedIndex - 1
        : -1;
      const byIndex = idx >= 0 && idx < places.length ? places[idx] : null;
      const byName = liveFoodUpdate.selectedName
        ? places.find((p) =>
            p.name
              .toLowerCase()
              .includes(liveFoodUpdate.selectedName!.toLowerCase())
          ) || null
        : null;
      const target = byIndex || byName;
      if (target) {
        setSelectedPlace(target);
      }
    }
  }, [liveFoodUpdate, location, places]);

  const searchFood = useCallback(async () => {
    if (locationMode === "gps" && !location) {
      onRequestLocation();
      return;
    }
    if (locationMode === "city" && !city.trim()) {
      setError("Wpisz nazwę miejscowości, aby wyszukać jedzenie.");
      return;
    }
    if (locationMode === "postal" && !postalCode.trim()) {
      setError("Wpisz kod pocztowy, aby wyszukać jedzenie.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/places/food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: location?.lat ?? null,
          lng: location?.lng ?? null,
          radius,
          query,
          openNow,
          locationMode,
          city: city.trim(),
          postalCode: postalCode.trim(),
        }),
      });
      const data = (await res.json()) as {
        places?: FoodPlace[];
        center?: GeoLocation | null;
        resolvedAreaLabel?: string;
        groundingSummary?: string;
        groundingLinks?: Array<{ title: string; uri: string }>;
        error?: string;
      };
      if (!res.ok || data.error) {
        throw new Error(data.error || "Błąd wyszukiwania restauracji.");
      }
      const nextPlaces = data.places ?? [];
      setPlaces(nextPlaces);
      setSearchCenter(data.center ?? location ?? null);
      setResolvedAreaLabel(data.resolvedAreaLabel ?? "");
      setGroundingSummary(data.groundingSummary ?? "");
      setGroundingLinks(data.groundingLinks ?? []);
      setSelectedPlace(nextPlaces[0] ?? null);

      if (liveCallState?.active && onFoodContextNote) {
        const top3 = nextPlaces
          .slice(0, 3)
          .map(
            (p, idx) =>
              `${idx + 1}. ${p.name} (${p.rating.toFixed(1)}★, ${p.address}${
                p.phone ? `, tel: ${p.phone}` : ""
              })`
          )
          .join("; ");
        onFoodContextNote(
          `Użytkownik wyszukał jedzenie na ekranie (obszar: ${
            data.resolvedAreaLabel || "GPS"
          }${query.trim() ? `, hasło: ${query.trim()}` : ""}). Znaleziono ${
            nextPlaces.length
          } lokali. Top 3: ${top3 || "brak szczegółów na liście"}. Krótko omów najlepsze opcje, wspomnij że możesz zadzwonić do wybranego lokalu (callPlacePhone) i zapytaj, którą wybrać.`,
          true,
          nextPlaces
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd wyszukiwania.");
    } finally {
      setLoading(false);
    }
  }, [
    city,
    liveCallState?.active,
    location,
    locationMode,
    onFoodContextNote,
    onRequestLocation,
    openNow,
    postalCode,
    query,
    radius,
  ]);

  useEffect(() => {
    if (
      !liveFoodUpdate?.places &&
      locationMode === "gps" &&
      location &&
      places.length === 0 &&
      !loading
    ) {
      void searchFood();
    }
  }, [location]);

  const activeMapCenter = selectedPlace
    ? { lat: selectedPlace.lat, lng: selectedPlace.lng }
    : searchCenter || location;

  const currentGuideStep = selectedPlace
    ? 3
    : places.length > 0
      ? 2
      : 1;

  return (
    <div className="space-y-6">
      {/* Live Voice Step-by-Step Guide Strip */}
      <section className="rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
            <Radio className="h-3.5 w-3.5 shrink-0" />
            <span>
              {liveCallState?.active
                ? "Rozmowa w czasie rzeczywistym trwa — Miękiszon prowadzi Cię krok po kroku"
                : "Asystent głosowy do jedzenia w okolicy"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-400">
            <span className={currentGuideStep === 1 ? "font-semibold text-white" : ""}>
              1. Określ miejsce (GPS / miejscowość / kod)
            </span>
            <span aria-hidden="true">→</span>
            <span className={currentGuideStep === 2 ? "font-semibold text-white" : ""}>
              2. Przejrzyj top oceny na mapie
            </span>
            <span aria-hidden="true">→</span>
            <span className={currentGuideStep === 3 ? "font-semibold text-white" : ""}>
              3. Zadzwoń lub uruchom nawigację
            </span>
          </div>
        </div>

        {!liveCallState?.active && onStartLiveCall && (
          <button
            type="button"
            onClick={onStartLiveCall}
            className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-xs font-semibold text-black hover:bg-emerald-400 whitespace-nowrap cursor-pointer"
          >
            <PhoneCall className="h-3.5 w-3.5" />
            Włącz rozmowę na żywo (prowadź mnie)
          </button>
        )}
      </section>

      {liveCallCard && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-500/45 bg-emerald-500/12 px-4 py-3.5">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-emerald-300">
              Asystent przygotował połączenie telefoniczne
            </p>
            <p className="mt-0.5 text-sm font-bold text-white">
              {liveCallCard.placeName}{" "}
              <span className="font-mono text-emerald-300">
                · {liveCallCard.phone}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={liveCallCard.dialHref}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-emerald-500 px-4 text-xs font-semibold text-black hover:bg-emerald-400 whitespace-nowrap"
            >
              <PhoneCall className="h-3.5 w-3.5" />
              Zadzwoń teraz
            </a>
            <button
              type="button"
              onClick={() => setLiveCallCard(null)}
              aria-label="Zamknij kartę połączenia"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#242B26] text-neutral-400 hover:text-white cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </section>
      )}

      {/* Search & Filter Toolbar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void searchFood();
        }}
        className="space-y-3 rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-4"
      >
        {/* Location Method Switcher */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="group"
            aria-label="Sposób określenia lokalizacji"
            className="inline-flex flex-wrap gap-1.5 rounded-xl border border-[#222824] bg-[#050506] p-1"
          >
            <button
              type="button"
              onClick={() => {
                setLocationMode("gps");
                setError(null);
              }}
              className={`min-h-[38px] rounded-lg px-3 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                locationMode === "gps"
                  ? "bg-emerald-500 text-black"
                  : "text-neutral-300 hover:text-white"
              }`}
            >
              W promieniu (GPS)
            </button>
            <button
              type="button"
              onClick={() => {
                setLocationMode("city");
                setError(null);
              }}
              className={`min-h-[38px] rounded-lg px-3 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                locationMode === "city"
                  ? "bg-emerald-500 text-black"
                  : "text-neutral-300 hover:text-white"
              }`}
            >
              Po miejscowości
            </button>
            <button
              type="button"
              onClick={() => {
                setLocationMode("postal");
                setError(null);
              }}
              className={`min-h-[38px] rounded-lg px-3 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                locationMode === "postal"
                  ? "bg-emerald-500 text-black"
                  : "text-neutral-300 hover:text-white"
              }`}
            >
              Po kodzie pocztowym
            </button>
          </div>

          {resolvedAreaLabel && (
            <p className="flex items-center gap-1.5 text-xs text-emerald-400">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span>Obszar: {resolvedAreaLabel}</span>
            </p>
          )}
        </div>

        {/* Inputs & Actions */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-neutral-500" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Czego szukasz? (np. pizza, sushi, kebab — opcjonalnie)"
              className="min-h-[44px] w-full rounded-xl border border-[#222824] bg-[#050506] pl-10 pr-4 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {locationMode === "gps" && (
            <select
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              className="min-h-[44px] rounded-xl border border-[#222824] bg-[#050506] px-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value={1000}>Promień: 1 km</option>
              <option value={2500}>Promień: 2.5 km</option>
              <option value={5000}>Promień: 5 km</option>
              <option value={10000}>Promień: 10 km</option>
            </select>
          )}

          {locationMode === "city" && (
            <div className="relative min-w-[210px] flex-1 sm:max-w-[260px]">
              <MapPin className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-emerald-400" />
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Miejscowość (np. Kraków, Sopot)"
                className="min-h-[44px] w-full rounded-xl border border-[#222824] bg-[#050506] pl-10 pr-4 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          )}

          {locationMode === "postal" && (
            <div className="relative min-w-[190px] sm:max-w-[230px]">
              <MapPin className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-emerald-400" />
              <input
                type="text"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                placeholder="Kod pocztowy (np. 00-001)"
                className="min-h-[44px] w-full rounded-xl border border-[#222824] bg-[#050506] pl-10 pr-4 text-sm font-mono text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          )}

          <label className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#222824] bg-[#050506] px-3.5 text-xs font-medium text-neutral-200 cursor-pointer whitespace-nowrap">
            <input
              type="checkbox"
              checked={openNow}
              onChange={(e) => setOpenNow(e.target.checked)}
              className="h-4 w-4 accent-emerald-500"
            />
            Otwarte teraz
          </label>

          <button
            type="submit"
            disabled={loading}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-60 whitespace-nowrap cursor-pointer"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Navigation className="h-4 w-4" />
            )}
            Szukaj najlepszego jedzenia
          </button>

          {onBookStay && (
            <button
              type="button"
              onClick={() =>
                onBookStay({
                  city:
                    locationMode === "city"
                      ? city.trim()
                      : locationMode === "postal"
                        ? postalCode.trim()
                        : query.trim() || "",
                  autoTrigger: true,
                })
              }
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/15 px-4 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 whitespace-nowrap cursor-pointer"
            >
              <BedDouble className="h-4 w-4" />
              Noclegi w okolicy
            </button>
          )}
        </div>
      </form>

      {locationMode === "gps" && !location && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-amber-200">
            Udostępnij lokalizację GPS, aby wyszukać restauracje w promieniu wokół Ciebie — albo wybierz „Po miejscowości” lub „Po kodzie pocztowym” powyżej.
          </p>
          <button
            type="button"
            onClick={onRequestLocation}
            className="min-h-[42px] rounded-xl bg-amber-400 px-4 text-xs font-semibold text-black hover:bg-amber-300 cursor-pointer"
          >
            Włącz lokalizację GPS
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Interactive Google Map */}
        <div className="overflow-hidden rounded-2xl border border-[#1E2420] bg-[#0D0F0E] lg:col-span-7">
          {mapsApiKey && activeMapCenter ? (
            <div className="h-[440px] w-full lg:h-[520px]">
              <GoogleMapView
                defaultCenter={activeMapCenter}
                center={activeMapCenter}
                defaultZoom={14}
                mapId="DEMO_MAP_ID"
                gestureHandling="greedy"
                internalUsageAttributionIds={["gmp_mcp_codeassist_v1_aistudio"]}
                style={{ width: "100%", height: "100%" }}
              >
                {(searchCenter || location) && (
                  <AdvancedMarker
                    position={(searchCenter || location)!}
                    title={resolvedAreaLabel || "Twoja lokalizacja"}
                  >
                    <Pin
                      background="#3B82F6"
                      borderColor="#1D4ED8"
                      glyphColor="#FFFFFF"
                    />
                  </AdvancedMarker>
                )}

                {places.map((p) => (
                  <AdvancedMarker
                    key={p.id}
                    position={{ lat: p.lat, lng: p.lng }}
                    title={p.name}
                    onClick={() => setSelectedPlace(p)}
                  >
                    <Pin
                      background={
                        selectedPlace?.id === p.id ? "#22C55E" : "#15803D"
                      }
                      borderColor="#4ADE80"
                      glyphColor="#FFFFFF"
                    />
                  </AdvancedMarker>
                ))}

                {selectedPlace && (
                  <InfoWindow
                    position={{
                      lat: selectedPlace.lat,
                      lng: selectedPlace.lng,
                    }}
                    onCloseClick={() => setSelectedPlace(null)}
                  >
                    <div className="p-1 text-neutral-900 max-w-[230px]">
                      <p className="font-bold text-sm">{selectedPlace.name}</p>
                      <p className="text-xs text-neutral-600 mt-0.5">
                        {selectedPlace.rating.toFixed(1)} ★ (
                        {selectedPlace.userRatingCount} opinii)
                      </p>
                      <p className="text-xs text-neutral-700 mt-1">
                        {selectedPlace.address}
                      </p>
                      {selectedPlace.phone && (
                        <p className="text-xs font-mono font-semibold text-neutral-900 mt-1">
                          Tel: {selectedPlace.phone}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        {selectedPlace.phone && (
                          <a
                            href={formatTelHref(selectedPlace.phone)}
                            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white no-underline hover:bg-emerald-500"
                          >
                            Zadzwoń
                          </a>
                        )}
                        <a
                          href={selectedPlace.googleMapsUri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block text-xs font-semibold text-emerald-700 underline"
                        >
                          Otwórz w Google Maps
                        </a>
                      </div>
                    </div>
                  </InfoWindow>
                )}
              </GoogleMapView>
            </div>
          ) : (
            <div className="flex h-[440px] flex-col items-center justify-center p-6 text-center">
              <MapPin className="h-8 w-8 text-emerald-400" />
              <p className="mt-3 text-sm font-medium text-white">
                {locationMode === "gps"
                  ? "Oczekiwanie na lokalizację lub klucz Google Maps"
                  : "Wpisz miejscowość lub kod pocztowy i kliknij Szukaj"}
              </p>
              <p className="mt-1 text-xs text-neutral-400">
                Rekomendacje z Google Maps pojawią się na liście obok.
              </p>
            </div>
          )}
        </div>

        {/* Ranked Top-Rated Restaurants List */}
        <div className="flex max-h-[520px] flex-col gap-3 overflow-y-auto lg:col-span-5">
          {places.length > 0 ? (
            places.map((p, idx) => (
              <div
                key={p.id}
                onClick={() => setSelectedPlace(p)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setSelectedPlace(p);
                }}
                className={`rounded-2xl border p-4 transition-colors cursor-pointer ${
                  selectedPlace?.id === p.id
                    ? "border-emerald-500/60 bg-[#131A15]"
                    : "border-[#1E2420] bg-[#0D0F0E] hover:border-[#2C3630]"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-neutral-400">
                      <span className="font-mono font-semibold text-emerald-400">
                        #{idx + 1}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{p.category}</span>
                      {p.openNow !== undefined && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span
                            className={
                              p.openNow ? "text-emerald-400" : "text-red-400"
                            }
                          >
                            {p.openNow ? "Otwarte" : "Zamknięte"}
                          </span>
                        </>
                      )}
                    </div>
                    <h3 className="mt-1 font-display text-base font-semibold text-white">
                      {p.name}
                    </h3>
                    <p className="mt-0.5 text-xs text-neutral-400">
                      {p.address}
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="inline-flex items-center gap-1 font-mono text-sm font-bold tabular-nums text-amber-400">
                      <Star className="h-4 w-4 fill-amber-400" />
                      {p.rating ? p.rating.toFixed(1) : "—"}
                    </div>
                    <p className="text-[11px] font-mono tabular-nums text-neutral-500">
                      {p.userRatingCount} opinii
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#1E2420] pt-2.5">
                  {p.phone ? (
                    <a
                      href={formatTelHref(p.phone)}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 text-xs font-semibold text-black hover:bg-emerald-400"
                    >
                      <PhoneCall className="h-3.5 w-3.5" />
                      <span>Zadzwoń</span>
                      <span className="font-mono text-[11px] font-medium opacity-85">
                        ({p.phone})
                      </span>
                    </a>
                  ) : (
                    <span className="text-[11px] text-neutral-500">
                      Brak numeru tel. w wizytówce Google
                    </span>
                  )}

                  <a
                    href={p.googleMapsUri}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:underline"
                  >
                    Nawiguj w Google Maps
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-5">
              <h3 className="font-display text-sm font-semibold text-white">
                Rekomendacje Google Maps (Gemini Grounding)
              </h3>
              {loading ? (
                <p className="mt-2 text-xs text-neutral-400">
                  Sprawdzam najlepsze lokale w okolicy...
                </p>
              ) : groundingSummary ? (
                <div className="mt-2 space-y-3 text-xs leading-relaxed text-neutral-300 whitespace-pre-wrap">
                  {groundingSummary}
                  {groundingLinks.length > 0 && (
                    <div className="border-t border-[#1E2420] pt-2 space-y-1">
                      {groundingLinks.map((l, i) => (
                        <a
                          key={i}
                          href={l.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-emerald-400 underline"
                        >
                          {l.title}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-xs text-neutral-400">
                  Kliknij „Szukaj najlepszego jedzenia”, aby wyświetlić listę restauracji z ocenami Google.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
