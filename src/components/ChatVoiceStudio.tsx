import React, { useEffect, useRef, useState } from "react";
import {
  BedDouble,
  Camera,
  CameraOff,
  Globe,
  Loader2,
  MapPin,
  Mic,
  MicOff,
  MonitorSmartphone,
  Paperclip,
  PhoneCall,
  PhoneOff,
  Radio,
  Send,
  Sparkles,
  Square,
  Trash2,
  Utensils,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type {
  ChatMessage,
  FoodPlace,
  GeminiChatModel,
  GeoLocation,
  LiveCallBarState,
  LiveFoodUpdate,
  StaySearchPrefill,
  VoicePreset,
  WorkspaceTab,
} from "../types";
import { speakWithMiekiszon, stopSpeaking } from "../utils/ttsPlayer";

export interface ExternalLiveCommand {
  action: "start" | "stop" | "toggle_mute" | "interrupt" | "context_note";
  note?: string;
  triggerReply?: boolean;
  syncPlaces?: Array<{
    id: string;
    name: string;
    address: string;
    phone?: string;
    internationalPhone?: string;
    rating?: number;
    googleMapsUri: string;
  }>;
  nonce: number;
}

interface ChatVoiceStudioProps {
  location: GeoLocation | null;
  voicePreset: VoicePreset;
  onVoicePresetChange: (v: VoicePreset) => void;
  onBookStay?: (prefill: StaySearchPrefill) => void;
  onSwitchTab?: (tab: WorkspaceTab) => void;
  onLiveFoodUpdate?: (update: LiveFoodUpdate) => void;
  onLiveStateChange?: (state: LiveCallBarState) => void;
  externalLiveCommand?: ExternalLiveCommand | null;
  initialPrompt?: { text: string; nonce: number } | null;
}

const LANGUAGES = [
  { code: "pl", label: "Polski (PL)" },
  { code: "de", label: "Deutsch / Niemiecki (DE)" },
  { code: "pl_de", label: "Auto (tylko Polski / Deutsch)" },
];

const MODELS: Array<{ id: GeminiChatModel; label: string; hint: string }> = [
  { id: "gemini-4-hydrogen", label: "Ogólny (Hydrogen)", hint: "Szybki i uniwersalny" },
  { id: "gemini-3.1-flash-lite", label: "Błyskawiczny (Flash Lite)", hint: "Minimalne opóźnienie" },
  { id: "gemini-4-carbon", label: "Głębokie myślenie (Carbon)", hint: "Trudne analizy" },
  { id: "gemini-4-argon", label: "Złożone zadania (Argon)", hint: "Zaawansowane" },
];

const BAR_COUNT = 16;

function voicePresetToLiveName(preset: VoicePreset): string {
  if (preset === "woman_30_pro") return "Zephyr";
  if (preset === "man_calm") return "Charon";
  return "Kore";
}

function resampleFloat32(
  input: Float32Array,
  srcRate: number,
  dstRate: number
): Float32Array {
  if (srcRate === dstRate || srcRate <= 0) return input;
  const ratio = srcRate / dstRate;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s0 = input[idx] ?? 0;
    const s1 = input[Math.min(idx + 1, input.length - 1)] ?? s0;
    output[i] = s0 + (s1 - s0) * frac;
  }
  return output;
}

