import React, { useCallback, useEffect, useRef, useState } from "react";
import { APIProvider } from "@vis.gl/react-google-maps";
import {
  BedDouble,
  ChevronRight,
  LayoutGrid,
  MapPin,
  Menu,
  MessageCircle,
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  Radio,
  Sparkles,
  Square,
  Utensils,
  WifiOff,
  X,
} from "lucide-react";
import {
  ChatVoiceStudio,
  type ExternalLiveCommand,
} from "./components/ChatVoiceStudio";
import { EventsScreen } from "./components/EventsScreen";
import { FoodPlacesFinder } from "./components/FoodPlacesFinder";
import { LiveVisionStudio } from "./components/LiveVisionStudio";
import { MediaPdfStudio } from "./components/MediaPdfStudio";
import { OverviewScreen, type SubcategoryTarget } from "./components/OverviewScreen";
import { PhoneWhatsAppGmailHub } from "./components/PhoneWhatsAppGmailHub";
import { PickleLogo, WeatherHeaderWidget } from "./components/PickleLogo";
import { PWAInstallButton } from "./components/PWAInstallButton";
import { RoutesAndTravelPlanner } from "./components/RoutesAndTravelPlanner";
import { StaysBookingStudio } from "./components/StaysBookingStudio";
import { useOnlineStatus } from "./hooks/useOnlineStatus";
import type {
  GeoLocation,
  LiveCallBarState,
  LiveFoodUpdate,
  MediaSubTab,
  PhoneSubSection,
  RoutesSubMode,
  StaySearchPrefill,
  VoicePreset,
  WeatherData,
  WorkspaceTab,
} from "./types";

const LEFT_NAV_TABS: Array<{
  id: WorkspaceTab;
  label: string;
  shortLabel: string;
  icon: React.FC<{ className?: string }>;
}> = [
  {
    id: "overview",
    label: "Ekran główny",
    shortLabel: "Główny",
    icon: LayoutGrid,
  },
  {
    id: "chat",
    label: "Głos asystentki",
    shortLabel: "Głos",
    icon: MessageCircle,
  },
  {
    id: "food",
    label: "Jedzenie w okolicy",
    shortLabel: "Jedzenie",
    icon: MapPin,
  },
  {
    id: "stays",
    label: "Noclegi i rezerwacje",
    shortLabel: "Noclegi",
    icon: BedDouble,
  },
  {
    id: "media",
    label: "Foto wideo PDF",
    shortLabel: "Media",
    icon: Sparkles,
  },
];

const SUBVIEW_LABELS: Partial<Record<WorkspaceTab, string>> = {
  routes: "Trasy 20x i Paliwo",
  vision: "Kamera i Ekran",
  phone: "Telefon i WhatsApp",
  events: "Wydarzenia",
};

const MOBILE_BOTTOM_IDS: WorkspaceTab[] = ["overview", "chat", "food", "stays"];

