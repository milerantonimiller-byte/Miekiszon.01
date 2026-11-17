import "dotenv/config";
import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import {
  ActivityHandling,
  EndSensitivity,
  GoogleGenAI,
  Modality,
  StartSensitivity,
  ThinkingLevel,
  Type,
  type FunctionDeclaration,
  type LiveServerMessage,
} from "@google/genai";
import { createServer as createViteServer } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const GMP_ATTRIBUTION_ID = "gmp_mcp_codeassist_v1_aistudio";

function getGeminiApiKey(): string {
  return process.env.GEMINI_API_KEY || process.env.API_KEY || "";
}

function getAiClient(apiVersion?: "v1" | "v1beta") {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error(
      "MISSING_GEMINI_API_KEY: Brak klucza GEMINI_API_KEY w środowisku serwera. Wybierz lub dodaj klucz w panelu Settings > Secrets."
    );
  }
  return new GoogleGenAI({
    apiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function getMapsApiKey(): string {
  return (
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    ""
  );
}

function extractRawErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: string; status?: string; code?: number };
    };
    if (parsed?.error?.message) return parsed.error.message;
  } catch {
    // raw is plain text
  }
  return raw;
}

function isTransientOverloadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("503") ||
    msg.includes("UNAVAILABLE") ||
    msg.includes("high demand") ||
    msg.includes("DEADLINE_EXCEEDED") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ETIMEDOUT")
  );
}

function isQuotaOrGroundingDeniedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("429") ||
    msg.includes("RESOURCE_EXHAUSTED") ||
    msg.includes("403") ||
    msg.includes("PERMISSION_DENIED")
  );
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("503 DEADLINE_EXCEEDED: Model response timeout")),
          ms
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 2,
  baseDelayMs = 250
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts && isTransientOverloadError(err)) {
        await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function formatGeminiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  const clean = extractRawErrorMessage(err);

  if (raw.includes("MISSING_GEMINI_API_KEY")) {
    return {
      status: 500,
      message:
        "Brak klucza GEMINI_API_KEY na serwerze. Ustaw lub wybierz klucz w panelu Settings > Secrets.",
    };
  }
  if (raw.includes("API_KEY_INVALID") || clean.toLowerCase().includes("api key not valid")) {
    return {
      status: 400,
      message:
        "Klucz GEMINI_API_KEY jest nieprawidłowy. Sprawdź go w panelu Settings > Secrets.",
    };
  }
  if (raw.includes("403") || raw.includes("PERMISSION_DENIED")) {
    return {
      status: 403,
      message:
        "Brak uprawnień do tego modelu lub funkcji dla obecnego klucza API (sprawdź Settings > Secrets).",
    };
  }
  if (raw.includes("429") || raw.includes("RESOURCE_EXHAUSTED")) {
    return {
      status: 429,
      message:
        "Przekroczono limit zapytań lub ten model/funkcja wymaga płatnego klucza API w Settings > Secrets. Do podstawowych rozmów wybierz model Ogólny (Hydrogen) lub Szybki (Flash Lite).",
    };
  }
  if (raw.includes("503") || raw.includes("UNAVAILABLE")) {
    return {
      status: 503,
      message:
        "Serwery modelu AI są chwilowo przeciążone (503). Spróbuj ponownie za chwilę lub przełącz tryb na Szybki (Flash Lite).",
    };
  }
  if (raw.includes("404") || raw.includes("NOT_FOUND")) {
    return {
      status: 404,
      message: `Wybrany model AI nie jest obsługiwany: ${clean}`,
    };
  }
  if (raw.includes("400") || raw.includes("INVALID_ARGUMENT")) {
    return {
      status: 400,
      message: `Nieprawidłowe parametry zapytania: ${clean}`,
    };
  }
  return { status: 500, message: clean || "Wystąpił błąd serwera Gemini." };
}