function pcmFloatToBase64(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function formatCallDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const ChatVoiceStudio: React.FC<ChatVoiceStudioProps> = ({
  location,
  voicePreset,
  onVoicePresetChange,
  onBookStay,
  onSwitchTab,
  onLiveFoodUpdate,
  onLiveStateChange,
  externalLiveCommand,
  initialPrompt,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome-1",
      role: "model",
      text: "Co potrzebujesz ode mnie? Widać, że najwidoczniej potrzebujesz pomocy i jesteś taki słaby, że sam nie dasz rady. Uwierz w siebie, będzie dobrze. Napisz lub kliknij Rozmawiaj na żywo!",
      timestamp: new Date().toLocaleTimeString("pl-PL", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    },
  ]);

  const [input, setInput] = useState("");
  const [model, setModel] = useState<GeminiChatModel>("gemini-3.1-flash-lite");
  const [language, setLanguage] = useState("pl");
  const [useSearch, setUseSearch] = useState(false);
  const [useMaps, setUseMaps] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<
    Array<{ name: string; mimeType: string; data: string }>
  >([]);

  // Dictation (push-to-talk)
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Real-time Live API Voice Call
  const [liveActive, setLiveActive] = useState(false);
  const [livePhase, setLivePhase] = useState<
    "idle" | "connecting" | "listening" | "thinking" | "speaking"
  >("idle");
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [liveDurationSec, setLiveDurationSec] = useState(0);
  const [liveSubtitleUser, setLiveSubtitleUser] = useState("");
  const [liveSubtitleBot, setLiveSubtitleBot] = useState("");
  const [liveQuickText, setLiveQuickText] = useState("");
  const [liveVenueCall, setLiveVenueCall] = useState<{
    placeName: string;
    phone: string;
    dialHref: string;
    address?: string;
  } | null>(null);
  const [audioBars, setAudioBars] = useState<number[]>(() =>
    Array.from({ length: BAR_COUNT }, () => 0.14)
  );

  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const outAnalyserRef = useRef<AnalyserNode | null>(null);
  const isMicMutedRef = useRef(false);
  const liveTurnUserIdRef = useRef<string | null>(null);
  const liveTurnBotIdRef = useRef<string | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const scrollEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const screenShotInputRef = useRef<HTMLInputElement | null>(null);
  const lastInitialNonceRef = useRef<number | null>(null);
  const lastExternalCmdNonceRef = useRef<number | null>(null);

  // Camera & phone screen sharing (front / rear / screen) for real-time voice calls & command bar snapshots
  const [cameraFacing, setCameraFacing] = useState<
    "user" | "environment" | "screen" | null
  >(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [screenFallbackReady, setScreenFallbackReady] = useState(false);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    isMicMutedRef.current = isMicMuted;
  }, [isMicMuted]);

  useEffect(() => {
    onLiveStateChange?.({
      active: liveActive,
      phase: livePhase,
      isMicMuted,
      durationSec: liveDurationSec,
      subtitleUser: liveSubtitleUser,
      subtitleBot: liveSubtitleBot,
      cameraFacing,
    });
  }, [
    liveActive,
    livePhase,
    isMicMuted,
    liveDurationSec,
    liveSubtitleUser,
    liveSubtitleBot,
    cameraFacing,
    onLiveStateChange,
  ]);

  useEffect(() => {
    if (location && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ location }));
    }
  }, [location]);

  useEffect(() => {
    if (
      !externalLiveCommand ||
      externalLiveCommand.nonce === lastExternalCmdNonceRef.current
    ) {
      return;
    }
    lastExternalCmdNonceRef.current = externalLiveCommand.nonce;
    if (externalLiveCommand.action === "start" && !liveActive) {
      void startLiveCall();
    } else if (externalLiveCommand.action === "stop" && liveActive) {
      stopLiveCall();
    } else if (externalLiveCommand.action === "toggle_mute" && liveActive) {
      setIsMicMuted((m) => !m);
    } else if (externalLiveCommand.action === "interrupt" && liveActive) {
      interruptAiPlayback();
    } else if (
      externalLiveCommand.action === "context_note" &&
      (externalLiveCommand.note || externalLiveCommand.syncPlaces) &&
      wsRef.current?.readyState === WebSocket.OPEN
    ) {
      wsRef.current.send(
        JSON.stringify({
          contextNote: externalLiveCommand.note,
          triggerReply: Boolean(externalLiveCommand.triggerReply),
          syncPlaces: externalLiveCommand.syncPlaces,
        })
      );
    }
  }, [externalLiveCommand, liveActive]);

  useEffect(() => {
    if (
      initialPrompt?.text &&
      initialPrompt.nonce !== lastInitialNonceRef.current
    ) {
      lastInitialNonceRef.current = initialPrompt.nonce;
      void sendMessage(initialPrompt.text);
    }
  }, [initialPrompt]);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (!isRecording) {
      setRecordingSec(0);
      return;
    }
    const timer = setInterval(() => {
      setRecordingSec((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [isRecording]);

  useEffect(() => {
    if (!liveActive) {
      setLiveDurationSec(0);
      return;
    }
    const t = setInterval(() => setLiveDurationSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [liveActive]);

  useEffect(() => {
    return () => {
      stopLiveCall();
      stopCameraSharing();
    };
  }, []);

  // Attach MediaStream to <video> whenever cameraFacing becomes active
  useEffect(() => {
    const videoEl = cameraVideoRef.current;
    const stream = cameraStreamRef.current;
    if (cameraFacing && videoEl && stream) {
      videoEl.srcObject = stream;
      void videoEl.play().catch(() => {
        // autoplay handles muted preview
      });
    }
  }, [cameraFacing]);

  // Stream 1 FPS JPEG frames over /ws/live when real-time call + camera sharing are both active
  useEffect(() => {
    if (!liveActive || !cameraFacing) return;
    const interval = setInterval(() => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
      const frame = captureCameraFrameBase64();
      if (frame) {
        wsRef.current.send(JSON.stringify({ video: frame }));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [liveActive, cameraFacing]);

  // Real-time 16-bar audio equalizer driven by Web Audio AnalyserNodes
  useEffect(() => {
    if (!liveActive) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      setAudioBars(Array.from({ length: BAR_COUNT }, () => 0.14));
      return;
    }

    const micBins = new Uint8Array(64);
    const outBins = new Uint8Array(64);

    const tick = () => {
      const micAn = micAnalyserRef.current;
      const outAn = outAnalyserRef.current;
      let nextBars = Array.from({ length: BAR_COUNT }, () => 0.12);

      if (outAn && activeSourcesRef.current.size > 0) {
        outAn.getByteFrequencyData(outBins);
        nextBars = Array.from({ length: BAR_COUNT }, (_, i) => {
          const val = outBins[Math.min(outBins.length - 1, i * 2)] ?? 0;
          return Math.max(0.14, Math.min(1, val / 155));
        });
      } else if (micAn && !isMicMutedRef.current) {
        micAn.getByteFrequencyData(micBins);
        nextBars = Array.from({ length: BAR_COUNT }, (_, i) => {
          const val = micBins[Math.min(micBins.length - 1, i * 2)] ?? 0;
          return Math.max(0.12, Math.min(1, val / 140));
        });
      }

      setAudioBars(nextBars);
      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [liveActive]);

  const playTestChime = async () => {
    setError(null);
    try {
      const ctx = outputCtxRef.current && outputCtxRef.current.state !== "closed"
        ? outputCtxRef.current
        : new AudioContext();
      if (ctx.state === "suspended") await ctx.resume();
      const now = ctx.currentTime;
      const freqs = [523.25, 659.25];
      freqs.forEach((f, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.001, now + idx * 0.11);
        gain.gain.exponentialRampToValueAtTime(0.14, now + idx * 0.11 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.11 + 0.22);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.11);
        osc.stop(now + idx * 0.11 + 0.24);
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? `Test dźwięku nie powiódł się: ${err.message}`
          : "Przeglądarka blokuje wyjście audio."
      );
    }
  };

  const handleFileAttach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const loaded: Array<{ name: string; mimeType: string; data: string }> = [];
    for (const file of Array.from(files)) {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || "");
          resolve(result.split(",")[1] || "");
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      loaded.push({
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        data: base64,
      });
    }
    setAttachments((prev) => [...prev, ...loaded]);
    e.target.value = "";
  };

  const stopCameraSharing = () => {
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current = null;
    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
    }
    setCameraFacing(null);
    setScreenFallbackReady(false);
  };

  const toggleCameraSharing = async (facing: "user" | "environment") => {
    setCameraError(null);
    setScreenFallbackReady(false);
    if (cameraFacing === facing) {
      stopCameraSharing();
      return;
    }

    // Stop any previous camera/screen stream before switching
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current = null;

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Twoja przeglądarka nie obsługuje udostępniania kamery.");
      setCameraFacing(null);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 960 },
          height: { ideal: 540 },
        },
        audio: false,
      });
      cameraStreamRef.current = stream;
      setCameraFacing(facing);
    } catch (err) {
      setCameraFacing(null);
      setCameraError(
        err instanceof Error
          ? `Brak dostępu do kamery (${facing === "user" ? "przód" : "tylna"}): ${err.message}`
          : "Nie udało się uruchomić kamery. Sprawdź uprawnienia w przeglądarce."
      );
    }
  };

  const toggleScreenSharing = async () => {
    setCameraError(null);
    setScreenFallbackReady(false);
    if (cameraFacing === "screen") {
      stopCameraSharing();
      return;
    }

    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current = null;

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setCameraFacing(null);
      setScreenFallbackReady(true);
      setCameraError(
        "Ta przeglądarka Android nie pozwala na strumieniowanie ekranu na żywo (getDisplayMedia). Możesz od razu przesłać zrzut ekranu z telefonu poniżej."
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 2, max: 5 } },
        audio: false,
      });
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        stopCameraSharing();
      });
      cameraStreamRef.current = stream;
      setCameraFacing("screen");
    } catch (err) {
      setCameraFacing(null);
      setScreenFallbackReady(true);
      setCameraError(
        err instanceof Error
          ? `Nie uruchomiono podglądu ekranu na żywo (${err.message}). Możesz przesłać zrzut ekranu z telefonu poniżej.`
          : "Anulowano udostępnianie ekranu telefonu."
      );
    }
  };

  const captureCameraFrameBase64 = (): string | null => {
    const video = cameraVideoRef.current;
    const canvas = cameraCanvasRef.current;
    if (!video || !canvas || video.readyState < 2 || video.videoWidth === 0) {
      return null;
    }
    const maxDim = 768;
    const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.max(1, Math.round(video.videoWidth * scale));
    const h = Math.max(1, Math.round(video.videoHeight * scale));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.78);
    return dataUrl.split(",")[1] || null;
  };

  const sendMessage = async (overrideText?: string) => {
    const textToSend = (overrideText ?? input).trim();
    const cameraFrame = cameraFacing ? captureCameraFrameBase64() : null;
    if (!textToSend && attachments.length === 0 && !cameraFrame) return;

    setError(null);
    const currentAttachments = [...attachments];
    if (cameraFrame && cameraFacing) {
      currentAttachments.push({
        name:
          cameraFacing === "screen"
            ? "ekran-telefonu.jpg"
            : cameraFacing === "user"
              ? "kamera-przod.jpg"
              : "kamera-tylna.jpg",
        mimeType: "image/jpeg",
        data: cameraFrame,
      });
    }

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      text: textToSend || "Przeanalizuj załączone pliki lub obraz z kamery.",
      timestamp: new Date().toLocaleTimeString("pl-PL", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      attachmentNames: currentAttachments.map((a) => a.name),
    };

    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    if (!overrideText) setInput("");
    setAttachments([]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextHistory.map((m) => ({ role: m.role, text: m.text })),
          model,
          language,
          useSearch,
          useMaps,
          location,
          attachments: currentAttachments,
        }),
      });

      const data = (await res.json()) as {
        text?: string;
        model?: string;
        sources?: ChatMessage["sources"];
        error?: string;
      };

      if (!res.ok || data.error) {
        throw new Error(data.error || "Błąd odpowiedzi modelu.");
      }

      const replyText = data.text || "Brak odpowiedzi.";
      const botMsg: ChatMessage = {
        id: `m-${Date.now()}`,
        role: "model",
        text: replyText,
        timestamp: new Date().toLocaleTimeString("pl-PL", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        model: data.model,
        sources: data.sources,
      };
      setMessages((prev) => [...prev, botMsg]);

      if (autoSpeak && voicePreset !== "off") {
        void speakWithMiekiszon(replyText, voicePreset);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wystąpił błąd.");
    } finally {
      setLoading(false);
    }
  };

  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }

    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const preferredMime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
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
        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        if (blob.size < 400) return;

        const base64 = await new Promise<string>((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(",")[1] || "");
          r.readAsDataURL(blob);
        });
        setLoading(true);
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
          if (data.text?.trim()) {
            await sendMessage(data.text.trim());
          } else if (data.error) {
            setError(data.error);
          }
        } catch (err) {
          setError(String(err));
        } finally {
          setLoading(false);
        }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Brak dostępu do mikrofonu: ${err.message}`
          : "Brak dostępu do mikrofonu. Nadaj uprawnienia w przeglądarce."
      );
    }
  };

  const interruptAiPlayback = () => {
    for (const node of activeSourcesRef.current) {
      try {
        node.stop();
      } catch {
        // ignore
      }
    }
    activeSourcesRef.current.clear();
    if (outputCtxRef.current) {
      nextPlayTimeRef.current = outputCtxRef.current.currentTime;
    }
    if (liveActive) {
      setLivePhase("listening");
    }
  };

  const playPcm24k = (base64Pcm: string) => {
    const outCtx = outputCtxRef.current;
    const outAnalyser = outAnalyserRef.current;
    if (!outCtx || outCtx.state === "closed") return;
    if (outCtx.state === "suspended") {
      void outCtx.resume();
    }

    const bin = atob(base64Pcm);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const usableLen = bytes.byteLength - (bytes.byteLength % 2);
    if (usableLen < 2) return;

    const int16 = new Int16Array(bytes.buffer, 0, usableLen / 2);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

    const audioBuffer = outCtx.createBuffer(1, float32.length, 24000);
    audioBuffer.copyToChannel(float32, 0);

    const src = outCtx.createBufferSource();
    src.buffer = audioBuffer;
    if (outAnalyser) {
      src.connect(outAnalyser);
    } else {
      src.connect(outCtx.destination);
    }

    const now = outCtx.currentTime;
    const startAt = Math.max(now + 0.015, nextPlayTimeRef.current);
    activeSourcesRef.current.add(src);
    setLivePhase("speaking");

    src.onended = () => {
      activeSourcesRef.current.delete(src);
      if (activeSourcesRef.current.size === 0) {
        setLivePhase("listening");
      }
    };

    src.start(startAt);
    nextPlayTimeRef.current = startAt + audioBuffer.duration;
  };

  const forceEndOfTurn = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      setLivePhase("thinking");
      wsRef.current.send(JSON.stringify({ audioStreamEnd: true }));
    }
  };

  const sendLiveQuickText = (e: React.FormEvent) => {
    e.preventDefault();
    const txt = liveQuickText.trim();
    if (!txt || wsRef.current?.readyState !== WebSocket.OPEN) return;
    setLiveQuickText("");
    setLiveSubtitleUser(txt);
    setLiveSubtitleBot("");
    setLivePhase("thinking");
    wsRef.current.send(JSON.stringify({ text: txt }));
  };

  const startLiveCall = async () => {
    setError(null);
    stopSpeaking();
    setLiveSubtitleUser("");
    setLiveSubtitleBot("");
    liveTurnUserIdRef.current = null;
    liveTurnBotIdRef.current = null;

    let inputCtx: AudioContext | null = null;
    let outputCtx: AudioContext | null = null;

    try {
      // Use native device sample rate on BOTH AudioContexts so Firefox/Android/headsets
      // never fail with sample-rate mismatch; we resample mic -> 16kHz & decode 24kHz buffers cleanly.
      inputCtx = new AudioContext();
      outputCtx = new AudioContext();

      // Resume synchronously on click gesture before awaiting getUserMedia
      void inputCtx.resume();
      void outputCtx.resume();

      const micAnalyser = inputCtx.createAnalyser();
      micAnalyser.fftSize = 128;
      const outAnalyser = outputCtx.createAnalyser();
      outAnalyser.fftSize = 128;
      outAnalyser.connect(outputCtx.destination);

      inputCtxRef.current = inputCtx;
      outputCtxRef.current = outputCtx;
      micAnalyserRef.current = micAnalyser;
      outAnalyserRef.current = outAnalyser;
      nextPlayTimeRef.current = outputCtx.currentTime;

      setLivePhase("connecting");
      setLiveActive(true);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      micStreamRef.current = stream;

      if (inputCtx.state === "suspended") await inputCtx.resume();
      if (outputCtx.state === "suspended") await outputCtx.resume();

      const voiceName = voicePresetToLiveName(voicePreset);
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsParams = new URLSearchParams({
        voice: voiceName,
        lang: language,
      });
      if (location) {
        wsParams.set("lat", String(location.lat));
        wsParams.set("lng", String(location.lng));
      }
      const ws = new WebSocket(
        `${protocol}//${window.location.host}/ws/live?${wsParams.toString()}`
      );
      wsRef.current = ws;

      const startMicStreaming = () => {
        if (processorRef.current || !inputCtx) return;
        const activeInCtx = inputCtx;
        const source = activeInCtx.createMediaStreamSource(stream);
        const processor = activeInCtx.createScriptProcessor(4096, 1, 1);
        const muteGain = activeInCtx.createGain();
        muteGain.gain.value = 0;

        source.connect(micAnalyser);
        source.connect(processor);
        processor.connect(muteGain);
        muteGain.connect(activeInCtx.destination);
        processorRef.current = processor;

        processor.onaudioprocess = (ev) => {
          if (isMicMutedRef.current || ws.readyState !== WebSocket.OPEN) return;
          const raw = ev.inputBuffer.getChannelData(0);
          const resampled = resampleFloat32(raw, activeInCtx.sampleRate, 16000);
          const b64 = pcmFloatToBase64(resampled);
          ws.send(JSON.stringify({ audio: b64 }));
        };
      };

      ws.onopen = () => {
        startMicStreaming();
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data) as {
          status?: string;
          audio?: string;
          inputTranscript?: string;
          outputTranscript?: string;
          interrupted?: boolean;
          turnComplete?: boolean;
          error?: string;
          clientAction?: {
            type:
              | "switch_tab"
              | "food_results"
              | "select_food_place"
              | "call_place"
              | "open_stay";
            tab?: WorkspaceTab;
            city?: string;
            placeIndex?: number;
            placeName?: string;
            phone?: string;
            dialHref?: string;
            address?: string;
            payload?: {
              locationMode?: "gps" | "city" | "postal";
              city?: string;
              postalCode?: string;
              query?: string;
              radius?: number;
              openNow?: boolean;
              places?: FoodPlace[];
              center?: GeoLocation | null;
              resolvedAreaLabel?: string;
              groundingSummary?: string;
              groundingLinks?: Array<{ title: string; uri: string }>;
            };
          };
        };

        if (msg.error) {
          setError(`Rozmowa Live: ${msg.error}`);
          stopLiveCall();
          return;
        }
        if (msg.clientAction) {
          const act = msg.clientAction;
          if (act.type === "switch_tab" && act.tab) {
            onSwitchTab?.(act.tab);
          } else if (act.type === "food_results" && act.payload) {
            onLiveFoodUpdate?.({
              nonce: Date.now(),
              ...act.payload,
            });
            onSwitchTab?.("food");
          } else if (act.type === "select_food_place") {
            onLiveFoodUpdate?.({
              nonce: Date.now(),
              selectedIndex: act.placeIndex,
              selectedName: act.placeName,
            });
            onSwitchTab?.("food");
          } else if (act.type === "call_place" && act.phone) {
            const safeHref =
              act.dialHref || `tel:${act.phone.replace(/[^\d+]/g, "")}`;
            setLiveVenueCall({
              placeName: act.placeName || "Wybrany lokal",
              phone: act.phone,
              dialHref: safeHref,
              address: act.address,
            });
            onLiveFoodUpdate?.({
              nonce: Date.now(),
              selectedIndex: act.placeIndex,
              selectedName: act.placeName,
              callPhone: act.phone,
              callDialHref: safeHref,
              callPlaceName: act.placeName,
              callAddress: act.address,
            });
            try {
              const link = document.createElement("a");
              link.href = safeHref;
              link.style.display = "none";
              document.body.appendChild(link);
              link.click();
              link.remove();
            } catch {
              // User can still tap the visible Zadzwoń teraz link
            }
          } else if (act.type === "open_stay") {
            onBookStay?.({ city: act.city || "", autoTrigger: true });
          }
        }
        if (msg.status === "ready") {
          setLivePhase("listening");
          // Immediately trigger a short spoken welcome so user confirms audio & responsiveness right away
          ws.send(JSON.stringify({ greet: true }));
        }
        if (msg.audio) {
          playPcm24k(msg.audio);
        }
        if (msg.interrupted) {
          interruptAiPlayback();
          liveTurnBotIdRef.current = null;
        }
        if (msg.turnComplete) {
          liveTurnUserIdRef.current = null;
          liveTurnBotIdRef.current = null;
          if (activeSourcesRef.current.size === 0) {
            setLivePhase("listening");
          }
        }

        if (msg.inputTranscript) {
          setLiveSubtitleUser((prev) => (prev + " " + msg.inputTranscript).trim());
          setLiveSubtitleBot("");
          const chunk = msg.inputTranscript;
          setMessages((prev) => {
            const targetId = liveTurnUserIdRef.current;
            if (targetId && prev.some((m) => m.id === targetId)) {
              return prev.map((m) =>
                m.id === targetId ? { ...m, text: m.text + chunk } : m
              );
            }
            const newId = `live-u-${Date.now()}`;
            liveTurnUserIdRef.current = newId;
            return [
              ...prev,
              {
                id: newId,
                role: "user",
                text: chunk,
                timestamp: new Date().toLocaleTimeString("pl-PL", {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              },
            ];
          });
        }

        if (msg.outputTranscript) {
          liveTurnUserIdRef.current = null;
          setLiveSubtitleBot((prev) => (prev + msg.outputTranscript).trim());
          const chunk = msg.outputTranscript;
          setMessages((prev) => {
            const targetId = liveTurnBotIdRef.current;
            if (targetId && prev.some((m) => m.id === targetId)) {
              return prev.map((m) =>
                m.id === targetId ? { ...m, text: m.text + chunk } : m
              );
            }
            const newId = `live-m-${Date.now()}`;
            liveTurnBotIdRef.current = newId;
            return [
              ...prev,
              {
                id: newId,
                role: "model",
                text: chunk,
                timestamp: new Date().toLocaleTimeString("pl-PL", {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
                model: "gemini-3.8-live",
              },
            ];
          });
        }
      };

      ws.onerror = () => {
        setError("Błąd połączenia WebSocket dla głosu na żywo (/ws/live).");
      };

      ws.onclose = () => {
        stopLiveCall();
      };
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Nieznany błąd mikrofonu lub audio.";
      setError(`Nie udało się uruchomić rozmowy głosowej: ${msg}`);
      stopLiveCall();
    }
  };

  const stopLiveCall = () => {
    setLiveActive(false);
    setLivePhase("idle");
    setIsMicMuted(false);
    interruptAiPlayback();
    try {
      processorRef.current?.disconnect();
    } catch {
      // ignore
    }
    processorRef.current = null;
    try {
      wsRef.current?.close();
    } catch {
      // ignore
    }
    wsRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    try {
      void inputCtxRef.current?.close();
      void outputCtxRef.current?.close();
    } catch {
      // ignore
    }
    inputCtxRef.current = null;
    outputCtxRef.current = null;
    micAnalyserRef.current = null;
    outAnalyserRef.current = null;
  };

  const phaseLabel =
    livePhase === "connecting"
      ? "Łączenie sesji Live Audio..."
      : livePhase === "speaking"
        ? "Miękiszon odpowiada głosowo"
        : livePhase === "thinking"
          ? "Przetwarzam wypowiedź..."
          : isMicMuted
            ? "Mikrofon wyciszony"
            : "Słucham Cię na żywo";

  return (
    <div className="space-y-6">
      {/* HERO VOICE STUDIO STAGE */}
      <section className="rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-5 sm:p-6">
        <div className="grid gap-6 lg:grid-cols-12 lg:items-center">
          {/* Left: Voice Identity & Status */}
          <div className="flex items-center gap-4 lg:col-span-5">
            <div className="relative shrink-0">
              <div
                className={`overflow-hidden rounded-2xl border transition-transform duration-200 ${
                  livePhase === "speaking"
                    ? "scale-105 border-emerald-400 shadow-[0_0_24px_rgba(16,185,129,0.28)]"
                    : liveActive
                      ? "border-emerald-500/50"
                      : "border-[#242B26]"
                }`}
              >
                <img
                  src="/src/assets/images/miekiszon_voice_persona_1794894312692.jpg"
                  alt="Głos Miękiszona"
                  referrerPolicy="no-referrer"
                  className="h-20 w-20 object-cover sm:h-24 sm:w-24"
                />
              </div>
            </div>

            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
                <Radio className="h-3.5 w-3.5 shrink-0" />
                <span>
                  {liveActive ? phaseLabel : "Studio Głosowe na żywo"}
                </span>
              </div>
              <h2 className="font-display text-xl font-bold text-white sm:text-2xl">
                Rozmowa z Miękiszonem
              </h2>
              <p className="text-xs text-neutral-400 font-mono tabular-nums">
                {liveActive
                  ? `Połączenie aktywne · ${formatCallDuration(liveDurationSec)}`
                  : "Niskie opóźnienie · Automatyczne przywitanie · Barge-in"}
              </p>
            </div>
          </div>

          {/* Center: 16-bar Real Audio Visualizer & Live Transcript */}
          <div className="rounded-xl border border-[#1E2420] bg-[#050506] p-4 lg:col-span-4 space-y-3">
            <div
              className="flex h-12 items-end justify-center gap-1.5"
              aria-hidden="true"
            >
              {audioBars.map((level, idx) => (
                <span
                  key={idx}
                  style={{ height: `${Math.max(5, Math.round(level * 44))}px` }}
                  className={`w-1.5 rounded-full transition-[height] duration-75 ${
                    !liveActive
                      ? "bg-[#242B26]"
                      : livePhase === "speaking"
                        ? "bg-emerald-400"
                        : isMicMuted
                          ? "bg-neutral-600"
                          : "bg-emerald-500/80"
                  }`}
                />
              ))}
            </div>

            {liveActive ? (
              <div className="min-h-[42px] border-t border-[#1E2420] pt-2.5 text-xs space-y-1">
                {liveSubtitleUser && (
                  <p className="text-neutral-300">
                    <strong className="text-white">Ty:</strong>{" "}
                    {liveSubtitleUser}
                  </p>
                )}
                {liveSubtitleBot ? (
                  <p className="text-emerald-300">
                    <strong>Miękiszon:</strong> {liveSubtitleBot}
                  </p>
                ) : !liveSubtitleUser ? (
                  <p className="text-center text-neutral-500">
                    Mów naturalnie — lub kliknij „Odpowiedz teraz” po zakończeniu zdania.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="border-t border-[#1E2420] pt-2.5 text-center text-xs text-neutral-400">
                Po kliknięciu „Rozmawiaj na żywo” Miękiszon od razu się przywita.
              </p>
            )}
          </div>

          {/* Right: Primary Voice Action & Test */}
          <div className="flex flex-col gap-2.5 lg:col-span-3">
            {liveActive ? (
              <button
                type="button"
                onClick={stopLiveCall}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-red-500 px-4 text-sm font-semibold text-white hover:bg-red-400 whitespace-nowrap cursor-pointer"
              >
                <PhoneOff className="h-4 w-4" />
                Zakończ rozmowę
              </button>
            ) : (
              <button
                type="button"
                onClick={startLiveCall}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-black hover:bg-emerald-400 whitespace-nowrap cursor-pointer"
              >
                <PhoneCall className="h-4 w-4" />
                Rozmawiaj na żywo
              </button>
            )}

            <button
              type="button"
              onClick={playTestChime}
              className="flex min-h-[40px] w-full items-center justify-center gap-2 rounded-xl border border-[#242B26] bg-[#050506] px-3 text-xs font-medium text-neutral-300 hover:border-emerald-500/40 hover:text-white whitespace-nowrap cursor-pointer"
            >
              <Volume2 className="h-3.5 w-3.5 text-emerald-400" />
              Test głośnika
            </button>
          </div>
        </div>

        {/* Active Call Toolbar + Live Quick Text */}
        {liveActive && (
          <div className="mt-5 flex flex-col gap-3 border-t border-[#1E2420] pt-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setIsMicMuted((m) => !m)}
                className={`inline-flex min-h-[42px] items-center gap-2 rounded-xl border px-3.5 text-xs font-semibold cursor-pointer ${
                  isMicMuted
                    ? "border-amber-500/40 bg-amber-500/15 text-amber-200"
                    : "border-[#242B26] bg-[#050506] text-neutral-200 hover:border-emerald-500/40"
                }`}
              >
                {isMicMuted ? (
                  <>
                    <MicOff className="h-4 w-4" />
                    Odcisz mic
                  </>
                ) : (
                  <>
                    <Mic className="h-4 w-4 text-emerald-400" />
                    Wycisz mic
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={forceEndOfTurn}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 cursor-pointer"
              >
                <Sparkles className="h-4 w-4" />
                Odpowiedz teraz
              </button>

              <button
                type="button"
                onClick={interruptAiPlayback}
                disabled={livePhase !== "speaking"}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-[#242B26] bg-[#050506] px-3.5 text-xs font-semibold text-neutral-200 hover:border-emerald-500/40 disabled:opacity-40 cursor-pointer"
              >
                <Square className="h-3.5 w-3.5 text-emerald-400" />
                Przerwij głos
              </button>

              {onSwitchTab && (
                <button
                  type="button"
                  onClick={() => onSwitchTab("food")}
                  className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-emerald-500/45 bg-emerald-500/15 px-3.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 cursor-pointer"
                >
                  <Utensils className="h-3.5 w-3.5 text-emerald-300" />
                  Jedzenie w okolicy (prowadź na żywo)
                </button>
              )}
            </div>

            <form
              onSubmit={sendLiveQuickText}
              className="flex flex-1 gap-2 lg:max-w-md"
            >
              <input
                type="text"
                value={liveQuickText}
                onChange={(e) => setLiveQuickText(e.target.value)}
                placeholder="Lub wyślij szybkie pytanie w trakcie rozmowy..."
                className="min-h-[42px] flex-1 rounded-xl border border-[#242B26] bg-[#050506] px-3.5 text-xs text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!liveQuickText.trim()}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 text-xs font-semibold text-black hover:bg-emerald-400 disabled:opacity-50 cursor-pointer"
              >
                <Send className="h-3.5 w-3.5" />
                Wyślij
              </button>
            </form>
          </div>
        )}

        {liveVenueCall && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/45 bg-emerald-500/12 px-4 py-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-emerald-300">
                Połączenie z lokalem: {liveVenueCall.placeName}
              </p>
              <p className="mt-0.5 font-mono text-xs text-white">
                {liveVenueCall.phone}
                {liveVenueCall.address ? ` · ${liveVenueCall.address}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={liveVenueCall.dialHref}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 text-xs font-semibold text-black hover:bg-emerald-400 whitespace-nowrap"
              >
                <PhoneCall className="h-3.5 w-3.5" />
                Zadzwoń teraz
              </a>
              <button
                type="button"
                onClick={() => setLiveVenueCall(null)}
                aria-label="Zamknij baner połączenia"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#242B26] text-neutral-400 hover:text-white cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </section>

      {/* SECOND ROW: SETTINGS SIDEBAR + CHAT THREAD */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Settings Column */}
        <aside className="space-y-4 lg:col-span-4">
          <div className="rounded-2xl border border-[#1E2420] bg-[#0D0F0E] p-5 space-y-4">
            <h3 className="font-display text-sm font-semibold text-white">
              Ustawienia głosu i czatu
            </h3>

            <div>
              <label className="block text-xs font-medium text-neutral-400">
                Wariant głosu lektorki
              </label>
              <select
                value={voicePreset}
                onChange={(e) => onVoicePresetChange(e.target.value as VoicePreset)}
                className="mt-1.5 min-h-[42px] w-full rounded-xl border border-[#222824] bg-[#050506] px-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
              >
                <option value="woman_30_warm">Kobiecy ciepły (30 lat · Kore)</option>
                <option value="woman_30_pro">Kobiecy profesjonalny (30 lat · Zephyr)</option>
                <option value="man_calm">Męski spokojny (Charon)</option>
                <option value="off">Wyłączony</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-400">
                Język odpowiedzi
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="mt-1.5 min-h-[42px] w-full rounded-xl border border-[#222824] bg-[#050506] px-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-400">
                Tryb szybkości czatu (Gemini)
              </label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value as GeminiChatModel)}
                className="mt-1.5 min-h-[42px] w-full rounded-xl border border-[#222824] bg-[#050506] px-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
              >
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} — {m.hint}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2.5 pt-1 border-t border-[#1E2420]">
              <label className="flex items-center justify-between text-xs text-neutral-300 cursor-pointer pt-2">
                <span className="flex items-center gap-2">
                  <Globe className="h-3.5 w-3.5 text-emerald-400" />
                  Wyszukiwarka Google (na żywo)
                </span>
                <input
                  type="checkbox"
                  checked={useSearch}
                  onChange={(e) => {
                    setUseSearch(e.target.checked);
                    if (e.target.checked) setUseMaps(false);
                  }}
                  className="h-4 w-4 accent-emerald-500"
                />
              </label>

              <label className="flex items-center justify-between text-xs text-neutral-300 cursor-pointer">
                <span className="flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 text-emerald-400" />
                  Kontekst Map Google (lokalizacja)
                </span>
                <input
                  type="checkbox"
                  checked={useMaps}
                  onChange={(e) => {
                    setUseMaps(e.target.checked);
                    if (e.target.checked) setUseSearch(false);
                  }}
                  className="h-4 w-4 accent-emerald-500"
                />
              </label>

              <label className="flex items-center justify-between text-xs text-neutral-300 cursor-pointer">
                <span className="flex items-center gap-2">
                  <Volume2 className="h-3.5 w-3.5 text-emerald-400" />
                  Czytaj odpowiedzi na bieżąco
                </span>
                <input
                  type="checkbox"
                  checked={autoSpeak}
                  onChange={(e) => setAutoSpeak(e.target.checked)}
                  className="h-4 w-4 accent-emerald-500"
                />
              </label>
            </div>

            {onBookStay && (
              <button
                type="button"
                onClick={() => onBookStay({ city: "", autoTrigger: false })}
                className="flex min-h-[42px] w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/15 px-3 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 cursor-pointer"
              >
                <BedDouble className="h-4 w-4" />
                Automatyczne bukowanie noclegu
              </button>
            )}
          </div>
        </aside>

        {/* Scrollable Chat Thread */}
        <div className="flex h-[560px] flex-col rounded-2xl border border-[#1E2420] bg-[#0D0F0E] lg:col-span-8">
          <div className="flex items-center justify-between border-b border-[#1E2420] px-5 py-3.5">
            <div>
              <h3 className="font-display text-sm font-semibold text-white">
                Czat i historia rozmowy
              </h3>
              <p className="text-xs text-neutral-400">
                Wiadomości tekstowe, transkrypcja na żywo, zdjęcia i PDF
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={stopSpeaking}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[#222824] bg-[#141715] px-2.5 text-xs text-neutral-300 hover:text-white cursor-pointer"
                title="Wycisz głos"
              >
                <VolumeX className="h-3.5 w-3.5" />
                Wycisz
              </button>
              <button
                type="button"
                onClick={() => setMessages(messages.slice(0, 1))}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[#222824] bg-[#141715] px-2.5 text-xs text-neutral-300 hover:text-white cursor-pointer"
                title="Wyczyść wątek"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Wyczyść
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${
                  msg.role === "user" ? "items-end" : "items-start"
                }`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-emerald-500 text-black font-medium"
                      : "border border-[#222824] bg-[#141715] text-neutral-100"
                  }`}
                >
                  {msg.attachmentNames && msg.attachmentNames.length > 0 && (
                    <p className="mb-1.5 text-xs opacity-75">
                      Załączniki: {msg.attachmentNames.join(", ")}
                    </p>
                  )}
                  <div className="whitespace-pre-wrap">{msg.text}</div>

                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-3 border-t border-white/10 pt-2 space-y-1">
                      <p className="text-[11px] font-medium text-neutral-400">
                        Źródła:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {msg.sources.slice(0, 5).map((src, i) => (
                          <a
                            key={i}
                            href={src.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-emerald-400 underline hover:text-emerald-300"
                          >
                            {src.title}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-1 flex items-center gap-2 text-[11px] text-neutral-500 font-mono tabular-nums">
                  <span>{msg.timestamp}</span>
                  {msg.role === "model" && (
                    <button
                      type="button"
                      onClick={() => void speakWithMiekiszon(msg.text, voicePreset)}
                      className="inline-flex items-center gap-1 text-neutral-400 hover:text-emerald-400 cursor-pointer"
                    >
                      <Volume2 className="h-3 w-3" />
                      Odsłuchaj
                    </button>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex items-center gap-2 text-xs text-neutral-400">
                <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
                Miękiszon przygotowuje odpowiedź...
              </div>
            )}
            <div ref={scrollEndRef} />
          </div>

          {error && (
            <div className="mx-5 mb-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2 text-xs text-red-200">
              {error}
            </div>
          )}

          {attachments.length > 0 && (
            <div className="mx-5 mb-2 flex flex-wrap gap-2">
              {attachments.map((att, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#222824] bg-[#141715] px-2.5 py-1 text-xs text-neutral-200"
                >
                  {att.name}
                  <button
                    type="button"
                    onClick={() =>
                      setAttachments((prev) => prev.filter((_, i) => i !== idx))
                    }
                    className="text-neutral-400 hover:text-white cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <canvas ref={cameraCanvasRef} className="hidden" />
          <input
            ref={screenShotInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileAttach}
            className="hidden"
          />

          {cameraError && (
            <div className="mx-5 mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-200">
              <span>{cameraError}</span>
              {screenFallbackReady && (
                <button
                  type="button"
                  onClick={() => screenShotInputRef.current?.click()}
                  className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg bg-emerald-500 px-3 text-xs font-semibold text-black hover:bg-emerald-400 cursor-pointer"
                >
                  <MonitorSmartphone className="h-3.5 w-3.5" />
                  Wgraj zrzut ekranu z telefonu
                </button>
              )}
            </div>
          )}

          {cameraFacing && (
            <div className="mx-3.5 mb-2 flex items-center justify-between gap-3 rounded-xl border border-emerald-500/35 bg-[#080A09] p-2.5">
              <div className="flex items-center gap-3 min-w-0">
                <video
                  ref={cameraVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-16 w-24 shrink-0 rounded-lg border border-[#222824] bg-black object-cover"
                />
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
                    {cameraFacing === "screen" ? (
                      <MonitorSmartphone className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <Camera className="h-3.5 w-3.5 shrink-0" />
                    )}
                    {cameraFacing === "screen"
                      ? "Ekran telefonu udostępniony"
                      : cameraFacing === "user"
                        ? "Kamera przód udostępniona"
                        : "Kamera tylna udostępniona"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-neutral-400">
                    {liveActive
                      ? "Obraz przesyłany na żywo w rozmowie w czasie rzeczywistym."
                      : "Kadr dołączy się automatycznie po wysłaniu polecenia."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={stopCameraSharing}
                className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg border border-[#242B26] bg-[#141715] px-2.5 text-xs text-neutral-300 hover:text-white cursor-pointer"
              >
                <CameraOff className="h-3.5 w-3.5" />
                Wyłącz
              </button>
            </div>
          )}

          <div className="border-t border-[#1E2420] bg-[#0B0D0C] px-3.5 pt-2.5 pb-3.5 space-y-2.5">
            {/* Real-time conversation toggle + Front / Rear camera + Phone screen share checkboxes directly at the command bar */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  if (liveActive) {
                    stopLiveCall();
                  } else {
                    void startLiveCall();
                  }
                }}
                className={`inline-flex min-h-[38px] items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  liveActive
                    ? "border-emerald-500/60 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30"
                    : "border-[#242B26] bg-[#141715] text-neutral-200 hover:border-emerald-500/50 hover:text-white"
                }`}
              >
                {liveActive ? (
                  <PhoneOff className="h-3.5 w-3.5 text-emerald-300" />
                ) : (
                  <Radio className="h-3.5 w-3.5 text-emerald-400" />
                )}
                <span>
                  {liveActive
                    ? `Rozmowa w czasie rzeczywistym: Aktywna (${phaseLabel})`
                    : "Rozmowa w czasie rzeczywistym"}
                </span>
              </button>

              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex min-h-[36px] items-center gap-2 rounded-lg border border-[#222824] bg-[#111412] px-2.5 text-xs text-neutral-200 hover:border-emerald-500/40 cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={cameraFacing === "user"}
                    onChange={() => void toggleCameraSharing("user")}
                    className="h-4 w-4 accent-emerald-500 cursor-pointer"
                  />
                  <Camera className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span>Udostępnij kamerę przód</span>
                </label>

                <label className="inline-flex min-h-[36px] items-center gap-2 rounded-lg border border-[#222824] bg-[#111412] px-2.5 text-xs text-neutral-200 hover:border-emerald-500/40 cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={cameraFacing === "environment"}
                    onChange={() => void toggleCameraSharing("environment")}
                    className="h-4 w-4 accent-emerald-500 cursor-pointer"
                  />
                  <Camera className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span>Udostępnij kamerę tylną</span>
                </label>

                <label className="inline-flex min-h-[36px] items-center gap-2 rounded-lg border border-[#222824] bg-[#111412] px-2.5 text-xs text-neutral-200 hover:border-emerald-500/40 cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={cameraFacing === "screen"}
                    onChange={() => void toggleScreenSharing()}
                    className="h-4 w-4 accent-emerald-500 cursor-pointer"
                  />
                  <MonitorSmartphone className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span>Udostępnij ekran telefonu</span>
                </label>
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void sendMessage();
              }}
              className="flex items-center gap-2"
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.txt,.md,.csv"
                onChange={handleFileAttach}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-[#222824] bg-[#141715] text-neutral-300 hover:border-emerald-500/40 hover:text-white cursor-pointer"
                title="Dodaj zdjęcie lub plik PDF"
              >
                <Paperclip className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={toggleRecording}
                className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-colors cursor-pointer ${
                  isRecording
                    ? "border-red-500 bg-red-500 text-white"
                    : "border-[#222824] bg-[#141715] text-neutral-300 hover:border-emerald-500/40 hover:text-white"
                }`}
                title={isRecording ? "Zatrzymaj i wyślij" : "Dyktuj głosowo"}
              >
                {isRecording ? (
                  <>
                    <Square className="h-3.5 w-3.5" />
                    <span className="font-mono tabular-nums">
                      {Math.floor(recordingSec / 60)}:
                      {String(recordingSec % 60).padStart(2, "0")}
                    </span>
                  </>
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </button>

              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Wpisz polecenie lub włącz rozmowę w czasie rzeczywistym..."
                className="min-h-[44px] flex-1 rounded-xl border border-[#222824] bg-[#050506] px-4 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
              />

              <button
                type="submit"
                disabled={loading}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-50 cursor-pointer"
              >
                <Send className="h-4 w-4" />
                <span className="hidden sm:inline">Wyślij</span>
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
