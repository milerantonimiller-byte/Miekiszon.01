import React, { useState } from "react";
import {
  AlarmClock,
  ArrowUpRight,
  BedDouble,
  Calendar,
  Camera,
  FileText,
  Film,
  Image as ImageIcon,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquare,
  Mic,
  Monitor,
  Navigation,
  Send,
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
    heading: "01. Asystent AI, Głos i Języki",
    subtitle:
      "Rozmowy tekstowe i głosowe po polsku oraz w innych językach w czasie rzeczywistym",
    items: [
      {
        id: "sub-chat",
        title: "Głos asystentki, czat wielojęzyczny i pliki",
        description:
          "Pisanie w dowolnym języku, załączanie zdjęć oraz dokumentów PDF z obsługą głosu i kamery.",
        icon: MessageCircle,
        target: { tab: "chat" },
      },
      {
        id: "sub-live-voice",
        title: "Rozmowa w czasie rzeczywistym",
        description:
          "Rozmowa głosowa na żywo przez mikrofon oraz udostępnianie kamery przód lub tylnej.",
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
        title: "Udostępnianie ekranu na żywo",
        description:
          "Analiza udostępnionego ekranu w czasie rzeczywistym z podpowiedziami głosowymi.",
        icon: Monitor,
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
}) => {
  const [quickPrompt, setQuickPrompt] = useState("");

  const handleQuickSend = (e: React.FormEvent) => {
    e.preventDefault();
    const text = quickPrompt.trim();
    if (!text) return;
    setQuickPrompt("");
    onOpenSubcategory({ tab: "chat", prompt: text });
  };

  return (
    <div className="space-y-8">
      {/* Main Screen Intro + Quick Ask Bar */}
      <section className="rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1.5">
            <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl text-balance">
              Ekran główny Miękiszona
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-neutral-400">
              Wszystkie podkategorie w jednym miejscu — wybierz narzędzie
              poniżej lub z paska po lewej stronie albo wyślij polecenie od
              razu.
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
              className="min-h-[42px] w-full rounded-xl border border-[#242B26] bg-[#050506] px-3 text-xs text-white focus:border-emerald-500 focus:outline-none"
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
          <input
            type="text"
            value={quickPrompt}
            onChange={(e) => setQuickPrompt(e.target.value)}
            placeholder="Napisz szybkie pytanie lub polecenie (np. Gdzie zjem najlepiej w okolicy?)..."
            className="min-h-[46px] flex-1 rounded-xl border border-[#242B26] bg-[#050506] px-4 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!quickPrompt.trim()}
            className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Send className="h-4 w-4" />
            Zapytaj Miękiszona
          </button>
        </form>
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