const MIEKISZON_SYSTEM_INSTRUCTION = `Jesteś Miękiszon — błyskotliwy, pewny siebie, lekko zadziorny, ale niezwykle pomocny i ciepły wielojęzyczny asystent AI (mówisz głosem wspaniałej, charyzmatycznej 30-letniej kobiety).
Twoje motto powitalne: "Co potrzebujesz ode mnie? Widać, że najwidoczniej potrzebujesz pomocy i jesteś taki słaby, że sam nie dasz rady. Uwierz w siebie, będzie dobrze."
Zasady:
1. Domyślnie odpowiadaj po polsku, ale jeśli użytkownik pisze lub prosi w innym języku (angielski, niemiecki, hiszpański, ukraiński, francuski, włoski itd.), odpowiadaj płynnie i naturalnie w tym języku.
2. Bądź konkretny, rzeczowy, życzliwy i wspierający. Gdy użytkownik prosi o akcję na telefonie (np. ustawić budzik, zadzwonić, napisać WhatsApp, wysłać maila, dodać wydarzenie), przygotuj dokładną odpowiedź oraz zasugeruj gotowe parametry akcji.
3. Kiedy używasz narzędzi Google Search lub Google Maps, podawaj wyłącznie zweryfikowane dane i źródła.`;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "35mb" }));

  // Health & Maps runtime config
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "miekiszon" });
  });

  app.get("/api/maps-config", (_req, res) => {
    res.json({ apiKey: getMapsApiKey() });
  });

  // 1. Multi-turn Multilingual Chat (Gemini 4 Hydrogen / Carbon / Argon / Flash Lite)
  app.post("/api/chat", async (req, res) => {
    try {
      const ai = getAiClient();
      const {
        messages = [],
        model = "gemini-4-hydrogen",
        language = "pl",
        useSearch = false,
        useMaps = false,
        location,
        attachments = [],
      } = req.body as {
        messages: Array<{ role: "user" | "model"; text: string }>;
        model?: string;
        language?: string;
        useSearch?: boolean;
        useMaps?: boolean;
        location?: { lat: number; lng: number } | null;
        attachments?: Array<{ mimeType: string; data: string; name?: string }>;
      };

      const allowedModels = new Set([
        "gemini-4-hydrogen",
        "gemini-4-carbon",
        "gemini-4-argon",
        "gemini-3.1-flash-lite",
      ]);
      const selectedModel = allowedModels.has(model)
        ? model
        : "gemini-4-hydrogen";

      const contents = messages.map((m, idx) => {
        const isLastUser = idx === messages.length - 1 && m.role === "user";
        const parts: Array<Record<string, unknown>> = [];
        if (isLastUser && attachments.length > 0) {
          for (const att of attachments) {
            if (att.data && att.mimeType) {
              parts.push({
                inlineData: {
                  mimeType: att.mimeType,
                  data: att.data,
                },
              });
            }
          }
        }
        parts.push({ text: m.text });
        return { role: m.role, parts };
      });

      const tools: Array<Record<string, unknown>> = [];
      let toolConfig: Record<string, unknown> | undefined;

      if (useMaps) {
        tools.push({ googleMaps: {} });
        if (location?.lat && location?.lng) {
          toolConfig = {
            retrievalConfig: {
              latLng: {
                latitude: location.lat,
                longitude: location.lng,
              },
            },
          };
        }
      } else if (useSearch) {
        tools.push({ googleSearch: {} });
      }

      const langNote =
        language && language !== "auto"
          ? `\nPreferowany język odpowiedzi użytkownika: ${language}.`
          : "";

      let activeModel = selectedModel;
      const runGenerate = async (targetModel: string, enableTools: boolean) => {
        const reqConfig: Record<string, unknown> = {
          systemInstruction: MIEKISZON_SYSTEM_INSTRUCTION + langNote,
        };
        if (enableTools && tools.length > 0) reqConfig.tools = tools;
        if (enableTools && toolConfig) reqConfig.toolConfig = toolConfig;
        if (targetModel === "gemini-3.1-flash-lite") {
          reqConfig.thinkingConfig = { thinkingLevel: ThinkingLevel.MINIMAL };
        } else if (targetModel === "gemini-4-hydrogen") {
          reqConfig.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
        } else if (targetModel === "gemini-4-carbon") {
          reqConfig.thinkingConfig = { thinkingLevel: ThinkingLevel.HIGH };
        }
        const call = () =>
          withRetry(() =>
            ai.models.generateContent({
              model: targetModel,
              contents,
              config: reqConfig,
            })
          );
        if (targetModel === "gemini-4-hydrogen") {
          return withTimeout(call(), 8000);
        }
        return call();
      };

      let response;
      try {
        response = await runGenerate(activeModel, tools.length > 0);
      } catch (primaryErr) {
        // If Google Search / Maps grounding hits free-tier quota (429/403), retry cleanly without grounding tools
        if (tools.length > 0 && isQuotaOrGroundingDeniedError(primaryErr)) {
          try {
            response = await runGenerate(activeModel, false);
          } catch (noToolErr) {
            if (
              activeModel !== "gemini-3.1-flash-lite" &&
              isTransientOverloadError(noToolErr)
            ) {
              activeModel = "gemini-3.1-flash-lite";
              response = await runGenerate(activeModel, false);
            } else {
              throw noToolErr;
            }
          }
        } else if (
          activeModel === "gemini-4-hydrogen" &&
          isTransientOverloadError(primaryErr)
        ) {
          // Transient 503 demand spike on Hydrogen -> fall back to Flash Lite
          activeModel = "gemini-3.1-flash-lite";
          try {
            response = await runGenerate(activeModel, tools.length > 0);
          } catch (fallbackErr) {
            if (tools.length > 0 && isQuotaOrGroundingDeniedError(fallbackErr)) {
              response = await runGenerate(activeModel, false);
            } else {
              throw fallbackErr;
            }
          }
        } else {
          throw primaryErr;
        }
      }

      const groundingChunks =
        response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const sources: Array<{ title: string; uri: string; type: "web" | "maps" }> = [];
      for (const chunk of groundingChunks) {
        const c = chunk as {
          web?: { uri?: string; title?: string };
          maps?: { uri?: string; title?: string };
        };
        if (c.maps?.uri) {
          sources.push({
            title: c.maps.title || "Google Maps",
            uri: c.maps.uri,
            type: "maps",
          });
        } else if (c.web?.uri) {
          sources.push({
            title: c.web.title || c.web.uri,
            uri: c.web.uri,
            type: "web",
          });
        }
      }

      res.json({
        text: response.text ?? "",
        model: activeModel,
        sources,
      });
    } catch (err) {
      const { status, message } = formatGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 2. Text-to-Speech (30-year-old warm woman voice by default)
  app.post("/api/tts", async (req, res) => {
    try {
      const ai = getAiClient("v1beta");
      const { text, voicePreset = "woman_30_warm" } = req.body as {
        text: string;
        voicePreset?:
          | "woman_30_warm"
          | "woman_30_pro"
          | "man_calm"
          | "off";
      };

      if (!text?.trim() || voicePreset === "off") {
        res.json({ audioBase64: null });
        return;
      }

      const cleanText = text.replace(/[*_`#>\[\]]/g, "").slice(0, 1800);
      const voiceMap: Record<
        string,
        { voiceName: string; style: string }
      > = {
        woman_30_warm: {
          voiceName: "Kore",
          style:
            "Warm, charming, natural 30-year-old Polish woman with a very pleasant, reassuring and slightly playful tone",
        },
        woman_30_pro: {
          voiceName: "Zephyr",
          style:
            "Clear, articulate, confident 30-year-old woman with a smooth studio voice",
        },
        man_calm: {
          voiceName: "Charon",
          style: "Calm, steady, friendly male voice",
        },
      };

      const chosen = voiceMap[voicePreset] || voiceMap.woman_30_warm;

      const response = await withRetry(() =>
        ai.models.generateContent({
          model: "gemini-3.8-flash-lite-tts",
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: cleanText,
                  speechMetadata: {
                    style: chosen.style,
                  },
                } as unknown as { text: string },
              ],
            },
          ],
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: chosen.voiceName },
              },
            },
          },
        })
      );

      const base64Audio =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        res.status(502).json({ error: "Nie udało się wygenerować dźwięku TTS." });
        return;
      }

      res.json({
        audioBase64: base64Audio,
        mimeType: "audio/wav",
      });
    } catch (err) {
      const { status, message } = formatGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 2b. Streaming Text-to-Speech (raw 24kHz L16 PCM chunks via NDJSON for low-latency playback)
  app.post("/api/tts/stream", async (req, res) => {
    try {
      const ai = getAiClient("v1beta");
      const { text, voicePreset = "woman_30_warm" } = req.body as {
        text: string;
        voicePreset?:
          | "woman_30_warm"
          | "woman_30_pro"
          | "man_calm"
          | "off";
      };

      if (!text?.trim() || voicePreset === "off") {
        res.status(204).end();
        return;
      }

      const cleanText = text.replace(/[*_`#>\[\]]/g, "").slice(0, 1800);
      const voiceMap: Record<
        string,
        { voiceName: string; style: string }
      > = {
        woman_30_warm: {
          voiceName: "Kore",
          style:
            "Warm, charming, natural 30-year-old Polish woman with a very pleasant, reassuring and slightly playful tone",
        },
        woman_30_pro: {
          voiceName: "Zephyr",
          style:
            "Clear, articulate, confident 30-year-old woman with a smooth studio voice",
        },
        man_calm: {
          voiceName: "Charon",
          style: "Calm, steady, friendly male voice",
        },
      };

      const chosen = voiceMap[voicePreset] || voiceMap.woman_30_warm;

      const responseStream = await ai.models.generateContentStream({
        model: "gemini-3.8-flash-lite-tts",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: cleanText,
                speechMetadata: { style: chosen.style },
              } as unknown as { text: string },
            ],
          },
        ],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: chosen.voiceName },
            },
          },
        },
      });

      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.flushHeaders?.();

      for await (const chunk of responseStream) {
        if (res.writableEnded) break;
        const data = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (data) {
          res.write(JSON.stringify({ pcm24k: data }) + "\n");
        }
      }
      res.end();
    } catch (err) {
      if (!res.headersSent) {
        const { status, message } = formatGeminiError(err);
        res.status(status).json({ error: message });
      } else {
        res.end();
      }
    }
  });

  // 3. Audio Transcription
  app.post("/api/transcribe", async (req, res) => {
    try {
      const ai = getAiClient();
      const { audioBase64, mimeType = "audio/webm" } = req.body as {
        audioBase64: string;
        mimeType?: string;
      };
      const transcribeContents = {
        parts: [
          { inlineData: { mimeType, data: audioBase64 } },
          {
            text: "Dokładnie przepisz wyłącznie treść wypowiedzi z tego nagrania głosowego (zachowaj język mówiącego, bez dodatkowych komentarzy).",
          },
        ],
      };

      let response;
      try {
        response = await withRetry(() =>
          ai.models.generateContent({
            model: "gemini-3.5-transcribe",
            contents: transcribeContents,
          })
        );
      } catch {
        response = await withRetry(() =>
          ai.models.generateContent({
            model: "gemini-3.1-flash-lite",
            contents: transcribeContents,
          })
        );
      }
      res.json({ text: response.text ?? "" });
    } catch (err) {
      const { status, message } = formatGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 4. Image Generation & Editing (gemini-3.1-flash-lite-image / gemini-nano-banana-2.1 for 1K, 2K, 4K)
  app.post("/api/image/generate", async (req, res) => {
    try {
      const ai = getAiClient("v1beta");
      const {
        prompt,
        imageSize = "1K",
        aspectRatio = "1:1",
        sourceImageBase64,
        sourceMimeType = "image/png",
      } = req.body as {
        prompt: string;
        imageSize?: "1K" | "2K" | "4K";
        aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
        sourceImageBase64?: string;
        sourceMimeType?: string;
      };

      const parts: Array<Record<string, unknown>> = [];
      if (sourceImageBase64) {
        parts.push({
          inlineData: {
            data: sourceImageBase64,
            mimeType: sourceMimeType,
          },
        });
      }
      parts.push({ text: prompt });

      const imageModel =
        imageSize === "2K" || imageSize === "4K"
          ? "gemini-nano-banana-2.1"
          : "gemini-3.1-flash-lite-image";

      const response = await withRetry(() =>
        ai.models.generateContent({
          model: imageModel,
          contents: { parts },
          config: {
            imageConfig: {
              aspectRatio,
              ...(imageModel === "gemini-nano-banana-2.1" ? { imageSize } : {}),
            },
          },
        })
      );

      let imageUrl: string | null = null;
      let caption = "";
      for (const part of response.candidates?.[0]?.content?.parts ?? []) {
        if (part.inlineData?.data) {
          const mime = part.inlineData.mimeType ?? "image/png";
          imageUrl = `data:${mime};base64,${part.inlineData.data}`;
        } else if (part.text) {
          caption += part.text;
        }
      }

      if (!imageUrl) {
        res.status(502).json({
          error:
            "Model nie zwrócił obrazu. Spróbuj doprecyzować opis lub sprawdź klucz API w Settings > Secrets.",
        });
        return;
      }

      res.json({ imageUrl, caption, imageSize, aspectRatio });
    } catch (err) {
      const { status, message } = formatGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 5. Short Video Generation (gemini-omni-1.2-flash via Interactions API)
  app.post("/api/video/generate", async (req, res) => {
    try {
      const ai = getAiClient();
      const {
        prompt,
        aspectRatio = "16:9",
        duration = "5s",
        sourceImageBase64,
        sourceMimeType = "image/png",
      } = req.body as {
        prompt: string;
        aspectRatio?: "16:9" | "9:16";
        duration?: string;
        sourceImageBase64?: string;
        sourceMimeType?: string;
      };

      const input = sourceImageBase64
        ? [
            {
              type: "image" as const,
              mime_type: sourceMimeType,
              data: sourceImageBase64,
            },
            {
              type: "text" as const,
              text: prompt,
            },
          ]
        : prompt;

      const interaction = await ai.interactions.create(
        {
          model: "gemini-omni-1.2-flash",
          input,
          background: false,
          store: false,
          stream: false,
          response_format: {
            type: "video",
            aspect_ratio: aspectRatio,
            duration,
            resolution: "720p",
          },
        },
        { timeout: 300000 }
      );

      const videoPart = interaction.output_video;
      if (!videoPart?.data && !videoPart?.uri) {
        res.status(502).json({
          error:
            "Nie udało się wygenerować krótkiego filmiku. Ten model może wymagać płatnego klucza API w Settings > Secrets.",
        });
        return;
      }

      const mime = videoPart.mime_type || "video/mp4";
      const videoUrl = videoPart.data
        ? `data:${mime};base64,${videoPart.data}`
        : videoPart.uri;

      res.json({ videoUrl });
    } catch (err) {
      const { status, message } = formatGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 6. PDF / Document / Image Translation, Proofreading & Summarization
  app.post("/api/document/process", async (req, res) => {
    try {
      const ai = getAiClient();
      const {
        fileBase64,
        mimeType,
        fileName,
        task = "translate",
        targetLanguage = "Polski",
        customInstructions = "",
      } = req.body as {
        fileBase64: string;
        mimeType: string;
        fileName: string;
        task?: "translate" | "proofread" | "summarize" | "extract";
        targetLanguage?: string;
        customInstructions?: string;
      };

      const taskPrompts: Record<string, string> = {
        translate: `Przetłumacz dokładnie całą treść dokumentu "${fileName}" na język: ${targetLanguage}. Zachowaj strukturę nagłówków, listy i ton oryginału.`,
        proofread: `Przeprowadź profesjonalną korektę językową, ortograficzną, interpunkcyjną i stylistyczną dokumentu "${fileName}". Najpierw wypunktuj najważniejsze poprawki, a następnie podaj pełny poprawiony tekst.`,
        summarize: `Stwórz przejrzyste podsumowanie dokumentu "${fileName}" w języku ${targetLanguage}: główne tezy, najważniejsze liczby, wnioski i zadania do wykonania.`,
        extract: `Wyodrębnij kluczowe dane strukturalne (daty, kwoty, adresy, nazwiska, punkty kluczowe) z dokumentu "${fileName}" w języku ${targetLanguage}.`,
      };

      const promptText =
        (taskPrompts[task] || taskPrompts.translate) +
        (customInstructions ? `\nDodatkowe wytyczne: ${customInstructions}` : "");

      const docContents = {
        parts: [
          { inlineData: { mimeType, data: fileBase64 } },
          { text: promptText },
        ],
      };

      let response;
      try {
        response = await withRetry(() =>
          ai.models.generateContent({
            model: "gemini-4-hydrogen",
            contents: docContents,
            config: {
              systemInstruction: MIEKISZON_SYSTEM_INSTRUCTION,
            },
          })
        );
      } catch (err) {
        if (isTransientOverloadError(err)) {
          response = await withRetry(() =>
            ai.models.generateContent({
              model: "gemini-3.1-flash-lite",
              contents: docContents,
              config: {
                systemInstruction: MIEKISZON_SYSTEM_INSTRUCTION,
              },
            })
          );
        } else {
          throw err;
        }
      }

      res.json({ result: response.text ?? "" });
    } catch (err) {
      const { status, message } = formatGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 7. Live Rear Camera / Screen Share Snapshot Assistance
  app.post("/api/vision/analyze", async (req, res) => {
    try {
      const ai = getAiClient();
      const {
        imageBase64,
        mimeType = "image/jpeg",
        prompt = "Opisz co widzisz i pomóż mi krok po kroku w tej czynności po polsku.",
        sourceType = "camera",
      } = req.body as {
        imageBase64: string;
        mimeType?: string;
        prompt?: string;
        sourceType?: "camera" | "screen";
      };

      const contextPrefix =
        sourceType === "screen"
          ? "Użytkownik udostępnia swój ekran w czasie rzeczywistym. Pomóż mu konkretnie i zwięźle:"
          : "Użytkownik pokazuje obraz z tylnej kamery na żywo. Pomóż mu w czynności krok po kroku:";

      const visionContents = {
        parts: [
          { inlineData: { mimeType, data: imageBase64 } },
          { text: `${contextPrefix}\n${prompt}` },
        ],
      };

      let response;
      try {
        response = await withRetry(() =>
          ai.models.generateContent({
            model: "gemini-4-hydrogen",
            contents: visionContents,
            config: {
              systemInstruction: MIEKISZON_SYSTEM_INSTRUCTION,
            },
          })
        );
      } catch (err) {
        if (isTransientOverloadError(err)) {
          response = await withRetry(() =>
            ai.models.generateContent({
              model: "gemini-3.1-flash-lite",
              contents: visionContents,
              config: {
                systemInstruction: MIEKISZON_SYSTEM_INSTRUCTION,
              },
            })
          );
        } else {
          throw err;
        }
      }

      res.json({ text: response.text ?? "" });
    } catch (err) {
      const { status, message } = formatGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 8. Live GPS Weather (Google Maps Platform Weather API)
  app.get("/api/weather", async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.status(400).json({ error: "Brak poprawnych współrzędnych lat/lng." });
      return;
    }

    const mapsKey = getMapsApiKey();
    if (mapsKey) {
      try {
        const url = new URL(
          "https://weather.googleapis.com/v1/currentConditions:lookup"
        );
        url.searchParams.set("key", mapsKey);
        url.searchParams.set("location.latitude", String(lat));
        url.searchParams.set("location.longitude", String(lng));
        url.searchParams.set("unitsSystem", "METRIC");

        const weatherRes = await fetch(url.toString(), {
          headers: {
            "X-Goog-Maps-Solution-ID": GMP_ATTRIBUTION_ID,
          },
        });
        if (weatherRes.ok) {
          const data = (await weatherRes.json()) as {
            temperature?: { degrees?: number; unit?: string };
            feelsLikeTemperature?: { degrees?: number };
            relativeHumidity?: number;
            wind?: { speed?: { value?: number } };
            weatherCondition?: {
              type?: string;
              description?: { text?: string };
              iconBaseUri?: string;
            };
          };
          res.json({
            temperatureC: data.temperature?.degrees ?? null,
            feelsLikeC: data.feelsLikeTemperature?.degrees ?? null,
            humidity: data.relativeHumidity ?? null,
            windKmh: data.wind?.speed?.value ?? null,
            conditionType: data.weatherCondition?.type ?? "CLEAR",
            description: data.weatherCondition?.description?.text ?? "",
            iconUri: data.weatherCondition?.iconBaseUri
              ? `${data.weatherCondition.iconBaseUri}.svg`
              : null,
            source: "Google Weather API",
          });
          return;
        }
      } catch {
        // Fallback below to Open-Meteo real weather data if Google Weather API is not enabled on key
      }
    }

    // Real meteorological fallback (Open-Meteo, no API key required)
    try {
      const omUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m`;
      const omRes = await fetch(omUrl);
      if (!omRes.ok) {
        res.status(502).json({ error: "Nie udało się pobrać pogody." });
        return;
      }
      const omData = (await omRes.json()) as {
        current?: {
          temperature_2m?: number;
          apparent_temperature?: number;
          relative_humidity_2m?: number;
          wind_speed_10m?: number;
          weather_code?: number;
        };
      };
      const code = omData.current?.weather_code ?? 0;
      const descMap: Record<number, string> = {
        0: "Bezchmurnie",
        1: "Przeważnie pogodnie",
        2: "Częściowe zachmurzenie",
        3: "Pochmurno",
        45: "Mgła",
        48: "Szadź",
        51: "Lekka mżawka",
        61: "Lekki deszcz",
        63: "Deszcz",
        65: "Ulewny deszcz",
        71: "Śnieg",
        80: "Przelotny deszcz",
        95: "Burza",
      };
      res.json({
        temperatureC: omData.current?.temperature_2m ?? null,
        feelsLikeC: omData.current?.apparent_temperature ?? null,
        humidity: omData.current?.relative_humidity_2m ?? null,
        windKmh: omData.current?.wind_speed_10m ?? null,
        conditionType: code >= 61 ? "RAIN" : code >= 2 ? "CLOUDY" : "CLEAR",
        description: descMap[code] || "Zmienna pogoda",
        iconUri: null,
        source: "Live GPS Meteo",
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  interface FoodSearchParams {
    lat?: number | null;
    lng?: number | null;
    radius?: number;
    query?: string;
    openNow?: boolean;
    locationMode?: "gps" | "city" | "postal";
    city?: string;
    postalCode?: string;
  }

  interface FoodPlaceResult {
    id: string;
    name: string;
    address: string;
    phone?: string;
    internationalPhone?: string;
    rating: number;
    userRatingCount: number;
    priceLevel?: string;
    openNow?: boolean;
    googleMapsUri: string;
    lat: number;
    lng: number;
    category: string;
  }

  async function runFoodPlacesSearch(params: FoodSearchParams): Promise<{
    places: FoodPlaceResult[];
    center: { lat: number; lng: number } | null;
    resolvedAreaLabel: string;
    effectiveMode: "gps" | "city" | "postal";
    groundingSummary: string;
    groundingLinks: Array<{ title: string; uri: string }>;
  }> {
    const {
      lat = null,
      lng = null,
      radius = 2500,
      query = "",
      openNow = false,
      locationMode = "gps",
      city = "",
      postalCode = "",
    } = params;

    const trimmedQuery = query.trim();
    const trimmedCity = city.trim();
    const trimmedPostal = postalCode.trim();
    const effectiveMode: "gps" | "city" | "postal" =
      locationMode === "postal" && trimmedPostal
        ? "postal"
        : locationMode === "city" && trimmedCity
          ? "city"
          : "gps";

    if (effectiveMode === "gps" && (lat == null || lng == null)) {
      throw new Error(
        "Brak współrzędnych GPS. Włącz lokalizację albo przełącz wyszukiwanie na miejscowość lub kod pocztowy."
      );
    }

    const mapsKey = getMapsApiKey();
    const fieldMask =
      "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.rating,places.userRatingCount,places.priceLevel,places.currentOpeningHours,places.googleMapsUri,places.location,places.primaryTypeDisplayName";

    let searchCenter: { lat: number; lng: number } | null =
      lat != null && lng != null ? { lat, lng } : null;
    let resolvedAreaLabel =
      effectiveMode === "postal"
        ? `Kod pocztowy: ${trimmedPostal}`
        : effectiveMode === "city"
          ? trimmedCity
          : "Twoja lokalizacja GPS";

    if (mapsKey && effectiveMode !== "gps") {
      try {
        const geocodeTarget =
          effectiveMode === "postal" ? trimmedPostal : trimmedCity;
        const isPlPostal = /^\d{2}-\d{3}$/.test(trimmedPostal);
        const geocodeUrl = new URL(
          "https://maps.googleapis.com/maps/api/geocode/json"
        );
        geocodeUrl.searchParams.set("address", geocodeTarget);
        geocodeUrl.searchParams.set("language", "pl");
        if (effectiveMode === "postal" && isPlPostal) {
          geocodeUrl.searchParams.set("region", "pl");
        }
        geocodeUrl.searchParams.set("key", mapsKey);

        const geoRes = await fetch(geocodeUrl.toString());
        if (geoRes.ok) {
          const geoJson = (await geoRes.json()) as {
            status?: string;
            results?: Array<{
              formatted_address?: string;
              geometry?: { location?: { lat?: number; lng?: number } };
            }>;
          };
          const first = geoJson.results?.[0];
          if (
            first?.geometry?.location?.lat != null &&
            first?.geometry?.location?.lng != null
          ) {
            searchCenter = {
              lat: first.geometry.location.lat,
              lng: first.geometry.location.lng,
            };
            if (first.formatted_address) {
              resolvedAreaLabel = first.formatted_address;
            }
          }
        }
      } catch {
        // Proceed with text search even if Geocoding API is restricted
      }
    }

    let places: FoodPlaceResult[] = [];

    if (mapsKey) {
      const useTextSearch = effectiveMode !== "gps" || Boolean(trimmedQuery);
      const endpoint = useTextSearch
        ? "https://places.googleapis.com/v1/places:searchText"
        : "https://places.googleapis.com/v1/places:searchNearby";

      const areaFragment =
        effectiveMode === "postal"
          ? trimmedPostal
          : effectiveMode === "city"
            ? trimmedCity
            : "";

      const textQueryParts = [
        trimmedQuery || "restauracja jedzenie",
        trimmedQuery ? "restauracja" : "",
        areaFragment,
      ]
        .filter(Boolean)
        .join(" ");

      const clampedRadius = Math.min(Math.max(radius, 300), 25000);

      const bodyPayload = useTextSearch
        ? {
            textQuery: textQueryParts,
            languageCode: "pl",
            maxResultCount: 20,
            openNow: openNow || undefined,
            ...(searchCenter
              ? {
                  locationBias: {
                    circle: {
                      center: {
                        latitude: searchCenter.lat,
                        longitude: searchCenter.lng,
                      },
                      radius: clampedRadius,
                    },
                  },
                }
              : {}),
          }
        : {
            includedTypes: ["restaurant", "cafe", "bakery", "meal_takeaway"],
            maxResultCount: 20,
            languageCode: "pl",
            rankPreference: "POPULARITY",
            locationRestriction: {
              circle: {
                center: {
                  latitude: searchCenter!.lat,
                  longitude: searchCenter!.lng,
                },
                radius: clampedRadius,
              },
            },
          };

      const placesRes = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": mapsKey,
          "X-Goog-FieldMask": fieldMask,
          "X-Goog-Maps-Solution-ID": GMP_ATTRIBUTION_ID,
        },
        body: JSON.stringify(bodyPayload),
      });

      if (placesRes.ok) {
        const data = (await placesRes.json()) as {
          places?: Array<{
            id?: string;
            displayName?: { text?: string };
            formattedAddress?: string;
            nationalPhoneNumber?: string;
            internationalPhoneNumber?: string;
            rating?: number;
            userRatingCount?: number;
            priceLevel?: string;
            currentOpeningHours?: { openNow?: boolean };
            googleMapsUri?: string;
            location?: { latitude?: number; longitude?: number };
            primaryTypeDisplayName?: { text?: string };
          }>;
        };

        places = (data.places ?? [])
          .filter((p) => p.location?.latitude && p.location?.longitude)
          .map((p) => ({
            id: p.id || Math.random().toString(36).slice(2),
            name: p.displayName?.text || "Lokal gastronomiczny",
            address: p.formattedAddress || "",
            phone: p.nationalPhoneNumber || p.internationalPhoneNumber || undefined,
            internationalPhone:
              p.internationalPhoneNumber || p.nationalPhoneNumber || undefined,
            rating: p.rating ?? 0,
            userRatingCount: p.userRatingCount ?? 0,
            priceLevel: p.priceLevel,
            openNow: p.currentOpeningHours?.openNow,
            googleMapsUri:
              p.googleMapsUri ||
              `https://www.google.com/maps/search/?api=1&query=${p.location?.latitude},${p.location?.longitude}`,
            lat: p.location!.latitude!,
            lng: p.location!.longitude!,
            category: p.primaryTypeDisplayName?.text || "Restauracja",
          }))
          .sort((a, b) => {
            if (b.rating !== a.rating) return b.rating - a.rating;
            return b.userRatingCount - a.userRatingCount;
          });

        if (!searchCenter && places[0]) {
          searchCenter = { lat: places[0].lat, lng: places[0].lng };
        }
      }
    }

    let groundingSummary = "";
    let groundingLinks: Array<{ title: string; uri: string }> = [];
    try {
      const ai = getAiClient();
      const locationDesc =
        effectiveMode === "postal"
          ? `w okolicach kodu pocztowego ${trimmedPostal}`
          : effectiveMode === "city"
            ? `w miejscowości ${trimmedCity}`
            : searchCenter
              ? `w promieniu ${Math.round(radius / 1000)} km od współrzędnych ${searchCenter.lat}, ${searchCenter.lng}`
              : "w mojej okolicy";

      const promptText = trimmedQuery
        ? `Znajdź najlepiej oceniane miejsca z jedzeniem (${trimmedQuery}) ${locationDesc}. Podaj nazwy, adresy, oceny w gwiazdkach na Google oraz co warto tam zamówić po polsku.`
        : `Znajdź restauracje i lokale gastronomiczne z najlepszą liczbą gwiazdek na Google ${locationDesc}. Podaj krótkie rekomendacje po polsku.`;

      const gRes = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: promptText,
        config: {
          tools: [{ googleMaps: {} }],
          ...(searchCenter
            ? {
                toolConfig: {
                  retrievalConfig: {
                    latLng: {
                      latitude: searchCenter.lat,
                      longitude: searchCenter.lng,
                    },
                  },
                },
              }
            : {}),
        },
      });
      groundingSummary = gRes.text ?? "";
      const chunks =
        gRes.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      for (const ch of chunks) {
        const m = (ch as { maps?: { uri?: string; title?: string } }).maps;
        if (m?.uri) {
          groundingLinks.push({
            title: m.title || "Zobacz w Google Maps",
            uri: m.uri,
          });
        }
      }
    } catch {
      // Ignore if grounding unavailable
    }

    return {
      places,
      center: searchCenter,
      resolvedAreaLabel,
      effectiveMode,
      groundingSummary,
      groundingLinks,
    };
  }

  // 9. Best-Rated Food Nearby / By City / By Postal Code (Google Geocoding + Places API New + Gemini Maps Grounding)
  app.post("/api/places/food", async (req, res) => {
    try {
      const result = await runFoodPlacesSearch(
        (req.body || {}) as FoodSearchParams
      );
      res.json({
        places: result.places,
        center: result.center,
        resolvedAreaLabel: result.resolvedAreaLabel,
        groundingSummary: result.groundingSummary,
        groundingLinks: result.groundingLinks,
      });
    } catch (err) {
      const status =
        err instanceof Error && err.message.startsWith("Brak współrzędnych GPS")
          ? 400
          : formatGeminiError(err).status;
      const message =
        err instanceof Error ? err.message : formatGeminiError(err).message;
      res.status(status).json({ error: message });
    }
  });

  // 9b. Accommodation / Lodging Search & Automatic Booking Matcher
  app.post("/api/stays/search", async (req, res) => {
    try {
      const {
        city = "",
        lat,
        lng,
        checkIn,
        checkOut,
        guests = 2,
        rooms = 1,
        lodgingType = "all",
        minRating = 4.0,
        maxBudgetPln,
      } = req.body as {
        city?: string;
        lat?: number | null;
        lng?: number | null;
        checkIn?: string;
        checkOut?: string;
        guests?: number;
        rooms?: number;
        lodgingType?: "all" | "hotel" | "apartment" | "guesthouse";
        minRating?: number;
        maxBudgetPln?: number | null;
      };

      const mapsKey = getMapsApiKey();
      const fieldMask =
        "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.rating,places.userRatingCount,places.priceLevel,places.googleMapsUri,places.websiteUri,places.location,places.primaryTypeDisplayName";

      const typeLabelMap: Record<string, string> = {
        all: "hotel apartament nocleg",
        hotel: "hotel",
        apartment: "apartament nocleg",
        guesthouse: "pensjonat nocleg B&B",
      };

      const searchLabel = typeLabelMap[lodgingType] || "hotel nocleg";
      const safeCheckIn =
        checkIn || new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      const safeCheckOut =
        checkOut ||
        new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

      let stays: Array<{
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
      }> = [];

      if (mapsKey) {
        const useNearby = !city.trim() && lat != null && lng != null;
        const endpoint = useNearby
          ? "https://places.googleapis.com/v1/places:searchNearby"
          : "https://places.googleapis.com/v1/places:searchText";

        const bodyPayload = useNearby
          ? {
              includedTypes: ["lodging", "hotel", "bed_and_breakfast", "guest_house"],
              maxResultCount: 15,
              languageCode: "pl",
              rankPreference: "POPULARITY",
              locationRestriction: {
                circle: {
                  center: { latitude: lat, longitude: lng },
                  radius: 10000,
                },
              },
            }
          : {
              textQuery: `${searchLabel} ${city.trim() || "Warszawa"}`,
              languageCode: "pl",
              maxResultCount: 15,
              ...(lat != null && lng != null && !city.trim()
                ? {
                    locationBias: {
                      circle: {
                        center: { latitude: lat, longitude: lng },
                        radius: 15000,
                      },
                    },
                  }
                : {}),
            };

        const placesRes = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": mapsKey,
            "X-Goog-FieldMask": fieldMask,
            "X-Goog-Maps-Solution-ID": GMP_ATTRIBUTION_ID,
          },
          body: JSON.stringify(bodyPayload),
        });

        if (placesRes.ok) {
          const data = (await placesRes.json()) as {
            places?: Array<{
              id?: string;
              displayName?: { text?: string };
              formattedAddress?: string;
              nationalPhoneNumber?: string;
              internationalPhoneNumber?: string;
              rating?: number;
              userRatingCount?: number;
              priceLevel?: string;
              googleMapsUri?: string;
              websiteUri?: string;
              location?: { latitude?: number; longitude?: number };
              primaryTypeDisplayName?: { text?: string };
            }>;
          };

          stays = (data.places ?? [])
            .filter((p) => p.location?.latitude && p.location?.longitude)
            .map((p) => {
              const name = p.displayName?.text || "Obiekt noclegowy";
              const address = p.formattedAddress || city || "";
              const queryDest = `${name} ${city || address}`.trim();
              const bookingComUrl = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(
                queryDest
              )}&checkin=${encodeURIComponent(
                safeCheckIn
              )}&checkout=${encodeURIComponent(
                safeCheckOut
              )}&group_adults=${guests}&no_rooms=${rooms}`;
              const googleHotelsUrl = `https://www.google.com/travel/hotels?q=${encodeURIComponent(
                queryDest
              )}&dates=${encodeURIComponent(safeCheckIn)}%2C${encodeURIComponent(
                safeCheckOut
              )}&adults=${guests}`;

              return {
                id: p.id || Math.random().toString(36).slice(2),
                name,
                address,
                phone:
                  p.nationalPhoneNumber ||
                  p.internationalPhoneNumber ||
                  undefined,
                internationalPhone:
                  p.internationalPhoneNumber ||
                  p.nationalPhoneNumber ||
                  undefined,
                rating: p.rating ?? 0,
                userRatingCount: p.userRatingCount ?? 0,
                priceLevel: p.priceLevel,
                googleMapsUri:
                  p.googleMapsUri ||
                  `https://www.google.com/maps/search/?api=1&query=${p.location?.latitude},${p.location?.longitude}`,
                websiteUri: p.websiteUri,
                bookingComUrl,
                googleHotelsUrl,
                lat: p.location!.latitude!,
                lng: p.location!.longitude!,
                category: p.primaryTypeDisplayName?.text || "Nocleg",
              };
            })
            .filter((s) => s.rating === 0 || s.rating >= minRating)
            .sort((a, b) => {
              if (b.rating !== a.rating) return b.rating - a.rating;
              return b.userRatingCount - a.userRatingCount;
            });

          if (stays.length > 0) {
            stays[0].autoRecommended = true;
          }
        }
      }

      // Live Search Grounding for current prices & availability advice
      let groundingSummary = "";
      let webSources: Array<{ title: string; uri: string }> = [];
      try {
        const ai = getAiClient();
        const locationText =
          city.trim() ||
          (lat != null && lng != null
            ? `współrzędne ${lat.toFixed(4)}, ${lng.toFixed(4)}`
            : "Polska");
        const budgetNote = maxBudgetPln
          ? `Budżet maksymalny: ok. ${maxBudgetPln} PLN / noc.`
          : "";
        const gRes = await ai.models.generateContent({
          model: "gemini-4-hydrogen",
          contents: `Znajdź najlepsze i dobrze oceniane noclegi (${searchLabel}) w lokalizacji: ${locationText} w terminie ${safeCheckIn} – ${safeCheckOut} dla ${guests} osób (${rooms} pokój/pokoje). ${budgetNote}
Podaj po polsku konkretne rekomendacje obiektów, orientacyjne ceny za noc w PLN oraz wskazówki jak najszybciej dokończyć rezerwację.`,
          config: {
            tools: [{ googleSearch: {} }],
            systemInstruction: MIEKISZON_SYSTEM_INSTRUCTION,
          },
        });
        groundingSummary = gRes.text ?? "";
        for (const ch of gRes.candidates?.[0]?.groundingMetadata
          ?.groundingChunks ?? []) {
          const w = (ch as { web?: { uri?: string; title?: string } }).web;
          if (w?.uri) {
            webSources.push({ title: w.title || w.uri, uri: w.uri });
          }
        }
      } catch {
        // Grounding optional
      }

      res.json({
        stays,
        groundingSummary,
        webSources,
        checkIn: safeCheckIn,
        checkOut: safeCheckOut,
      });
    } catch (err) {
      const { status, message } = formatGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 10. Multi-Stop Route Planner (Origin + up to 20 addresses, optimized order)
  app.post("/api/routes/plan", async (req, res) => {
    try {
      const {
        origin,
        stops = [],
        travelMode = "DRIVE",
        optimizeOrder = true,
      } = req.body as {
        origin: string;
        stops: string[];
        travelMode?: "DRIVE" | "BICYCLE" | "WALK" | "TRANSIT";
        optimizeOrder?: boolean;
      };

      const validStops = stops.map((s) => s.trim()).filter(Boolean).slice(0, 20);
      if (!origin.trim() || validStops.length === 0) {
        res
          .status(400)
          .json({ error: "Podaj punkt startowy i co najmniej 1 adres docelowy." });
        return;
      }

      const mapsKey = getMapsApiKey();
      const destination = validStops[validStops.length - 1];
      const intermediates = validStops.slice(0, -1);

      let orderedStops = [...validStops];
      let distanceMeters = 0;
      let durationSeconds = 0;
      let encodedPolyline = "";
      let legs: Array<{
        startAddress: string;
        endAddress: string;
        distanceMeters: number;
        duration: string;
      }> = [];

      if (mapsKey) {
        const canOptimize =
          optimizeOrder &&
          intermediates.length >= 2 &&
          travelMode !== "TRANSIT";

        const requestBody: Record<string, unknown> = {
          origin: { address: origin },
          destination: { address: destination },
          travelMode,
          languageCode: "pl",
        };

        if (intermediates.length > 0 && travelMode !== "TRANSIT") {
          requestBody.intermediates = intermediates.map((addr) => ({
            address: addr,
          }));
          if (canOptimize) {
            requestBody.optimizeWaypointOrder = true;
            requestBody.routingPreference = "TRAFFIC_AWARE";
          }
        }

        const fieldMaskParts = [
          "routes.duration",
          "routes.distanceMeters",
          "routes.polyline.encodedPolyline",
          "routes.legs.distanceMeters",
          "routes.legs.duration",
        ];
        if (canOptimize) {
          fieldMaskParts.push("routes.optimizedIntermediateWaypointIndex");
        }

        const routesRes = await fetch(
          "https://routes.googleapis.com/directions/v2:computeRoutes",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": mapsKey,
              "X-Goog-FieldMask": fieldMaskParts.join(","),
              "X-Goog-Maps-Solution-ID": GMP_ATTRIBUTION_ID,
            },
            body: JSON.stringify(requestBody),
          }
        );

        if (routesRes.ok) {
          const data = (await routesRes.json()) as {
            routes?: Array<{
              distanceMeters?: number;
              duration?: string;
              polyline?: { encodedPolyline?: string };
              optimizedIntermediateWaypointIndex?: number[];
              legs?: Array<{
                distanceMeters?: number;
                duration?: string;
              }>;
            }>;
          };

          const primary = data.routes?.[0];
          if (primary) {
            distanceMeters = primary.distanceMeters ?? 0;
            durationSeconds = parseInt(
              (primary.duration ?? "0s").replace("s", ""),
              10
            );
            encodedPolyline = primary.polyline?.encodedPolyline ?? "";

            if (
              primary.optimizedIntermediateWaypointIndex &&
              primary.optimizedIntermediateWaypointIndex.length > 0
            ) {
              const reordered = primary.optimizedIntermediateWaypointIndex.map(
                (i) => intermediates[i]
              );
              orderedStops = [...reordered, destination];
            }

            const allNodes = [origin, ...orderedStops];
            legs = (primary.legs ?? []).map((leg, idx) => ({
              startAddress: allNodes[idx] || "",
              endAddress: allNodes[idx + 1] || "",
              distanceMeters: leg.distanceMeters ?? 0,
              duration: leg.duration ?? "0s",
            }));
          }
        }
      }

      const modeMap: Record<string, string> = {
        DRIVE: "driving",
        BICYCLE: "bicycling",
        WALK: "walking",
        TRANSIT: "transit",
      };
      const finalDest = orderedStops[orderedStops.length - 1];
      const waypointsParam = orderedStops.slice(0, -1).join("|");
      const googleMapsUrl = new URL("https://www.google.com/maps/dir/");
      googleMapsUrl.searchParams.set("api", "1");
      googleMapsUrl.searchParams.set("origin", origin);
      googleMapsUrl.searchParams.set("destination", finalDest);
      if (waypointsParam) {
        googleMapsUrl.searchParams.set("waypoints", waypointsParam);
      }
      googleMapsUrl.searchParams.set(
        "travelmode",
        modeMap[travelMode] || "driving"
      );

      res.json({
        origin,
        orderedStops,
        distanceMeters,
        durationSeconds,
        encodedPolyline,
        legs,
        googleMapsUrl: googleMapsUrl.toString(),
      });
    } catch (err) {
      const { status, message } = formatGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 11. City-to-City Travel: Public Transit (Train/Tram/Bus) + Eco-Friendly Car + Fuel Stations & Market Prices
  app.post("/api/travel/compare", async (req, res) => {
    try {
      const {
        fromCity,
        toCity,
        transportPreference = "both",
        emissionType = "GASOLINE",
        fuelConsumptionPer100Km = 6.5,
      } = req.body as {
        fromCity: string;
        toCity: string;
        transportPreference?: "both" | "car" | "transit";
        emissionType?: "GASOLINE" | "DIESEL" | "HYBRID" | "ELECTRIC";
        fuelConsumptionPer100Km?: number;
      };

      if (!fromCity.trim() || !toCity.trim()) {
        res.status(400).json({ error: "Podaj miasto początkowe i docelowe." });
        return;
      }

      const mapsKey = getMapsApiKey();
      let ecoRoute: {
        distanceMeters: number;
        durationSeconds: number;
        fuelConsumptionLiters: number | null;
        encodedPolyline: string;
        isFuelEfficient: boolean;
      } | null = null;

      let fuelStations: Array<{
        name: string;
        address: string;
        rating: number;
        googleMapsUri: string;
      }> = [];

      if (mapsKey && transportPreference !== "transit") {
        // Eco-friendly driving route
        const ecoRes = await fetch(
          "https://routes.googleapis.com/directions/v2:computeRoutes",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": mapsKey,
              "X-Goog-FieldMask":
                "routes.duration,routes.distanceMeters,routes.routeLabels,routes.travelAdvisory.fuelConsumptionMicroliters,routes.polyline.encodedPolyline",
              "X-Goog-Maps-Solution-ID": GMP_ATTRIBUTION_ID,
            },
            body: JSON.stringify({
              origin: { address: fromCity },
              destination: { address: toCity },
              travelMode: "DRIVE",
              routingPreference: "TRAFFIC_AWARE_OPTIMAL",
              extraComputations: ["FUEL_CONSUMPTION"],
              routeModifiers: {
                vehicleInfo: { emissionType },
              },
              requestedReferenceRoutes: ["FUEL_EFFICIENT"],
              languageCode: "pl",
            }),
          }
        );

        if (ecoRes.ok) {
          const ecoJson = (await ecoRes.json()) as {
            routes?: Array<{
              distanceMeters?: number;
              duration?: string;
              routeLabels?: string[];
              travelAdvisory?: { fuelConsumptionMicroliters?: string };
              polyline?: { encodedPolyline?: string };
            }>;
          };

          const routes = ecoJson.routes ?? [];
          const chosen =
            routes.find((r) => r.routeLabels?.includes("FUEL_EFFICIENT")) ||
            routes[0];

          if (chosen) {
            const distM = chosen.distanceMeters ?? 0;
            const durS = parseInt(
              (chosen.duration ?? "0s").replace("s", ""),
              10
            );
            const microL = chosen.travelAdvisory?.fuelConsumptionMicroliters
              ? Number(chosen.travelAdvisory.fuelConsumptionMicroliters)
              : null;
            const liters = microL
              ? Number((microL / 1_000_000).toFixed(2))
              : Number(
                  (((distM / 1000) * fuelConsumptionPer100Km) / 100).toFixed(2)
                );

            ecoRoute = {
              distanceMeters: distM,
              durationSeconds: durS,
              fuelConsumptionLiters: liters,
              encodedPolyline: chosen.polyline?.encodedPolyline ?? "",
              isFuelEfficient:
                chosen.routeLabels?.includes("FUEL_EFFICIENT") ?? true,
            };
          }
        }

        // Fuel stations along route / near origin & destination
        const stationsRes = await fetch(
          "https://places.googleapis.com/v1/places:searchText",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": mapsKey,
              "X-Goog-FieldMask":
                "places.displayName,places.formattedAddress,places.rating,places.googleMapsUri",
              "X-Goog-Maps-Solution-ID": GMP_ATTRIBUTION_ID,
            },
            body: JSON.stringify({
              textQuery: `stacja paliw Orlen BP Shell Circle K na trasie ${fromCity} ${toCity}`,
              languageCode: "pl",
              maxResultCount: 6,
            }),
          }
        );

        if (stationsRes.ok) {
          const sJson = (await stationsRes.json()) as {
            places?: Array<{
              displayName?: { text?: string };
              formattedAddress?: string;
              rating?: number;
              googleMapsUri?: string;
            }>;
          };
          fuelStations = (sJson.places ?? []).map((s) => ({
            name: s.displayName?.text || "Stacja paliw",
            address: s.formattedAddress || "",
            rating: s.rating ?? 0,
            googleMapsUri: s.googleMapsUri || "https://maps.google.com",
          }));
        }
      }

      // Live Google Search Grounding via Gemini 4 for current transit schedules (PKP/Koleo/Tram/Bus) & current Polish fuel prices (e-petrol / Orlen / market rates)
      const ai = getAiClient();
      const prompt = `Użytkownik pyta o podróż z "${fromCity}" do "${toCity}" (tryb: ${transportPreference}, paliwo: ${emissionType}, spalanie użytkownika: ${fuelConsumptionPer100Km} l/100km).
Przygotuj konkretną, przejrzystą analizę po polsku w dwóch sekcjach (w zależności od wybranego trybu):
1. **Połączenia kolejowe, tramwajowe i autobusowe (PKP / Koleo / komunikacja miejska)**: Sprawdź aktualne realne możliwości dojazdu pociągiem, tramwajem lub autobusem między "${fromCity}" a "${toCity}", przybliżony czas przejazdu, przewoźników (np. PKP Intercity, Polregio, Koleje Regionalne, ZTM/MPK) oraz orientacyjne ceny biletów.
2. **Trasa samochodowa o najmniejszym spalaniu i aktualne ceny paliw na rynku**: Sprawdź aktualne średnie rynkowe ceny paliw w Polsce (PB95, PB98, Diesel ON, LPG, ładowanie EV) oraz porównaj koszt przejazdu samochodem na najkrótszej / najbardziej ekonomicznej trasie. Jeśli znane są tanie stacje przy trasie, wymień sieci i wskazówki oszczędnej jazdy.`;

      let gRes;
      try {
        gRes = await withRetry(() =>
          ai.models.generateContent({
            model: "gemini-4-hydrogen",
            contents: prompt,
            config: {
              tools: [{ googleSearch: {} }],
              systemInstruction: MIEKISZON_SYSTEM_INSTRUCTION,
            },
          })
        );
      } catch (err) {
        if (isQuotaOrGroundingDeniedError(err) || isTransientOverloadError(err)) {
          gRes = await withRetry(() =>
            ai.models.generateContent({
              model: isTransientOverloadError(err)
                ? "gemini-3.1-flash-lite"
                : "gemini-4-hydrogen",
              contents: prompt,
              config: {
                systemInstruction: MIEKISZON_SYSTEM_INSTRUCTION,
              },
            })
          );
        } else {
          throw err;
        }
      }

      const webSources: Array<{ title: string; uri: string }> = [];
      for (const ch of gRes.candidates?.[0]?.groundingMetadata?.groundingChunks ??
        []) {
        const w = (ch as { web?: { uri?: string; title?: string } }).web;
        if (w?.uri) {
          webSources.push({ title: w.title || w.uri, uri: w.uri });
        }
      }

      const googleMapsEcoUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(
        fromCity
      )}&destination=${encodeURIComponent(toCity)}&travelmode=${
        transportPreference === "transit" ? "transit" : "driving"
      }`;

      res.json({
        ecoRoute,
        fuelStations,
        analysisText: gRes.text ?? "",
        webSources,
        googleMapsEcoUrl,
      });
    } catch (err) {
      const { status, message } = formatGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // Vite or static dist
  if (process.env.NODE_ENV === "production") {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  const httpServer = createServer(app);

  // Real-time Gemini Live API WebSocket Bridge (/ws/live)
  const wss = new WebSocketServer({ server: httpServer, path: "/ws/live" });

  wss.on("connection", async (clientWs: WebSocket, req) => {
    let liveSession: Awaited<ReturnType<GoogleGenAI["live"]["connect"]>> | null =
      null;
    const pendingMessages: string[] = [];
    let closedByClient = false;

    const reqUrl = new URL(req.url || "/ws/live", "http://localhost");
    const voiceParam = reqUrl.searchParams.get("voice") || "Kore";
    const langParam = reqUrl.searchParams.get("lang") || "pl";
    const latParam = reqUrl.searchParams.get("lat");
    const lngParam = reqUrl.searchParams.get("lng");
    let clientLocation: { lat: number; lng: number } | null =
      latParam && lngParam && !Number.isNaN(Number(latParam)) && !Number.isNaN(Number(lngParam))
        ? { lat: Number(latParam), lng: Number(lngParam) }
        : null;
    let lastLivePlaces: FoodPlaceResult[] = [];

    const allowedVoices = new Set(["Kore", "Zephyr", "Charon", "Puck", "Fenrir"]);
    const voiceName = allowedVoices.has(voiceParam) ? voiceParam : "Kore";
    const langNote =
      langParam === "pl"
        ? " Mów wyłącznie czystym, naturalnym językiem polskim (zapisuj transkrypcję wyłącznie polskim alfabetem łacińskim, bez obcych słów czy cyrylicy), chyba że użytkownik wyraźnie poprosi o inny język."
        : langParam && langParam !== "auto"
          ? ` Rozmawiaj domyślnie w języku: ${langParam}, ale automatycznie przełączaj się, jeśli użytkownik przemówi w innym języku.`
          : " Automatycznie wykrywaj język rozmówcy i odpowiadaj w tym samym języku.";

    const liveTools: FunctionDeclaration[] = [
      {
        name: "switchWorkspaceTab",
        description:
          "Przełącza widok aplikacji na wybraną zakładkę (np. 'food' dla Jedzenia w okolicy, 'stays' dla Noclegów, 'media' dla Foto/Wideo/PDF, 'routes' dla Tras, 'chat' dla Głosu asystentki, 'overview' dla Ekranu głównego), nie przerywając rozmowy głosowej.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            tab: {
              type: Type.STRING,
              description:
                "Jedna z zakładek: overview, chat, food, stays, media, routes, events, phone.",
            },
          },
          required: ["tab"],
        },
      },
      {
        name: "searchFoodPlaces",
        description:
          "Wyszukuje najlepiej oceniane restauracje i jedzenie w Google Maps według promienia GPS, podanej miejscowości albo kodu pocztowego, przełącza na zakładkę Jedzenie w okolicy i wyświetla listę oraz pinezki na mapie.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            locationMode: {
              type: Type.STRING,
              description: "Tryb lokalizacji: 'gps', 'city' lub 'postal'.",
            },
            city: {
              type: Type.STRING,
              description: "Nazwa miejscowości, jeśli locationMode='city' (np. Kraków).",
            },
            postalCode: {
              type: Type.STRING,
              description: "Kod pocztowy, jeśli locationMode='postal' (np. 00-001).",
            },
            query: {
              type: Type.STRING,
              description: "Rodzaj kuchni lub dania (np. pizza, sushi, obiad, kawa).",
            },
            radius: {
              type: Type.NUMBER,
              description: "Promień w metrach (1000, 2500, 5000, 10000). Domyślnie 2500.",
            },
            openNow: {
              type: Type.BOOLEAN,
              description: "Czy filtrować tylko teraz otwarte lokale.",
            },
          },
          required: ["locationMode"],
        },
      },
      {
        name: "selectFoodPlace",
        description:
          "Wybiera i podświetla na mapie konkretną restaurację z wcześniej znalezionej listy (po numerze porządkowym 1, 2, 3... albo po nazwie), aby poprowadzić użytkownika do nawigacji.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            placeIndex: {
              type: Type.NUMBER,
              description: "Numer lokalu na liście (1 = pierwszy najlepszy wynik).",
            },
            placeName: {
              type: Type.STRING,
              description: "Nazwa lub fragment nazwy lokalu.",
            },
          },
        },
      },
      {
        name: "callPlacePhone",
        description:
          "Uruchamia połączenie telefoniczne (tel:) z wybraną restauracją, kawiarnią lub noclegiem ze znalezionych wyników Google (po numerze na liście 1, 2, 3... lub po nazwie lokalu).",
        parameters: {
          type: Type.OBJECT,
          properties: {
            placeIndex: {
              type: Type.NUMBER,
              description: "Numer lokalu na aktualnej liście wyników Google (1 = pierwszy wynik).",
            },
            placeName: {
              type: Type.STRING,
              description: "Nazwa lub fragment nazwy lokalu do połączenia.",
            },
          },
        },
      },
      {
        name: "openStayBooking",
        description:
          "Otwiera zakładkę Noclegi i rezerwacje z uzupełnioną miejscowością.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            city: {
              type: Type.STRING,
              description: "Miasto lub kod pocztowy noclegu.",
            },
          },
        },
      },
    ];

    const forwardToLive = (rawStr: string) => {
      if (!liveSession) return;
      try {
        const msg = JSON.parse(rawStr) as {
          audio?: string;
          audioStreamEnd?: boolean;
          video?: string;
          text?: string;
          greet?: boolean;
          location?: { lat: number; lng: number } | null;
          contextNote?: string;
          triggerReply?: boolean;
          syncPlaces?: Array<{
            id?: string;
            name?: string;
            address?: string;
            phone?: string;
            internationalPhone?: string;
            rating?: number;
            googleMapsUri?: string;
          }>;
        };
        if (msg.location && typeof msg.location.lat === "number" && typeof msg.location.lng === "number") {
          clientLocation = msg.location;
        }
        if (Array.isArray(msg.syncPlaces)) {
          lastLivePlaces = msg.syncPlaces.map((p, idx) => ({
            id: p.id || `synced-${idx}`,
            name: p.name || "Lokal",
            address: p.address || "",
            phone: p.phone,
            internationalPhone: p.internationalPhone,
            rating: p.rating ?? 0,
            userRatingCount: 0,
            googleMapsUri: p.googleMapsUri || "",
            lat: 0,
            lng: 0,
            category: "Lokal",
          }));
        }
        if (msg.audio) {
          liveSession.sendRealtimeInput({
            audio: { data: msg.audio, mimeType: "audio/pcm;rate=16000" },
          });
        }
        if (msg.audioStreamEnd) {
          liveSession.sendRealtimeInput({ audioStreamEnd: true });
        }
        if (msg.video) {
          liveSession.sendRealtimeInput({
            video: { data: msg.video, mimeType: "image/jpeg" },
          });
        }
        if (msg.text) {
          liveSession.sendClientContent({
            turns: [{ role: "user", parts: [{ text: msg.text }] }],
            turnComplete: true,
          });
        }
        if (msg.contextNote) {
          liveSession.sendClientContent({
            turns: [
              {
                role: "user",
                parts: [{ text: `[KONTEKST EKRANU APLIKACJI]: ${msg.contextNote}` }],
              },
            ],
            turnComplete: Boolean(msg.triggerReply),
          });
        }
        if (msg.greet) {
          liveSession.sendClientContent({
            turns: [
              {
                role: "user",
                parts: [
                  {
                    text: "Przywitaj się jednym krótkim zdaniem po polsku (maksymalnie 10 słów) i zapytaj, w czym pomóc.",
                  },
                ],
              },
            ],
            turnComplete: true,
          });
        }
      } catch {
        // Ignore malformed frame
      }
    };

    clientWs.on("message", (raw) => {
      const str = raw.toString();
      if (!liveSession) {
        if (pendingMessages.length < 40) {
          pendingMessages.push(str);
        }
        return;
      }
      forwardToLive(str);
    });

    clientWs.on("close", () => {
      closedByClient = true;
      try {
        liveSession?.close();
      } catch {
        // Ignore close error
      }
    });

    try {
      const ai = getAiClient("v1beta");
      const session = await ai.live.connect({
        model: "gemini-3.8-live",
        config: {
          responseModalities: [Modality.AUDIO],
          outputAudioTranscription: {},
          inputAudioTranscription: {},
          tools: [{ functionDeclarations: liveTools }],
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: false,
              startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
              endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
              prefixPaddingMs: 120,
              silenceDurationMs: 420,
            },
            activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
          },
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
          systemInstruction:
            MIEKISZON_SYSTEM_INSTRUCTION +
            langNote +
            "\nRozmawiasz na żywo przez mikrofon. Rozmowa NIE przerywa się przy przełączaniu zakładek w aplikacji — możesz cały czas prowadzić użytkownika krok po kroku na żywo. Jeśli użytkownik chce szukać jedzenia w okolicy (albo po mieście czy kodzie pocztowym), używaj narzędzi switchWorkspaceTab, searchFoodPlaces oraz selectFoodPlace, aby przełączać ekran, wyświetlać lokale na mapie, czytać na głos 2–3 najlepsze miejsca i prowadzić aż do nawigacji. Gdy użytkownik poprosi o zadzwonienie lub połączenie telefoniczne z wybranym lokalem albo hotelem (np. 'zadzwoń tam', 'połącz mnie z pierwszą restauracją'), wywołaj narzędzie callPlacePhone — nigdy nie wymyślaj numeru telefonu z pamięci, używaj wyłącznie prawdziwych numerów zwróconych z Google Places. Odpowiadaj naturalnie, krótko (1–3 zdania), żywo i bez markdown.",
        },
        callbacks: {
          onopen: () => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ status: "connected" }));
            }
          },
          onmessage: (message: LiveServerMessage) => {
            if (clientWs.readyState !== WebSocket.OPEN) return;

            // Handle Live API Tool Calls asynchronously and update the client screen in real time
            const functionCalls = message.toolCall?.functionCalls ?? [];
            if (functionCalls.length > 0 && liveSession) {
              const activeSession = liveSession;
              void (async () => {
                const responses: Array<{
                  id?: string;
                  name?: string;
                  response: Record<string, unknown>;
                }> = [];

                for (const call of functionCalls) {
                  const args = (call.args || {}) as Record<string, unknown>;
                  if (call.name === "switchWorkspaceTab") {
                    const tab = String(args.tab || "food");
                    if (clientWs.readyState === WebSocket.OPEN) {
                      clientWs.send(
                        JSON.stringify({
                          clientAction: { type: "switch_tab", tab },
                        })
                      );
                    }
                    responses.push({
                      id: call.id,
                      name: call.name,
                      response: { ok: true, activeTab: tab },
                    });
                  } else if (call.name === "searchFoodPlaces") {
                    try {
                      const rawMode = String(args.locationMode || "gps");
                      const cityArg = args.city ? String(args.city) : "";
                      const postalArg = args.postalCode
                        ? String(args.postalCode)
                        : "";
                      const locationMode: "gps" | "city" | "postal" =
                        rawMode === "postal" || postalArg
                          ? "postal"
                          : rawMode === "city" || cityArg
                            ? "city"
                            : "gps";
                      const queryArg = args.query ? String(args.query) : "";
                      const radiusArg =
                        typeof args.radius === "number" ? args.radius : 2500;
                      const openNowArg = Boolean(args.openNow);

                      const searchOut = await runFoodPlacesSearch({
                        lat: clientLocation?.lat ?? null,
                        lng: clientLocation?.lng ?? null,
                        locationMode,
                        city: cityArg,
                        postalCode: postalArg,
                        query: queryArg,
                        radius: radiusArg,
                        openNow: openNowArg,
                      });
                      lastLivePlaces = searchOut.places;

                      if (clientWs.readyState === WebSocket.OPEN) {
                        clientWs.send(
                          JSON.stringify({
                            clientAction: {
                              type: "food_results",
                              payload: {
                                locationMode: searchOut.effectiveMode,
                                city: cityArg,
                                postalCode: postalArg,
                                query: queryArg,
                                radius: radiusArg,
                                openNow: openNowArg,
                                places: searchOut.places,
                                center: searchOut.center,
                                resolvedAreaLabel: searchOut.resolvedAreaLabel,
                                groundingSummary: searchOut.groundingSummary,
                                groundingLinks: searchOut.groundingLinks,
                              },
                            },
                          })
                        );
                      }

                      responses.push({
                        id: call.id,
                        name: call.name,
                        response: {
                          ok: true,
                          area: searchOut.resolvedAreaLabel,
                          totalCount: searchOut.places.length,
                          topPlaces: searchOut.places.slice(0, 5).map((p, i) => ({
                            number: i + 1,
                            name: p.name,
                            rating: p.rating,
                            reviews: p.userRatingCount,
                            address: p.address,
                            phone: p.phone || null,
                            openNow: p.openNow,
                          })),
                          summary: searchOut.groundingSummary.slice(0, 400),
                        },
                      });
                    } catch (toolErr) {
                      responses.push({
                        id: call.id,
                        name: call.name,
                        response: {
                          ok: false,
                          error:
                            toolErr instanceof Error
                              ? toolErr.message
                              : "Nie udało się wyszukać jedzenia. Poproś użytkownika o nazwę miejscowości lub kod pocztowy.",
                        },
                      });
                    }
                  } else if (call.name === "selectFoodPlace") {
                    const placeIndex =
                      typeof args.placeIndex === "number"
                        ? args.placeIndex
                        : undefined;
                    const placeName = args.placeName
                      ? String(args.placeName)
                      : undefined;
                    if (clientWs.readyState === WebSocket.OPEN) {
                      clientWs.send(
                        JSON.stringify({
                          clientAction: {
                            type: "select_food_place",
                            placeIndex,
                            placeName,
                          },
                        })
                      );
                    }
                    const matched =
                      placeIndex && lastLivePlaces[placeIndex - 1]
                        ? lastLivePlaces[placeIndex - 1]
                        : placeName
                          ? lastLivePlaces.find((p) =>
                              p.name
                                .toLowerCase()
                                .includes(placeName.toLowerCase())
                            )
                          : lastLivePlaces[0];
                    responses.push({
                      id: call.id,
                      name: call.name,
                      response: matched
                        ? {
                            ok: true,
                            selected: {
                              name: matched.name,
                              address: matched.address,
                              phone: matched.phone || null,
                              rating: matched.rating,
                              googleMapsUri: matched.googleMapsUri,
                            },
                          }
                        : { ok: true, note: "Zaznaczono na liście." },
                    });
                  } else if (call.name === "callPlacePhone") {
                    const placeIndex =
                      typeof args.placeIndex === "number"
                        ? args.placeIndex
                        : undefined;
                    const placeName = args.placeName
                      ? String(args.placeName)
                      : undefined;

                    let matchedIdx = -1;
                    if (placeName) {
                      matchedIdx = lastLivePlaces.findIndex((p) =>
                        p.name.toLowerCase().includes(placeName.toLowerCase())
                      );
                    }
                    if (
                      matchedIdx === -1 &&
                      placeIndex !== undefined &&
                      placeIndex >= 1 &&
                      placeIndex <= lastLivePlaces.length
                    ) {
                      matchedIdx = placeIndex - 1;
                    }
                    if (matchedIdx === -1 && lastLivePlaces.length > 0 && !placeName && placeIndex === undefined) {
                      matchedIdx = 0;
                    }

                    const matched =
                      matchedIdx >= 0 ? lastLivePlaces[matchedIdx] : undefined;

                    if (!matched) {
                      responses.push({
                        id: call.id,
                        name: call.name,
                        response: {
                          ok: false,
                          error:
                            "Brak takiego lokalu na bieżącej liście wyników Google. Najpierw wyszukaj restaurację lub obiekt, abym mogła pobrać prawdziwy numer telefonu z Google.",
                        },
                      });
                    } else {
                      const rawPhone =
                        matched.internationalPhone || matched.phone || "";
                      const dialClean = rawPhone.replace(/[^\d+]/g, "");
                      if (!rawPhone || !dialClean) {
                        responses.push({
                          id: call.id,
                          name: call.name,
                          response: {
                            ok: false,
                            placeName: matched.name,
                            googleMapsUri: matched.googleMapsUri,
                            error:
                              "Ten lokal nie udostępnia numeru telefonu w wizytówce Google. Możesz otworzyć wizytówkę w Google Maps.",
                          },
                        });
                      } else {
                        const dialHref = `tel:${dialClean}`;
                        if (clientWs.readyState === WebSocket.OPEN) {
                          clientWs.send(
                            JSON.stringify({
                              clientAction: {
                                type: "call_place",
                                placeIndex: matchedIdx + 1,
                                placeName: matched.name,
                                phone: rawPhone,
                                dialHref,
                                address: matched.address,
                              },
                            })
                          );
                        }
                        responses.push({
                          id: call.id,
                          name: call.name,
                          response: {
                            ok: true,
                            placeName: matched.name,
                            phone: rawPhone,
                            dialHref,
                            note: "Uruchomiono wybieranie numeru (tel:) na urządzeniu użytkownika.",
                          },
                        });
                      }
                    }
                  } else if (call.name === "openStayBooking") {
                    const cityVal = args.city ? String(args.city) : "";
                    if (clientWs.readyState === WebSocket.OPEN) {
                      clientWs.send(
                        JSON.stringify({
                          clientAction: {
                            type: "open_stay",
                            city: cityVal,
                          },
                        })
                      );
                    }
                    responses.push({
                      id: call.id,
                      name: call.name,
                      response: { ok: true, city: cityVal },
                    });
                  }
                }

                if (responses.length > 0 && !closedByClient) {
                  try {
                    activeSession.sendToolResponse({
                      functionResponses: responses,
                    });
                  } catch {
                    // ignore if socket closed mid-call
                  }
                }
              })();
            }

            const content = message.serverContent;
            if (content?.inputTranscription?.text) {
              clientWs.send(
                JSON.stringify({
                  inputTranscript: content.inputTranscription.text,
                })
              );
            }
            if (content?.outputTranscription?.text) {
              clientWs.send(
                JSON.stringify({
                  outputTranscript: content.outputTranscription.text,
                })
              );
            }
            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                clientWs.send(
                  JSON.stringify({ audio: part.inlineData.data })
                );
              }
            }
            if (content?.interrupted) {
              clientWs.send(JSON.stringify({ interrupted: true }));
            }
            if (content?.turnComplete) {
              clientWs.send(JSON.stringify({ turnComplete: true }));
            }
          },
          onerror: (err: unknown) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(
                JSON.stringify({
                  error:
                    err instanceof Error
                      ? err.message
                      : "Błąd połączenia głosowego Gemini Live",
                })
              );
            }
          },
          onclose: () => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ status: "closed" }));
            }
          },
        },
      });

      if (closedByClient) {
        session.close();
        return;
      }

      liveSession = session;
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ status: "ready" }));
      }
      for (const buffered of pendingMessages.splice(0)) {
        forwardToLive(buffered);
      }
    } catch (err) {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(
          JSON.stringify({
            error:
              err instanceof Error
                ? err.message
                : "Nie udało się połączyć z asystentem głosowym.",
          })
        );
      }
      clientWs.close();
    }
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Miękiszon server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
