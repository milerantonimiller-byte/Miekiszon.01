import React, { useEffect, useState } from "react";
import {
  BedDouble,
  Calendar,
  Download,
  MapPin,
  Plus,
  Trash2,
} from "lucide-react";
import type { AppEvent, StaySearchPrefill } from "../types";

const INITIAL_LOCAL_EVENTS: AppEvent[] = [
  {
    id: "local-1",
    title: "Poranny przegląd zadań z Miękiszonem",
    date: new Date().toISOString().slice(0, 10),
    time: "09:00",
    location: "Dom / Biuro",
    category: "Przypomnienie",
    source: "local",
  },
  {
    id: "local-2",
    title: "Wyjazd na obiad — sprawdź restauracje 4.8★",
    date: new Date().toISOString().slice(0, 10),
    time: "13:30",
    location: "Centrum miasta",
    category: "Podróż",
    source: "local",
  },
];

interface EventsScreenProps {
  onBookStay?: (prefill: StaySearchPrefill) => void;
}

function downloadIcsEvent(ev: AppEvent) {
  const cleanDate = ev.date.replace(/-/g, "");
  const cleanTime = ev.time.includes(":")
    ? ev.time.replace(":", "") + "00"
    : "090000";
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Miekiszon//PL",
    "BEGIN:VEVENT",
    `UID:${ev.id}@miekiszon`,
    `DTSTART:${cleanDate}T${cleanTime}`,
    `SUMMARY:${ev.title}`,
    ev.location ? `LOCATION:${ev.location}` : "",
    `DESCRIPTION:Kategoria: ${ev.category}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${ev.title.slice(0, 24).replace(/\s+/g, "-")}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

export const EventsScreen: React.FC<EventsScreenProps> = ({ onBookStay }) => {
  const [events, setEvents] = useState<AppEvent[]>(() => {
    try {
      const saved = localStorage.getItem("miekiszon_events");
      return saved ? (JSON.parse(saved) as AppEvent[]) : INITIAL_LOCAL_EVENTS;
    } catch {
      return INITIAL_LOCAL_EVENTS;
    }
  });

  const [title, setTitle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("16:00");
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState<AppEvent["category"]>("Spotkanie");

  useEffect(() => {
    try {
      localStorage.setItem("miekiszon_events", JSON.stringify(events));
    } catch {
      // Ignore storage error
    }
  }, [events]);

  const handleSubmitEvent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const newLocal: AppEvent = {
      id: `local-${Date.now()}`,
      title: title.trim(),
      date,
      time,
      location: location.trim() || undefined,
      category,
      source: "local",
    };
    setEvents((prev) => [newLocal, ...prev]);
    setTitle("");
    setLocation("");
  };

  const removeLocalEvent = (id: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  };

  return (
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#1E2420] pb-6">
        <div>
          <p className="text-xs font-medium text-emerald-400">
            Ekran wydarzeń · Nadchodzące aktywności i przypomnienia
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold text-white sm:text-3xl">
            Wydarzenia i aktywności
          </h1>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Events List */}
        <div className="space-y-3 lg:col-span-7">
          {events.length === 0 ? (
            <div className="rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-8 text-center">
              <Calendar className="mx-auto h-8 w-8 text-neutral-500" />
              <p className="mt-3 text-sm font-medium text-white">
                Brak zaplanowanych wydarzeń
              </p>
              <p className="mt-1 text-xs text-neutral-400">
                Dodaj nowe wydarzenie w formularzu obok.
              </p>
            </div>
          ) : (
            events.map((ev) => (
              <div
                key={ev.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-5 transition-colors hover:border-[#2C3630]"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                    <span className="font-mono tabular-nums text-emerald-400">
                      {ev.date} · {ev.time}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{ev.category}</span>
                  </div>
                  <h3 className="mt-1.5 font-display text-base font-semibold text-white">
                    {ev.title}
                  </h3>
                  {ev.location && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-neutral-400">
                      <MapPin className="h-3.5 w-3.5 text-neutral-500" />
                      {ev.location}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {onBookStay && (
                    <button
                      type="button"
                      onClick={() =>
                        onBookStay({
                          city: ev.location || ev.title,
                          checkIn: ev.date,
                          autoTrigger: true,
                        })
                      }
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-emerald-500/35 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 cursor-pointer"
                    >
                      <BedDouble className="h-3.5 w-3.5" />
                      Nocleg
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => downloadIcsEvent(ev)}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[#222824] bg-[#141715] px-3 py-1.5 text-xs font-medium text-neutral-200 hover:text-white cursor-pointer"
                    title="Zapisz w kalendarzu telefonu (.ics)"
                  >
                    <Download className="h-3.5 w-3.5 text-emerald-400" />
                    .ics
                  </button>
                  <button
                    type="button"
                    onClick={() => removeLocalEvent(ev.id)}
                    className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-neutral-400 hover:bg-red-500/15 hover:text-red-300 cursor-pointer"
                    aria-label="Usuń wydarzenie"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Add Event Form */}
        <div className="lg:col-span-5">
          <form
            onSubmit={handleSubmitEvent}
            className="rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-6 space-y-4"
          >
            <h2 className="font-display text-lg font-semibold text-white">
              Dodaj wydarzenie lub aktywność
            </h2>

            <div>
              <label className="block text-xs font-medium text-neutral-300">
                Nazwa wydarzenia
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Np. Spotkanie lub wyjazd"
                className="mt-1.5 min-h-[44px] w-full rounded-xl border border-[#222824] bg-[#050506] px-4 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-neutral-300">
                  Data
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="mt-1.5 min-h-[44px] w-full rounded-xl border border-[#222824] bg-[#050506] px-3 font-mono text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-300">
                  Godzina
                </label>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="mt-1.5 min-h-[44px] w-full rounded-xl border border-[#222824] bg-[#050506] px-3 font-mono text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-300">
                Kategoria
              </label>
              <select
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value as AppEvent["category"])
                }
                className="mt-1.5 min-h-[44px] w-full rounded-xl border border-[#222824] bg-[#050506] px-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
              >
                <option value="Spotkanie">Spotkanie</option>
                <option value="Przypomnienie">Przypomnienie</option>
                <option value="Podróż">Podróż</option>
                <option value="Zadanie">Zadanie</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-300">
                Miejsce (opcjonalnie)
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Miasto lub adres"
                className="mt-1.5 min-h-[44px] w-full rounded-xl border border-[#222824] bg-[#050506] px-4 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-semibold text-black hover:bg-emerald-400 cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              Dodaj wydarzenie
            </button>
          </form>
        </div>
      </div>
    </section>
  );
};
