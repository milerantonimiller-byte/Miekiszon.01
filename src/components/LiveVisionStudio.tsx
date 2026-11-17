import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  Eye,
  Loader2,
  Monitor,
  Play,
  RefreshCw,
  Send,
  Square,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { VoicePreset } from "../types";
import { speakWithMiekiszon, stopSpeaking } from "../utils/ttsPlayer";

interface LiveVisionStudioProps {
  voicePreset: VoicePreset;
}

export const LiveVisionStudio: React.FC<LiveVisionStudioProps> = ({
  voicePreset,
}) => {
  const [sourceType, setSourceType] = useState<"camera" | "screen" | null>(
    null
  );
  const [facingMode, setFacingMode] = useState<"environment" | "user">(
    "environment"
  );
  const [prompt, setPrompt] = useState(
    "Powiedz co widzisz i pomóż mi krok po kroku w tej czynności."
  );
  const [analyzing, setAnalyzing] = useState(false);
  const [autoAssist, setAutoAssist] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<
    Array<{ id: string; time: string; source: "camera" | "screen"; text: string }>
  >([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopStream = useCallback(() => {
    setAutoAssist(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setSourceType(null);
  }, []);

  useEffect(() => {
    return () => {
      stopStream();
      stopSpeaking();
    };
  }, [stopStream]);

  const startCamera = async (mode: "environment" | "user" = facingMode) => {
    setError(null);
    stopStream();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setFacingMode(mode);
      setSourceType("camera");
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? `Brak dostępu do kamery: ${err.message}`
          : "Nie udało się uruchomić kamery."
      );
    }
  };

  const startScreenShare = async () => {
    setError(null);
    stopStream();
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError(
        "Twoja przeglądarka mobilna nie obsługuje udostępniania ekranu (getDisplayMedia). Użyj tylnej kamery lub przeglądarki desktopowej."
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        stopStream();
      });
      streamRef.current = stream;
      setSourceType("screen");
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? `Anulowano lub zablokowano udostępnianie ekranu: ${err.message}`
          : "Nie udało się udostępnić ekranu."
      );
    }
  };

  const captureAndAnalyze = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !sourceType || video.readyState < 2) return;

    const w = Math.min(video.videoWidth || 960, 1280);
    const h = Math.round((w / (video.videoWidth || 16)) * (video.videoHeight || 9));
    canvas.width = w;
    canvas.height = h || 540;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    const base64 = dataUrl.split(",")[1];
    if (!base64) return;

    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch("/api/vision/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: base64,
          mimeType: "image/jpeg",
          prompt:
            prompt.trim() ||
            "Opisz co widzisz i pomóż mi krok po kroku w tej czynności.",
          sourceType,
        }),
      });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Błąd analizy obrazu na żywo.");
      }
      const reply = data.text || "";
      if (reply) {
        setHistory((prev) => [
          {
            id: crypto.randomUUID(),
            time: new Date().toLocaleTimeString("pl-PL", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }),
            source: sourceType,
            text: reply,
          },
          ...prev.slice(0, 9),
        ]);
        if (speakReplies && voicePreset !== "off") {
          void speakWithMiekiszon(reply, voicePreset);
        }
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Nie udało się przeanalizować klatki."
      );
    } finally {
      setAnalyzing(false);
    }
  }, [prompt, sourceType, speakReplies, voicePreset]);

  useEffect(() => {
    if (!autoAssist || !sourceType) return;
    const interval = setInterval(() => {
      if (!analyzing) {
        void captureAndAnalyze();
      }
    }, 6500);
    return () => clearInterval(interval);
  }, [autoAssist, sourceType, analyzing, captureAndAnalyze]);

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      {/* Left: Video preview & controls */}
      <div className="space-y-4 rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-5 lg:col-span-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-bold text-white">
              Asysta na żywo: Kamera tylna i Ekran
            </h3>
            <p className="mt-0.5 text-xs text-neutral-400">
              Pokaż problem przed kamerą lub udostępnij ekran — Miękiszon
              podpowie na głos, co zrobić dalej.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => startCamera("environment")}
              className={`inline-flex min-h-[42px] items-center gap-2 rounded-xl px-3.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                sourceType === "camera"
                  ? "bg-emerald-500 text-black"
                  : "border border-[#242B26] bg-[#141816] text-neutral-200 hover:border-emerald-500/40"
              }`}
            >
              <Camera className="h-4 w-4" />
              Kamera tylna
            </button>
            <button
              type="button"
              onClick={startScreenShare}
              className={`inline-flex min-h-[42px] items-center gap-2 rounded-xl px-3.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                sourceType === "screen"
                  ? "bg-emerald-500 text-black"
                  : "border border-[#242B26] bg-[#141816] text-neutral-200 hover:border-emerald-500/40"
              }`}
            >
              <Monitor className="h-4 w-4" />
              Udostępnij ekran
            </button>
            {sourceType && (
              <button
                type="button"
                onClick={stopStream}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 px-3 text-xs font-semibold text-red-300 hover:bg-red-500/20 cursor-pointer"
              >
                <Square className="h-3.5 w-3.5" />
                Zatrzymaj
              </button>
            )}
          </div>
        </div>

        <div className="relative overflow-hidden rounded-xl border border-[#242B26] bg-[#050506] aspect-video">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-contain"
          />
          <canvas ref={canvasRef} className="hidden" />
          {!sourceType && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
              <Eye className="h-9 w-9 text-emerald-400/70" />
              <p className="mt-3 text-sm font-medium text-white">
                Wybierz kamerę tylną lub udostępnianie ekranu
              </p>
              <p className="mt-1 max-w-sm text-xs text-neutral-500">
                Obraz jest przetwarzany na żywo wyłącznie wtedy, gdy włączysz
                podgląd i wyślesz klatkę do analizy.
              </p>
            </div>
          )}
          {sourceType === "camera" && (
            <button
              type="button"
              onClick={() =>
                startCamera(facingMode === "environment" ? "user" : "environment")
              }
              className="absolute right-3 top-3 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-white/15 bg-black/75 px-3 text-xs text-white backdrop-blur-sm hover:bg-black cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {facingMode === "environment" ? "Przełącz na przednią" : "Przełącz na tylną"}
            </button>
          )}
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-200">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="O co zapytać w związku z tym co widać?"
              className="min-w-0 flex-1 min-h-[44px] rounded-xl border border-[#242B26] bg-[#050506] px-3.5 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={captureAndAnalyze}
              disabled={!sourceType || analyzing}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {analyzing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Analizuj teraz
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#1E2420] bg-[#050506] px-4 py-2.5 text-xs">
            <label className="flex items-center gap-2 text-neutral-300 cursor-pointer">
              <input
                type="checkbox"
                checked={autoAssist}
                disabled={!sourceType}
                onChange={(e) => setAutoAssist(e.target.checked)}
                className="h-4 w-4 accent-emerald-500"
              />
              <Play className="h-3.5 w-3.5 text-emerald-400" />
              <span>Asysta ciągła w czasie rzeczywistym (co 6,5 s)</span>
            </label>

            <button
              type="button"
              onClick={() => setSpeakReplies((v) => !v)}
              className="inline-flex items-center gap-1.5 text-neutral-300 hover:text-white cursor-pointer"
            >
              {speakReplies ? (
                <Volume2 className="h-4 w-4 text-emerald-400" />
              ) : (
                <VolumeX className="h-4 w-4 text-neutral-500" />
              )}
              <span>{speakReplies ? "Podpowiedzi głosowe: Wł." : "Głos wyciszony"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Right: Real-time guidance feed */}
      <div className="flex flex-col rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-5 lg:col-span-5">
        <h4 className="font-display text-sm font-semibold text-white">
          Wskazówki Miękiszona na żywo
        </h4>
        <div className="mt-3 flex-1 space-y-3 overflow-y-auto max-h-[480px] pr-1">
          {history.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#242B26] bg-[#050506] p-6 text-center text-xs text-neutral-500">
              Uruchom kamerę tylną lub udostępnianie ekranu, a następnie kliknij
              „Analizuj teraz” albo włącz asystę ciągłą.
            </div>
          ) : (
            history.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-[#242B26] bg-[#050506] p-3.5 space-y-1.5"
              >
                <div className="flex items-center justify-between text-[11px] text-neutral-500">
                  <span>
                    {item.source === "screen" ? "Ekran" : "Kamera"} ·{" "}
                    <span className="font-mono">{item.time}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => speakWithMiekiszon(item.text, voicePreset)}
                    className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 cursor-pointer"
                  >
                    <Volume2 className="h-3.5 w-3.5" />
                    Odtwórz
                  </button>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-200">
                  {item.text}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