export default function App() {
  const isOnline = useOnlineStatus();

  const [activeTab, setActiveTab] = useState<WorkspaceTab>("overview");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [voicePreset, setVoicePreset] = useState<VoicePreset>("woman_30_warm");
  const [mapsApiKey, setMapsApiKey] = useState<string>("");
  const [stayPrefill, setStayPrefill] = useState<StaySearchPrefill | null>(
    null
  );

  const [mediaSubTab, setMediaSubTab] = useState<{
    tab: MediaSubTab;
    nonce: number;
  } | null>(null);
  const [routesSubMode, setRoutesSubMode] = useState<{
    mode: RoutesSubMode;
    nonce: number;
  } | null>(null);
  const [phoneSubSection, setPhoneSubSection] = useState<{
    section: PhoneSubSection;
    nonce: number;
  } | null>(null);
  const [chatInitialPrompt, setChatInitialPrompt] = useState<{
    text: string;
    nonce: number;
  } | null>(null);

  const [liveFoodUpdate, setLiveFoodUpdate] = useState<LiveFoodUpdate | null>(
    null
  );
  const [liveDialBanner, setLiveDialBanner] = useState<{
    placeName: string;
    phone: string;
    dialHref: string;
  } | null>(null);
  const [liveCallState, setLiveCallState] = useState<LiveCallBarState>({
    active: false,
    phase: "idle",
    isMicMuted: false,
    durationSec: 0,
    subtitleUser: "",
    subtitleBot: "",
    cameraFacing: null,
  });
  const [externalLiveCommand, setExternalLiveCommand] =
    useState<ExternalLiveCommand | null>(null);
  const voiceSwitchedTabRef = useRef(false);

  const handleLiveFoodUpdate = useCallback((update: LiveFoodUpdate) => {
    setLiveFoodUpdate(update);
    if (update.callPhone && update.callDialHref) {
      setLiveDialBanner({
        placeName: update.callPlaceName || update.selectedName || "Lokal",
        phone: update.callPhone,
        dialHref: update.callDialHref,
      });
    }
  }, []);

  const dispatchLiveCommand = useCallback(
    (
      action: ExternalLiveCommand["action"],
      note?: string,
      triggerReply?: boolean,
      syncPlaces?: ExternalLiveCommand["syncPlaces"]
    ) => {
      setExternalLiveCommand({
        action,
        note,
        triggerReply,
        syncPlaces,
        nonce: Date.now() + Math.random(),
      });
    },
    []
  );

  const handleBookStay = useCallback((prefill: StaySearchPrefill) => {
    setStayPrefill({ ...prefill, nonce: Date.now() });
    setActiveTab("stays");
    setMobileMenuOpen(false);
  }, []);

  const handleOpenSubcategory = useCallback((target: SubcategoryTarget) => {
    const nonce = Date.now();
    if (target.mediaTab) {
      setMediaSubTab({ tab: target.mediaTab, nonce });
    }
    if (target.routesMode) {
      setRoutesSubMode({ mode: target.routesMode, nonce });
    }
    if (target.phoneSection) {
      setPhoneSubSection({ section: target.phoneSection, nonce });
    }
    if (target.prompt) {
      setChatInitialPrompt({ text: target.prompt, nonce });
    }
    setActiveTab(target.tab);
    setMobileMenuOpen(false);
  }, []);

  const handleSelectTab = useCallback(
    (tab: WorkspaceTab) => {
      setActiveTab(tab);
      setMobileMenuOpen(false);
      if (
        tab === "food" &&
        liveCallState.active &&
        !voiceSwitchedTabRef.current
      ) {
        dispatchLiveCommand(
          "context_note",
          "Użytkownik przełączył się właśnie na zakładkę 'Jedzenie w okolicy'. Krótko potwierdź (1 zdaniem), że nadal rozmawiacie na żywo i prowadzisz go przez wybór jedzenia: zapytaj, czy szukamy w promieniu GPS, po miejscowości czy po kodzie pocztowym oraz na co ma ochotę.",
          true
        );
      }
      voiceSwitchedTabRef.current = false;
    },
    [dispatchLiveCommand, liveCallState.active]
  );

  const handleVoiceSwitchTab = useCallback((tab: WorkspaceTab) => {
    voiceSwitchedTabRef.current = true;
    setActiveTab(tab);
    setMobileMenuOpen(false);
  }, []);

  const [location, setLocation] = useState<GeoLocation | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);

  useEffect(() => {
    fetch("/api/maps-config")
      .then((r) => r.json())
      .then((data: { apiKey?: string }) => {
        if (data.apiKey) setMapsApiKey(data.apiKey);
      })
      .catch(() => {});
  }, []);

  const fetchWeather = useCallback(async (loc: GeoLocation) => {
    setWeatherLoading(true);
    try {
      const res = await fetch(
        `/api/weather?lat=${encodeURIComponent(
          loc.lat
        )}&lng=${encodeURIComponent(loc.lng)}`
      );
      if (res.ok) {
        const data = (await res.json()) as WeatherData;
        setWeather(data);
      }
    } catch {
      // Weather stays silent on network issue
    } finally {
      setWeatherLoading(false);
    }
  }, []);

  const requestLocationAndWeather = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationError("Twoja przeglądarka nie obsługuje GPS.");
      return;
    }
    setWeatherLoading(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        setLocation(loc);
        setLocationError(null);
        void fetchWeather(loc);
      },
      (err) => {
        setWeatherLoading(false);
        setLocationError(
          err.code === 1
            ? "Odmówiono dostępu do lokalizacji GPS."
            : "Nie udało się ustalić pozycji GPS."
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 120000 }
    );
  }, [fetchWeather]);

  useEffect(() => {
    requestLocationAndWeather();
  }, [requestLocationAndWeather]);

  const activeTabLabel =
    LEFT_NAV_TABS.find((t) => t.id === activeTab)?.label ||
    SUBVIEW_LABELS[activeTab] ||
    "Ekran główny";

  const renderSidebarNav = () => (
    <nav aria-label="Zakładki aplikacji" className="space-y-1">
      {LEFT_NAV_TABS.map((t) => {
        const Icon = t.icon;
        const active = activeTab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => handleSelectTab(t.id)}
            className={`flex min-h-[44px] w-full items-center justify-between gap-2.5 rounded-xl px-3.5 text-left text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              active
                ? "bg-emerald-500 text-black"
                : "text-neutral-300 hover:bg-[#131715] hover:text-white"
            }`}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <Icon
                className={`h-4 w-4 shrink-0 ${
                  active ? "text-black" : "text-emerald-400"
                }`}
              />
              <span className="truncate">{t.label}</span>
            </span>
            {active ? (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-black/75" />
            ) : null}
          </button>
        );
      })}
    </nav>
  );

  const pageBody = (
    <div className="min-h-screen bg-[#050506] text-[#F4F6F4] flex flex-col pb-20 md:pb-8">
      {/* Top Bar: Brand (left) + Live GPS Weather & PWA Install (right) */}
      <header className="sticky top-0 z-40 border-b border-[#1E2420] bg-[#050506]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#1E2420] bg-[#0D0F0E] text-neutral-200 hover:border-emerald-500/40 md:hidden cursor-pointer"
              aria-label="Otwórz menu zakładek"
            >
              {mobileMenuOpen ? (
                <X className="h-4 w-4" />
              ) : (
                <Menu className="h-4 w-4" />
              )}
            </button>

            <button
              type="button"
              onClick={() => handleSelectTab("overview")}
              className="flex items-center gap-2.5 text-left cursor-pointer whitespace-nowrap shrink-0"
            >
              <PickleLogo size={34} />
              <span className="font-display text-lg font-bold tracking-tight text-white">
                Miękiszon
              </span>
            </button>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <WeatherHeaderWidget
              weather={weather}
              loading={weatherLoading}
              location={location}
              locationError={locationError}
              onRefresh={requestLocationAndWeather}
            />
            <PWAInstallButton />
          </div>
        </div>
      </header>

      {/* Offline Banner */}
      {!isOnline && (
        <div className="border-b border-amber-500/30 bg-amber-500/15 px-4 py-2 text-center text-xs text-amber-200">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <WifiOff className="h-3.5 w-3.5" />
            Tryb offline — funkcje sieciowe wymagają połączenia z internetem.
          </span>
        </div>
      )}

      {/* Mobile Left Drawer Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <button
            type="button"
            aria-label="Zamknij menu"
            onClick={() => setMobileMenuOpen(false)}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
          />
          <aside className="relative z-10 flex h-full w-72 max-w-[82vw] flex-col border-r border-[#1E2420] bg-[#090B0A] p-4">
            <div className="mb-4 flex items-center justify-between border-b border-[#1E2420] pb-3">
              <div className="flex items-center gap-2.5">
                <PickleLogo size={28} />
                <span className="font-display text-base font-bold text-white">
                  Miękiszon
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#1E2420] text-neutral-300"
                aria-label="Zamknij"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{renderSidebarNav()}</div>
          </aside>
        </div>
      )}

      {/* Main Left-Sidebar + Workspace Shell */}
      <div className="mx-auto flex w-full max-w-[1440px] flex-1 gap-6 px-4 py-5 sm:px-6">
        {/* Persistent Left Sidebar Tabs (Desktop / Tablet) */}
        <aside className="hidden w-[244px] lg:w-[264px] shrink-0 md:block">
          <div className="sticky top-[74px] rounded-2xl border border-[#1E2420] bg-[#0A0C0B] p-3 space-y-3">
            <div className="px-2 pt-1 pb-2 border-b border-[#1E2420]">
              <p className="text-xs font-medium text-neutral-400">
                Kategorie i narzędzia
              </p>
            </div>
            {renderSidebarNav()}
          </div>
        </aside>

        {/* Right Content Area */}
        <main className="min-w-0 flex-1 space-y-5">
          {/* Persistent Live Call Bar across all tabs when activeTab !== 'chat' */}
          {liveCallState.active && activeTab !== "chat" && (
            <div className="sticky top-[62px] z-30 rounded-2xl border border-emerald-500/45 bg-[#0B120E]/95 p-3.5 backdrop-blur-md shadow-[0_8px_28px_rgba(0,0,0,0.45)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-emerald-300">
                    <Radio className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      Rozmowa w czasie rzeczywistym ·{" "}
                      {liveCallState.phase === "speaking"
                        ? "Miękiszon mówi"
                        : liveCallState.phase === "thinking"
                          ? "Przetwarzam..."
                          : liveCallState.isMicMuted
                            ? "Mikrofon wyciszony"
                            : "Słucham Cię na żywo"}
                    </span>
                    <span className="font-mono text-[11px] text-neutral-400 tabular-nums">
                      {String(Math.floor(liveCallState.durationSec / 60)).padStart(
                        2,
                        "0"
                      )}
                      :
                      {String(liveCallState.durationSec % 60).padStart(2, "0")}
                    </span>
                  </div>
                  {(liveCallState.subtitleBot || liveCallState.subtitleUser) && (
                    <p className="truncate text-xs text-neutral-200">
                      {liveCallState.subtitleBot
                        ? `Miękiszon: ${liveCallState.subtitleBot}`
                        : `Ty: ${liveCallState.subtitleUser}`}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => dispatchLiveCommand("toggle_mute")}
                    className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold cursor-pointer ${
                      liveCallState.isMicMuted
                        ? "border-amber-500/40 bg-amber-500/15 text-amber-200"
                        : "border-[#242B26] bg-[#050506] text-neutral-200 hover:border-emerald-500/40"
                    }`}
                  >
                    {liveCallState.isMicMuted ? (
                      <>
                        <MicOff className="h-3.5 w-3.5" />
                        Odcisz
                      </>
                    ) : (
                      <>
                        <Mic className="h-3.5 w-3.5 text-emerald-400" />
                        Wycisz
                      </>
                    )}
                  </button>

                  {liveCallState.phase === "speaking" && (
                    <button
                      type="button"
                      onClick={() => dispatchLiveCommand("interrupt")}
                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[#242B26] bg-[#050506] px-3 text-xs font-semibold text-neutral-200 hover:border-emerald-500/40 cursor-pointer"
                    >
                      <Square className="h-3 w-3 text-emerald-400" />
                      Przerwij
                    </button>
                  )}

                  {activeTab !== "food" && (
                    <button
                      type="button"
                      onClick={() => handleSelectTab("food")}
                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 cursor-pointer"
                    >
                      <Utensils className="h-3.5 w-3.5" />
                      Jedzenie w okolicy
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleSelectTab("chat")}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[#242B26] bg-[#050506] px-3 text-xs font-semibold text-neutral-200 hover:border-emerald-500/40 cursor-pointer"
                  >
                    <MessageCircle className="h-3.5 w-3.5 text-emerald-400" />
                    Ekran głosu
                  </button>

                  <button
                    type="button"
                    onClick={() => dispatchLiveCommand("stop")}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-red-500 px-3 text-xs font-semibold text-white hover:bg-red-400 cursor-pointer"
                  >
                    <PhoneOff className="h-3.5 w-3.5" />
                    Zakończ
                  </button>
                </div>
              </div>

              {liveDialBanner && (
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-emerald-500/25 pt-2.5">
                  <p className="text-xs text-emerald-200">
                    Połączenie z lokalem:{" "}
                    <strong className="text-white">
                      {liveDialBanner.placeName}
                    </strong>{" "}
                    <span className="font-mono text-emerald-300">
                      ({liveDialBanner.phone})
                    </span>
                  </p>
                  <div className="flex items-center gap-2">
                    <a
                      href={liveDialBanner.dialHref}
                      className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg bg-emerald-500 px-3 text-xs font-semibold text-black hover:bg-emerald-400"
                    >
                      <PhoneCall className="h-3.5 w-3.5" />
                      Zadzwoń teraz
                    </a>
                    <button
                      type="button"
                      onClick={() => setLiveDialBanner(null)}
                      aria-label="Zamknij numer telefonu"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#242B26] text-neutral-400 hover:text-white cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab !== "overview" && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1E2420] pb-3">
              <div className="flex items-center gap-2 text-xs text-neutral-400">
                <button
                  type="button"
                  onClick={() => handleSelectTab("overview")}
                  className="font-medium text-neutral-300 hover:text-emerald-400 cursor-pointer"
                >
                  Ekran główny
                </button>
                <span aria-hidden="true">/</span>
                <span className="font-semibold text-white">
                  {activeTabLabel}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleSelectTab("overview")}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[#242B26] bg-[#0D0F0E] px-3 text-xs font-medium text-neutral-300 hover:border-emerald-500/40 hover:text-white cursor-pointer"
              >
                <LayoutGrid className="h-3.5 w-3.5 text-emerald-400" />
                Wszystkie podkategorie
              </button>
            </div>
          )}

          {activeTab === "overview" && (
            <OverviewScreen
              location={location}
              voicePreset={voicePreset}
              onVoicePresetChange={setVoicePreset}
              onOpenSubcategory={handleOpenSubcategory}
            />
          )}

          {/* Keep ChatVoiceStudio mounted so real-time voice + camera survive tab switches */}
          <div className={activeTab === "chat" ? "block" : "hidden"}>
            <ChatVoiceStudio
              location={location}
              voicePreset={voicePreset}
              onVoicePresetChange={setVoicePreset}
              onBookStay={handleBookStay}
              onSwitchTab={handleVoiceSwitchTab}
              onLiveFoodUpdate={handleLiveFoodUpdate}
              onLiveStateChange={setLiveCallState}
              externalLiveCommand={externalLiveCommand}
              initialPrompt={chatInitialPrompt}
            />
          </div>

          {activeTab === "food" && (
            <FoodPlacesFinder
              location={location}
              mapsApiKey={mapsApiKey}
              onRequestLocation={requestLocationAndWeather}
              onBookStay={handleBookStay}
              liveFoodUpdate={liveFoodUpdate}
              liveCallState={liveCallState}
              onStartLiveCall={() => dispatchLiveCommand("start")}
              onFoodContextNote={(note, triggerReply, syncPlaces) =>
                dispatchLiveCommand("context_note", note, triggerReply, syncPlaces)
              }
            />
          )}

          {activeTab === "routes" && (
            <RoutesAndTravelPlanner
              location={location}
              mapsApiKey={mapsApiKey}
              onBookStay={handleBookStay}
              initialMode={routesSubMode}
            />
          )}

          {activeTab === "stays" && (
            <StaysBookingStudio
              location={location}
              mapsApiKey={mapsApiKey}
              voicePreset={voicePreset}
              prefill={stayPrefill}
              liveCallActive={liveCallState.active}
              onSyncStaysToLive={(note, syncPlaces) =>
                dispatchLiveCommand("context_note", note, false, syncPlaces)
              }
            />
          )}

          {activeTab === "media" && (
            <MediaPdfStudio
              voicePreset={voicePreset}
              initialTab={mediaSubTab}
            />
          )}

          {activeTab === "vision" && (
            <LiveVisionStudio voicePreset={voicePreset} />
          )}

          {activeTab === "phone" && (
            <PhoneWhatsAppGmailHub
              voicePreset={voicePreset}
              initialSection={phoneSubSection}
            />
          )}

          {activeTab === "events" && (
            <EventsScreen onBookStay={handleBookStay} />
          )}
        </main>
      </div>

      {/* Mobile Bottom Thumb-Zone Navigation (<= 15% viewport height) */}
      <nav
        aria-label="Nawigacja mobilna"
        className="fixed bottom-0 inset-x-0 z-40 grid grid-cols-4 border-t border-[#1E2420] bg-[#050506]/95 backdrop-blur-md md:hidden"
      >
        {LEFT_NAV_TABS.filter((t) => MOBILE_BOTTOM_IDS.includes(t.id)).map(
          (item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectTab(item.id)}
                className={`flex min-h-[54px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium cursor-pointer ${
                  active ? "text-emerald-400" : "text-neutral-400"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{item.shortLabel}</span>
              </button>
            );
          }
        )}
      </nav>
    </div>
  );

  if (mapsApiKey) {
    return (
      <APIProvider apiKey={mapsApiKey} language="pl" region="PL">
        {pageBody}
      </APIProvider>
    );
  }

  return pageBody;
}
