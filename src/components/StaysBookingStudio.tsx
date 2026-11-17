import React, { useCallback, useEffect, useState } from "react";
import {
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMapView,
  Pin,
} from "@vis.gl/react-google-maps";
import {
  BedDouble,
  CalendarCheck,
  Check,
  ExternalLink,
  Globe,
  Loader2,
  MapPin,
  PhoneCall,
  Search,
  Sparkles,
  Star,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import type {
  AppEvent,
  GeoLocation,
  StayBookingRecord,
  StaySearchPrefill,
  VoicePreset,
} from "../types";
import type { ExternalLiveCommand } from "./ChatVoiceStudio";
import { speakWithMiekiszon } from "../utils/ttsPlayer";

function formatTelHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

interface StayResult {
  id: string;
  name: string;
  address: string;
  phone?: string;
  internationalPhone?: string;
  rating: number;
  userRatingCount: number;
  priceLevel?: string;
  googleMapsUri: string;
  websiteUri?: string;
  bookingComUrl: string;
  googleHotelsUrl: string;
  lat: number;
  lng: number;
  category: string;
  autoRecommended?: boolean;
}

interface StaysBookingStudioProps {
  location: GeoLocation | null;
  mapsApiKey: string;
  voicePreset: VoicePreset;
  prefill: StaySearchPrefill | null;
  liveCallActive?: boolean;
  onSyncStaysToLive?: (
    note: string,
    syncPlaces: ExternalLiveCommand["syncPlaces"]
  ) => void;
}

function defaultDateOffset(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

export const StaysBookingStudio: React.FC<StaysBookingStudioProps> = ({
  location,
  mapsApiKey,
  voicePreset,
  prefill,
  liveCallActive,
  onSyncStaysToLive,
}) => {
  const [city, setCity] = useState(prefill?.city || "Kraków");
  const [checkIn, setCheckIn] = useState(
    prefill?.checkIn || defaultDateOffset(1)
  );
  const [checkOut, setCheckOut] = useState(
    prefill?.checkOut || defaultDateOffset(3)
  );
  const [guests, setGuests] = useState(prefill?.guests || 2);
  const [rooms, setRooms] = useState(1);
  const [lodgingType, setLodgingType] = useState<
    "all" | "hotel" | "apartment" | "guesthouse"
  >("all");
  const [minRating, setMinRating] = useState(4.0);
  const [maxBudgetPln, setMaxBudgetPln] = useState<string>("550");
  const [autoSelectTop, setAutoSelectTop] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stays, setStays] = useState<StayResult[]>([]);
  const [groundingSummary, setGroundingSummary] = useState("");
  const [webSources, setWebSources] = useState<
    Array<{ title: string; uri: string }>
  >([]);
  const [selectedStay, setSelectedStay] = useState<StayResult | null>(null);

  // Automatic booking modal state
  const [bookingCandidate, setBookingCandidate] = useState<StayResult | null>(
    null
  );
  const [addToEvents, setAddToEvents] = useState(true);
  const [executingBooking, setExecutingBooking] = useState(false);
  const [bookingStatusMsg, setBookingStatusMsg] = useState<string | null>(null);

  const [bookings, setBookings] = useState<StayBookingRecord[]>(() => {
    try {
      const saved = localStorage.getItem("miekiszon_stay_bookings");
      return saved ? (JSON.parse(saved) as StayBookingRecord[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem("miekiszon_stay_bookings", JSON.stringify(bookings));
  }, [bookings]);

  const runSearch = useCallback(
    async (overrideCity?: string, useGps = false) => {
      setLoading(true);
      setError(null);
      setSelectedStay(null);
      setBookingStatusMsg(null);
      try {
        const queryCity = useGps ? "" : overrideCity ?? city;
        const res = await fetch("/api/stays/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            city: queryCity,
            lat: location?.lat ?? null,
            lng: location?.lng ?? null,
            checkIn,
            checkOut,
            guests,
            rooms,
            lodgingType,
            minRating,
            maxBudgetPln: maxBudgetPln ? Number(maxBudgetPln) : null,
          }),
        });
        const data = (await res.json()) as {
          stays?: StayResult[];
          groundingSummary?: string;
          webSources?: Array<{ title: string; uri: string }>;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || "Nie udało się wyszukać noclegów.");
        }
        const list = data.stays ?? [];
        setStays(list);
        setGroundingSummary(data.groundingSummary || "");
        setWebSources(data.webSources || []);
        if (list.length > 0) {
          setSelectedStay(list[0]);
          if (autoSelectTop) {
            setBookingCandidate(list[0]);
          }
          if (liveCallActive && onSyncStaysToLive) {
            const topSummary = list
              .slice(0, 3)
              .map(
                (s, i) =>
                  `${i + 1}. ${s.name} (${s.rating.toFixed(1)}★${
                    s.phone ? `, tel: ${s.phone}` : ""
                  })`
              )
              .join("; ");
            onSyncStaysToLive(
              `Użytkownik wyszukał noclegi (${queryCity || "GPS"}). Top 3: ${topSummary}. Możesz zadzwonić do wybranego obiektu za pomocą callPlacePhone.`,
              list
            );
          }
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Błąd wyszukiwania noclegów."
        );
      } finally {
        setLoading(false);
      }
    },
    [
      city,
      location,
      checkIn,
      checkOut,
      guests,
      rooms,
      lodgingType,
      minRating,
      maxBudgetPln,
      autoSelectTop,
      liveCallActive,
      onSyncStaysToLive,
    ]
  );

  // Sync incoming prefill from other tabs (Routes, Events, Food, Chat)
  useEffect(() => {
    if (!prefill) return;
    if (prefill.city) setCity(prefill.city);
    if (prefill.checkIn) {
      setCheckIn(prefill.checkIn);
      if (!prefill.checkOut) {
        const d = new Date(prefill.checkIn);
        if (!Number.isNaN(d.getTime())) {
          setCheckOut(
            new Date(d.getTime() + 2 * 86400000).toISOString().slice(0, 10)
          );
        }
      }
    }
    if (prefill.checkOut) setCheckOut(prefill.checkOut);
    if (prefill.guests) setGuests(prefill.guests);
    if (prefill.autoTrigger && prefill.city) {
      void runSearch(prefill.city, false);
    }
  }, [prefill?.nonce]);

  const handleConfirmAutomaticBooking = () => {
    if (!bookingCandidate) return;
    setExecutingBooking(true);
    setError(null);

    try {
      if (addToEvents) {
        const localEvent: AppEvent = {
          id: `stay-${Date.now()}`,
          title: `Nocleg: ${bookingCandidate.name}`,
          date: checkIn,
          time: "15:00",
          location: bookingCandidate.address,
          category: "Podróż",
          source: "local",
        };
        try {
          const existing = JSON.parse(
            localStorage.getItem("miekiszon_events") || "[]"
          ) as AppEvent[];
          localStorage.setItem(
            "miekiszon_events",
            JSON.stringify([localEvent, ...existing])
          );
        } catch {
          // ignore
        }
      }

      const record: StayBookingRecord = {
        id: crypto.randomUUID(),
        propertyName: bookingCandidate.name,
        address: bookingCandidate.address,
        phone: bookingCandidate.phone,
        checkIn,
        checkOut,
        guests,
        rooms,
        bookingComUrl: bookingCandidate.bookingComUrl,
        googleHotelsUrl: bookingCandidate.googleHotelsUrl,
        websiteUri: bookingCandidate.websiteUri,
        addedToEvents: addToEvents,
        status: "Przygotowana automatycznie",
        createdAt: new Date().toLocaleTimeString("pl-PL", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };

      setBookings((prev) => [record, ...prev]);
      setBookingStatusMsg(
        `Przygotowano automatyczną rezerwację dla „${bookingCandidate.name}” (${checkIn} – ${checkOut}). Kliknij poniżej na Booking.com lub stronę obiektu, aby zatwierdzić rezerwację.`
      );
      setBookingCandidate(null);
      if (voicePreset !== "off") {
        void speakWithMiekiszon(
          `Gotowe! Przygotowałam rezerwację noclegu w ${bookingCandidate.name} od ${checkIn} do ${checkOut}.`,
          voicePreset
        );
      }
    } finally {
      setExecutingBooking(false);
    }
  };

  const mapCenter = selectedStay
    ? { lat: selectedStay.lat, lng: selectedStay.lng }
    : stays[0]
      ? { lat: stays[0].lat, lng: stays[0].lng }
      : location || { lat: 50.0647, lng: 19.945 };

  return (
    <div className="space-y-6">
      {/* Search & Auto-Booking Criteria */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void runSearch(city, false);
        }}
        className="rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-white flex items-center gap-2">
              <BedDouble className="h-5 w-5 text-emerald-400" />
              Bukowanie noclegów i Automatyczna Rezerwacja
            </h2>
            <p className="mt-0.5 text-xs text-neutral-400">
              Miękiszon wyszukuje najwyżej oceniane hotele i apartamenty,
              automatycznie dobiera najlepszy obiekt i przygotowuje gotowy link
              rezerwacyjny bez logowania.
            </p>
          </div>
          {location && (
            <button
              type="button"
              onClick={() => void runSearch("", true)}
              disabled={loading}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#242B26] bg-[#141816] px-3.5 text-xs font-semibold text-neutral-200 hover:border-emerald-500/40 cursor-pointer"
            >
              <MapPin className="h-3.5 w-3.5 text-emerald-400" />
              Szukaj blisko mojego GPS
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-2">
            <label className="block text-xs font-medium text-neutral-300">
              Miasto lub dzielnica
            </label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Np. Kraków, Gdańsk, Zakopane..."
              className="mt-1 min-h-[42px] w-full rounded-xl border border-[#242B26] bg-[#050506] px-3.5 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-300">
              Zameldowanie
            </label>
            <input
              type="date"
              value={checkIn}
              onChange={(e) => setCheckIn(e.target.value)}
              className="mt-1 min-h-[42px] w-full rounded-xl border border-[#242B26] bg-[#050506] px-3 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-300">
              Wymeldowanie
            </label>
            <input
              type="date"
              value={checkOut}
              onChange={(e) => setCheckOut(e.target.value)}
              className="mt-1 min-h-[42px] w-full rounded-xl border border-[#242B26] bg-[#050506] px-3 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-300">
              Goście / Pokoje
            </label>
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              <select
                value={guests}
                onChange={(e) => setGuests(Number(e.target.value))}
                aria-label="Liczba gości"
                className="min-h-[42px] rounded-xl border border-[#242B26] bg-[#050506] px-2 text-xs text-white"
              >
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n} os.
                  </option>
                ))}
              </select>
              <select
                value={rooms}
                onChange={(e) => setRooms(Number(e.target.value))}
                aria-label="Liczba pokoi"
                className="min-h-[42px] rounded-xl border border-[#242B26] bg-[#050506] px-2 text-xs text-white"
              >
                {[1, 2, 3, 4].map((r) => (
                  <option key={r} value={r}>
                    {r} pok.
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-300">
              Typ i ocena min.
            </label>
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              <select
                value={lodgingType}
                onChange={(e) =>
                  setLodgingType(e.target.value as typeof lodgingType)
                }
                aria-label="Typ noclegu"
                className="min-h-[42px] rounded-xl border border-[#242B26] bg-[#050506] px-2 text-xs text-white"
              >
                <option value="all">Wszystkie</option>
                <option value="hotel">Hotel</option>
                <option value="apartment">Apartament</option>
                <option value="guesthouse">Pensjonat</option>
              </select>
              <select
                value={minRating}
                onChange={(e) => setMinRating(Number(e.target.value))}
                aria-label="Minimalna ocena Google"
                className="min-h-[42px] rounded-xl border border-[#242B26] bg-[#050506] px-2 font-mono text-xs text-white"
              >
                <option value={3.5}>3.5★+</option>
                <option value={4.0}>4.0★+</option>
                <option value={4.5}>4.5★+</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#1E2420] pt-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-400">Budżet max (PLN/noc):</span>
              <input
                type="number"
                value={maxBudgetPln}
                onChange={(e) => setMaxBudgetPln(e.target.value)}
                placeholder="550"
                className="w-24 min-h-[38px] rounded-lg border border-[#242B26] bg-[#050506] px-3 font-mono text-xs text-white"
              />
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-neutral-300 cursor-pointer">
              <input
                type="checkbox"
                checked={autoSelectTop}
                onChange={(e) => setAutoSelectTop(e.target.checked)}
                className="h-4 w-4 accent-emerald-500"
              />
              <span>Automatycznie zaznacz najlepszy obiekt po znalezieniu</span>
            </label>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 text-xs font-semibold text-black hover:bg-emerald-400 disabled:opacity-60 cursor-pointer"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            {autoSelectTop
              ? "Szukaj i dobierz automatycznie"
              : "Wyszukaj noclegi"}
          </button>
        </div>
      </form>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-200">
          {error}
        </div>
      )}

      {bookingStatusMsg && (
        <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">
          {bookingStatusMsg}
        </div>
      )}

      {/* Results: Map + Stays + My Bookings */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Found stays + AI Summary */}
        <div className="space-y-4 lg:col-span-7">
          {stays.length > 0 ? (
            <div className="space-y-3">
              {stays.map((st, idx) => {
                const isSelected = selectedStay?.id === st.id;
                return (
                  <div
                    key={st.id}
                    onClick={() => setSelectedStay(st)}
                    className={`rounded-2xl border p-4 transition-colors cursor-pointer ${
                      isSelected
                        ? "border-emerald-500 bg-emerald-500/10"
                        : "border-[#1E2420] bg-[#0D0F0E] hover:border-[#2E3831]"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                          <span className="font-mono font-bold text-emerald-400">
                            #{idx + 1}
                          </span>
                          {st.autoRecommended && (
                            <>
                              <span>·</span>
                              <span className="inline-flex items-center gap-1 font-semibold text-emerald-300">
                                <Sparkles className="h-3.5 w-3.5" />
                                Automatyczny wybór Miękiszona
                              </span>
                            </>
                          )}
                          <span>·</span>
                          <span>{st.category}</span>
                        </div>

                        <h3 className="mt-1 font-display text-base font-bold text-white">
                          {st.name}
                        </h3>
                        <p className="mt-0.5 text-xs text-neutral-400">
                          {st.address}
                        </p>
                      </div>

                      <div className="flex items-center gap-1 rounded-lg border border-[#242B26] bg-[#050506] px-2.5 py-1 text-xs font-mono tabular-nums text-white">
                        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                        <span>{st.rating ? st.rating.toFixed(1) : "—"}</span>
                        <span className="text-neutral-500">
                          ({st.userRatingCount})
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setBookingCandidate(st);
                        }}
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 text-xs font-semibold text-black hover:bg-emerald-400 cursor-pointer"
                      >
                        <CalendarCheck className="h-3.5 w-3.5" />
                        Zarezerwuj automatycznie
                      </button>

                      <a
                        href={st.bookingComUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[#242B26] bg-[#141816] px-3 text-xs font-medium text-neutral-200 hover:border-emerald-500/40"
                      >
                        Booking.com
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>

                      <a
                        href={st.googleHotelsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[#242B26] bg-[#141816] px-3 text-xs font-medium text-neutral-200 hover:border-emerald-500/40"
                      >
                        Google Hotels
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>

                      {st.websiteUri && (
                        <a
                          href={st.websiteUri}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[#242B26] bg-[#141816] px-3 text-xs font-medium text-neutral-200 hover:border-emerald-500/40"
                        >
                          <Globe className="h-3.5 w-3.5 text-emerald-400" />
                          Strona obiektu
                        </a>
                      )}

                      {st.phone && (
                        <a
                          href={formatTelHref(st.phone)}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25"
                        >
                          <PhoneCall className="h-3.5 w-3.5" />
                          Zadzwoń ({st.phone})
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-[#242B26] bg-[#0D0F0E] p-8 text-center">
              <BedDouble className="mx-auto h-8 w-8 text-emerald-400/70" />
              <p className="mt-3 text-sm font-medium text-white">
                Wpisz miasto i termin, aby wyszukać noclegi
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                Możesz też kliknąć przycisk rezerwacji noclegu bezpośrednio z
                zakładki Trasy, Wydarzenia lub Jedzenie.
              </p>
            </div>
          )}

          {groundingSummary && (
            <div className="rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-display text-sm font-semibold text-white">
                  Rekomendacja cenowa i dostępność (Miękiszon)
                </h4>
                <button
                  type="button"
                  onClick={() =>
                    speakWithMiekiszon(groundingSummary, voicePreset)
                  }
                  className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 cursor-pointer"
                >
                  <Volume2 className="h-3.5 w-3.5" />
                  Odsłuchaj
                </button>
              </div>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-neutral-300">
                {groundingSummary}
              </p>
              {webSources.length > 0 && (
                <div className="flex flex-wrap gap-3 border-t border-[#1E2420] pt-2.5">
                  {webSources.slice(0, 4).map((w, i) => (
                    <a
                      key={i}
                      href={w.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-emerald-400 underline"
                    >
                      {w.title}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Map + Saved / Prepared Automatic Bookings */}
        <div className="space-y-4 lg:col-span-5">
          {mapsApiKey && (
            <div className="h-[280px] overflow-hidden rounded-2xl border border-[#1E2420] bg-[#0D0F0E]">
              <GoogleMapView
                center={mapCenter}
                zoom={13}
                mapId="DEMO_MAP_ID"
                gestureHandling="greedy"
                internalUsageAttributionIds={[
                  "gmp_mcp_codeassist_v1_aistudio",
                ]}
                style={{ width: "100%", height: "100%" }}
              >
                {stays.map((st, idx) => (
                  <AdvancedMarker
                    key={st.id}
                    position={{ lat: st.lat, lng: st.lng }}
                    onClick={() => setSelectedStay(st)}
                    title={st.name}
                  >
                    <Pin
                      background={
                        selectedStay?.id === st.id ? "#22C55E" : "#141715"
                      }
                      glyphColor={
                        selectedStay?.id === st.id ? "#050506" : "#4ADE80"
                      }
                      borderColor="#22C55E"
                      glyph={`${idx + 1}`}
                    />
                  </AdvancedMarker>
                ))}
                {selectedStay && (
                  <InfoWindow
                    position={{ lat: selectedStay.lat, lng: selectedStay.lng }}
                    onCloseClick={() => setSelectedStay(null)}
                  >
                    <div className="max-w-[215px] text-xs text-neutral-900">
                      <p className="font-bold">{selectedStay.name}</p>
                      <p className="mt-0.5 text-neutral-600">
                        {selectedStay.rating
                          ? `${selectedStay.rating.toFixed(1)}★`
                          : "Brak oceny"}{" "}
                        · {selectedStay.category}
                      </p>
                      {selectedStay.phone && (
                        <div className="mt-1.5">
                          <a
                            href={formatTelHref(selectedStay.phone)}
                            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white no-underline hover:bg-emerald-500"
                          >
                            Zadzwoń: {selectedStay.phone}
                          </a>
                        </div>
                      )}
                    </div>
                  </InfoWindow>
                )}
              </GoogleMapView>
            </div>
          )}

          {/* My Prepared / Booked Stays */}
          <div className="rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold text-white">
                Moje rezerwacje noclegów ({bookings.length})
              </h3>
              <span className="text-[11px] text-neutral-500">
                Zapisane automatycznie
              </span>
            </div>

            {bookings.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[#242B26] bg-[#050506] p-4 text-center text-xs text-neutral-500">
                Brak zapisanych rezerwacji. Wybierz obiekt i kliknij „Zarezerwuj
                automatycznie”.
              </p>
            ) : (
              <div className="max-h-[340px] space-y-2.5 overflow-y-auto pr-1">
                {bookings.map((b) => (
                  <div
                    key={b.id}
                    className="rounded-xl border border-[#242B26] bg-[#050506] p-3.5 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-white">
                          {b.propertyName}
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] text-emerald-400">
                          {b.checkIn} → {b.checkOut} · {b.guests} os. ·{" "}
                          {b.rooms} pok.
                        </p>
                        <p className="mt-0.5 text-[11px] text-neutral-400">
                          {b.status}
                          {b.addedToEvents ? " · Dodano do Wydarzeń" : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setBookings((prev) =>
                            prev.filter((item) => item.id !== b.id)
                          )
                        }
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-500 hover:bg-red-500/15 hover:text-red-300 cursor-pointer"
                        aria-label="Usuń rezerwację"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <a
                        href={b.bookingComUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/35 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/25"
                      >
                        Dokończ na Booking.com
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      <a
                        href={b.googleHotelsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-[#242B26] bg-[#141816] px-2.5 py-1 text-[11px] text-neutral-300 hover:text-white"
                      >
                        Google Hotels
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      {b.phone && (
                        <a
                          href={formatTelHref(b.phone)}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/35 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/25"
                        >
                          <PhoneCall className="h-3 w-3" />
                          Zadzwoń ({b.phone})
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Explicit Confirmation Modal for Automatic Booking Execution */}
      {bookingCandidate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-2xl border border-[#242B26] bg-[#0D0F0E] p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-emerald-400">
                  Automatyczna rezerwacja Miękiszona
                </p>
                <h3 className="mt-0.5 font-display text-lg font-bold text-white">
                  {bookingCandidate.name}
                </h3>
                <p className="text-xs text-neutral-400">
                  {bookingCandidate.address}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBookingCandidate(null)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2.5 rounded-xl border border-[#242B26] bg-[#050506] p-3.5 text-xs">
              <div>
                <span className="text-neutral-500">Zameldowanie:</span>
                <p className="font-mono font-semibold text-white">{checkIn}</p>
              </div>
              <div>
                <span className="text-neutral-500">Wymeldowanie:</span>
                <p className="font-mono font-semibold text-white">{checkOut}</p>
              </div>
              <div>
                <span className="text-neutral-500">Goście / Pokoje:</span>
                <p className="font-semibold text-white">
                  {guests} os. · {rooms} pok.
                </p>
              </div>
            </div>

            <label className="flex items-center gap-2.5 text-xs text-neutral-200 cursor-pointer">
              <input
                type="checkbox"
                checked={addToEvents}
                onChange={(e) => setAddToEvents(e.target.checked)}
                className="h-4 w-4 accent-emerald-500"
              />
              <span>Automatycznie zapisz termin pobytu w zakładce Wydarzenia</span>
            </label>

            <div className="flex flex-wrap gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setBookingCandidate(null)}
                className="min-h-[44px] flex-1 rounded-xl border border-[#242B26] bg-[#141816] text-xs font-semibold text-neutral-300 hover:text-white cursor-pointer"
              >
                Anuluj
              </button>
              <button
                type="button"
                disabled={executingBooking}
                onClick={handleConfirmAutomaticBooking}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-4 text-xs font-semibold text-black hover:bg-emerald-400 disabled:opacity-60 cursor-pointer"
              >
                {executingBooking ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Zapisz i przygotuj rezerwację
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
