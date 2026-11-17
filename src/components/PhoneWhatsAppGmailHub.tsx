import React, { useEffect, useState } from "react";
import {
  AlarmClock,
  Bell,
  ExternalLink,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { PhoneSubSection, VoicePreset } from "../types";
import { speakWithMiekiszon } from "../utils/ttsPlayer";

interface PhoneWhatsAppGmailHubProps {
  voicePreset: VoicePreset;
  initialSection?: { section: PhoneSubSection; nonce: number } | null;
}

interface WhatsAppContact {
  id: string;
  name: string;
  phone: string;
}

const DEFAULT_CONTACTS: WhatsAppContact[] = [
  { id: "c1", name: "Kontakt 1 (Edytuj numer)", phone: "+48500100101" },
  { id: "c2", name: "Kontakt 2 (Edytuj numer)", phone: "+48500100102" },
  { id: "c3", name: "Kontakt 3 (Edytuj numer)", phone: "+48500100103" },
  { id: "c4", name: "Kontakt 4 (Edytuj numer)", phone: "+48500100104" },
  { id: "c5", name: "Kontakt 5 (Edytuj numer)", phone: "+48500100105" },
];

function buildWhatsAppUrl(phone: string, text: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export const PhoneWhatsAppGmailHub: React.FC<PhoneWhatsAppGmailHubProps> = ({
  voicePreset,
  initialSection,
}) => {
  useEffect(() => {
    if (!initialSection?.section) return;
    const el = document.getElementById(`phone-section-${initialSection.section}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [initialSection]);
  // 1. WhatsApp Bulk Messaging (1-5 chats)
  const [contacts, setContacts] = useState<WhatsAppContact[]>(() => {
    try {
      const saved = localStorage.getItem("miekiszon_wa_contacts");
      return saved ? JSON.parse(saved) : DEFAULT_CONTACTS;
    } catch {
      return DEFAULT_CONTACTS;
    }
  });
  const [selectedIds, setSelectedIds] = useState<string[]>(["c1", "c2"]);
  const [waMessage, setWaMessage] = useState(
    "Cześć! Daj znać czy wszystko aktualne."
  );
  const [newContactName, setNewContactName] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const [waQueueReady, setWaQueueReady] = useState(false);

  // 2. Phone Intents & Alarm
  const [alarmTime, setAlarmTime] = useState("07:30");
  const [alarmLabel, setAlarmLabel] = useState("Budzik Miękiszona");
  const [alarmCountdownSec, setAlarmCountdownSec] = useState<number | null>(
    null
  );
  const [callPhone, setCallPhone] = useState("+48500100100");
  const [smsText, setSmsText] = useState("Oddzwonię za 10 minut.");
  const [mapQuery, setMapQuery] = useState("Najbliższa stacja paliw");
  const [intentNotice, setIntentNotice] = useState<string | null>(null);

  // 3. Direct Email Composer (No login required - drafts with AI & opens mail app)
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [draftingEmail, setDraftingEmail] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem("miekiszon_wa_contacts", JSON.stringify(contacts));
  }, [contacts]);

  // Browser alarm timer countdown
  useEffect(() => {
    if (alarmCountdownSec === null) return;
    if (alarmCountdownSec <= 0) {
      setAlarmCountdownSec(null);
      setIntentNotice(`Budzik "${alarmLabel}" dzwoni teraz.`);
      void speakWithMiekiszon(
        `Uwaga! Dzwoni Twój budzik: ${alarmLabel}. Czas działać!`,
        voicePreset
      );
      return;
    }
    const timer = setTimeout(
      () => setAlarmCountdownSec((s) => (s !== null ? s - 1 : null)),
      1000
    );
    return () => clearTimeout(timer);
  }, [alarmCountdownSec, alarmLabel, voicePreset]);

  const toggleContact = (id: string) => {
    setWaQueueReady(false);
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 5) return prev;
      return [...prev, id];
    });
  };

  const addContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContactName.trim() || !newContactPhone.trim()) return;
    const item: WhatsAppContact = {
      id: crypto.randomUUID(),
      name: newContactName.trim(),
      phone: newContactPhone.trim(),
    };
    setContacts((prev) => [item, ...prev]);
    if (selectedIds.length < 5) {
      setSelectedIds((prev) => [...prev, item.id]);
    }
    setNewContactName("");
    setNewContactPhone("");
  };

  const removeContact = (id: string) => {
    setContacts((prev) => prev.filter((c) => c.id !== id));
    setSelectedIds((prev) => prev.filter((x) => x !== id));
  };

  const selectedContacts = contacts.filter((c) => selectedIds.includes(c.id));

  const startInAppAlarm = () => {
    const [hh, mm] = alarmTime.split(":").map(Number);
    const now = new Date();
    const target = new Date();
    target.setHours(hh || 0, mm || 0, 0, 0);
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    const diffSec = Math.max(
      1,
      Math.round((target.getTime() - now.getTime()) / 1000)
    );
    setAlarmCountdownSec(diffSec);
    setIntentNotice(
      `Ustawiono budzik "${alarmLabel}" na ${alarmTime} (uruchomiony również w przeglądarce).`
    );
  };

  const androidAlarmHref = (() => {
    const [hh, mm] = alarmTime.split(":").map(Number);
    return `intent:#Intent;action=android.intent.action.SET_ALARM;i.android.intent.extra.alarm.HOUR=${
      hh || 7
    };i.android.intent.extra.alarm.MINUTES=${
      mm || 30
    };S.android.intent.extra.alarm.MESSAGE=${encodeURIComponent(
      alarmLabel
    )};end`;
  })();

  const handleDraftEmailWithAI = async () => {
    if (!emailSubject.trim() && !emailBody.trim()) return;
    setDraftingEmail(true);
    setDraftError(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-4-hydrogen",
          language: "pl",
          messages: [
            {
              role: "user",
              text: `Napisz profesjonalny, uprzejmy i konkretny e-mail po polsku na temat: "${
                emailSubject || "Wiadomość"
              }". Wskazówki / treść robocza: "${
                emailBody || "Krótka uprzejma wiadomość"
              }". Podaj wyłącznie gotową treść wiadomości bez zbędnych komentarzy.`,
            },
          ],
        }),
      });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Nie udało się stworzyć szkicu.");
      if (data.text) setEmailBody(data.text.trim());
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Błąd tworzenia szkicu.");
    } finally {
      setDraftingEmail(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ROW 1: BULK WHATSAPP (1-5 CHATS) + PHONE / ANDROID INTENTS */}
      <div className="grid gap-5 lg:grid-cols-12">
        {/* Bulk WhatsApp */}
        <section
          id="phone-section-whatsapp"
          className="space-y-4 rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-5 lg:col-span-7"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-lg font-bold text-white">
                WhatsApp: Wysyłka do 1–5 czatów naraz
              </h3>
              <p className="mt-0.5 text-xs text-neutral-400">
                Wpisz jedną wiadomość i zaznacz od 1 do 5 kontaktów.
              </p>
            </div>
            <span className="font-mono text-xs font-semibold text-emerald-400">
              Wybrano: {selectedIds.length} / 5
            </span>
          </div>

          <form onSubmit={addContact} className="grid gap-2 sm:grid-cols-5">
            <input
              type="text"
              value={newContactName}
              onChange={(e) => setNewContactName(e.target.value)}
              placeholder="Imię / Nazwa"
              className="min-h-[40px] rounded-xl border border-[#242B26] bg-[#050506] px-3 text-xs text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none sm:col-span-2"
            />
            <input
              type="tel"
              value={newContactPhone}
              onChange={(e) => setNewContactPhone(e.target.value)}
              placeholder="+48600700800"
              className="min-h-[40px] rounded-xl border border-[#242B26] bg-[#050506] px-3 font-mono text-xs text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none sm:col-span-2"
            />
            <button
              type="submit"
              className="inline-flex min-h-[40px] items-center justify-center gap-1 rounded-xl border border-[#242B26] bg-[#141816] px-3 text-xs font-semibold text-white hover:border-emerald-500/40 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5 text-emerald-400" />
              Dodaj
            </button>
          </form>

          <div className="max-h-[210px] space-y-2 overflow-y-auto pr-1">
            {contacts.map((c) => {
              const checked = selectedIds.includes(c.id);
              const disabled = !checked && selectedIds.length >= 5;
              return (
                <div
                  key={c.id}
                  className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs transition-colors ${
                    checked
                      ? "border-emerald-500/40 bg-emerald-500/10"
                      : "border-[#242B26] bg-[#050506]"
                  }`}
                >
                  <label className="flex min-w-0 flex-1 items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleContact(c.id)}
                      className="h-4 w-4 accent-emerald-500"
                    />
                    <span className="truncate font-medium text-white">
                      {c.name}
                    </span>
                    <span className="font-mono text-neutral-400">
                      {c.phone}
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => removeContact(c.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-500 hover:bg-red-500/15 hover:text-red-300 cursor-pointer"
                    aria-label="Usuń kontakt"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-neutral-300">
              Wspólna wiadomość do wysłania
            </label>
            <textarea
              rows={2}
              value={waMessage}
              onChange={(e) => {
                setWaMessage(e.target.value);
                setWaQueueReady(false);
              }}
              className="w-full rounded-xl border border-[#242B26] bg-[#050506] px-3.5 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
              placeholder="Treść wiadomości na WhatsApp..."
            />
          </div>

          <button
            type="button"
            disabled={selectedContacts.length === 0 || !waMessage.trim()}
            onClick={() => setWaQueueReady(true)}
            className="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-50 cursor-pointer"
          >
            <MessageSquare className="h-4 w-4" />
            Przygotuj wysyłkę do {selectedContacts.length} czatów WhatsApp
          </button>

          {waQueueReady && selectedContacts.length > 0 && (
            <div className="space-y-2 rounded-xl border border-emerald-500/30 bg-[#050506] p-3">
              <p className="text-xs font-medium text-emerald-300">
                Gotowe czaty ({selectedContacts.length}) — kliknij, aby otworzyć
                bezpośrednio w aplikacji WhatsApp:
              </p>
              <div className="flex flex-wrap gap-2">
                {selectedContacts.map((c) => (
                  <a
                    key={c.id}
                    href={buildWhatsAppUrl(c.phone, waMessage)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-emerald-500/35 bg-emerald-500/15 px-3 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Wyślij do: {c.name}
                  </a>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Phone Intents & Alarm */}
        <section
          id="phone-section-intents"
          className="space-y-4 rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-5 lg:col-span-5"
        >
          <div>
            <h3 className="font-display text-lg font-bold text-white">
              Sterowanie Telefonem (Budzik, Rozmowy, SMS)
            </h3>
            <p className="mt-0.5 text-xs text-neutral-400">
              Uruchamiaj budzik, telefon, SMS lub Mapy na Androidzie i w
              przeglądarce.
            </p>
          </div>

          {intentNotice && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-200">
              {intentNotice}
            </div>
          )}

          {/* Alarm / Budzik */}
          <div className="space-y-2.5 rounded-xl border border-[#242B26] bg-[#050506] p-3.5">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-white">
                <AlarmClock className="h-4 w-4 text-emerald-400" />
                Budzik i Przypomnienie
              </span>
              {alarmCountdownSec !== null && (
                <span className="font-mono text-xs text-emerald-400">
                  Za {Math.floor(alarmCountdownSec / 60)}m {alarmCountdownSec % 60}s
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="time"
                value={alarmTime}
                onChange={(e) => setAlarmTime(e.target.value)}
                className="min-h-[40px] rounded-lg border border-[#242B26] bg-[#0D0F0E] px-2.5 font-mono text-xs text-white"
              />
              <input
                type="text"
                value={alarmLabel}
                onChange={(e) => setAlarmLabel(e.target.value)}
                placeholder="Etykieta budzika"
                className="col-span-2 min-h-[40px] rounded-lg border border-[#242B26] bg-[#0D0F0E] px-3 text-xs text-white"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={startInAppAlarm}
                className="inline-flex min-h-[38px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-3 text-xs font-semibold text-black hover:bg-emerald-400 cursor-pointer"
              >
                <Bell className="h-3.5 w-3.5" />
                Ustaw budzik teraz
              </button>
              <a
                href={androidAlarmHref}
                className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg border border-[#242B26] bg-[#141816] px-3 text-xs font-medium text-neutral-200 hover:border-emerald-500/40"
              >
                <ExternalLink className="h-3.5 w-3.5 text-emerald-400" />
                Zegar Android
              </a>
            </div>
          </div>

          {/* Call & SMS */}
          <div className="space-y-2.5 rounded-xl border border-[#242B26] bg-[#050506] p-3.5">
            <label className="block text-xs font-semibold text-white">
              Zadzwoń lub wyślij SMS
            </label>
            <input
              type="tel"
              value={callPhone}
              onChange={(e) => setCallPhone(e.target.value)}
              placeholder="+48..."
              className="w-full min-h-[40px] rounded-lg border border-[#242B26] bg-[#0D0F0E] px-3 font-mono text-xs text-white"
            />
            <input
              type="text"
              value={smsText}
              onChange={(e) => setSmsText(e.target.value)}
              placeholder="Treść SMS..."
              className="w-full min-h-[40px] rounded-lg border border-[#242B26] bg-[#0D0F0E] px-3 text-xs text-white"
            />
            <div className="grid grid-cols-2 gap-2">
              <a
                href={`tel:${callPhone.replace(/\s+/g, "")}`}
                className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-emerald-500/35 bg-emerald-500/15 px-3 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25"
              >
                <Phone className="h-3.5 w-3.5" />
                Zadzwoń
              </a>
              <a
                href={`sms:${callPhone.replace(/\s+/g, "")}?body=${encodeURIComponent(
                  smsText
                )}`}
                className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-[#242B26] bg-[#141816] px-3 text-xs font-semibold text-white hover:border-emerald-500/40"
              >
                <MessageSquare className="h-3.5 w-3.5 text-emerald-400" />
                Wyślij SMS
              </a>
            </div>
          </div>

          {/* Maps geo intent */}
          <div className="flex items-center gap-2 rounded-xl border border-[#242B26] bg-[#050506] p-3">
            <input
              type="text"
              value={mapQuery}
              onChange={(e) => setMapQuery(e.target.value)}
              placeholder="Szukaj w aplikacji Mapy..."
              className="min-w-0 flex-1 min-h-[38px] rounded-lg border border-[#242B26] bg-[#0D0F0E] px-3 text-xs text-white"
            />
            <a
              href={`geo:0,0?q=${encodeURIComponent(mapQuery)}`}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[#242B26] bg-[#141816] px-3 text-xs font-semibold text-neutral-200 hover:border-emerald-500/40 whitespace-nowrap shrink-0"
            >
              <MapPin className="h-3.5 w-3.5 text-emerald-400" />
              Otwórz GPS
            </a>
          </div>
        </section>
      </div>

      {/* ROW 2: LOGIN-FREE EMAIL COMPOSER */}
      <section
        id="phone-section-email"
        className="rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1E2420] pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-lg font-bold text-white">
                Szybki E-mail (Szkic AI i aplikacja poczty)
              </h3>
              <p className="text-xs text-neutral-400">
                Miękiszon ułoży treść wiadomości, a Ty wyślesz ją jednym
                kliknięciem przez aplikację pocztową w telefonie — bez logowania.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleDraftEmailWithAI}
            disabled={draftingEmail}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-emerald-500/35 bg-emerald-500/15 px-3.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 cursor-pointer"
          >
            {draftingEmail ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Ułóż treść przez Miękiszona
          </button>
        </div>

        {draftError && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-200">
            {draftError}
          </div>
        )}

        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="text"
              value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
              placeholder="Odbiorca (opcjonalnie)"
              className="w-full min-h-[42px] rounded-xl border border-[#242B26] bg-[#050506] px-3.5 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
            />
            <input
              type="text"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              placeholder="Temat wiadomości"
              className="w-full min-h-[42px] rounded-xl border border-[#242B26] bg-[#050506] px-3.5 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <textarea
            rows={4}
            value={emailBody}
            onChange={(e) => setEmailBody(e.target.value)}
            placeholder="Treść wiadomości lub krótkie wytyczne dla Miękiszona..."
            className="w-full rounded-xl border border-[#242B26] bg-[#050506] px-3.5 py-2.5 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
          />

          <a
            href={`mailto:${encodeURIComponent(
              emailTo
            )}?subject=${encodeURIComponent(
              emailSubject
            )}&body=${encodeURIComponent(emailBody)}`}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-black hover:bg-emerald-400"
          >
            <ExternalLink className="h-4 w-4" />
            Otwórz w aplikacji poczty i wyślij
          </a>
        </div>
      </section>
    </div>
  );
};
