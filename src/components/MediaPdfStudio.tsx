import React, { useEffect, useRef, useState } from "react";
import {
  Copy,
  Check,
  Download,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Mic,
  Sparkles,
  Square,
  Upload,
  Volume2,
  Wand2,
  X,
} from "lucide-react";
import type { MediaSubTab, VoicePreset } from "../types";
import { speakWithMiekiszon } from "../utils/ttsPlayer";

interface MediaPdfStudioProps {
  voicePreset: VoicePreset;
  initialTab?: { tab: MediaSubTab; nonce: number } | null;
}

type StudioTab = "image" | "video" | "pdf";
type ImageSize = "1K" | "2K" | "4K";
type ImageAspect = "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
type DocTask = "translate" | "proofread" | "summarize" | "extract";

function readFileAsBase64(file: File): Promise<{
  base64: string;
  mimeType: string;
  previewUrl: string;
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const commaIdx = result.indexOf(",");
      const base64 = commaIdx >= 0 ? result.slice(commaIdx + 1) : result;
      resolve({
        base64,
        mimeType: file.type || "application/octet-stream",
        previewUrl: result,
      });
    };
    reader.onerror = () => reject(new Error("Nie udało się odczytać pliku."));
    reader.readAsDataURL(file);
  });
}

export const MediaPdfStudio: React.FC<MediaPdfStudioProps> = ({
  voicePreset,
  initialTab,
}) => {
  const [activeTab, setActiveTab] = useState<StudioTab>(
    initialTab?.tab ?? "image"
  );

  useEffect(() => {
    if (initialTab?.tab) {
      setActiveTab(initialTab.tab);
    }
  }, [initialTab]);

  // Image Generation & Editing state
  const [imgPrompt, setImgPrompt] = useState("");
  const [imageSize, setImageSize] = useState<ImageSize>("1K");
  const [aspectRatio, setAspectRatio] = useState<ImageAspect>("1:1");
  const [sourceImg, setSourceImg] = useState<{
    name: string;
    base64: string;
    mimeType: string;
    previewUrl: string;
  } | null>(null);
  const [imgLoading, setImgLoading] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);
  const [generatedImg, setGeneratedImg] = useState<{
    url: string;
    caption: string;
    size: string;
    ratio: string;
  } | null>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);

  // Video state
  const [vidPrompt, setVidPrompt] = useState("");
  const [vidAspect, setVidAspect] = useState<"16:9" | "9:16">("16:9");
  const [vidDuration, setVidDuration] = useState<"5s" | "10s">("5s");
  const [vidSourceImg, setVidSourceImg] = useState<{
    name: string;
    base64: string;
    mimeType: string;
    previewUrl: string;
  } | null>(null);
  const [vidLoading, setVidLoading] = useState(false);
  const [vidError, setVidError] = useState<string | null>(null);
  const [generatedVidUrl, setGeneratedVidUrl] = useState<string | null>(null);
  const vidInputRef = useRef<HTMLInputElement>(null);

  // PDF & Document state
  const [docFile, setDocFile] = useState<{
    name: string;
    base64: string;
    mimeType: string;
    sizeKb: number;
  } | null>(null);
  const [docTask, setDocTask] = useState<DocTask>("translate");
  const [targetLang, setTargetLang] = useState("Polski");
  const [docInstructions, setDocInstructions] = useState("");
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [docResult, setDocResult] = useState("");
  const [copied, setCopied] = useState(false);
  const docInputRef = useRef<HTMLInputElement>(null);

  // Voice dictation via microphone across Foto / Wideo / PDF
  const [dictatingTarget, setDictatingTarget] = useState<StudioTab | null>(null);
  const [transcribingTarget, setTranscribingTarget] = useState<StudioTab | null>(
    null
  );
  const [recordingSec, setRecordingSec] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (!dictatingTarget) {
      setRecordingSec(0);
      return;
    }
    const timer = setInterval(() => {
      setRecordingSec((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [dictatingTarget]);

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

  const setErrorForTarget = (target: StudioTab, msg: string | null) => {
    if (target === "image") setImgError(msg);
    else if (target === "video") setVidError(msg);
    else setDocError(msg);
  };

  const toggleMicDictation = async (target: StudioTab) => {
    if (dictatingTarget === target) {
      mediaRecorderRef.current?.stop();
      setDictatingTarget(null);
      return;
    }

    if (dictatingTarget && mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      setDictatingTarget(null);
    }

    setErrorForTarget(target, null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorForTarget(
        target,
        "Twoja przeglądarka nie obsługuje nagrywania z mikrofonu."
      );
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

        setTranscribingTarget(target);
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
            if (target === "image") {
              setImgPrompt((prev) =>
                prev.trim() ? `${prev.trim()} ${spoken}` : spoken
              );
            } else if (target === "video") {
              setVidPrompt((prev) =>
                prev.trim() ? `${prev.trim()} ${spoken}` : spoken
              );
            } else {
              setDocInstructions((prev) =>
                prev.trim() ? `${prev.trim()} ${spoken}` : spoken
              );
            }
          }
        } catch (err) {
          setErrorForTarget(
            target,
            err instanceof Error
              ? err.message
              : "Błąd rozpoznawania mowy z mikrofonu."
          );
        } finally {
          setTranscribingTarget(null);
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setDictatingTarget(target);
    } catch (err) {
      setErrorForTarget(
        target,
        err instanceof Error
          ? `Brak dostępu do mikrofonu: ${err.message}`
          : "Brak dostępu do mikrofonu. Nadaj uprawnienia w przeglądarce."
      );
    }
  };

  const handleSourceImgSelect = async (
    e: React.ChangeEvent<HTMLInputElement>,
    target: "image" | "video"
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await readFileAsBase64(file);
      const payload = {
        name: file.name,
        base64: data.base64,
        mimeType: data.mimeType,
        previewUrl: data.previewUrl,
      };
      if (target === "image") setSourceImg(payload);
      else setVidSourceImg(payload);
    } catch (err) {
      if (target === "image") {
        setImgError(err instanceof Error ? err.message : "Błąd pliku.");
      } else {
        setVidError(err instanceof Error ? err.message : "Błąd pliku.");
      }
    }
    e.target.value = "";
  };

  const handleGenerateImage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imgPrompt.trim()) return;
    setImgLoading(true);
    setImgError(null);

    try {
      const res = await fetch("/api/image/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: imgPrompt.trim(),
          imageSize,
          aspectRatio,
          sourceImageBase64: sourceImg?.base64,
          sourceMimeType: sourceImg?.mimeType,
        }),
      });
      const data = (await res.json()) as {
        imageUrl?: string;
        caption?: string;
        imageSize?: string;
        aspectRatio?: string;
        error?: string;
      };
      if (!res.ok || !data.imageUrl) {
        throw new Error(data.error || "Nie udało się wygenerować obrazu.");
      }
      setGeneratedImg({
        url: data.imageUrl,
        caption: data.caption || "",
        size: data.imageSize || imageSize,
        ratio: data.aspectRatio || aspectRatio,
      });
    } catch (err) {
      setImgError(
        err instanceof Error ? err.message : "Błąd generowania obrazu."
      );
    } finally {
      setImgLoading(false);
    }
  };

  const handleGenerateVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vidPrompt.trim()) return;
    setVidLoading(true);
    setVidError(null);

    try {
      const res = await fetch("/api/video/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: vidPrompt.trim(),
          aspectRatio: vidAspect,
          duration: vidDuration,
          sourceImageBase64: vidSourceImg?.base64,
          sourceMimeType: vidSourceImg?.mimeType,
        }),
      });
      const data = (await res.json()) as {
        videoUrl?: string;
        error?: string;
      };
      if (!res.ok || !data.videoUrl) {
        throw new Error(data.error || "Nie udało się wygenerować wideo.");
      }
      setGeneratedVidUrl(data.videoUrl);
    } catch (err) {
      setVidError(
        err instanceof Error ? err.message : "Błąd generowania wideo."
      );
    } finally {
      setVidLoading(false);
    }
  };

  const handleDocSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDocError(null);
    try {
      const data = await readFileAsBase64(file);
      setDocFile({
        name: file.name,
        base64: data.base64,
        mimeType:
          data.mimeType ||
          (file.name.endsWith(".pdf") ? "application/pdf" : "text/plain"),
        sizeKb: Math.max(1, Math.round(file.size / 1024)),
      });
    } catch (err) {
      setDocError(err instanceof Error ? err.message : "Błąd odczytu pliku.");
    }
    e.target.value = "";
  };

  const handleProcessDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docFile) {
      setDocError("Wgraj najpierw plik PDF, zdjęcie dokumentu lub plik tekstowy.");
      return;
    }
    setDocLoading(true);
    setDocError(null);
    try {
      const res = await fetch("/api/document/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileBase64: docFile.base64,
          mimeType: docFile.mimeType,
          fileName: docFile.name,
          task: docTask,
          targetLanguage: targetLang,
          customInstructions: docInstructions,
        }),
      });
      const data = (await res.json()) as { result?: string; error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Nie udało się przetworzyć dokumentu.");
      }
      setDocResult(data.result || "");
    } catch (err) {
      setDocError(
        err instanceof Error ? err.message : "Błąd analizy dokumentu."
      );
    } finally {
      setDocLoading(false);
    }
  };

  const handleCopyDoc = async () => {
    if (!docResult) return;
    await navigator.clipboard.writeText(docResult);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownloadTxt = () => {
    if (!docResult) return;
    const blob = new Blob([docResult], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `miekiszon-${docTask}-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-3">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTab("image")}
            className={`inline-flex min-h-[42px] items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === "image"
                ? "bg-emerald-500 text-black"
                : "text-neutral-300 hover:bg-[#141816] hover:text-white"
            }`}
          >
            <ImageIcon className="h-4 w-4" />
            Przerabianie i Obrazy (1K–4K)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("video")}
            className={`inline-flex min-h-[42px] items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === "video"
                ? "bg-emerald-500 text-black"
                : "text-neutral-300 hover:bg-[#141816] hover:text-white"
            }`}
          >
            <Film className="h-4 w-4" />
            Krótkie Filmiki
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("pdf")}
            className={`inline-flex min-h-[42px] items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === "pdf"
                ? "bg-emerald-500 text-black"
                : "text-neutral-300 hover:bg-[#141816] hover:text-white"
            }`}
          >
            <FileText className="h-4 w-4" />
            PDF: Tłumaczenie i Korekta
          </button>
        </div>
        <span className="text-xs text-neutral-500">
          {activeTab === "image"
            ? imageSize === "1K"
              ? "gemini-3.1-flash-lite-image"
              : "gemini-nano-banana-2.1"
            : activeTab === "video"
              ? "gemini-omni-1.2-flash"
              : "gemini-4-hydrogen"}
        </span>
      </div>

      {/* TAB 1: IMAGE GENERATION & EDITING */}
      {activeTab === "image" && (
        <div className="grid gap-5 lg:grid-cols-12">
          <form
            onSubmit={handleGenerateImage}
            className="space-y-4 rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-5 lg:col-span-5"
          >
            <div>
              <h3 className="font-display text-lg font-bold text-white">
                Studio Obrazów i Retuszu
              </h3>
              <p className="mt-1 text-xs text-neutral-400">
                Wygeneruj nową grafikę lub wgraj zdjęcie, aby je przerobić,
                zmienić tło albo poprawić jakość.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-neutral-300">
                Zdjęcie bazowe do przeróbki (opcjonalnie)
              </label>
              <input
                ref={imgInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => handleSourceImgSelect(e, "image")}
                className="hidden"
              />
              {sourceImg ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-[#242B26] bg-[#050506] p-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <img
                      src={sourceImg.previewUrl}
                      alt={sourceImg.name}
                      className="h-12 w-12 rounded-lg object-cover border border-[#242B26]"
                    />
                    <span className="truncate text-xs text-neutral-200">
                      {sourceImg.name}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSourceImg(null)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-white cursor-pointer"
                    aria-label="Usuń zdjęcie"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => imgInputRef.current?.click()}
                  className="flex w-full min-h-[48px] items-center justify-center gap-2 rounded-xl border border-dashed border-[#2C352F] bg-[#050506] px-4 py-3 text-xs font-medium text-neutral-300 hover:border-emerald-500/40 hover:text-white cursor-pointer"
                >
                  <Upload className="h-4 w-4 text-emerald-400" />
                  Wgraj zdjęcie do przeróbki
                </button>
              )}
            </div>

            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <label className="block text-xs font-medium text-neutral-300">
                  Co mam stworzyć lub przerobić?
                </label>
                <button
                  type="button"
                  onClick={() => void toggleMicDictation("image")}
                  disabled={transcribingTarget === "image"}
                  className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    dictatingTarget === "image"
                      ? "border-red-500 bg-red-500 text-white"
                      : "border-[#242B26] bg-[#141715] text-emerald-300 hover:border-emerald-500/50 hover:text-white disabled:opacity-50"
                  }`}
                >
                  {transcribingTarget === "image" ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Przetwarzam głos...
                    </>
                  ) : dictatingTarget === "image" ? (
                    <>
                      <Square className="h-3 w-3" />
                      <span className="font-mono tabular-nums">
                        {Math.floor(recordingSec / 60)}:
                        {String(recordingSec % 60).padStart(2, "0")}
                      </span>
                      Zatrzymaj
                    </>
                  ) : (
                    <>
                      <Mic className="h-3.5 w-3.5" />
                      Powiedz przez mikrofon
                    </>
                  )}
                </button>
              </div>
              <textarea
                rows={3}
                value={imgPrompt}
                onChange={(e) => setImgPrompt(e.target.value)}
                placeholder={
                  sourceImg
                    ? "Wpisz lub powiedz przez mikrofon, np. Zmień tło na nocną Warszawę i wyostrz detale"
                    : "Wpisz lub powiedz przez mikrofon, co mam stworzyć (np. Plakat sportowego auta z neonowym światłem)"
                }
                className="w-full rounded-xl border border-[#242B26] bg-[#050506] px-3.5 py-2.5 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
                required
              />
            </div>

            {/* Mandatory explicit image size 1K / 2K / 4K */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-neutral-300">
                Rozdzielczość obrazu
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(["1K", "2K", "4K"] as ImageSize[]).map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setImageSize(sz)}
                    className={`min-h-[42px] rounded-xl border text-xs font-semibold font-mono transition-colors cursor-pointer ${
                      imageSize === sz
                        ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                        : "border-[#242B26] bg-[#050506] text-neutral-300 hover:border-neutral-600"
                    }`}
                  >
                    {sz}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-neutral-300">
                Proporcje kadru
              </label>
              <div className="grid grid-cols-5 gap-1.5">
                {(["1:1", "16:9", "9:16", "4:3", "3:4"] as ImageAspect[]).map(
                  (ratio) => (
                    <button
                      key={ratio}
                      type="button"
                      onClick={() => setAspectRatio(ratio)}
                      className={`min-h-[38px] rounded-lg border text-xs font-mono transition-colors cursor-pointer ${
                        aspectRatio === ratio
                          ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                          : "border-[#242B26] bg-[#050506] text-neutral-400 hover:text-white"
                      }`}
                    >
                      {ratio}
                    </button>
                  )
                )}
              </div>
            </div>

            {imgError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-200">
                {imgError}
              </div>
            )}

            <button
              type="submit"
              disabled={imgLoading}
              className="flex w-full min-h-[46px] items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-60 cursor-pointer"
            >
              {imgLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4" />
              )}
              {sourceImg ? "Przerób zdjęcie" : "Generuj obraz"} ({imageSize})
            </button>
          </form>

          <div className="flex flex-col justify-between rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-5 lg:col-span-7">
            {generatedImg ? (
              <div className="space-y-4">
                <div className="overflow-hidden rounded-xl border border-[#242B26] bg-[#050506]">
                  <img
                    src={generatedImg.url}
                    alt="Wygenerowany obraz Miękiszona"
                    className="max-h-[480px] w-full object-contain"
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-neutral-400">
                    Rozdzielczość:{" "}
                    <span className="font-mono text-white">
                      {generatedImg.size}
                    </span>{" "}
                    · Proporcje:{" "}
                    <span className="font-mono text-white">
                      {generatedImg.ratio}
                    </span>
                  </div>
                  <a
                    href={generatedImg.url}
                    download={`miekiszon-${generatedImg.size}.png`}
                    className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-[#242B26] bg-[#141816] px-4 py-2 text-xs font-semibold text-white hover:border-emerald-500/40"
                  >
                    <Download className="h-4 w-4 text-emerald-400" />
                    Pobierz obraz
                  </a>
                </div>
                {generatedImg.caption && (
                  <p className="text-xs text-neutral-300">
                    {generatedImg.caption}
                  </p>
                )}
              </div>
            ) : (
              <div className="flex h-full min-h-[320px] flex-col items-center justify-center rounded-xl border border-dashed border-[#242B26] bg-[#050506] p-8 text-center">
                <Sparkles className="h-8 w-8 text-emerald-400/70" />
                <p className="mt-3 text-sm font-medium text-white">
                  Podgląd gotowego obrazu pojawi się tutaj
                </p>
                <p className="mt-1 max-w-sm text-xs text-neutral-500">
                  Możesz tworzyć grafiki od zera lub przesłać własne zdjęcie do
                  retuszu w rozdzielczości 1K, 2K lub 4K.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: SHORT VIDEO */}
      {activeTab === "video" && (
        <div className="grid gap-5 lg:grid-cols-12">
          <form
            onSubmit={handleGenerateVideo}
            className="space-y-4 rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-5 lg:col-span-5"
          >
            <div>
              <h3 className="font-display text-lg font-bold text-white">
                Generator Krótkich Filmików
              </h3>
              <p className="mt-1 text-xs text-neutral-400">
                Stwórz krótki klip wideo z opisu tekstowego lub ożyw przesłane
                zdjęcie.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-neutral-300">
                Klatka startowa (opcjonalnie)
              </label>
              <input
                ref={vidInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => handleSourceImgSelect(e, "video")}
                className="hidden"
              />
              {vidSourceImg ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-[#242B26] bg-[#050506] p-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <img
                      src={vidSourceImg.previewUrl}
                      alt={vidSourceImg.name}
                      className="h-12 w-12 rounded-lg object-cover"
                    />
                    <span className="truncate text-xs text-neutral-200">
                      {vidSourceImg.name}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setVidSourceImg(null)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-white cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => vidInputRef.current?.click()}
                  className="flex w-full min-h-[46px] items-center justify-center gap-2 rounded-xl border border-dashed border-[#2C352F] bg-[#050506] px-4 py-3 text-xs font-medium text-neutral-300 hover:border-emerald-500/40 hover:text-white cursor-pointer"
                >
                  <Upload className="h-4 w-4 text-emerald-400" />
                  Wgraj zdjęcie do animacji
                </button>
              )}
            </div>

            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <label className="block text-xs font-medium text-neutral-300">
                  Scenariusz krótkiego filmu
                </label>
                <button
                  type="button"
                  onClick={() => void toggleMicDictation("video")}
                  disabled={transcribingTarget === "video"}
                  className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    dictatingTarget === "video"
                      ? "border-red-500 bg-red-500 text-white"
                      : "border-[#242B26] bg-[#141715] text-emerald-300 hover:border-emerald-500/50 hover:text-white disabled:opacity-50"
                  }`}
                >
                  {transcribingTarget === "video" ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Przetwarzam głos...
                    </>
                  ) : dictatingTarget === "video" ? (
                    <>
                      <Square className="h-3 w-3" />
                      <span className="font-mono tabular-nums">
                        {Math.floor(recordingSec / 60)}:
                        {String(recordingSec % 60).padStart(2, "0")}
                      </span>
                      Zatrzymaj
                    </>
                  ) : (
                    <>
                      <Mic className="h-3.5 w-3.5" />
                      Powiedz przez mikrofon
                    </>
                  )}
                </button>
              </div>
              <textarea
                rows={3}
                value={vidPrompt}
                onChange={(e) => setVidPrompt(e.target.value)}
                placeholder="Wpisz lub powiedz przez mikrofon scenariusz filmu (np. Przelot kamery nad lasem o poranku)"
                className="w-full rounded-xl border border-[#242B26] bg-[#050506] px-3.5 py-2.5 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-neutral-300">
                  Format wideo
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {(["16:9", "9:16"] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setVidAspect(r)}
                      className={`min-h-[40px] rounded-xl border text-xs font-mono cursor-pointer ${
                        vidAspect === r
                          ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                          : "border-[#242B26] bg-[#050506] text-neutral-300"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-neutral-300">
                  Czas trwania
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {(["5s", "10s"] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setVidDuration(d)}
                      className={`min-h-[40px] rounded-xl border text-xs font-mono cursor-pointer ${
                        vidDuration === d
                          ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                          : "border-[#242B26] bg-[#050506] text-neutral-300"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {vidError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-200">
                {vidError}
              </div>
            )}

            <button
              type="submit"
              disabled={vidLoading}
              className="flex w-full min-h-[46px] items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-60 cursor-pointer"
            >
              {vidLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Film className="h-4 w-4" />
              )}
              {vidLoading ? "Renderowanie filmu..." : "Generuj krótki filmik"}
            </button>
          </form>

          <div className="flex flex-col justify-center rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-5 lg:col-span-7">
            {generatedVidUrl ? (
              <div className="space-y-4">
                <video
                  src={generatedVidUrl}
                  controls
                  autoPlay
                  loop
                  playsInline
                  className="max-h-[460px] w-full rounded-xl border border-[#242B26] bg-black"
                />
                <div className="flex justify-end">
                  <a
                    href={generatedVidUrl}
                    download={`miekiszon-wideo-${Date.now()}.mp4`}
                    className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-[#242B26] bg-[#141816] px-4 py-2 text-xs font-semibold text-white hover:border-emerald-500/40"
                  >
                    <Download className="h-4 w-4 text-emerald-400" />
                    Pobierz MP4
                  </a>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-dashed border-[#242B26] bg-[#050506] p-8 text-center">
                <Film className="h-8 w-8 text-emerald-400/70" />
                <p className="mt-3 text-sm font-medium text-white">
                  Odtwarzacz wygenerowanego klipu
                </p>
                <p className="mt-1 max-w-sm text-xs text-neutral-500">
                  Idealny do krótkich rolek (9:16) lub poziomych ujęć (16:9).
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: PDF & DOCUMENT TRANSLATION / PROOFREADING */}
      {activeTab === "pdf" && (
        <div className="grid gap-5 lg:grid-cols-12">
          <form
            onSubmit={handleProcessDoc}
            className="space-y-4 rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-5 lg:col-span-5"
          >
            <div>
              <h3 className="font-display text-lg font-bold text-white">
                Tłumaczenie i Korekta PDF / Zdjęć
              </h3>
              <p className="mt-1 text-xs text-neutral-400">
                Wgraj plik PDF, skan dokumentu albo zdjęcie tekstu — Miękiszon
                go przetłumaczy, poprawi błędy lub streści.
              </p>
            </div>

            <div>
              <input
                ref={docInputRef}
                type="file"
                accept="application/pdf,image/*,.txt,.md,.csv"
                onChange={handleDocSelect}
                className="hidden"
              />
              {docFile ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <FileText className="h-5 w-5 shrink-0 text-emerald-400" />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-white">
                        {docFile.name}
                      </p>
                      <p className="text-[11px] text-neutral-400">
                        {docFile.mimeType} · {docFile.sizeKb} KB
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDocFile(null)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-300 hover:bg-black/30 hover:text-white cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => docInputRef.current?.click()}
                  className="flex w-full min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#2C352F] bg-[#050506] px-4 py-4 text-xs text-neutral-300 hover:border-emerald-500/40 hover:text-white cursor-pointer"
                >
                  <Upload className="h-5 w-5 text-emerald-400" />
                  <span>Wybierz plik PDF, zdjęcie lub dokument</span>
                </button>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-neutral-300">
                Zadanie dla Miękiszona
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["translate", "Przetłumacz"],
                    ["proofread", "Popraw błędy (Korekta)"],
                    ["summarize", "Streszczenie"],
                    ["extract", "Wyodrębnij dane"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setDocTask(id)}
                    className={`min-h-[42px] rounded-xl border px-3 text-xs font-semibold transition-colors cursor-pointer ${
                      docTask === id
                        ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                        : "border-[#242B26] bg-[#050506] text-neutral-300 hover:border-neutral-600"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="pdf-target-lang"
                className="mb-1.5 block text-xs font-medium text-neutral-300"
              >
                Język docelowy wyniku (tylko Polski / Deutsch)
              </label>
              <select
                id="pdf-target-lang"
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-[#242B26] bg-[#050506] px-3.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
              >
                <option value="Polski">Polski (PL)</option>
                <option value="Niemiecki (Deutsch)">Niemiecki / Deutsch (DE)</option>
              </select>
            </div>

            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <label className="block text-xs font-medium text-neutral-300">
                  Dodatkowe uwagi (opcjonalnie)
                </label>
                <button
                  type="button"
                  onClick={() => void toggleMicDictation("pdf")}
                  disabled={transcribingTarget === "pdf"}
                  className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    dictatingTarget === "pdf"
                      ? "border-red-500 bg-red-500 text-white"
                      : "border-[#242B26] bg-[#141715] text-emerald-300 hover:border-emerald-500/50 hover:text-white disabled:opacity-50"
                  }`}
                >
                  {transcribingTarget === "pdf" ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Przetwarzam głos...
                    </>
                  ) : dictatingTarget === "pdf" ? (
                    <>
                      <Square className="h-3 w-3" />
                      <span className="font-mono tabular-nums">
                        {Math.floor(recordingSec / 60)}:
                        {String(recordingSec % 60).padStart(2, "0")}
                      </span>
                      Zatrzymaj
                    </>
                  ) : (
                    <>
                      <Mic className="h-3.5 w-3.5" />
                      Powiedz przez mikrofon
                    </>
                  )}
                </button>
              </div>
              <input
                type="text"
                value={docInstructions}
                onChange={(e) => setDocInstructions(e.target.value)}
                placeholder="Wpisz lub podyktuj (np. Zachowaj oficjalny ton prawniczy)"
                className="w-full min-h-[42px] rounded-xl border border-[#242B26] bg-[#050506] px-3.5 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            {docError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-200">
                {docError}
              </div>
            )}

            <button
              type="submit"
              disabled={docLoading}
              className="flex w-full min-h-[46px] items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-60 cursor-pointer"
            >
              {docLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {docLoading ? "Przetwarzanie pliku..." : "Przetwórz dokument"}
            </button>
          </form>

          <div className="flex flex-col rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-5 lg:col-span-7">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[#1E2420] pb-3">
              <h4 className="font-display text-sm font-semibold text-white">
                Wynik analizy dokumentu
              </h4>
              {docResult && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => speakWithMiekiszon(docResult, voicePreset)}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[#242B26] bg-[#141816] px-3 text-xs text-neutral-200 hover:border-emerald-500/40 cursor-pointer"
                  >
                    <Volume2 className="h-3.5 w-3.5 text-emerald-400" />
                    Odsłuchaj
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyDoc}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[#242B26] bg-[#141816] px-3 text-xs text-neutral-200 hover:border-emerald-500/40 cursor-pointer"
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {copied ? "Skopiowano" : "Kopiuj"}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadTxt}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[#242B26] bg-[#141816] px-3 text-xs text-neutral-200 hover:border-emerald-500/40 cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5 text-emerald-400" />
                    Pobierz .txt
                  </button>
                </div>
              )}
            </div>

            {docResult ? (
              <div className="max-h-[460px] flex-1 overflow-y-auto whitespace-pre-wrap rounded-xl border border-[#242B26] bg-[#050506] p-4 text-sm leading-relaxed text-neutral-200">
                {docResult}
              </div>
            ) : (
              <div className="flex min-h-[300px] flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-[#242B26] bg-[#050506] p-6 text-center">
                <FileText className="h-8 w-8 text-emerald-400/70" />
                <p className="mt-3 text-sm font-medium text-white">
                  Tutaj pojawi się przetłumaczony lub poprawiony tekst
                </p>
                <p className="mt-1 max-w-sm text-xs text-neutral-500">
                  Obsługiwane są pliki PDF, zdjęcia stron oraz pliki tekstowe.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
