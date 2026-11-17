import React, { useEffect, useRef, useState } from "react";
import {
  AlarmClock,
  ArrowUpRight,
  BedDouble,
  Calendar,
  Camera,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquare,
  Mic,
  MonitorSmartphone,
  Navigation,
  PhoneCall,
  Send,
  Smartphone,
  Square,
  Train,
  Utensils,
} from "lucide-react";
import type {
  GeoLocation,
  MediaSubTab,
  PhoneSubSection,
  RoutesSubMode,
  VoicePreset,
  WorkspaceTab,
} from "../types";

export interface SubcategoryTarget {
  tab: WorkspaceTab;
  mediaTab?: MediaSubTab;
  routesMode?: RoutesSubMode;
  phoneSection?: PhoneSubSection;
  prompt?: string;
}

interface OverviewScreenProps {
  location: GeoLocation | null;
  voicePreset: VoicePreset;
  onVoicePresetChange: (v: VoicePreset) => void;
  onOpenSubcategory: (target: SubcategoryTarget) => void;
  onStartLiveCall?: () => void;
}

interface SubcategoryItem {
  id: string;
  title: string;
  description: string;
  icon: React.FC<{ className?: string }>;
  target: SubcategoryTarget;
}

interface SubcategoryGroup {
  id: string;
  heading: string;
  subtitle: string;
  items: SubcategoryItem[];
}

const SUBCATEGORY_GROUPS: SubcategoryGroup[] = [
  {
    id: "ai-voice",
    heading: "01. Asystent AI: Polski i Deutsch",
    subtitle:
      "Rozmowy tekstowe i głosowe wyłącznie w języku polskim oraz niemieckim w czasie rzeczywistym",
    items: [
      {
        id: "sub-chat",
        title: "Głos asystentki, czat (PL / DE) i pliki",
        description:
          "Odpowiedzi wyłącznie po polsku lub po niemiecku, załączanie zdjęć, PDF i zrzutów ekranu.",
        icon: MessageCircle,
        target: { tab: "chat" },
      },
      {
        id: "sub-live-voice",
        title: "Rozmowa w czasie rzeczywistym + Ekran",
        description:
          "Rozmowa głosowa na żywo przez mikrofon telefonu, kamera przód/tył oraz udostępnianie ekranu.",
        icon: Mic,
        target: { tab: "chat" },
      },
    ],
  },
  {
    id: "maps-travel-stays",
    heading: "02. Jedzenie, Trasy, Noclegi i Kalendarz",
    subtitle:
      "Lokalizacja GPS, gastronomia według ocen Google, nawigacja wielopunktowa i rezerwacje",
    items: [
      {
        id: "sub-food",
        title: "Jedzenie w okolicy (gwiazdki Google)",
        description:
          "Wyszukiwanie najwyżej ocenianych restauracji, kawiarni i lokali w pobliżu GPS.",
        icon: Utensils,
        target: { tab: "food" },
      },
      {
        id: "sub-routes-20",
        title: "Planer trasy do 20 adresów",
        description:
          "Optymalizacja kolejności przystanków i eksport trasy prosto do Google Maps.",
        icon: Navigation,
        target: { tab: "routes", routesMode: "multistop" },
      },
      {
        id: "sub-transit-fuel",
        title: "Pociąg, tramwaj czy eko-auto i paliwo",
        description:
          "Porównanie połączeń kolejowych/miejskich z najoszczędniejszą trasą i cenami paliw.",
        icon: Train,
        target: { tab: "routes", routesMode: "city_travel" },
      },
      {
        id: "sub-stays",
        title: "Automatyczne bukowanie noclegów",
        description:
          "Dobór hoteli i apartamentów z mapą, automatyczny wybór oraz gotowe linki rezerwacyjne.",
        icon: BedDouble,
        target: { tab: "stays" },
      },
      {
        id: "sub-events",
        title: "Wydarzenia i kalendarz (.ics)",
        description:
          "Tworzenie spotkań, przypomnień i eksport terminów do kalendarza w telefonie.",
        icon: Calendar,
        target: { tab: "events" },
      },
    ],
  },
  {
    id: "media-pdf-vision",
    heading: "03. Zdjęcia, Wideo, PDF i Podgląd na żywo",
    subtitle:
      "Obróbka mediów, tłumaczenie dokumentów oraz bieżąca pomoc z kamery i ekranu",
    items: [
      {
        id: "sub-image",
        title: "Przerabianie i generowanie zdjęć",
        description:
          "Tworzenie grafik od zera oraz edycja przesłanych zdjęć w jakości 1K, 2K lub 4K.",
        icon: ImageIcon,
        target: { tab: "media", mediaTab: "image" },
      },
      {
        id: "sub-video",
        title: "Tworzenie krótkich filmików",
        description:
          "Generowanie krótkich klipów wideo 16:9 lub 9:16 z opisu albo zdjęcia startowego.",
        icon: Film,
        target: { tab: "media", mediaTab: "video" },
      },
      {
        id: "sub-pdf",
        title: "Tłumaczenie i korekta plików PDF",
        description:
          "Wgrywanie plików PDF i zdjęć tekstu — tłumaczenie, poprawa błędów oraz streszczenia.",
        icon: FileText,
        target: { tab: "media", mediaTab: "pdf" },
      },
      {
        id: "sub-camera",
        title: "Kamera tylna na żywo",
        description:
          "Pokaż zadanie kamerą telefonu, a Miękiszon poprowadzi Cię krok po kroku.",
        icon: Camera,
        target: { tab: "vision" },
      },
      {
        id: "sub-screen",
        title: "Udostępnianie ekranu z telefonu",
        description:
          "Pokaż ekran swojego telefonu Android na żywo lub prześlij zrzut ekranu — pomoc krok po kroku (PL / DE).",
        icon: MonitorSmartphone,
        target: { tab: "vision" },
      },
    ],
  },
  {
    id: "phone-comms",
    heading: "04. Telefon, WhatsApp i Poczta",
    subtitle:
      "Bezpośrednie akcje na telefonie, wysyłka zbiorcza i redagowanie wiadomości",
    items: [
      {
        id: "sub-whatsapp",
        title: "WhatsApp do 1–5 czatów naraz",
        description:
          "Jedna wiadomość przygotowana równocześnie dla maksymalnie 5 wybranych kontaktów.",
        icon: MessageSquare,
        target: { tab: "phone", phoneSection: "whatsapp" },
      },
      {
        id: "sub-intents",
        title: "Budzik, połączenia, SMS i GPS",
        description:
          "Ustawianie budzika, szybkie dzwonienie, wysyłanie SMS oraz otwieranie nawigacji.",
        icon: AlarmClock,
        target: { tab: "phone", phoneSection: "intents" },
      },
      {
        id: "sub-email",
        title: "Szybki E-mail z asystentem AI",
        description:
          "Automatyczne ułożenie treści maila i otwarcie gotowego szkicu w aplikacji poczty.",
        icon: Mail,
        target: { tab: "phone", phoneSection: "email" },
      },
    ],
  },
];

