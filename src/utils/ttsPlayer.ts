import { VoicePreset } from "../types";

let currentAudio: HTMLAudioElement | null = null;
let currentAbort: AbortController | null = null;
let streamCtx: AudioContext | null = null;
const activeStreamSources = new Set<AudioBufferSourceNode>();

export function stopSpeaking() {
  if (currentAbort) {
    currentAbort.abort();
    currentAbort = null;
  }
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
  for (const src of activeStreamSources) {
    try {
      src.stop();
    } catch {
      // ignore
    }
  }
  activeStreamSources.clear();
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

function getOrCreateStreamContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!streamCtx || streamCtx.state === "closed") {
    streamCtx = new AudioContext();
  }
  if (streamCtx.state === "suspended") {
    void streamCtx.resume();
  }
  return streamCtx;
}

function schedulePcm24kChunk(
  ctx: AudioContext,
  base64Pcm: string,
  nextTimeRef: { value: number }
): Promise<void> {
  const bin = atob(base64Pcm);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const usableLen = bytes.byteLength - (bytes.byteLength % 2);
  if (usableLen < 2) return Promise.resolve();

  const int16 = new Int16Array(bytes.buffer, 0, usableLen / 2);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

  const buffer = ctx.createBuffer(1, float32.length, 24000);
  buffer.copyToChannel(float32, 0);

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);

  const startAt = Math.max(ctx.currentTime + 0.015, nextTimeRef.value);
  nextTimeRef.value = startAt + buffer.duration;
  activeStreamSources.add(src);

  return new Promise<void>((resolve) => {
    src.onended = () => {
      activeStreamSources.delete(src);
      resolve();
    };
    src.start(startAt);
  });
}

export async function speakWithMiekiszon(
  text: string,
  voicePreset: VoicePreset = "woman_30_warm"
): Promise<void> {
  if (!text.trim() || voicePreset === "off") return;
  stopSpeaking();

  const controller = new AbortController();
  currentAbort = controller;

  // 1. Progressive low-latency streaming TTS (/api/tts/stream)
  try {
    const ctx = getOrCreateStreamContext();
    const res = await fetch("/api/tts/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voicePreset }),
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;

    if (res.ok && res.body && ctx) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const nextTimeRef = { value: ctx.currentTime };
      const playPromises: Array<Promise<void>> = [];
      let receivedAnyAudio = false;

      while (true) {
        const { done, value } = await reader.read();
        if (controller.signal.aborted) {
          void reader.cancel();
          return;
        }
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed) as { pcm24k?: string };
            if (parsed.pcm24k) {
              receivedAnyAudio = true;
              playPromises.push(
                schedulePcm24kChunk(ctx, parsed.pcm24k, nextTimeRef)
              );
            }
          } catch {
            // ignore partial line
          }
        }
      }
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer.trim()) as { pcm24k?: string };
          if (parsed.pcm24k) {
            receivedAnyAudio = true;
            playPromises.push(
              schedulePcm24kChunk(ctx, parsed.pcm24k, nextTimeRef)
            );
          }
        } catch {
          // ignore
        }
      }

      if (receivedAnyAudio) {
        await Promise.all(playPromises);
        return;
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return;
    }
    // Fall through to unary /api/tts
  }

  if (controller.signal.aborted) return;

  // 2. Fallback: unary /api/tts WAV
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voicePreset }),
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;

    if (res.ok) {
      const data = (await res.json()) as {
        audioBase64?: string | null;
        mimeType?: string;
      };
      if (data.audioBase64 && !controller.signal.aborted) {
        const audio = new Audio(
          `data:${data.mimeType || "audio/wav"};base64,${data.audioBase64}`
        );
        currentAudio = audio;
        await new Promise<void>((resolve) => {
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          audio.onpause = () => resolve();
          void audio.play().catch(() => resolve());
        });
        return;
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return;
    }
  }

  if (controller.signal.aborted) return;

  // 3. Offline fallback: browser SpeechSynthesis
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    await new Promise<void>((resolve) => {
      const utter = new SpeechSynthesisUtterance(
        text.replace(/[*_`#>\[\]]/g, "")
      );
      utter.lang = "pl-PL";
      utter.pitch = voicePreset === "man_calm" ? 0.85 : 1.06;
      utter.rate = 1.02;
      const voices = window.speechSynthesis.getVoices();
      const plVoice = voices.find((v) =>
        v.lang.toLowerCase().startsWith("pl")
      );
      if (plVoice) utter.voice = plVoice;
      utter.onend = () => resolve();
      utter.onerror = () => resolve();
      window.speechSynthesis.speak(utter);
    });
  }
}