export const OverviewScreen: React.FC<OverviewScreenProps> = ({
  location,
  voicePreset,
  onVoicePresetChange,
  onOpenSubcategory,
  onStartLiveCall,
}) => {
  const [quickPrompt, setQuickPrompt] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (!isRecording) {
      setRecordingSec(0);
      return;
    }
    const timer = setInterval(() => setRecordingSec((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [isRecording]);

  useEffect(() => {
    return () => {
      try {
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      } catch {
        // ignore
      }
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const toggleMainMic = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }

    setMicError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError("Twoja przeglądarka lub telefon nie obsługuje mikrofonu.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;
      const preferredMime = MediaRecorder.isTypeSupported(
        "audio/webm;codecs=opus"
      )
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(
        stream,
        MediaRecorder.isTypeSupported(preferredMime)
          ? { mimeType: preferredMime }
          : undefined
      );
      audioChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        if (blob.size < 400) return;

        const base64 = await new Promise<string>((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(",")[1] || "");
          r.readAsDataURL(blob);
        });

        setTranscribing(true);
        try {
          const res = await fetch("/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              audioBase64: base64,
              mimeType: recorder.mimeType || "audio/webm",
            }),
          });
          const data = (await res.json()) as { text?: string; error?: string };
          const spoken = data.text?.trim();
          if (!res.ok || data.error) {
            throw new Error(data.error || "Nie udało się rozpoznać mowy.");
          }
          if (spoken) {
            setQuickPrompt("");
            onOpenSubcategory({ tab: "chat", prompt: spoken });
          }
        } catch (err) {
          setMicError(
            err instanceof Error
              ? err.message
              : "Błąd rozpoznawania głosu z mikrofonu."
          );
        } finally {
          setTranscribing(false);
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      setMicError(
        err instanceof Error
          ? `Brak dostępu do mikrofonu: ${err.message}`
          : "Nadaj aplikacji uprawnienia do mikrofonu na telefonie Android."
      );
    }
  };

  const handleQuickSend = (e: React.FormEvent) => {
    e.preventDefault();
    const text = quickPrompt.trim();
    if (!text) return;
    setQuickPrompt("");
    onOpenSubcategory({ tab: "chat", prompt: text });
  };

  return (
    <div className="space-y-8">
      {/* Main Screen Intro + Quick Ask Bar with Microphone */}
      <section className="rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-4 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
              <Smartphone className="h-3.5 w-3.5" />
              <span>Aplikacja na telefon Android · Polski i Deutsch</span>
            </div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl text-balance">
              Ekran główny Miękiszona
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-neutral-400">
              Napisz albo naciśnij mikrofon i powiedz, czego potrzebujesz — Miękiszon odpowiada po polsku lub po niemiecku.
              {location ? (
                <span className="ml-2 inline-flex items-center gap-1 font-mono text-xs text-emerald-400 tabular-nums">
                  <MapPin className="h-3.5 w-3.5" />
                  {location.lat.toFixed(3)}, {location.lng.toFixed(3)}
                </span>
              ) : null}
            </p>
          </div>

          <div className="w-full sm:w-auto sm:min-w-[260px]">
            <label
              htmlFor="overview-voice-select"
              className="mb-1 block text-xs font-medium text-neutral-400"
            >
              Głos lektorki
            </label>
            <select
              id="overview-voice-select"
              value={voicePreset}
              onChange={(e) =>
                onVoicePresetChange(e.target.value as VoicePreset)
              }
              className="min-h-[44px] w-full rounded-xl border border-[#242B26] bg-[#050506] px-3 text-xs text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="woman_30_warm">
                Kobiecy ciepły (30 lat · Kore)
              </option>
              <option value="woman_30_pro">
                Kobiecy profesjonalny (30 lat · Zephyr)
              </option>
              <option value="man_calm">Męski spokojny (Charon)</option>
              <option value="off">Wyciszony</option>
            </select>
          </div>
        </div>

        <form
          onSubmit={handleQuickSend}
          className="mt-5 flex flex-col gap-2.5 sm:flex-row"
        >
          <div className="flex flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => void toggleMainMic()}
              disabled={transcribing}
              aria-label={isRecording ? "Zatrzymaj nagrywanie i wyślij" : "Mów przez mikrofon"}
              title={isRecording ? "Zatrzymaj i wyślij do Miękiszona" : "Mów do Miękiszona przez mikrofon"}
              className={`inline-flex min-h-[48px] min-w-[48px] shrink-0 items-center justify-center gap-1.5 rounded-xl border px-3.5 text-xs font-semibold transition-colors cursor-pointer ${
                isRecording
                  ? "border-red-500 bg-red-500 text-white"
                  : "border-[#242B26] bg-[#141816] text-emerald-400 hover:border-emerald-500/50 hover:text-white disabled:opacity-50"
              }`}
            >
              {transcribing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isRecording ? (
                <>
                  <Square className="h-3.5 w-3.5" />
                  <span className="font-mono tabular-nums">
                    {Math.floor(recordingSec / 60)}:
                    {String(recordingSec % 60).padStart(2, "0")}
                  </span>
                </>
              ) : (
                <>
                  <Mic className="h-4 w-4" />
                  <span className="hidden sm:inline">Mów</span>
                </>
              )}
            </button>

            <input
              type="text"
              value={quickPrompt}
              onChange={(e) => setQuickPrompt(e.target.value)}
              placeholder="Napisz lub kliknij mikrofon i powiedz polecenie..."
              className="min-h-[48px] min-w-0 flex-1 rounded-xl border border-[#242B26] bg-[#050506] px-4 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={!quickPrompt.trim() || transcribing}
              className="inline-flex min-h-[48px] flex-1 sm:flex-none items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Send className="h-4 w-4" />
              Zapytaj Miękiszona
            </button>

            {onStartLiveCall && (
              <button
                type="button"
                onClick={onStartLiveCall}
                className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-emerald-500/45 bg-emerald-500/15 px-4 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <PhoneCall className="h-4 w-4" />
                Rozmowa na żywo
              </button>
            )}
          </div>
        </form>

        {micError && (
          <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2 text-xs text-red-200">
            {micError}
          </div>
        )}
      </section>

      {/* All Subcategories Directory */}
      <div className="space-y-8">
        {SUBCATEGORY_GROUPS.map((group, idx) => (
          <section
            key={group.id}
            className={idx > 0 ? "border-t border-[#1E2420] pt-7" : ""}
          >
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="font-display text-lg font-semibold text-white">
                  {group.heading}
                </h2>
                <p className="mt-0.5 text-xs text-neutral-400">
                  {group.subtitle}
                </p>
              </div>
              <span className="font-mono text-xs text-neutral-500 tabular-nums">
                {group.items.length} podkategorie
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onOpenSubcategory(item.target)}
                    className="group flex flex-col justify-between rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-4 text-left transition-colors hover:border-emerald-500/45 hover:bg-[#111513] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#242B26] bg-[#050506] text-emerald-400 group-hover:border-emerald-500/40">
                          <Icon className="h-4 w-4" />
                        </span>
                        <h3 className="font-display text-sm font-semibold text-white">
                          {item.title}
                        </h3>
                      </div>
                      <ArrowUpRight className="h-4 w-4 shrink-0 text-neutral-500 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-emerald-400" />
                    </div>
                    <p className="mt-3 text-xs leading-relaxed text-neutral-400">
                      {item.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};
